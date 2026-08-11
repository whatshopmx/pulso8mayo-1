# Implementation Plan: Registro de Mermas — UX & data-integrity overhaul

Source critique: `.impeccable/critique/2026-08-11T17-12-38Z__app-dashboard-inventory-waste.md` (18/40)
Target: `app/dashboard/inventory/waste/`, `components/inventory/waste-form.tsx`, `app/api/inventory/waste/route.ts`

## Overview

The merma page works as a database INSERT with Spanish labels. Two classes of problem:
a **data-integrity defect** (quantities are integer-only in a kg/L kitchen, so every merma
number downstream is wrong) and a **UX/ergonomics deficit** (the page is built for one
careful entry, while the real scene is 4–8 entries at cierre de turno on a tablet).

We fix the data layer first because it is the only part that corrupts records while we
deliberate, then work outward: API correctness → ergonomics → evidence → layout → the
"Por vencer" checklist.

## Product decisions (resolved 2026-08-11)

These were open questions in the first draft; all four are now answered and planned.

1. **Page inversion → additive.** A `Por vencer` tab with a per-row quantity stepper ships
   *alongside* the blank form, which remains the path for derrame/rotura. Phase 6.
2. **Photo evidence → required by amount or motive.** Mandatory above a configurable peso
   threshold or when the motive is `DAMAGED`/`QUALITY`; optional otherwise. Phase 3.
3. **Motive vocabulary → kitchen language, enum untouched.** No enum migration; one shared
   label module serves both doors. Phase 4.
4. **Undo → anulación only.** A reversal endpoint for gerentes from the history; **no**
   30-second undo in the capture flow. Phase 3.
5. **Audience → both, stated plainly, with reciprocity.** Customer profile is owners/admins of
   3–15-branch groups professionalizing their operation, so the number *is* comparative across
   branches — `food-cost-service.ts:163-168` already groups movements by branch group-wide.
   The form therefore says so honestly, the gerente gets the same number back for their own
   branch, and reporting separates avoidable from structural causes. Task 21, Phase 4.

## Architecture Decisions

- **`numeric(12, 4)`, following existing repo precedent — not a new convention.**
  `stockCounts.countedQuantity` / `stockCountSessions.calculatedStock` already use
  `numeric(12,4)` with the rationale documented in-schema (`lib/db/schema.ts:3083`,
  "contar 2.5 kg debe guardar 2.5, no 2"; AD-6 at `:3128`). The waste path is the
  straggler. Adopting `12,4` keeps one decimal convention across inventory rather than
  the `12,3` the critique proposed.

- **The migration must include `inventoryBatches`, which the critique omitted.**
  `initialQuantity` and `currentQuantity` are `integer` (`lib/db/schema.ts:916-917`) and
  `app/api/inventory/waste/route.ts:124-132` writes `batch.currentQuantity - quantity`
  back into that column. Migrating only `inventory_waste.quantity` would let a 0.4 kg
  write-off round the *remaining stock* to a whole number — silent corruption strictly
  worse than the bug being fixed. Scope is four columns across three tables.

- **AD-6 boundaries are part of the P0, not a separate concern.** Three workflow extractors
  already receive fractional quantities and round them at the integer boundary with an
  explicit marker: `merma-from-workflow.ts:239`, `stock-count-from-workflow.ts:309`,
  `production-from-workflow.ts:216/222/272`. They reference `quantity`, not
  `quantityChange`, so a sweep filtered on the latter misses them. Phase 0 removes all
  three markers — the migration repairs the workflow door and the dashboard door at once.

- **Rejected: scaled integers (milliunits), the `costPerUnit`-in-cents pattern.**
  It avoids the string-vs-number hazard below, but introduces a second unit convention
  in a schema that already chose `numeric` for quantities, and every read site would
  need a divide. Consistency with the established precedent wins.

