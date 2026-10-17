---
target: critique @app/dashboard/performance/ @app/dashboard/performance/reviews/ @app/dashboard/performance/goals/ @app/dashboard/performance/goals/new/page.tsx
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 4
timestamp: 2026-10-16T19-40-32Z
slug: app-dashboard-performance
---
# Critique: app/dashboard/performance

⚠️ **DEGRADED: single-context (no sub-agent tool exposed in this session)**

Targets covered: `/dashboard/performance` (dashboard + Evaluaciones/Objetivos/Analítica tabs), `/performance/reviews/*`, `/performance/goals/*` (including `goals/new`), `/performance/personas/[id]`.
Live surface inspected in-browser at 1440×900 and 390×844, authenticated as the seeded ADMIN.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Loading/searching states, skeletons, toasts and breadcrumbs are real and correct — but the goal-detail Progress bar asserts a 50% figure the system does not have, and the 8-criterion review form gives no "N of 8 rated" feedback across 2600px of scroll |
| 2 | Match System / Real World | 3 | Spanish HORECA vocabulary throughout, "Atrasada" for overdue, es-locale dates. Bleed: breadcrumb says "Metas" while every other surface says "Objetivos"; badge values read "OPERATIONS"/"COMPLIANCE" next to the Spanish "Operaciones" the form offers; "Peso 9" is never explained; the 5-star rows carry no numeric scale |
| 3 | User Control and Freedom | 2 | AlertDialog replaced native confirm (good) and forms have Cancelar — but there is no undo for status changes, no "limpiar filtros" when a filtered list is empty, and the review detail page has no Edit affordance, so a mis-rated review must be fixed from the list |
| 4 | Consistency and Standards | 2 | COMPLETED and ATRASADA both render as filled red badges; SUBMITTED and COMPLETED share one `default` badge variant; the Objetivos tab has no create CTA while `/performance/goals` does; `statusConfig.color` in goal detail is dead hardcoded Tailwind palette (`text-gray-500`, `text-blue-500`, …); goal form marks Título `*`, review form marks nothing required; no `metadata` export on any of the 9 routes while 10+ sibling dashboard pages have one — every page shares one browser title |
| 5 | Error Prevention | 2 | Required title / employee / period checks and a destructive-action dialog exist. No date guard on Fecha Límite (an already-late goal is one click away — 3 of 5 seeded goals are overdue), a review can be Submitted with zero criteria rated, and a 2600px form has no draft autosave |
| 6 | Recognition Rather Than Recall | 2 | Status, rating and overdue are visible in every list, breadcrumbs are present. But star scales are unlabeled numerically, weights are unexplained, the reviewer identity never appears on the form (silently the logged-in user), and "Nuevo Objetivo" is undiscoverable from the tab where goals live |
| 7 | Flexibility and Efficiency | 2 | Debounced working search, two filters, pagination, a person page that joins reviews + goals, and a WhatsApp notification on goal completion. No keyboard shortcuts, no bulk status changes, no assignee picker, no export |
| 8 | Aesthetic and Minimalist Design | 2 | Flat tonal layering with no shadows, Geist throughout, clean horizontal-rule-only tables exactly as DESIGN.md prescribes. But Operational Red is used for success, danger and progress at once — ~40% of the goal-detail page and 4 filled badges on the dashboard, far past the 10–15% One Voice budget. The "Detalles" card is ~65% empty; the Analytics empty state is a ~400px void |
| 9 | Error Recovery | 2 | Fetch failures now render a distinct error state instead of "no results", and detail pages get real 404s. But the error state has no retry button, `handleDelete`/`handleStatusChange` only catch throws (a 500 shows nothing), and empty states cannot distinguish "no records" from "no matches" |
| 10 | Help and Documentation | 1 | The Analytics empty state explains its own ≥5 threshold — genuine contextual help. Nothing explains the DRAFT→IN_PROGRESS→SUBMITTED→COMPLETED pipeline, the weights, or the star scale |
| **Total** | | **21/40** | **Acceptable (52.5%)** |

All ten heuristics apply (Operate surface: dashboard, lists, forms).

## Design Specificity Verdict

**LLM assessment:** Medium, and materially better than this module's previous state. The authored ideas are real now: `/performance/personas/[id]` finally joins the two halves of "performance" (a person's goals *and* reviews on one page), criteria are HORECA-native ("Atención al Cliente", "Puntualidad", "Calidad del Trabajo"), statuses speak Spanish, overdue is surfaced as "Atrasada", and completing a goal sends the employee a WhatsApp message — the product's positioning made concrete.

