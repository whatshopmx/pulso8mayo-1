---
target: app/dashboard/reports
total_score: 30
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-08-28T22-04-58Z
slug: app-dashboard-reports
---
# Design Critique: app/dashboard/reports

Method: ⚠️ DEGRADED: single-context (no general sub-agent tool exposed in this session; browser inspection performed via browser subagent)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3/4 | Spinners during generation, but no date range feedback before download |
| 2 | Match System / Real World | 4/4 | Excellent HORECA terminology (NOM-251, COFEPRIS, Food Cost, STPS) |
| 3 | User Control and Freedom | 3/4 | No abort for queries; no edit/pause/delete in scheduled reports list |
| 4 | Consistency and Standards | 2/4 | `control/page.tsx` deviates from `PageContainer`/`PageHeader` pattern |
| 5 | Error Prevention | 3/4 | Sensitive data export alert is great; schedule email input lacks validation |
| 6 | Recognition Rather Than Recall | 3/4 | Saved questions shine, but global navbar branch scope dependency is subtle |
| 7 | Flexibility and Efficiency | 3/4 | 1-click downloads & questions, but no catalog search or batch exports |
| 8 | Aesthetic and Minimalist Design | 3/4 | Flat tonal layering & Geist typography adhered to; some density in control tables |
| 9 | Error Recovery | 3/4 | Good error states with retries; schedule form error feedback is a generic toast |
| 10 | Help and Documentation | 3/4 | Clear descriptions; lacks inline explanation of official vs operational criteria |
| **Total** | | **30/40** | **Good** |

## Design Specificity Verdict

**LLM Assessment:** The `/dashboard/reports` ecosystem is genuinely authored for Mexican multi-unit restaurant operations rather than generic SaaS. Features like pre-configured business questions in `saved-questions.ts` ("¿A quién se le venció un documento?", "¿A quién le falta CURP en el expediente?"), official regulatory badges for NOM-251/COFEPRIS and NOM-035/STPS, sensitive personal data export guardrails, and food cost theoretical vs. real comparisons directly reflect HORECA management needs.

**Deterministic Scan:** Automated rule scan via `detect.mjs` returned 0 design system violations (code 0).

**Visual Inspection (Browser):** Verified live with demo credentials across `/dashboard/reports`, `/dashboard/reports/custom`, `/dashboard/reports/schedule`, and `/dashboard/reports/control`. Clean flat OKLCH tonal layering, crisp Geist font hierarchy, and responsive grid layouts.

## Overall Impression
Pulso's reports suite provides high-value operational tools and compliance safeguards. The primary design opportunity is eliminating architectural fragmentation—specifically bringing `control/page.tsx` into standard layout parity, adding explicit date-range context to standard catalog downloads, and providing complete lifecycle controls (edit/pause/delete) for scheduled reports.

## What's Working
1. **"Preguntas Guardadas" UX:** Elevating natural language business questions above raw SQL/field builders reduces cognitive load for restaurant managers.
2. **Sensitive Data Confirmation:** The `AlertDialog` detailing exact sensitive fields (e.g. CURP) before CSV export provides high-trust compliance assurance.
3. **Design System Adherence:** Clean tonal elevation, zero box shadows, consistent 12px label floors, and single-family Geist typography.

## Priority Issues

### [P1] Shell & Layout Inconsistency in Control Gerencial
- **What:** `app/dashboard/reports/control/page.tsx` uses raw `<div className="container mx-auto py-6 space-y-6">` and native `<h1>` instead of the standardized `PageContainer` and `PageHeader` components used across the rest of the app. It also imports a different `EmptyState` component (`@/components/ui/empty-state` vs `@/components/shared`).
- **Why it matters:** Breaks visual consistency and shell padding across navigation transitions.
- **Fix:** Refactor `control/page.tsx` to use `PageContainer`, `PageHeader`, and shared layout primitives.
- **Suggested command:** `$impeccable layout app/dashboard/reports/control`

### [P1] Date Range Ambiguity in Standard Catalog Downloads
- **What:** Clicking "PDF" or "Excel" on any report card in `/dashboard/reports` immediately initiates download without showing or allowing the manager to verify the date period (e.g., current month vs. last 30 days vs. custom range).
- **Why it matters:** Managers downloading reports for external inspections or internal audits risk printing wrong date ranges without realization until opening the generated file.
- **Fix:** Add a period selector or a fast confirmation popover/drawer that clarifies and allows setting the target period prior to generation.
- **Suggested command:** `$impeccable clarify app/dashboard/reports`

### [P2] Incomplete Lifecycle Management in Scheduled Reports
- **What:** The "Reportes programados" list in `/dashboard/reports` displays scheduled items and status badges ("Activo" / "Falló"), but lacks action triggers (Editar, Pausar, Eliminar, Forzar envío ahora).
- **Why it matters:** Users must create new reports or depend on database updates to modify recipients or frequencies.
- **Fix:** Add a dropdown menu to each scheduled item for immediate management.
- **Suggested command:** `$impeccable harden app/dashboard/reports`

### [P2] Email Input Ergonomics in Schedule Form
- **What:** In `app/dashboard/reports/schedule/page.tsx`, `deliveryEmails` is a single raw text input expecting comma-separated emails without real-time format validation.
- **Why it matters:** Typos in email addresses lead to silent delivery failure or failed cron runs.
- **Fix:** Implement a chip/tag email input with syntax validation on blur.
- **Suggested command:** `$impeccable harden app/dashboard/reports/schedule`

## Persona Red Flags

- **Alex (Power User / Group CFO):** Cannot batch-export multiple reports simultaneously across all 8 branches, cannot edit scheduled reports from the UI, and cannot export the `control/page.tsx` budget deviation or price comparison tables to CSV.
- **Jordan (First-Timer / Branch Manager):** Cannot see what date range the NOM-251 PDF download covers before clicking; might not realize the download applies to the branch selected in the global navbar header.
- **Sam (Accessibility-Dependent User):** Good button ARIA labels in custom builder, but table cells in `control/page.tsx` lack descriptive headers for screen readers when reading numeric deviations.

## Minor Observations
- Catalog tab bar in `reports/page.tsx` lacks an instant text search filter for quick catalog lookup.
- `control/page.tsx` is not currently linked from the main `/dashboard/reports` header or tab navigation.

## Questions to Consider
- Should "Control Gerencial" be integrated as a top-level tab inside the Reports Hub (`/dashboard/reports`), or linked directly from the sidebar?
- Would a quick date preset selector (Hoy, Esta semana, Este mes, Mes anterior) directly above the report catalog streamline daily manager downloads?