- **Treat Drizzle `numeric` as returning `string` until proven otherwise.** The repo's
  existing numeric columns use string defaults (`"1.00"`, `'0'`), implying string mode.
  `mode: 'number'` may exist in drizzle-orm 0.45 but the codebase does not rely on it,
  so Task 1 *verifies* this rather than assuming it. This matters more than any other
  decision here — see Risks.

- **The shared motive vocabulary derives from the inverse of an existing map.**
  `REASON_MAP` (`merma-from-workflow.ts:39`) already translates kitchen keys
  (`caducidad`/`caida`/`error_cocina`/`cortesia`) into the 7-value enum. Phase 4 extracts
  its inverse into `lib/inventory/waste-reasons.ts` so both doors render identical Spanish
  from one source, with **zero enum migration**.

- **Evidence columns are additive and nullable, so they get their own low-risk migration**
  (`0052`), kept separate from the high-risk `0051` type change.

- **No new dependency for the searchable product select.** `cmdk` is absent and shadcn's
  `Command` requires it; `popover.tsx` is present. Build the filter with Popover + Input
  over the already-fetched list.

## Dependency Graph

```
Phase 0  Schema migration (numeric) ── sweeps: writes │ aggregations │ reads
             └── Checkpoint 0: numbers still correct
Phase 1      └── Waste API (decimal + tenancy) ── Form fractional input   ← P0 closed
Phase 2           └── Trust: dead button │ remount │ receipt
Phase 3                └── Evidence migration ── photo capture
                                             └── anulación endpoint + history action
Phase 4                     └── Layout distill ── shared vocabulary ── tokens
Phase 5                          └── Polish: formatting/a11y │ deep-link + lot-selector
Phase 6                               └── "Por vencer": data ── checklist UI ── batch submit
```

---

## Phase 0 — Decimal foundation (P0)

Highest risk, so it goes first. Until this lands, every merma record written is wrong —
through **both** doors.

### Task 1: Migrate quantity columns to `numeric(12,4)`

**Description:** Change four integer columns to `numeric(12,4)` in `lib/db/schema.ts` and
hand-author the migration. Confirm how drizzle-orm 0.45 types `numeric` (string vs
`mode: 'number'`) and record the answer in the schema comment — every task after this
depends on it.

**Acceptance criteria:**
- [ ] `inventory_waste.quantity`, `inventory_movements.quantity_change`,
      `inventory_batches.initial_quantity`, `inventory_batches.current_quantity` are `numeric(12,4)`
- [ ] Migration is hand-named (`0051_merma-decimal-quantities.sql`) per repo convention, uses
      `ALTER TABLE ... TYPE numeric(12,4) USING <col>::numeric`, and is reversible on paper
- [ ] A schema comment records the JS-side type, mirroring the `:3083` precedent comment

**Verification:**
- [ ] `pnpm db:generate` produces no unexpected drift beyond these columns
- [ ] `pnpm db:migrate` applies clean; **never `db:push`** (drops tables)
- [ ] `npx tsx scripts/check-migration-drift.ts` is clean
- [ ] Spot-check in psql: existing integer rows survive as `N.0000`, no row count change

**Dependencies:** None · **Scope:** S (2 files) · **Risk: HIGH — do not batch with other work**

### Task 2: Sweep write paths, including the three AD-6 boundaries

**Description:** `quantityChange` has 43 references across 21 files, and three workflow
extractors round `quantity` separately. If Drizzle returns strings, `a + b` silently becomes
concatenation and `strict: false` will not catch it.

**Acceptance criteria:**
- [ ] `inventory-service.ts`, `receiving-service.ts`, `stock-count-service.ts`,
      `workflow-action-runner.ts`, `app/actions/inventory-transactions.ts` convert explicitly
      at the DB boundary
- [ ] **AD-6 markers removed** and fractional quantities preserved end-to-end in
      `merma-from-workflow.ts:239`, `stock-count-from-workflow.ts:309`,
      `production-from-workflow.ts:216/222/272`
