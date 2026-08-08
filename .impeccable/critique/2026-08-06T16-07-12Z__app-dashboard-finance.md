---
target: app/dashboard/finance (joint run with sales)
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 3
timestamp: 2026-08-06T16-07-12Z
slug: app-dashboard-finance
---
Method: dual-agent (A: design review · B: detector + browser evidence), isolated and parallel.
Scope: 7 routes — `app/dashboard/finance/{cash-flow,control-interno,expenses,fiscal,petty-cash}` + `app/dashboard/sales/{,mapping}` — plus their imported components in `components/finance/*` and `components/sales/*`.
Browser inspection: attempted and blocked. Dev server started clean (Next 16.1.6, ready 17s, `/` → 200), but all three target routes 307-redirect to `/sign-in?callbackUrl=…`. No tab was opened, no screenshots taken, no overlay injected — **there is no visual overlay in your browser**. Server was stopped and verified down. Findings below are source- and detector-grounded, not render-grounded.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Two branch scopes disagree on screen at once (`layout.tsx:72` header vs `expenses:251` local); `control-interno` swallows both fetch failures (`:39-42`, `:57-60`) and shows nothing. |
| 2 | Match System / Real World | 2 | "Ventas y POS **(M13)**" leaks an internal module code into the h1 (`sales:160`); "Runway" (`cash-flow-calendar.tsx:379`) is VC vocabulary for a taquería; Food Cost / Labor Cost left in English; channel shown as raw enums SALON/DELIVERY. |
| 3 | User Control and Freedom | 3 | Cancel/undo present in every dialog; `fiscal:62` `isLocked` prevents a double timbrado. Docked for no exit from the 100-row-capped log and no way to clear the aggregator scratchpad. |
| 4 | Consistency and Standards | 1 | Two branch scopes + two date scopes; three labels for one concept ("Todas las sucursales (consolidado)" / "Todas las sucursales" / "Vista consolidada (todas)"); all 7 pages bypass `PageHeader`/`PageContainer` that the rest of the dashboard uses; 6 copies of `formatMXN`; raw hex chart colors beside `var(--chart-N)` in one file. |
| 5 | Error Prevention | 2 | Strong two-party gates on expenses and fiscal — **zero gate on a physical cash withdrawal** (`petty-cash-register.tsx:106-186`); `parseFloat("1e5")` → $100,000 from four keystrokes (`sales:578`); manual corte never checks efectivo+tarjeta+otros ≈ total. |
| 6 | Recognition Rather Than Recall | 2 | User retypes their own company's 13-char RFC on every CFDI lookup (`fiscal-invoice-validator.tsx:99-108`); aggregator conciliation demands figures from another portal and states it discards them (`sales:509-511`); approval thresholds surface only when you can't act (`expenses:176-180`). |
| 7 | Flexibility and Efficiency | 2 | No bulk approve, no sort on any column of any table in the module, no status filter on the expense queue, no saved views, no pagination on cortes or gastos. |
| 8 | Aesthetic and Minimalist Design | 2 | `cash-flow-calendar` stacks 8 top-level blocks; `sales` ships an 11-column table where each row is visually 3 rows tall; detector confirms the type ramp collapsed below its own floor (16× 9–11px). |
| 9 | Error Recovery | 2 | Four pages do this genuinely well (typed error + `Reintentar`), but on a page titled **Control Interno** a dropped connection renders as an affirmative statement of compliance. |
| 10 | Help and Documentation | 2 | Contextual help exists but 3 of 4 instances are `<span title>` — keyboard-unreachable and SR-invisible — the exact bug `sales:161-170` documents having fixed and did not propagate. |
| **Total** | | **20/40** | **Acceptable — significant improvements needed** |

## Design Specificity Verdict

**LLM assessment: ~30% authored, ~70% category-interchangeable.** Swap the Spanish strings for English and this is a generic multi-tenant B2B admin. The domain knowledge lives in the data model and in three confirm dialogs; it never reached the composition, the IA, or the visual language.

