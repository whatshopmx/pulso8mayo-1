/**
 * Conciliación bancaria — el estado de cuenta importado cruza contra el libro.
 *
 * Las ENTRADAS ya se concilian por pasarela (`gateway_transactions` y su
 * upload de reportes de Clip/agregadores). Este módulo cierra el otro lado:
 * el banco movió dinero y el sistema no lo sabía. El cruce natural es contra
 * `payment_run_items` liquidadas (CONFIRMED) — la partida ya tiene su
 * comprobante (`settlementReference`), el movimiento del banco es la segunda
 * fuente que la sostiene.
 *
 * Reglas del módulo:
 *   1. **Reimportar no duplica.** El fingerprint (cuenta+fecha+referencia+
 *      monto) es única: el mismo estado de cuenta puede importarse dos veces
 *      y la segunda pasada es un no-op.
 *   2. **El monto va firmado.** Negativo = salida (dispersión); positivo =
 *      entrada (depósito). El matching automático solo sugiere salidas;
 *      las entradas cruzan a mano contra depósitos de ventas.
 *   3. **Match 1-a-1 atómico.** Confirmar un match exige movimiento sin
 *      cruzar y partida CONFIRMED sin cruzar; el certamen lo resuelven
 *      certrojos optimistas en la misma transacción.
 *   4. **La sugerencia nunca es confirmación.** El match se confirma a mano:
 *      un algoritmo que asigna dinero por sí solo no pasa una auditoría.
 */

import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, lte, sql, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { bankTransactions, paymentRunItems, paymentRuns, gatewayTransactions, branches } from "@/lib/db/schema";
import { companyBankAccounts, paymentRunItemTypeEnum } from "@/lib/db/schema";
import { ApiError } from "@/lib/api/error";

type PaymentRunItemType = typeof paymentRunItemTypeEnum.enumValues[number];

// ── Parsing ────────────────────────────────────────────────────────────────

/** Snake/ Camel/Es headers que el CSV del banco trae, mapeados a campos. */
const HEADER_ALIASES = {
    date: ["fecha", "date", "fecha_valor", "fechavalor", "fecha operacion"],
    description: ["descripcion", "description", "concepto", "detalle", "descripción"],
    amount: ["monto", "importe", "amount", "abono_cargo", "cargo/abono"],
    reference: ["referencia", "reference", "folio", "ref"],
} as const;

export interface ParsedBankRow {
    valueDate: string; // ISO yyyy-mm-dd
    description: string;
    amountCents: number; // firmado
    reference: string | null;
}

export interface ParseError {
    line: number;
    raw: string;
    message: string;
}

export interface ParseResult {
    rows: ParsedBankRow[];
    errors: ParseError[];
}

/** Detectar el delimitador del CSV: gana el que más columnas separa. */
export function detectDelimiter(headerLine: string): string {
    const candidates = [",", ";", "\t"];
    let best = ",";
    let bestCount = 0;
    for (const d of candidates) {
        const count = headerLine.split(d).length;
        if (count > bestCount) {
            bestCount = count;
            best = d;
        }
    }
    return best;
}

/** Split respetando comillas CSV ("Distribuidora ""El Norte"", S.A."). */
export function splitCsvLine(line: string, delimiter: string): string[] {
    const out: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === delimiter && !inQuotes) {
            out.push(current.trim());
            current = "";
        } else {
            current += ch;
        }
    }
    out.push(current.trim());
    return out;
}

/**
 * Monto firmado → centavos. Los bancos traen tres formatos:
 *   -1,234.56   MX/US con comas de miles
 *    1.234,56-  es-ES con punto de miles, coma decimal, signo de side
 *   (1,234.56)  contable: paréntesis = negativo
 */