- [ ] No bare `+`/`-`/comparison on a value read straight from a migrated column
- [ ] Fractional round-trip proven: write `0.4`, read back `0.4` (not `0` or a concatenation)

**Verification:**
- [ ] `pnpm run build`
- [ ] `pnpm exec playwright test tests/stock-count.spec.ts`
- [ ] Complete a merma workflow with 2.5 kg → `inventory_waste.quantity = 2.5000`, not `3`

**Dependencies:** 1 · **Scope:** M (8 files)

### Task 3: Sweep aggregation and reporting paths

**Description:** The consumers that `sum`/average/compare quantities — where a string leak
produces a plausible-looking wrong number rather than a crash. Highest chance of a silent bug.

**Acceptance criteria:**
- [ ] `food-cost-service.ts`, `kpi-calculator.ts`, `reports-service.ts`,
      `theoretical-consumption-service.ts`, `suggested-order-service.ts`,
      `operational-twin-engine.ts`, `advanced-alert-service.ts`, `knowledge-service.ts` all
      coerce before arithmetic
- [ ] SQL-side `sum()` results (Postgres returns numeric sums as string) coerced at the call site
- [ ] Merma % and food-cost variance produce identical values to pre-migration for whole-number data

**Verification:**
- [ ] `pnpm run build`
- [ ] Before/after comparison on one branch's merma % and food-cost figures — must match exactly
      for integer-only historical data

**Dependencies:** 1 · **Scope:** M (8 files)

### Task 4: Sweep API and UI read paths

**Acceptance criteria:**
- [ ] `api/inventory/movements`, `api/analytics/inventory/activity`, `api/analytics/trends`,
      `movements-client.tsx`, `inventory-activity-feed.tsx`, `stock-manager.tsx` render decimals correctly
- [ ] No `"5.0000"` or `"53"`-style concatenation artifacts in any quantity display
- [ ] Trailing zeros trimmed for display (`2.5`, not `2.5000`)

**Verification:** [ ] `pnpm run build` · movements list and activity feed render a fractional row

**Dependencies:** 1 · **Scope:** M (6 files)

### Checkpoint 0: Decimal foundation
- [ ] `pnpm run build` clean · `pnpm test:e2e` green (build first — `next dev` and `next start` share `.next`)
- [ ] Fractional quantity survives write → read → aggregate → display, through both doors
- [ ] Pre-existing integer data reports identical numbers to before
- [ ] **Human review before proceeding** — this is the irreversible part

---

## Phase 1 — API correctness

### Task 5: Decimal-safe writes + close the tenancy gap in the waste route

**Description:** `app/api/inventory/waste/route.ts` accepts `branchId` from the request body
and looks up the batch with `eq(inventoryBatches.id, batchId)` and no `companyId` filter
(`:105`) — a cross-tenant write-off, and against the repo's stated top convention.
**Found during planning; not in the critique.**

**Acceptance criteria:**
- [ ] Route uses `withTenantAuth`; `companyId`/`userId` come from the session only
- [ ] `branchId` passes through `enforceBranchScope` (GERENTE/SUPERVISOR pinned to own branch)
- [ ] Batch lookup scoped to the session tenant; cross-tenant id returns 404, not 403
- [ ] Quantity math decimal-safe; `costPerUnit`/`totalLoss` cents rounding no longer drifts a
      centavo on user-edited decimals (critique, Minor Observations)
- [ ] Returns the `{ success, data|error }` envelope via `ApiHandler`
- [ ] Server-side over-quantity error is a stable code for the form to key on (Task 6)

**Verification:**
- [ ] `pnpm run build`
- [ ] New `tests/inventory-waste.spec.ts`: fractional write-off succeeds; over-quantity rejected;
      cross-tenant batch id 404s
- [ ] Post 0.4 kg → `quantity = 0.4000` and batch stock decrements by exactly 0.4

**Dependencies:** 1 · **Scope:** S (1 file + 1 spec)

### Task 6: Fractional input in the form, validated before the destructive dialog