What is still category-interchangeable is the composition: KPI grid → tabs → filter card → table, byte-for-byte the same skeleton as inventory, labor and compliance. Nothing on the surface knows this is a *chain*. There is no Sucursal column in either table even though the top bar offers "Sucursal: Todas" and the tenancy is branch-scoped; no person identity (no initials, avatar or branch); no review-cycle calendar. A chain owner cannot answer "which branch is this 4/5 in?" without leaving the module. The dashboard's one piece of art is a chart that refuses to render for this tenant (4 completed reviews, threshold 5), so the Analytics tab is a 400px blank.

**Deterministic scan:** `detect.mjs --json` over `app/dashboard/performance`, `.../reviews`, `.../goals`, `.../goals/new/page.tsx` returned `[]` (exit 0). Nothing in the markup trips the CLI rules.

**Visual overlays:** Injection succeeded — the browser page accepted `document.title` and script-tag mutation, `http://localhost:8400/detect.js` loaded, and the console reported `[impeccable] 12 anti-patterns found`, with overlay nodes (`div.impeccable-overlay`) confirmed present in the DOM. Findings split:

- **1 real, corroborated** — `cramped-padding` (`div.bg-card…rounded-lg.border.py-6`): both list components pass `<CardContent className="pt-6">` on top of `Card`'s own `py-6`, yielding 3rem of top padding against 1.5rem at the bottom. This is the oddly tall filter card visible in every list screenshot.
- **1 real but out of scope** — `text-overflow`: `span.truncate.text-xs` (the sidebar's `carlos@pulso.mx`) overflows its box by 29px in the dashboard layout, not in this module.
- **10 likely false positives** — `nested-cards` ×6 fired on the four *sibling* `MetricCard`s plus the two list cards (siblings in a grid are not nested), and `layout-transition` ×4 fired on the shadcn sidebar's intentional `transition: width/height/margin` collapse animation.

## Overall Impression

The trust bomb is defused. Criteria ratings now persist, `/reviews/[id]/edit` and `/goals/[id]/edit` exist, search actually filters, the KPIs come from a real SQL `stats` endpoint, and the fabricated Q1–Q6 analytics chart has been replaced by an honest "Sin suficientes datos" state. That is the difference between a demo and a product, and this run scores it 21/40 instead of the previous 17/40 — but the remaining points are concentrated where a *chain owner* would feel them: the headline create action builds the wrong record, and the colour system cannot tell success from danger. Fix those two and the ceiling moves sharply; the rest is polish.

The single biggest opportunity: make the assignee a first-class part of every goal, and give COMPLETED / ATRASADA / SUBMITTED their semantic tokens back.

## What's Working

- **The person page is the module's best idea.** `/performance/personas/[id]` pulls rating average, active goals, overdue count and completed evaluations into one view with the goals and reviews tables beneath — the only place where "performance" reads as a story about a human rather than two parallel entity lists. It also links onward to "Nueva evaluación para <nombre>".
- **The analytics empty state is honest and self-explaining.** "Sin suficientes datos de evaluación para mostrar tendencias" plus "aparecerán cuando haya al menos 5 evaluaciones completadas con calificación en un mismo período" is exactly what a fabricated chart should be replaced with. The chart itself now uses `--chart-1`/`--chart-3` and dual axes for rating vs. count — the misleading shared 0–22 scale is gone.
- **DESIGN.md compliance is real where it counts.** Flat surfaces with no shadows, tonal layering, Geist only, horizontal-rule-only tables with no vertical borders, generous row height on tablet, semantic `text-warning-text` instead of `text-warning` for AA contrast, and `aria-label`s on every icon-only row action. axe on the dashboard: 1 moderate violation, 46 passes.

## Priority Issues

1. **[P0] A goal created in the UI is always assigned to its creator.** `GoalForm` has no assignee control: `userId` is seeded from the logged-in user and never rendered, so "Nuevo Objetivo" produces a self-goal. The goals table leads with an "Empleado" column, `personas/[id]` groups goals per person, and completing a goal WhatsApps `goal.userId` — the entire module assumes goals belong to employees. All 5 seeded goals belong to other users, so the seeded data could not have come through this form.
   - **Why it matters:** The module's primary create action silently writes the wrong record for the only audience that creates goals (owners and GERENTEs assigning work to staff). The error is invisible: the toast says "El objetivo se creó exitosamente" and the record is valid — it just belongs to the wrong person.
   - **Fix:** Add a required "Empleado" Select to `GoalForm` (reuse the employee fetch from `ReviewForm`), defaulting to the current user only in the "personal goal" case, and mark it `*`. Until then, assign explicitly on the API rather than inferring from the session.
   - **Suggested command:** `$impeccable harden`

2. **[P1] Operational Red does four contradictory jobs on one screen.** On `/goals/[id]`: the Progress bar is red, "Marcar como Completado" (a *success* action) is red, "Cancelar Objetivo" (destructive) is a nearly identical red, and the "Atrasada" badge is red — roughly 40% of the viewport. On the dashboard every "Completado" badge in the table is a filled red pill, so a healthy list reads as a wall of alerts. DESIGN.md's semantic tokens (`--success`, `--warning`, `--info`, `--destructive`) exist and go unused while the One Voice Rule's 10–15% budget is blown.
   - **Why it matters:** Red is the module's only signal, so it signals nothing. A manager scanning for problems cannot tell completed work from overdue work at a glance — the exact scan this screen exists to support.
   - **Fix:** COMPLETED → `success`; SUBMITTED → `info`; DRAFT → `outline`; ATRASADA → `warning` or `destructive`; IN_PROGRESS → `secondary`. Keep Operational Red for the single primary action per screen. Make the destructive Cancel button `outline`+`text-destructive` so it stops competing with "Marcar como Completado".
   - **Suggested command:** `$impeccable colorize`

3. **[P1] The Progress bar reports a number the system does not have.** `getProgressValue` maps status to a constant: `NOT_STARTED→0`, `IN_PROGRESS→50`, `COMPLETED→100`. Every goal in the tenant has `metrics: null` and no progress column, so a three-month-overdue goal shows a confident half-filled red bar as the loudest element on the page. This is the same class of defect as the fabricated analytics chart that was just removed.
   - **Why it matters:** It is invented data in a decision-support surface — the failure mode this module was previously criticised for, still present in a new costume.
   - **Fix:** Delete the bar and let the status badge carry the state, or add a real `progress` field to the schema and form. If a bar stays, label it with its source.
   - **Suggested command:** `$impeccable distill`

4. **[P1] The evaluation form hides its own state and scale.** Eight criteria render as eight visually identical bordered boxes (2602px of full-page scroll on a 1440×900 viewport), each with an unlabeled 5-star row, a single-line `Input` for what is narratively a comment, and badges like "Peso 9" / "Peso 10" whose meaning is never stated. Nothing tells the reviewer how many criteria remain or how the weights roll up until after the first rating.
   - **Why it matters:** A manager completing this on a tablet in a back office loses their place in an undifferentiated stack, cannot tell which end of the star scale is good, and types multi-line justifications into a one-line field.
   - **Fix:** Add a sticky "N de 8 criterios calificados" progress row; number the star scale (1–5) once per row or in the card header; swap the criterion comment `Input` for a `Textarea`; and add one line of help text explaining weights ("Peso 9 de 40 total — los pesos definen cuánto aporta cada criterio a la calificación final").
   - **Suggested command:** `$impeccable layout`

5. **[P1] Three dead-end states in the lists and detail pages.** (a) `GoalsList` renders "Nuevo Objetivo" *only* when the list is empty — with 5 goals present there is no create CTA in the Objetivos tab. (b) The error branch prints "No se pudieron cargar los objetivos. Intenta de nuevo en un momento." with no retry affordance. (c) The empty branch prints "No se encontraron objetivos" whether the tenant has no goals or a status filter excluded everything, with no "limpiar filtros". Separately, the review detail page offers status transitions but no Edit, while the list row does.
   - **Why it matters:** The create path is only discoverable from a different route; a transient 500 leaves the user with text and no way forward; and a filtered-empty list invites the user to create a duplicate instead of clearing the filter.
   - **Fix:** Move the create button into the filter card header (always visible); add a retry button to the error branch; branch the empty copy on whether any filter is active and offer "Limpiar filtros"; add the edit affordance to the review detail header.
   - **Suggested command:** `$impeccable polish`

## Persona Red Flags

**Alex (Power User):** Search and filters now work, so the previous "types 20 requests for nothing" failure is gone. But there are still no keyboard shortcuts, no bulk status change (closing 5 goals = 5 detail pages + 5 dialogs), no export, and no way to reassign a goal — so when he discovers a goal was created against the wrong person he must delete and recreate it. He will conclude the tool is for reading, not for running a team, and go back to a spreadsheet for the actual follow-up.

**Sam (Accessibility-Dependent):** axe on `/dashboard/performance` is clean bar one moderate landmark violation, and the star inputs are genuinely good — `role="radiogroup"`, per-star `aria-checked` and `aria-label="3 de 5 estrellas"`, visible focus ring. What still breaks for Sam: the read-only rating stars on the review detail page are bare `<Star>` icons with no accessible text, so the headline rating is silent; the star scale has no visible numbers, so a low-vision sighted user cannot map a rating to a value; "Atrasada" and "Completado" differ only by hue in a table cell; and the dual-axis chart's axis labels are 12px SVG text.

**Casey (Distracted Mobile):** At 390×844 the page opens with four full-width KPI cards — roughly 500px of scrolling before a single evaluation is visible, where a 2×2 grid would fit in half that. The reviews table is `overflow-x-auto` but shows no scrollbar or fade edge, so Fecha, Rating, Estado and the row actions sit off-screen with nothing indicating they are reachable. The top bar's "Sucursal: Todas" and "Fecha: Todo el periodo" chips truncate mid-word. Also verified: no page-level horizontal scroll (`document.scrollWidth === 390`), so the clipping is contained rather than a broken layout.

**Rosa — dueña de cadena, 3–15 sucursales (project persona):** She opens Desempeño for one pane of glass across locations. The top bar says "Sucursal: Todas" and the tenancy *is* branch-scoped, but neither table has a Sucursal column and no goal or review names a branch — so "4/5, Ana Martínez" cannot be attributed to Polanco or Roma without leaving the module. "Tasa de Completado 100%" is arithmetically true for 4 reviews and tells her nothing about the 15 branches she actually oversees. "3 vencidos" — the most actionable number on the page — is set in muted 12px type under an `info`-toned card. And every page in the module carries the same browser tab title, so she cannot keep three branch dashboards apart in her tab bar.

## Minor Observations

- **Naming drift at the seams:** breadcrumb reads "Desempeño › Metas › Nuevo" while every other surface says "Objetivos"; the goal detail's breadcrumb leaf is the generic "Detalle" instead of the goal title.
- **Duplicate headings:** `goals/new` and `goals/[id]/edit` each render the page H1 *and* a card title with identical text ("Nuevo Objetivo" / "Editar Objetivo").
- **Seeded categories leak English enums:** badges read "OPERATIONS" and "COMPLIANCE" in the same column where the form offers "Operaciones".
- **Filter card padding is asymmetric** — the detector's one corroborated hit (`CardContent pt-6` stacked on `Card py-6`).
- **The Analytics empty state is a ~400px void** for two lines of copy; it could be half the height, and this tenant has 4 completed reviews it could show.
- **The 7-option Período select** (Q1–Q4 + H1/H2 + ANUAL) is an ungrouped flat menu; group by granularity and default to the current period (it already does default correctly — the menu just outgrows working memory).
- **Header icons are inconsistent:** "Objetivo" and "Fecha Límite" carry icons in the goals table header; Empleado, Categoría, Estado and Acciones do not.
- **Reviewee/employee links don't look clickable** — `font-medium hover:underline` with no colour accent, so nothing signals navigation until hover.
- **Goal form's 3-column grid** leaves the third slot empty on create, so Categoría and Fecha Límite sit in a two-thirds-width row while Título and Descripción span full width.
- **No per-page titles:** none of the 9 performance routes export `metadata`, so every page's browser title is "Pulso - Plataforma de Gestión HORECA", while `finance/treasury`, `inventory/movements` and 8 other sibling pages set their own.
- **Dead code:** `statusConfig.color` in the goal detail (`text-gray-500`, `text-blue-500`, `text-green-500`, `text-red-500`) is computed and never applied — a hardcoded palette leak that currently has no visual effect.
- **`metrics` is scaffolded but unused end-to-end:** the column exists, the form promises "métricas y KPIs esperados" in its description placeholder, and every row in the tenant is `null`. Goals cannot carry a measurable target.

## Questions to Consider

- What if every goal and review carried its Sucursal, so "Desempeño" could actually be read as a chain-wide view instead of a company-wide average?
- If a goal has no metrics and no progress field, what does the Progress bar mean? What would the honest version of that card look like?
- Should a review be submittable with zero criteria rated — and if so, what does the overall rating mean?
- What would it take to make "Nuevo Objetivo" assign work to someone else in one screen: an assignee picker, a branch picker, and a metric field?
- Why does a manager have to leave the goal they are looking at to correct it, while the list row offers Edit?
