---
target: app/dashboard/workflows/
total_score: 11
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 4
timestamp: 2026-08-09T13-39-04Z
slug: app-dashboard-workflows
---
Method: dual-agent (A: a61e563bf88913601 · B: a500d32e10affe362)

# Critique — `app/dashboard/workflows/`

**Mode: Operate.** Five routes: index, history, review, and *two* execute routes.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 1 | Progress bar is index-based, never reaches 100% (`workflow-stepper.tsx:242`); index fetch failure renders a fully-formed dashboard of zeros (`page.tsx:80`). |
| 2 | Match System / Real World | 1 | Raw DB enums on screen — `SAFETY`, `HR`, `COMPLIANCE` (`page.tsx:270`); four different names for the same object; "Tasa de Completación" is a calque. |
| 3 | User Control and Freedom | 1 | AI verification failure is a hard stop with no retry/override/escalation (`workflow-stepper.tsx:431`); `window.location.reload()` on completion (`:459`). |
| 4 | Consistency and Standards | 1 | Two divergent execution engines; four different page shells; "Verificación AI" vs "Verificación IA". |
| 5 | Error Prevention | 1 | `LOCATION` step writes the literal string `'GPS_CAPTURED'` without calling geolocation (`workflow-executor.tsx:567`); signature promised, never captured. |
| 6 | Recognition Rather Than Recall | 2 | Reject dialog shows none of the failing steps; stepper never shows branch or assignee. |
| 7 | Flexibility and Efficiency | 1 | Export button toasts "Exportando" and does nothing (`workflow-history-table.tsx:180`); history hard-caps at 100 rows with no pagination. |
| 8 | Aesthetic and Minimalist Design | 2 | Quick Actions duplicates the sidebar; "Historial" appears 3× on one screen; review page renders Aprobar/Rechazar twice simultaneously. |
| 9 | Error Recovery | 0 | Approve/Reject returns 405 on every attempt (verified) and reports it in English to a Spanish reviewer. |
| 10 | Help and Documentation | 1 | No help affordance. Compliance steps carry no reference to what NOM-251 actually requires. |
| **Total** | | **11/40** | **Poor — major UX overhaul required** |

## Design Specificity Verdict

**Category-interchangeable. Change six nouns and this ships as a Jira plugin.**

**LLM assessment:** The index (`page.tsx:158-347`) runs the canonical 2024 B2B starter sequence in order: title row → four KPI cards with icons in rounded muted squares → a 3-up "Quick Actions" strip with `group-hover:translate-x-1` arrows → searchable card grid → recent activity. All three Quick Actions destinations are already reachable from the sidebar or from buttons 40px above them.

Three structural tells:

- **The database schema is on screen.** `page.tsx:270` renders `{cat}` directly, so an owner in Monterrey reads `SAFETY`, `INVENTORY`, `HR` in SCREAMING_SNAKE English. Not a translation bug — the absence of a product voice layer.
- **The surface can't agree what its object is called.** "Dashboard de Workflows" (`page.tsx:162`), "Historial de Workflows" (`history/page.tsx:88`), "Historial de Flujos" (`es.json`), "Flujos de Trabajo" (`breadcrumb-dynamic.tsx:18`). Three are visible simultaneously on `/workflows/history`. None is what a restaurant manager says out loud — *checklist*, *rutina*, *bitácora*.
- **Four page shells for five routes.** `p-4 lg:p-6` flex column, `container mx-auto py-8 space-y-8`, a centered h1, and two routes with no page heading at all. No shared page-header component. Nobody compared these screens side by side.

Missed product character, all cheap: no shift context (apertura/cierre/turno — how a kitchen actually segments a day); no branch identity during execution; no NOM-251/035 framing on compliance templates; a time-blind index whose top metric is literally "Pendientes **Hoy**"; and WhatsApp — DESIGN.md calls it "a first-class interface, not an add-on" — buried behind a `size="sm"` button that opens a modal containing another modal, in English.