export function parseAmount(raw: string): number | null {
    let s = (raw ?? "").trim();
    if (!s) return null;

    let negative = false;
    if (/^\(.*\)$/.test(s)) {
        negative = true;
        s = s.slice(1, -1);
    }
    if (s.endsWith("-")) {
        negative = true;
        s = s.slice(0, -1);
    }
    if (s.startsWith("-")) {
        negative = true;
        s = s.slice(1);
    }
    s = s.replace(/[$\s]/g, "");

    // El último separador es el decimal; el otro es de miles.
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma > -1 && lastDot > -1) {
        if (lastComma > lastDot) {
            s = s.replace(/\./g, "").replace(",", ".");
        } else {
            s = s.replace(/,/g, "");
        }
    } else if (lastComma > -1) {
        const decimals = s.length - lastComma - 1;
        if (decimals === 1 || decimals === 2) {
            s = s.replace(",", ".");
        } else {
            s = s.replace(/,/g, "");
        }
    }

    // Sólo el punto decimal puede quedarse.
    const value = Number.parseFloat(s);
    if (!Number.isFinite(value)) return null;
    const cents = Math.round(value * 100);
    return negative ? -cents : cents;
}

/** ISO yyyy-mm-dd desde los formatos comunes de estados de cuenta. */
export function parseDate(raw: string): string | null {
    const s = (raw ?? "").trim();
    // ISO directo
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    // dd/mm/yyyy o dd-mm-yyyy (formato MX)
    const m = /^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/.exec(s);
    if (m) {
        const [, dd, mm, yyyy] = m;
        const day = Number(dd);
        const month = Number(mm);
        // El rango 1..31 no basta: 31/02 existe como número, no como fecha.
        // La comprobación por Date por Date es parte del parser, no del llamador.
        const asDate = new Date(Date.UTC(Number(yyyy), month - 1, day));
        if (
            day < 1 ||
            month < 1 ||
            month > 12 ||
            asDate.getUTCFullYear() !== Number(yyyy) ||
            asDate.getUTCMonth() !== month - 1 ||
            asDate.getUTCDate() !== day
        ) {
            return null;
        }
        return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    }
    return null;
}

function mapHeader(h: string): keyof typeof HEADER_ALIASES | null {
    const clean = (h ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
        if (aliases.some((a) => clean === a || clean.startsWith(a))) return field as keyof typeof HEADER_ALIASES;
    }
    return null;
}

/** CSV completo → renglones normalizados + errores por línea. */
export function parseBankStatementCsv(csvText: string): ParseResult {
    const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length === 0) return { rows: [], errors: [] };

    const delimiter = detectDelimiter(lines[0]);
    const headers = splitCsvLine(lines[0], delimiter).map(mapHeader);

    const requiredAll = ["date", "description", "amount"] as const;
    const missing = requiredAll.filter((r) => !headers.includes(r));
    if (missing.length > 0) {
        throw ApiError.badRequest(
            "El CSV no trae las columnas esperadas. Encabezado requerido: fecha, descripción, " +
            "monto (y opcionalmente referencia). Columnas reconocidas: " +
            requiredAll.map((r) => r).join(", "),
            { missingColumns: missing }
        );
    }

    const idx = (field: keyof typeof HEADER_ALIASES) => headers.indexOf(field);
    const dateIdx = idx("date");
    const descIdx = idx("description");
    const amountIdx = idx("amount");
    const refIdx = headers.indexOf("reference");

    const rows: ParsedBankRow[] = [];
    const errors: ParseError[] = [];

    for (let i = 1; i < lines.length; i++) {
        const cells = splitCsvLine(lines[i], delimiter);
        const valueDate = parseDate(cells[dateIdx] ?? "");
        const amountCents = parseAmount(cells[amountIdx] ?? "");
        const description = (cells[descIdx] ?? "").trim();

        if (!valueDate || amountCents === null || !description) {
            errors.push({
                line: i + 1,
                raw: lines[i].slice(0, 120),
                message: !valueDate
                    ? "Fecha ilegible"
                    : amountCents === null
                    ? "Monto ilegible"
                    : "Descripción vacía",
            });
            continue;
        }

        rows.push({
            valueDate,
            description,
            amountCents,
            reference: refIdx >= 0 && cells[refIdx] ? cells[refIdx] : null,
        });
    }

    return { rows, errors };
}

