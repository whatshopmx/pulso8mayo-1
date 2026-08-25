import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
    branches,
    folioCounters,
    purchaseOrders,
    serviceOrders,
} from "@/lib/db/schema";
import { ApiError } from "@/lib/api/error";

/**
 * Generador de folios documentales OC/OS (finzasordenes.md §2/§3):
 *
 *   [TIPO]-[CODIGO_SUCURSAL]-[AÑO]-[CONSECUTIVO]   ej. OS-CDMX01-2026-0045
 *
 * Decisiones de diseño:
 * - **Atomicidad**: `INSERT .. ON CONFLICT DO UPDATE .. RETURNING` en una sola
 *   sentencia. Postgres serializa los conflictos sobre la fila del contador
 *   (lock de fila implícito), así que dos llamadas concurrentes nunca obtienen
 *   el mismo consecutivo — sin necesidad de SELECT..FOR UPDATE explícito.
 * - **El folio real se emite al formalizar** (submit → PENDING_APPROVAL), no al
 *   crear el borrador: un borrador cancelado no deja hueco en la serie
 *   (requisito "folios consecutivos sin saltos", §6). Los borradores usan
 *   `draftFolio()` y `parseFolio()` los descarta.
 * - **Código de sucursal obligatorio**: si `branches.code` no está configurado
 *   se lanza error claro (catálogo maestro, doc §2 — sin código no hay folio).
 */

export type FolioDocType = "OC" | "OS";

/** Formato real emitido: TIPO-CÓDIGO-AÑO-SECUENCIA (4+ dígitos, ceros a la izquierda). */
const FOLIO_PATTERN = /^(OC|OS)-([A-Z0-9]{1,12})-(\d{4})-(\d{4,})$/;

// ── Funciones puras (cubiertas por folio-generator.test.ts) ──

export function formatFolio(
    docType: FolioDocType,
    branchCode: string,
    year: number,
    sequence: number,
): string {
    return `${docType}-${branchCode.toUpperCase()}-${year}-${String(sequence).padStart(4, "0")}`;
}

export interface ParsedFolio {
    docType: FolioDocType;
    branchCode: string;
    year: number;
    sequence: number;
}

/**
 * Parsea un folio con formato real. Devuelve null para folios de borrador
 * (`DRAFT-XXXXXXXX`), legacy u otro formato — findFolioGaps solo audita series nuevas.
 */
export function parseFolio(folio: string): ParsedFolio | null {
    const m = FOLIO_PATTERN.exec(folio);
    if (!m) return null;
    return {
        docType: m[1] as FolioDocType,
        branchCode: m[2],
        year: Number(m[3]),
        sequence: Number(m[4]),
    };
}

/** Folio placeholder único para borradores; se reemplaza al hacer submit. */
export function draftFolio(): string {
    const rand =
        globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 8).toUpperCase() ??
        Math.random().toString(36).slice(2, 10).toUpperCase();
    return `DRAFT-${rand}`;
}

/**
 * Secuencias faltantes entre 1 y expectedMax (incluido), dadas las presentes.
 * Los duplicados/ceros/negativos en `present` se ignoran silenciosamente.
 */
export function detectGaps(present: Iterable<number>, expectedMax: number): number[] {
    const seen = new Set<number>();
    for (const s of present) {
        if (Number.isInteger(s) && s >= 1 && s <= expectedMax) seen.add(s);
    }
    const gaps: number[] = [];
    for (let s = 1; s <= expectedMax; s++) {
        if (!seen.has(s)) gaps.push(s);
    }
    return gaps;
}

// ── Acceso a datos ──

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbExecutor = typeof db | Tx;

async function resolveBranchCode(
    executor: DbExecutor,
    branchId: string,
): Promise<string> {
    const [branch] = await executor
        .select({ code: branches.code, name: branches.name })
        .from(branches)
        .where(eq(branches.id, branchId))
        .limit(1);

    if (!branch) {
        throw new ApiError(`Sucursal ${branchId} no encontrada`, 404);
    }
    const code = branch.code?.trim().toUpperCase();
    if (!code) {
        throw new ApiError(
            `La sucursal "${branch.name}" no tiene código configurado. ` +
                `Asigna un código corto (ej. CDMX01) en la sucursal para poder emitir folios OC/OS.`,
            400,
        );
    }
    return code;
}

export interface NextFolioInput {
    companyId: string;
    branchId: string;
    docType: FolioDocType;
    /** Transacción externa opcional — pásala si el folio y el cambio de estado deben ser atómicos. */
    tx?: Tx;
}

