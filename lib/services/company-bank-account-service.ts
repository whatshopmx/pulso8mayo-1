/**
 * Catálogo de cuentas bancarias propias de la empresa — el lado pagador.
 *
 * El circuito de dinero tenía catálogo para el destinatario
 * (`payee_bank_accounts` para gastos operativos, `supplier_bank_accounts`
 * para proveedores) pero nada para el origen: `payment_runs.source_account`
 * era texto libre que nadie registraba y el layout de dispersión imprimía
 * "SIN_CUENTA_ORIGEN" en la columna CUENTA_ORIGEN.
 *
 * La identidad de una cuenta propia es su **número de cuenta** — es lo que el
 * layout de origen y el banco reconocen como cuenta que dispersa; la CLABE es
 * anclaje del destinatario (CLABE_DESTINO). La CLABE propia es opcional y sin
 * flujo CEP: no hay tercero contra quién contrastar lo propio. Hereda el
 * blindaje pasivo del resto del sistema: número cifrado con DEK del tenant,
 * últimos 4 en claro, fingerprint para dedupe, baja lógica (`active`) — una
 * cuenta es evidencia de desde dónde se dispersó y nunca se borra.
 *
 * Reglas antifraude aplicadas:
 *   1. Validar formato antes de confiar (número: 4-20 dígitos; CLABE: dígito
 *      verificador Banxico si se captura).
 *   2. Dedupe por fingerprint: la misma cuenta activa no puede duplicarse.
 *   3. Bajar no es borrar: `active=false` conserva la fila.
 *   4. La captura queda firmada por quien la hizo (`registeredBy`).
 *
 * Se duplica en vez de generalizar sobre `payee-bank-account-service.ts` por
 * la misma razón que ese servicio duplica al de proveedores: el verificador y
 * el flujo de alertas de payees no existen aquí, y una abstracción compartida
 * a mitad de camino arriesgaría el circuito de pagos por economía de líneas.
 */
