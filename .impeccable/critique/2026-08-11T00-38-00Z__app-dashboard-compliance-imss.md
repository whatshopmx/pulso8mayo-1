---
target: app/dashboard/compliance/imss
total_score: 16
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-08-11T00-38-00Z
slug: app-dashboard-compliance-imss
---
⚠️ DEGRADED: single-context (no sub-agent tool exposed)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Loading spinner exists, but no inline loading on MetricCards; no skeleton on sub-pages; no feedback after IDSE file download beyond toast |
| 2 | Match System / Real World | 2 | Mixed language — "terminated(s)", "salary nuevo", "salary", IDSE tipo codes "08"/"02"/"07" shown raw without contextual labels; "Desregistro" is not standard Spanish |
| 3 | User Control and Freedom | 2 | No breadcrumbs; no back navigation; no undo after IDSE file generation; no way to deselect-all quickly |
| 4 | Consistency and Standards | 1 | Altas "READY" → green, Bajas "READY" → blue; mini-summary cards use raw Tailwind colors (text-orange-600, text-green-600, text-red-600, text-blue-600) instead of design-system tokens; checkbox uses Unicode "✓"/"○" instead of a real checkbox component; reports page metric cards put icons in CardHeader beside title instead of canonical MetricCard layout |
| 5 | Error Prevention | 2 | SUA allows $0 salary submission; no confirmation before IDSE generation; Bajas toggleAll selects PENDING employees who may lack NSS for IDSE |
| 6 | Recognition Rather Than Recall | 2 | IDSE movement codes "08", "02", "07" shown without context; main page is a flat list of links — no visual indicator of pending counts or urgency per section |
| 7 | Flexibility and Efficiency | 1 | No keyboard shortcuts; no search/filter on tables; no sorting; no date-range filter on reports history; no bulk salary update |
| 8 | Aesthetic and Minimalist Design | 2 | Reports page duplicates generation UI already available at /altas and /bajas; main page is a flat list of identical outline buttons — no visual weight differentiation; mini-summary cards on sub-pages re-implement MetricCard poorly |
| 9 | Error Recovery | 1 | Catch blocks emit generic "Error al cargar datos" / "Error al generar archivo" with no specifics; altas page silently swallows non-ok responses; no retry on sub-page errors |
| 10 | Help and Documentation | 1 | Alert banners mention "multas" and deadlines but provide no links to IMSS guidance; no tooltips explaining NSS/CURP/RFC requirements; no inline help for SUA salary format |
| **Total** | | **16/40** | **Poor** |

## Design Specificity Verdict

**LLM assessment**: The IMSS section feels like a generic CRUD scaffold wearing IMSS labels. There is nothing in the visual language, layout, or interaction model that signals this is Pulso — or even that it's a compliance tool for Mexican HORECA operators. The main page is four MetricCards plus a flat list of links; the sub-pages are unstyled tables with inline summary cards that ignore the design system's MetricCard. The typography, color choices, and layout could belong to any SaaS admin panel. The anti-reference in PRODUCT.md — "never feel like a government system" — is exactly what this section feels like: institutional tables, generic badges, and raw regulatory codes.

**Deterministic scan**: CLI detector returned zero findings (the detector may not flag structural/semantic patterns caught by manual review). The directory contains 5 source files totaling ~63KB of TSX.

## Overall Impression

This section is functional but bland and inconsistent. It serves its purpose — list employees, generate IDSE/SUA files — but does so with the minimum viable effort. The biggest opportunity is making the IMSS hub into a genuine compliance command center that immediately communicates "what needs my attention right now" rather than presenting a flat menu of equal-weight actions.

## What's Working

1. **Correct use of MetricCard on the main page.** The IMSS index page uses the canonical `MetricCard` component with proper `tone`, `progress`, and `subtitle` props. This is the right pattern.
2. **Empty states exist.** Both Altas and Bajas provide empty-state illustrations (icon + message) when no data is present, which is better than showing a blank table.
3. **Real-time urgency signal in tables.** The `daysSinceHire` / `daysSinceTermination` column with red-bold styling for >5 days is a genuine operational signal — the kind of detail Pulso should lean into.

## Priority Issues

### [P1] Broken i18n: English fragments in a Spanish interface
**What**: Multiple untranslated strings: `"terminated(s)"` (bajas/page.tsx:181), `"salary"` twice in SUA (sua/page.tsx:72, 221), `"Ingresa al menos un salary"` (sua/page.tsx:72). `"Desregistro"` (bajas/page.tsx:134) is not standard Spanish — should be "Baja" or "Aviso de baja". `"Pasaron deadline"` (altas/page.tsx:176, bajas/page.tsx:171) mixes Spanish/English.
**Why it matters**: HORECA operators in Mexico expect a fully Spanish interface. Mixed-language copy erodes trust and reads as unfinished.
**Fix**: Audit every string in the IMSS directory for language consistency. Replace all English fragments with proper es-MX copy.
**Suggested command**: `$impeccable clarify app/dashboard/compliance/imss`

