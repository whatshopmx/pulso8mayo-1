/**
 * FinanceEngine — Sprint 2 Track A Task 2 (v2 §7).
 *
 * Facade over the EXISTING financial services. It delegates (never recomputes):
 *   - ExecutiveReportService.getReport → food cost %, COGS, revenue, shrinkage,
 *     fill rate (consolidated + per-branch).
 *   - financial-kpi-service.calculateFinancialKPIs → Food/Labor cost % +
 *     semaphore statuses (🟢/🟡/🔴).
 *   - pnl-service.getPnLByBranch → consolidated P&L.
 *   - ExecutiveTwinEngine.getProjectedCashFlow / getUpcomingObligations → 14-day
 *     cash projection + scheduled obligations (nómina, proveedores, rentas,
 *     servicios, impuestos) — itself a thin wrapper over cash-flow-service.
 *   - ForecastService.calculateAll → demand (per-recipe forecast summary).
 *
 * Net-new (normalized to EngineOutput):
 *   - `liquidityRisk`: 0–100 (obligations-to-cash ratio + negative-day penalty).
 *   - `recommendedPayments`: upcoming obligations prioritized (payroll first —
 *     cannot defer — then rent/tax, then invoices/services).
 *
 * Scope-aware via ctx?: AccessContext + branchVisibilityFilter (Pilar 4).
 * refresh() caches into corporate_twins.executive_state.engineSnapshots.finance.
 *
 * Security note: the /api/finance/* routes are migrated to requirePermissionApi
 * ({classification:'FINANCIAL'}) (Track B). This engine calls the services
 * DIRECTLY (not the HTTP routes) because it runs server-side under the Inngest
 * cron (system context, no HTTP request to guard). On-demand API exposure of
 * this engine must go through a guarded route — TODO when an
 * /api/executive/finance endpoint is added (Sprint 3).
 *
 * Source: docs/pulso-executive-os-v2.md §7, docs/pulso-executive-os-security.md §10.
 */
import { db } from "@/lib/db";
import { branches } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { startOfDay, subDays } from "date-fns";
import { ExecutiveReportService } from "@/lib/services/executive-report-service";
import { calculateFinancialKPIs } from "@/lib/services/financial-kpi-service";
import { getPnLByBranch } from "@/lib/services/pnl-service";
import { ForecastService } from "@/lib/services/forecast-service";
import { ExecutiveTwinEngine } from "@/lib/services/executive-twin-engine";
import { branchVisibilityFilter } from "@/lib/rbac/branch-visibility";
import type { AccessContext } from "@/lib/rbac/abac";
import type {
  CashFlowDay,
  EngineOutput,
  IntelligenceEngine,
  Obligation,
  Priority,
  Risk,
} from "./types";

const CLAMP = (n: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, Math.round(n)));

const TYPE_PRIORITY: Record<Obligation["type"], number> = {
  PAYROLL: 1, // nómina — no se puede diferir
  RENT: 2,
  TAX: 2,
  INVOICE: 3,
  SERVICES: 4,
  OTHER: 5,
};

export interface RecommendedPayment {
  id: string;
  label: string;
  amountCents: number;
  dueDate: string;
  type: Obligation["type"];
  /** 1 = highest priority (cannot defer). */
  priority: number;
}

export interface FinanceEngineOutput extends EngineOutput {
  /**
   * `null` cuando el KPI no es calculable en el período (sin movimientos de
   * inventario / sin contratos vigentes). No se sustituye por 0: un food cost
   * de 0% se lee como "no gastamos en insumos".
   */
  foodCostPercent: number | null;
  laborCostPercent: number | null;
  revenueCents: number;
  cogsCents: number;
  shrinkagePercent: number;
  fillRate: number;
  projectedCashFlowCents: number;
  upcomingObligationsCents: number;
  liquidityRisk: number;
  projectedCashFlow: CashFlowDay[];
  upcomingObligations: Obligation[];
  recommendedPayments: RecommendedPayment[];
  pnlBranchCount: number;
  /**
   * Sucursales cuyo P&L se apoya en al menos un renglón que NO se calculó con
   * datos del cliente (`weakestLine !== 'MEASURED'`). Si es > 0, el margen
   * operativo de esas sucursales NO es un número firme y ninguna recomendación
   * derivada de él debe presentarse como tal
   * (docs/plan-pnl-real.md Fase 0, punto 3).
   */
  pnlEstimatedBranchCount: number;
  forecastRecipes: number;
  forecastWithData: number;
}

export interface FinanceEngineInput {
  companyId: string;
  ctx?: AccessContext;
}

export const FinanceEngine: IntelligenceEngine<
  FinanceEngineInput,
  FinanceEngineOutput