/** Fingerprint estable: cuenta+fecha+referencia+monto. Reimportar es no-op. */
export function buildFingerprint(input: {
    sourceBankAccountId: string | null;
    valueDate: string;
    reference: string | null;
    amountCents: number;
}): string {
    const key = [
        input.sourceBankAccountId ?? "no-account",
        input.valueDate,
        input.reference ?? "",
        input.amountCents,
    ].join("|");
    return createHash("sha256").update(key).digest("hex");
}

// ── Servicio ────────────────────────────────────────────────────────────────

export async function importBankStatement(input: {
    companyId: string;
    csvText: string;
    sourceBankAccountId?: string | null;
    importedBy: string;
}): Promise<{ importedCount: number; duplicateCount: number; errorCount: number }> {
    // La cuenta del catálogo es de la empresa del importador — un id ajeno no
    // se acepta ni revela su existencia.
    if (input.sourceBankAccountId) {
        const [account] = await db
            .select({ id: companyBankAccounts.id })
            .from(companyBankAccounts)
            .where(
                and(
                    eq(companyBankAccounts.id, input.sourceBankAccountId),
                    eq(companyBankAccounts.companyId, input.companyId)
                )
            )
            .limit(1);
        if (!account) {
            throw ApiError.badRequest(
                "La cuenta de origen no existe en el catálogo de esta empresa."
            );
        }
    }

    const { rows, errors } = parseBankStatementCsv(input.csvText);

    let importedCount = 0;
    let duplicateCount = 0;

    for (const row of rows) {
        const fingerprint = buildFingerprint({
            sourceBankAccountId: input.sourceBankAccountId ?? null,
            valueDate: row.valueDate,
            reference: row.reference,
            amountCents: row.amountCents,
        });
        const inserted = await db
            .insert(bankTransactions)
            .values({
                companyId: input.companyId,
                sourceBankAccountId: input.sourceBankAccountId ?? null,
                valueDate: row.valueDate,
                description: row.description,
                reference: row.reference,
                amountCents: row.amountCents,
                fingerprint,
                importedBy: input.importedBy,
            })
            // Idempotencia: el índice único decide; la reimportación completa
            // del mismo estado de cuenta no debe mover ni una fila.
            .onConflictDoNothing({ target: bankTransactions.fingerprint })
            .returning({ id: bankTransactions.id });
        if (inserted.length > 0) importedCount++;
        else duplicateCount++;
    }

    return { importedCount, duplicateCount, errorCount: errors.length };
}

export interface BankTransactionItem {
    id: string;
    valueDate: string;
    description: string;
    reference: string | null;
    amountCents: number;
    matchStatus: "UNMATCHED" | "MATCHED" | "IGNORED";
    sourceBankAccountId: string | null;
    accountLabel: string | null;
    matchedPaymentRunItemId: string | null;
    matchNotes: string | null;
}

export interface BankTransactionPage {
    items: BankTransactionItem[];
    total: number;
    summary: {
        unmatchedCount: number;
        matchedCount: number;
        unmatchedOutflowCents: number;
    };
}

