import { NextRequest } from "next/server";
import { z } from "zod";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import {
    createCompanyBankAccount,
    deactivateCompanyBankAccount,
    getComputedAccountBalances,
    listCompanyBankAccounts,
    setCompanyBankAccountAnchor,
    setCompanyBankAccountPurpose,
    type AccountPurpose,
} from "@/lib/services/company-bank-account-service";

/**
 * Cuentas bancarias propias de la empresa — el lado pagador.
 *
 * El perfil de riesgo es opuesto al de payees/proveedores y por eso el
 * permiso es distinto: aquí la cuenta pertenece a la empresa, la capturan
 * ADMIN, y el fraude no es "cambiarle la cuenta a un tercero" sino registrar
 * una cuenta que no es del grupo. Lo que protege el catálogo es la
 * trazabilidad: cada cuenta queda firmada por quien la registró, se baja con
 * lógica (nunca se borra) y el selector de corridas del layout solo ofrece
 * cuentas activas.
 *
 * El "settings:update" exigido en POST/PATCH es la misma regla de
 * `payee-bank-accounts`: configuración financiera no se abre a GERENTE.
 */

const createSchema = z.object({
    label: z.string().min(1, "La etiqueta es obligatoria.").max(80),
    accountNumber: z.string().min(4, "El número de cuenta es obligatorio."),
    bankCode: z.string().regex(/^\d{3}$/, "Código Banxico inválido.").optional(),
    clabe: z.string().max(18).optional().nullable(),
    currency: z.string().max(3).optional(),
    purpose: z.enum(["DISPERSION", "RECEPCION", "MIXTO"]).optional(),
    notes: z.string().max(1000).optional(),
});

const deactivateSchema = z.object({
    accountId: z.string().uuid("La cuenta es inválida."),
});

/** Cambio de propósito: declara por dónde dispersa y por dónde recibe la cuenta. */
const purposeSchema = z.object({
    accountId: z.string().uuid("La cuenta es inválida."),
    purpose: z.enum(["DISPERSION", "RECEPCION", "MIXTO"]),
});

/**
 * Ancla del saldo computado: apertura (centavos firmados) + fecha, pareja
 * all-or-nothing; ambos null quita el ancla. La captura es a mano por que es
 * el único número que nadie puede derivar: lo dice el banco.
 */
const anchorSchema = z.object({
    accountId: z.string().uuid("La cuenta es inválida."),
    openingBalanceCents: z.number().int("La apertura es en centavos enteros."),
    openingAsOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha es inválida (yyyy-mm-dd)."),
});

const unanchorSchema = z.object({
    accountId: z.string().uuid("La cuenta es inválida."),
    openingBalanceCents: z.null(),
    openingAsOfDate: z.null(),
});

/**
 * GET /api/finance/bank-accounts — catálogo seguro.
 *
 * Devuelve `accountLastFour`, nunca el número completo: es todo lo que la UI
 * muestra jamás.
 */
export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const activeOnly = searchParams.get("activeOnly") === "true";

        const { ctx } = await requirePermissionApi("reports", "read", {
            classification: "FINANCIAL",
            audit: { action: "READ", req },
        });

        const accounts = await listCompanyBankAccounts(ctx.userCompanyId, {
            activeOnly,
        });

        // Saldo computado bajo demanda: sólo los llamadores que lo piden
        // (settings y selector de corrida) cargan la suma del libro.
        if (searchParams.get("withBalances") === "true") {
            const balances = await getComputedAccountBalances(ctx.userCompanyId);
            return ApiHandler.success(
                accounts.map((a) => ({
                    ...a,
                    openingBalanceCents: balances.get(a.id)?.openingBalanceCents ?? null,
                    openingAsOfDate: balances.get(a.id)?.asOfDate ?? null,
                    computedBalanceCents: balances.get(a.id)?.balanceCents ?? null,
                }))
            );
        }

        return ApiHandler.success(accounts);
    } catch (error) {
        return ApiHandler.error(error);
    }
}

/**
 * POST /api/finance/bank-accounts — registra una cuenta de origen.
 *
 * Valida el número (4-20 dígitos) y la CLABE opcional contra el dígito
 * verificador de Banxico; dedupe por fingerprint.
 */
export async function POST(req: NextRequest) {
    try {
        const { ctx } = await requirePermissionApi("settings", "update", {
            classification: "FINANCIAL",
            audit: { action: "UPDATE", req },
        });

        const body = createSchema.parse(await req.json());

        const account = await createCompanyBankAccount({
            companyId: ctx.userCompanyId,
            label: body.label,
            accountNumber: body.accountNumber,
            bankCode: body.bankCode,
            clabe: body.clabe || null,
            currency: body.currency,
            purpose: body.purpose as AccountPurpose | undefined,
            notes: body.notes,
            registeredBy: ctx.userId,
        });

        return ApiHandler.success(account);
    } catch (error) {
        return ApiHandler.error(error);
    }
}

/**
 * PATCH /api/finance/bank-accounts — baja lógica de una cuenta.
 *
 * `active=false` conserva la fila: el histórico de origen de pagos es
 * evidencia y no se borra.
 */
export async function PATCH(req: NextRequest) {
    try {
        const { ctx } = await requirePermissionApi("settings", "update", {
            classification: "FINANCIAL",
            audit: { action: "UPDATE", req },
        });

        const body = deactivateSchema.parse(await req.json());

        await deactivateCompanyBankAccount(body.accountId, ctx.userCompanyId);

        return ApiHandler.success({ ok: true });
    } catch (error) {
        return ApiHandler.error(error);
    }
}

/**
 * PUT /api/finance/bank-accounts — cambio de propósito de una cuenta activa.
 * Edición de propósito con baja disponible aparte (PATCH): la cuenta no muere
 * por cambiar de rol — por eso es otro verbo.
 */
export async function PUT(req: NextRequest) {
    try {
        const { ctx } = await requirePermissionApi("settings", "update", {
            classification: "FINANCIAL",
            audit: { action: "UPDATE", req },
        });

        const raw = await req.json();

        if (raw && typeof raw === "object" && "purpose" in raw) {
            const body = purposeSchema.parse(raw);
            await setCompanyBankAccountPurpose({
                accountId: body.accountId,
                companyId: ctx.userCompanyId,
                purpose: body.purpose as AccountPurpose,
            });
            return ApiHandler.success({ ok: true });
        }

        // Ancla: con valores o limpiándola — ambos caminos son decisiones
        // capturadas por persona, nunca un default del sistema.
        if (raw && typeof raw === "object" && "openingBalanceCents" in raw) {
            const parsed = raw.openingBalanceCents === null
                ? unanchorSchema.parse(raw)
                : anchorSchema.parse(raw);
            await setCompanyBankAccountAnchor({
                accountId: parsed.accountId,
                companyId: ctx.userCompanyId,
                openingBalanceCents: parsed.openingBalanceCents,
                openingAsOfDate: parsed.openingAsOfDate,
            });
            return ApiHandler.success({ ok: true });
        }

        const body = purposeSchema.parse(raw);
        await setCompanyBankAccountPurpose({
            accountId: body.accountId,
            companyId: ctx.userCompanyId,
            purpose: body.purpose as AccountPurpose,
        });

        return ApiHandler.success({ ok: true });
    } catch (error) {
        return ApiHandler.error(error);
    }
}
