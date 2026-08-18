---
target: app/dashboard/finance/expenses
total_score: 19
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
timestamp: 2026-08-18T03-46-00Z
slug: app-dashboard-finance-expenses-page-tsx
---
Method: dual-agent (A: design review · B: detector + static evidence)

**Target:** `app/dashboard/finance/expenses/page.tsx` (521 lines) + `components/finance/expense-form.tsx`, fed by `lib/services/expense-service.ts`. Mode: **Operate**.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Four real states exist (`:322-354`), but the loading div has no `role="status"`, there is no row count, no pending total, and the branch scope in effect (`:95`) is consumed and never displayed. |
| 2 | Match System / Real World | 2 | The prose is genuinely operational ("Ver ticket", "quedó en la bitácora"). The data vocabulary is not: `:393` prints the raw enum `SERVICIOS_PROFESIONALES` while `expense-form.tsx:247-252` maps the same field to "Servicios Profesionales", and the column labeled "Fecha" (`:365,:384`) shows `createdAt` when the decision date is `dueDate`. |
| 3 | User Control and Freedom | 2 | Cancelar, Reintentar and filter-reset all present; approval is irreversible with no undo window and rejection is terminal by design (`:466`). |
| 4 | Consistency and Standards | 1 | Diverges from the sibling on six axes: no scope badge, no `tabular-nums` on money (`:424`), no role gate on the create CTA (`:310`), no pay/reschedule actions, raw-vs-mapped category labels, and the notification deep link writes `?id=` (`expense-service.ts:113`) while the page reads `?focus=` (`use-focused-row.tsx:22`) — that link is dead. |
| 5 | Error Prevention | 3 | Reject requires a reason (`:155,:505`), self-approval blocked on both sides (`:208`, `expense-service.ts:162`), confirmation gate on both resolutions, `e.preventDefault()` so the dialog can't close before the server answers (`:507-510`). |
| 6 | Recognition Rather Than Recall | 2 | Status badges carry icon + word. But `approvedByName` and `approvalNotes` are declared (`:70-71`) and never rendered, and the user must recall her own role level to parse "Requiere Gerente" (`:214`). |
| 7 | Flexibility and Efficiency | 1 | One filter with 5 options is the entire toolkit. No bulk approve, no sort, no search, no date range, no pagination — and `getOperatingExpenses` has no `LIMIT` (`expense-service.ts:400-427`). |
| 8 | Aesthetic and Minimalist Design | 2 | Ten columns (`:365-374`), two of which render `—` for most rows, under a Card header (`:316-319`) that restates the h1, with the entire tbody crushed to `text-xs` (`:381`). |
| 9 | Error Recovery | 3 | Server message surfaced verbatim (`:184`), connection errors distinguished from server rejections, EmptyState + Reintentar. Docked for the blocked-approver message being the least legible text on screen. |
| 10 | Help and Documentation | 1 | The authorization-rules table drives every behavior here and is never explained. "Requiere Gerente" never says why (the amount threshold) or who to ask. |
| **Total** | | **19/40** | **Poor — major UX overhaul required** |

## Design Specificity Verdict

**LLM assessment.** Category-interchangeable. Swap "Gastos Operativos" for "Purchase Requests" and nothing but strings changes: a ten-column table sorted by capture date, a status Select, a create button, a confirm dialog.

The tell is the sibling. `cash-flow-calendar.tsx` was authored for a specific person answering a specific question — it names its estimates and admits which are inferred, refuses to draw a projection rather than assume zero, labels the *applied* scope because "cifras del grupo etiquetadas como una sucursal son peor que no tener el filtro". The last commit on that file is literally *"que la pantalla conteste una pregunta en vez de enumerar."* This page enumerates. Its h1 joins two different jobs with a conjunction — "Gastos Operativos **y** Autorizaciones" — which is exactly what it is: two surfaces stacked without deciding which one it is. Its subtitle (`:286-288`) explains the taxonomy of the domain instead of telling the owner what to do.

The most damning failure is between the two screens. Cash-flow's overdue card links each item to `/dashboard/finance/expenses?focus=<id>` precisely so "tienes 6 gastos vencidos" stops being a dead end. The owner arrives, `useFocusedRow` highlights the row — and the row **does not show the due date, does not say it is overdue, and offers no action**. The bridge was built from one side only.

There is real authored craft here: the `silent` refetch comment (`:110-114` — "una sesión de 30 aprobaciones perdía su lugar 30 veces"), the real `<a>` instead of `window.open` (`:415-416`), the refusal to invent a payee name (`:396-398`), the two-branch dialog copy. They are all **repairs to a shape that was never designed**, not a shape designed for the scene.

