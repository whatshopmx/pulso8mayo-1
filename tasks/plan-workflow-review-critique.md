# Implementation Plan: Workflow Review — Critique Remediation

> **Source:** `$impeccable critique app/dashboard/workflows/review/[id]/page.tsx` (2026-08-10, 21/40)
> **Predecessor:** `plans/workflow-review-redesign-plan.md` — that plan shipped (single sticky decision bar,
> tabbed ledger, lightbox modal, flat step list) but its own phase 1 "token alignment" was implemented with
> raw `bg-emerald-*` classes, and three P1 defects were left behind.
> **Targets:** `components/workflow/workflow-review.tsx`, `app/dashboard/workflows/review/[id]/page.tsx`,
> `components/workflow/workflow-history-table.tsx`, `components/workflow/review-status-badge.tsx` (new),
> `lib/utils/score.ts` (new), `app/api/workflows/history/route.ts`, `tests/support/db.ts`.
> **Build gate:** `pnpm build` typechecks *and* lints. **Tests:** Playwright in `tests/`.

## Overview

The review surface must be unambiguous at the moment of decision (verdict shown identically in header and
decision bar), accessible to keyboard/touch reviewers (the evidence path is currently mouse-only), and closed
in history (the reviewer lands on a table that cannot show the outcome they just set). In the same pass we
enforce the design system the prior plan only half-applied: Spanish-only vocabulary on a Spanish surface,
one evidence presentation instead of three, score semantics that match the tables the reviewer trains on
daily, and OKLCH tokens instead of raw Tailwind palette — with one deliberate Operational Red accent
(the approve button) so the brand reappears where the decision happens.

## Architecture Decisions

- **`reviewStatus` is the verdict; `status` stays execution lifecycle.** The service already keeps
  `status=COMPLETED` after review (approved/rejected verdicts live in `reviewStatus`). The header badge and
  the table must both branch on `reviewStatus` *first*, falling back to `status` only while unreviewed. The
  dead `status === 'APPROVED'/'REJECTED'` branches get deleted, not fixed.
- **Score semantics come from one shared helper, token-based.** A new `scoreColorClass()` in
  `lib/utils/score.ts` (≥90 `text-success`, ≥70 `text-warning-text`, else `text-destructive`, all `font-bold`;
  `null` → `text-muted-foreground`) replaces the duplicated and divergent raw-hex logic in the history table
  and the plain mono score on the review page. Same thresholds the reviewer already uses daily.
- **Brand appears once.** The approve button becomes `variant="default"` (Operational Red), the only
  deliberate red on the surface, per DESIGN.md ("used for primary actions"). Approve-success semantics stay
  on the *result* badges (success green), not on the action.
- **Evidence collapses to one surface.** The standalone "Galería de Evidencias" card is removed; evidence
  lives only in the tabbed ledger ("Con Evidencia" tab + per-step thumbnails inside expanded steps). This
  kills the third presentation level and, with it, the hover-only AI verdict overlays — the per-step
  AI verdict already renders as a visible Alert in the expanded row.
- **Step numbers come from the canonical array.** StepDetail receives `stepNumber` derived from
  `workflow.steps.findIndex(s => s.id === step.id) + 1` (or a precomputed Map), never from the filtered
  array index. The fetched `workflow.steps` order mirrors template step creation order (steps are inserted
  in order at execution start); T8b seeds a misaligned case to prove it.
- **Reviews stay final — and the surface says so.** The server's `ALREADY_REVIEWED` 409 is a governance
  property (compliance audit trail), not a bug; keeping finality was the locked decision (2026-08-10).
  The review dialog tells the reviewer the action is definitive and recorded (Task 4). A future
  "Modificar revisión" flow with audit log is a conditional follow-up, not part of this plan.

## Decisions Locked (2026-08-10)

1. **Re-review / undo → keep finality + communicate it.** Irreversibility copy in the review dialog
   (Task 4). No schema/auth work. "Modificar revisión" is a conditional follow-up if María asks.
2. **Queue/batch review → deferred.** New page + queue query; registered in `PROJECT_CONTEXT.md`
   (media prioridad) as a follow-up.
