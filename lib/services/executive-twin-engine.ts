/**
 * ExecutiveTwinEngine — the group-level "digital executive director" state.
 *
 * Source: docs/pulso-executive-os-v2.md §6.2 (wrap, don't break) and
 *         docs/pulso-executive-os-security.md §10 (entrelazado Sprint 1).
 *
 * Responsibilities:
 *   1. `recalculate(companyId, ctx?)` — aggregate the 10 executive dimensions
 *      across branches, persist into `corporate_twins` (groupWide when no
 *      `ctx`, or return an in-memory scoped twin when an `AccessContext` is
 *      passed — Pilar 4 franchise isolation via `branchVisibilityFilter`),
 *      and emit `executive/twin.updated`.
 *   2. `getLatest(companyId)` — read the persisted row.
 *   3. `getProjectedCashFlow(companyId, days)` / `getUpcomingObligations` —
 *      delegate to `cash-flow-service` and normalize to intelligence types.
 *
 * Wrapping contract (v2 §6.2): the base 3 columns (healthScore, driftScore,
 * marginLeakageScore, networkState) are computed by the EXISTING
 * `recalculateCorporateTwin`; this engine layers the 10 new dimensions on top.
 * `processCorporateTwinUpdate` keeps working unchanged and is migrated to
 * delegate here in Task 6/8.
 *
 * Heuristic policy: every dimension is a deterministic 0–100 score derived
 * from existing services. Sprint 2's 8 engines will refine these; Sprint 1
 * ships the aggregation + persistence + event, not the final scoring model.
 */
import { db } from "@/lib/db";
import { branches, corporateTwins, operationalTwins } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { recalculateCorporateTwin } from "./operational-twin-engine";
import { CrossBranchService } from "./cross-branch-service";
import {
  getCashFlowProjection,
  type CashFlowProjection,
  type OutflowItem,
} from "./cash-flow-service";
import { inngest } from "@/lib/inngest/client";
import { branchVisibilityFilter } from "@/lib/rbac/branch-visibility";
import type { AccessContext } from "@/lib/rbac/abac";
import type {
  ExecutiveTwin,
  ExecutiveState,
  CashFlowDay,
  Obligation,
} from "./intelligence/types";

const CLAMP = (n: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, Math.round(n)));

/** Convert an OutflowItem into the intelligence `Obligation` shape. */
function toObligation(item: OutflowItem): Obligation {
  const knownCategories: Obligation["type"][] = [
    "RENT",
    "SERVICES",
    "TAX",
    "OTHER",
  ];
  const categoryType = knownCategories.includes(item.category as Obligation["type"])
    ? (item.category as Obligation["type"])
    : "OTHER";
  const type: Obligation["type"] = item.isPayroll
    ? "PAYROLL"
    : item.source === "PURCHASE_ORDER" || item.source === "PROCUREMENT_INVOICE"
      ? "INVOICE"
      : categoryType;
  return {
    id: item.id,
    label: item.description,
    amountCents: item.amountCents,
    dueDate: item.date,
    type,
  };
}

/** Map a cash-flow projection day to the intelligence `CashFlowDay`. */
function toCashFlowDay(p: CashFlowProjection["days"][number]): CashFlowDay {
  return {
    date: p.date,
    projectedCents: p.cumulativeBalanceCents,
    inflowCents: p.projectedInflowCents,
    outflowCents: p.projectedOutflowCents,
  };
}

/** Branch projection used by branchVisibilityFilter. */
function branchOwnershipRow(b: {
  id: string;
  ownershipType: "OWNED" | "FRANCHISE" | null;
  franchiseeUserId: string | null;
}) {
  return {
    id: b.id,
    ownershipType: (b.ownershipType ?? "OWNED") as "OWNED" | "FRANCHISE",
    franchiseeUserId: b.franchiseeUserId,
  };
}

interface DimensionResult {
  projectedCashFlowCents: number;
  upcomingObligationsCents: number;
  liquidityRisk: number;
  operationalRisk: number;
  complianceRisk: number;
  peopleRisk: number;
  expansionReadiness: number;
  executionCapacity: number;
  brandConsistency: number;
  knowledgeIndex: number;
  playbookCount: number;
  bestPracticesCount: number;
  state: ExecutiveState;
}

