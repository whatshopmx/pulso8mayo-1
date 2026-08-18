---
target: app/dashboard/reports y app/dashboard/reports/custom
total_score: 15
max_score: 40
na_heuristics: 
p0_count: 3
p1_count: 2
timestamp: 2026-08-18T12-27-08Z
slug: app-dashboard-reports
---
Method: dual-agent (A: design review, isolated · B: detector + evidence, isolated). Assessment A was relaunched once after a session-limit abort; both assessments ran as isolated sub-agents and neither saw the other's output.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | One spinner replaces all three format buttons (`page.tsx:370`) — you can't tell which format is running; no ETA, no cancel, no history |
| 2 | Match System / Real World | 2 | Regulator vocabulary (COFEPRIS, STPS) is excellent; "Fuente de Datos", "Es nulo", "Exportar JSON" are database nouns handed to a taquero |
| 3 | User Control and Freedom | 2 | "Editar" on scheduled reports has no `onClick` (`page.tsx:445`); no cancel mid-generation, no reset, no delete |
| 4 | Consistency and Standards | 1 | Two branch selectors and two date ranges on one screen; two toast libraries in adjacent files; empty states hand-rolled 3× while `EmptyState` exists |
| 5 | Error Prevention | 1 | CSV button yields a corrupt `.pdf`; stale preview never invalidated; salary export is one unguarded click |
| 6 | Recognition Rather Than Recall | 2 | Date range scrolls out of sight long before the button you press; step-2 filters invisible at step 3 |
| 7 | Flexibility and Efficiency | 1 | "Guardar como Plantilla" POSTs to a route whose GET has no caller — saved templates are unreachable; no URL state, no recents |
| 8 | Aesthetic and Minimalist Design | 2 | Format badges restate the buttons directly beneath them; a search box over 9 hardcoded items the tabs already partition |
| 9 | Error Recovery | 1 | A failed fetch renders as "No hay reportes programados"; every builder failure is one generic string; no retry anywhere |
| 10 | Help and Documentation | 1 | "Oficial" badge on NOM-251 with no explanation of what COFEPRIS accepts; no field definitions; no privacy note on payroll data |
| **Total** | | **15/40** | **Poor — functional deceptions, not polish gaps** |

## Design Specificity Verdict

**LLM assessment: category-interchangeable.** Change nine strings and this is the reports page of any 2019 B2B SaaS. The composition is five inherited patterns with no argument between them: filter-bar-on-top (`page.tsx:235-288`), search field (`:292-300`), five-tab segmented control (`:302-309`), three-column grid of icon-tile cards (`:319-385`), and a numbered wizard stepper in the builder (`custom-builder.tsx:343-387`).

The tell is what the composition doesn't know. This product exists because someone runs 3–15 branches — and the report catalogue has **no branch dimension at all**. Nine cards, none of which answers "¿cuál sucursal va atrasada en NOM-251?". You pick one branch from a dropdown and get one file. The screen offers exactly what a single-location tool would offer.

The one Pulso-authored asset is the copy: "Reporte oficial de cumplimiento de higiene y salud (COFEPRIS)" (`page.tsx:120`), "factores de riesgo psicosocial (STPS)" (`:131`). Real domain vocabulary, sitting on a chassis that ignores it. Nine identical `bg-primary/10` red icon tiles + red PageHeader tile + red CTA + red stepper rail blow past the One Voice Rule's 10–15%. When a legally-binding NOM-251 filing and "KPIs de Rendimiento" wear the same red tile at the same size, red has stopped signalling anything.

**Deterministic scan: clean — and that is itself the finding.** `detect.mjs` returned `[]`, exit 0, zero rules triggered across all four files. No sub-12px type, no shadows, no hex literals, no unwrapped tables, no dead imports. The detector passes a screen that downloads corrupt files and renders server errors as "no data", because it scans for visual tells, not for truth. Treat the clean scan as evidence that this surface's problems are all above the detector's altitude.