**Deterministic scan:** `detect.mjs --json app/dashboard/workflows` → `[]`, exit 0. **This clean result is misleading and Assessment B proved why.** Four of the five routes are thin wrappers; the UI mass lives in `components/workflow/` and `components/execution/`, outside the target glob. Scanning those: 4 findings, exit 2 — three `design-system-font-size` violations in `workflow-review.tsx` (`:272` at 10px, `:672` and `:682` at 11px), all breaching the Label-Floor Rule; `:682` is a timestamp read at arm's length on a tablet, the exact case DESIGN.md:181 names. One `side-tab` hit (`draggable-step.tsx:41`) traces only to the builder — out of scope, not this surface's problem.

B also probed the engine: of 59 registered rules, only 4 run statically on `.tsx`. **There is no shadow/elevation rule and no glassmorphism rule in the static engine at all.** So the detector structurally cannot see these confirmed Flat-By-Default breaches, which I verified by hand:
- `page.tsx:259` — `hover:shadow-md` on a Card
- `page.tsx:351-352` — `shadow-xl` + `backdrop-blur-sm` glass modal
- `workflow-stepper.tsx:512` — `shadow-lg` **at rest** on the execution card, plus `border-2` doubling the 1px card rule
- `workflow-review.tsx:411` — `shadow-lg` + `backdrop-blur-md` sticky bar

No false positives in the detector output. **Exit 0 here means "narrow coverage," not "compliant."**

**Visual overlays:** None. No browser automation is exposed in this session — no `chrome-devtools` or `claude-in-chrome` tools are loaded. All 55 browser-engine rules (`low-contrast`, `tiny-text`, `text-occlusion`, `line-length`, `cramped-padding`…) went unevaluated. **Treat the visual dimension of this surface as unmeasured, not clean.**

## Overall Impression

Two of the five routes do not work. The review route's approve and reject both `PATCH /api/workflows/executions/[id]`, and that route file exports only `GET` — every approval in the product returns 405 and surfaces as a Spanish toast with an English body. The `execute/[id]` route has zero inbound links repo-wide and no auth guard, carrying 815 lines of drifted parallel behavior.

Underneath that, the real problem is that this surface was built as a file browser for workflow templates and then asked to serve as an operations dashboard. Three of its four headline numbers count *template definitions* — things that change monthly. There is no branch dimension anywhere on the index, on a product whose stated first user is an owner overseeing 15 branches.

**The single biggest opportunity:** the remediation overlay (`workflow-stepper.tsx:512-530`) is 17 lines long, buried three levels deep, and is the only place in ~2,300 reviewed lines where this product has a voice. Full-card takeover, one instruction, one button: **"Ya lo corregí."** That's a supervisor talking, not a system. Everything else should be measured against it.

## What's Working

**1. The remediation overlay (`workflow-stepper.tsx:512-530`, timer at `:814-842`).** It eliminates choice at the exact moment choice is harmful. A compliance failure is detected mid-run and the entire card is taken over — amber circle, "Acción Requerida", the specific instruction, an optional forced wait so the fix can physically happen, one button. First-person operator language. This could not have been lifted from a generic SaaS kit.

**2. The single-column execution column (`workflow-stepper.tsx:483-510`).** `max-w-md mx-auto`, one step per screen, progress dots — the correct call for a one-handed tablet in a kitchen, and it resists filling a 1024px viewport with a form. Radio/checkbox rows use `p-3` full-row hit areas with correct `htmlFor` association, so the whole row is tappable. The `h-12` "Abrir Cámara" button (`:710`) is the only properly thumb-sized element in the surface. Someone thought about the physical scene here.

**3. `StockCountConfirmSummary` (`workflow-stepper.tsx:844-939`).** The only place that shows the *consequence* of input before committing: a variance table with signed differences, a >10% alert band, and two options that name what will happen — "Sí, confirmar y generar ajustes" / "No, revisar conteo" — instead of OK/Cancel. The `blindCount` variant conditionally hides system quantity to prevent anchoring, which is a real operational insight about how counts get fudged. This is domain knowledge expressed as interface.

## Priority Issues

### [P0] Approve/Reject is completely non-functional
**What:** `review/[id]/page.tsx:71` and `:93` send `PATCH` to `/api/workflows/executions/${workflowId}`. I read that route file: it is 32 lines and exports **only `GET`**. Next.js answers 405. The thrown English string `'Failed to approve workflow'` is passed straight through as the toast `description` under a Spanish title.
**Why it matters:** The entire purpose of this route is approving compliance executions. Every approval and every rejection fails. NOM-251 audit records can never be closed — against a product whose promise is "pass regulatory audits without stress."
**Fix:** Implement `PATCH` handling `status`/`reviewComment`/`reviewedAt` with company+branch authorization. Until it exists, don't render the approval controls. Fire the success toast *after* `router.push`, and land the reviewer on the history row they just acted on — highlighted — not the top of an 8-column table. Never surface a raw thrown English string as toast copy.
**Suggested command:** `/impeccable harden`