**Deterministic scan.** `detect.mjs` on the page, `expense-form.tsx` and `empty-state.tsx`: **exit 0, zero findings.** Weight it correctly. Assessment B ran a seeded control file containing `shadow-lg`, `backdrop-blur-md`, `border-l-4`, `text-[10px]`, `#ff0000` and `alert()`; only four rules fired — `shadow-lg`, `backdrop-blur`, `text-gray-500` and the unlabeled icon button did **not**. A `.tsx` target exercises only the regex engine; the ~47-rule registry's DOM engines (`low-contrast`, `tiny-text`, `cramped-padding`, `text-overflow`, `flat-type-hierarchy`) were never evaluated. Exit 0 means "no static-pattern hits", not "no antipatterns". The clean run is real as far as it goes: no hex literals, no raw Tailwind palette, no gradients, no shadows, no sub-12px type — color routes through `statusBadgeClasses` and money through `formatCents` throughout.

**Visual overlays.** None. No browser automation is exposed in this session and no dev server was started, so no overlay, screenshot or computed-contrast measurement exists for this target. Every contrast figure below is derived from the token values in `globals.css`, not measured.

## Overall Impression

The high-stakes moment on this screen is excellent and everything around it is a spreadsheet. The confirmation dialog knows it is handling money — it restates the exact expense, explains the consequence in operational Spanish, refuses to close before the server answers. Then it promises the decision "queda registrada en la bitácora de autorizaciones," and the bitácora appears nowhere on the screen.

The single biggest opportunity: this page is a ledger pretending to be a queue. Default the filter to `PENDING_APPROVAL`, lead with the one sentence the owner needs — *"6 gastos por autorizar por $184,300 · 2 vencen esta semana"* — show `dueDate` instead of `createdAt`, and the ten-column table becomes an optional drawer rather than the product.

## What's Working

**1. The resolution dialog (`:450-518`).** It restates the *specific* expense rather than "this item", so the user confirms the thing and not the gesture. The copy explains the consequence, not the action: "compromete el pago", "habrá que registrarlo de nuevo". And the required-reason gate is enforced in the same place as the server rule, so the UI can't build a rejection the log can't explain.

**2. The state matrix is complete and each state does different work (`:322-355`).** Loading, error, zero-data, and zero-after-filter — and the last two are not the same message. Zero-data offers the create form; zero-after-filter offers a filter reset and says why. Most tables collapse these into one "no results" shrug.

**3. The permission affordance uses the exact helper the server uses (`:207-208`).** `roleIsAtLeast(currentUserRole, requiredRole)` is the same function `approveOperatingExpense` calls, and it fails closed on unknown roles. The UI cannot drift from the enforcement, and the comment says exactly that.

## Priority Issues

### [P0] Any authenticated role can open this page and read every branch's money

`ROUTE_PERMISSIONS` has **no entry for `/dashboard/finance`** — the list jumps from `/dashboard/branches` (`lib/rbac/permissions.ts:112`) to `/dashboard/labor/attendance` (`:119`). `hasAccess` (`:225-237`) longest-prefix-matches down to the `/dashboard` catch-all (`:215-218`), which admits `EMPLEADO` and `READONLY`. The sidebar hides the link; that is cosmetic — a typed URL, a bookmark, or a notification `actionUrl` all land. Compounding it, `GET /api/expenses` (`app/api/expenses/route.ts:37-39`) takes `branchId` straight from the query string and never calls `enforceBranchScope`, so a branch-pinned `GERENTE` or `SUPERVISOR` with the header on "todas" receives the whole group's ledger. And `ExpenseForm` renders unconditionally (`:310`) with no role guard, while the sibling gates behind `PUEDEN_CAPTURAR`/`PUEDEN_ACCIONAR`.

**Why it matters:** salary-adjacent and supplier-cost data across every branch, readable by the lowest role in the system, on a product whose whole pitch is multi-tenant compliance.
**Fix:** add a `/dashboard/finance` entry allowing `SUPER_ADMIN, ADMIN, GERENTE, SUPERVISOR`; call `enforceBranchScope` in the GET; return the applied scope and render the scope badge the sibling already ships; gate the create CTA on role.
**Suggested command:** `/impeccable harden`

### [P1] It enumerates instead of answering, and omits the only date that matters

