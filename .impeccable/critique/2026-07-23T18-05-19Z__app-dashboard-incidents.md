---
target: app/dashboard/incidents
total_score: 16
p0_count: 1
p1_count: 3
timestamp: 2026-07-23T18-05-19Z
slug: app-dashboard-incidents
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | No loading skeleton on stats or table; `Suspense` fallback is a plain text string "Cargando incidentes..." with no structure. No confirmation feedback after resolving an incident — user sees nothing until `router.refresh()` completes. |
| 2 | Match System / Real World | 2 | Severity badges show raw enum keys (`CRITICAL`, `WARNING`, `FATAL`, `IN_REMEDIATION`) in English instead of Spanish. `status.replace('_', ' ')` produces "IN REMEDIATION" — neither correct English nor Spanish. Date format is English (`MMM d, yyyy`). |
| 3 | User Control and Freedom | 2 | "Resolver" button fires a PATCH with no confirmation dialog for a high-stakes action. No undo after resolving. No way to un-resolve. Status filter omits `AWAITING_EXTERNAL` and `CONFIRMED` despite being valid enum values. |
| 4 | Consistency and Standards | 3 | Uses the project's Card/Table/Badge vocabulary consistently. Minor deviation: stat cards use the hero-metric pattern (big number, small label) which DESIGN.md explicitly bans. |
| 5 | Error Prevention | 1 | Resolving an incident has zero confirmation — a single click on a small ghost button permanently changes state. `catch` block only logs to console; user never learns the resolve failed. |
| 6 | Recognition Rather Than Recall | 2 | "View details" button is icon-only (`ExternalLink` icon) with no label or tooltip. Users must guess it leads to a detail page. Severity and status use raw code values rather than human-readable labels. |
| 7 | Flexibility and Efficiency | 1 | No keyboard shortcuts. No bulk actions (batch resolve). No sorting on table columns. No search/text filter. No pagination — `LIMIT 100` is a hard ceiling with no indication more exist. |
| 8 | Aesthetic and Minimalist Design | 2 | Four identical stat cards in a row (hero-metric pattern). The page is structurally just stat-cards + one table — functional but generic. Color usage is purely semantic Tailwind classes (`red-100`, `yellow-100`, etc.) instead of the OKLCH token system from DESIGN.md. |
| 9 | Error Recovery | 1 | Resolve failure is swallowed silently. No error state shown in the table. No way to retry. No toast/notification on success or failure. |
| 10 | Help and Documentation | 0 | No contextual help. No tooltips. No inline hints. No guidance on what severities mean or what "resolve" actually does. |
| **Total** | | **16/40** | **Poor — major UX overhaul required** |

## Anti-Patterns Verdict

**LLM assessment**: This page exhibits the classic AI-generated dashboard template. Four identical stat cards in a grid, a single data table, plain Tailwind utility colors instead of the project's OKLCH design tokens — it reads as a scaffold, not a shipped surface. The layout is the "hero-metric template" pattern that DESIGN.md explicitly bans. No personality, no motion, no intentional hierarchy beyond "numbers on top, table below."

**Deterministic scan**: `detect.mjs --json app/dashboard/incidents` returned `[]` — clean. The TSX source doesn't contain inline CSS or banned CSS patterns. The anti-pattern violations are structural and semantic (hero-metric template, raw enum display, missing states) rather than CSS-detectable.

**Visual overlays**: Browser unavailable for this run. No overlay was injected.

## Overall Impression

This is a functional data listing page that does the job of showing incidents in a table with basic filtering. What it doesn't do is make the operator's life easier: there's no urgency signaling, no timeline, no indication of age or SLA breach, no way to act on multiple incidents, and the "resolve" action is dangerously easy to misfire. It reads as the first pass — structurally correct, experientially hollow.

The single biggest opportunity: **make critical incidents feel urgent** — a red counter badge in the sidebar, a pulse or glow on FATAL rows, time-since-creation displayed as relative ("hace 3 horas"), SLA countdown. Right now a 3-hour-old FATAL incident looks identical to a 3-minute-old WARNING.

## What's Working

1. **Correct multi-tenant scoping.** Branch filtering via cookie + company-level query guard is secure and well-structured. The data layer is solid.
2. **Proper Suspense boundary.** The table is wrapped in `<Suspense>` for streaming — the right architectural choice even if the fallback content needs work.
3. **Empty state exists.** The zero-results state shows a green check icon and message rather than a blank void — directionally correct, though it could teach the user more.

## Priority Issues