The static sweep did surface four palette escapes the detector's rules didn't cover: `bg-blue-500` (`page.tsx:331`), `text-green-600 border-green-600` (`:441`), and two `text-red-500` required-markers (`schedule/page.tsx:172, 196`) — none with a `dark:` counterpart, all bypassing the `info`/`success`/`destructive` OKLCH tokens.

**Visual overlays: none.** No browser automation tool is exposed in this session, and `/dashboard/reports/*` sits behind `proxy.ts` session verification with no session available to the agent. No user-visible overlay was produced; the fallback signal is the CLI scan plus the static sweep above. Nothing was faked.

## Overall Impression

Three of these screens are not finished, and one of them is actively lying. The catalogue copy proves someone on this team knows the domain cold — and then that knowledge stops at the string level and never reaches the composition, the states, or the backend contract. The single biggest opportunity isn't visual: it's that **this surface promises things the server doesn't do**, in at least three independently verified places, and reports success anyway. Fix the honesty problems first; the layout critique is worth nothing on a screen whose downloads are corrupt.

Where A and B agree hardest: the missing `htmlFor` associations (B found 8 unassociated Labels and 5 broken `htmlFor` references pointing at `SelectTrigger`s that never receive an `id`; A independently flagged the same controls as unusable for a screen reader). Where B caught what A didn't: the five broken `htmlFor="dataSource"`-style references in `schedule/page.tsx` — a subtler bug than a missing label, since it *looks* correct in review. Where A caught what B structurally couldn't: every finding below, all of which require reading the server to see.

## What's Working

**1. `schedule/page.tsx` is genuinely good progressive disclosure — and it's already in the repo.** `dayOfWeek` appears only for WEEKLY (`:275-294`), `dayOfMonth` only for MONTHLY (`:296-308`), `deliveryEmails` only when delivery includes email (`:360-374`). The form never shows a field that cannot apply. It works because it reduces the visible decision surface to exactly what the previous answer made relevant — and it proves the two weaker screens have no excuse.

**2. The catalogue descriptions name the regulator, not the feature.** An owner who has survived an inspection recognises "COFEPRIS" and "STPS" instantly. This is the one place the product's domain knowledge reaches the surface.

**3. The filter row reads as a sentence and prevents one error.** `custom-builder.tsx:509-556` lays out campo / operador / valor legibly, correctly disables the value input for `is_null`/`is_not_null` (`:545`), and names the offending row on failure — "selecciona un campo para el filtro #2" (`:139`). The only spot in these files where the interface prevents an error instead of reporting it afterward.

## Priority Issues

### [P0] The CSV button downloads a corrupt file and reports success
**Why it matters:** `page.tsx:107` advertises CSV for "Reporte Detallado de Workflows". `generateReportFile` (`app/api/reports/generate/route.ts:91-99`) branches only on `EXCEL` and `PDF` and falls through to `NextResponse.json({ success: true, ... })`. The client sees `response.ok`, blobs the JSON, and names the file by a client-side guess — `const ext = format.toLowerCase() === "excel" ? "xlsx" : "pdf"` (`page.tsx:191`). The user gets `Reporte-Detallado-de-Workflows-2026-08-18.pdf` containing raw JSON, plus a green "Reporte generado" toast. The user's mental model of "it worked" is the toast; they find out at the accountant's desk and have no reason to suspect the app. A false success is worse than a failure.
**Fix:** Remove `"CSV"` from `page.tsx:107` today. Then derive the filename from the response's `Content-Disposition`/`Content-Type` instead of guessing, and treat an unexpected `application/json` response as an error, not a download.
**Suggested command:** `/impeccable harden`

