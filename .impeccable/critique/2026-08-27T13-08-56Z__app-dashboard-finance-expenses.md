---
target: app/dashboard/finance/expenses
total_score: 37
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 0
timestamp: 2026-08-27T13-08-56Z
slug: app-dashboard-finance-expenses
---
⚠️ DEGRADED: single-context (sub-agent tool unavailable in this session)

#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Excellent scope bounds, truncated record warnings, overdue date tags |
| 2 | Match System / Real World | 4 | Native HORECA categories, MXN currency formatting, local Mexican dates |
| 3 | User Control and Freedom | 3 | Status filter dropdown works well; resets on branch switch |
| 4 | Consistency and Standards | 4 | Strict Geist font, tabular numbers, OKLCH status badges |
| 5 | Error Prevention | 4 | Segregation of duties prevents self-approval; mandatory rejection notes |
| 6 | Recognition Rather Than Recall | 4 | Displays required approver role explicitly (*Requiere Dueño*, *Requiere Gerente*) |
| 7 | Flexibility and Efficiency | 3 | Touch-friendly 36px buttons; lacks bulk approval for low-value expenses |
| 8 | Aesthetic and Minimalist Design | 4 | Flat-by-default, 0 box shadows, Operational Red under 10–15% budget |
| 9 | Error Recovery | 4 | Fail-closed empty states for unassigned roles, clear toast feedback |
| 10 | Help and Documentation | 3 | Clear structural notes explain truncated history vs full pending queue |
| **Total** | | **37/40** | **Excellent (Grade A)** |

#### Design Specificity Verdict

**LLM assessment**: The Gastos Operativos portal (`app/dashboard/finance/expenses`) is purpose-built for HORECA chain management. It implements fail-closed authorization bounds (`denyExpenseResolution`), identifies configuration bottlenecks (`sinAprobadorPosible`), and seamlessly supports deep linking (`?focus=`) from cash flow projections.

**Deterministic scan**: Automated detector scan clean (`0` violations found by `detect.mjs`).

#### Overall Impression
A highly reliable, production-grade approval workflow interface that respects segregation of duties and HORECA operational speeds.

#### What's Working
1. **Segregation of Duties Enforcement:** Clear visual feedback when an approval is blocked (*"Lo registraste tú"*, *"Requiere Dueño"*).
2. **Stuck Expense Alerts:** Detects and flags expenses that have no eligible approver in the organization due to role misconfiguration.
3. **Deep Linking Context:** Respects `?focus=` URL parameters from Cash Flow projections to jump directly to target records.

#### Priority Issues

- **[P2] What:** Table rows lack `focus-within` visual state parity for keyboard navigation.
  - **Why it matters:** Tabbing through action buttons or evidence links doesn't trigger row background highlight.
  - **Fix:** Add `focus-within:bg-muted/40` to row class string.
  - **Suggested command:** `$impeccable adapt app/dashboard/finance/expenses`

- **[P2] What:** Stuck expense alert text lacks visual callout container.
  - **Why it matters:** Warning text (`text-warning-text`) can be overlooked when scanning dense card headers.
  - **Fix:** Wrap in a subtle tonal banner (`border border-warning/40 bg-warning/5 p-2.5 rounded-md`).
  - **Suggested command:** `$impeccable polish app/dashboard/finance/expenses`

- **[P3] What:** Absence of bulk approval for low-value petty expenses.
  - **Why it matters:** Approving 15 small expenses ($150–$300 MXN) requires 15 separate clicks.
  - **Fix:** Add multi-select bulk approval bar for expenses under $1,000 MXN.
  - **Suggested command:** `$impeccable shape app/dashboard/finance/expenses`

#### Persona Red Flags

- **Alex (Owner / Busy Executive):** Approving 10 small expenses requires 10 individual modal confirmations; lacks bulk approval shortcut.
- **Jordan (Branch Manager / First-Timer):** Category select relies on accounting codes; needs inline examples (e.g. *"Luz CFE", "Gas LP"*).
- **Sam (Accessibility User):** Evidence link buttons rely on icons without explicit `aria-label` screen reader announcements.

#### Minor Observations
- Rejection dialog text area placeholder could explicitly state: *"Motivo visible para el solicitante en la bitácora"*.
- Status filter dropdown could display count badges next to each option (e.g. *"Pendientes (4)"*).

#### Questions to Consider
- *What if expenses under $500 MXN with valid receipt evidence could be auto-approved based on branch operating threshold rules?*
- *Could we add a quick "Descargar soporte en PDF" button for accounting exports?*