export async function listBankTransactions(params: {
    companyId: string;
    matchStatus?: "UNMATCHED" | "MATCHED" | "IGNORED";
    sourceBankAccountId?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
}): Promise<BankTransactionPage> {
    const conditions = [eq(bankTransactions.companyId, params.companyId)];
    if (params.matchStatus) {
        conditions.push(eq(bankTransactions.matchStatus, params.matchStatus));
    }
    if (params.sourceBankAccountId) {
        conditions.push(eq(bankTransactions.sourceBankAccountId, params.sourceBankAccountId));
    }
    if (params.startDate) conditions.push(gte(bankTransactions.valueDate, params.startDate));
    if (params.endDate) conditions.push(lte(bankTransactions.valueDate, params.endDate));

    const where = and(...conditions);

    const [items, totals] = await Promise.all([
        db
            .select({
                id: bankTransactions.id,
                valueDate: bankTransactions.valueDate,
                description: bankTransactions.description,
                reference: bankTransactions.reference,
                amountCents: bankTransactions.amountCents,
                matchStatus: bankTransactions.matchStatus,
                sourceBankAccountId: bankTransactions.sourceBankAccountId,
                accountLabel: companyBankAccounts.label,
                matchedPaymentRunItemId: bankTransactions.matchedPaymentRunItemId,
                matchNotes: bankTransactions.matchNotes,
            })
            .from(bankTransactions)
            .leftJoin(companyBankAccounts, eq(companyBankAccounts.id, bankTransactions.sourceBankAccountId))
            .where(where)
            .orderBy(desc(bankTransactions.valueDate), desc(bankTransactions.createdAt))
            .limit(Math.min(params.limit ?? 100, 500))
            .offset(params.offset ?? 0),
        db
            .select({
                count: sql<number>`count(*)::int`,
                unmatchedCount: sql<number>`count(*) filter (where ${bankTransactions.matchStatus} = 'UNMATCHED')::int`,
                matchedCount: sql<number>`count(*) filter (where ${bankTransactions.matchStatus} = 'MATCHED')::int`,
                unmatchedOutflowCents: sql<number>`coalesce(sum(${bankTransactions.amountCents}) filter (where ${bankTransactions.matchStatus} = 'UNMATCHED' and ${bankTransactions.amountCents} < 0), 0)::int`,
            })
            .from(bankTransactions)
            .where(where),
    ]);

    const totalsRow = totals[0];

    return {
        items,
        total: totalsRow.count,
        summary: {
            unmatchedCount: totalsRow.unmatchedCount,
            matchedCount: totalsRow.matchedCount,
            unmatchedOutflowCents: totalsRow.unmatchedOutflowCents,
        },
    };
}

// ── Matching ───────────────────────────────────────────────────────────────

/** Ventana de fechas para considerar una partida candidata del monto exacto. */
export const MATCH_DATE_WINDOW_DAYS = 10;

export interface MatchCandidate {
    paymentRunItemId: string;
    paymentRunId: string;
    runTitle: string;
    itemType: PaymentRunItemType;
    amountCents: number;
    settledAt: string | null;
    settlementReference: string | null;
    /** |días| entre fecha valor y liquidación — menor es mejor candidato. */
    dateDiffDays: number;
}

/** Puro: candidato válido si el monto es exacto y la fecha en ventana. */
export function scoreCandidate(
    tx: { valueDate: string; amountCents: number },
    item: { amountCents: number; settledAt: string | null }
): { ok: boolean; dateDiffDays: number; reason: "MONTO" | "FECHA" | null } {
    if (item.amountCents !== -tx.amountCents) {
        return { ok: false, dateDiffDays: Infinity, reason: "MONTO" };
    }
    if (!item.settledAt) {
        return { ok: false, dateDiffDays: Infinity, reason: "FECHA" };
    }
    const txDate = new Date(`${tx.valueDate}T00:00:00Z`).getTime();
    const itemDate = new Date(item.settledAt);
    const diff = Math.abs(Math.round((itemDate.getTime() - txDate) / 86_400_000));
    if (diff > MATCH_DATE_WINDOW_DAYS) {
        return { ok: false, dateDiffDays: diff, reason: "FECHA" };
    }
    return { ok: true, dateDiffDays: diff, reason: null };
}

/**
 * Sugerencias por movimiento: partidas CONFIRMED con monto espejo exacto
 * dentro de la ventana. Sólo sugiere; confirmar es una acción aparte.
 */