### [P0] The custom builder offers 17 employee fields and can deliver 2
**Why it matters:** `custom-builder.tsx:46-62` lists Número de Empleado, Departamento, Puesto, CURP, RFC, Fecha de Nacimiento, Teléfono Personal, Ciudad, Estado. `queryEmployees` (`app/api/reports/execute/route.ts:105-114`) selects a fixed set: `id, name, email, role, status, branchId, branchName, createdAt`. Verified intersection with the offered field ids: **`name` and `branchId` only** — even `employeeStatus` (`:50`) never matches the returned `status` key. The preview renders `'-'` for all 15 missing fields (`:662-664`) and the CSV writes empty columns under headers literally named `curp`, `rfc`. The owner concludes his employee records are empty — the interface asserts, in a table, that he has no CURPs on file. Any filter on an unmapped column additionally hits `sql.raw("employee_number")` against `users` and 500s, surfacing as the generic "Error al generar la vista previa". (`contracts` and `documents` map correctly; `employees`, the default source, is the broken one.)
**Fix:** Derive `AVAILABLE_FIELDS` from the server's `FIELD_MAP` so the two cannot drift, or extend `queryEmployees` to select the mapped columns. Never render a checkbox for a field the query cannot produce.
**Suggested command:** `/impeccable harden`

### [P0] Payroll data exports with no role check
**Why it matters:** `app/api/reports/execute/route.ts:198-200` guards on `session.user.companyId` only — there is no role check anywhere in the route. `lib/rbac/permissions.ts:86-89` admits `SUPERVISOR` and `READONLY` to `/dashboard/reports`. The `contracts` source maps every offered field correctly, so any of those users can export `baseSalary`, `monthlySalary`, `weeklySalary` for the whole company as CSV, one click, no confirmation, no row count, no trace. Nothing calls `enforceBranchScope` either, so a GERENTE pinned to one branch everywhere else in the app pulls chain-wide here. `reportExecutionHistory` exists (`lib/db/schema.ts:2320`) and is written by the cron — nothing in the UI ever reads it.
**Fix:** Add `requireRoleApi` to the execute route. Apply `enforceBranchScope` to the query. In the UI, confirm the export naming the sensitive columns and the row count ("Vas a exportar 412 registros, incluyendo sueldos"), drop "Exportar JSON", and add an "Exportaciones recientes" panel fed by `reportExecutionHistory`.
**Suggested command:** `/impeccable harden`

### [P1] Two contradicting scopes on one screen, and the hidden one wins
**Why it matters:** `app/dashboard/layout.tsx:72` renders `BranchScopeControl` on every dashboard page — documented in its own header comment as "single source of scope for the dashboard … See AD-1 in tasks/plan.md". `page.tsx:240-286` builds a *second* branch Select and a *second* date range, and it is the card's values that reach `/api/reports/generate` (`:179-181`). The header can read "Sucursal: Taquería Reforma · Últimos 7 días" while the download contains all branches over 30 days. This directly violates PRODUCT.md principle 4 — "A manager should never wonder which screen has the real numbers." The failure mode is a compliance PDF for the wrong branch, discovered by an inspector.
**Fix:** Delete the branch and date controls from the config card; read scope from `useBranch()` + `searchParams` exactly as `app/dashboard/finance/cash-flow/page.tsx:41-63` does. Show the active scope inline next to the download buttons ("Todas las sucursales · 19 jul – 18 ago") so it's visible at the moment of action, not three screens up.
**Suggested command:** `/impeccable distill`

### [P1] Failure is rendered as emptiness, everywhere
**Why it matters:** `page.tsx:82-88` resolves a non-`ok` response to `null` and sets `[]`, which renders "No hay reportes programados. Programa un reporte para recibirlo automáticamente" (`:409-413`). An owner whose weekly NOM-251 delivery has run for six months is told, in confident Spanish, that it doesn't exist — a transient 500 becomes "the system deleted my automation." Branch-loading failure leaves the Select silently containing only "Todas"; `schedule/page.tsx:86` swallows the same failure with a bare `.catch(() => {})`. `components/shared/error-state.tsx` exists, has `role="alert"` and an `onRetry`, and cash-flow uses it correctly. "Empty" and "broken" demand opposite responses; conflating them means the correct response (reload) is never suggested and the incorrect one (re-create the schedule) creates duplicates.
**Fix:** Track a separate `error` state per fetch and render `<ErrorState onRetry={refetch} />`. Surface the server's message where one exists.
**Suggested command:** `/impeccable harden`

## Persona Red Flags