3. **"Por Revisar" semantics → unchanged.** Operator comments stay in scope — in HORECA they carry
   discrepancy notes that feed receiving reports. If the queue overflows in production, add a
   "Solo fallas de verificación" toggle (a checkbox, not a redesign).
4. **Approve accent → Operational Red solid; reject outline destructive.** Consistent with DESIGN.md
   ("used for primary actions") and the app's own button language; the fill + ✓/✗ icons carry the
   distinction. Green stays exclusively on the *result* badge.
5. **Dashboard `recent-workflows-table` → deferred, but the badge is reusable.** Task 3 extracts
   `components/workflow/review-status-badge.tsx`; the history table consumes it and the dashboard
   becomes a 2-line import in a follow-up (registered in `PROJECT_CONTEXT.md`, baja prioridad).

## Dependency Graph

```
T1 history API +reviewStatus ──► T3 history table (badge, /review link, score helper)
T2 scoreColorClass helper ─────► T3 (table) ──► T4 (review summary)
T4 verdict + score + tokens ──► T5 Spanish + evidence distill ──► T6 a11y evidence path
                                                                    │
T7 page.tsx polish (independent, parallel-safe) ────────────────────┤
                                                                    ▼
                                                    T8a decision-loop e2e ──► T8b numbering + keyboard e2e
```

## Task List

---

### Phase 1: History closes the loop

#### Task 1: History API exposes review state
**Description:** `GET /api/workflows/history` currently cannot tell a reviewed execution from an
unreviewed one. Add `reviewStatus` and `reviewedAt` to the select in
`app/api/workflows/history/route.ts` (columns already exist: `schema.ts:81-83`). Response shape otherwise
unchanged — adding fields is additive for every consumer.

**Acceptance criteria:**
- [ ] `GET /api/workflows/history` returns `reviewStatus` (`"APPROVED" | "REJECTED" | null`) and `reviewedAt` per row
- [ ] Approval/rejection written via the PATCH route is reflected in the next history fetch
- [ ] Unreviewed rows return `reviewStatus: null`, no behavior change for existing fields

**Verification:**
- [ ] `pnpm build` succeeds
- [ ] Manual: patch an execution to APPROVED, fetch history, assert `reviewStatus` present

**Dependencies:** None

**Files likely touched:** `app/api/workflows/history/route.ts`

**Estimated scope:** Small (1 file)

#### Task 2: Shared score-color helper (tokens)
**Description:** Extract the score threshold coloring — duplicated today between
`workflow-history-table.tsx` (`getScoreColor`, raw `green-600`/`yellow-600`/`red-600`) and
`components/dashboard/recent-workflows-table.tsx` (same with `emerald`/`amber`) — into
`lib/utils/score.ts` exporting `scoreColorClass(score: number | null): string`. Tokens only:
≥90 `text-success font-bold`, ≥70 `text-warning-text font-bold`, else `text-destructive font-bold`,
`null` → `text-muted-foreground`. The `warning-text` token exists for exactly this contrast case
(globals.css comment: amber-as-text failed AA on tints).

**AC:**
- [ ] `scoreColorClass` exported from `lib/utils/score.ts`, typed, no raw Tailwind palette classes
- [ ] Thresholds match existing behavior exactly: ≥90 green, ≥70 amber, else red, all bold
- [ ] `rg "text-(green|yellow|red|emerald|amber)-[0-9]+" lib/utils` → empty for the helper

**Verification:**
- [ ] `pnpm build` succeeds

**Dependencies:** None

**Files likely touched:** `lib/utils/score.ts` (new)

**Estimated scope:** Small (1 file)

#### Task 3: History table shows the verdict and links to it
**Description:** `WorkflowHistoryTable` gets `reviewStatus`/`reviewedAt` on its item interface (fed by T1)
and renders a verdict badge on reviewed rows via a new shared `ReviewStatusBadge` component
(`components/workflow/review-status-badge.tsx`: "Aprobado" — `Badge variant="success"`; "Rechazado" —
`variant="destructive"`) adjacent to the existing status badge — extracting it now costs nothing and makes
the deferred dashboard follow-up a 2-line import. The primary "Ver" action routes reviewed rows to
`/dashboard/workflows/review/${id}` (where the verdict and evidence live) and keeps routing unreviewed rows
to `/execute`. The score cell switches to `scoreColorClass` from T2 — same thresholds, fixed dark-mode
contrast. The `?revisada` highlight (`data-revisada`, scroll-into-view) stays untouched.