**Description:** `maxQuantity` is an HTML `max` only, absent from the zod schema, so
over-quantity fails *after* the user confirms an irreversible action.

**Acceptance criteria:**
- [ ] `step="0.001"` + `inputMode="decimal"` on Cantidad; `min="1"` removed
- [ ] Zod `.positive()` and `.max(maxQuantity, 'Solo quedan {N} {unidad} en este lote')`,
      failing in `FormMessage` **before** the AlertDialog opens
- [ ] Error wired to `aria-describedby`, not a native browser bubble
- [ ] `humanizeWasteError` keys on stable codes rather than English server substrings

**Verification:** [ ] 0.5 kg submits; over-lote quantity blocks at the field · spec green

**Dependencies:** 1, 5 · **Scope:** S (1 file)

### Checkpoint 1: P0 closed
- [ ] A user can log 0.5 kg end-to-end and every downstream number reflects 0.5

---

## Phase 2 — Trust and repeat-entry ergonomics (P1)

### Task 7: Remove the dead `Cancelar` button

**Acceptance criteria:**
- [ ] `waste-form.tsx:497` becomes `Limpiar` wired to `form.reset()` (preferred), or renders
      only when `onCancel` is provided
- [ ] No control adjacent to the destructive action is a no-op

**Verification:** [ ] Tab order contains no inert control · `pnpm run build`

**Dependencies:** None (parallelizable) · **Scope:** XS (1 file)

### Task 8: Kill the remount; cache the catalog

**Description:** `key={refreshKey}` (`waste-client.tsx:23`) remounts the whole grid on every
save — page flash, catalog refetch, focus dumped to `document.body`.

**Acceptance criteria:**
- [ ] The `key` remount is gone; refresh happens via state/query invalidation
- [ ] Products fetched through TanStack Query per repo convention, cached across saves
- [ ] Catalog-fetch failure surfaces `ErrorState` with retry instead of a permanently dead form
- [ ] No page flash and no disabled "Cargando productos..." on entries 2–8

**Verification:** [ ] Log 3 mermas consecutively — no flash, one products request total

**Dependencies:** None (parallelizable) · **Scope:** S (2 files)

### Task 9: Repeat-entry flow and a visible receipt

**Acceptance criteria:**
- [ ] "Guardar y registrar otra" keeps `itemId` and moves focus to Cantidad
- [ ] Focus never lands on `document.body` after a save
- [ ] "Registradas hoy: N · $X" strip with the last 5, from the existing
      `GET /api/inventory/waste` (already built, consumed by no UI today)
- [ ] Toast says "3 piezas de Jitomate", never the raw enum "3 UNIT"
- [ ] Per the anulación decision, each row links to the history rather than offering a 30s undo

**Verification:** [ ] Playwright: 4 consecutive mermas, assert focus target and tally increment
- [ ] Screen-reader pass: the save is announced

**Dependencies:** 8 · **Scope:** M (3 files)

### Checkpoint 2: Operate loop
- [ ] 6 mermas in a row without a flash, a lost focus, or re-picking the product

---

## Phase 3 — Evidence and anulación

Lands **before** layout so Phase 4 designs around the photo block and the anular affordance
rather than retrofitting them.

### Task 10: Evidence + void columns migration

**Description:** Additive, nullable, low-risk — deliberately separate from `0051`. Also adds
the photo threshold to `tenantOperatingConfig`, following the `mermaVarianceThresholdPct`
precedent (`lib/db/schema.ts:2831`).

**Acceptance criteria:**
- [ ] `inventory_waste` gains `evidence_url text`, `voided_at timestamp`,
      `voided_by text`, `void_reason text` — all nullable
- [ ] `tenant_operating_config` gains `merma_photo_required_above_cents integer` (default 50000 = $500)
- [ ] Motives that always require a photo (`DAMAGED`, `QUALITY`) live in one exported constant,
      not scattered literals
