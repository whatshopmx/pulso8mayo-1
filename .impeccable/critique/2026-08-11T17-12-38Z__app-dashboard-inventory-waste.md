---
target: app/dashboard/inventory/waste
total_score: 18
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
timestamp: 2026-08-11T17-12-38Z
slug: app-dashboard-inventory-waste
---
Method: dual-agent (A: design review · B: detector + browser evidence)

Target: `app/dashboard/inventory/waste/` — "Registro de Mermas" (page.tsx, waste-client.tsx, components/inventory/waste-form.tsx)
Mode: **Operate** — success is a completed, accurate merma record, usually on a tablet, usually repeated 4–8× at cierre de turno.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | `key={refreshKey}` (`waste-client.tsx:23`) remounts the whole grid on every save — page flash, catalog refetch, no skeleton, and no on-screen record that anything was saved |
| 2 | Match System / Real World | 1 | Postgres enum keys printed to kitchen staff — "Caducidad (EXPIRED)", "Derrame (SPILLAGE)"; integer-only quantity in a kg/L kitchen; toast reads "3 UNIT de Jitomate" |
| 3 | User Control and Freedom | 2 | The `Cancelar` button (`waste-form.tsx:497`) is wired to an `onCancel` no caller passes — it is dead, and it sits next to the primary action. No undo/void path after posting |
| 4 | Consistency and Standards | 1 | Three stacked titles saying the same thing; five `AlertTriangle`s on one screen; raw `text-amber-500`/`bg-amber-50` where the sibling `expiration-report.tsx` correctly uses `tone="warning"`; `Trash2` vs `AlertTriangle` for the same concept |
| 5 | Error Prevention | 2 | `reason` defaults to `EXPIRED` — pre-attributes a cause; `maxQuantity` is an HTML `max` only, absent from the zod schema, so over-quantity fails *after* the destructive confirm |
| 6 | Recognition Rather Than Recall | 2 | Product `<Select>` has no search over an unbounded catalog; motive definitions sit in the opposite column from the `Motivo` field |
| 7 | Flexibility and Efficiency | 1 | No "guardar y registrar otra", no recent products, no multi-line entry, and every save costs a remount plus a products refetch |
| 8 | Aesthetic and Minimalist Design | 2 | `PageHeader` + `CardTitle` + in-form `<h3>` whose paragraph repeats the PageHeader description verbatim — three titles before the first field |
| 9 | Error Recovery | 3 | `humanizeWasteError` is the best code on the page; loses a point for keying on English server substrings and for a catalog-fetch failure that leaves the form permanently unusable with no retry |
| 10 | Help and Documentation | 2 | The `Tipos de Merma` glossary is real inline help, but it is placed away from the decision, leaks enum names, and omits `STAFF` and `COURTESY` |
| **Total** | | **18/40** | **Poor — major UX overhaul required** |

All ten heuristics apply; this is an Operate surface.

## Design Specificity Verdict

**LLM assessment: not authored. A shadcn form scaffold with Spanish strings pasted in.** Swap six labels and this page registers IT asset disposals or lab sample discards without a single structural change. Nothing in the composition knows it is about food dying in a kitchen.

The load-bearing evidence:

- **The right column does not earn its half.** `lg:grid-cols-2` gives 50% of the screen to a five-item glossary that never changes and is read once, plus two nav buttons — one of which duplicates browser back and the sidebar. Meanwhile the form is squeezed into the other half, where the `Cantidad / Unidad / Motivo` row collapses on tablet portrait. Reference material gets equal billing with the transaction.
- **The glossary is out of sync with its own form.** It lists 5 motives; the `Motivo` select offers 6; `inventoryWasteReasonEnum` (`lib/db/schema.ts:1177`) has 7. The help omits exactly the two motives a user would hesitate over — and one of them, `STAFF`, isn't merma at all: the API routes `STAFF`/`COURTESY` to movement type `USAGE`, yet the UI still calls it a merma and still shows "Pérdida Estimada".
- **The merma *workflow* path is dramatically more product-aware than this page.** `merma-from-workflow.ts` documents a motive vocabulary of `caducidad / caida / error_cocina / cortesia` — actual kitchen language, including admitting a cooking error — and **requires a photo**. The dashboard form asks for no evidence at all. Two doors into the same table, one designed for a kitchen and one for a CRUD demo.
- **`lot-selector.tsx` already exists** in this repo — FIFO-sorted, expiration-badged — and the waste form doesn't use it. The one place where FIFO and caducidad matter most uses a flat unsearchable `<Select>` over the entire catalog.

The genuinely authored artifacts on this page are the `AlertDialog` copy and `humanizeWasteError`. Everything else is default.

