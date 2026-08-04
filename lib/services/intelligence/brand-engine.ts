/**
 * BrandEngine — Sprint 2 Track A Task 3 (v2 §7).
 *
 * Facade over the EXISTING cross-branch quality/compliance aggregators. It does
 * NOT recompute — delegates to `CrossBranchService.getBenchmarking` (best/worst
 * practice + metric rankings), `CrossBranchService.getAllBranchesCompliance`
 * (per-branch quality scores), and reads ACTIVE `compliance_alerts` (quality
 * checks). recipe-service "standard compliance" is not yet exposed as a query
 * (only cost/cycle helpers ship) — tracked as TODO; the engine uses compliance
 * `avgScore` as the brand-consistency proxy today.
 *
 * Net-new (normalized to EngineOutput):
 *   - `brandDrift`: stddev of per-branch quality scores (avgScore) — the
 *     dispersion of operational standard adherence across the group. 0 = every
 *     branch executes the brand standard identically.
 *   - `bestPracticeReference`: the exemplary branch per area (from benchmarking
 *     bestPractices) — the group's internal reference to copy.
 *
 * Scope-aware: same `ctx?: AccessContext` + `branchVisibilityFilter` (Pilar 4)
 * contract as OperationsEngine; refresh() caches into
 * `corporate_twins.executive_state.engineSnapshots.brand`.
 *
 * Source: docs/pulso-executive-os-v2.md §7, docs/pulso-executive-os-security.md §10.
 */
import { db } from "@/lib/db";
import { branches, complianceAlerts } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { CrossBranchService } from "@/lib/services/cross-branch-service";
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

export interface BestPracticeReference {
  branchId: string;
  branchName: string;
  summary: string;
  factors: string[];
}

export interface BrandEngineOutput extends EngineOutput {
  brandConsistency: number;
  brandDrift: number;
  bestPracticeReference: BestPracticeReference | null;
  /** Active quality/compliance alerts (brand-standard violations). */
  activeQualityIssues: number;
}

export interface BrandEngineInput {
  companyId: string;
  ctx?: AccessContext;
}

/** Population standard deviation. */
function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, v) => a + v, 0) / values.length;
  const variance =
    values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export const BrandEngine: IntelligenceEngine<
  BrandEngineInput,
  BrandEngineOutput