**Acceptance criteria:**
- [ ] Reviewed row shows the verdict badge; unreviewed row shows no verdict badge
- [ ] Verdict badge rendered by the shared `ReviewStatusBadge` component (reusable outside this table)
- [ ] "Ver" on a reviewed row opens the review page; on an unreviewed row opens execute (unchanged)
- [ ] Score cell uses `scoreColorClass`; `getScoreColor` local copy deleted
- [ ] `?revisada=<id>` highlight + scroll behavior still works after review redirect

**Verification:**
- [ ] `pnpm build` succeeds
- [ ] Manual: approve → redirected history row shows green "Aprobado", Ver opens review page
- [ ] Covered end-to-end by Task 8a

**Dependencies:** Task 1, Task 2

**Files likely touched:** `components/workflow/workflow-history-table.tsx`,
`components/workflow/review-status-badge.tsx` (new)

**Estimated scope:** Medium (2 files)

---

### Checkpoint 1 (after Tasks 1–3)
- [ ] `pnpm build` clean
- [ ] Review an execution → history row shows the outcome, "Ver" opens the review view
- [ ] `?revisada` highlight intact

---

### Phase 2: The decision surface

#### Task 4: Unambiguous verdict + score semantics + token/brand pass
**Description:** In `workflow-review.tsx`, the header badge must agree with the sticky decision bar. Branch
on `workflow.reviewStatus` first (Rechazado → destructive, Aprobado → success), fall back to
`workflow.status` only when unreviewed, and delete the dead `status === 'APPROVED'/'REJECTED'` branches
(the service never sets them). "Puntuación" uses `scoreColorClass` (T2). All raw `bg-emerald-*` /
`text-emerald-*` / `text-red-500` classes map to tokens (badge `success` variant, `text-destructive`);
the approve button becomes `variant="default"` (Operational Red — the one deliberate brand accent on the
page, per the 10–15% rule); reject stays destructive-outline. "Procesando..." gains a `Loader2` spinner.
Per the locked finality decision, the review dialog states the action is definitive and recorded
("Esta acción es definitiva y quedará registrada en el historial") — the verdict is otherwise irreversible.

**Acceptance criteria:**
- [ ] A rejected execution renders destructive "Rechazado" in the header *and* "Rechazado" in the sticky bar — never green "Completado" at the same time
- [ ] Score renders threshold-colored (80% amber, 95% green, 45% red) instead of plain mono
- [ ] `rg "bg-emerald|text-emerald|text-red-500" components/workflow/workflow-review.tsx` → empty
- [ ] Approve button is the only Operational Red primary accent on the page
- [ ] "Procesando..." shows a spinner
- [ ] Review dialog says the action is definitive and recorded (finality decision)

**Verification:**
- [ ] `pnpm build` succeeds
- [ ] Manual: reject a seeded execution — screenshot header + sticky bar; light and dark mode
- [ ] Screen-reader spot check: badge text reads "Rechazado", not "Completado"

**Dependencies:** Task 2

**Files likely touched:** `components/workflow/workflow-review.tsx`

**Estimated scope:** Medium (1 file)

#### Task 5: Spanish vocabulary + single evidence surface
**Description:** Remove the last English tokens from the surface ("AI Verified" → "Verificado por IA",
"AI Fail" → "Requiere revisión", tab "AI Verified" → "Verificados por IA"; the "Verificación AI" summary
card and step "Análisis de Inteligencia Artificial" are already Spanish). Delete the standalone
"Galería de Evidencias" card entirely: evidence now appears only inside the tabbed ledger ("Con Evidencia"
tab + per-step thumbnails in expanded rows), so the page stops repeating the same images at three zoom
levels. The gallery's renumbered-caption bug (`Paso {index + 1}` over a filtered index) dies with it.
Expose step number once, computed from the canonical array (per-step row badges and dialog), never from a
filtered index — this also fixes the P2 renumbering issue for every tab at once.

**Acceptance criteria:**
- [ ] `rg -i "ai verified|ai fail|galer" components/workflow/workflow-review.tsx` → empty
- [ ] One evidence presentation level remains (ledger), not three
- [ ] Filtered tabs ("Por Revisar", "Con Evidencia", "Verificados por IA") show "Paso N" with N = true position in the workflow (verified with a step filtered out of the middle)
- [ ] Workspace still compiles with the AI summary card + tab counts intact