import { createHmac } from "node:crypto";
import { and, desc, eq, gte, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { bankTransactions, companyBankAccounts, users } from "@/lib/db/schema";
import { ApiError } from "@/lib/api/error";
import { bankNameForCode, validateClabe, type ClabeErrorCode } from "@/lib/banking/clabe";
import { DekService } from "@/lib/security/dek";
import { encryptColumnWithDek } from "@/lib/security/column-cipher";

/** Propósito declarado de la cuenta: por dónde dispersa y por dónde recibe. */
export type AccountPurpose = "DISPERSION" | "RECEPCION" | "MIXTO";

/** Lo que sí puede cruzar a una respuesta HTTP. Nunca incluye el número. */
export interface SafeCompanyBankAccount {
    id: string;
    label: string;
    accountLastFour: string;
    bankCode: string;
    bankName: string;
    /** Últimos 4 de la CLABE propia, cuando la tiene. */
    clabeLastFour: string | null;
    currency: string;
    active: boolean;
    /** DISPERSION | RECEPCION | MIXTO. Las cuentas viejas quedaron MIXTO. */
    purpose: AccountPurpose;
    registeredByName: string | null;
    notes: string | null;
    createdAt: Date;
}

const SAFE_COLUMNS = {
    id: companyBankAccounts.id,
    label: companyBankAccounts.label,
    accountLastFour: companyBankAccounts.accountLastFour,
    bankCode: companyBankAccounts.bankCode,
    bankName: companyBankAccounts.bankName,
    clabeLastFour: companyBankAccounts.clabeLastFour,
    currency: companyBankAccounts.currency,
    active: companyBankAccounts.active,
    purpose: companyBankAccounts.purpose,
    registeredByName: users.name,
    notes: companyBankAccounts.notes,
    createdAt: companyBankAccounts.createdAt,
};

/**
 * Quitar lo que no sea dígito. Un número de cuenta llega de un PDF, de la
 * app del banco o de WhatsApp con espacios y guiones: ruido de transporte,
 * no error de captura.
 */
export function normalizeAccountNumber(raw: string): string {
    return raw.replace(/\D/g, "");
}

/** ¿Formato plausible de número de cuenta? 4–20 dígitos; sin dígito control
 * propio: a diferencia de la CLABE, el número de cuenta no trae verificador. */
export function validateAccountNumber(
    accountNumber: string
): { ok: true; value: string; last4: string } | { ok: false; code: "FORMATO" } {
    const value = normalizeAccountNumber(accountNumber);
    if (value.length < 4 || value.length > 20) return { ok: false, code: "FORMATO" };
    return { ok: true, value, last4: value.slice(-4) };
}

function fingerprintAccount(accountNumber: string, dek: Buffer): string {
    return createHmac("sha256", dek).update(accountNumber).digest("hex");
}

export async function listCompanyBankAccounts(
    companyId: string,
    options: { activeOnly?: boolean } = {}
): Promise<SafeCompanyBankAccount[]> {
    const conditions = [eq(companyBankAccounts.companyId, companyId)];
    if (options.activeOnly) {
        conditions.push(eq(companyBankAccounts.active, true));
    }
    return db
        .select(SAFE_COLUMNS)
        .from(companyBankAccounts)
        .leftJoin(users, eq(users.id, companyBankAccounts.registeredBy))
        .where(and(...conditions))
        .orderBy(desc(companyBankAccounts.createdAt));
}

export async function createCompanyBankAccount(input: {
    companyId: string;
    label: string;
    /** Número de cuenta — el origen real del pago. Cifrado en reposo. */
    accountNumber: string;
    /** Código Banxico; obligatorio si no se captura CLABE. */
    bankCode?: string;
    /** CLABE propia opcional (cifrada, referencia SPEI de contexto). */
    clabe?: string | null;
    currency?: string;
    /** Propósito declarado; default MIXTO — las cuentas viejas no pierden capacidad. */
    purpose?: AccountPurpose;
    notes?: string;
    registeredBy: string;
}): Promise<SafeCompanyBankAccount> {
    const label = input.label?.trim();
    if (!label) {
        throw ApiError.badRequest("La etiqueta de la cuenta es obligatoria.");
    }

    const numberCheck = validateAccountNumber(input.accountNumber ?? "");
    if (numberCheck.ok === false) {
        throw ApiError.badRequest(
            "El número de cuenta debe tener entre 4 y 20 dígitos.",
            { errorCode: "FORMATO_CUENTA" }
        );
    }

    await DekService.ensureDek(input.companyId);
    const dek = await DekService.getDek(input.companyId);
    const fingerprint = fingerprintAccount(numberCheck.value, dek);

    // La misma cuenta activa no puede registrarse dos veces: es la única
    // guarda sin que el dedupe dependa del banco (dos filas para la misma
    // cuenta no enripecen el histórico de origen).
    const [duplicate] = await db
        .select({ id: companyBankAccounts.id, label: companyBankAccounts.label })
        .from(companyBankAccounts)
        .where(
            and(
                eq(companyBankAccounts.companyId, input.companyId),
                eq(companyBankAccounts.accountFingerprint, fingerprint),
                eq(companyBankAccounts.active, true)
            )
        )
        .limit(1);
    if (duplicate) {
        throw ApiError.badRequest(
            `Esta cuenta ya está registrada como "${duplicate.label}".`,
            { existingAccountId: duplicate.id }
        );
    }

    // Banca y CLABE: si viene CLABE se valida y deriva; si no, el código
    // Banxico es obligatorio (no hay contra quién inferirlo).
    let bankCode = input.bankCode?.trim() ?? "";
    let bankName = bankCode ? bankNameForCode(bankCode) : null;
    let clabeEncrypted: string | null = null;
    let clabeLast4: string | null = null;

    const clabeRaw = input.clabe?.trim() || null;
    if (clabeRaw) {
        const validation = validateClabe(clabeRaw);
        if (validation.ok === false) {
            const clabeError: ClabeErrorCode = validation.code;
            throw ApiError.badRequest(validation.message, { clabeError });
        }
        if (bankCode && bankCode !== validation.bankCode) {
            throw ApiError.badRequest(
                `El banco declarado (${bankName ?? bankCode}) no coincide con el de la CLABE (${validation.bankName}). Revisa la captura.`
            );
        }
        bankCode = validation.bankCode;
        bankName = validation.bankName;
        clabeEncrypted = encryptColumnWithDek(validation.clabe, dek);
        clabeLast4 = validation.last4;
    }

    if (!bankCode) {
        throw ApiError.badRequest(
            "El código Banxico del banco es obligatorio cuando no se captura CLABE.",
            { errorCode: "BANCO_REQUERIDO" }
        );
    }

    const [inserted] = await db
        .insert(companyBankAccounts)
        .values({
            companyId: input.companyId,
            label,
            accountNumber: encryptColumnWithDek(numberCheck.value, dek),
            accountLastFour: numberCheck.last4,
            accountFingerprint: fingerprint,
            bankCode,
            bankName: bankName ?? bankCode,
            clabe: clabeEncrypted,
            clabeLastFour: clabeLast4,
            currency: input.currency?.trim() || "MXN",
            purpose: input.purpose ?? "MIXTO",
            active: true,
            registeredBy: input.registeredBy,
            notes: input.notes?.trim() || null,
        })
        /**
         * `RETURNING` de Postgres sólo alcanza columnas de la tabla destino:
         * reutilizar `SAFE_COLUMNS` aquí rompería el insert con "column name
         * does not exist" porque arrastras `users.name` del join del listado.
         * El nombre de quien registró se resuelve aparte y no es información
         * sensible: es el propio autor de la operación.
         */
        .returning({
            id: companyBankAccounts.id,
            label: companyBankAccounts.label,
            accountLastFour: companyBankAccounts.accountLastFour,
            bankCode: companyBankAccounts.bankCode,
            bankName: companyBankAccounts.bankName,
            clabeLastFour: companyBankAccounts.clabeLastFour,
            currency: companyBankAccounts.currency,
            active: companyBankAccounts.active,
            purpose: companyBankAccounts.purpose,
            notes: companyBankAccounts.notes,
            createdAt: companyBankAccounts.createdAt,
        });

    const [registeredBy] = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, input.registeredBy))
        .limit(1);

    return { ...inserted, registeredByName: registeredBy?.name ?? null };
}

