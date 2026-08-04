# Pulso Executive OS — Sprint 1 Tasks

> **Goal:** Enriched Executive Twin with 10 dimensions, unified event bus, 8 engine contracts, and first visible UI changes.  
> **Sprint duration:** 2-3 weeks  
> **Dependency order:** Tasks MUST be completed sequentially (each depends on the prior).

---

## Phase 1: Foundation — Schema + Types

### Task 1: Enrich `corporateTwins` schema with 12 new executive columns

**Description:** Add `projectedCashFlowCents`, `liquidityRisk`, `upcomingObligationsCents`, `operationalRisk`, `complianceRisk`, `peopleRisk`, `expansionReadiness`, `executionCapacity`, `brandConsistency`, `knowledgeIndex`, `playbookCount`, `bestPracticesCount`, and `executiveState` to the existing `corporateTwins` table. All new columns must have safe defaults (0 for scores, `'{}'::jsonb` for JSON).

**Acceptance criteria:**
- [ ] `lib/db/schema/operational-twin.ts` has all 13 new columns on `corporateTwins`
- [ ] Migration generated via `pnpm db:generate` without errors
- [ ] Migration applied via `pnpm db:migrate` without data loss on existing rows
- [ ] All existing `recalculateCorporateTwin` inserts/updates still compile

**Verification:**
- [ ] `pnpm run build` succeeds
- [ ] `pnpm db:generate` produces a clean migration file
- [ ] Manual: query `SELECT * FROM corporate_twins` — all new columns present with defaults

**Dependencies:** None

**Files likely touched:**
- `lib/db/schema/operational-twin.ts`

**Estimated scope:** Small (1 file, schema-only change)

---

### Task 2: Create shared intelligence types

**Description:** Create `lib/services/intelligence/types.ts` with the core type contracts used by all engines, the executive twin, and the UI. Types: `ExecutiveTwin` (full interface matching new schema columns), `EngineOutput`, `Priority`, `Risk`, `BriefPriority`, `MorningBrief`, and the `IntelligenceEngine<TInput, TOutput>` interface.

**Acceptance criteria:**
- [ ] `ExecutiveTwin` interface matches all new `corporateTwins` columns + computed fields
- [ ] `IntelligenceEngine<TInput, TOutput>` interface has `analyze`, `getLatest`, `refresh` methods
- [ ] `EngineOutput` has `score`, `confidence`, `insights`, `priorities`, `risks`, `generatedAt`
- [ ] `Priority` has `id`, `title`, `description`, `impact` (enum), `estimatedSavingsCents`, `actionUrl`, `deadline`
- [ ] `Risk` has `type`, `severity` (enum), `probability`, `impactCents`, `mitigation`
- [ ] `MorningBrief` matches the plan document structure
- [ ] All types are `type`-only exports (no runtime code)

**Verification:**
- [ ] `pnpm run build` succeeds
- [ ] TypeScript intellisense resolves all new types

**Dependencies:** Task 1 (new columns inform the `ExecutiveTwin` interface)

**Files likely touched:**
- `lib/services/intelligence/types.ts` (NEW)

**Estimated scope:** Small (1 file, types only)

---

### Task 3: Extend domain events with new executive event types

**Description:** Extend the `DomainEventType` union and `emitDomainEvent` in `lib/services/domain-event-service.ts` with new executive event types: `EXECUTIVE_TWIN_UPDATED`, `MORNING_BRIEF_GENERATED`, `RISK_THRESHOLD_BREACHED`, `EXPANSION_OPPORTUNITY`. Also add financial events: `CASH_FLOW_UPDATED`, `BUDGET_EXCEEDED`, `PAYMENT_EXECUTED`. Add compliance events: `COMPLIANCE_SCORE_CHANGED`, `DOCUMENT_EXPIRING`, `AUDIT_DUE`. Ensure the Inngest event type in `lib/inngest/events.ts` is extended too if needed.

