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
};

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
