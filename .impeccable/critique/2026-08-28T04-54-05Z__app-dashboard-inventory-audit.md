---
target: app/dashboard/inventory/audit
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-08-28T04-54-05Z
slug: app-dashboard-inventory-audit
---
#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | No pagination controls or active filter summary; records beyond 50 are unreachable. |
| 2 | Match System / Real World | 3 | Good Spanish terms, but `performedBy` displays raw sliced hashes (`e8f19a2b`) instead of user names/roles. |
| 3 | User Control and Freedom | 2 | No pagination, no reset filters action, and no date/branch filtering controls. |
| 4 | Consistency and Standards | 3 | Standard table layout, but raw JSON stringified objects dumped into table cells without formatting. |
| 5 | Error Prevention | 3 | Good dropdown constraints, but empty state fails to differentiate between zero logs and zero filter matches. |
| 6 | Recognition Rather Than Recall | 2 | Values are truncated at 100 characters with no detail drawer, tooltip, or modal to inspect full changes. |
| 7 | Flexibility and Efficiency | 2 | Lacks branch selector, date range, search by product/user, and export for regulatory audits. |
| 8 | Aesthetic and Minimalist Design | 3 | Clean structure, but truncated JSON strings create visual clutter and fixed column widths cramp data. |
| 9 | Error Recovery | 3 | Basic toast notifications on API error; no retry action or contextual guidance. |
| 10 | Help and Documentation | 3 | Good subtitle description; lacks contextual tooltips on audit entity scopes and NOM compliance relevance. |
| **Total** | | **26/40** | **Acceptable (65%)** |

#### Design Specificity Verdict

**LLM assessment**: The audit page currently presents as a generic developer boilerplate table rather than an authoritative, operational command center for Mexican HORECA restaurant groups. Key operational requirements for 3-15 branch chains—such as branch-level scoping, human-readable user roles, date range filtering, and clean before/after change diffing—are missing. The table dumps raw stringified JSON directly into cells, forcing restaurant managers to parse syntax instead of reading operational facts.

**Deterministic scan**: The deterministic detector (`detect.mjs`) scanned `app/dashboard/inventory/audit` and reported `0` violations. The code adheres to clean JSX structures, standard component imports, and no forbidden CSS patterns.

#### Overall Impression
The foundation is clean and functional for a basic log viewer, but it currently falls short of being an operational audit tool. For a restaurant owner or operations manager, an audit view must make it immediately obvious *who* changed *what item*, in *which branch*, on *what shift*, and *by how much*. Adding a structured change-inspection drawer, multi-unit branch/date filters, and human-readable actor formatting will elevate this from a raw database viewer to an indispensable operational tool.

#### What's Working
- **Semantic Action & Entity Labels**: Natural, domain-appropriate Spanish mappings for all HORECA audit events (Creación, Actualización, Merma, Lote, Transferencia, Recepción, Ajuste).
- **Responsive Shell & Loading Feedback**: Uses the standardized `PageContainer`, `PageHeader`, and `DataTableSkeleton` for smooth initial loading feedback.
- **Clean Tonal Design**: Avoids heavy institutional borders or unnecessary shadows, following Pulso's flat tonal layering principles.

#### Priority Issues

- **[P1] Truncated Raw JSON with No Detail Inspector / Diff Viewer**
  - **Why it matters**: An audit log exists to verify exact discrepancies (e.g. why 5 kg of meat was adjusted). Stringifying raw JSON and truncating at 100 chars leaves managers unable to see full details or understand multi-field updates.
  - **Fix**: Add a clickable row interaction opening a slide-over Sheet / Drawer that displays a side-by-side visual diff (old vs new) with formatted values, reason, timestamp, and full entity context.
  - **Suggested command**: `$impeccable shape`

- **[P1] Missing Multi-Unit Branch Selector, Date Range Filter, & Search**
  - **Why it matters**: Pulso manages chains with 3 to 15 branches. An audit screen without branch selection, date ranges, or text search makes locating specific incidents across branches nearly impossible as log volume grows.
  - **Fix**: Implement a filter toolbar with Branch selector, Date Range picker (`dateFrom`/`dateTo`), and an instant search input targeting entity ID / product name / user.
  - **Suggested command**: `$impeccable layout`

- **[P1] Absence of Pagination Controls for High-Volume Audit Trail**
  - **Why it matters**: The backend API supports `limit` and `offset`, but the UI only fetches the first page of 50 items with no Next/Previous controls, locking users out of historical records.
  - **Fix**: Add clean pagination controls at the bottom of the table showing current page, total count, and page size selector.
  - **Suggested command**: `$impeccable layout`

- **[P2] Raw User IDs and Database Hashes Instead of Human Identities**
  - **Why it matters**: Displaying `log.performedBy.slice(0, 8)` exposes internal database UUIDs to restaurant owners instead of displaying the staff member's name and role (e.g. "Mariana R. · Gerente").
  - **Fix**: Display user names with role badges and fallback avatar initials, with tooltip showing full ID if needed for technical audits.
  - **Suggested command**: `$impeccable clarify`

- **[P2] Missing Regulatory Export & Filter Reset in Empty States**
  - **Why it matters**: Restaurant owners need to export audit logs (CSV / PDF) during NOM-251 health inspections or internal audits. Additionally, when filters produce 0 results, there is no "Limpiar filtros" action to recover.
  - **Fix**: Add an "Exportar CSV" button in the header and an actionable "Restablecer filtros" button in the empty state.
  - **Suggested command**: `$impeccable harden`

#### Persona Red Flags

- **Alex (Power User / Director de Operaciones)**: Cannot filter audit records by branch or date range when investigating weekend food waste across 6 locations. Cannot search by product name and cannot export evidence to Excel for weekly management review.
- **Jordan (First-Timer / Gerente de Sucursal)**: Sees raw JSON blobs like `{"quantity": 10, ...}` in table cells. Clicking the row does nothing. Cannot tell who performed the adjustment because the user is shown as a sliced UUID (`8f3b1a2c`).
- **Riley (Auditor / Inspector de Calidad)**: Trapped at 50 records with no pagination to review older compliance records, and unable to filter by date to verify compliance with NOM-251 storage protocols for a specific date window.

#### Minor Observations
- The "Actualizar" button uses generic outline styling; adding a subtle relative time indicator ("Actualizado hace 2m") would increase confidence.
- Action badges currently use `default` (black) for Creación; shifting to `success` (green) for Creación, `secondary`/`outline` for Actualización, and `destructive` (red) for Eliminación improves at-a-glance scanning.
- Table headers lack column sorting indicators (e.g. sort by date asc/desc).

#### Questions to Consider
- What if clicking any audit entry opened an instant slide-over drawer highlighting exact numerical and textual differences with color-coded deltas?
- Should the branch selector be synchronized with the global branch context across all inventory modules?
- Would an "Exportar para Auditoría NOM-251" one-click export format provide immediate value during sanitary inspections?
