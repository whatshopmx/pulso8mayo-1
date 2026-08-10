---
target: @app/dashboard/performance/
total_score: 17
max_score: 40
na_heuristics: 
p0_count: 3
p1_count: 2
timestamp: 2026-08-10T16-09-22Z
slug: app-dashboard-performance
---
# Critique: app/dashboard/performance

⚠️ **DEGRADED: single-context (no sub-agent tool exposed in this session)**

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Searches give no feedback (they're dead); status-change toast shows raw enum ("marcada como SUBMITTED"); KPI cards flip silently from "..." to numbers |
| 2 | Match System / Real World | 2 | Mixed EN/ES ("Performance Management" vs "Evaluaciones"); same feature named Metas/Objetivos/Goals/Reviews; fabricated analytics presented as fact |
| 3 | User Control and Freedom | 2 | No undo for SUBMITTED/COMPLETED status changes; Edit buttons point to non-existent routes; no clear-filters beyond re-selecting "Todos" |
| 4 | Consistency and Standards | 1 | Headers diverge across dashboard/nav/pages; tab labels in EN while lists ES; hardcoded yellow/gray stars bypass DESIGN.md tokens; emoji in card titles |
| 5 | Error Prevention | 2 | Required-field checks exist, but criteria input is silently discarded on submit; no confirm on goal cancellation; delete uses raw `confirm()` |
| 6 | Recognition Rather Than Recall | 2 | Filters visible, but Eye/Edit actions are unlabeled icon buttons; status workflow (DRAFT→IN_PROGRESS→SUBMITTED→COMPLETED) is unexplained |
| 7 | Flexibility and Efficiency | 2 | No keyboard shortcuts, no batch actions (e.g. complete N reviews at once); the one accelerator (search) is broken |
| 8 | Aesthetic and Minimalist Design | 2 | Clean card/table baseline, but duplicated headers at 3 levels, emoji headings, off-palette colors, and a decorative mock analysis chart |
| 9 | Error Recovery | 1 | Fetch failures render "No se encontraron evaluaciones" (implies empty, not broken); "not found" is shown for records that exist but sit past page 1 |
| 10 | Help and Documentation | 1 | No empty-state guidance, no status-flow explanation, no contextual help anywhere |
| **Total** | | **17/40** | **Poor** |

## Design Specificity Verdict

**LLM assessment:** Low. This is the generic shadcn CRUD template — metric grid + tabs + table + filters + selects — applied to performance, indistinguishable from the inventory/labor/compliance screens it was copied alongside (the `metric-card.tsx` header even documents it replacing "los cards inline de labor/performance/compliance/equipment/inventory"). Nothing is authored for a Mexican HORECA operator: no branch context on any record, no person identity (initials/avatar), no overdue urgency, and zero WhatsApp tie-in despite the product positioning WhatsApp as first-class. The one screen that could be product-native — performance as a people-with-branches story — is absent.

**Deterministic scan:** `detect.mjs` returned `[]` — clean (exit 0). The detector found nothing because its heuristics scan markup/DOM patterns, and this surface's damage is mostly invisible there: dead routes, dead search params, data discarded in the submit path, and paginated KPIs. Synthesized: the visual/markup baseline is legitimate (clean cards, tokens, spacing); the failures are functional-data-flow failures that only source-level review catches.

**Visual overlays:** Not available — the browser daemon failed to restore its session (`failureCategory: validation-error`, retried with `sessionMode: fresh`, same result), and the target is auth-walled (307 → `/sign-in`; no credentials in this environment). Fallback signal: code-level review + CLI detector only.

## Overall Impression

The performance module *looks* like the rest of the app — and that's the problem. Under the standard shadcn skin, the core feature silently doesn't work: the criteria scoring card (the actual substance of an evaluation) is collected in the form and then thrown away; every Edit button points to a route that doesn't exist; both search boxes talk to an API that ignores the search param; the headline KPIs are computed from a truncated first page; and the "Analytics" tab renders hardcoded Q1–Q4 2026 numbers as if they were your team's real trend. For a tool whose entire reason to exist is giving a chain owner trusted numbers about people, this is a trust bomb. The single biggest opportunity: stop treating this as a demo of the component library and make it a real, honest performance record — one where the data you entered comes back to you.

## What's Working

- **The list tables are solid Operate surfaces.** Filters (status, type) + pagination + per-row View/Edit affordances + Spanish labels are a correct, scannable CRUD layout; the `Select`-based filters with "Todos" defaults are the right pattern.
- **The form's sectioning is good.** Basic info → criteria → written narrative → actions is a logical evaluation flow, and validation toasts for missing employee/period/title prevent silent bad submissions.
- **Tenancy is genuinely secure.** `withTenantAuth` always scopes to `auth.tenantId` and never trusts a `companyId` query param — so despite the messy `companyId=all` calls in the client, no cross-tenant data leaks.

## Priority Issues

1. **[P0] The criteria scoring card discards all user input.** `ReviewForm` collects per-criterion star ratings and comments into `criteriaRatings`, but `handleSubmit` posts `{...formData, companyId, status}` — `criteriaRatings` is never sent. The API has no schema field, no handler, and never reads `performanceReviewResponses`; the detail page never displays criteria scores. A manager who carefully rates 6 criteria and writes 6 comments believes they completed a detailed review; the system saves nothing.
   - **Why it matters:** The core content of a performance evaluation is silently void. Data loss with zero feedback is the worst failure mode for this surface.
   - **Fix:** Post `criteriaRatings` alongside the review, persist via `performanceReviewResponses` (schema exists), and render them on the detail page. Wire `weight` into an auto-computed overall score so the criteria card actually means something.
   - **Suggested command:** `$impeccable harden`

2. **[P0] Every Edit button is a dead link.** `PerformanceReviewList` routes `review.id → /reviews/${id}/edit` and `GoalsList` routes `goals/${id}/edit`; neither `reviews/[id]/edit` nor `goals/[id]/edit` exists → 404. The review-detail page has no Edit affordance at all, so there's no way to correct a review short of the status-only API.
   - **Why it matters:** Past audits/performance records are immutable in practice; a misclicked rating or typo can't be fixed.
   - **Fix:** Either create the `[id]/edit` pages wrapping form components with `initialData` (the props already exist — `reviewId`/`initialData` in `ReviewForm`, `goalId`/`initialData` in `GoalForm`), or remove the Edit buttons and add an explicit "Editar" action on detail pages. Don't leave 404s in the primary UI.
   - **Suggested command:** `$impeccable harden`

3. **[P0] Both search boxes do nothing.** The list inputs send `search` to `/api/performance/reviews` and `/api/performance/goals`; neither GET handler reads `search` (no `ilike`/`or` anywhere). Typing fires requests that silently return unfiltered rows.
   - **Why it matters:** A visible, actively-used control that produces no effect destroys trust and wastes network; beyond page 1 the user has no way to find a record at all (no filter by employee, only search).
   - **Fix:** Implement `search` with `ilike` on `users.name` (+ `review.title` for goals) in both GET handlers, and debounce the input (~300ms) so keystrokes don't spam the API.
   - **Suggested command:** `$impeccable harden`

4. **[P1] The headline KPIs are computed from truncated data.** The dashboard fetches `/api/performance/reviews?companyId=X` with no `limit` → default 20, then computes `totalReviews`, `completedReviews`, `pendingReviews`, and `Completion Rate` client-side from that first page. Once the tenant has >20 reviews, all four cards are wrong. "Pending" also excludes `SUBMITTED` (submitted-but-uncompleted reviews appear in neither pending nor completed), and an empty list renders "Completion Rate 0%" — reads as "everyone failed", not "no data".
   - **Why it matters:** The single pane of glass a chain owner looks at first is lying, in both directions (undercounts and an artificial 0%).
   - **Fix:** Use `pagination.total` and add status-count endpoints (or compute counts server-side in one stats endpoint), count SUBMITTED as pending, and show "—" or "Sin datos" when total is 0.
   - **Suggested command:** `$impeccable polish`

5. **[P1] Detail pages fail on records older than the first page — and fabricate analytics.** Both `[id]` pages fetch `?companyId=all` (param ignored; returns first 20 by `createdAt` desc) and find their record client-side → "Evaluación no encontrada"/"Objetivo no encontrado" for any record past page 1 even though it exists. Separately, the Analytics tab renders hardcoded Q1–Q6 2026 mock data ("Performance trends over time") with a shared Y axis where a 4.2/5 rating bar is dwarfed by the 0–22 review-count scale — a genuinely misleading chart, in English, with off-palette recharts colors.
   - **Why it matters:** Direct-open links from lists/notifications land on false "not found"; a decision-support chart shows invented numbers about people's performance.
   - **Fix:** Fetch by `id` (`/api/performance/reviews?id=...` — the PATCH already supports it) at the detail level; delete or clearly label the mock chart until real aggregated data exists, split rating and count into dual axes or two charts, and localize + re-token it.
   - **Suggested command:** `$impeccable polish`

## Persona Red Flags

**Alex (Power User):** Reaches for search to find a specific employee's review — types, nothing changes, fires ~20 useless requests while typing. Tries Edit on a row: 404. Wants to mark 5 reviews complete in one pass: impossible, one-by-one through a detail page. Concludes the tool can't be trusted with numbers and goes back to Excel.

**Sam (Accessibility-Dependent):** The Eye/Edit buttons are icon-only ghost buttons with no `aria-label` — screen reader announces nothing meaningful; tabbing into them is a blank. Star-rating buttons lack `aria-pressed`/labels, so NVDA reads only "button". Loading is a bare "Cargando..." `<div>` with no `aria-live`. Emoji headings ("✓ Fortalezas", "📋 Plan de Desarrollo") get read aloud as "check mark", "clipboard" — noise in every detail view.

**Riley (Stress Tester):** Fills the criteria card (6 stars + 6 comments), submits, navigates back — gone, silently, no warning, not in the API. Refreshes the detail page mid-flow: state is refetched from scratch, fine — but the reviewer card shows the *employee's own name* (the API left-joins `users` on `userId` only and aliases it `reviewerName`). Searches for a review older than 20 records → "not found" on an existing record. Deletes a goal with a native `confirm()` that ignores the app's dialog pattern.

**ADMIN (project persona — chain owner with 3–15 branches):** Opens "Desempeño" from the sidebar expecting one pane of glass; finds the term renamed three times (nav "Metas", pages "Objetivos", tab "Goals", page header "Performance Management"). Sees "Analytics" showing ratings going up for 2026 quarters that haven't happened, and stops believing any number on screen. No branch column anywhere, so a decision about who to promote across 15 branches requires leaving this module. Would take WhatsApp daily check-ins over this any day.

## Minor Observations

- **Reviewer name is wrong:** reviews GET selects `reviewerName: users.name` from a single leftJoin on `userId` → the "Evaluador" card duplicates the employee's name. Add a second join on `reviewerId`.
- **Naming chaos:** the same feature is "Desempeño" (nav), "Performance Management" (dashboard H1), "Evaluaciones de Desempeño" (list H1), "Reviews/Goals" (tab labels), "Metas" (nav child), "Objetivos" (form/table). One term, one language (Spanish), everywhere.
- **Duplicate headers at 3 levels:** dashboard page + tab content + standalone `/reviews` and `/goals` routes all render their own H1s for the same lists, with different words.
- **Overdue goals are invisible:** a goal past `targetDate` renders identically to one with no date; no urgency tint, no "atrasado" badge — for an ops manager this is the number one missing signal.
- **No batch/quick actions:** goal detail offers status changes as full-width buttons (good), but there's no way to see a person's goals+reviews together — the two halves of "performance" never meet on one screen.
- **Hardcoded palette leaks:** `fill-yellow-400`/`text-gray-300` star colors and recharts `#8884d8`/`#82ca9d` bypass DESIGN.md tokens (chart-1..5 exist and are unused).
- **Period select offers 7 options** in one menu (Q1–Q4 + H1/H2/ANNUAL) — over the 4-item working-memory guideline; group by type or offer the current period as default.
- **Status-change toast exposes the enum:** "Evaluación marcada como ${newStatus}" prints `SUBMITTED` to the user instead of "Enviada".
- **Goal form default status** silently creates every new goal as NOT_STARTED with no status field on create — fine, but the detail page's "Iniciar Objetivo" is the only way out; there's no "add metric/KPI" input despite the goal description promising "métricas y KPIs" (the `metrics` column exists but no form field touches it).

## Questions to Consider

- What if "performance" were one page per *person* — their goals, reviews, and overdue items together — instead of two parallel entity lists the user must mentally join?
- What does it mean that the module's only data-visualization ship is a hardcoded chart about people's performance? Would a labeled empty state ("Sin suficientes datos") build more trust than fake quarters?
- If WhatsApp is a first-class surface, why doesn't a completed goal/review notify the employee's phone — or a due review nudge the manager?
- Would a single honest stats endpoint (counts by status) fix the KPI lies more reliably than client-side filter counting ever will?
