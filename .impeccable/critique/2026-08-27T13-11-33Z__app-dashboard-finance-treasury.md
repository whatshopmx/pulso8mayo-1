---
timestamp: 2026-08-27T13-11-33Z
slug: app-dashboard-finance-treasury
---
### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Raw database enums (`APPROVED`, `PENDING`) displayed without localization; no visual urgency or payout progress indicators. |
| 2 | Match System / Real World | 1 | Un-translated technical strings (`RENTAL`, `MONTHLY`, `APPROVED`); missing HORECA operational context (Sucursal/Branch, Proveedor/Vendor). |
| 3 | User Control and Freedom | 3 | Modal triggers and manual refresh available, but no direct row-level quick actions (edit, pause, authorize). |
| 4 | Consistency and Standards | 2 | Redundant headers ("Tesorería" H1 and "Panel de Tesorería" H2); card footer button layouts differ between cards. |
| 5 | Error Prevention | 2 | No warnings or alerts for upcoming vendor cutoffs, overdue runs, or expiring recurring contracts. |
| 6 | Recognition Rather Than Recall | 2 | Table rows omit branch/vendor metadata, forcing users to remember or navigate into detail pages to identify runs. |
| 7 | Flexibility and Efficiency | 1 | Lacks branch filtering, status filtering, date range pickers, bulk actions, or keyboard shortcuts. |
| 8 | Aesthetic and Minimalist Design | 2 | Clean cards, but duplicate titles waste header hierarchy; lacks key financial summary cards (KPI balance/outflow impact). |
| 9 | Error Recovery | 2 | Global error fallback with retry exists, but no row-level validation feedback or retry states. |
| 10 | Help and Documentation | 2 | Card descriptions offer basic context, but lack contextual tooltips for bank authorization workflows or NOM/CFE rules. |
| **Total** | | **19/40** | **Poor (47.5%)** |

### Design Specificity Verdict

- **LLM Assessment**: Generic admin dashboard layout with boilerplate cards and tables. Lacks the operational authority required for a HORECA treasury command center (multi-branch context, payment urgency badges, cash outflow totals, vendor tags, and Mexican business localization).
- **Deterministic Scan**: `detect.mjs` executed clean (0 structural syntax AST rule violations).
- **Visual Overlays**: Browser injection fallback signal (local dev server not active on port 3000 during analysis).

### Overall Impression

The Treasury section functions as a basic CRUD list wrapper rather than an executive financial control center for multi-unit restaurant/hotel chains. It presents technical data without HORECA operational context, lacks high-level financial summary KPIs (e.g. pending payout total, cash flow impact), and displays raw database enums instead of localized Spanish status tags.

### What's Working

- Clear visual card separation between one-time Payment Runs ("Corridas de Pago") and Recurring Contracts ("Gastos Recurrentes").
- Proper inclusion of empty state components (`EmptyState`) with direct action triggers when lists are empty.
- Clean implementation of async loading spinners and error boundary fallbacks with manual retry capability.

### Priority Issues

- **[P1] What**: Un-localized technical DB strings in status badges and contract types (`APPROVED`, `RENTAL`, `MONTHLY`).
  - **Why it matters**: Confuses restaurant managers and finance teams, creating cognitive friction and unprofessional appearance.
  - **Fix**: Map DB enums to localized HORECA terms ("Aprobado", "Renta de Inmueble", "Quincenal") with semantic badge color accents (e.g. success green for approved, warning amber for pending).
  - **Suggested command**: `$impeccable clarify app/dashboard/finance/treasury`
- **[P1] What**: Missing branch/sucursal and vendor metadata in table rows.
  - **Why it matters**: Multi-unit operators managing 10-15 branches cannot tell which restaurant location or supplier a payment run belongs to without clicking into every row.
  - **Fix**: Add a "Sucursal" pill column, a "Proveedor/Beneficiario" column, and due-date urgency badges ("Vence hoy", "En 3 días").
  - **Suggested command**: `$impeccable layout app/dashboard/finance/treasury`
- **[P2] What**: Redundant double header ("Tesorería" H1 + "Panel de Tesorería" H2) and missing top-level KPI metrics.
  - **Why it matters**: Wastes vertical layout space and misses the opportunity to display crucial executive summary numbers (Total por pagar esta semana, Contratos activos, Saldo disponible).
  - **Fix**: Remove the duplicate H2 header and add a 3-column KPI summary bar at the top of the dashboard.
  - **Suggested command**: `$impeccable distill app/dashboard/finance/treasury`
- **[P2] What**: Absence of filtering, search, and batch controls.
  - **Why it matters**: As payment runs scale across branches, finding specific runs or approving multiple items becomes tedious and inefficient.
  - **Fix**: Add a filter toolbar (Sucursal, Estatus, Rango de Fechas) above the cards.
  - **Suggested command**: `$impeccable shape app/dashboard/finance/treasury`

### Persona Red Flags

- **Alex (Power User / Director de Finanzas)**: Cannot see total pending payout at a glance, cannot filter by branch, and cannot batch-approve payment runs. Forced to navigate line-by-line into individual run detail pages.
- **Jordan (First-Timer / Gerente de Sucursal)**: Sees raw database enums (`APPROVED`, `MONTHLY`, `RENTAL`). Doesn't know if a payment run named "Pago Proveedores Semana 34" includes their store or not.
- **Sam (Accessibility User)**: Table actions rely on icon-only buttons (`RefreshCw`, `Plus`, `ArrowRight`) without `aria-label` screen reader announcements on icon-only buttons.

### Minor Observations

- Date formatting uses `short` month in lowercase (`es-MX`), which looks fine but could benefit from relative time indicators ("Mañana", "En 5 días").
- Currency symbol is displayed as raw `MXN` trailing string instead of formatted prefix `$`.

### Questions to Consider

- "What if the Treasury dashboard opened with a 7-day cash outflow calendar forecast instead of static tables?"
- "How can we highlight urgent deadline cutoffs (e.g. CFE power bills or landlord lease terms) before late fees occur?"