### [P0] No confirmation on destructive "Resolver" action
**Why it matters**: A single click permanently changes an incident's status. In a HORECA environment where supervisors oversee 15+ branches, a mis-tap on mobile or a rushed click resolves an open critical incident with no way back. The resolution note is hardcoded to "Resuelto desde el tablero" — the operator can't even describe what they did.
**Fix**: Add a confirmation dialog with a required resolution note field. Show a toast on success/failure. Add an undo window (30s) or an "unresolve" path.
**Suggested command**: `$impeccable harden app/dashboard/incidents`

### [P1] Raw English enum values displayed to Spanish-speaking users
**Why it matters**: The interface language is Spanish, but severity badges show `CRITICAL`, `WARNING`, `FATAL` and status badges show `IN REMEDIATION`, `DETECTED`, etc. This breaks the user's mental model and makes the product feel unfinished. Date formatting uses English locale.
**Fix**: Create a display-name map for each enum value (`CRITICAL` → "Crítico", `IN_REMEDIATION` → "En remediación", `AWAITING_EXTERNAL` → "Esperando externo", etc.). Use Spanish date locale with `date-fns/locale/es`.
**Suggested command**: `$impeccable clarify app/dashboard/incidents`

### [P1] Hero-metric stat cards violate the design system
**Why it matters**: DESIGN.md and PRODUCT.md both ban the "big number, small label" hero-metric template. Four identical cards in a row is the exact pattern called out. It also wastes vertical space before the actual actionable table.
**Fix**: Replace with an inline summary strip: "42 incidentes · 12 activos · 3 críticos · 27 resueltos" — compact, scannable, one line. Or integrate counts as column-header badge pills in the table itself.
**Suggested command**: `$impeccable layout app/dashboard/incidents`

### [P1] No feedback states on the resolve action
**Why it matters**: When a user clicks "Resolver", nothing visibly happens until the page refreshes. If the API call fails, the error is swallowed into `console.error`. The user has no idea whether their action succeeded, failed, or is in progress.
**Fix**: Add loading state to the button (spinner + disabled), success toast with the incident title, error toast with retry. Use optimistic UI or at minimum a pending state.
**Suggested command**: `$impeccable harden app/dashboard/incidents`

### [P2] Missing filter values and no table sorting/search
**Why it matters**: Status filter omits `AWAITING_EXTERNAL` and `CONFIRMED` — incidents in those states become invisible to filtered views. No text search means finding a specific incident in 100 rows requires scrolling. No column sorting prevents basic operational patterns like "show oldest unresolved first."
**Fix**: Add all status enum values to the filter. Add a text search field. Add sortable column headers (at minimum: severity, date, status). Add pagination or virtual scroll for >100 incidents.
**Suggested command**: `$impeccable harden app/dashboard/incidents`

## Persona Red Flags

**Alex (Power User)**: No keyboard navigation on the table. No bulk-resolve for clearing a batch of similar incidents after a shift. No sorting — can't quickly find the oldest unresolved incident. The "view details" button is icon-only with no tooltip; Alex will find it but will be annoyed. The 100-row limit means power users with high-volume branches can't see their full history.

**Sam (Accessibility-Dependent)**: The "view details" button has no accessible label — it's just an `<ExternalLink>` icon inside a `<Button>` with no `aria-label` or text. Screen readers will announce nothing meaningful. Severity and status are conveyed partly through color alone (red/yellow/green badges). The stat cards rely on colored text for "Críticos" (red) and "Resueltos" (green) meaning — without the color, the number is just a number.

**María (Branch Supervisor)** — *project-specific*: A HORECA branch supervisor checking incidents during a busy lunch service. She needs to know immediately: "Are there any open critical incidents at my location right now?" The page gives her a global count but no branch-level urgency indicator, no relative timestamps ("hace 20 min"), and no way to distinguish her branch's incidents from the company-wide view without reading each row.

## Minor Observations

- `Suspense` fallback `<div>Cargando incidentes...</div>` should be a skeleton table with header and 3–5 shimmer rows to prevent layout shift.
- `status.replace('_', ' ')` only replaces the first underscore. Use `replaceAll` or a map.
- Date format `MMM d, yyyy HH:mm` produces English month abbreviations. Use `es` locale.
- The `getIncidents` function queries without `where` when no conditions exist (lines 44–48), which would return all incidents across all companies in a multi-tenant system. The companyId guard (line 25) only fires when `companyId` is truthy, but the function is only called after the redirect guard on line 83, so it's safe in practice — but fragile.
- The component's `any[]` type on `getIncidentStats` (line 51) loses type safety.

## Questions to Consider

- What if each incident row showed a relative timestamp ("hace 3h") instead of an absolute date — would operators triage faster?
- Does "resolve" need to be a one-click action at all, or should it be a detail-page workflow with evidence attachment?
- What would happen if 200 incidents were active? The page has no pagination, no virtual scroll, and a hard LIMIT 100.
