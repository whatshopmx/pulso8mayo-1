# Implementation Plan: Compliance Section Critique Remediation

## Overview

Remediate the 8 issues from the design critique of `app/dashboard/compliance/` + `components/compliance/` (19/40 design-health score). The section currently behaves like "three different products joined by one sidebar icon": the dashboard says the best branch is **red**, the corporate grid says the same number is **green**, the sub-pages bypass the design system (hand-rolled KPI cards, raw Tailwind colors, en-US/Spanglish copy, silent failures), and half the routes are unreachable from navigation while duplicating `/dashboard/labor/`. Outcome: one consistent compliance identity — a single rate→color semantic mapping everywhere, canonical MetricCard/PageHeader, es-MX voice, linked routes, and trustworthy error states.

**Scope boundary:** This is a surface-level remediation of existing pages. It does NOT redesign the IA (obligation-deadline organization), does NOT touch the API layer, and does NOT modify `templates/`, `lib/inngest/`, or the workflow engine.

## Architecture Decisions

- **D1 — Single source of truth for rate→semantic mapping.** Extend the existing `components/compliance/rate-badge.tsx` (documented as the "dueño único de los umbrales", D3 capa 2). Export `getRateTier`, `getRateBadgeVariant` (tier → Badge variant), `getRateColor` (tier → OKLCH chart color), and `getRateClasses` (tier → Tailwind semantic classes for text/dot/progress). Thresholds stay 90/70 everywhere. Delete the duplicate `getComplianceColor`/`getComplianceBg` in `corporate-compliance-grid.tsx` and the hardcoded `variant={rate >= 90 ? "default" : ...}` in `compliance-dashboard.tsx`. Rationale: a compliance product's color semantics are its product; one owner prevents the red/green collision from recurring.
- **D2 — Canonical home per capability.** Breaks and overtime live under **Personal** (`/dashboard/labor/breaks`, `/dashboard/labor/overtime`), which already has full component implementations (`BreakManagementDashboard`, `OvertimeDashboard`) linked in the sidebar; the hand-rolled copies under `/dashboard/compliance/` become server-side `redirect()`s. IMSS/SAT/expediente/schedules/payroll stay under **Cumplimiento** and get sidebar links. Rationale: kill the drift (the compliance Breaks page already regressed — "Con Issues") and make orphaned features reachable.
- **D3 — The header `BranchScopeControl` (AD-1, cookie-backed) owns branch scope.** The Dashboard tab's in-page branch Select is removed; the active scope is surfaced as a chip. The Nómina tab stops abusing `companyId={selectedBranchId || ''}` and receives the real companyId from the server component. Rationale: two scope controls forces the user to hold "which branch am I looking at?" in working memory.
- **D4 — Error ≠ empty.** Typed `{ loading | error | data }` states with a retry affordance in compliance-dashboard, imss, sat. A failure must never render as "0%" or "No compliance data available". Rationale: an owner who can't load compliance data must not believe compliance is zero.
- **D5 — Flat-by-default, nested-by-need.** The root tab bar's IMSS and Nómina tabs become hubs that link to canonical pages (removing the inline SUA/IDSE generators and the embedded PayrollExport), cutting the "6→5→2 nested tabs" stack. Dashboard sub-tabs stay but the control row drops to period + export only. Rationale: ≤4 simultaneous controls on first paint for a busy owner.
- **D6 — PDFs are documents for inspectors.** `exportToPDF` becomes fully es-MX (headers, section names, formatted dates) and uses the brand palette (Operational Red `oklch(0.52 0.17 25)` for table headers) instead of the off-brand blue `[59,130,246]`.

## Task List

### Phase 1: Foundation — one rate→color mapping (fixes P1 #1, P3 #7)

- [ ] **Task 1:** Canonical compliance-rate module + consume everywhere

### Checkpoint: Foundation
- [ ] `pnpm run build` passes
- [ ] A 98% branch renders the same semantic color (green/success) in dashboard scorecard, "Por Sucursal" tab, and corporate grid
- [ ] No `variant="default"` used for any compliance-rate badge in the section

### Phase 2: Reachability & dedupe (fixes P1 #2)

- [ ] **Task 2:** Sidebar links for orphaned routes
- [ ] **Task 3:** Redirect compliance breaks/overtime → labor; make IMSS + Nómina tabs hubs

### Checkpoint: Reachability
- [ ] Every route under `app/dashboard/compliance/**` is reachable from the sidebar or in-page hub links
- [ ] Exactly one implementation of breaks and one of overtime exist
- [ ] `pnpm run build` passes

### Phase 3: Trust — error states & language (fixes P2 #5, P1 #3)

- [ ] **Task 4:** Typed fetch states with retry (compliance-dashboard, imss, sat)
- [ ] **Task 5:** es-MX localization + branded PDF

### Checkpoint: Trust
- [ ] Killing the compliance API returns an error view + toast, never "No compliance data available"
- [ ] Zero English strings in the section; PDF headers use the brand palette
- [ ] Manual check: kill network → see error + retry works

### Phase 4: Design-system unification (fixes P1 #4, P2 #6, and the payroll scope bug)

- [ ] **Task 6:** MetricCard + PageHeader migration (imss, sat, expediente); scope chip; payroll companyId fix
- [ ] **Task 7:** Flatten top-level tabs / progressive disclosure

### Checkpoint: Unification
- [ ] No hand-rolled KPI cards or `text-3xl font-bold` page titles remain in the section
- [ ] First screen of the Compliance dashboard exposes ≤4 controls
- [ ] Nómina tab at "Todas" scope no longer passes `''` as companyId

### Phase 5: Hardening (fixes P3 #8)

- [ ] **Task 8:** Schedules delete confirmation + a11y (aria-labels, aria-pressed)

### Checkpoint: Complete
- [ ] All acceptance criteria per task met
- [ ] `pnpm run build` + `pnpm run lint` clean
- [ ] Rerun detector on `components/compliance/` → 0 findings; `pnpm test:e2e` passes
- [ ] Re-run design critique → target ≥32/40

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Redirecting `/dashboard/compliance/breaks` breaks bookmarks/cron URLs | Med | Use `redirect()` (302 for old URLs) in the route pages; check `lib/cron` / notification URLs for hardcoded compliance/breaks references before deleting files |
| `success` Badge variant conflicts with existing `variant="default"` usages elsewhere (equipment outside scope noticed as systemic) | Low | Keep the mapping change scoped to compliance; do NOT touch other sections in this pass |
| IMSS/AI verifications link to compliance URLs (cron notification deep-links to IMSS) | Low | Keep routes alive where referenced (imss/altas etc. stay put — only breaks/overtime redirect) |
| Deleting duplicate code (compliance breaks/overtime) touches a large surface | Med | Redirect first, run build, then remove dead files in a separate commit |
| OKLCH chart colors (getRateColor) render differently from Tailwind text classes | Low | Reuse the exact token values already in DESIGN.md (success `oklch(0.60 0.16 150)`, warning `oklch(0.72 0.15 80)`, destructive `oklch(0.50 0.22 22)`) |

## Open Questions

- Should `expediente` live under Cumplimiento (compliance documents) or Personal (labor files)? Default assumed: Cumplimiento — flagged for human review.
- The critique asks whether the compliance section should be organized by obligation *deadline* instead of by institution (IMSS/SAT). Out of scope for this pass; separate IA project.
- Keep "Por Sucursal" sub-tab in the dashboard separate from the full Vista Corporativa grid, or merge them? Default assumed: keep both (dashboard = period-scoped analytics; corporate grid = fixed 7/30/90 semáforo) but they share the same color mapping.