/**
 * Tenant Operating Config Service (Fase 11 — T41/T43)
 *
 * Single read/write point for the 7-dimension operating model of a group
 * (design doc §2). Reads are cached for 5 minutes (unstable_cache, same
 * pattern as cross-branch-service). Companies created before the T41 hook
 * (or without a row for any reason) lazily resolve to Case-A defaults.
 *
 * Consumers of these dimensions:
 *  - purchase-order-service (T43): managerAutonomy=BAJA forces PO approval.
 *  - cross-branch-service (T43): tenantType=MIXTO_FRANQUICIAS excludes
 *    franchise branches from group consolidation.
 *  - M16 expense authorization (future): managerAuthLimitCents /
 *    pettyCashLimitCents thresholds.
 *  - M17 segregation of duties (future, T55): doubleApprovalThresholdCents
 *    and the STRICT/DOUBLE_APPROVAL/LOG_ONLY mode derived from
 *    managerAutonomy.
 *  - M15 fiscal (future, T47): payrollDispersion picks the CFDI issuer(s).
 */

import { db } from "@/lib/db";
import { tenantOperatingConfig } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { unstable_cache, revalidateTag } from "next/cache";
import { DEFAULT_FINANCIAL_TARGETS } from "@/lib/services/financial-kpi-types";
import type { FinancialTargets } from "@/lib/services/financial-kpi-types";

export const TENANT_CONFIG_CACHE_TAG = "tenant-operating-config";
const CACHE_TTL = 300; // 5 minutes

/** Config fields without row metadata — what consumers actually read. */
export type TenantOperatingConfigData = Omit<
    typeof tenantOperatingConfig.$inferSelect,
    "id" | "createdAt" | "updatedAt"
>;

/**
 * Case-A defaults (design §2): centralized group, in-situ production,
 * single treasury account, centralized supplier payment, MEDIUM manager
 * autonomy, consolidated payroll, all-own branches. Thresholds mirror the
 * M16 policy defaults ($1,000 / $10,000 / $5,000 MXN in cents).
 */
export const DEFAULT_TENANT_OPERATING_CONFIG: Omit<TenantOperatingConfigData, "companyId"> = {
    purchasingStructure: "CENTRALIZADA",
    foodProduction: "IN_SITU",
    treasuryModel: "CUENTA_UNICA",
    supplierPayment: "CENTRALIZADO",
    managerAutonomy: "MEDIA",
    payrollDispersion: "CONSOLIDADA",
    tenantType: "GRUPO_PROPIO",
    managerAuthLimitCents: 100000,
    doubleApprovalThresholdCents: 1000000,
    pettyCashLimitCents: 500000,
    // Reproducen los valores que estaban hardcodeados antes de la 0039, para
    // que ningún tenant existente cambie de lectura.
    foodCostTargetPercent: "30.00",
    foodCostWarnPercent: "35.00",
    laborCostTargetPercent: "28.00",
    laborCostWarnPercent: "32.00",
    healthyMarginTargetPercent: "45.00",
    healthyMarginWarnPercent: "35.00",
};

/**
 * Los objetivos financieros llegan de Postgres como `numeric` → string, y un
 * `null` es posible en filas anteriores a la 0039: ambos casos caen al default
 * en lugar de propagar `NaN` a un semáforo.
 *
 * El tipo vive en `financial-kpi-types` (sin Drizzle) para que la UI pueda
 * importarlo sin arrastrar la capa de datos al bundle del navegador.
 */
export type { FinancialTargets } from "@/lib/services/financial-kpi-types";

function toPercent(raw: string | null | undefined, fallback: number): number {
    if (raw === null || raw === undefined) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
}

/** Lee los objetivos financieros del tenant (cacheados con el resto del config). */
export async function getFinancialTargets(companyId: string): Promise<FinancialTargets> {
    const config = await getTenantOperatingConfig(companyId);
    return {
        foodCostTargetPercent: toPercent(
            config.foodCostTargetPercent,
            DEFAULT_FINANCIAL_TARGETS.foodCostTargetPercent,
        ),
        foodCostWarnPercent: toPercent(
            config.foodCostWarnPercent,
            DEFAULT_FINANCIAL_TARGETS.foodCostWarnPercent,
        ),
        laborCostTargetPercent: toPercent(
            config.laborCostTargetPercent,
            DEFAULT_FINANCIAL_TARGETS.laborCostTargetPercent,
        ),
        laborCostWarnPercent: toPercent(
            config.laborCostWarnPercent,
            DEFAULT_FINANCIAL_TARGETS.laborCostWarnPercent,
        ),
        healthyMarginTargetPercent: toPercent(
            config.healthyMarginTargetPercent,
            DEFAULT_FINANCIAL_TARGETS.healthyMarginTargetPercent,
        ),
        healthyMarginWarnPercent: toPercent(
            config.healthyMarginWarnPercent,
            DEFAULT_FINANCIAL_TARGETS.healthyMarginWarnPercent,
        ),
    };
}

async function fetchConfig(companyId: string): Promise<TenantOperatingConfigData> {
    const row = await db.query.tenantOperatingConfig.findFirst({
        where: eq(tenantOperatingConfig.companyId, companyId),
    });
    if (row) {
        const { id: _id, createdAt: _c, updatedAt: _u, ...data } = row;
        return data;
    }
    // Lazy fallback: no row yet → Case-A defaults (never null to consumers).
    return { companyId, ...DEFAULT_TENANT_OPERATING_CONFIG };
}

/**
 * Get the operating config for a company, cached 5 min per company.
 * Always returns a complete config (defaults when the row doesn't exist).
 */
export function getTenantOperatingConfig(companyId: string): Promise<TenantOperatingConfigData> {
    return unstable_cache(
        fetchConfig,
        [TENANT_CONFIG_CACHE_TAG, companyId],
        { revalidate: CACHE_TTL, tags: [TENANT_CONFIG_CACHE_TAG, `${TENANT_CONFIG_CACHE_TAG}-${companyId}`] }
    )(companyId);
}

export type UpsertTenantOperatingConfigInput = Partial<Omit<TenantOperatingConfigData, "companyId">>;

/**
 * Create or update the operating config for a company and bust the cache.
 */
export async function upsertTenantOperatingConfig(
    companyId: string,
    data: UpsertTenantOperatingConfigInput
): Promise<TenantOperatingConfigData> {
    const [row] = await db
        .insert(tenantOperatingConfig)
        .values({ companyId, ...data })
        .onConflictDoUpdate({
            target: tenantOperatingConfig.companyId,
            set: { ...data, updatedAt: new Date() },
        })
        .returning();

    revalidateTag(`${TENANT_CONFIG_CACHE_TAG}-${companyId}`, "default");

    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = row;
    return rest;
}