**Verification:**
- [ ] `pnpm build` succeeds
- [ ] Covered by Task 8b (numbered tab with misaligned seed)
- [ ] Manual: review a 5-step workflow with only step 3 failing → "Por Revisar" shows "Paso 3"

**Dependencies:** Task 4 (same file, sequential to avoid edit collisions)

**Files likely touched:** `components/workflow/workflow-review.tsx`

**Estimated scope:** Medium (1 file)

#### Task 6: Keyboard/touch evidence path
**Description:** The evidence — the core content of this surface — is currently unreachable without a
mouse: expandable step rows and all thumbnails are `div`s with `onClick`; AI verdicts live in hover-only
overlays; the preview dialog strips step context. Convert step rows and thumbnails to real `<button>`
semantics (or `role="button"` + `tabIndex={0}` + Enter/Space handler + `aria-expanded`/`aria-controls`).
The per-step AI verdict no longer depends on hover (the expanded-row Alert already renders it; keep a small
always-visible badge on step rows). The preview dialog carries step title + "Paso N" + verdict summary in
its `DialogDescription`. Add `loading="lazy"` to gallery/per-step images (R2 on slow branch networks) and
turn "Descargar" into an `<a href download>` (new-tab fallback retained).

**Acceptance criteria:**
- [ ] Tab reaches every step row and thumbnail; Enter/Space expands a row and opens the dialog; `aria-expanded` toggles correctly
- [ ] Preview dialog announces step title and number, not a bare "Vista Previa de Evidencia"
- [ ] Touch users can read the verdict without hovering (row badge), images load lazily
- [ ] Descargar is a real download anchor

**Verification:**
- [ ] `pnpm build` succeeds
- [ ] Manual: keyboard-only walkthrough (Tab → Enter → Space) of expand + evidence + dialog
- [ ] Covered by Task 8b

**Dependencies:** Task 5 (same file, sequential)

**Files likely touched:** `components/workflow/workflow-review.tsx`

**Estimated scope:** Medium (1 file)

#### Task 7: Review page shell polish (parallel-safe)
**Description:** `app/dashboard/workflows/review/[id]/page.tsx` — swap `text-red-500` → `text-destructive`,
add a "Reintentar" button to the error state that re-runs the fetch (currently fetch failure offers only
"Volver", heuristic 9: no retry), keep the existing server-message propagation and the loading state as is.

**Acceptance criteria:**
- [ ] Error text uses `text-destructive`; "Reintentar" re-fetches and clears the error on success
- [ ] Spanish server error messages still shown verbatim
- [ ] `rg "text-red-500" app/dashboard/workflows/review` → empty

**Verification:**
- [ ] `pnpm build` succeeds
- [ ] Manual: open review page with an unreachable id → error shows retry; hit retry after fixing → page loads

**Dependencies:** None (different file; can run in parallel with Tasks 4–6)

**Files likely touched:** `app/dashboard/workflows/review/[id]/page.tsx`

**Estimated scope:** XS (1 file)

---

### Checkpoint 2 (after Tasks 4–7)
- [ ] `pnpm build` clean; `rg` sweeps for raw palette / English verdict tokens are empty in touched files
- [ ] Manual light + dark pass on the review page: verdict consistent, score colored, evidence reachable by keyboard
- [ ] Human review of screenshots before proceeding to e2e

---

### Phase 3: Proof

#### Task 8a: E2E — review decision loop
**Description:** Add `seedReviewInstance`/`cleanupReviewInstance` to `tests/support/db.ts` (pattern of
`seedRecepcionInstance`, `tests/support/db.ts:231`): a `COMPLETED` instance with `score`, `review_status`
null, `completed_at`, and steps carrying `ai_result` JSONB (`{ passed, confidence, reason }`), `evidence_url`,
`comment` — one failing + evidence step, one passing step. New spec `tests/workflow-review.spec.ts` asserts
the full loop: open `/review/<id>` → header badge "Completado" + enabled decision bar; reject button disabled
until a reason is typed; reject → lands on `/history?revisada=<id>` with the row showing "Rechazado"; a
second seed approved → "Aprobado"; verify persistence via `GET /api/workflows/executions/<id>`
(`reviewStatus`, `reviewComment`).

