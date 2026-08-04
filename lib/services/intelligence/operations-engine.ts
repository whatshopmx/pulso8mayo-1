/**
 * OperationsEngine — Sprint 2 Track A Task 1 (v2 §7).
 *
 * IntelligenceEngine facade over the EXISTING operational aggregators. It does
 * NOT recompute anything — it delegates to `CrossBranchService`,
 * `analytics-service.getExecutiveSummary`, the cached `operational_twins` rows
 * (kept fresh by the every-15-min recalculate-executive-twin cron), and
 * `CrossBranchService.getBenchmarking`,
 * then normalizes the result into an `EngineOutput` (+ structured extensions).
 *
 * Scope-aware: accepts an optional `AccessContext`. When present, the analysis
 * is restricted to branches visible to that actor via `branchVisibilityFilter`
 * (Pilar 4) and the snapshot is NOT persisted (consistent with
 * `ExecutiveTwinEngine.recalculate` scoped semantics). When absent, the
 * groupWide result is persisted into
 * `corporate_twins.executive_state.engineSnapshots.operations` on `refresh()`.
 *
 * Source: docs/pulso-executive-os-v2.md §7 (Sprint 2 — Intelligence Engines I)
 *         docs/pulso-executive-os-security.md §10 (cross-cutting).
 */
import { db } from "@/lib/db";
import { branches, operationalTwins } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { CrossBranchService } from "@/lib/services/cross-branch-service";
import { getExecutiveSummary } from "@/lib/services/analytics-service";
import { ExecutiveTwinEngine } from "@/lib/services/executive-twin-engine";
import { branchVisibilityFilter } from "@/lib/rbac/branch-visibility";
import type { AccessContext } from "@/lib/rbac/abac";
import type {
  EngineOutput,
  IntelligenceEngine,
  Priority,
  Risk,
} from "./types";

const CLAMP = (n: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, Math.round(n)));

/** Per-branch operational health snapshot (structured extension). */
export interface BranchHealthEntry {
  branchId: string;
  branchName: string;
  healthScore: number;
  driftScore: number;
  completionRate: number;
  activeIncidents: number;
  criticalIncidents: number;
}

export interface BranchMetricRanking {
  label: string;
  unit: string;
  higherIsBetter: boolean;
  rankings: { branchId: string; branchName: string; value: number }[];
}

export interface BenchmarkComparison {
  metrics: BranchMetricRanking[];
  bestPractice:
    | { branchId: string; branchName: string; summary: string; factors: string[] }
    | null;
  worstPractice:
    | { branchId: string; branchName: string; summary: string; factors: string[] }
    | null;
}

export interface OperationsEngineOutput extends EngineOutput {
  executionCapacity: number;
  operationalRisk: number;
  branchHealth: BranchHealthEntry[];
  benchmarkComparison: BenchmarkComparison | null;
  alerts: {
    criticalIncidents: number;
    overdueWorkflows: number;
    lowStockItems: number;
    expiringBatches: number;
  };
}

export interface OperationsEngineInput {
  companyId: string;
  ctx?: AccessContext;
}

function toRanking(
  m: BranchMetricRanking["rankings"][number],
): BranchMetricRanking["rankings"][number] {
  return m;
}

export const OperationsEngine: IntelligenceEngine<
  OperationsEngineInput,
  OperationsEngineOutput
