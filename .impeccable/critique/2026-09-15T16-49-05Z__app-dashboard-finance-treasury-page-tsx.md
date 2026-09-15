---
target: finanzas/treasury
total_score: 30
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
timestamp: 2026-09-15T16-49-05Z
slug: app-dashboard-finance-treasury-page-tsx
---
#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Good status badges and toasts; minor gap in audit trail timestamps for state changes. |
| 2 | Match System / Real World | 4 | Excellent domain language for Mexican HORECA treasury (SPEI, CFE, CLABE, nómina, prorrateo). |
| 3 | User Control and Freedom | 3 | Clear cancellation modals; missing post-approval edit/revert controls. |
| 4 | Consistency and Standards | 3 | SPEI layout download action is enabled even on DRAFT/CANCELLED runs. |
| 5 | Error Prevention | 3 | Strong excluded-item warnings; missing past-date validation in run creation modal. |
| 6 | Recognition Rather Than Recall | 3 | Helpful quick preset buttons (+ Nómina, + Proveedores A&B) in run creation modal. |
| 7 | Flexibility and Efficiency | 2 | No keyboard shortcuts for search or approval flows; no batch actions across runs. |
| 8 | Aesthetic and Minimalist Design | 3 | Clean flat card layout; table columns get tight on medium viewports. |
| 9 | Error Recovery | 3 | Actionable warnings and detailed toast descriptions when layout generation has exclusions. |
| 10 | Help and Documentation | 2 | Tooltips present on KPIs, but lacks visual guidance on the 3-way match → SPEI cycle. |
| **Total** | | **30/40** | **Good** |

#### Design Specificity Verdict

**LLM assessment**: The Treasury module (`app/dashboard/finance/treasury/page.tsx`) demonstrates strong HORECA domain alignment in its business logic, copy, and Mexican banking integrations (SPEI dispersion layouts, 3-way match references, CFE/utility recurring contracts). However, visually it follows a generic 2-column card/table layout template that can compress tabular data on mid-sized screens.

**Deterministic scan**: Automated scan (`detect.mjs`) returned 0 static rule violations on the primary treasury files (`page.tsx`, `treasury-dashboard.tsx`, `payment-run-detail.tsx`). Across the broader finance directory, 3 advisory font-size warnings were detected (`10px`/`11px` micro-text violating the 12px Label Floor in `cash-flow-hero.tsx` and `cash-flow-mitigation-workbench.tsx`).

**Visual overlays**: No live browser injection active.

#### Overall Impression
A functional, well-thought-out Mexican HORECA treasury control center. The SPEI layout download toasts and recurring contract monthly pro-rating are outstanding domain touches. Visual hierarchy can be improved by making actionable states more distinct and preventing premature SPEI downloads on unapproved runs.

#### What's Working
1. **Accurate Monthly Pro-rating for Recurring Contracts**: Prorating annual and quarterly rent/licenses to a true monthly figure prevents inflated cash flow commitments.
2. **Actionable Excluded-Item Bank Layout Warnings**: Toast notifications clearly break down which items were omitted from SPEI files and why (e.g. missing CLABE/RFC).
3. **Quick Title Presets in Creation Modal**: "+ Nómina", "+ Proveedores A&B", and "+ Servicios & Renta" buttons reduce typing effort.

#### Priority Issues
- **[P1] Premature Bank Layout Export Action**: The "Layout SPEI" button is rendered on table rows regardless of run status (e.g., DRAFT, CANCELLED, PENDING). Users might download and upload incomplete or unapproved files to their bank portal.
  - *Why it matters*: Exporting unapproved layouts to SPEI banking portals risks dispersing unverified payments or omitting payroll/invoices.
  - *Fix*: Disable or hide the "Layout SPEI" action on DRAFT/CANCELLED runs, or restrict primary download to APPROVED/PROCESSING states.
  - *Suggested command*: `$impeccable harden app/dashboard/finance/treasury/page.tsx`
- **[P2] Column Compression in Desktop Grid**: Splitting "Corridas de Pago" and "Gastos Recurrentes" into equal 50/50 columns forces horizontal table scrolling on 1024px–1280px viewports.
  - *Why it matters*: Users lose sight of total amounts or status badges when horizontal scrolling is triggered inside narrow cards.
  - *Fix*: Adjust layout to stacked full-width sections or allow toggling view focus.
  - *Suggested command*: `$impeccable layout app/dashboard/finance/treasury/page.tsx`
- **[P2] Lack of Keyboard & Batch Efficiency**: Searching requires manual mouse click, and approving multiple runs requires navigating into each detail page individually.
  - *Why it matters*: Franchise CFOs handling multiple branches suffer slow repetitive clicking.
  - *Fix*: Add `/` keyboard shortcut to focus search input and interactive filter links on KPI cards (e.g. click "Pendientes de Autorización" card to filter).
  - *Suggested command*: `$impeccable adapt app/dashboard/finance/treasury/page.tsx`
- **[P3] Missing Creation Date Validation**: `CreatePaymentRunModal` allows selecting past dates without a confirmation prompt or warning badge.
  - *Why it matters*: Creating a payment run with a past date can skew cash flow scheduling and urgency badges.
  - *Fix*: Add past-date detection inline helper text or warning highlight.
  - *Suggested command*: `$impeccable clarify components/finance/create-payment-run-modal.tsx`

#### Persona Red Flags
- **Alex (Treasury Manager / Power User)**: Cannot search with `/` or `Ctrl+K`. Must click into each run individually to check items or authorize. Cannot filter by branch + status simultaneously from KPI cards.
- **Jordan (Franchise Owner / First-Timer)**: Might click "Layout SPEI" on a DRAFT run and attempt to upload it to BBVA/Banorte, not realizing items are still missing.
- **Sam (Accessibility User)**: Table row interactive elements have decent contrast, but row action buttons lack explicit `aria-label` specifying which run title they belong to.

#### Minor Observations
- Status badge colors are well defined, but DRAFT and PENDING_APPROVAL both use outline variants; making DRAFT more muted helps differentiate draft state.
- Empty states are well integrated with `EmptyState` component.

#### Questions to Consider
- What if clicking the "Pendientes de Autorización" KPI card instantly filtered the payment runs table to show only pending approval runs?
- Should downloading a SPEI layout automatically log an audit event or prompt for final approval if the run is still in DRAFT?