export async function suggestMatches(params: {
    companyId: string;
    transactionId?: string;
}): Promise<{ transactionId: string; candidates: MatchCandidate[] }[]> {
    const conditions = [
        eq(bankTransactions.companyId, params.companyId),
        eq(bankTransactions.matchStatus, "UNMATCHED"),
        // Sólo salidas cruza automático: entradas (depósitos) van por otro
        // lado contra los cortes de venta.
        sql`${bankTransactions.amountCents} < 0`,
    ];
    if (params.transactionId) {
        conditions.push(eq(bankTransactions.id, params.transactionId));
    }

    const txs = await db
        .select({
            id: bankTransactions.id,
            valueDate: bankTransactions.valueDate,
            amountCents: bankTransactions.amountCents,
        })
        .from(bankTransactions)
        .where(and(...conditions))
        .orderBy(desc(bankTransactions.valueDate))
        .limit(50);

    if (txs.length === 0) return [];

    // Partidas liquidadas en la ventana más ancha posible: el filtro fino
    // (monto espejo + ventana) lo hace scoreCandidate en memoria, tras traer
    // una vez el universo filtrado por empresa. Con cientos de partidas es
    // una query y un reduce; con miles sería candidato a SQL lateral.
    const windowStart = new Date(
        Math.min(
            ...txs.map((t) => new Date(`${t.valueDate}T00:00:00Z`).getTime())
        ) -
        MATCH_DATE_WINDOW_DAYS * 86_400_000
    );
    const windowEnd = new Date(
        Math.max(...txs.map((t) => new Date(`${t.valueDate}T00:00:00Z`).getTime())) +
        MATCH_DATE_WINDOW_DAYS * 86_400_000
    );

    const settledItems = await db
        .select({
            id: paymentRunItems.id,
            paymentRunId: paymentRunItems.paymentRunId,
            itemType: paymentRunItems.itemType,
            amountCents: paymentRunItems.amountCents,
            settledAt: paymentRunItems.settledAt,
            settlementReference: paymentRunItems.settlementReference,
            runTitle: paymentRuns.title,
        })
        .from(paymentRunItems)
        .innerJoin(paymentRuns, eq(paymentRuns.id, paymentRunItems.paymentRunId))
        .where(
            and(
                eq(paymentRuns.companyId, params.companyId),
                eq(paymentRunItems.settlementStatus, "CONFIRMED"),
                gte(paymentRunItems.settledAt, windowStart),
                lte(paymentRunItems.settledAt, windowEnd)
            )
        );

    // Uma partida ya puede estar cruzada por otro movimiento: se excluye.
    const alreadyMatchedItemIds = new Set(
        (
            await db
                .select({ id: bankTransactions.matchedPaymentRunItemId })
                .from(bankTransactions)
                .where(
                    and(
                        eq(bankTransactions.companyId, params.companyId),
                        eq(bankTransactions.matchStatus, "MATCHED"),
                        isNotNull(bankTransactions.matchedPaymentRunItemId)
                    )
                )
        ).map((r) => r.id as string)
    );

    const suggestions = txs.map((tx) => {
        const candidates = settledItems
            .filter((item) => !alreadyMatchedItemIds.has(item.id))
            .map((item) => {
                const scored = scoreCandidate(
                    { valueDate: tx.valueDate, amountCents: tx.amountCents },
                    {
                        amountCents: item.amountCents,
                        settledAt: item.settledAt
                            ? item.settledAt.toISOString()
                            : null,
                    }
                );
                return { item, scored };
            })
            .filter((c) => c.scored.ok)
            .sort((a, b) => a.scored.dateDiffDays - b.scored.dateDiffDays)
            .slice(0, 5)
            .map<MatchCandidate>((c) => ({
                paymentRunItemId: c.item.id,
                paymentRunId: c.item.paymentRunId,
                runTitle: c.item.runTitle,
                itemType: c.item.itemType,
                amountCents: c.item.amountCents,
                settledAt: c.item.settledAt ? c.item.settledAt.toISOString() : null,
                settlementReference: c.item.settlementReference,
                dateDiffDays: c.scored.dateDiffDays,
            }));
        return { transactionId: tx.id, candidates };
    });

    return suggestions;
}

// ── Matching de ENTRADAS (depósitos de pasarela) ────────────────────────────

