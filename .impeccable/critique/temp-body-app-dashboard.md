Method: ⚠️ DEGRADED: single-context (no sub-agent/Task tool exposed in this session; Assessments A and B ran sequentially, A before detector output entered synthesis)

# Critique — `app/dashboard/` (Comando de Red en Vivo)

Target: `app/dashboard/` → live at `http://localhost:3000/dashboard` (Seeded demo, admin `carlos@pulso.mx`, company "Pulso HORECA Demo", 3 branches).
Mode: **Operate** (command center for owners/ADMINs).

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | The surface says "en vivo" four times but has no auto-refresh, no manual refresh, and no data-age timestamp; "Fecha Operativa: 2026-09-18" is a date, not a freshness signal. |
| 2 | Match System / Real World | 3 | Real HORECA vocabulary (NOM-251, aperturas, dotación, rush, merma) — undercut by unexplained codes ("M17 / NOM-251", "POS", "Ficha 360°") and a reassurance label that over-claims. |
| 3 | User Control and Freedom | 3 | Search + "Todas / Con Alertas" filters work and nothing is destructive; but there is no way to re-fetch data, no "clear filters", and filter/search state resets on navigation. |
| 4 | Consistency and Standards | 2 | Three competing severity vocabularies in one viewport; alert nouns drift ("alerta" / "riesgo" / "incidencia" / "excepción"); `shadow-xs` on two cards contradicts the documented Flat-By-Default rule. |
| 5 | Error Prevention | 3 | Granular `SectionErrorBoundary` + retry is genuinely good, and no destructive affordance exists here — but the false-green banner can suppress the very action the page exists to trigger. |
| 6 | Recognition Rather Than Recall | 2 | Eight truncated labels with no tooltip or detail affordance; "Stock bajo en insumo cla…" appears three times identically in Inventario, so the card cannot be triaged without opening each link. |
| 7 | Flexibility and Efficiency | 2 | No keyboard path to the matrix search, no bulk triage, no per-branch quick action beyond a link, no saved/remembered filter, no export of the exceptions themselves. |
| 8 | Aesthetic and Minimalist Design | 2 | Detector counts 36 nested frames (4 KPI tiles inside a card; 4 sub-tiles inside each branch row inside another card); one area card (Finanzas) is permanently empty by design; the 3-up KPI tautology repeats what the matrix already says. |
| 9 | Error Recovery | 3 | `ErrorState` with retry per fetcher, page-level `error.tsx` with "Reintentar", and the empty search state names the remedy ("Intenta con otro término de búsqueda"). |
| 10 | Help and Documentation | 1 | Zero in-product help on this surface: no tooltips on the bespoke KPI tiles (verified `title: ""`), no explanation of the muted/amber/green status rules, no link to the user guide. |
| **Total** | | **23/40** | **Acceptable (57.5%)** |

## Design Specificity Verdict

**LLM assessment.** The information architecture is authored, not borrowed: a shift-pulse banner → a branch matrix with four QSR semaphores → an area council with cross-branch exception queues → an activity log. That is a real HORECA command center, not a re-skinned admin template, and the vocabulary ("inocuidad", "merma", "rush", "dotación de personal") belongs to this product. The problem is that the *conviction* stops at the layout. The header is a generic `PageHeader`; the KPI row is the hero-metric template DESIGN.md explicitly bans; the four pillar tiles are pixel-identical in size and weight, so nothing tells the eye where to land first; and the rug of 1px borders (36 nested frames) is exactly the "heavy borders" anti-reference the brand was written to reject. It reads as a well-organised compliance console that happens to use a red accent — category-adjacent rather than unmistakably Pulso.

**Deterministic scan.** `detect.mjs --json app/dashboard components/dashboard components/shared` returned **0 findings** (exit 0). A broader `detect.mjs --json app` scan returned **2 findings docs-adjacent to this surface only**: `design-system-color` counts across `app/dashboard` do not fire, but the repo-wide scan flags `bg-emerald-400/500` in `components/dashboard/live/live-pulse-banner.tsx` (lines 36–37) as an undocumented colour family. The detector does **not** model Tailwind utility classes, which is why the two `shadow-xs` cards and the 8`truncate` overflow spans were invisible to it.