Structural sameness is near-total. All seven files open with the identical skeleton: `container mx-auto py-6 space-y-6` → header flex row → `<h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">` + `Icon h-7 w-7 text-primary` + muted subtitle → branch `<Select>` → `<Card>` → table (`cash-flow:53-79`, `control-interno:80-108`, `expenses:239-269`, `fiscal:113-121`, `petty-cash:146-179`, `sales:155-184`, `mapping:98-119`). Five of seven ship a byte-identical branch Select. Meanwhile **none** of the seven use `components/shared/page-header.tsx` that `app/dashboard/page.tsx:84-89` and `inventory/expirations/page.tsx:15-21` use. They are simultaneously identical to each other and inconsistent with the product — no per-page authorship, no system benefit.

Missed product character, specifically:
- **No IVA anywhere in a Mexican finance module.** `expense-form.tsx:173-183` captures one flat `Monto ($ MXN)` — no subtotal/IVA split, no supplier RFC, no UUID linking a gasto to its CFDI. The CFDI validator is a disconnected lookup that stores nothing and links back to nothing. `fiscal:185-192` makes `Período` a free-text `"2025-01"` input when Mexican payroll runs on quincenas.
- **Money typography.** Six independent re-implementations of `formatMXN` despite `formatCents` at `lib/utils.ts:20`; consequently zero `tabular-nums` in the module, so peso columns don't align digit-to-digit (`expenses:351`, `sales:422`). `DESIGN.md:176` reserves Mono for "numeric data in tables" — never used once here.
- **`shift` is the one field in the schema that says *restaurant*** and it renders as bare `capitalize` grey text (`sales:413-415`) — no badge, no filter, no analytics split. Matutino vs vespertino variance is the daily management question and the UI can't ask it.
- **No per-branch comparison anywhere.** The primary persona oversees 3–15 branches; the only two views are "one branch" or "flat consolidated blob." `petty-cash:247` says "3 de 7 sucursales bajo umbral" and offers no way to learn *which three* short of seven manual selections — on the page whose job is deciding where to send cash.
- **WhatsApp**, which `DESIGN.md:127` calls a first-class interface, appears once across all seven pages: as a green badge string (`sales:110`).
- **A named DESIGN.md rule broken outright.** `DESIGN.md:275` — *"Don't use the hero-metric template as a default layout pattern."* `cash-flow-calendar.tsx:317-405` is a literal 3-up hero-metric row; `financial-kpi-cards.tsx:192` is a 3xl hero number with supporting stats.

**Deterministic scan:** 16 findings, exit 2, all one rule — `design-system-font-size` (advisory). All 16 triaged GENUINE, zero false positives. Values of 9px, 10px and 11px, where `DESIGN.md`'s smallest documented step is Label = 12px. Locations: `control-interno:121`, `expenses:176,348`, `fiscal:270`, `sales:165`, `audit-log-table:85,90`, `excepciones-panel:95,101`, `expense-form:242`, `pnl-branch-table:386`, `financial-kpi-cards:156,172,185`, `sales-dashboard:113,191`. The usage is internally consistent (10px = table micro-metadata, 9px = the `?` glyph, 11px = helper text), so this is an undocumented "micro" step the codebase settled on, not 16 accidents — but it corroborates the hierarchy finding from the other direction: `text-xs` is both the default body size *and* nearly the smallest, and the ramp then punches through its own floor rather than establishing a top.

**Where the detector was blind:** it fired zero hardcoded-color findings, yet the design review found hardcoded Tailwind palette in six files — `audit-log-table.tsx:23-29`, `excepciones-panel.tsx:37-47,65`, `fiscal-invoice-validator.tsx:70-73`, `financial-kpi-cards.tsx:29-33,224`, and `components/ui/badge.tsx:22` where the `warning` variant itself is `bg-amber-100`. None carry `dark:` variants, so on `.dark` (`--card: oklch(0.22 0.01 20)`) a HIGH-severity violation card renders as a near-white slab. `statusBadgeClasses` already exists at `lib/utils.ts:30` and is used correctly elsewhere. Treat the clean color scan as a gap in the rule set, not a pass.

**Where the two assessments landed on the same line independently:** `fiscal-invoice-validator.tsx:121-128` — the Total input has `onChange` but no `value` prop, uncontrolled while its four siblings are controlled, so it never clears with the form. Both passes flagged it without seeing each other's output.

## Overall Impression

The engineering judgment in this module is better than the design judgment, and the gap is the story. Someone reasoned carefully about consequences — the expense-approval dialog, `isLocked` after timbrado, the refusal to sum per-branch thresholds into a comforting lie — and then that same care stopped at the edge of the three dialogs where it lives. Everything between them is a filter and a table, seven times.