> = {
  engineId: "operations",
  engineName: "Operations Engine",

  async analyze(input: OperationsEngineInput): Promise<OperationsEngineOutput> {
    const { companyId, ctx } = input;

    // 1. Resolve visible branches (Pilar 4 scoping when an actor is present).
    const allBranches = await db
      .select({
        id: branches.id,
        name: branches.name,
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

    const generatedAt = new Date();

    if (visibleBranchIds.length === 0) {
      return {
        score: 0,
        confidence: 0,
        insights: ["Sin sucursales visibles para este actor."],
        priorities: [],
        risks: [],
        generatedAt,
        executionCapacity: 0,
        operationalRisk: 0,
        branchHealth: [],
        benchmarkComparison: null,
        alerts: {
          criticalIncidents: 0,
          overdueWorkflows: 0,
          lowStockItems: 0,
          expiringBatches: 0,
        },
      };
    }

    // 2. Fan-out across the existing aggregators (facade — no recompute).
    const [compliance, incidents, summary, benchmarking, twinRows] =
      await Promise.all([
        CrossBranchService.getAllBranchesCompliance(companyId),
        CrossBranchService.getAllBranchesIncidentesActivos(companyId),
        getExecutiveSummary({
          companyId,
          userRole: ctx?.userRole ?? "SUPER_ADMIN",
          userBranchId: ctx?.userBranchId ?? null,
          // Requested scope = the visible set when no explicit branch is forced.
          requestedBranchId: null,
        }),
        CrossBranchService.getBenchmarking(companyId),
        db
          .select()
          .from(operationalTwins)
          .where(inArray(operationalTwins.branchId, visibleBranchIds)),
      ]);

    // Restrict cross-branch snapshots to the visible scope.
    const complianceScoped = compliance.filter((c) =>
      visibleBranchIds.includes(c.branchId),
    );
    const incidentsScoped = incidents.filter((i) =>
      visibleBranchIds.includes(i.branchId),
    );

    // 3. Per-branch health (from cached operational_twins — freshened by the
    //    every-15-min recalculate-executive-twin cron; the engine is a reader).
    const twinByBranch = new Map(twinRows.map((t) => [t.branchId, t]));
    const branchHealth: BranchHealthEntry[] = visibleBranchIds.map((id) => {
      const twin = twinByBranch.get(id);
      const inc = incidentsScoped.find((i) => i.branchId === id);
      const comp = complianceScoped.find((c) => c.branchId === id);
      const name =
        allBranches.find((b) => b.id === id)?.name ?? id;
      return {
        branchId: id,
        branchName: name,
        healthScore: twin?.healthScore ?? 0,
        driftScore: twin?.driftScore ?? 0,
        completionRate: comp?.completionRate ?? 0,
        activeIncidents: inc?.activeIncidents ?? 0,
        criticalIncidents: (inc?.criticalCount ?? 0) + (inc?.fatalCount ?? 0),
      };
    });

    // 4. Aggregates.
    const avgCompletion =
      complianceScoped.length > 0
        ? complianceScoped.reduce((a, c) => a + c.completionRate, 0) /
          complianceScoped.length
        : 0;
    const totalOverdue = complianceScoped.reduce(
      (a, c) => a + c.overdueWorkflows,
      0,
    );
    const incidentPenalty = incidentsScoped.reduce(
      (a, i) => a + i.criticalCount * 8 + i.warningCount * 2 + i.fatalCount * 15,
      0,
    );
    const avgDrift =
      branchHealth.length > 0
        ? branchHealth.reduce((a, b) => a + b.driftScore, 0) /
          branchHealth.length
        : 0;

    const operationalRisk = CLAMP(avgDrift * 0.6 + incidentPenalty);
    const executionCapacity = CLAMP(avgCompletion);
    // Operational health score = inverse of risk, weighted by execution capacity
    // (a group that executes on time is "healthy" even with some drift).
    const score = CLAMP(
      executionCapacity * 0.6 + (100 - operationalRisk) * 0.4,
    );

    // Confidence scales with data volume (workflows observed this period).
    const totalWorkflows = complianceScoped.reduce(
      (a, c) => a + c.totalWorkflows,
      0,
    );
    const confidence = CLAMP(Math.min(100, 30 + totalWorkflows));

    // 5. Benchmark comparison (normalized from getBenchmarking).
    const benchmarkComparison: BenchmarkComparison | null = benchmarking
      ? {
          metrics: benchmarking.metrics.map((m) => ({
            label: m.label,
            unit: m.unit,
            higherIsBetter: m.higherIsBetter,
            rankings: m.rankings
              .filter((r) => visibleBranchIds.includes(r.branchId))
              .map(toRanking),
          })),
          bestPractice: benchmarking.bestPractices
            ? {
                branchId: benchmarking.bestPractices.branchId,
                branchName: benchmarking.bestPractices.branchName,
                summary: benchmarking.bestPractices.summary,
                factors: benchmarking.bestPractices.factors,
              }
            : null,
          worstPractice: benchmarking.worstPractices
            ? {
                branchId: benchmarking.worstPractices.branchId,
                branchName: benchmarking.worstPractices.branchName,
                summary: benchmarking.worstPractices.summary,
                factors: benchmarking.worstPractices.factors,
              }
            : null,
        }
      : null;

    // 6. Insights (Spanish, narrative).
    const insights: string[] = [];
    insights.push(
      `Capacidad de ejecución del grupo: ${executionCapacity}% ` +
        `(promedio de workflows completados a tiempo en ${visibleBranchIds.length} sucursal(es)).`,
    );
    if (totalOverdue > 0) {
      insights.push(
        `Hay ${totalOverdue} workflow(s) vencido(s) en el scope visible — foco operacional inmediato.`,
      );
    }
    const criticalInc = incidentsScoped.reduce(
      (a, i) => a + i.criticalCount + i.fatalCount,
      0,
    );
    if (criticalInc > 0) {
      insights.push(
        `${criticalInc} incidente(s) crítico(s) o fatales sin resolver requieren escalamiento.`,
      );
    }
    if (benchmarkComparison?.worstPractice) {
      insights.push(
        `Sucursal con mayor oportunidad: ${benchmarkComparison.worstPractice.branchName} ` +
          `(${benchmarkComparison.worstPractice.factors.length} factor(es) de riesgo).`,
      );
    }

    // 7. Priorities.
    const priorities: Priority[] = [];
    const worst = [...branchHealth].sort((a, b) => a.healthScore - b.healthScore)[0];
    if (worst && worst.healthScore < 60) {
      priorities.push({
        id: `ops-branch-health-${worst.branchId}`,
        title: `Atender ${worst.branchName}`,
        description: `Health score ${worst.healthScore} — drift ${worst.driftScore}, ${worst.activeIncidents} incidente(s) activo(s).`,
        impact: "HIGH",
        actionUrl: `/dashboard/branch/${worst.branchId}`,
      });
    }
    if (totalOverdue > 0) {
      priorities.push({
        id: "ops-overdue-workflows",
        title: "Cerrar workflows vencidos",
        description: `${totalOverdue} workflow(s) vencido(s) en el scope visible.`,
        impact: "HIGH",
      });
    }
    if (criticalInc > 0) {
      priorities.push({
        id: "ops-critical-incidents",
        title: "Escalar incidentes críticos",
        description: `${criticalInc} incidente(s) crítico(s)/fatal(es) sin resolver.`,
        impact: "CRITICAL",
      });
    }

    // 8. Risks.
    const risks: Risk[] = incidentsScoped
      .filter((i) => i.criticalCount + i.fatalCount > 0)
      .map((i) => ({
        type: "incident-critical",
        severity: "CRITICAL",
        probability: 1,
        impactCents: 0,
        mitigation: `Resolver y hacer post-mortem en ${i.branchName}.`,
      }));

    return {
      score,
      confidence,
      insights,
      priorities,
      risks,
      generatedAt,
      executionCapacity,
      operationalRisk,
      branchHealth,
      benchmarkComparison,
      alerts: summary.alertSummary,
    };
  },

  async getLatest(companyId: string): Promise<OperationsEngineOutput | null> {
    const twin = await ExecutiveTwinEngine.getLatest(companyId);
    const snap = twin?.executiveState?.engineSnapshots?.operations;
    return (snap as OperationsEngineOutput | undefined) ?? null;
  },

  async refresh(companyId: string): Promise<OperationsEngineOutput> {
    const output = await this.analyze({ companyId });
    await ExecutiveTwinEngine.setEngineSnapshot(companyId, this.engineId, output);
    return output;
  },
} as const;