### [P0] Three step types fabricate or fake compliance evidence
**What:** Verified by grep — `workflow-executor.tsx:567` writes the literal string `'GPS_CAPTURED'` into a compliance record; `navigator.geolocation` is never called in that file (it exists only in `labor/geolocation-verify.tsx`, unrelated). `:502-512` promises "La firma se capturará automáticamente" — no signature capture exists anywhere in the codebase. `:573-603` renders AUDIO and VIDEO as dashed drop zones with **no handlers**, while `isStepCompleteable()` requires a value that can never be set — permanent dead ends. In the live route, the equivalents ask a kitchen supervisor to type a video **URL** (`workflow-stepper.tsx:758`).
**Why it matters:** For NOM-251/035 this is worse than a missing feature — it produces a *false* audit record that will not survive an inspection.
**Fix:** Implement real `getCurrentPosition` with a visible captured coordinate, a signature canvas, and `MediaRecorder`. Until each exists, remove that step type from the builder's palette so a template can never contain an uncompletable or falsifiable step.
**Suggested command:** `/impeccable harden`

### [P1] The index answers no question an owner of 15 branches has — and one of its four numbers is wrong
**What:** All four KPIs (`page.tsx:184-188`) count *template definitions*: "Plantillas Totales", "Plantillas Activas", "Críticos" (templates flagged critical, not incidents), "Pendientes Hoy". Three change monthly. The fourth is wrong: `pending` derives from `/api/workflows/assignments`, whose route defaults `userId` to `session.user.id` and ignores `limit`. So "Pendientes Hoy" actually means "PENDING assignments belonging to me personally, no date filter" — for an owner who is never assigned checklists it reads `0` forever under the word "Hoy". The same data gates the whole "Asignaciones Recientes" block, which therefore silently doesn't exist for the primary persona. **There is no branch dimension anywhere on the page.**
**Why it matters:** DESIGN.md:250 — "design for the owner overseeing 15 branches first." Answering "which branch is behind today?" currently takes Historial → Sucursal filter → parse an 8-column table: three screens, ~6 taps.
**Fix:** Replace the four counts with today's operational truth — *Ejecuciones vencidas*, *Fallidas hoy*, *Cumplimiento hoy %*, *Sucursales sin actividad* — each linking into a pre-filtered history view. Replace "Asignaciones Recientes" with a per-branch status strip (branch · done/total · worst status), 15 rows, above the fold. Move the template grid to the builder. Delete Quick Actions.
**Suggested command:** `/impeccable shape`

### [P1] Two divergent execution engines; the unreachable one is better on two axes
**What:** Verified — `grep -rn "workflows/execute/"` across `app/` and `components/` returns **zero inbound links**. Every caller points at `[id]/execute`. Yet `execute/[id]` has no auth guard and carries 815 lines that have drifted on progress math, autosave, remediation UI, AI-failure blocking, and step-type coverage (15 types vs 11). The dead route computes progress correctly (`completed/total`); the live one computes `(currentIdx/total)*100` — a *position* that is redundant with the "Paso N de M" beside it, shows 0% on a resumable run, and never reaches 100%.
**Why it matters:** Every future fix has to be made twice or silently doesn't apply, and an unguarded client route fetching executions by ID is a data-exposure surface.
**Fix:** Delete `app/dashboard/workflows/execute/[id]/` and `components/workflow/workflow-executor.tsx`. First port over the two things it does better: completion-based progress, and navigation back to *already-completed* steps (not forward-skipping, which is a bug there).
**Suggested command:** `/impeccable distill`