The single biggest opportunity: **the module has no per-branch comparison, and per-branch comparison is the entire premise of the product.** Every screen can show an owner one branch or an average. The one thing he opened the tablet to find out — which branch is different — is the one thing none of the seven pages will tell him.

## What's Working

1. **The irreversibility gates are authored, not templated** (`expenses:370-439`). The dialog restates *descripción · sucursal · monto* so the approver confirms a specific fact rather than a generic yes; the rejection reason is mandatory at both the guard (`:119`) and the disabled state (`:424-427`); and `e.preventDefault()` at `:428-431` keeps the modal open until the server answers, so an approver on restaurant WiFi never watches a dialog close on a request that silently failed. `fiscal:62` extends it so a second click can't burn a second SAT folio.

2. **The empty-vs-broken distinction is enforced system-wide** — one `EmptyState` primitive applied with a distinct icon, honest description, and real recovery action at `cash-flow:86-95`, `expenses:284-300`, `petty-cash:186-210`, `mapping:137-146`. The comment at `mapping:51-52` records the exact bug it kills: a load error used to render "Sin plantillas configuradas" and invite the user to rebuild config that already existed. Most dashboards this size never make that distinction at all.

3. **Petty cash refuses the additive lie in consolidated view** (`petty-cash:30-35`, `:103-109`). Summing per-branch thresholds would let a chain look healthy while one branch sits at zero, so the code declines to sum, reports "N de M sucursales bajo umbral", suppresses the threshold tick when it doesn't apply (`:259`), and guards the $0-fund NaN% (`:128-136`). It is the only rollup in the set that was designed rather than reduced.

## Priority Issues

### [P0] Fabricated actor names on audit surfaces
- **What**: Five places substitute an invented human for a missing one. `expenses:352` → `{item.requestedByName || "Gerente"}`; `petty-cash-history-table.tsx:112` → `|| "Cajero"`; `petty-cash-history-table.tsx:118` → `{tx.approvedByName || tx.registeredByName || "Gerente"}` rendered beside a green `ShieldCheck`; `sales:482` → `|| "Sistema"`; `mapping:206` → `|| "Admin"`.
- **Why it matters**: These render inside surfaces the product itself calls "Bitácora Auditable" (`petty-cash:282`) and "Bitácora de Autorizaciones" (`control-interno:138`). Line 118 is the severe one: when `approvedByName` is null, the UI silently promotes the person who *took* the money to the person who *authorized* it, and decorates the claim with a security icon. The UI is manufacturing an attribution an auditor will read as fact.
- **Fix**: Render `—` or "Sin registrar" in all five. At `petty-cash-history-table.tsx:114-126`, drop the `ShieldCheck` and `text-success` entirely when `approvedByName` is null and label the row "Sin autorización registrada" in muted text.
- **Suggested command**: `/impeccable harden`

### [P0] Caja chica withdrawal: no gate, no evidence, self-authorized
- **What**: `petty-cash-register.tsx:106-186` commits a cash withdrawal on one button press. No confirmation dialog. No photo upload — while `petty-cash:272-274` advertises "movimientos auditados con firma y comprobante fotográfico" and `petty-cash-history-table.tsx:73` renders a "Comprobante" column this form can never populate. And `:167-175` labels a plain text input "Notas o Justificación de Autorización" with placeholder "ej. Autorizado por gerente de turno" — the authorization is typed by the person removing the cash.
- **Why it matters**: This is the module's highest-frequency money-out event and its weakest control. `expenses` gates a *future* payment behind a two-party dialog while the *immediate physical* cash removal has none. The product promises an audit trail and then builds the one form that cannot produce one.
- **Fix**: (a) Wrap submit in the same `AlertDialog` pattern as `expenses:371-439`, restating monto · concepto · sucursal · saldo resultante. (b) Require the evidence photo when `mode === "OUT"` — the uploader already exists at `expense-form.tsx:206-245`. (c) Either capture a real approver identity or rename the field to "Nota" and stop rendering it as an authorization at `petty-cash-history-table.tsx:120-124`.
- **Suggested command**: `/impeccable harden`