**Visual overlays.** Injection succeeded (`document.title` mutation + injected `<script>` both verified). `live-server.mjs --background` served `detect.js` on port 8400; the browser reported **40 anti-patterns** into the console. The `[Human]` overlay is visible in the browser tab used for this run, annotated in orange. Console breakdown:

| Rule | Count | Where it landed |
|---|---|---|
| `nested-cards` | 24 | 4× KPI pillar tiles in `live-pulse-banner`, 12× branch sub-tiles in `live-command-matrix`, 6× `AreaCard` bodies, 1× filter group, 1× `recent-workflows-table` header panel inside its card |
| `text-overflow` | 9 | 8× `span.truncate.text-foreground` (the exception titles — 111px, 150px, 80px, 69px, 66px, 52px, 50px, 20px over), 1× `span.truncate.text-xs` (the metric label in an `AreaCard` header, 29px over) |
| `layout-transition` | 5 | Sidebar/header width+height transitions ×4 (shadcn `sidebar` internals), plus `transition-all` on the pulse banner |
| `line-length` | 1 | `p.text-muted-foreground.text-sm.mt-1` — the page description, ~98 chars/line |
| `cramped-padding` | 1 | `div.border-t.border-border` in `recent-workflows-table` — empty-state row flush against its top border |

Screenshots: `.impeccable/critique/shots/crit-overlay.png` (desktop 1280, overlays on), `crit-mobile-1..3.png` (390×844), `crit-dark.png` (dark mode), `crit-a-2..6.png` (sequential scroll).

## Overall Impression

The page has a clear point of view and a real operating model behind it — nine data sources stitched into one shift story is the right ambition, and the branch matrix is the best thing in the app. But the surface opens by telling the owner everything is fine and then spends 2,400 pixels proving it isn't. The single biggest opportunity is to make the top of the page the *exception register* rather than the *reassurance banner*: one count, one honest colour, one action, then the evidence.

## What's Working

- **The branch matrix is the product.** Opening / staff / NOM-251 cold-chain / POS in four semaphores per branch, with "Con Alertas (3)" as a one-tap filter, is a genuine multi-unit operating view. A franchise director can answer "who is broken right now" in one glance — no other screen in the app does this.
- **The exception queues are honest about missing data.** `GroupAreaOverview` deliberately renders no metric when `CrossBranchService` has no trustworthy source, and the code says so out loud (`Finanzas y Equipos no tienen todavía una métrica cross-sucursal madura... se omite en vez de inventar un número`). That is unusually disciplined — most dashboards invent the number.
- **Failure is contained, not fatal.** Every section sits in its own `Suspense` + `SectionErrorBoundary`, so one dead query degrades one card. Combined with the "Excelente: No hay sucursales con alertas operativas" empty state, the page fails politely.

## Priority Issues

### [P1] "En vivo" is a promise the page does not keep
- **What**: Four separate labels assert liveness — page title *"Comando de Red en Vivo"*, description *"Monitoreo en tiempo real del turno"*, section *"Pulso en Vivo del Turno"*, table *"Bitácora en Tiempo Real de la Red"*. There is no `router.refresh`, no polling, no SSE, no revalidation, and no "actualizado hace X" anywhere in `app/dashboard/page.tsx`, `layout.tsx`, `components/dashboard/live/*`, or `recent-activity.tsx`. The only timestamp is `Fecha Operativa: 2026-09-18` — a business date, rendered in mono, that looks like a freshness stamp and is not one.
- **Why it matters**: A director opens this at 14:00 during a rush and reads "0 colaboradores activos" as a live fact. It may be a 09:00 snapshot. In a compliance context (NOM-251 cold-chain, missing cold-room logs) acting on stale reassurance is the exact failure the product exists to prevent.
- **Fix**: Either make it live or stop saying it. Minimum: add a `última actualización` stamp from the newest row the service touched, plus a manual "Actualizar" affordance and `router.refresh()` on `visibilitychange`. Better: a 60s `router.refresh()` while the tab is visible, and demote the word "en vivo" wherever data is request-scoped.
- **Suggested command**: `$impeccable harden` (freshness contract) then `$impeccable animate` (refresh affordance)