export interface DepositMatchCandidate {
    gatewayTransactionId: string;
    acquirer: string;
    externalId: string | null;
    authorizationCode: string | null;
    branchName: string | null;
    /** Sólo last-4 de la cuenta destino cuando la fila la declara. */
    destinationAccountLastFour: string | null;
    netAmountCents: number;
    settlementDate: string | null;
    /** |días| entre fecha valor del banco y settlement de la pasarela. */
    dateDiffDays: number;
}

/**
 * Puro: candidato válido de ENTRADA si el abono neto de la pasarela es el
 * monto exacto del movimiento bancario y la settlement cae en la ventana.
 * Misma política exacta que las salidas: el algoritmo no tolera diferencias
 * de centavo — si no calza a la moneda, la persona que cruza decide.
 */
export function scoreDepositCandidate(
    tx: { valueDate: string; amountCents: number },
    gateway: { netAmountCents: number; settlementDate: string | null }
): { ok: boolean; dateDiffDays: number; reason: "MONTO" | "FECHA" | null } {
    if (gateway.netAmountCents !== tx.amountCents) {
        return { ok: false, dateDiffDays: Infinity, reason: "MONTO" };
    }
    if (!gateway.settlementDate) {
        return { ok: false, dateDiffDays: Infinity, reason: "FECHA" };
    }
    const txDate = new Date(`${tx.valueDate}T00:00:00Z`).getTime();
    const gwDate = new Date(`${gateway.settlementDate}T00:00:00Z`).getTime();
    const diff = Math.abs(Math.round((gwDate - txDate) / 86_400_000));
    if (diff > MATCH_DATE_WINDOW_DAYS) {
        return { ok: false, dateDiffDays: diff, reason: "FECHA" };
    }
    return { ok: true, dateDiffDays: diff, reason: null };
}

/**
 * Espejo de `suggestMatches`, para el lado de las entradas: movimientos
 * positivos UNMATCHED contra `gateway_transactions` que declaran aterrizar en
 * la MISMA cuenta del movimiento bancario, con neto exacto y settlement en
 * ventana. El depósito bancario que agrupa varios lotes/días no calza a la
 * moneda contra una fila gateway: queda UNMATCHED con nota — la extensión 1↔N
 * es un follow-up propio y no se inventa aquí.
 *
 * La sugerencia nunca es confirmación: sólo nombra candidatos.
 */
