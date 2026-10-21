/**
 * Tenant Operating Config Service (Fase 11 — T41/T43)
 *
 * Single read/write point for the 7-dimension operating model of a group
 * (design doc §2). Reads are cached for 5 minutes (unstable_cache, same
 * pattern as cross-branch-service). Companies created before the T41 hook
 * (or without a row for any reason) lazily resolve to Case-A defaults.
 *
 * **Consumers, verified field by field in C15** — this header used to announce
 * consumers that never existed (`purchase-order-service` reading
 * `managerAutonomy`, `cross-branch-service` reading `tenantType`), which is
 * exactly the defect [H04](docs/audits/2026-10-10-backend-frontend-wiring-audit.md)
 * describes. The authoritative list now lives in
 * `lib/company/operating-policy-catalog.ts`. Static contract tests detect
 * references that require reviewing the catalog; runtime effects still need
 * verification against the consumer.
 *
 *  - `purchasingStructure`, `foodProduction`, `treasuryModel`, `supplierPayment`,
 *    `payrollDispersion`: **descriptive**. Stored and displayed; no service reads
 *    them. C16–C21 define an effect or keep the descriptive contract.
 *  - `managerAutonomy`: **applied** (C20). `rolExigidoPorMonto` reads the level
 *    to build the expense ladder: `BAJA` centralizes on `ADMIN`, `ALTA`
 *    empowers the branch manager up to the owner threshold, `MEDIA` caps at
 *    `managerAuthLimitCents`.
 *  - `tenantType`: **applied** (C22). `segmentaRed`
 *    (`lib/company/tenant-network-policy.ts`) decides whether the group's
 *    consolidated network is measured as one network or as two (owned vs
 *    franchise), and `CrossBranchService.getBranchQSRRanking` averages,
 *    ranks and flags anomalies inside each network. It does not grant access:
 *    `branchVisibilityFilter` still decides who sees which branch, before
 *    aggregating.
 *  - `managerAuthLimitCents` / `doubleApprovalThresholdCents`: applied via
 *    `rolExigidoPorMonto` (`lib/expenses/approval-policy.ts`) and, for the
 *    second, `umbralesDeAutorizacion` in `control-interno-service`. This service
 *    is where the ladder gets the values.
 *  - `emergencyPurchaseCapCents`: applied via `validateEmergencyCap`
 *    (`lib/services/budget-service.ts`), which queries the table directly.
 *  - `pettyCashLimitCents`: applied via `validarAperturaFondo` and
 *    `validarReposicionFondo` (`lib/finance/petty-cash-policy.ts`) in
 *    `petty-cash-service.ts` for branch fixed fund opening and replenishment caps.
 *  - Fiscal/labor/waste params (`vatRatePercent`, `laborBurdenFactorPercent`,
 *    `payrollStateTaxPercent`, `mermaVarianceThresholdPct`): applied, with
 *    `vigencia` by period resolved from `config_change_logs` (C14.3).
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
    // Sin tope de emergencias por default: se activa cuando el admin lo configure.
    emergencyPurchaseCapCents: null,
    // Reproducen los valores que estaban hardcodeados antes de la 0039, para
    // que ningún tenant existente cambie de lectura.
    foodCostTargetPercent: "30.00",
    foodCostWarnPercent: "35.00",
    laborCostTargetPercent: "28.00",
    laborCostWarnPercent: "32.00",
    healthyMarginTargetPercent: "45.00",
    healthyMarginWarnPercent: "35.00",
    // Umbral de varianza de conteo para merma automática (T11): 5%.
    mermaVarianceThresholdPct: "5.00",
    // A3.2 — tasa general de IVA. Es la del alimento preparado, que es toda la
    // venta de un QSR. Se puede poner en `null` para que Pulso no estime nada y
    // los porcentajes se declaren sobre base bruta.
    vatRatePercent: "16.00",
    // A3.3 — `null` a propósito en los dos: sin factor capturado el KPI de
    // nómina se rotula "bruto" y el semáforo no pinta color, porque comparar un
    // bruto contra un objetivo cargado no dice nada. El ISN es estatal y no
    // puede tener default de módulo.
    laborBurdenFactorPercent: null,
    payrollStateTaxPercent: null,
    // Task 9 plan-aguinaldo: la provisión informativa es visible por default.
    showAguinaldoProvision: true,
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
 *
 * **Fuera de una petición de Next, `unstable_cache` lanza**
 * ("Invariant: incrementalCache missing"). Eso deja sin acceso a la config a
 * todo lo que no sea una ruta o un componente de servidor: las funciones de
 * Inngest, los scripts y los specs que llaman al servicio directo. Y no es
 * teórico — `stock-count-from-workflow.ts:296` ya duplicaba la consulta a mano
 * para esquivarlo, y la autorización de gastos se topó con lo mismo.
 *
 * Se degrada a la lectura directa en vez de reventar. La caché sigue existiendo
 * donde puede existir; donde no, se paga una consulta y se sigue.
 */
export function getTenantOperatingConfig(companyId: string): Promise<TenantOperatingConfigData> {
    try {
        return unstable_cache(
            fetchConfig,
            [TENANT_CONFIG_CACHE_TAG, companyId],
            { revalidate: CACHE_TTL, tags: [TENANT_CONFIG_CACHE_TAG, `${TENANT_CONFIG_CACHE_TAG}-${companyId}`] }
        )(companyId).catch((err) => {
            if (esFaltaDeContextoDePeticion(err)) return fetchConfig(companyId);
            throw err;
        });
    } catch (err) {
        if (esFaltaDeContextoDePeticion(err)) return fetchConfig(companyId);
        throw err;
    }
}

/**
 * El fallo por correr fuera de una petición, y sólo ése.
 *
 * Se compara contra el texto del invariante a propósito: cualquier otro error
 * —la base caída, una consulta mal formada— tiene que seguir propagándose. Un
 * `catch` que se traga todo convertiría una caída de Postgres en "config por
 * omisión", que aquí significa repartir autoridad sobre dinero con valores
 * inventados.
 */
function esFaltaDeContextoDePeticion(err: unknown): boolean {
    const mensaje = err instanceof Error ? err.message : String(err);
    return mensaje.includes("incrementalCache") || mensaje.includes("static generation store");
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

    try {
        revalidateTag(`${TENANT_CONFIG_CACHE_TAG}-${companyId}`, "default");
    } catch (err) {
        if (!esFaltaDeContextoDePeticion(err)) throw err;
    }

    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = row;
    return rest;
}