`dueDate` is selected (`expense-service.ts:418`), typed (`:73`), and rendered nowhere; "Fecha" shows `createdAt`. There is no total, no count, no sort, no search, no bulk select, no pagination, the query has no `LIMIT`, and the default filter is `ALL` — so the approval queue is mixed into the full historical ledger, a pending $80,000 rent sitting between a paid taxi and a rejected hardware receipt. The author's own comment describes "una sesión de 30 aprobaciones"; the design gives that session 30 × (scan → click → dialog → click) with no checkbox in sight.

**Why it matters:** the owner came to decide what to pay this week and the screen cannot rank, total, or date anything. Eight branches × a year of rent and utilities is thousands of rows, all fetched and all rendered.
**Fix:** default `statusFilter` to `PENDING_APPROVAL`; lead with one line — count + sum + how many vence esta semana; replace the createdAt column with "Vence", with a destructive treatment when `dueDate < today && status !== "PAID"`; bound the query server-side and add a checkbox column with one batch confirmation.
**Suggested command:** `/impeccable distill`

### [P1] The bitácora is promised twice and shown never

The dialog tells the user the decision "queda registrada en la bitácora de autorizaciones" (`:466,:467`) and the toast repeats it (`:178`). `approvedByName` and `approvalNotes` are in the interface (`:70-71`) and in the query (`expense-service.ts:415-416`) — neither is rendered. A `REJECTED` row shows a red badge with no reason; nobody can tell who approved a `PAID` expense. `components/finance/petty-cash-history-table.tsx:125-130` — same folder, smaller amounts — *does* render the approver, with the comment "Sin `approvedByName` no hubo segunda persona."

**Why it matters:** the screen makes an audit promise at its highest-stakes moment and breaks it. The petty-cash table takes the trail more seriously than the authorization screen does.
**Fix:** render `approvedByName` under the status badge on resolved rows and surface `approvalNotes` in a Popover — the pattern is already imported in `cash-flow-calendar.tsx:9`.
**Suggested command:** `/impeccable clarify`

### [P1] The task ends halfway, and the second half lives on another screen

`PENDING_APPROVAL` rows get Aprobar/Rechazar; everything else gets `—` (`:437`). `APPROVED` is exactly the state where the next action exists — marcar pagado, reprogramar — and `components/finance/expense-row-actions.tsx:71,:112` already implements both against `/api/expenses/[id]/pay` and `/reschedule`, with per-row loading and per-row errors. It is imported by `cash-flow-calendar.tsx:12` and **not** by the screen literally named "Gastos Operativos y Autorizaciones."

**Why it matters:** "One platform, one truth" is a stated design principle, and the expense lifecycle is currently split across two URLs with no signpost between them.
**Fix:** render `<ExpenseRowActions>` in the Acción cell for `status === "APPROVED"`, gated on the same role list cash-flow uses.
**Suggested command:** `/impeccable harden`

### [P2] Type sits at the floor, money doesn't align, and muted has four opacities

`focusProps(item.id, "hover:bg-muted/40 transition text-xs")` (`:381`) sets **the entire table body to 12px**. DESIGN.md puts table cells at Body (0.875rem) and reserves Label (0.75rem) for buttons, badges and small metadata; it explicitly forbids "dense tables con tiny type", and the Label-Floor rule names this exact scene — a tablet at arm's length in a kitchen. The amount (`:424`) is `font-bold` with **no `tabular-nums`**, so a column of pesos doesn't align by digit, while the sibling uses `tabular-nums` on every figure it prints. Assessment B counted five opacity-thinned foreground tokens: `/40` (`:403,:421`), `/50` (`:437`), `/60` (`:212`), `/70` (`:429`) — `--muted-foreground` is `oklch(0.50 0.01 85)`, roughly 4.6:1 at full opacity, so `/60` lands near 2:1 and `/40` near invisible. The worst offender is `:212-215`, the blocked-approver explanation: the single most important message for a user who can't act is the least readable text on the screen.

**Why it matters:** the tablet scene is the primary scene, and the type ramp is being punched through its floor for every cell rather than one.
**Fix:** drop `text-xs` from the row; put the amount at Body weight with `tabular-nums`; replace every `text-muted-foreground/{40,50,60,70}` with the solid token; give the blocked-approver message Body size and the amount threshold that triggered it.
**Suggested command:** `/impeccable typeset`

## Persona Red Flags

**Alex (impatient power user)**
- No bulk selection. 30 pending expenses = 30 dialogs, ~120 clicks, and 30 typed reasons if rejecting.
- **Focus is destroyed after every approval.** Radix restores focus to the trigger on close, but the trigger unmounts — the Acción cell becomes `—` after the silent refetch. Focus falls to `<body>`. Keyboard-driven approval re-traverses the whole page after *each* decision, the exact scenario the `silent` refetch was written to protect.
- `AlertDialogAction` calls `e.preventDefault()` (`:509`), so Enter in the Textarea does not submit.
- No column sort. Finding the largest pending expense across 200 rows means reading 200 rows.