export async function suggestDepositMatches(params: {
    companyId: string;
    transactionId?: string;
}): Promise<{ transactionId: string; candidates: DepositMatchCandidate[] }[]> {
    const conditions = [
        eq(bankTransactions.companyId, params.companyId),
        eq(bankTransactions.matchStatus, "UNMATCHED"),
        // Sólo entradas: el match de salidas es el protocolo de arriba.
        sql`${bankTransactions.amountCents} > 0`,
    ];
    if (params.transactionId) {
        conditions.push(eq(bankTransactions.id, params.transactionId));
    }

    const txs = await db
        .select({
            id: bankTransactions.id,
            valueDate: bankTransactions.valueDate,
            amountCents: bankTransactions.amountCents,
            sourceBankAccountId: bankTransactions.sourceBankAccountId,
        })
        .from(bankTransactions)
        .where(and(...conditions))
        .orderBy(desc(bankTransactions.valueDate))
        .limit(50);

    if (txs.length === 0) return [];

    // Universo de gateway en la ventana más ancha, una sola query: el filtro
    // fino (cuenta + monto + días) lo hace scoreDepositCandidate en memoria.
    const windowStart = new Date(
        Math.min(...txs.map((t) => new Date(`${t.valueDate}T00:00:00Z`).getTime())) -
            MATCH_DATE_WINDOW_DAYS * 86_400_000
    );
    const windowEnd = new Date(
        Math.max(...txs.map((t) => new Date(`${t.valueDate}T00:00:00Z`).getTime())) +
            MATCH_DATE_WINDOW_DAYS * 86_400_000
    );

    const gatewayRows = await db
        .select({
            id: gatewayTransactions.id,
            acquirer: gatewayTransactions.acquirer,
            externalId: gatewayTransactions.externalId,
            authorizationCode: gatewayTransactions.authorizationCode,
            netAmountCents: gatewayTransactions.netAmountCents,
            settlementDate: gatewayTransactions.settlementDate,
            destinationBankAccountId: gatewayTransactions.destinationBankAccountId,
            destinationAccountLastFour: companyBankAccounts.accountLastFour,
            branchName: branches.name,
        })
        .from(gatewayTransactions)
        .leftJoin(
            companyBankAccounts,
            eq(companyBankAccounts.id, gatewayTransactions.destinationBankAccountId)
        )
        .leftJoin(branches, eq(branches.id, gatewayTransactions.branchId))
        .where(
            and(
                eq(gatewayTransactions.companyId, params.companyId),
                gte(gatewayTransactions.settlementDate, windowStart.toISOString().slice(0, 10)),
                lte(gatewayTransactions.settlementDate, windowEnd.toISOString().slice(0, 10))
            )
        );

    // Una fila gateway ya puede estar cruzada por otro movimiento bancario.
    const alreadyMatchedGatewayIds = new Set(
        (
            await db
                .select({ id: bankTransactions.matchedGatewayTransactionId })
                .from(bankTransactions)
                .where(
                    and(
                        eq(bankTransactions.companyId, params.companyId),
                        eq(bankTransactions.matchStatus, "MATCHED"),
                        isNotNull(bankTransactions.matchedGatewayTransactionId)
                    )
                )
        ).map((r) => r.id as string)
    );

    const suggestions = txs.map((tx) => {
        const candidates = gatewayRows
            .filter(
                (gw) =>
                    // La cuenta destino declarada de la fila gateway debe ser
                    // exactamente la cuenta del movimiento bancario: dinero
                    // que cayó en otra cuenta no concilia aquí.
                    gw.destinationBankAccountId !== null &&
                    gw.destinationBankAccountId === tx.sourceBankAccountId &&
                    !alreadyMatchedGatewayIds.has(gw.id)
            )
            .map((gw) => ({
                gw,
                scored: scoreDepositCandidate(
                    { valueDate: tx.valueDate, amountCents: tx.amountCents },
                    { netAmountCents: gw.netAmountCents, settlementDate: gw.settlementDate }
                ),
            }))
            .filter((c) => c.scored.ok)
            .sort((a, b) => a.scored.dateDiffDays - b.scored.dateDiffDays)
            .slice(0, 5)
            .map<DepositMatchCandidate>((c) => ({
                gatewayTransactionId: c.gw.id,
                acquirer: c.gw.acquirer,
                externalId: c.gw.externalId,
                authorizationCode: c.gw.authorizationCode,
                branchName: c.gw.branchName,
                destinationAccountLastFour: c.gw.destinationAccountLastFour,
                netAmountCents: c.gw.netAmountCents,
                settlementDate: c.gw.settlementDate,
                dateDiffDays: c.scored.dateDiffDays,
            }));
        return { transactionId: tx.id, candidates };
    });

    return suggestions;
}

