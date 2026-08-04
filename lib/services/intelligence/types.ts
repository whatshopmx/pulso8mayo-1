/**
 * Shared intelligence type contracts — Sprint 1 Task 2.
 *
 * Source: docs/pulso-executive-os-v2.md §6 (interface contracts) and §9 (schema).
 *
 * This file is TYPE-ONLY (no runtime code). It defines the contracts used by:
 *  - The 8 intelligence engines (Sprint 2) via `IntelligenceEngine<TInput,TOutput>`.
 *  - `ExecutiveTwinEngine` (Sprint 1 Task 4), which persists into `corporateTwins`.
 *  - The Executive API (`/api/executive/twin`, Task 7) and the UI (Tasks 9–10).
 *  - `MorningBriefGenerator` (Sprint 3).
 *
 * `ExecutiveTwin` intentionally mirrors the typed columns of the `corporate_twins`
 * table plus a few computed convenience fields cached in `executiveState` (cash
 * flow projection, obligations). Keep this in sync with
 * `lib/db/schema/operational-twin.ts` — if a column is added there, add it here.
 */

// ── Shared enums (unions, not enums, per v2 §6 "string literals for easy extension") ──

export type ImpactLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type SeverityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ConfidenceLevel = 'LOW' | 'MEDIUM' | 'HIGH';

/** Stable engine ids — used as `engine_outputs.engineId` discriminator. */
export type EngineId =
  | 'operations'
  | 'finance'
  | 'compliance'
  | 'labor'
  | 'inventory'
  | 'brand'
  | 'expansion'
  | 'knowledge';

// ── Executive Twin (mirror of corporate_twins + computed cache) ──

/**
 * Full Executive Twin — the "digital executive director" state for one company.
 * Persisted in `corporate_twins`. Typed columns below; `executiveState` carries
 * computed caches (14d cash projection, obligation list, per-engine snapshots).
 */
export interface ExecutiveTwin {
  id: string;
  companyId: string;

  // ── Base 3 (existing corporate twin) ──
  healthScore: number;            // 0-100
  driftScore: number;             // 0-100
  marginLeakageScore: number;     // cents-adjacent score
  networkState: Record<string, unknown>;

  // ── Sprint 1: 10 dimensions + cash/obligations ──
  projectedCashFlowCents: number;
  upcomingObligationsCents: number;
  liquidityRisk: number;          // 0-100

  operationalRisk: number;        // 0-100
  complianceRisk: number;         // 0-100
  peopleRisk: number;             // 0-100

  expansionReadiness: number;    // 0-100 (100 = best)
  executionCapacity: number;     // 0-100
  brandConsistency: number;      // 0-100
  knowledgeIndex: number;         // 0-100

  playbookCount: number;
  bestPracticesCount: number;

  /** Free-form engine cache. Shape defined by `ExecutiveState` below. */
  executiveState: ExecutiveState;

  lastUpdated: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Cached computed payload inside `corporate_twins.executive_state`.
 * Typed + open (`extra`) so engines can stash fields without a migration.
 */
export interface ExecutiveState {
  /** 14-day projected cash flow, one entry per day. */
  cashFlowProjection?: CashFlowDay[];
  /** Upcoming obligations with detail (typed column stores only the sum). */
  upcomingObligations?: Obligation[];
  /** Per-engine latest `EngineOutput` snapshot, keyed by engineId. */
  engineSnapshots?: Partial<Record<EngineId, EngineOutput>>;
  /** Branches visible to the actor — set by `branchVisibilityFilter` (Pilar 4). */
  visibleBranchIds?: string[];
  /** Last recalculation trace (duration, error?). */
  lastRecalculation?: { at: string; durationMs: number; ok: boolean; error?: string };
  [extra: string]: unknown;
}

export interface CashFlowDay {
  date: string;        // ISO date (yyyy-mm-dd)
  projectedCents: number;
  inflowCents: number;
  outflowCents: number;
}

export interface Obligation {
  id: string;
  label: string;
  amountCents: number;
  dueDate: string;    // ISO date
  type: 'PAYROLL' | 'INVOICE' | 'RENT' | 'SERVICES' | 'TAX' | 'OTHER';
  branchId?: string;
}

// ── Engine contracts (v2 §6) ──

export interface EngineOutput {
  score: number;           // 0-100
  confidence: number;      // 0-100
  insights: string[];
  priorities: Priority[];
  risks: Risk[];
  generatedAt: Date;
}

export interface Priority {
  id: string;
  title: string;
  description: string;
  impact: ImpactLevel;
  estimatedSavingsCents?: number;
  actionUrl?: string;
  deadline?: Date;
}

export interface Risk {
  type: string;
  severity: SeverityLevel;
  probability: number;     // 0-1
  impactCents: number;
  mitigation: string;
}

/**
 * Contract implemented by each of the 8 engines (Sprint 2). TOutput must be an
 * `EngineOutput` (engines may extend it with domain-specific fields).
 */
export interface IntelligenceEngine<
  TInput = { companyId: string },
  TOutput extends EngineOutput = EngineOutput,
> {
  readonly engineId: EngineId;
  readonly engineName: string;
  analyze(input: TInput): Promise<TOutput>;
  getLatest(companyId: string): Promise<TOutput | null>;
  refresh(companyId: string): Promise<TOutput>;
}

// ── Morning Brief (Sprint 3) — shape defined early so engines can populate it ──

/**
 * Daily 7AM brief for a CEO/owner. Generated by `MorningBriefGenerator`
 * (cron `0 7 * * *`) and persisted in `morning_briefs.brief` (jsonb).
 */
export interface MorningBrief {
  id: string;
  companyId: string;
  date: string;              // ISO date the brief covers
  headline: string;          // one-line summary ("Día estable. 1 riesgo crítico.")
  priorities: BriefPriority[];
  /** Narrative paragraphs in Spanish, ordered top-to-bottom. */
  sections: BriefSection[];
  /** Engine snapshots the brief was generated from (provenance). */
  twinSnapshot?: Pick<
    ExecutiveTwin,
    'healthScore' | 'operationalRisk' | 'complianceRisk' | 'liquidityRisk'
  >;
  generatedAt: Date;
  deliveredAt: Date | null;
}

export interface BriefPriority {
  rank: number;            // 1 = most important
  title: string;
  why: string;            // why it matters today
  recommendedAction: string;
  impact: ImpactLevel;
  estimatedSavingsCents?: number;
  actionUrl?: string;
  deadline?: Date;
}

export interface BriefSection {
  id: string;
  title: string;          // e.g. "Liquidez", "Operaciones", "Cumplimiento"
  body: string;          // 2-4 sentence narrative
  /** Optional supporting metrics, rendered inline. */
  metrics?: { label: string; value: string }[];
}