**Sam (accessibility-dependent)**
- `Requiere {rol}` (`:212-215`) — `text-xs` at `text-muted-foreground/60`, ~2:1 estimated. The sole explanation of a permission denial.
- The `—` placeholders at `/40` and `/50` (`:403,:421,:437`) are effectively invisible and carry no `aria-label`; a screen reader hears a bare em dash in three columns.
- **The busy Aprobar button loses its accessible name** (`:232`): `{busy ? <Loader2/> : "Aprobar"}` — lucide sets `aria-hidden` on childless icons, so mid-flight the button has no name and no `aria-busy`.
- `expense-form.tsx:414-422` — a 28×28 ghost button wrapping only `<X/>`, no accessible name, under the 44px touch minimum.
- The loading state (`:322-325`) is silent: no `role="status"`, no `aria-live`.
- Genuine positives: real semantic `<table>` markup, `scope="col"` headers, a well-written `sr-only` `<caption>`, `aria-current` on the focused row.

**Owner of 8 branches, tablet, Monday morning**
- **Ten columns on a tablet.** Amount and Acción are the last two of ten, so she scrolls horizontally to reach the only column she came for — through two nested `overflow-x-auto` containers (`:356` and `components/ui/table.tsx:11`).
- **Three breakpoint-prefixed classes in the entire page**, all in the header (`:281`). The table block has zero.
- **She cannot tell which branches she's looking at.** No scope indicator; the Sucursal column either repeats one name 200 times or silently mixes eight.
- **The WhatsApp notification she tapped doesn't work** — `?id=` vs `?focus=`. She lands on an unfiltered list of 200 rows and hunts by memory of a truncated description (`:406`, `max-w-xs truncate`, no `title` attribute).
- **No answer, only a list.** Cash-flow tells her "Te alcanza para 12 días" in `text-4xl`. This screen doesn't tell her how many expenses await her or what they total.

## Minor Observations

- Two "Nuevo Gasto Operativo" buttons render simultaneously in the empty state (`:310` header + `:342` EmptyState action), each mounting its own `loadPayees()` fetch.
- The Card header (`:316-319`) restates the h1 with no added information, costing ~90px above the fold on a tablet.
- Double container: `Card` wrapping a `border rounded-md` box wrapping the table — two nested 1px borders where DESIGN.md asks for horizontal dividers only.
- `<Receipt className="h-7 w-7 text-primary" />` (`:284`) is a 28px Operational Red icon carrying zero information. The sibling does the same thing, so this is a house-wide habit worth naming.
- `ROLE_LABELS` (`:45-54`) includes `OWNER` and `DIRECTOR_OPS`, which are not in the `UserRole` union — the approver hierarchy and the RBAC roles are two vocabularies and the user sees both.
- `requiredApproverRole` falls back to `"OWNER"` (`:203`), so a tenant with no configured rules shows "Requiere Dueño" on every row with no path to fix it.
- `<Suspense>` at `:80` has no `fallback`.
- Three `console.error` calls in the rendered path (`:132,:189`, `expense-form.tsx:59`) where CLAUDE.md mandates `lib/logger.ts`.
- Zero next-intl usage: ~58 inline Spanish literals here and ~41 in the form, while eight other components in the repo use `useTranslations` and `messages/es.json` has no finance namespace.
- Type status unverified — no build was run, and the IDE diagnostics call resolved to a stale WSL path, so its empty result is absence of data, not evidence.

## Questions to Consider

1. **Is this an approval queue or a ledger — and what breaks if you refuse to build both?** Default to `PENDING_APPROVAL`, cut to Vence / Contraparte / Monto / Sucursal / Acción, move the history behind "Ver historial". What does the owner lose that she'd notice?
2. **Cash-flow answers "¿Me alcanza?" in `text-4xl`. What is the one sentence this screen should answer first?** Would that line make the ten-column table optional rather than primary?
3. **Why are approving and paying two different screens?** If the whole lifecycle lived in one row, what would cash-flow's overdue card still need to link *out* to?
4. **If the dialog swears the decision goes into the bitácora, why isn't the bitácora the spine of this screen?** What if the row expanded into the trail — who requested it, which rule applied, who resolved it, what they wrote?
5. **What friction should scale with the amount?** Approving $500 and $500,000 are currently two identical clicks. If the confirmation for a large expense showed its share of the projected minimum balance — a number cash-flow already computes — would she still approve it as fast?