/** Confirmar un match de salidas: atómico, con cerrojos optimistas en ambos lados. */
export async function confirmMatch(input: {
    companyId: string;
    transactionId: string;
    paymentRunItemId: string;
    userId: string;
    notes?: string;
}): Promise<void> {
    await db.transaction(async (tx) => {
        const [txRow] = await tx
            .select({
                id: bankTransactions.id,
                matchStatus: bankTransactions.matchStatus,
                amountCents: bankTransactions.amountCents,
                valueDate: bankTransactions.valueDate,
            })
            .from(bankTransactions)
            .where(
                and(
                    eq(bankTransactions.id, input.transactionId),
                    eq(bankTransactions.companyId, input.companyId)
                )
            )
            .for("update")
            .limit(1);

        if (!txRow) throw ApiError.notFound("El movimiento bancario no existe.");
        if (txRow.matchStatus !== "UNMATCHED") {
            throw ApiError.badRequest(
                "Este movimiento ya fue cruzado o ignorado. Recarga la bandeja."
            );
        }

        const [itemRow] = await tx
            .select({
                id: paymentRunItems.id,
                settlementStatus: paymentRunItems.settlementStatus,
                amountCents: paymentRunItems.amountCents,
            })
            .from(paymentRunItems)
            .innerJoin(paymentRuns, eq(paymentRuns.id, paymentRunItems.paymentRunId))
            .where(
                and(
                    eq(paymentRunItems.id, input.paymentRunItemId),
                    eq(paymentRuns.companyId, input.companyId)
                )
            )
            .for("update")
            .limit(1);

        if (!itemRow) throw ApiError.notFound("La partida de pago no existe.");
        if (itemRow.settlementStatus !== "CONFIRMED") {
            throw ApiError.badRequest(
                "Sólo una partida CONFIRMED cruza contra el banco. Esta está en " +
                `${itemRow.settlementStatus}: resuélvela primero en la corrida.`
            );
        }
        // El monto espejo es obligatorio siempre. La ventana de fechas es
        // criterio de SUGERENCIA, no de confirmación: un apunte que liquidó dos
        // semanas después es normal y la persona que cruza decide.
        if (itemRow.amountCents !== -txRow.amountCents) {
            throw ApiError.badRequest(
                `El monto no es espejo: movimiento ${(txRow.amountCents / 100).toFixed(2)} vs partida ${(itemRow.amountCents / 100).toFixed(2)}.`
            );
        }

        // La partida no puede estar cruzada por otro movimiento en ventanas
        // concurrentes: el `for update` en el movimiento no protege esto.
        const [clash] = await tx
            .select({ id: bankTransactions.id })
            .from(bankTransactions)
            .where(
                and(
                    eq(bankTransactions.companyId, input.companyId),
                    eq(bankTransactions.matchStatus, "MATCHED"),
                    eq(bankTransactions.matchedPaymentRunItemId, input.paymentRunItemId)
                )
            )
            .limit(1);
        if (clash) {
            throw ApiError.badRequest(
                "Esta partida ya está cruzada por otro movimiento del estado de cuenta."
            );
        }

        await tx
            .update(bankTransactions)
            .set({
                matchStatus: "MATCHED",
                matchedPaymentRunItemId: input.paymentRunItemId,
                matchedAt: new Date(),
                matchedBy: input.userId,
                matchNotes: input.notes?.trim() || null,
            })
            .where(eq(bankTransactions.id, txRow.id));
    });
}

/** Deshacer un match: el cruce era un juicio de pareja, no un hecho contable. */
export async function unmatchTransaction(input: {
    companyId: string;
    transactionId: string;
}): Promise<void> {
    const [updated] = await db
        .update(bankTransactions)
        .set({
            matchStatus: "UNMATCHED",
            matchedPaymentRunItemId: null,
            matchedAt: null,
            matchedBy: null,
            matchNotes: null,
        })
        .where(
            and(
                eq(bankTransactions.id, input.transactionId),
                eq(bankTransactions.companyId, input.companyId),
                eq(bankTransactions.matchStatus, "MATCHED")
            )
        )
        .returning({ id: bankTransactions.id });
    if (!updated) {
        throw ApiError.badRequest("El movimiento no estaba cruzado o no existe.");
    }
}

/** Ignorar un movimiento: legítimo (comisión, ISR, descontable) y sin match. */
export async function ignoreTransaction(input: {
    companyId: string;
    transactionId: string;
    userId: string;
    notes?: string;
}): Promise<void> {
    const [updated] = await db
        .update(bankTransactions)
        .set({
            matchStatus: "IGNORED",
            matchedBy: input.userId,
            matchNotes: input.notes?.trim() || null,
        })
        .where(
            and(
                eq(bankTransactions.id, input.transactionId),
                eq(bankTransactions.companyId, input.companyId),
                eq(bankTransactions.matchStatus, "UNMATCHED")
            )
        )
        .returning({ id: bankTransactions.id });
    if (!updated) {
        throw ApiError.badRequest("El movimiento no puede ignorarse en su estado actual.");
    }
}
