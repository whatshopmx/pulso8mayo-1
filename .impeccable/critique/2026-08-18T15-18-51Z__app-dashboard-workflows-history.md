---
target: app/dashboard/workflows/history
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-08-18T15-18-51Z
slug: app-dashboard-workflows-history
---
#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | No skeleton loading state; live search causes immediate layout jumps; export button triggers dummy toast with no progress |
| 2 | Match System / Real World | 3 | Spanish domain terms are clear ("Incidencias", "Evidencias"), but lacks shift-based operational groupings (Apertura/Cierre) |
| 3 | User Control and Freedom | 3 | Has clear filters button, but lacks pagination controls and multi-select/bulk export capabilities |
| 4 | Consistency and Standards | 2 | Rogue Tailwind classes (`bg-green-500`, `bg-blue-100`, `text-green-600`) clash with Pulso's OKLCH design token system and badge variants |
| 5 | Error Prevention | 3 | Dropdown filters prevent invalid options, but date pickers lack validation that dateFrom ≤ dateTo |
| 6 | Recognition Rather Than Recall | 2 | 7 flat filter dropdowns displayed at once without visual chunking; dual status badges in one cell increase cognitive load |
| 7 | Flexibility and Efficiency | 2 | No keyboard shortcuts, no quick filter presets ("Hoy", "Con Incidencias", "Pendientes de revisión"), no column sorting |
| 8 | Aesthetic and Minimalist Design | 2 | Nested borders (`Card > rounded-md border > Table`) and busy 4-column filter grid create visual clutter contrary to flat-by-default rules |
| 9 | Error Recovery | 2 | API error toasts a message and shows default empty state without retry action or network failure distinction |
| 10 | Help and Documentation | 2 | Generic subtitle; no contextual tooltips explaining metrics like "Tasa de Completación" or review workflows |
| **Total** | | **23/40** | **Acceptable (57.5%)** |

#### Design Specificity Verdict

**LLM assessment**: The workflow history view fulfills functional tracking but feels like a generic CRUD table template rather than an authentic command center for Mexican restaurant chains. A restaurant operator managing 15 branches during a busy lunch service needs to instantly identify exceptions, overdue audits, and failed NOM compliance checks. The current UI treats a critical NOM-251 hygiene failure identically to an inventory routine, burying vital operational signals inside an 8-column unpaginated table.

**Deterministic scan**: Automated scan ran on `app/dashboard/workflows/history` and related workflow components with 0 static linter violations, but semantic inspection revealed hardcoded utility classes bypassing OKLCH theme tokens.

**Visual overlays**: No browser overlay active (fallback signal used).

#### Overall Impression
The workflow history interface provides the core data fields needed to trace executions, but it suffers from high cognitive load in the filter controls, missing pagination for multi-branch scale, and color inconsistency with Pulso's design system. By streamlining the filters into smart presets, standardizing badge/stat tokens, and structuring the table for rapid scanning, this screen can transform into a true operational command center.

#### What's Working
1. **Clear Status & Evidence Indicators**: Showing evidence counts (`X Evidencias`) and incident warnings (`Incidencias`) directly under the template name provides instant context without requiring extra clicks.
2. **Context-Aware Action Links**: Dynamically switching primary row actions between "Ver revisión" (`/review/[id]`) for reviewed workflows and "Ejecutar / Continuar" (`/execute`) for pending instances keeps the user flow logical.
3. **Smooth Scroll to Reviewed Row**: The `?revisada=<id>` URL search parameter handling with smooth scroll-into-view creates a seamless loop when returning from the review detail screen.

#### Priority Issues

- **[P1] Inconsistent Color Palette & Rogue Tailwind Badges**
  - **Why it matters**: Hardcoded classes like `bg-green-500`, `text-green-600`, `bg-blue-100 text-blue-800`, and `text-orange-600` break dark mode support and violate Pulso's OKLCH design tokens and `<Badge variant="...">` system.
  - **Fix**: Replace all ad-hoc Tailwind colors with semantic tokens (`text-success`, `text-info`, `text-warning`, `text-destructive`, and `Badge variant="success"`).
  - **Suggested command**: `$impeccable colorize`

- **[P1] Unbounded Query & Missing Table Pagination**
  - **Why it matters**: The API route limits to 100 items without offset/cursor pagination, page controls, or record count feedback. A 10-branch group running daily workflows generates 100+ instances in two days, making older history completely unreachable.
  - **Fix**: Implement pagination controls with page size selection and "Mostrando X de Y workflows" indicators.
  - **Suggested command**: `$impeccable harden`

- **[P1] Filter Grid Overload & Awkward Export Button Placement**
  - **Why it matters**: 7 filter inputs crammed into a 4-column grid alongside an "Exportar" button creates high cognitive load (4+ choices at one decision point). The export button acts as a dummy toast with no actual file download.
  - **Fix**: Consolidate filters into a clean search input with quick operational chips ("Hoy", "Esta Semana", "Con Incidencias", "Rechazados") and a dedicated popover for secondary filters; move Export to the page/table header actions with genuine CSV/Excel export logic.
  - **Suggested command**: `$impeccable layout`

- **[P2] Nested Borders & Cluttered Tonal Layering**
  - **Why it matters**: Wrapping the table in a `Card` and then an inner `rounded-md border` creates duplicate outer strokes that violate Pulso's "Flat-by-Default" elevation guidelines.
  - **Fix**: Remove redundant nested borders, use single clean horizontal table dividers with subtle hover tints, and improve visual breathing room.
  - **Suggested command**: `$impeccable polish`

- **[P2] Responsive Table Squish on Mobile & Tablet**
  - **Why it matters**: 8 columns with a fixed-width progress bar (`w-24`) and stacked badges cause severe horizontal squishing on kitchen tablets and mobile devices used on restaurant floors.
  - **Fix**: Introduce responsive column prioritization or compact card layout for viewport widths under 768px.
  - **Suggested command**: `$impeccable adapt`

#### Persona Red Flags

**Alex (Impatient Power User / Chain Owner)**:
- Cannot quickly filter to failed or incident-flagged workflows across 15 branches with one click.
- No column sorting (e.g., clicking "Calificación" to see lowest scores first).
- No keyboard shortcuts (`/` for search, `Esc` to reset filters).

**Jordan (Confused First-Timer / New Branch Manager)**:
- Confronted by 7 filter dropdowns with identical visual weight and no guidance on typical queries.
- Export button placed inside the filter grid looks like another filter option rather than an action.
- Dual badges ("COMPLETED" + "Aprobado") in the status column cause confusion between execution lifecycle and manager approval.

**Casey (Distracted Mobile / Kitchen Supervisor)**:
- 8 dense table columns require horizontal scrolling on mobile; tap targets for row buttons are cramped.
- Search input triggers live API requests on every single character keystroke without debounce, causing layout jumps on mobile connections.

#### Minor Observations
- The stat cards use generic Lucide icons (`FileText`, `TrendingUp`) instead of high-signal operational indicators.
- In progress percentage calculation defaults to 0 without indicating whether a workflow has unstarted steps or zero defined steps.
- Search placeholder says "Buscar workflow..." while the card description repeats similar wording.

#### Questions to Consider
- What if the history page offered 1-click filter presets for daily shift operational reviews (e.g. "Cierre de ayer", "Auditorías NOM reprobadas")?
- Does the table need 8 visible columns by default, or could metadata like Assignee and Branch be grouped into a single unified context cell?
- What would a confident, flat-by-default table look like with zero nested borders and pure tonal layering?