- [ ] Migration hand-named `0052_merma-evidencia-anulacion.sql`

**Verification:** [ ] `pnpm db:migrate` clean · `check-migration-drift.ts` clean · existing rows unaffected

**Dependencies:** Checkpoint 0 · **Scope:** S (2 files)

### Task 11: Persist evidence from both doors; capture it in the form

**Description:** The workflow template marks the merma photo **obligatoria** and
`merma-from-workflow.ts` parses it into `evidenceUrl` — then drops it on insert
(`:233-246`), because the column did not exist. People are being asked for a photo nobody
can see. **Found during planning; not in the critique.**

**Acceptance criteria:**
- [ ] `merma-from-workflow.ts` persists `evidenceUrl` on insert — fixes evidence loss today
- [ ] Form shows a photo field using the existing `camera-capture.tsx` + `use-photo-upload.ts`
      (R2 via `lib/r2-client.ts`, local fallback when credentials are absent)
- [ ] Photo is **required** when `totalLoss` exceeds the configured threshold or the motive is
      `DAMAGED`/`QUALITY`; optional otherwise, with the requirement stated before submit,
      never as a post-confirm failure
- [ ] Requirement enforced server-side in the POST, not only in the client
- [ ] The field appears/disappears without shifting the submit button under the user's finger

**Verification:**
- [ ] Spec: $600 loss without a photo is rejected; $100 loss without one succeeds
- [ ] Complete a merma workflow → the photo is retrievable on the record

**Dependencies:** 10 · **Scope:** M (4 files)

### Task 12: Anulación endpoint and history action

**Description:** The dialog promises "no se puede deshacer" and the API has no reversal.
Per the decision: gerente-level anulación from the history, no capture-flow undo.

**Acceptance criteria:**
- [ ] `POST /api/inventory/waste/[id]/void` restores batch stock, writes a compensating
      `inventoryMovements` row, and marks the record voided — **never deletes** (audit trail)
- [ ] Restricted to management roles via `requireRoleApi`; tenant-scoped like Task 5
- [ ] Runs in a transaction (the repo uses the `neon-serverless` WS driver precisely for this)
- [ ] Rejects double-void and a void whose stock restoration would conflict
- [ ] Voided rows are excluded from merma % and every aggregation in Task 3's file list
- [ ] Reversal is `AuditService`-logged with actor and reason
- [ ] Confirm dialog copy updated — it may now promise anulación by a gerente, accurately

**Verification:**
- [ ] Spec: void restores exactly the fractional quantity; second void 409s; EMPLEADO gets 403
- [ ] Merma % before write = merma % after void

**Dependencies:** 10 · **Scope:** M (4 files)

### Checkpoint 3: Evidence and reversibility
- [ ] A merma above the threshold cannot be logged without a photo, through either door
- [ ] A mistaken merma can be undone by a gerente, and the numbers return to where they were

---

## Phase 4 — Layout, language, and tokens

### Task 13: Single-column form; retire the glossary

**Acceptance criteria:**
- [ ] `lg:grid-cols-2` → single column ~640px; `Cantidad/Unidad/Motivo` no longer collapses
      on tablet portrait
- [ ] In-form `<h3>` and the duplicate `CardDescription` deleted (three titles → one)
- [ ] Glossary card removed; each motive's one-line definition moves into its `SelectItem`
      as secondary text — at the decision, without enum keys
- [ ] "Volver al Inventario" removed (duplicates sidebar and browser back)
- [ ] Layout accommodates the Task 11 photo block and the Task 9 receipt without reflow

**Verification:** [ ] 768px viewport: no horizontal collapse, form above the fold

**Dependencies:** 9, 11 · **Scope:** M (2 files)

### Task 14: Shared kitchen vocabulary for both doors

**Description:** The UI shows "Caducidad (EXPIRED)"; the glossary lists 5 motives, the select
offers 6, the enum has 7. Per the decision, the enum is **not** migrated — instead
`REASON_MAP` (`merma-from-workflow.ts:39`) gets an inverse in a shared module.