/** Baja lógica. Nunca se borra: es evidencia desde dónde se dispersó. */
export async function deactivateCompanyBankAccount(
    accountId: string,
    companyId: string
): Promise<void> {
    const [updated] = await db
        .update(companyBankAccounts)
        .set({ active: false, updatedAt: new Date() })
        .where(
            and(
                eq(companyBankAccounts.id, accountId),
                eq(companyBankAccounts.companyId, companyId),
                eq(companyBankAccounts.active, true)
            )
        )
        .returning({ id: companyBankAccounts.id });
    if (!updated) {
        throw ApiError.notFound("La cuenta no existe o ya estaba dada de baja.");
    }
}

/** Cambiar el propósito de una cuenta activa. La baja lógica no se toca aquí. */
export async function setCompanyBankAccountPurpose(input: {
    accountId: string;
    companyId: string;
    purpose: AccountPurpose;
}): Promise<void> {
    const [updated] = await db
        .update(companyBankAccounts)
        .set({ purpose: input.purpose, updatedAt: new Date() })
        .where(
            and(
                eq(companyBankAccounts.id, input.accountId),
                eq(companyBankAccounts.companyId, input.companyId),
                eq(companyBankAccounts.active, true)
            )
        )
        .returning({ id: companyBankAccounts.id });
    if (!updated) {
        throw ApiError.notFound("La cuenta no existe o ya estaba dada de baja.");
    }
}

/**
 * Capturar el ancla del saldo computado: apertura + fecha, tomada del portal
 * del banco. Pareja all-or-nothing — un saldo sin fecha (o viceversa) no
 * significa nada, y limpiar el saldo pone ambas en null (nunca mitad).
 * La apertura puede ser negativa (sobregiro); la fecha no puede ser futura:
 * el futuro no se sabe, el saldo del pasado sí se lee del banco.
 */
export async function setCompanyBankAccountAnchor(input: {
    accountId: string;
    companyId: string;
    /** Centavos firmados; `null` con asOfDate null limpia el ancla. */
    openingBalanceCents: number | null;
    /** ISO yyyy-mm-dd. */
    openingAsOfDate: string | null;
}): Promise<void> {
    const bothNull = input.openingBalanceCents === null && input.openingAsOfDate === null;
    const bothSet = input.openingBalanceCents !== null && input.openingAsOfDate !== null;
    if (!bothNull && !bothSet) {
        throw ApiError.badRequest(
            "El saldo base y su fecha van juntos: captura ambos, o vacía ambos para quitar el ancla."
        );
    }
    if (!bothNull) {
        if (!/^(\d{4})-(\d{2})-(\d{2})$/.test(input.openingAsOfDate || "")) {
            throw ApiError.badRequest("La fecha de la apertura es inválida (yyyy-mm-dd).");
        }
        const today = new Date().toISOString().slice(0, 10);
        if (input.openingAsOfDate! > today) {
            throw ApiError.badRequest(
                "La fecha del saldo base no puede ser futura: tómala del corte o portal más reciente del banco."
            );
        }
    }

    const [updated] = await db
        .update(companyBankAccounts)
        .set({
            openingBalanceCents: input.openingBalanceCents,
            openingAsOfDate: input.openingAsOfDate,
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(companyBankAccounts.id, input.accountId),
                eq(companyBankAccounts.companyId, input.companyId),
                eq(companyBankAccounts.active, true)
            )
        )
        .returning({ id: companyBankAccounts.id });
    if (!updated) {
        throw ApiError.notFound("La cuenta no existe o estaba dada de baja.");
    }
}

