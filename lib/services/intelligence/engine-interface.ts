/**
 * IntelligenceEngine interface — re-exported from the shared types module.
 *
 * Source: docs/pulso-executive-os-v2.md §6 (IntelligenceEngine interface).
 *
 * Each of the 8 engines (Sprint 2) implements this contract. Keeping the
 * canonical definition in `types.ts` (type-only) and re-exporting it here gives
 * engines a single import path that also reads well at the directory root.
 */
export type {
  IntelligenceEngine,
  EngineOutput,
  Priority,
  Risk,
  ImpactLevel,
  SeverityLevel,
  ConfidenceLevel,
  EngineId,
  ExecutiveTwin,
  ExecutiveState,
  CashFlowDay,
  Obligation,
  MorningBrief,
  BriefPriority,
  BriefSection,
} from "./types";