> = {
  engineId: "finance",
  engineName: "Finance Engine",

  async analyze(input: FinanceEngineInput): Promise<FinanceEngineOutput> {
    const { companyId, ctx } = input;
    const generatedAt = new Date();

    const allBranches = await db
      .select({
        id: branches.id,
        ownershipType: branches.ownershipType,
        franchiseeUserId: branches.franchiseeUserId,
      })
      .from(branches)
      .where(eq(branches.companyId, companyId));

    const visibleBranchIds = ctx
      ? branchVisibilityFilter(
          ctx,
          allBranches.map((b) => ({
            id: b.id,
            ownershipType: (b.ownershipType ?? "OWNED") as "OWNED" | "FRANCHISE",
            franchiseeUserId: b.franchiseeUserId,
          })),
        )
      : allBranches.map((b) => b.id);

    if (visibleBranchIds.length === 0) {
      return {
        score: 0,
        confidence: 0,
        insights: ["Sin sucursales visibles para el análisis financiero."],
        priorities: [],
        risks: [],
        generatedAt,
        // Sin sucursales visibles no hay KPI que reportar: `null`, no 0%.
        foodCostPercent: null,
        laborCostPercent: null,
        revenueCents: 0,
        cogsCents: 0,
        shrinkagePercent: 0,
        fillRate: 0,
        projectedCashFlowCents: 0,
        upcomingObligationsCents: 0,
        liquidityRisk: 0,
        projectedCashFlow: [],
        upcomingObligations: [],
        recommendedPayments: [],
        pnlBranchCount: 0,
        pnlEstimatedBranchCount: 0,
        forecastRecipes: 0,
        forecastWithData: 0,
      };
    }

    // Period: last 30 days (HORECA operational window for food-cost trends).
    const endDate = new Date();
    const startDate = startOfDay(subDays(endDate, 30));

    const [report, kpis, pnl, forecastAll, cashDays, obligations] =
      await Promise.all([
        ExecutiveReportService.getReport(companyId, startDate, endDate),
        calculateFinancialKPIs({ companyId, startDate: startDate.toISOString(), endDate: endDate.toISOString() }),
        getPnLByBranch(companyId, startDate.toISOString(), endDate.toISOString()),
        ForecastService.calculateAll(companyId),
        ExecutiveTwinEngine.getProjectedCashFlow(companyId, 14),
        ExecutiveTwinEngine.getUpcomingObligations(companyId),
      ]);

    const cons = report.consolidated;

    // Restrict P&L to the visible scope (pnl is per-branch).
    const pnlScoped = pnl.filter((p) => visibleBranchIds.includes(p.branchId));

    // Liquidity risk (mirrors ExecutiveTwinEngine.computeDimensions).
    const projectedCashFlowCents =
      cashDays.length > 0 ? cashDays[cashDays.length - 1].projectedCents : 0;
    const upcomingObligationsCents = obligations.reduce(
      (a, o) => a + o.amountCents,
      0,
    );
    const minBalance = cashDays.reduce(
      (m, d) => Math.min(m, d.projectedCents),
      Number.POSITIVE_INFINITY,
    );
    const worstLiquidity =
      minBalance === Number.POSITIVE_INFINITY ? 0 : minBalance;
    const obligationRatio =
      projectedCashFlowCents > 0
        ? upcomingObligationsCents / projectedCashFlowCents
        : 1;
    const liquidityRisk = CLAMP(
      obligationRatio * 60 + (worstLiquidity < 0 ? 40 : 0),
    );

    // Recommended payments — upcoming obligations prioritized.
    const recommendedPayments: RecommendedPayment[] = [...obligations]
      .sort((a, b) => {
        const pr = (TYPE_PRIORITY[a.type] ?? 5) - (TYPE_PRIORITY[b.type] ?? 5);
        if (pr !== 0) return pr;
        return a.dueDate.localeCompare(b.dueDate);
      })
      .map((o) => ({
        id: o.id,
        label: o.label,
        amountCents: o.amountCents,
        dueDate: o.dueDate,
        type: o.type,
        priority: TYPE_PRIORITY[o.type] ?? 5,
      }));

    // Forecast summary (calculateAll iterates recipes — guard against per-recipe
    // failures which it swallows internally).
    const forecastRecipes = forecastAll.length;
    const forecastWithData = forecastAll.filter((f) => f.daysOfData >= 30).length;

    // Los KPIs ahora pueden no ser calculables (sin inventario, sin contratos):
    // `percent` llega en `null` y no se puede castigar ni premiar un score con
    // un dato que no existe. Se trata como "en objetivo" para no inventar una
    // penalización, y `confidence` más abajo absorbe la incertidumbre.
    const foodPct = kpis.foodCost.percent;
    const laborPct = kpis.laborCost.percent;

    // Score: financial health = inverse of liquidity risk weighted by cost
    // discipline (food+labor cost within margin) and fill rate.
    // Los umbrales salen del tenant, no de un 30/28 fijo: un grupo con otra
    // estructura de costo no debe puntuar mal por operar a su propio objetivo.
    const costDiscipline = CLAMP(
      100 -
        Math.max(0, (foodPct ?? kpis.targets.foodCostTargetPercent) - kpis.targets.foodCostTargetPercent) * 3 -
        Math.max(0, (laborPct ?? kpis.targets.laborCostTargetPercent) - kpis.targets.laborCostTargetPercent) * 3,
    );
    const fillScore = CLAMP(cons.fillRate);
    const score = CLAMP(
      (100 - liquidityRisk) * 0.45 +
        costDiscipline * 0.35 +
        fillScore * 0.2,
    );
    const confidence = CLAMP(
      Math.min(100, 30 + (cons.revenueCents > 0 ? 30 : 0) + cashDays.length * 2),
    );

    // Insights.
    const insights: string[] = [];
    insights.push(
      `Cash proyectado a 14 días: ${(projectedCashFlowCents / 100).toFixed(2)} MXN ` +
        `con ${(upcomingObligationsCents / 100).toFixed(2)} MXN de obligaciones próximas.`,
    );
    // Un KPI sin datos se nombra como tal. Reportar "Food Cost 0.0% (OK)" por
    // no tener movimientos de inventario es peor que no reportarlo.
    const pctLabel = (metric: { percent: number | null; status: string | null }) =>
      metric.percent === null ? "sin datos" : `${metric.percent.toFixed(1)}% (${metric.status})`;

    insights.push(
      `Food Cost ${pctLabel(kpis.foodCost)}, Labor Cost ${pctLabel(kpis.laborCost)}.`,
    );
    if (liquidityRisk > 60) {
      insights.push(
        "Riesgo de liquidez alto — revisar pagos prioritarios antes de comprometer nuevas salidas.",
      );
    }
    if (cons.shrinkagePercent > 3) {
      insights.push(
        `Merma ${cons.shrinkagePercent.toFixed(1)}% por encima de 3% — oportunidad de ahorro.`,
      );
    }
    if (forecastWithData > 0) {
      insights.push(
        `${forecastWithData}/${forecastRecipes} receta(s) con pronóstico de demanda confiable (≥30 días de data).`,
      );
    }

    // Priorities.
    const priorities: Priority[] = [];
    if (worstLiquidity < 0) {
      priorities.push({
        id: "finance-negative-cash-day",
        title: "Cubrir día(s) con saldo negativo proyectado",
        description: `El peor día proyecta ${(worstLiquidity / 100).toFixed(2)} MXN — requiere anticipar cobranza o puente.`,
        impact: "CRITICAL",
      });
    }
    if (kpis.foodCost.status === "CRITICAL" || kpis.laborCost.status === "CRITICAL") {
      priorities.push({
        id: "finance-cost-discipline",
        title: "Corregir costos fuera de umbral",
        description:
          `Food Cost ${pctLabel(kpis.foodCost)}, Labor ${pctLabel(kpis.laborCost)}. ` +
          `Objetivo del grupo: ${kpis.targets.foodCostTargetPercent}% / ${kpis.targets.laborCostTargetPercent}%.`,
        impact: "HIGH",
      });
    }
    if (recommendedPayments.length > 0) {
      const next = recommendedPayments[0];
      priorities.push({
        id: "finance-next-payment",
        title: "Programar próximo pago prioritario",
        description: `${next.label} — ${(next.amountCents / 100).toFixed(2)} MXN vence ${next.dueDate}.`,
        impact: next.priority <= 2 ? "HIGH" : "MEDIUM",
      });
    }

    // Risks.
    const risks: Risk[] = [];
    if (liquidityRisk > 50) {
      risks.push({
        type: "liquidity",
        severity: liquidityRisk > 80 ? "CRITICAL" : "HIGH",
        probability: Math.min(1, liquidityRisk / 100),
        impactCents: upcomingObligationsCents,
        mitigation:
          "Priorizar pagos (nómina→renta/impuestos→proveedores), negociar plazos y anticipar cobranza.",
      });
    }
    if (cons.shrinkagePercent > 5) {
      risks.push({
        type: "shrinkage",
        severity: "MEDIUM",
        probability: 0.6,
        impactCents: Math.round((cons.shrinkagePercent / 100) * Math.max(0, cons.revenueCents)),
        mitigation: "Auditar mermas por sucursal y entradas de recepción (rechazos / daño).",
      });
    }

    return {
      score,
      confidence,
      insights,
      priorities,
      risks,
      generatedAt,
      foodCostPercent: foodPct,
      laborCostPercent: laborPct,
      revenueCents: cons.revenueCents,
      cogsCents: cons.cogsCents,
      shrinkagePercent: cons.shrinkagePercent,
      fillRate: cons.fillRate,
      projectedCashFlowCents,
      upcomingObligationsCents,
      liquidityRisk,
      projectedCashFlow: cashDays,
      upcomingObligations: obligations,
      recommendedPayments,
      pnlBranchCount: pnlScoped.length,
      pnlEstimatedBranchCount: pnlScoped.filter((p) => p.weakestLine !== "MEASURED").length,
      forecastRecipes,
      forecastWithData,
    };
  },

  async getLatest(companyId: string): Promise<FinanceEngineOutput | null> {
    const twin = await ExecutiveTwinEngine.getLatest(companyId);
    const snap = twin?.executiveState?.engineSnapshots?.finance;
    return (snap as FinanceEngineOutput | undefined) ?? null;
  },

  async refresh(companyId: string): Promise<FinanceEngineOutput> {
    const output = await this.analyze({ companyId });
    await ExecutiveTwinEngine.setEngineSnapshot(companyId, this.engineId, output);
    return output;
  },
} as const;