export const ExecutiveTwinEngine = {
  /**
   * Recalculate the Executive Twin for a company.
   *
   * @param ctx optional AccessContext — when present, the returned twin is
   *   scoped to the branches visible to that actor (Pilar 4) and NOT persisted
   *   (the persisted row is always the groupWide aggregate). When absent, the
   *   groupWide twin is persisted and returned.
   */
  async recalculate(
    companyId: string,
    ctx?: AccessContext,
  ): Promise<ExecutiveTwin | null> {
    const startedAt = Date.now();

    // 1. Base 3 dimensions + networkState — delegated to the existing engine
    //    so every existing caller of recalculateCorporateTwin keeps working.
    const base = await recalculateCorporateTwin(companyId);
    if (!base) return null;

    // 2. Resolve the branches this recalculation may see.
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
          allBranches.map(branchOwnershipRow),
        )
      : allBranches.map((b) => b.id);

    if (visibleBranchIds.length === 0) {
      // No visible branches for this actor — return the base twin with zeroed
      // scoped dimensions so the UI can render an "empty scope" state.
      return this.asScopedTwin(base, this.emptyDimensions());
    }

    // 3. Compute the 10 dimensions across visible branches.
    const dims = await this.computeDimensions(companyId, visibleBranchIds);

    // 4a. GroupWide (no actor) → persist the new columns + executiveState.
    if (!ctx) {
      const [persisted] = await db
        .update(corporateTwins)
        .set({
          projectedCashFlowCents: dims.projectedCashFlowCents,
          upcomingObligationsCents: dims.upcomingObligationsCents,
          liquidityRisk: dims.liquidityRisk,
          operationalRisk: dims.operationalRisk,
          complianceRisk: dims.complianceRisk,
          peopleRisk: dims.peopleRisk,
          expansionReadiness: dims.expansionReadiness,
          executionCapacity: dims.executionCapacity,
          brandConsistency: dims.brandConsistency,
          knowledgeIndex: dims.knowledgeIndex,
          playbookCount: dims.playbookCount,
          bestPracticesCount: dims.bestPracticesCount,
          executiveState: dims.state as unknown as Record<string, unknown>,
          lastUpdated: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(corporateTwins.id, base.id))
        .returning();

      // 5. Emit the unified-bus event (downstream: brief, decision feed).
      try {
        await inngest.send({
          name: "executive/twin.updated",
          data: { companyId, twinId: base.id },
        });
      } catch (err) {
        // Inngest offline in dev — non-fatal, the twin was already persisted.
        console.warn(
          "[ExecutiveTwinEngine] executive/twin.updated dispatch failed:",
          err instanceof Error ? err.message : err,
        );
      }

      return this.toExecutiveTwin(persisted ?? base, dims);
    }

    // 4b. Scoped (actor present) → in-memory twin, not persisted.
    return this.asScopedTwin(base, dims, {
      visibleBranchIds,
      durationMs: Date.now() - startedAt,
    });
  },

  /** Latest persisted groupWide twin (or null). */
  async getLatest(companyId: string): Promise<ExecutiveTwin | null> {
    const row = await db.query.corporateTwins.findFirst({
      where: eq(corporateTwins.companyId, companyId),
    });
    return row ? this.toExecutiveTwin(row) : null;
  },

  /** 14-day projected cash flow series, normalized to intelligence types. */
  async getProjectedCashFlow(
    companyId: string,
    days = 14,
  ): Promise<CashFlowDay[]> {
    const projection = await getCashFlowProjection(companyId, days);
    return projection.days.map(toCashFlowDay);
  },

  /** Upcoming obligations (payroll, invoices, rent, services) within 30 days. */
  async getUpcomingObligations(companyId: string): Promise<Obligation[]> {
    const projection = await getCashFlowProjection(companyId, 30);
    return projection.upcomingItems.map(toObligation);
  },

  // ── internals ──────────────────────────────────────────────────────────

  async computeDimensions(
    companyId: string,
    branchIds: string[],
  ): Promise<DimensionResult> {
    // Operational twins for the visible branches (drift/health).
    const twins =
      branchIds.length > 0
        ? await db
            .select()
            .from(operationalTwins)
            .where(inArray(operationalTwins.branchId, branchIds))
        : [];

    // Parallel fan-out across the existing aggregators.
    const [compliance, labor, incidents, benchmarking, cash] =
      await Promise.all([
        CrossBranchService.getAllBranchesCompliance(companyId),
        CrossBranchService.getAllBranchesLaborMetrics(companyId),
        CrossBranchService.getAllBranchesIncidentesActivos(companyId),
        CrossBranchService.getBenchmarking(companyId),
        getCashFlowProjection(companyId, 14),
      ]);

    // Restrict the cross-branch snapshots to visible branches (the aggregators
    // return company-wide; the filter narrows to the actor's scope).
    const complianceScoped = compliance.filter((c) =>
      branchIds.includes(c.branchId),
    );
    const laborScoped = labor.filter((l) => branchIds.includes(l.branchId));
    const incidentsScoped = incidents.filter((i) =>
      branchIds.includes(i.branchId),
    );

    // ── operationalRisk: avg drift + incident severity penalty ──
    const avgDrift =
      twins.length > 0
        ? twins.reduce((a, t) => a + t.driftScore, 0) / twins.length
        : 0;
    const incidentPenalty = incidentsScoped.reduce(
      (a, i) => a + i.criticalCount * 8 + i.warningCount * 2 + i.fatalCount * 15,
      0,
    );
    const operationalRisk = CLAMP(avgDrift * 0.6 + incidentPenalty);

    // ── complianceRisk: low completion + overdue workflows ──
    const avgCompletion =
      complianceScoped.length > 0
        ? complianceScoped.reduce((a, c) => a + c.completionRate, 0) /
          complianceScoped.length
        : 100;
    const totalOverdue = complianceScoped.reduce(
      (a, c) => a + c.overdueWorkflows,
      0,
    );
    const complianceRisk = CLAMP(
      (100 - avgCompletion) * 0.7 + totalOverdue * 3,
    );

    // ── peopleRisk: absence rate + overtime load ──
    const totalSessions = laborScoped.reduce(
      (a, l) => a + l.totalSessions,
      0,
    );
    const totalAbsences = laborScoped.reduce((a, l) => a + l.absenceCount, 0);
    const totalOvertime = laborScoped.reduce(
      (a, l) => a + l.totalOvertimeMinutes,
      0,
    );
    const absenceRate =
      totalSessions > 0 ? (totalAbsences / totalSessions) * 100 : 0;
    const overtimePenalty = CLAMP(totalOvertime / 60); // 1 risk point per overtime hour
    const peopleRisk = CLAMP(absenceRate * 4 + overtimePenalty);

    // ── executionCapacity: avg completion rate (operational discipline) ──
    const executionCapacity = CLAMP(avgCompletion);

    // ── brandConsistency: avg compliance score (procedure consistency) ──
    const avgComplianceScore =
      complianceScoped.length > 0
        ? complianceScoped.reduce((a, c) => a + c.avgScore, 0) /
          complianceScoped.length
        : 0;
    const brandConsistency = CLAMP(avgComplianceScore);

    // ── knowledgeIndex: derived from documented best practices ──
    const bestPracticesCount = benchmarking?.bestPractices?.factors.length ?? 0;
    const knowledgeIndex = CLAMP(20 + bestPracticesCount * 12);

    // ── cash / obligations / liquidity (cash-flow-service) ──
    const projectedCashFlowCents =
      cash.days.length > 0
        ? cash.days[cash.days.length - 1].cumulativeBalanceCents
        : 0;
    const upcomingObligationsCents = cash.upcomingItems.reduce(
      (a, i) => a + i.amountCents,
      0,
    );
    // Liquidity risk: how much of the available cash is consumed by upcoming
    // obligations, plus a sharp penalty if any projected day dips negative.
    const minBalance = cash.days.reduce(
      (m, d) => Math.min(m, d.cumulativeBalanceCents),
      Number.POSITIVE_INFINITY,
    );
    const worstLiquidity = minBalance === Number.POSITIVE_INFINITY ? 0 : minBalance;
    const obligationRatio =
      projectedCashFlowCents > 0
        ? upcomingObligationsCents / projectedCashFlowCents
        : 1;
    const liquidityRisk = CLAMP(
      obligationRatio * 60 + (worstLiquidity < 0 ? 40 : 0),
    );

    // ── expansionReadiness: composite of the capability dimensions ──
    const expansionReadiness = CLAMP(
      (100 - operationalRisk +
        100 - complianceRisk +
        100 - peopleRisk +
        executionCapacity +
        brandConsistency) /
        5,
    );

    const playbookCount = 0; // Sprint 3 (manual playbook CRUD)

    const state: ExecutiveState = {
      cashFlowProjection: cash.days.map(toCashFlowDay),
      upcomingObligations: cash.upcomingItems.map(toObligation),
      engineSnapshots: {},
      lastRecalculation: {
        at: new Date().toISOString(),
        durationMs: 0, // set by caller for scoped; groupWide leaves 0
        ok: true,
      },
    };

    return {
      projectedCashFlowCents,
      upcomingObligationsCents,
      liquidityRisk,
      operationalRisk,
      complianceRisk,
      peopleRisk,
      expansionReadiness,
      executionCapacity,
      brandConsistency,
      knowledgeIndex,
      playbookCount,
      bestPracticesCount,
      state,
    };
  },

  emptyDimensions(): DimensionResult {
    return {
      projectedCashFlowCents: 0,
      upcomingObligationsCents: 0,
      liquidityRisk: 0,
      operationalRisk: 0,
      complianceRisk: 0,
      peopleRisk: 0,
      expansionReadiness: 0,
      executionCapacity: 0,
      brandConsistency: 0,
      knowledgeIndex: 0,
      playbookCount: 0,
      bestPracticesCount: 0,
      state: {
        lastRecalculation: {
          at: new Date().toISOString(),
          durationMs: 0,
          ok: true,
        },
      },
    };
  },

  /** Coerce a Drizzle row + computed dims into the public `ExecutiveTwin`. */
  toExecutiveTwin(
    row: typeof corporateTwins.$inferSelect,
    dims?: DimensionResult,
  ): ExecutiveTwin {
    const stateRaw = (row.executiveState ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      companyId: row.companyId,
      healthScore: row.healthScore,
      driftScore: row.driftScore,
      marginLeakageScore: row.marginLeakageScore,
      networkState: row.networkState as Record<string, unknown>,
      projectedCashFlowCents: dims?.projectedCashFlowCents ?? row.projectedCashFlowCents,
      upcomingObligationsCents:
        dims?.upcomingObligationsCents ?? row.upcomingObligationsCents,
      liquidityRisk: dims?.liquidityRisk ?? row.liquidityRisk,
      operationalRisk: dims?.operationalRisk ?? row.operationalRisk,
      complianceRisk: dims?.complianceRisk ?? row.complianceRisk,
      peopleRisk: dims?.peopleRisk ?? row.peopleRisk,
      expansionReadiness:
        dims?.expansionReadiness ?? row.expansionReadiness,
      executionCapacity: dims?.executionCapacity ?? row.executionCapacity,
      brandConsistency: dims?.brandConsistency ?? row.brandConsistency,
      knowledgeIndex: dims?.knowledgeIndex ?? row.knowledgeIndex,
      playbookCount: dims?.playbookCount ?? row.playbookCount,
      bestPracticesCount:
        dims?.bestPracticesCount ?? row.bestPracticesCount,
      executiveState: (dims?.state ?? stateRaw) as ExecutiveState,
      lastUpdated: row.lastUpdated,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  },

  /** Build an in-memory scoped twin (Pilar 4) — never persisted. */
  asScopedTwin(
    base: typeof corporateTwins.$inferSelect,
    dims: DimensionResult,
    trace?: { visibleBranchIds: string[]; durationMs: number },
  ): ExecutiveTwin {
    const twin = this.toExecutiveTwin(base, dims);
    if (trace) {
      twin.executiveState = {
        ...twin.executiveState,
        visibleBranchIds: trace.visibleBranchIds,
        lastRecalculation: {
          at: new Date().toISOString(),
          durationMs: trace.durationMs,
          ok: true,
        },
      };
    }
    return twin;
  },
} as const;