### [P1] Autosave is dead code, and the toast makes it worse
**What:** Verified — `markAsUnsaved` is defined at `workflow-stepper.tsx:237` and **called from nowhere in the repo**. `setHasUnsavedChanges(true)` fires from exactly one place: the stock-count confirm at `:565`. The 30s interval only saves `if (hasUnsavedChanges)`. So typing in a Textarea, entering a number, checking boxes, or picking a date **never marks the step dirty and autosave never runs.** Meanwhile `:218` fires `toast.success("Progreso guardado automáticamente")` on that same interval — up to 40 success toasts during a 20-minute stock count, promising a save that isn't happening. `autoSaveLoading` and `lastSaved` state exist at `:163-164` and are **never rendered**: the quiet, correct "guardado hace 30 s" indicator was built, then not used.
**Why it matters:** A GERENTE gets interrupted, the tablet sleeps, the step is lost — after being told 40 times that it was saved. This is how a tablet loses to paper.
**Fix:** Call `markAsUnsaved` from every value setter. Delete the recurring success toast and render `lastSaved` as a quiet inline "guardado hace 30 s". Persist per-field.
**Suggested command:** `/impeccable harden`

### [P1] Failure is indistinguishable from emptiness, and the empty states are themselves broken
**What:** `page.tsx:80-84` — the index's only `catch` calls `console.error` and nothing else, so a failed fetch renders a complete dashboard of zeros plus "No se encontraron workflows / Crea uno desde el Constructor." The owner concludes their workflows were deleted. `workflow-history-table.tsx:350` calls `t("history.noWorkflowsFound")` — **that key does not exist in `messages/es.json`**, so the empty state of the audit-history screen literally displays `workflows.history.noWorkflowsFound`. Same at `:416` for `common.unassigned` on every unassigned row. `:338` uses the search placeholder as the card description, so the heading reads *"Historial de Flujos / Buscar flujos…"*. Filtered-empty isn't distinguished from truly-empty. And `api/workflows/history/route.ts:81` hard-caps at 100 rows with no pagination and no "mostrando 100 de N" — **silent truncation on the audit trail.**
**Fix:** Add a distinct error state with a "Reintentar" to both fetchers; add the missing i18n keys; distinguish filtered-empty with "Limpiar filtros"; paginate history with a total count; add a CI check that every `t()` key resolves against `es.json`.
**Suggested command:** `/impeccable harden`

## Cognitive Load — 7 of 8 checks fail (critical)

| Check | Result | Evidence |
|---|---|---|
| Single focus | **FAIL** | Five co-equal regions on the index; the eye's first stop is `text-3xl font-bold` template counts — the least actionable content on the page. |
| Chunking (≤4) | **FAIL** | History filters: **8 controls in one grid**. History table: **8 columns**. Review: 6 stacked cards + sticky bar. |
| Grouping | **FAIL** | "Historial" in 3 places on one screen (`page.tsx:170,210,325`); Aprobar/Rechazar rendered **twice in the same viewport** (`workflow-review.tsx:391-407` and `:417-435`). |
| Visual hierarchy | **FAIL** | The loudest element is an inert count; the actual work — `Iniciar` — is a `size="sm"` button at the bottom of a card. |
| One thing at a time | PARTIAL | Pass for the stepper's `max-w-md` single step. Fail for the executor, which shows progress + full step tab strip + current step at once. |
| Minimal choices (≤4) | **FAIL** | See below. |
| Working memory | **FAIL** | The reviewer must carry *why* a step failed from the "Por Revisar" tab into a modal that shows none of it. A GERENTE must remember which branch scope is active — the stepper never displays it. |
| Progressive disclosure | PARTIAL | `StepDetail` accordion is correct. But 8 filters open at once and every template's full metadata shows simultaneously. |

**Decision points over the working-memory limit:** history filters (8), history columns (8), the executor's step-jump strip (**unbounded** — a 30-step NOM-251 checklist renders 30 wrapped jump targets), the index above the fold (6 before any content), the index template grid (**2 × N**, so 12 templates = 24 competing CTAs with no pagination), review (8: 4 tabs + 4 buttons, 2 of which duplicate the other 2).

## Emotional Journey

**Flat → confusing → one genuinely good moment → failure at the end.**

**Entry:** emotionally null. A bare spinner in `h-64` replaces the *entire page* including the header (`page.tsx:147-153`), then four counts of things nobody asked about. No greeting, no "here's what needs you today," no branch.

**Peak:** the remediation overlay. Buried three levels deep and conditional on an AI failure.