**Acceptance criteria:**
- [ ] New `lib/inventory/waste-reasons.ts` exports the enum→Spanish label map, the
      kitchen-key→enum map (moved from `merma-from-workflow.ts`), and the "is consumo, not
      merma" predicate — single source for both doors
- [ ] `merma-from-workflow.ts` imports rather than redeclares `REASON_MAP`
- [ ] No enum key is user-visible anywhere; all 7 values covered (adding the missing
      `STAFF`/`COURTESY`), so the map cannot drift from the enum again
- [ ] Labels read as kitchen language: `QUALITY` → "Error de cocina",
      `DAMAGED` → "Se cayó / se rompió"
- [ ] `STAFF`/`COURTESY` visually separated as *consumo* and suppress "Pérdida Estimada"
      (they already route to movement type `USAGE`)
- [ ] Units display as "kg"/"L"/"piezas", never `KG`/`UNIT`; copy in `messages/es.json`

**Verification:**
- [ ] `grep -E "EXPIRED|SPILLAGE|UNIT"` over the three page files returns only code, no JSX text
- [ ] A merma logged via workflow and one via the form show the same motive label in the history

**Dependencies:** 13 · **Scope:** M (4 files)

### Task 15: Warning tokens and dark mode

**Acceptance criteria:**
- [ ] `bg-amber-50 border-amber-200 text-amber-900` (`waste-form.tsx:468`) →
      `bg-warning/10 border-warning/25 text-warning-text`
- [ ] Four raw `text-amber-500/600` icons (`page.tsx:37`, `waste-client.tsx:46`,
      `waste-form.tsx:258`, dialog) → `text-warning-text`
- [ ] At most one `AlertTriangle`; page icon aligned with the inventory dashboard's `Trash2`
- [ ] Decorative icons carry `aria-hidden` (sibling `inventory/page.tsx` already does)

**Verification:** [ ] Dark mode: the loss banner is not a near-white rectangle · no raw `amber-` left

**Dependencies:** 13 · **Scope:** S (3 files)

### Task 21: State the audience, and give the number back

*Numbered late to avoid renumbering tasks already in flight; it belongs here in Phase 4.*