### [P1] The reassurance banner contradicts the matrix three inches below it
- **What**: `LivePulseBanner` renders a green pill — *"Servicio Estable sin Alertas Críticas"* — whenever `criticalAlertsCount === 0`. That counter is `rushAlerts.length`, filtered to `severity === "CRITICAL" || "FATAL"` (`lib/services/live-command-service.ts:336-361`). In the same viewport the matrix flags **all 3 of 3 branches** as "*Requiere supervisión*" with `DELAYED` openings, `CRITICAL` staffing ("0 de 4 activos"), and no cold-chain log today. Two tiles in the banner state the contradiction in the same breath: "Aperturas a Tiempo **0%**" and "Personal en Piso **0%** cubierto" sit above a green "Servicio Estable".
- **Why it matters**: The calm, top-most, widest element wins the scan. This is a false all-clear on the primary screen — the failure mode that makes an owner stop opening the dashboard.
- **Fix**: One state machine for the banner, not an either/or on a narrow counter. Escalate on the union of signals it already has: `openRatePercent < 100`, `staffAttendanceRate < 90`, `criticalAlertsCount > 0`, and branches with `nom251.status !== "OK"`. Reserve green for "all branches opened on time, staffed ≥90%, cold-chain logged" and say the specific thing — *"3 de 3 sucursales con retraso de apertura"* — instead of the generic "Servicio Estable".
- **Suggested command**: `$impeccable clarify` (label + state vocabulary) with a logic fix alongside

### [P1] Exception queues are unreadable: truncated duplicates with no way in
- **What**: `AreaCard` renders `exceptions.slice(0, 3)` inside `span.truncate`, clipped by a flex row. Live output: Inventario shows "Stock bajo en insumo cla…" **three times**, identical; Cumplimiento shows "Score de cumplimiento baj…", "Deadline vencido: Remedia…", "Limpieza de campana atr…"; Personal shows "Cambio de turno: Cita médica …". The detector measured 8 overflow spans between 20px and 150px over their box. There is no `title`, no tooltip, no second line, and the `Badge` next to the text carries only the branch name — never the exception type.
- **Why it matters**: The card's whole job is "which exception do I open". Three identical labels make that impossible, and the 150px-overflow one (Operación) is the widest information loss on the page. This is `Recognition Rather Than Recall` scored 2 — the user must open all three links to learn what they already had space to read.
- **Fix**: Give the text two clamped lines (`line-clamp-2`, no `truncate`) and let the badge carry the *type*, not just the branch. If three items genuinely share a title, group them: *"Stock bajo en insumo clave ×3"* with the branches as chips. Raise `PREVIEW_COUNT` only after the labels are legible.
- **Suggested command**: `$impeccable layout` (measure + grouping) then `$impeccable clarify`

### [P1] Severity is encoded by colour alone
- **What**: `SEVERITY_STYLES` in `area-card.tsx` maps `fatal | critical | high | warning | info` to five tinted `Badge` classes. The badge's text content is the branch name; severity exists only as background/text colour. No icon, no text, no `aria-label`, no `sr-only` span. Confirmed on all three severity levels in the live DOM.
- **Why it matters**: `fatal` and `critical` are indistinguishable from `high` to anyone who can't resolve those adjacent red/amber tints — and to every screen-reader user they don't exist at all. On a compliance surface, "which of these is fatal" is not decoration.
- **Fix**: Add a severity glyph (`AlertOctagon` / `AlertTriangle` / `Info`) plus an `sr-only` word inside the badge, and keep the branch name as a separate chip.
- **Suggested command**: `$impeccable audit` (a11y pass over the dashboard surface)

### [P2] Loading skeletons promise a dashboard that no longer exists
- **What**: Three independent mismatches. `app/dashboard/loading.tsx` renders `MetricCardSkeleton` + **two `ChartSkeleton`s** — the current page contains no charts at all. `page.tsx:44` uses `<MetricCardSkeleton count={6} />` for `GroupAreaOverview`, whose `MetricGrid` default is `lg:grid-cols-4` while the real content is `lg:grid-cols-3`. `page.tsx:53,57` use `DataTableSkeleton columns={5}` while `recent-workflows-table` renders **6** columns.
- **Why it matters**: On every cold load the user sees 300px-tall chart placeholders that collapse into nothing, a 4-column grid that reflows into 3, and a 5-column table that grows a sixth — a visible layout jolt on the app's landing surface, on a page whose data sources are the slowest in the product.
- **Fix**: Make `loading.tsx` mirror the real composition (banner → 6 area cards → 6-col table). Pass `columns={6}` and a 3-column grid to the skeletons.
- **Suggested command**: `$impeccable polish`