**Valley 1 — the AI rejects the photo** (`workflow-stepper.tsx:431-440`). Double punishment: a red toast *and* a persistent red panel, then Siguiente is disabled. No retry, no "tomar otra foto", no "no estoy de acuerdo", no escalation, no proceed-with-note. A supervisor at 11pm who believes the model is wrong has **no exit from the screen.** This is the exact moment the tablet goes down and the paper checklist comes back out.

**Valley 2 — steps that cannot be completed.** AUDIO and VIDEO are permanent dead ends in one engine and demand a typed URL in the other.

**The end is the worst note available.** Submitting a 30-step compliance run triggers `window.location.reload()` (`:459`) — white flash, spinner — as the reward. It lands on a warm `CompletionScreen` ("¡Workflow Completado!") whose **only button is "Actualizar Estado", which calls `window.location.reload()` again** — a button that reloads the screen you're already on. No "Volver a Flujos", no link to the record just created. Total dead end at the emotional peak. On the review path, the end is a red error toast, every time.

**Peak-end verdict: the peak is buried and conditional; the end is a failure toast or a self-reloading dead end.**

## Persona Red Flags

**Alex (impatient ADMIN, desktop, keyboard-first)**
- `page.tsx:147` — a bare spinner replaces the entire page including the header; layout jumps on resolve. No skeleton, while the inherited `app/dashboard/loading.tsx` uses proper skeletons — the surface is internally inconsistent on loading.
- `page.tsx:229-237` — search is `h-8`, not autofocused, no `/` shortcut, **not sticky**. With 60 templates he scrolls down, loses the field off-screen, scrolls back up.
- `page.tsx:114-116` — no branch selector on the page; if his session has no `branchId` the **only** signal is a toast *after* he clicks Iniciar. He's already committed before learning he can't.
- `workflow-stepper.tsx:804` — no Enter-to-advance, no Cmd+Enter anywhere. Every step advance is a mouse trip to the footer.
- `workflow-history-table.tsx:180-182` — `handleExport` toasts "Exportando" and does nothing. A placebo button on the one screen a power user needs for reporting; fastest possible way to lose his trust in everything else.
- `workflow-stepper.tsx:218` — a success toast every 30 seconds, stacking over his work.

**Sam (screen reader / keyboard-only)** — Assessment B's sweep found **zero `aria-label`, `sr-only`, `alt=`, or `role=` attributes in the entire target directory.**
- `page.tsx:350-362` — hand-rolled modal: no `role="dialog"`, no `aria-modal`, **no focus trap, no focus return, no Escape, no backdrop dismiss.** Sam tabs straight through into the page behind it. The codebase has a correct `Dialog` primitive (used at `workflow-review.tsx:439`); it just wasn't used here.
- `page.tsx:355` — close control is `<Button>✕</Button>`, 28×28px, announced as "✕". Fails WCAG 2.5.5 and has no accessible name.
- `workflow-stepper.tsx:917-935` — the stock-count confirmation "radios" are `<div onClick>` with a fake radio drawn from nested divs. No `role`, no `aria-checked`, no `tabIndex`, no key handler. **Sam physically cannot confirm a stock count** — the highest-consequence yes/no in the product.
- `workflow-review.tsx:537-540` — every accordion header is a `<div onClick>` with `select-none`. The entire disclosure mechanism of the review screen is keyboard-inaccessible. Evidence thumbnails (`:242`, `:620`) are the same, so the evidence cannot be inspected by keyboard.
- `workflow-history-table.tsx:162` — pass/warn/fail conveyed by text color alone.

**GERENTE (branch ops manager, tablet, hot kitchen, constantly interrupted)** — the project-specific persona from PRODUCT.md
- **The page doesn't answer her question.** She opens `/workflows` to learn whether her branch passed apertura. She gets four counts of template definitions and no branch anywhere. Answering takes 3 screens and ~6 taps while something is on the stove.
- **Touch targets fail throughout.** `Iniciar` and `Compartir` are `size="sm"` = **32px**, side by side with `gap-2` (8px). Below the 44px minimum **and adjacent** — with wet or gloved hands, "Compartir" (which writes a DB record and opens two stacked modals) is one mis-tap from "Iniciar". Header buttons, history row actions, and the `h-8` search field are all the same.
- **Autosave is a lie** (see P1 above), and she's told otherwise 40 times per count.
- **Resuming gives no orientation.** `:102-112` correctly resumes at the first incomplete step, but there's no "reanudado", no last-worked timestamp, no branch name, no assignee.
- **When anything breaks, it breaks in English.** `execute/[id]/page.tsx:89` prints `Failed to fetch workflow execution` in `text-red-500 text-lg`; the WhatsApp button says "Send Link"; the history empty state prints `workflows.history.noWorkflowsFound`.
- **Every non-execution screen is desktop furniture.** The 8-column history table scrolls horizontally on a 768px tablet with no card fallback.