**Description:** The critique argues that not knowing who reads these numbers is what drives
under-reporting. Given the customer profile, the honest answer is that owners compare branches —
so the fix is transparency plus reciprocity, not reassurance. The earlier draft copy ("no sirve
para evaluar a nadie") is **rejected as false**: a gerente who later sees the comparative
dashboard would learn the form lied to them, which costs more trust than silence.

**Acceptance criteria:**
- [ ] One line near the submit states the audience and the frame — audience is the group's
      dirección, and the measure is **against the branch's target**, not a ranking of people.
      Copy lives in `messages/es.json`
- [ ] The Task 9 receipt strip also shows the branch's current merma vs its target
      (e.g. "Merma de la semana: 2.4% · meta 3.0%"), sourced from the existing
      `foodCostTargetPercent` / `mermaVarianceThresholdPct` in `tenantOperatingConfig`
- [ ] `waste-reasons.ts` (Task 14) gains an **avoidable vs. structural** grouping:
      caducidad reads as a purchasing/forecast signal, `QUALITY` as training, `SPILLAGE` as noise
- [ ] Merma reporting surfaces (`inventory/reports`, `dashboard/reports`) group by that split, so
      the owner diagnoses a cause instead of ranking branches
- [ ] `STAFF`/`COURTESY` are excluded from the evaluative number everywhere — they already route
      to movement type `USAGE`, so this is making existing truth visible
- [ ] Role visibility is explicit and enforced: ADMIN/owner sees all branches comparatively
      (already built); GERENTE/SUPERVISOR see their own branch with the same numbers and targets
      via `enforceBranchScope`; EMPLEADO sees only their own entries, never the branch cost aggregate

**Verification:**
- [ ] A GERENTE and an ADMIN viewing the same branch and period see the same merma % and target
- [ ] An EMPLEADO cannot reach branch-level cost aggregates (spec asserts 403 / omitted field)
- [ ] Reports separate avoidable from structural for a branch with mixed motives
- [ ] The on-form line is true as written — re-read it against what the dashboards actually expose

**Dependencies:** 9, 14 · **Scope:** M (4–5 files)

### Checkpoint 4: Coherence
- [ ] Light and dark both legible; nothing on screen names a database enum; both doors speak alike
- [ ] The person logging a merma can say who will see it and how it will be judged — and is right

---

## Phase 5 — Polish

### Task 16: Formatting, a11y, and touch targets

**Acceptance criteria:**
- [ ] Currency via `Intl.NumberFormat('es-MX')` — `$12,450.00`, not `$12450.00`
- [ ] Dates pass `'es-MX'` explicitly (matches `expiration-report.tsx`; today an English-locale
      tablet shows `3/15/2026` beside the report's `15 mar 2026`)
- [ ] Heading outline valid — `CardTitle` renders a real heading, no h1→h3 jump
- [ ] Inputs/triggers/buttons ≥44px; `SelectTrigger` gets `w-full` (today `w-fit` shrink-wraps
      and reflows as values change)
- [ ] `Notas` drops `resize-none`
- [ ] No-branch state uses the shared `EmptyState`

**Verification:** [ ] axe pass, 0 criticals · touch targets measured at 768px

**Dependencies:** 13, 14, 15 · **Scope:** M (4 files)

### Task 17: Wire the deep-link and adopt `lot-selector`

**Acceptance criteria:**
- [ ] Each expirations row links to `/dashboard/inventory/waste?item={id}`
- [ ] Landing via that link preselects product and FIFO-nearest lote
- [ ] `lot-selector.tsx` (FIFO-sorted, expiration-badged, already in-repo) replaces the flat
      `<Select>`, or the plan records why it did not fit
- [ ] Product select gains search via Popover + Input (no new dependency)

**Verification:** [ ] Expirations → form arrives pre-filled at the quantity step

**Dependencies:** 13 · **Scope:** M (3 files)

---

## Phase 6 — "Por vencer" checklist (the additive inversion)

The system already knows which lotes are dying, in what quantity, at what cost. This makes
the common case a confirmation instead of re-entry, without removing the blank form.

### Task 18: Expiring-lotes data for the checklist

**Acceptance criteria:**
- [ ] Reuses `/api/inventory/expirations` (extending it if needed) rather than a parallel query
- [ ] Returns per lote: item, lote, expiry, remaining quantity, unit cost, estimated loss
- [ ] Tenant- and branch-scoped via `withTenantAuth` + `enforceBranchScope`
- [ ] Excludes lotes already fully written off; ordered by expiry ascending (FIFO)

**Verification:** [ ] Spec asserts ordering and that a written-off lote disappears

**Dependencies:** Checkpoint 4 · **Scope:** S (1–2 files)

### Task 19: Checklist UI and tab shell

**Acceptance criteria:**
- [ ] `Por vencer (N)` and `Registro` tabs; `Por vencer` is the default landing tab
- [ ] Each row: product, lote, expiry ("vence hoy" / "venció ayer" in relative Spanish),
      remaining quantity, estimated loss, and a stepper prefilled to the full remaining amount
- [ ] Stepper accepts decimals and is capped at the lote's remaining quantity
- [ ] Running "N seleccionados · $X" total above the submit
- [ ] Motive defaults to `EXPIRED` **only in this tab**, where it is factually justified —
      unlike the blank form, where Task 14 removes the pre-attributed default
- [ ] Empty state ("nada por vencer") uses the shared `EmptyState`
- [ ] Rows are keyboard-navigable; targets ≥44px

**Verification:** [ ] Playwright: select 2 lotes, adjust one to a fraction, totals update
- [ ] axe pass on the tab

**Dependencies:** 18 · **Scope:** M (3–4 files)

### Task 20: Batch submit

**Acceptance criteria:**
- [ ] One endpoint writes N mermas **in a single transaction** — partial success is not possible
- [ ] Reuses the Task 5 validation path; no second copy of the stock/tenancy rules
- [ ] Photo threshold from Task 11 applies per row; the UI blocks submit naming which rows need one
- [ ] Confirm dialog restates the full batch (count, total pesos) in the voice of the existing
      dialog — the critique's highest-rated artifact
- [ ] Result reports per-row outcome; voided/failed rows are distinguishable
- [ ] Rows written this way are indistinguishable downstream from single-form rows

**Verification:**
- [ ] Spec: 3-lote batch decrements all 3 stocks exactly; an induced failure on row 2 rolls back all 3
- [ ] Merma % moves by exactly the batch total

**Dependencies:** 19, 11 · **Scope:** M (2–3 files)

### Checkpoint 5: Complete
- [ ] `pnpm run build` + `pnpm run lint` clean · `pnpm test:e2e` green against a build
- [ ] Cierre de turno path: land on `Por vencer`, tick 3 lotes, submit once
- [ ] Re-run `/impeccable` — expect a materially higher score; treat any regression as a defect

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Drizzle returns `numeric` as `string`; `strict: false` hides it. `"5" + "3" = "53"` in aggregations | **High** — silently wrong KPIs, no crash | Tasks 2–4 sweep all files by subsystem; Checkpoint 0 compares pre/post numbers on integer data before anything else ships |
| Migration applied to a DB the journal disagrees with | High | `check-migration-drift.ts` before and after; this repo has `repair-migration-journal.ts` because drift is a known recurring problem here |
| `inventory_batches` migration missed → stock rounds on fractional write-off | High | Explicitly in Task 1 scope; Task 5 verification asserts a 0.4 decrement |
| Photo requirement pushes under-reporting, the exact failure the critique warns about | Medium | Threshold is configurable per tenant and starts at $500; small mermas stay frictionless. Revisit with real data after Phase 3 |
| Telling gerentes plainly that dirección compares branches suppresses reporting instead of building trust | Medium | Task 21 ships disclosure **and** reciprocity together — own-branch numbers vs target, plus cause attribution that routes caducidad to purchasing rather than kitchen discipline. Monitor per-branch reported volume after Phase 4 |
| Two write paths (single + batch) drift apart on validation | Medium | Task 20 explicitly reuses the Task 5 path; a second copy of the rules is a review failure |
| Anulación restores stock into a lote that has since moved | Medium | Task 12 rejects conflicting restorations rather than forcing them |
| Playwright specs share the real dev DB serially and clobber each other | Medium | Tag rows `[E2E]`, clean via `tests/support/db.ts`; run against a build, not `next dev` |
| Layout work redone after the photo field lands | Medium | Phase 3 deliberately precedes Phase 4 |

## Parallelization

- **Strictly sequential:** Task 1 → 2/3/4 → Checkpoint 0. One migration, one shared schema.
- **Safe to parallelize after Checkpoint 0:** Task 7 (isolated), Tasks 8 and 15 (different files),
  Task 12 (endpoint) alongside Task 11 (form) once Task 10 lands.
- **Needs coordination:** Tasks 13–15 all edit `waste-form.tsx`; run in order, not concurrently.
- **Phase 6 is cleanly separable** — a second agent can take 18–20 once Checkpoint 4 passes.

## Open questions

None blocking. All five product decisions are resolved and planned.

**Watch item for after Phase 4:** the honest disclosure in Task 21 is the right call, but it is
still a bet — telling gerentes plainly that dirección compares branches could suppress reporting
rather than build trust, if the reciprocity half (own-branch numbers, cause attribution) is
weak or lands late. Ship Task 21 as a whole, never the disclosure line alone, and re-check
reported merma volume per branch in the weeks after. A sustained drop is the signal to revisit.