### [P1] Inconsistent visual system: ad-hoc mini-summary cards vs. MetricCard
**What**: Altas, Bajas, and Reports sub-pages build their own summary cards using raw `Card` + inline `text-2xl font-bold text-orange-600` instead of the canonical `MetricCard` component that the main IMSS page already uses. The Reports page puts icons in `CardHeader` beside the title (not inside the MetricCard icon slot). Altas "READY" uses `bg-green-600`, Bajas "READY" uses `bg-blue-600` — same semantic status, different color.
**Why it matters**: The user has a canonical component (`MetricCard`) with semantic tokens, loading skeletons, and accessible progress bars. Duplicating it with raw Tailwind classes creates visual drift, accessibility gaps (no `aria-busy` skeleton), and maintenance debt.
**Fix**: Replace all hand-rolled summary cards on sub-pages with `MetricGrid` + `MetricCard`. Standardize "READY" badge color across Altas and Bajas. Use design-system semantic tokens (`success`, `warning`, `destructive`) instead of raw Tailwind colors.
**Suggested command**: `$impeccable layout app/dashboard/compliance/imss`

### [P1] Checkbox impersonation with Unicode glyphs
**What**: Selection columns use `"✓"` / `"○"` text inside a `Button variant="ghost"` instead of a real `<Checkbox>` component. This fails the craft-floor ban on "Unicode glyphs or emoji standing in for an icon system."
**Why it matters**: Screen readers announce "button, check mark" which is semantically wrong. The visual appearance changes with font rendering across platforms. There is no indeterminate state.
**Fix**: Replace with the shadcn/ui `Checkbox` component. Wire `checked` / `onCheckedChange` to the selection state. Add `aria-label="Seleccionar [nombre]"` for each row.
**Suggested command**: `$impeccable harden app/dashboard/compliance/imss`

### [P2] Reports page duplicates functionality available in Altas/Bajas/SUA
**What**: The Reports page has "Generar Archivo SUA", "Generar IDSE Altas", "Generar IDSE Bajas", and "Generar IDSE Mod. Salarial" buttons — but the first three are already accessible from their dedicated sub-pages with better context (employee selection, data validation). The Reports page generates files without selecting specific employees.
**Why it matters**: Two paths to the same action creates confusion about which one is "right." The Reports page version skips employee selection, which could generate empty files or all-employee files unexpectedly.
**Fix**: Remove duplicate generation buttons from Reports. Keep Reports focused on history/audit log. Add a cross-link from sub-pages ("Historial de archivos generados") to the Reports tab.
**Suggested command**: `$impeccable distill app/dashboard/compliance/imss/reports`

### [P2] No navigation or wayfinding between IMSS sub-pages
**What**: No breadcrumbs, no sidebar highlight, no back button. Once inside `/altas`, the only way back to `/imss` is the browser back button or the main sidebar.
**Why it matters**: An operator managing 15 branches will bounce between Altas, Bajas, and SUA frequently. Forcing them back to the hub page for every switch adds friction.
**Fix**: Add breadcrumb navigation (`IMSS > Altas`) below the PageHeader. Consider a sub-navigation bar (Altas | Bajas | SUA | Reportes) at the top of each sub-page.
**Suggested command**: `$impeccable layout app/dashboard/compliance/imss`

## Persona Red Flags

**Alex (Power User)**: No keyboard shortcuts for table selection. No search or filter — with 200+ employees across 15 branches, scrolling a flat table is untenable. No bulk salary update in SUA. The "select all" toggle on Altas only selects READY; on Bajas it selects READY + PENDING (inconsistent). No sorting on any column.

**Jordan (First-Timer)**: IDSE codes "08", "02", "07" shown raw with no explanation. "SUA", "IDSE", "NSS", "CURP", "RFC" are unexplained acronyms. The difference between the SUA page and the Reports "Generar SUA" is unclear — which one should I use? The alert banner mentions "multas significativas" but doesn't say what they are or link to guidance.

**Sam (Accessibility-Dependent)**: Unicode "✓"/"○" checkboxes are not real form controls — no `aria-checked`, no keyboard toggle. Tables lack `aria-label` or `caption`. Alert banners have no `role="alert"`. Color alone distinguishes READY (green) from READY (blue) across pages. `bg-green-50/50` row highlighting on Altas is color-only and extremely low contrast.

## Minor Observations

- `readyCount` variable on altas page is computed but unused in the JSX beyond the header description.
- SUA page uses `onBlur` to track salary changes — easy to miss if user tabs away before typing. `onChange` with debounce would be more reliable.
- SUA `getDefaultSalary` falls back to `300` — this magic number should be a named constant or come from configuration.
- Reports page uses `CardHeader` with an icon next to the title but doesn't pass it through a slot — it renders as disconnected inline text.
- `handleGenerateIdse` on Reports sends `movementType` without `employeeIds`, relying on server to default to all employees — risky and undocumented.
- Bajas page `toggleAll` selects READY + PENDING, but Altas `toggleAll` selects only READY — inconsistent behavior for the same pattern.

## Questions to Consider

- What if the IMSS hub showed a timeline of upcoming deadlines (next alta deadline, next SUA filing) instead of a flat link list?
- What if the overdue count pulsed or used the Operational Red to create genuine urgency — the way a real compliance dashboard should?
- What if each sub-page had inline filters by branch, so a multi-location operator could process one sucursal at a time?