**Acceptance criteria:**
- [ ] `DomainEventType` union includes all ~25 event types from the plan
- [ ] Existing callers of `emitDomainEvent` still compile with no changes
- [ ] New event types are string literals (not enums) for easy extension

**Verification:**
- [ ] `pnpm run build` succeeds
- [ ] `pnpm run lint` passes
- [ ] Manual: search all `emitDomainEvent(` calls — none broken

**Dependencies:** None (can run in parallel with Tasks 1-2)

**Files likely touched:**
- `lib/services/domain-event-service.ts`
- `lib/inngest/events.ts` (if event types defined there)

**Estimated scope:** XS (1-2 files, additive change)

---

## Phase 2: Core Engine

### Task 4: Build `ExecutiveTwinEngine`

**Description:** Create `lib/services/executive-twin-engine.ts` with an `ExecutiveTwinEngine` class. It must:
1. **Recalculate** — Query all branch operational twins, aggregate the 10 executive dimensions, compute scores, persist to `corporateTwins`, emit `EXECUTIVE_TWIN_UPDATED`.
2. **getProjectedCashFlow** — Use existing `forecast-service.ts` data summed across branches for 14d projection.
3. **getUpcomingObligations** — Aggregate payroll, supplier invoices due within 30d, rent, services from `expenses` + `purchaseOrders` + `shiftSessions`.
4. **Dimension calculations** mapped as described in the plan (operationalRisk from drift scores, complianceRisk from compliance scores + expiring docs, peopleRisk from rotation + overtime, etc.).
5. **Wrap, don't break** — Call the existing `recalculateCorporateTwin` internally for the base 3 fields, then layer on the 10 new dimensions.

**Acceptance criteria:**
- [ ] `ExecutiveTwinEngine.recalculate(companyId)` returns a full `ExecutiveTwin` object
- [ ] All 10 executive dimensions computed (not just default 0)
- [ ] Result persisted to `corporateTwins` table
- [ ] `EXECUTIVE_TWIN_UPDATED` domain event emitted on successful recalculation
- [ ] `getProjectedCashFlow(companyId, 14)` returns non-null projection
- [ ] `getUpcomingObligations(companyId)` returns array of obligations with amounts
- [ ] Existing `recalculateCorporateTwin` is called internally (no regression)

**Verification:**
- [ ] `pnpm run build` succeeds
- [ ] Manual: call `ExecutiveTwinEngine.recalculate(companyId)` from a test script, inspect DB row
- [ ] Manual: verify `GET /api/executive/twin` (Task 7) returns all 10 dimensions with non-zero values

**Dependencies:** Tasks 1, 2, 3 (needs schema, types, and event types)

**Files likely touched:**
- `lib/services/executive-twin-engine.ts` (NEW)
- `lib/services/operational-twin-engine.ts` (import, no edits)

**Estimated scope:** Large (new file, ~200-300 lines of aggregation logic)

---

### Task 5: Create `IntelligenceEngine` interface + Evidence Store foundation

**Description:** Create the base engine interface file `lib/services/intelligence/engine-interface.ts` (re-export `IntelligenceEngine` from types.ts if already defined). Create the directory. Create `lib/services/evidence-store.ts` as a lightweight wrapper that unifies evidence (photos, files, voice notes) currently scattered across workflow evidence, incident evidence, and document uploads. Add AI metadata fields: `transcription`, `classification`, `verificationResult`.

**Acceptance criteria:**
- [ ] `lib/services/intelligence/` directory exists with `engine-interface.ts`
- [ ] `IntelligenceEngine` interface re-exported (implemented in types.ts from Task 2)
- [ ] `EvidenceStore` class has `store`, `getByEntity`, `getByBranch`, `attachMetadata` methods
- [ ] Evidence store uses existing R2/local storage — no new storage infrastructure

**Verification:**
- [ ] `pnpm run build` succeeds
- [ ] `EvidenceStore` methods are importable and type-check

**Dependencies:** Task 2 (types)