**Deterministic scan: 0 findings, and that number means almost nothing here.** Five detector invocations across all three files returned `[]` and exit 0. A positive control confirmed the detector works — but also proved its reach: **41 of 59 rules require a rendered browser** and were structurally unreachable, and most of the 18 reachable rules scan CSS literals, of which these files contain none (0 `style=` attributes, 0 raw hex, 0 `font-family`/`box-shadow`/`cubic-bezier` across 43 `className=` occurrences). The honest reading is "no regex-detectable CSS-literal anti-patterns in a Tailwind codebase" — near-tautological, not a passing grade. No config suppression was in play.

The gap is measurable: the token-drift violation (`bg-amber-50 border-amber-200`, four raw `text-amber-*` icons) is exactly what the `design-system-*` rules exist to catch, and all four of those rules are browser-only. The design review caught it; the scanner could not have.

**Visual overlays: none.** No browser automation is exposed in this session, and the route is auth-gated behind better-auth + `proxy.ts` RBAC. No overlay exists, and no claim is made about rendered contrast, layout, or runtime behavior.

## Overall Impression

The scaffolding is competent and the two moments where someone actually thought — the confirm dialog and the error humanizer — are genuinely good, better than most codebases ship. But they are islands. The page treats "registrar una merma" as a database INSERT with a Spanish coat of paint, when the real job is a stressed person admitting a loss in eight seconds with dirty hands.

**The single biggest opportunity is inverting the page.** The system already knows, via `/api/inventory/expirations`, exactly which lotes are expired, in what quantity, at what cost. The most common merma event is "the thing the system already flagged went bad" — and the product makes the user re-enter all of it by hand into a blank form, from a screen that also can't represent 0.5 kg.

## What's Working