### [P1] The arqueo feature depends on a number no form can capture
- **What**: `sales-cut-upload.tsx:83-93` posts `totalSales`, `cashSales`, `cardSales`, `otherPayments`, `ticketCount` — never `cashCountedCents`. Yet `sales:400` reads `cut.cashCountedCents` to render the entire Arqueo/Dif. column (`:438-460`), and `sales:229-257` raises a chain-wide destructive banner off `computeCashVariance` (`lib/sales/cash-variance.ts:31`), which returns `null` whenever that field is absent.
- **Why it matters**: The reconciliation loop the sales page leads with is structurally unreachable from the UI that exists. A GERENTE closing the till has no field for "efectivo contado", so every manually-entered corte reads `—` and the banner can never fire. The feature only works through the WhatsApp/Smart Link path that `sales:558` mentions and does not link to.
- **Fix**: Add "Efectivo contado en caja" beside Efectivo in `sales-cut-upload.tsx:277-311` and compute the diferencia live inside the dialog before submit. The moment the cash is still on the counter is the only moment a miscount is fixable.
- **Suggested command**: `/impeccable shape`

### [P1] `control-interno` presents a failed fetch as a compliance pass
- **What**: `control-interno:39-42` and `:57-60` catch both fetches and `console.error` only — no error state exists on the page. The UI then renders `audit-log-table.tsx:44-49` → "No hay entradas en la bitácora para el período seleccionado", and `excepciones-panel.tsx:62-73` → a green circle plus "Sin excepciones detectadas / Todos los gastos cumplen con las políticas de control interno." (That all-clear also renders an `AlertTriangle` glyph tinted green — the warning icon used as the reassurance icon.)
- **Why it matters**: On a page titled Control Interno, a dropped connection renders as an affirmative statement of compliance. This is the exact failure mode the sibling page documents having fixed (`mapping:51-52`), and the fix pattern is already implemented four times in this same module.
- **Fix**: Add `auditError`/`violationsError` state and render the `EmptyState` + `Reintentar` block from `expenses:283-293`. A compliance surface's failure state and its clean state must never share a rendering.
- **Suggested command**: `/impeccable harden`

### [P1] Two competing branch scopes (and two date scopes) on every page
- **What**: `app/dashboard/layout.tsx:72` mounts `BranchScopeControl`, documented at `components/shared/branch-scope-control.tsx:56-65` as the *"single source of scope for the dashboard"*, cookie-backed and cross-page. All five branch-aware target pages ignore it and keep a local `useState("ALL")` Select: `cash-flow:17,64-78`; `control-interno:17,92-106`; `expenses:68,251-265`; `petty-cash:45,159-173`; `sales:63,200-218` **and again at** `:269-283`. `/dashboard/sales` also runs a second date range (`:288-341`) against the header's date dropdown.
- **Why it matters**: The owner sets "Sucursal: Polanco" in the header, navigates to Gastos, and reads a table for *all* branches while the header still reads Polanco. Two controls, same label, different answers, no indication which governs. On `/dashboard/sales` the count reaches **ten scope controls simultaneously visible** (header branch + header date + 8 in the cuts-tab filter row at `:268-357`).
- **Fix**: Delete the local Selects and consume `useBranch()` from `lib/branch-context`. If a page genuinely needs independent scope, suppress the global control on that route — shipping both is the only configuration that cannot be correct.
- **Suggested command**: `/impeccable distill`

## Cognitive Load — 5 of 8 fail (high; critical fix needed)

- **Single focus — FAIL.** `cash-flow:60` states its own four-question mandate: "¿Me alcanza? · ¿En qué gasto? · ¿Qué semanas son críticas? · ¿Qué facturas están vencidas?" Four jobs, one scroll. `sales` holds analytics + ingestion + a ledger + a scratchpad calculator.
- **Chunking ≤4 — FAIL.** `cash-flow-calendar.tsx` renders 8 top-level blocks (`:317`, `:411`, `:438`, `:517`, `:624`, `:676`).
- **Grouping — PASS (caveat).** The filter governing the table sits in the page header, far from it (`expenses:251` vs `:302`).
- **Visual hierarchy — FAIL.** `text-xs` is the default *and* nearly the smallest size; expense rows are `text-xs` (`:319`) and Monto — the scan target — is `text-right font-bold` at that same size (`:351`), competing with a truncated description at identical size. `petty-cash:236` is the one page that establishes a hierarchy and it is the best-composed of the set.
- **One thing at a time — PARTIAL.** Dialogs are clean; the cuts tab has a red diff banner (`sales:245`), an upload CTA (`:226`), and a conciliation table all claiming "do this now."
- **≤4 options per decision point — FAIL, three named screens.** `sales:268-357` = 8 filter controls + 2 header controls = 10 scope controls in one viewport. `sales:376-388` = 11 columns where the Formas-de-Pago cell stacks 3 lines and Arqueo stacks 2–3, making every row visually 3 rows tall. `expenses:306-314` = 9 columns with the only actionable one last, past the horizontal-scroll boundary.
- **Working memory — FAIL.** `AggregatorConciliation` (`sales:530-634`) asks the user to hold Rappi/Uber/Didi settlement figures from an external portal, then states outright that it throws them away (`:509-511`).
- **Progressive disclosure — PARTIAL PASS.** Done correctly twice, both in `cash-flow-calendar.tsx` (`:539-556`, `:489-506`). Nowhere else.

