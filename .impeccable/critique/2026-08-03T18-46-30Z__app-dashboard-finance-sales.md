---
timestamp: 2026-08-03T18-46-30Z
slug: app-dashboard-finance-sales
---
#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3/4 | Good status badges and loading states, but inline table feedback can be clearer. |
| 2 | Match System / Real World | 2/4 | Technical module codes `(M13)`, `(M16)` in titles leak internal spec naming. |
| 3 | User Control and Freedom | 2/4 | Uses browser `confirm()` dialogs; lacks undo / modal dialog management. |
| 4 | Consistency and Standards | 2/4 | Filter bar layouts differ between pages; arbitrary `text-[10px]` typography. |
| 5 | Error Prevention | 3/4 | Good dropdown constraints and date pickers. |
| 6 | Recognition Rather Than Recall | 3/4 | Dense data tables require high visual scanning effort. |
| 7 | Flexibility and Efficiency | 2/4 | No keyboard shortcuts for power users or batch actions. |
| 8 | Aesthetic and Minimalist Design | 2/4 | Banned `border-l-4` side-stripe on petty cash card; header clutter. |
| 9 | Error Recovery | 3/4 | Toast notifications active; form error feedback is functional. |
| 10 | Help and Documentation | 2/4 | Subtitles give overview, but complex rules lack contextual tooltips. |
| **Total** | | **24/40** | **Acceptable** |

#### Anti-Patterns Verdict

**LLM assessment**: The financial and sales dashboards are functionally solid, but suffer from subtle AI slop tells: a prominent `border-l-4 border-l-primary` side-stripe border on the Petty Cash balance card, raw module spec identifiers (`M13`, `M16`) in headlines, and micro-text (`10px`/`11px`) slapped on badges and metadata to fit cramped tables.

**Deterministic scan**: Automated detector flagged **11 issues**:
- 1 `warning`: `side-tab` accent border (`border-l-4`) at `app/dashboard/finance/petty-cash/page.tsx:119`.
- 10 `advisory` violations of `design-system-font-size`: arbitrary `10px` and `11px` font sizes breaking the `DESIGN.md` type ramp in `expenses/page.tsx`, `petty-cash/page.tsx`, `sales/mapping/page.tsx`, and `sales/page.tsx`.

#### Overall Impression
The surfaces provide essential HORECA financial controls (sales cuts, petty cash audit log, operating expenses, 30-day cash flow), but feel like developer-built administrative screens rather than an executive command center. Cleaning up side-stripe borders, standardizing filter layouts, elevating font scale, and stripping technical module numbers will immediately boost trust and polish.

#### What's Working
1. **Clear Semantic Status Badges**: Good color coding for `Validado` (green), `Observación` (yellow), `Aprobado`, and `Pendiente`.
2. **Dense Operational Tables**: Data presentation in sales cuts and petty cash history aligns well with HORECA auditing needs.

#### Priority Issues
- **[P1] Banned side-stripe border on Petty Cash balance card**: `app/dashboard/finance/petty-cash/page.tsx:119` uses `border-l-4 border-l-primary`.
  - *Why it matters*: Classic AI template tell that breaks flat design principles in `DESIGN.md`.
  - *Fix*: Replace with standard 1px border and tonal highlight.
  - *Suggested command*: `$impeccable layout app/dashboard/finance/petty-cash/page.tsx`
- **[P1] Micro-text typography violations (`text-[10px]` & `text-[11px]`)**: Found across all 4 sub-views.
  - *Why it matters*: Hard to read on mobile/POS devices and violates the project typography ramp (minimum `text-xs` / 12px).
  - *Fix*: Standardize on `text-xs` with appropriate font weight and padding.
  - *Suggested command*: `$impeccable typeset app/dashboard/finance app/dashboard/sales`
- **[P2] Exposed internal spec code numbers `(M13)`, `(M16)` in titles**:
  - *Why it matters*: Leaves internal technical spec artifacts in user-facing page headings.
  - *Fix*: Clean page headers to user-centric titles (e.g. "Ventas y POS", "Gastos Operativos", "Caja Chica").
  - *Suggested command*: `$impeccable clarify app/dashboard/finance app/dashboard/sales`
- **[P2] Inconsistent filter placement and header layout**:
  - *Why it matters*: Filters are placed inside `CardHeader` in Sales Cuts, but in the top page header in Expenses and Petty Cash.
  - *Fix*: Standardize top header for page title + primary actions, and Card Header for table filtering.
  - *Suggested command*: `$impeccable layout app/dashboard/finance app/dashboard/sales`
- **[P2] Native `confirm()` dialog for template deletion**:
  - *Why it matters*: Poor accessibility and unstyled browser popup in `sales/mapping/page.tsx`.
  - *Fix*: Replace with Shadcn `AlertDialog`.
  - *Suggested command*: `$impeccable harden app/dashboard/sales/mapping/page.tsx`

#### Persona Red Flags
- **Alex (Power User)**: No keyboard shortcuts for approving pending expenses or searching cuts.
- **Jordan (First-Timer)**: Confused by raw technical spec codes like `(M13)` and `(M16)`.
- **Casey (Distracted Mobile User)**: Micro `10px` text and cramped table filter controls are difficult to read and tap on mobile devices.

#### Minor Observations
- Table fallback empty states could offer actionable CTA buttons (e.g., "Cargar primer corte" or "Registrar gasto").
- `petty-cash/page.tsx` has hardcoded `<AlertTriangle />` badge for balance `<20%` which can be styled cleaner.

#### Questions to Consider
- Should we unify Sales and Finance into a single unified financial overview tab bar for restaurant group owners?
- Can we add quick keyboard shortcuts (e.g. `⌘+K` or `A` for approve) in audit tables for fast manager reviews?