1. **The `AlertDialog` confirmation (`waste-form.tsx:513-567`) is genuinely well-designed.** It restates the full transaction in natural Spanish with the lote in parentheses, shows pesos with "MXN" explicit, states the irreversible consequence plainly ("descuenta el stock de inmediato y no se puede deshacer"), and disables both actions while submitting so a double-tap can't double-post. The insight is labelling the escape hatch **"Revisar de nuevo"** instead of "Cancelar" — it reframes backing out as diligence rather than failure. That is real design thinking on a destructive write.
2. **`humanizeWasteError` turns server errors into actions.** "El lote seleccionado ya no tiene suficiente stock. *Actualiza la página e intenta de nuevo.*" Every branch names the problem *and* the next move, in Spanish, at the user's altitude. Most codebases ship `error.message` here.
3. **The batch option string collapses three lookups into one line** — `{lote} - Stock: {N} {unidad} - Vence: {fecha}`. Choosing which lote to write off is the only genuinely hard decision on this form (it's a FIFO judgment), and putting stock and caducidad inline means the user never leaves the field to decide.

## Priority Issues

### [P0] Fractional quantities are impossible, so the merma data is systematically wrong
**Verified:** `inventory_waste.quantity` is `integer("quantity").notNull()` while `unit` is free text carrying `KG` and `L`. The form enforces it twice more: `z.coerce.number().min(1)` and `<Input type="number" min="1">` with default step 1.
**Why it matters:** most restaurant merma is sub-unit — 0.4 kg of lechuga, 1.5 L of crema, partial trays. Users will round up (inflating loss), round down to zero and abandon (hiding loss), or stop logging small merma entirely. Every downstream number — merma %, food-cost variance, the estimated loss on the expirations dashboard — inherits the error. This is a data-integrity bug wearing a UI costume.
**Fix:** migrate `quantity` (and `inventoryMovements.quantityChange`) to `numeric(12,3)`; `step="0.001"` + `inputMode="decimal"`; zod `.positive()` and `.max(maxQuantity, 'Solo quedan {N} {unidad} en este lote')` so over-quantity fails in the styled `FormMessage` *before* the destructive dialog.
**Suggested command:** `/impeccable harden`

### [P1] Half the screen and the top third of the form are spent on things nobody reads
**What:** `lg:grid-cols-2` (`waste-client.tsx:23`), the static `Tipos de Merma` glossary, the `Acciones Relacionadas` card, plus three stacked titles where the in-form paragraph repeats the PageHeader description verbatim.
**Why it matters:** on a kitchen tablet in portrait the grid collapses and the glossary becomes 400px of scroll *below* the form that nobody will ever reach; on desktop it steals the space the form needs to stop stacking. A gerente logging six mermas re-scrolls past three redundant titles every time.
**Fix:** delete the in-form `<h3>` and the `CardDescription`. Kill the glossary — move each motive's one-line definition into its `SelectItem` as secondary text, where the decision happens, without the enum keys. Kill "Volver al Inventario". Go single-column at ~640px, and give the reclaimed space to **the last 5 mermas registered today** — `GET /api/inventory/waste` already exists and no UI consumes it.
**Suggested command:** `/impeccable distill`

### [P1] A dead "Cancelar" button sits next to the destructive action
**Verified:** `waste-form.tsx:497` renders `onClick={onCancel}`; `onCancel` is optional and the single call site (`waste-client.tsx:33`) passes only `branchId`, `preselectedItemId`, `onSuccess`. It is `undefined`.
**Why it matters:** a user who half-filled the form, realized it's the wrong lote, and taps "Cancelar" gets silence. A dead control adjacent to a destructive action erodes trust in the whole form — the next thing they doubt is whether "Registrar Merma" did anything either.
**Fix:** render it only when provided (`{onCancel && ...}`), and on this page replace it with `Limpiar` wired to `form.reset()`, or drop it.
**Suggested command:** `/impeccable harden`

### [P1] Repeat-entry ergonomics: full remount, lost focus, no receipt
**What:** `key={refreshKey}` on the grid wrapper unmounts and remounts `WasteForm` on every success, re-running the products fetch and discarding all state — on top of the `form.reset()` that already ran.
**Why it matters:** the real usage scene is 4–8 mermas in a row at cierre de turno. Each costs a round-trip with a disabled product select, a page flash, and focus dumped to `document.body` (Radix restores focus to a trigger that no longer exists). There is no session tally and no last-5 list, so by merma #4 the user cannot tell whether they logged the tomatoes twice.
**Fix:** drop the `key` remount; cache products via TanStack Query per repo convention; after save `form.reset({ itemId: previousItemId })` and focus `Cantidad`; add "Guardar y registrar otra"; render a live "Registradas hoy: N · $X" strip with a 30-second undo.
**Suggested command:** `/impeccable optimize`

### [P2] Token drift that breaks dark mode at the one moment the app talks about money
**What:** `waste-form.tsx:468` uses `bg-amber-50 border-amber-200 text-amber-900`; four more raw `text-amber-500/600` icons across `page.tsx:37`, `waste-client.tsx:46`, `waste-form.tsx:258`. The system defines `--warning` and a purpose-built `--warning-text`, and `expiration-report.tsx` already uses `tone="warning"` correctly.
**Why it matters:** `bg-amber-50` has no dark-mode counterpart — in dark mode the "Pérdida Estimada" banner becomes a glaring near-white rectangle in a dark form, at 2am close-out on a dimmed kitchen tablet. The detector's `design-system-*` rules would have caught this, but they are browser-only and could not run.
**Fix:** `bg-warning/10 border-warning/25 text-warning-text`; swap the four raw amber icons for `text-warning-text`. Separately, reduce five `AlertTriangle`s to at most one and align the page icon with the inventory dashboard's `Trash2`.
**Suggested command:** `/impeccable colorize`

## Persona Red Flags

**Alex (impatient gerente, 6 mermas at cierre de turno):** Every save flashes the page and refetches the catalog with the `Producto` select **disabled** reading "Cargando productos..." — six times, for a catalog that hasn't changed. No "guardar y registrar otra", so after `form.reset()` the product he's about to log a second lote of is gone and he re-picks it from an unsearchable flat list. `Unidad` is a permanently disabled `<Select>` eating a full third of the `Cantidad/Unidad/Motivo` row. `Motivo` defaults to `EXPIRED`, so his speed actively corrupts the motive distribution. No duplicate guard, no receipt.

**Sam (keyboard + screen reader):** The heading outline is broken — `CardTitle` renders as a `<div>`, so "Registrar Nueva Merma", "Tipos de Merma" and "Acciones Relacionadas" are not headings; the form's `<h3>` jumps h1→h3 with no `<h2>` on the page. Focus is destroyed on every save and returns to `document.body`, forcing a full re-tab through the sidebar and both cards. `Cancelar` is in the tab order and does nothing. The disabled `Unidad` select is unfocusable, so Sam never learns what unit he is writing off. Over-quantity errors surface as a native browser bubble not wired to `aria-describedby`. Five decorative `AlertTriangle`s lack `aria-hidden` — while the sibling `app/dashboard/inventory/page.tsx` does pass it, so this is drift within one directory. The toast reads the literal enum "UNIT" aloud.

**Chef supervisor on a tablet, greasy hands, mid-service (project-specific):** Touch targets are 36px (`h-9` on Input, SelectTrigger and Button) against a 44px platform minimum — and `SelectTrigger` carries `w-fit` with no `w-full` override on any of the four triggers, so they render shrink-wrapped at content width, reflowing as values change, misaligned against the full-width inputs. Small jittery unaligned targets is the worst possible combination for wet fingers. He cannot log 0.5 kg, which is most of his station's merma. There is no photo capture — despite the merma *workflow* requiring one and the repo already having R2 upload plumbing — even though photographing the spoiled tray is the fastest, most natural action for someone standing in front of it. And the glossary that might help him is below the fold on portrait.

## Emotional Journey

Logging merma is a confession. Often it is somebody's fault, and the person filling this form is frequently the person who will be asked about the number later. The UI does not account for that anywhere.

The page greets someone about to admit a loss with **five warning triangles** — accusatory before the first keystroke, and a misuse of alarm iconography on a routine, expected, daily activity. Mid-task, the moment `costPerUnit` populates, an amber block appears reading "Pérdida Estimada: $412.50" with no context, no comparison, no framing — a punishment lamp firing while the user is still typing, and it fires even for `Consumo de Personal`, where nothing was lost.

The peak is the confirm dialog, the one place with authored voice. Then peak-end is squandered: the toast says "3 UNIT", the page remounts, the form empties, and the user is left staring at the same five triangles with zero evidence their work exists. The end state is anxiety, not closure. Nothing tells the logger that merma is normal, expected and budgeted; nothing distinguishes avoidable from caducidad; nothing says who will see this. For a product where the logger may reasonably fear the number being used against them, that silence is a design decision made by default — and it is what will make people under-report.

## Cognitive Load: 5 of 8 fail (high — critical)

- **Single focus — FAIL.** Form and static glossary carry equal visual weight, and the right column ends with two links whose purpose is to take the user *off* this page mid-task.
- **Grouping — FAIL.** Motive definitions sit ~600px horizontally from the `Motivo` select they define. The loss banner is wedged between `Costo por Unidad` and `Notas` rather than next to the submit button where the commitment happens.
- **Visual hierarchy — FAIL.** Three descending titles with no informational difference; the loudest chromatic element is the amber loss banner, which is passive output, not the action.
- **Minimal choices — FAIL, twice.** `Motivo` = 6 options; `Producto` = unbounded catalog with no search or grouping. Plus two escape links.
- **Working memory — FAIL.** "Máximo: N" appears only *under* `Cantidad` after a batch is chosen; the batch's expiry is `line-clamp-1` + `w-fit` so it truncates once the dropdown closes. The user holds "which lote, how much is left, what it costs" in their head while typing, and eye-travels across the page to check what "Calidad" means.
- Passing: chunking, one-thing-at-a-time, progressive disclosure.

## Minor Observations

- `page.tsx` hand-rolls the no-branch empty state with a raw `Card` and a bespoke icon, while `components/shared/EmptyState` is exported from the shared barrel. `ErrorState` and `SectionErrorBoundary` are likewise exported and unused here.
- `new Date(batch.expirationDate).toLocaleDateString()` uses the browser default locale; `expiration-report.tsx` correctly passes `'es-MX'`. On an English-locale tablet the lote list shows `3/15/2026` while the expirations report shows `15 mar 2026`.
- Currency is never formatted — `$${totalLoss.toFixed(2)}`, no separator, no `Intl.NumberFormat('es-MX')`. `$12450.00` at a glance is unreadable.
- `costPerUnit` round-trips cents→pesos (`/100`) and back (`Math.round(x*100)`); a user-edited decimal will drift by a centavo on some values.
- `Notas` is `resize-none` — a supervisor explaining a dropped tray gets a fixed 3-row box with no way to see what they wrote.
- `Acciones Relacionadas` links *to* the expirations report, but that report has **no** "Registrar merma" action on any row despite computing `alreadyExpired` and `estimatedLoss`. The `?item=` deep-link this page already supports is used only by the product drawer and stock manager. The highest-intent path in the product — "this batch is expired, write it off" — is not wired.
- The "no hay lotes disponibles" empty state is a disabled `SelectItem`, buried inside a dropdown the user must open to discover.

## Questions to Consider

1. **Why is this a form at all, rather than a list of things that are already dying?** What if the default surface were a checklist of at-risk lotes with a quantity stepper per row, and the blank form were the exception for spillage and breakage?
2. **The merma workflow demands a mandatory photo and this form demands none — which is the product's real position on merma evidence, and why does it depend on which door the user walked through?** Both write to the same table with different rigor and different motive vocabularies, and merma % can't tell them apart downstream.
3. **Who is this number for, and does the person entering it know?** If merma is a management metric, the logger is doing unpaid data entry against their own review. If it's an operational learning tool, the UI should show them the pattern. Right now it does neither, and that ambiguity is what drives under-reporting.
4. **What would this look like if it assumed dirty hands and eight seconds of attention?** The minimum viable merma record is product, amount, motive — cost auto-derived, unit auto-derived, lote auto-selected by FIFO with override. Three taps. The current design charges four dropdowns, two numeric fields, a textarea, a modal and a page remount for the same three facts.