**Files likely touched:**
- `lib/services/intelligence/engine-interface.ts` (NEW)
- `lib/services/evidence-store.ts` (NEW)

**Estimated scope:** Medium (2 new files, evidence store ~150 lines)

---

### Task 6: Wire Inngest `recalculate-executive-twin` cron + event handler

**Description:** Create `lib/inngest/functions/recalculate-executive-twin.ts` with a new Inngest function that triggers on cron (`*/15 * * * *`) and also reacts to `domain/event.emitted` for specific event types. It calls `ExecutiveTwinEngine.recalculate(companyId)`. Also update the existing `processCorporateTwinUpdate` in `lib/inngest/functions/operational-twin.ts` to delegate to `ExecutiveTwinEngine.recalculate()` instead of raw `recalculateCorporateTwin()`.

**Acceptance criteria:**
- [ ] New Inngest function `recalculate-executive-twin` runs every 15 minutes
- [ ] Function iterates all companies and calls `ExecutiveTwinEngine.recalculate()`
- [ ] Existing `processCorporateTwinUpdate` delegates to `ExecutiveTwinEngine.recalculate()`
- [ ] Function registers in Inngest dev server (`npx inngest-cli@latest dev`)

**Verification:**
- [ ] `pnpm run dev` + Inngest Dev Server shows the new function
- [ ] Manual: trigger via Inngest UI, verify corporate twin row updated with new dimensions
- [ ] Existing corporate twin Inngest function still triggers and completes

**Dependencies:** Task 4 (needs ExecutiveTwinEngine), Task 3 (event types)

**Files likely touched:**
- `lib/inngest/functions/recalculate-executive-twin.ts` (NEW)
- `lib/inngest/functions/operational-twin.ts` (edit — delegate call)
- `lib/inngest/events.ts` (possible event type addition)

**Estimated scope:** Medium (1 new Inngest function, 1 edit)

---

## Phase 3: API + Integration

### Task 7: Build `/api/executive/twin` route

**Description:** Create the executive API routes under `app/api/executive/`. Start with `twin/route.ts` (GET returns latest from DB, POST forces refresh via `ExecutiveTwinEngine.recalculate`). Follow existing API patterns (e.g., `app/api/analytics/trends/route.ts`). Auth check with `getSession()`. Route returns typed JSON matching `ExecutiveTwin` interface.

**Acceptance criteria:**
- [ ] `GET /api/executive/twin` returns full Executive Twin (200) or null (404)
- [ ] `POST /api/executive/twin/refresh` triggers recalculation and returns updated twin
- [ ] Auth guard rejects unauthenticated requests (401)
- [ ] Response shape matches `ExecutiveTwin` TypeScript interface

**Verification:**
- [ ] `curl http://localhost:3000/api/executive/twin` returns JSON (with auth cookie)
- [ ] TypeScript compiles clean against the response type

**Dependencies:** Task 4 (needs ExecutiveTwinEngine), Task 2 (types)

**Files likely touched:**
- `app/api/executive/twin/route.ts` (NEW)
- `app/api/executive/twin/refresh/route.ts` (NEW)

**Estimated scope:** Small (2 route files, ~60 lines each)

---

### Task 8: Update `processCorporateTwinUpdate` to delegate to `ExecutiveTwinEngine`

**Description:** Modify the existing `processCorporateTwinUpdate` Inngest function in `lib/inngest/functions/operational-twin.ts` to call `ExecutiveTwinEngine.recalculate(companyId)` instead of raw `recalculateCorporateTwin(companyId)`. This ensures the new executive dimensions are computed whenever the old corporate twin flow triggers.

**Acceptance criteria:**
- [ ] `processCorporateTwinUpdate` calls `ExecutiveTwinEngine.recalculate()`
- [ ] Import path resolves correctly
- [ ] Existing `recalculateCorporateTwin` export remains for backward compat