export interface IssuedFolio {
    folio: string;
    sequence: number;
    branchCode: string;
    year: number;
}

/**
 * Emite el siguiente folio de la serie (empresa, sucursal, tipo, año actual).
 * Si se pasa `tx`, el incremento del contador participa de esa transacción.
 */
export async function nextFolio(input: NextFolioInput): Promise<IssuedFolio> {
    const { companyId, branchId, docType, tx } = input;
    const executor: DbExecutor = tx ?? db;

    const branchCode = await resolveBranchCode(executor, branchId);
    const year = new Date().getFullYear();

    // Upsert atómico: inicializa en 1 o incrementa; RETURNING entrega el valor final.
    const [row] = await executor
        .insert(folioCounters)
        .values({ companyId, branchId, docType, year, lastSequence: 1 })
        .onConflictDoUpdate({
            target: [
                folioCounters.companyId,
                folioCounters.branchId,
                folioCounters.docType,
                folioCounters.year,
            ],
            set: {
                lastSequence: sql`${folioCounters.lastSequence} + 1`,
                updatedAt: new Date(),
            },
        })
        .returning({ lastSequence: folioCounters.lastSequence });

    const sequence = row.lastSequence;
    return {
        folio: formatFolio(docType, branchCode, year, sequence),
        sequence,
        branchCode,
        year,
    };
}

// ── Auditoría de huecos (finzasordenes.md §6: "números faltantes = investigación inmediata") ──

export interface FolioGapReport {
    docType: FolioDocType;
    branchCode: string;
    year: number;
    lastSequence: number;
    missingSequences: number[];
}

/**
 * Compara cada serie registrada en `folio_counters` contra los documentos
 * existentes. Reporta secuencias ausentes dentro de 1..lastSequence.
 * Los folios legacy (poNumber propio) y de borrador no participan.
 */
export async function findFolioGaps(companyId: string): Promise<FolioGapReport[]> {
    const counters = await db
        .select({
            branchId: folioCounters.branchId,
            docType: folioCounters.docType,
            year: folioCounters.year,
            lastSequence: folioCounters.lastSequence,
        })
        .from(folioCounters)
        .where(eq(folioCounters.companyId, companyId));

    if (counters.length === 0) return [];

    const branchRows = await db
        .select({ id: branches.id, code: branches.code })
        .from(branches)
        .where(
            sql`${branches.id} IN (${sql.join(
                counters.map((c) => sql`${c.branchId}`),
                sql`, `,
            )})`,
        );
    const branchCodeById = new Map(branchRows.map((b) => [b.id, b.code?.toUpperCase() ?? ""]));

    // Series presentes: parseando folios reales ya emitidos.
    const osFolios = await db
        .select({ folio: serviceOrders.folio })
        .from(serviceOrders)
        .where(and(eq(serviceOrders.companyId, companyId), sql`${serviceOrders.folio} ~ '^(OC|OS)-'`));

    const ocNumbers = await db
        .select({ poNumber: purchaseOrders.poNumber })
        .from(purchaseOrders)
        .where(
            and(
                eq(purchaseOrders.companyId, companyId),
                sql`${purchaseOrders.poNumber} ~ '^(OC|OS)-'`,
            ),
        );

    // key: docType-branchCode-year -> Set<sequence>
    const presentBySeries = new Map<string, Set<number>>();
    const allFolioStrings = [
        ...osFolios.map((r) => r.folio),
        ...ocNumbers.map((r) => r.poNumber),
    ];
    for (const folio of allFolioStrings) {
        const parsed = parseFolio(folio);
        if (!parsed) continue;
        const key = `${parsed.docType}-${parsed.branchCode}-${parsed.year}`;
        const set = presentBySeries.get(key) ?? new Set<number>();
        set.add(parsed.sequence);
        presentBySeries.set(key, set);
    }

    const reports: FolioGapReport[] = [];
    for (const counter of counters) {
        const branchCode = branchCodeById.get(counter.branchId) ?? "";
        const key = `${counter.docType}-${branchCode}-${counter.year}`;
        const present = presentBySeries.get(key) ?? new Set<number>();
        const missing = detectGaps(present, counter.lastSequence);
        if (missing.length > 0) {
            reports.push({
                docType: counter.docType,
                branchCode,
                year: counter.year,
                lastSequence: counter.lastSequence,
                missingSequences: missing,
            });
        }
    }
    return reports;
}