**Acceptance criteria:**
- [ ] Approve and reject branches each end on the highlighted history row showing the verdict badge
- [ ] Reject-without-reason cannot submit (UI-disabled, dialog keeps focus)
- [ ] Persisted state verified from the API, not just the DOM
- [ ] Cleanup runs in `afterEach` so reruns are idempotent

**Verification:**
- [ ] `pnpm test:e2e tests/workflow-review.spec.ts` passes (dev server auto-starts per `playwright.config.ts`)

**Dependencies:** Tasks 1, 3, 4, 5

**Files likely touched:** `tests/workflow-review.spec.ts` (new), `tests/support/db.ts`

**Estimated scope:** Medium (2 files)

#### Task 8b: E2E — filtered-step numbering + keyboard evidence path
**Description:** Same spec file (or sibling): with step 3 of a 5-step seed failing while steps 1–2 and 4–5
pass, assert the "Por Revisar" tab's first row reads "Paso 3" (proves canonical numbering, Task 5) and the
"Todos" tab still orders 1–5. Keyboard smoke: focus step row via Tab, press Enter → expanded content visible
and `aria-expanded=true`; focus a thumbnail, Enter → dialog opens and its `DialogDescription` contains the
step title ("Paso N: …"), Task 6.

**Acceptance criteria:**
- [ ] Filtered tab numbers match true workflow position with a deliberately misaligned seed
- [ ] Keyboard-only path: Tab/Enter reaches step expansion and evidence dialog with step context
- [ ] No mouse API calls in this spec

**Verification:**
- [ ] `pnpm test:e2e tests/workflow-review.spec.ts` passes

**Dependencies:** Tasks 5, 6, 8a

**Files likely touched:** `tests/workflow-review.spec.ts`, `tests/support/db.ts`

**Estimated scope:** Medium (2 files)

---

### Checkpoint 3 (Complete)
- [ ] `pnpm build` green (typecheck + lint)
- [ ] `pnpm test:e2e tests/workflow-review.spec.ts` green
- [ ] All 7 critique priority issues + listed minors closed (see mapping below)
- [ ] Decisions locked 2026-08-10 in place; deferred follow-ups registered in `PROJECT_CONTEXT.md`
- [ ] `tasks/todo-workflow-review-critique.md` updated with status; human approves before merge

## Critique → Task Mapping

| Critique issue | Severity | Task |
|---|---|---|
| Contradictory verdict states in same viewport | P1 | T4 |
| Evidence-review path is mouse-only | P1 | T6 |
| Review loop not closed in history | P1 | T1, T3 |
| Filtered step tabs renumber steps | P2 | T5 |
| Score semantics diverge from app | P2 | T2, T4 |
| Mixed-language AI vocabulary + tripled evidence | P2 | T5 |
| Brand absent; raw palette bypasses tokens | P2 | T2, T4, T7 |
| Minors: `text-red-500`, window.open download, eager imgs, no retry, "Procesando…" no spinner | — | T4, T6, T7 |

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| `getExecution` step ordering (numbering depends on fetched array order) | Med | Steps insert in template order at execution start; T8b seeds a misaligned case to prove numbering; revisit if ordering ever changes |
| Token color shift in history table (green-600 → success token, yellow-600 → warning-text) | Low | Intended: fixes dark-mode contrast; verify light+dark screenshots at CP1/CP2 |
| Removing the gallery loses at-a-glance evidence scan | Med | Counts remain in tab labels + decision bar; per-step images inside expanded rows; "Con Evidencia" tab is the scan surface; human sign-off at CP2 |
| Seed-based e2e flakiness (auth session, branch constants) | Med | Reuse exact `tests/support/constants.ts` + `seedRecepcionInstance` patterns; idempotent cleanup in `afterEach` |
| Sequential edits to one large component (T4→T5→T6) | Low | Each task lands with its own build check; no parallel writes to `workflow-review.tsx` |
| Approve/destructive both reddish at a glance | Low | Solid fill vs outline, ✓/✗ icons, position (left/right) carry the distinction; verify screenshot at CP2 with María's eye |