/**
 * Saldos computados por cuenta: apertura + SUM(movimientos firmados) desde la
 * fecha del ancla. Sólo las cuentas ANCLADAS obtienen saldo — una cuenta sin
 * ancla se excluye en vez de inventarle un cero. Multi-tenant y activas
 * únicamente: es el tablero del dinero del grupo.
 */
export async function getComputedAccountBalances(companyId: string): Promise<
    Map<string, { balanceCents: number; asOfDate: string; openingBalanceCents: number }>
> {
    const accounts = await db
        .select({
            id: companyBankAccounts.id,
            openingBalanceCents: companyBankAccounts.openingBalanceCents,
            openingAsOfDate: companyBankAccounts.openingAsOfDate,
        })
        .from(companyBankAccounts)
        .where(
            and(
                eq(companyBankAccounts.companyId, companyId),
                eq(companyBankAccounts.active, true),
                isNotNull(companyBankAccounts.openingBalanceCents),
                isNotNull(companyBankAccounts.openingAsOfDate)
            )
        );

    if (accounts.length === 0) return new Map();

    // Una sola query agrupada en vez de N llamadas: cada cuenta suma sólo
    // los movimientos DESDE su propia fecha de ancla — los anteriores ya
    // están contenidos en la apertura. El OR por cuenta respeta esa fecha
    // individual sin partirlo en N consultas.
    const sums = await db
        .select({
            accountId: bankTransactions.sourceBankAccountId,
            netCents: sql<number>`coalesce(sum(${bankTransactions.amountCents}), 0)::int`,
        })
        .from(bankTransactions)
        .where(
            and(
                eq(bankTransactions.companyId, companyId),
                inArray(
                    bankTransactions.sourceBankAccountId,
                    accounts.map((a) => a.id)
                ),
                or(
                    ...accounts.map((a) =>
                        and(
                            eq(bankTransactions.sourceBankAccountId, a.id),
                            gte(bankTransactions.valueDate, a.openingAsOfDate as string)
                        )
                    )
                )
            )
        )
        .groupBy(bankTransactions.sourceBankAccountId);

    const sumByAccount = new Map(
        sums
            .filter((s) => s.accountId !== null)
            .map((s) => [s.accountId as string, s.netCents])
    );

    return new Map(
        accounts.map((a) => [
            a.id,
            {
                balanceCents:
                    (a.openingBalanceCents ?? 0) + (sumByAccount.get(a.id) ?? 0),
                asOfDate: a.openingAsOfDate as string,
                openingBalanceCents: a.openingBalanceCents as number,
            },
        ])
    );
}

/**
 * Preselección por propósito. Sobre cuentas activas: se toma la primera activa
 * con el propósito buscado; si ninguna lo declara, la primera activa MIXTO —
 * nunca se inventa una cuenta: con el catálogo vacío se devuelve `null` y la
 * UI pide, no adivina. El default no es una jaula: siempre overridable a mano.
 */
export async function getDefaultDisbursementAccount(
    companyId: string
): Promise<SafeCompanyBankAccount | null> {
    return pickDefaultAccount(companyId, "DISPERSION");
}

export async function getDefaultDepositAccount(
    companyId: string
): Promise<SafeCompanyBankAccount | null> {
    return pickDefaultAccount(companyId, "RECEPCION");
}

async function pickDefaultAccount(
    companyId: string,
    purpose: "DISPERSION" | "RECEPCION"
): Promise<SafeCompanyBankAccount | null> {
    const accounts = await db
        .select(SAFE_COLUMNS)
        .from(companyBankAccounts)
        .leftJoin(users, eq(users.id, companyBankAccounts.registeredBy))
        .where(
            and(
                eq(companyBankAccounts.companyId, companyId),
                eq(companyBankAccounts.active, true)
            )
        )
        .orderBy(desc(companyBankAccounts.createdAt));

    return (
        accounts.find((a) => a.purpose === purpose) ??
        accounts.find((a) => a.purpose === "MIXTO") ??
        null
    );
}