**Verification:**
- [ ] `pnpm run build` succeeds
- [ ] Trigger `corporate/twin.recalculate` event via Inngest UI → new dimensions populated

**Dependencies:** Tasks 4, 6

**Files likely touched:**
- `lib/inngest/functions/operational-twin.ts`

**Estimated scope:** XS (1 file, 1-line change in the step.run callback)

---

## Phase 4: First UI

### Task 9: Enrich `KpiHeroCards` with new executive dimensions

**Description:** Modify `components/dashboard/executive/kpi-hero-cards.tsx` to pull from the new executive twin instead of just the old 3-field corporate twin. Add 3 new KPI cards: **Cash Available** (formatted MXN), **Operational Risk** (color-coded badge), **Compliance Score** (%, from `complianceRisk` inverted to a health score). Keep the existing Group Health card. Result: 6 cards total in 2 rows.

**Acceptance criteria:**
- [ ] KPI cards show: Group Health, Cash Available, Op. Risk, Compliance, Brand, People Risk
- [ ] Cards pull data from `ExecutiveTwinEngine.getLatest()` or the API route
- [ ] Cash amounts formatted as MXN (`$1.82M` style)
- [ ] Risk cards use color coding (green < 30, yellow 30-60, red > 60)
- [ ] Loading skeleton matches existing `KpiCardsSkeleton`

**Verification:**
- [ ] `pnpm run build` succeeds
- [ ] Manual: visit `/dashboard/executive` — 6 KPI cards visible with data
- [ ] Manual: verify loading state (skeleton) appears before data

**Dependencies:** Task 7 (API route) or Task 4 (direct service call)

**Files likely touched:**
- `components/dashboard/executive/kpi-hero-cards.tsx`
- `components/dashboard/executive/kpi-hero-cards.tsx` (types/props)

**Estimated scope:** Medium (1 component, ~80 lines of new JSX + data fetching)

---

### Task 10: Add cash flow projection mini-chart component

**Description:** Create `components/dashboard/executive/cash-flow-projection.tsx` — a client component using Recharts (already a dependency) that shows a 14-day projected cash flow bar chart. Pull data from the executive twin's `executiveState` JSON (which caches the 14-day projection). Fallback: if no projection data, show "Waiting for data" state.

**Acceptance criteria:**
- [ ] Component renders a Recharts `BarChart` with 14 data points
- [ ] X-axis: day labels (Day 1-14 or dates)
- [ ] Y-axis: MXN formatted amounts
- [ ] Component added to executive dashboard page below KPI cards
- [ ] Empty state renders gracefully (no crash, message shown)

**Verification:**
- [ ] `pnpm run build` succeeds
- [ ] Manual: visit `/dashboard/executive` — cash flow chart visible
- [ ] Manual: verify chart updates when data changes

**Dependencies:** Task 9 (placed on same dashboard page)

**Files likely touched:**
- `components/dashboard/executive/cash-flow-projection.tsx` (NEW)
- `app/dashboard/executive/page.tsx` (add import + Suspense block)

**Estimated scope:** Small (1 new component, 1 page edit)

---

## Checkpoint: Sprint 1 Complete

- [ ] All 10 tasks complete
- [ ] `pnpm run build` succeeds with zero errors
- [ ] `pnpm run lint` passes
- [ ] `pnpm db:migrate` applies without data loss
- [ ] Executive dashboard shows 6 KPI cards + cash flow chart
- [ ] Executive Twin recalculates automatically every 15 minutes via Inngest
- [ ] `/api/executive/twin` returns full typed JSON
- [ ] Zero regressions in existing corporate twin / operational twin flows

---

## Out of Scope for Sprint 1

- The 8 intelligence engines (Sprint 2)
- Morning Brief generator (Sprint 3)
- AI Reasoning layer (Sprint 3)
- Priority/Recommendation engine (Sprint 3)
- Full CEO Dashboard redesign (Sprint 4)
- Subscription tiers / billing (Sprint 5)
- Professional services workflows (Sprint 6)