> = {
  engineId: "brand",
  engineName: "Brand Engine",

  async analyze(input: BrandEngineInput): Promise<BrandEngineOutput> {
    const { companyId, ctx } = input;

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
        insights: ["Sin sucursales visibles para evaluar consistencia de marca."],
        priorities: [],
        risks: [],
        generatedAt,
        brandConsistency: 0,
        brandDrift: 0,
        bestPracticeReference: null,
        activeQualityIssues: 0,
      };
    }

    const [compliance, benchmarking, qualityAlerts] = await Promise.all([
      CrossBranchService.getAllBranchesCompliance(companyId),
      CrossBranchService.getBenchmarking(companyId),
      visibleBranchIds.length > 0
        ? db
            .select({ id: complianceAlerts.id, severity: complianceAlerts.severity })
            .from(complianceAlerts)
            .where(
              and(
                eq(complianceAlerts.companyId, companyId),
                eq(complianceAlerts.status, "ACTIVE"),
                inArray(complianceAlerts.branchId, visibleBranchIds),
              ),
            )
        : ([] as { id: string; severity: string }[]),
    ]);

    const complianceScoped = compliance.filter((c) =>
      visibleBranchIds.includes(c.branchId),
    );

    // Brand consistency = average quality (compliance avgScore) across scope.
    const avgScore =
      complianceScoped.length > 0
        ? complianceScoped.reduce((a, c) => a + c.avgScore, 0) /
          complianceScoped.length
        : 0;
    const brandConsistency = CLAMP(avgScore);

    // BrandDrift = stddev of per-branch avgScore (consistency dispersion).
    const brandDrift = CLAMP(
      stdDev(complianceScoped.map((c) => c.avgScore)),
    );

    // Best practice reference (the exemplary branch this period).
    const bestPracticeReference: BestPracticeReference | null = benchmarking
      ?.bestPractices
      ? {
          branchId: benchmarking.bestPractices.branchId,
          branchName: benchmarking.bestPractices.branchName,
          summary: benchmarking.bestPractices.summary,
          factors: benchmarking.bestPractices.factors,
        }
      : null;

    const activeQualityIssues = qualityAlerts.length;

    // Score: brand consistency penalized by drift (inconsistency) and quality
    // issues. A group with high avg quality but high drift underperforms as a
    // brand vs. a group with the same average but tight consistency.
    const driftPenalty = Math.min(40, brandDrift * 0.4);
    const issuePenalty = Math.min(20, activeQualityIssues * 2);
    const score = CLAMP(brandConsistency - driftPenalty - issuePenalty);

    const confidence = CLAMP(
      Math.min(100, 35 + complianceScoped.length * 12),
    );

    // Insights.
    const insights: string[] = [];
    insights.push(
      `Consistencia de marca del grupo: ${brandConsistency}/100 ` +
        `(promedio de calidad en ${complianceScoped.length} sucursal(es)).`,
    );
    if (brandDrift > 15) {
      insights.push(
        `Deriva de marca alta (${brandDrift} pts de desviación entre sucursales) — ` +
          `el estándar operativo no se replica de forma homogénea.`,
      );
    } else {
      insights.push(
        "Deriva de marca baja — el estándar operativo se replica de forma homogénea.",
      );
    }
    if (activeQualityIssues > 0) {
      insights.push(
        `${activeQualityIssues} alerta(s) activa(s) de calidad/cumplimiento en el scope visible.`,
      );
    }
    if (bestPracticeReference) {
      insights.push(
        `Sucursal de referencia para replicar buenas prácticas: ${bestPracticeReference.branchName}.`,
      );
    }

    // Priorities.
    const priorities: Priority[] = [];
    if (brandDrift > 20) {
      const worst = [...complianceScoped].sort((a, b) => a.avgScore - b.avgScore)[0];
      priorities.push({
        id: `brand-align-${worst?.branchId ?? "group"}`,
        title: "Alinear stray branches al estándar de marca",
        description: worst
          ? `${worst.branchName} tiene score ${worst.avgScore} vs. promedio del grupo; auditing su playbook vs. la sucursal de referencia.`
          : "Deriva de marca alta: auditar playbooks operativos vs. sucursal de referencia.",
        impact: "HIGH",
        actionUrl: worst ? `/dashboard/branch/${worst.branchId}` : undefined,
      });
    }
    if (activeQualityIssues > 0) {
      priorities.push({
        id: "brand-quality-issues",
        title: "Resolver alertas de calidad activas",
        description: `${activeQualityIssues} alerta(s) de calidad/cumplimiento sin atender.`,
        impact: "MEDIUM",
      });
    }

    // Risks — high-severity quality alerts become brand risks.
    const risks: Risk[] =
      activeQualityIssues > 0
        ? [
            {
              type: "brand-standard-drift",
              severity: brandDrift > 25 ? "HIGH" : "MEDIUM",
              probability: Math.min(1, brandDrift / 50),
              impactCents: 0,
              mitigation:
                "Auditar y re-entrenar en la sucursal con menor score; documentar el delta vs. la sucursal de referencia.",
            },
          ]
        : [];

    return {
      score,
      confidence,
      insights,
      priorities,
      risks,
      generatedAt,
      brandConsistency,
      brandDrift,
      bestPracticeReference,
      activeQualityIssues,
    };
  },

  async getLatest(companyId: string): Promise<BrandEngineOutput | null> {
    const twin = await ExecutiveTwinEngine.getLatest(companyId);
    const snap = twin?.executiveState?.engineSnapshots?.brand;
    return (snap as BrandEngineOutput | undefined) ?? null;
  },

  async refresh(companyId: string): Promise<BrandEngineOutput> {
    const output = await this.analyze({ companyId });
    await ExecutiveTwinEngine.setEngineSnapshot(companyId, this.engineId, output);
    return output;
  },
} as const;