### [P2] Flat-by-default is violated on the two cards that matter most
- **What**: `live-pulse-banner.tsx:31` and `live-command-matrix.tsx:67` both carry `shadow-xs`. DESIGN.md §4: *"The Flat-By-Default Rule. Surfaces are flat at rest. No box-shadows on cards, dropdowns, or containers."* and §6 *"Don't use shadows on cards, containers, or the sidebar."* There are 16 `shadow-xs` occurrences repo-wide.
- **Why it matters**: Depth on this page now has three competing cues — tonal layering, 1px borders, and shadow — and the shadow lands on exactly the two components that define the brand's flat identity. The detector can't see Tailwind classes, so this drifts uncaught.
- **Fix**: Drop `shadow-xs` from both; the banner already separates from `bg-muted/20` by tone plus border. If the intent was elevation on the hero, express it with a slightly stronger border token instead.
- **Suggested command**: `$impeccable polish`

### [P2] Frame-inside-frame density
- **What**: 36 nested containers detected. Anatomy of one branch row: bordered card (`rounded-xl border`) → `bg-muted/20` filter strip → 4× `rounded-lg border border-border/50 bg-background/50` tiles → tinted `Badge`s with borders. The KPI banner adds a second full card around four more bordered tiles, each with a tinted icon chip. Finanzas renders a permanently empty card *by design* (documented in `group-area-overview.tsx`) sitting next to 11 real inventory exceptions.
- **Why it matters**: Every frame is a 1px border the brief was written to avoid, and four co-equal tiles per branch means the eye gets no rank — the "Operación normal" branches and the "Requiere supervisión" branch have identical visual weight until you read the colour.
- **Fix**: Two layers maximum per branch (row + semaphore group). Remove chip borders, use a single tone for the semaphore track, and let the delayed/critical row carry a background tint instead of a border. Give the empty Finanzas card real content (e.g. the last treasury close) or drop it to a one-line strip.
- **Suggested command**: `$impeccable layout` then `$impeccable distill`

### [P2] Regulatory jargon with no in-product help
- **What**: "M17 / NOM-251" sits as the second line of the "Riesgos Operativos" KPI — the code is rendered smaller and lighter than the label, so it reads as a source attribution for a number it doesn't explain. Also unlabelled: "POS", "Ficha 360°", "Consejo del Grupo" (in the section title "Salud Operativa por Áreas del Grupo"), "Liga de Sucursales", "rush". The four KPI tiles are bespoke `div`s, not `MetricCard`, so they inherit none of the NOM-251 tooltips the shared component offers (verified: `title: ""`).
- **Why it matters**: The stated audience includes ADMINs who are not compliance specialists. "M17" is an internal incident taxonomy; the person reading it can't act on it. Help scores 1 because there is no help surface on this page at all.
- **Fix**: Give the tiles the same tooltip treatment as `MetricCard`, and link the compliance tile to `/dashboard/compliance` with a plain-language definition. Rename "M17" to what it means, or drop it from the KPI header.
- **Suggested command**: `$impeccable clarify`

## Persona Red Flags

**Don Roberto (franchise owner, 3–15 branches, ADMIN — project persona from PRODUCT.md)**
- Opens at midday, reads the largest green element ("Servicio Estable sin Alertas Críticas"), closes the tab. Three of his three branches have delayed openings, zero staff on the floor, and no cold-chain log — all of it visible but *below* the reassurance.
- "0 colaboradores activos" across the whole chain is presented in the same size and weight as "0 / 3 tiendas" and "$0". Nothing tells him the first is an emergency and the last two are just the start of the day.
- "Inventario 11 / Inventario $28,653" with three identical "Stock bajo en insumo cla…" rows gives him a count he can't act on without clicking through three times.
- The one card he'd most want (Finanzas) is permanently empty, and the page says nothing about why.