## Minor Observations

1. `page.tsx:122-134` — "Compartir" calls `createInstance` **before** showing the modal. Every abandoned share leaves an orphan PENDING execution, which then inflates the "Pendientes" KPI reading from the same data. A read-shaped action performs a write.
2. `smart-link-generator.tsx` is **100% untranslated**: "Send Link", "Generate Smart Link", "Send via WhatsApp", "Link copied to clipboard". And the index wraps it in a hand-rolled overlay even though the component *is* a Dialog — so the product's headline WhatsApp flow is two nested modals and three clicks.
3. "Verificación AI" (`workflow-review.tsx:193`) vs "Verificación IA" (`workflow-stepper.tsx:436`). In Spanish it is *IA*. Both ship. Also `'✓ AI Verified'` / `'✗ AI Fail'` and an `AI Verified` tab.
4. `workflow-review.tsx:204,216,235` — "{n} paso(s) verificado(s)". The parenthetical `(s)` is the classic machine-translation tell; use ICU plurals.
5. `history/page.tsx:134` — **"Tasa de Completación."** A calque nobody speaks. Use "% de cumplimiento". This is exactly the bureaucratic register PRODUCT.md forbids.
6. `history/page.tsx:25-33` — the access-denied state is an unstyled centered `h1` outside the design system, no icon, no action, no way out. It reads like a government portal 403 — the precise anti-reference.
7. **One Voice Rule breached on the index.** Red appears simultaneously as brand primary on every `Iniciar`, the `Crítico` badge, the `Críticos` KPI icon, the `SAFETY` category chip, and the `FAILED` status badge. Red now means five different things on one screen, and the category palette (`:45-52`) is a six-color rainbow mapping to no semantic token in DESIGN.md.
8. `workflow-history-table.tsx:342` — the loading state spins a **`Clock` icon**. A rotating clock isn't a spinner; in an ops product it reads as "overdue". Use the `Loader2` the rest of the surface uses.
9. `workflow-stepper.tsx:487-490` — "Paso 3 de 8" and "37%" sit side by side saying the same thing, and the percentage is the less accurate of the two.
10. `review/[id]/page.tsx:33,43` — English fallbacks `'Unknown Template'` and `` `Step ${step.stepId}` `` will reach Spanish users.
11. `page.tsx:65-93` — `/api/auth/get-session` has `.catch(() => {})`, a silent swallow on the call that determines whether execution is possible at all.

## Questions to Consider

1. **If you deleted the entire template grid from the index, would an owner notice — or would the page finally answer their question?** Template management is a builder concern. What's left when the index stops being a file browser?
2. **What is the one number that should be on this screen at 7am, and the one at 11pm?** The surface is time-blind, yet apertura and cierre are the only two moments that matter in a restaurant.
3. **Who is `/dashboard/workflows` actually for?** It serves the owner (KPIs), the gerente (start a run), and the supervisor (my assignments) equally badly. Split into an owner's *branch status board* and a supervisor's *lo que sigue hoy* and does either become obvious?
4. **What should happen when a supervisor is certain the AI is wrong?** Right now: nothing. Override-with-justification that escalates? A second-photo retry? "Marcar para revisión humana"? Its absence is why the tablet loses to paper.
5. **The remediation overlay is the only place this product has a voice. What if it were the pattern rather than the exception** — full-screen takeover, one instruction, one button — for approving a review, for a failed step, for confirming a count?
6. **If an inspector asked to see the GPS coordinate and signature behind a NOM-251 record, what would you show them today?** `'GPS_CAPTURED'` and nothing. Does a step type that can't produce real evidence belong in the builder at all?
7. **Is "workflow" the right word — in any language — for a restaurant?** Four names ship today and none is what the customer says out loud.