**Alex (power user, runs reports weekly)** — Saves a template (`custom-builder.tsx:627`) he can never load: `GET /api/reports/templates` has no caller anywhere outside `app/api/` (verified). His work evaporates every session. Hub state isn't in the URL, so he can't bookmark or send "NOM-251, Reforma, julio" — while cash-flow does exactly that two menu items away. Re-selects branch and date every visit though the header already remembers them by cookie. Searches a box over 9 hardcoded items he memorised in week one. No keyboard shortcuts, no bulk generation, no "regenerar el del mes pasado".

**Jordan (first-timer)** — Lands on a config form demanding dates before anything explains what he's configuring. "Fuente de Datos: Empleados / Contratos / Documentos" with no statement of what one row is. "Siguiente" is disabled at step 0 until `reportName` is non-empty (`:707`) **with no message saying so** — he clicks a greyed button and concludes the app is broken. "Exportar JSON" is meaningless to him and sits at equal weight beside the button he needs. The `opacity-60` NOM-035 card (`page.tsx:321`) reads as broken rather than forthcoming.

**Sam (keyboard / screen reader)** — `Label` without `htmlFor` on every filter control: `page.tsx:242, 250, 258, 274` and `custom-builder.tsx:401, 409, 570, 578` (inputs are siblings, not children — the association doesn't exist). Five *broken* `htmlFor` references in `schedule/page.tsx:195, 217, 246, 322, 341` pointing at `SelectTrigger`s that never receive an `id`. The search input has no accessible name, only a placeholder (`page.tsx:294`). Up to 27 buttons across the grid announce as "PDF, botón" / "Excel, botón" with **no report name** (`:360-378`). The stepper announces "1, botón" — its only text content is `{step.id + 1}` (`custom-builder.tsx:364`), label detached into a sibling span, no `aria-current`, no focus move on step change. The generating spinner has no `aria-live`. The filter remove button is an icon-only `X` with no accessible name (`:548-555`). The dead "Editar" button is in the tab order and does nothing.

**Don Rafael — 55, owns 8 taquerías, iPad in a noisy back office** — He downloads the wrong branch: header says "Reforma", card says "Todas", card wins. The tabs truncate: `grid w-full grid-cols-5` with no responsive variant (`page.tsx:303`) puts "Cumplimiento" in a ~130px cell at iPad portrait. He taps CSV, gets a file that won't open, and blames the iPad. Format buttons are `size="sm"` → 32px tall, three-across, under the 44px touch minimum, with greasy fingers, standing up. No date presets — two raw `type="date"` inputs and a wheel picker spun twice for "el mes pasado", while the header control he's ignoring offers exactly those presets. Nine identical red tiles give him no way to find "the one for the STPS inspection next Thursday" without reading nine descriptions. The builder is not for him at all.

## Cognitive Load: 7 of 8 fail

**Single focus** — the hub stacks four unrelated jobs (configure / search / browse / manage automations) and never states a question. **Chunking** — "Profesional" holds 7 fields; the catalogue shows 9 undifferentiated cards. **Grouping** — `page.tsx:41` files "KPIs de Rendimiento" under **PERSONAS**; business performance is not a people report and nobody will look there. **Visual hierarchy** — a COFEPRIS filing and a KPI dump are typographically indistinguishable. **One thing at a time** — the builder honours it, the hub doesn't. **Working memory** — the date range is off-screen by the third card row; step-2 filters are unverifiable from step 3. **Progressive disclosure — inverted**: the hub dumps 9 reports + 4 filters + the schedule list at once, while the builder hides four trivial choices behind a 4-step wizard.

**Decision points exceeding 4 visible options — 6:** 17 checkboxes in a `max-h-96` scroll pane (`custom-builder.tsx:459-482`, no search, no select-all, no presets); 9 ungrouped report cards at the default "Todos"; 8 filter operators including "Es nulo"/"No es nulo"; 7 days of week (acceptable — native calendar expectation); 5 category tabs; 5 simultaneous controls at the builder's final step.

## Minor Observations

- **Two toast systems in one folder:** sonner (`page.tsx:29`, `schedule/page.tsx:18`) vs shadcn `useToast` (`custom-builder.tsx:26`).
- **The catalogue is hardcoded twice and has already drifted:** `page.tsx:92-168` has 9 entries, `schedule/page.tsx:22-31` has 8 — `compliance-nom035` is missing. A third copy is the switch in `generate/route.ts:30`.
- **Contradicting counts one second apart:** toast "Mostrando 4,132 registros" (`custom-builder.tsx:187`, using the total) vs card "Mostrando 10 de 4,132" (`:643`).
- **Scheduled rows show intent, not evidence.** `:433` renders the config the user typed, with fabricated fallbacks — `sched.time || "07:00"`, `sched.format || "PDF"` — so an unset schedule *claims* 07:00 PDF. `lastRunAt`/`nextRunAt` exist (`lib/db/schema.ts:2301-2302`) and would answer the real question: "¿llegó el de esta semana?" The "Error" badge carries no date, no reason, no retry.
- **Stale preview:** `previewData` is never cleared when `dataSource`, `selectedFields` or `filters` change — add a column after previewing and every row renders `'-'`, indistinguishable from "no data".
- **Filters keyed by array index** (`:509`) — removing a middle row remounts Select internals against the wrong data.
- **Absolute-positioned remove button** (`:551`) sits `top-1/2 right-2` over a grid that collapses to one column below `sm`; it overlaps the operator Select on phones.
- **Server CSV has no BOM and weak escaping** — only commas are quoted; embedded quotes and newlines aren't escaped; no `﻿`, so Excel mangles "Peña" and "José". `components/shared/use-export-csv.ts:18-33` already solves all three and is used by two other surfaces.
- **Empty states hand-rolled three times** (`page.tsx:313, :409`, `custom-builder.tsx:676`) with three different icon sizes and no actions, while `components/shared/empty-state.tsx` exists with an action slot.
- **The stepper is banned scaffolding.** DESIGN.md rejects "numbered section markers (01 / 02 / 03) as default scaffolding" — `custom-builder.tsx:343-387` is exactly that, and `:350-354` lets you jump to step 3 the moment one checkbox is ticked, bypassing the filter validation `:701-703` otherwise enforces.
- **Arbitrary opacity values:** `opacity-55`, `opacity-50`, `opacity-60` — three off-scale values, none a token.
- **Width mismatch:** builder content is `max-w-4xl mx-auto` inside `PageContainer`'s `max-w-7xl`, so the header's "Regresar" floats far right of the column it belongs to.
- **Two non-responsive 2-col grids** in `schedule/page.tsx:244, 320` (Frecuencia/Hora, Formato/Método) — fixed at all widths including 320px.
- **Straight ASCII quotes inside Spanish copy** (`custom-builder.tsx:505, 679`).
- **Indentation split:** `page.tsx` 4-space, `schedule/page.tsx` 2-space, same directory.

## Questions to Consider

1. **If the report arrives by WhatsApp every Monday at 07:00, what is this screen for?** PRODUCT.md calls WhatsApp a first-class interface. Scheduling is a card at the bottom behind a full-width outline button; one-off generation is the hero. Which one does an owner with 8 branches actually do more than twice?
2. **What question does the owner arrive with?** "¿Paso la inspección del jueves?" is a question. "Resumen de Workflows — PDF · Excel" is a file format. Cash-flow leads with questions; why does Reportes lead with nine nouns and a date picker?
3. **Where's the history?** The only reports that matter are the ones you must reproduce for an auditor eighteen months later. `reportExecutionHistory` is written faithfully by the cron and shown to no one.
4. **Would you ship "Constructor de Reportes" to someone who has never written a query — or would you ship six saved questions?** "¿Quién tiene documentos vencidos?", "¿Qué sucursal está atrasada en NOM-251?" Then let the 5% who need `is_not_null` ask for it.
5. **Nine cards, no branch dimension.** For a product whose entire premise is 3–15 locations, where is the report that says *which* branch is the problem?