**Sam (accessibility-dependent, screen reader + keyboard)**
- `AreaCard` severity is colour-only: NVDA reads "Condesa, Incumplimiento en limpieza" with no indication whether that is `fatal` or `info`. Both render in the same red tint (`fatal` and `critical` map to identical classes).
- The matrix filter pair (`Todas (3)` / `Con Alertas 3`) are plain `<button>`s with no `aria-pressed`, so the toggle state is never announced after activation.
- The matrix search is a placeholder-only `Input` ("Buscar sucursal...") with no `<label>`, no `id`, no `aria-label`.
- The 8 truncated exception titles are read as clipped strings ("Stock bajo en insumo cla…") with no `title` or `aria-label` fallback.
- Positive: `prefers-reduced-motion` is handled globally in `globals.css:207`, so the `animate-ping` liveness dot and `animate-pulse` icons degrade correctly — that one is genuinely done.

**Casey (distracted mobile supervisor, 390×844, one thumb)**
- The page title **wraps to four lines** on mobile: "Pulso / en / Vivo / del / Turno" — a ragged 100px column wedged beside the "Fecha Operativa" badge. The `h2` has no `min-w-0`/`truncate` and is being squeezed by the badge in a flex row.
- Every branch semaphore tile truncates its own content on a 2-column grid: "Pendiente" (`Badge`) overlaps "Pendiente de" then "apertura"; "¡Fuera de norma!" clips; "Sin registro" (`Badge`) overlaps "NOM-251"; "Venta Hoy" wraps to "Venta / Hoy", "En curso" to "En / curso". Six of eight tiles are visibly broken.
- Page height is 2,442px desktop and roughly 3× that on mobile, so the branch he needs is a long thumb-scroll away, with the filter strip at the top and each branch's "Ficha 360°"/"Ver N alertas" action at the **bottom-right** of its own row — not in the thumb zone and not sticky.
- The overlap evidence indicates fixed-width children inside `flex items-center justify-between` with no `min-w-0` — the same defect that created the 9 detected overflows.

## Minor Observations

- **Transition slop**: the pulse banner uses `transition-all`, which animates layout-affecting properties. Scope it to `transition-colors`.
- **Measure**: the page description runs ~98 chars/line (`line-length`). Cap at ~80 or split it.
- **Cramped padding**: the `recent-workflows-table` empty-state row sits flush against its top border (`cramped-padding`).
- **`bg-emerald-400/500`** in `live-pulse-banner.tsx:36-37` is the only raw Tailwind palette colour on the surface; it should be `--success`.
- **Three KPI tautologies**: "Aperturas a Tiempo 0% / 0 / 3 tiendas", "$0 Venta Acumulada", and "Riesgos Operativos 0" are all restatements of a single fact (the shift has barely started). Consider collapsing the row into one sentence on a cold shift rather than four hero-metric tiles — DESIGN.md §6 bans the hero-metric template as a default layout.
- **Code comment lint**: `M17` appears in `LivePulseBanner` as a hard-coded string; if this taxonomy ever changes it will silently rot.
- **Number formatting**: `formatMetric` renders "0.3 ausencias" and "$28,653" with `toLocaleString("es-MX")`, but the KPI banner formats sales with `Intl.NumberFormat` inline in two components — one shared formatter would prevent drift.

## Questions to Consider

- If the banner could only say one thing, would "Servicio Estable" ever be it — or is the honest top-line always the count of branches that are *not* normal?
- What does a branch row look like if it drops its four borders and keeps one coloured state track? Does the eye land on the broken branch faster with less frame, not more?
- The page is called a live command center, but every number in it is a request-time snapshot. Which is the product: a live monitor, or a shift briefing? The title, the copy, and the architecture currently disagree.
- Finanzas is a permanently empty card with a live-looking header. What would make it worth its 240px — and if nothing yet, why is it rendered instead of hidden?
- "Stock bajo en insumo clave" appears three times with three different branches. Is that three exceptions, or one exception with three locations? The card currently can't tell the difference — and neither can the owner.