## Emotional Journey

**Peak — there isn't one.** Nothing acknowledges a good day. Close all branches cuadrado, zero excepciones, cash flow positive: the reward is an unchanged grey table.

**End — negative by construction.** The cuts tab opens with a destructive-bordered banner counting cortes con diferencia (`sales:245-256`) before any positive framing, and its only remedy is prose: "Revisa los cortes marcados en rojo." It *names* the branches and links to none, filters to none, scrolls to none. The last thing a GERENTE sees at 11pm is an accusation with no path.

**Valleys.** Corte de caja at 11pm on a phone is the most emotionally loaded moment in the product, and the form captures no counted cash, gives no running efectivo+tarjeta+otros vs total check, and offers no "esto es lo que vas a reportar" summary — she presses Registrar and learns the outcome from a toast. Caja chica commits physical cash removal on a single press. And after each approval, `fetchExpenses()` (`expenses:144`) refetches the whole list and resets scroll, so a 30-approval session loses its place 30 times.

**Reassurance where it exists is real.** `expenses:385-389` and `fiscal:286-289` both name the actual consequence in the operator's terms ("compromete el pago y queda registrada en la bitácora"; "consume un timbre… requiere una cancelación formal"). At two of the four highest-stakes moments the product has, the reassurance is correct. It is entirely absent from the other two.

## Persona Red Flags

**Alex (power user — ADMIN clearing Monday's queue).** No status filter on `expenses`, so pending rows interleave with full history (`:318`) and he visually hunts amber badges across 9 columns. No sort on any column of any table in the module. No bulk select. Each approval costs 2 clicks + a modal, then loses his scroll position.

**Sam (a11y / keyboard) — the deepest deterministic evidence.** `financial-kpi-cards.tsx:184-188` and `sales-dashboard.tsx:112-116`, `:190-194` are `<span title>` help affordances: not focusable, not announced — while `sales:163-170` solves the identical case with `<button type="button">` + `aria-label` + `focus-visible:ring-2` and carries an inline comment explaining exactly why. The fix exists in the repo and was not propagated. Beyond that: **46 scope-less `<th>`** because `components/ui/table.tsx:68` passes `TableHead` through with no default `scope="col"`; **9 `<Label>`/`<Input>` pairs with no `htmlFor`/`id`** in `fiscal:153-186` and `fiscal-invoice-validator.tsx:90-132` — inconsistent within one card, since `fiscal:196,210` do wire them correctly; **8 controls with no accessible name at all**, including the liquidation input at `sales:591` and six branch SelectTriggers; **an unlabeled icon-only destructive delete** at `mapping:180-188`; **no `<caption>` on any of the 6 visible data tables** (present only on the 3 sr-only chart tables); and **color-only status** at `control-interno:119-127`, where "critical" vs "warnings only" is carried by hue alone. **Contrast:** `--warning` is `oklch(0.72 0.15 80)` used as *foreground* on a 10% tint (`expenses:219` "Pendiente", `petty-cash-history-table.tsx:98`, `sales:469`) — roughly 2.3:1, applied to the most-scanned element in the module.

**Riley (stress tester).** `petty-cash:72-86` fires 2×N parallel fetches for "ALL" — 30 requests at 15 branches — and any that fail are silently dropped (`:82` → `fund: null` → excluded from the sum at `:101-102`), so **a consolidated chain balance can be understated and presented as authoritative.** `sales:578` — `parseFloat("1e5")` yields 100000, a $100,000 retention figure from four keystrokes. `fiscal-invoice-validator.tsx:121-128` — uncontrolled Total input that never clears (found independently by both assessments).

**Casey (mobile — GERENTE on a phone in the kitchen).** 11-column and 9-column tables in `overflow-x-auto` with the only actionable column last. Approve/Reject buttons are `h-7` = 28px (`expenses:190`); date presets `h-7 px-2` (`sales:312`) — both well under the 44px touch minimum. `petty-cash-register.tsx:83-92` puts two `<Button>`s inside a `<div>` wrapped by `DialogTrigger asChild`, so the trigger role and aria state land on the div: both buttons open the dialog and neither announces its state.

**Jordan (first-timer GERENTE).** Lands on a page titled "Ventas y POS **(M13)**". `mapping-template-form.tsx:171` asks him to map to "campos canónicos." Two of the seven pages are unreachable by navigation at all.

**Doña Marisol, GERENTE, closing at 11:40pm on a phone (project persona).** She opens Caja Chica to log the $300 she gave the gas guy: "Registrar Retiro" is conditionally hidden until she switches off the default "ALL" (`petty-cash:175`), so the action she came for is invisible on arrival. When she finds it, it commits with no confirmation and no photo. Then she registers the corte and finds no field for the cash she just counted. Tomorrow the owner sees `Diferencia: —` and assumes she skipped the arqueo.

**The owner reviewing seven branches on a tablet (project persona).** He wants to know who is bleeding. `petty-cash:247` says "3 de 7 sucursales bajo umbral" and won't say which three. `expenses` has no status filter. `cash-flow` reloads a whole projection per branch with no comparison view.

## Minor Observations

- **Two routes are orphans.** Grepping for `dashboard/finance/(control-interno|fiscal)` across all `.ts/.tsx` returns zero matches; the sidebar "Finanzas" group (`app-sidebar.tsx:344-373`) lists five items and includes neither. Both are reachable only by typing the URL — and they are the two pages with the most Mexican specificity in the codebase.
- **[P2] Hardcoded palette breaks dark mode and bypasses the badge system** — `audit-log-table.tsx:23-29`, `excepciones-panel.tsx:37-47,65`, `fiscal-invoice-validator.tsx:70-73`, `financial-kpi-cards.tsx:29-33,224`, and `components/ui/badge.tsx:22` itself. Route through `statusBadgeClasses` (`lib/utils.ts:30`) and add a darker `--warning-text` token (~`oklch(0.48 0.13 80)`) to fix the contrast failure in the same pass.
- **[P2] 16 sub-ramp font sizes** (9/10/11px) below the 12px Label floor. Either add a documented `micro` step to DESIGN.md or snap them to 12px — the current state is an undocumented ramp the detector will keep flagging.
- **Flat-by-default broken once**: `shadow-sm` on the evidence image at `petty-cash-history-table.tsx:161`, against `DESIGN.md:212`.
- Chart categories use raw hex (`cash-flow-calendar.tsx:111-120`) while bars in the same file use `var(--chart-N)` (`:761-767`) — the legend can't follow the theme.
- `control-interno:148-153` handles the 100-row cap with exactly the right disclosure ("Mostrando las N más recientes de M totales"). `expenses` and `sales` have no cap and no paging — at 15 branches × 90 days, `sales` renders thousands of 3-line rows in one DOM.
- **`DESIGN.md` contains section 3 (Typography) twice**, at lines 163-179 and 181-198, with slightly different font declarations. The design source of truth has a merge artifact, and the detector reads its ramp from it. Both assessments found this independently. Reported, not repaired.

## Questions to Consider

1. If a GERENTE can register a cash withdrawal *and* type its own authorization *and* the table then renders that as an approval with a green shield — what is the control-interno module actually controlling?
2. Why does the product ask an owner to choose between "one branch" and "all branches averaged" when the entire premise of Pulso is that he has 3–15 of them and needs to know which one is different?
3. The two pages with the most Mexican specificity — CFDI validation and control interno — are the two nobody can navigate to. Is fiscal a feature, or a demo?
4. All seven pages lead with a filter and a table. If you deleted the h1 and the icon, could a GERENTE tell Gastos from Caja Chica from Cortes in under two seconds?
5. `DESIGN.md:127` calls WhatsApp a first-class interface. It appears once, as a badge label. Which is the real product — the dashboard, or the WhatsApp loop the dashboard renders the exhaust of?
