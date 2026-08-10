---
target: app/dashboard/labor/schedule-builder
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-08-10T23-14-01Z
slug: app-dashboard-labor-schedule-builder
---
### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3/4 | Unsaved state indicator missing on Save button |
| 2 | Match System / Real World | 3/4 | Good MX Spanish HORECA terms, but shift types lack visual labels |
| 3 | User Control and Freedom | 2/4 | Shift deletion lacks undo action; matrix lacks drag-select |
| 4 | Consistency and Standards | 2/4 | Hardcoded `bg-blue-500` colors and 10px text violate DESIGN.md tokens |
| 5 | Error Prevention | 2/4 | Overlapping shift validation only flags conflicts after creation |
| 6 | Recognition Rather Than Recall | 3/4 | User avatars and roles visible; cell badges hide shift names |
| 7 | Flexibility and Efficiency | 2/4 | No keyboard shortcuts for navigation or quick shift addition |
| 8 | Aesthetic and Minimalist Design | 2/4 | 14 top-level toolbar controls create heavy visual noise |
| 9 | Error Recovery | 2/4 | Conflict alerts require manual delete and re-create flow |
| 10 | Help and Documentation | 2/4 | LFT 48h limit and 24h rest rules lack inline guidance tooltips |
| **Total** | | **23/40** | **Acceptable** |

### Design Specificity Verdict

**LLM assessment**: The Schedule Builder (`app/dashboard/labor/schedule-builder`) provides a rich functional suite for HORECA shift scheduling (matrix, calendar, list, and LFT compliance views). However, visually it suffers from category-interchangeable UI patterns: an overcrowded toolbar with 14 un-grouped buttons, heavy raw Tailwind grid borders (`divide-x divide-muted`), and inline primitive colors (`bg-blue-500`, `bg-purple-500`) instead of OKLCH design system tokens.

**Deterministic scan**: Automated detector (`detect.mjs`) flagged 16 anti-patterns across the labor scheduling component suite:
- 12 instances of `design-system-font-size` (`text-[10px]` violating the 12px Label Floor rule).
- 4 instances of `side-tab` (`border-l-4`/`border-l-2` AI slop accent stripes in conflict validator and bulk assignment cards).

**Visual overlays**: Script injection not run (single-context CLI scan mode).

### Overall Impression

A comprehensive, feature-complete HORECA shift planner that currently feels like a dense administrative form rather than a modern operational command center. Grouping actions, adopting design system tokens, and replacing side-tab borders will drastically elevate usability and visual quality.

### What's Working

1. **Multi-View Flexibility**: Seamless switching between Matrix, Calendar, List, and LFT Compliance views accommodates different supervisor workflows.
2. **MEX Labor Context**: Strong domain integration with LFT compliance checks, MEX shift types (Matutino, Vespertino, Nocturno, Mixto), and branch filtering.
3. **Bulk Assignment Support**: Built-in pattern assignment for recurring weekly shifts saves significant setup time.

### Priority Issues

#### [P1] Toolbar & Action Hierarchy Overload
- **Why it matters**: 14 top-level controls (4 view buttons, 7 action buttons, 3 filters) compete for equal visual weight, causing decision paralysis and high cognitive load for managers.
- **Fix**: Group header into clear visual clusters: (1) View Mode Segmented Control, (2) Primary Actions (`Guardar`, `Publicar` with solid red primary variant), and (3) Utilities Dropdown (`Plantilla`, `Copiar`, `Exportar`, `Configuración`).
- **Suggested command**: `$impeccable layout`

#### [P1] Design System Token & Type Floor Violations
- **Why it matters**: Hardcoded Tailwind colors (`bg-blue-500`, `bg-orange-500`, `bg-purple-500`) break dark mode and design system cohesion. 10px text (`text-[10px]`) violates the 12px Label Floor in DESIGN.md, making shift badges unreadable on kitchen tablets.
- **Fix**: Replace inline color classes with semantic tokens (`--primary`, `--accent`, `--muted`) and bump all 10px type usages to `text-xs` (12px Label Floor).
- **Suggested command**: `$impeccable extract`

#### [P2] AI Slop Side-Tab Accent Borders
- **Why it matters**: Sub-components (`lft-conflict-validator.tsx`, `shift-assignment-bulk.tsx`, `shift-assignment.tsx`) use `border-l-4` colored left-stripes on cards—the classic tell of generic AI-generated interfaces.
- **Fix**: Remove `border-l-4` side borders; replace with flat surface background hierarchy and standard badge indicators.
- **Suggested command**: `$impeccable distill`

#### [P2] Keyboard Navigation & ARIA Matrix Accessibility
- **Why it matters**: Matrix grid is constructed with generic `div` elements lacking ARIA grid semantics (`role="grid"`, `role="gridcell"`). Managers cannot navigate cells using arrow keys or trigger quick add/edit via keyboard.
- **Fix**: Add proper grid accessibility attributes and implement keyboard shortcuts (`Arrow` keys to navigate, `Enter` to edit shift, `c` to copy week).
- **Suggested command**: `$impeccable harden`

#### [P3] Shift Cell Context & Visual Polish
- **Why it matters**: Cells in matrix view only display start-end times (`07:00 - 15:00`) without role icon/tag or shift name, forcing users to hover or open dialogs to confirm assignment roles. Trash icon button is tiny with no touch padding.
- **Fix**: Include concise role indicator/badge in matrix cells and increase touch target padding on hover actions.
- **Suggested command**: `$impeccable polish`

### Persona Red Flags

- **Alex (Power User - Restaurant Manager)**: Cannot use keyboard to navigate matrix cells. Adding/editing shifts for 15 employees requires 100+ mouse clicks. High fatigue during weekly scheduling.
- **Jordan (First-Timer Supervisor)**: Distracted by 14 top-level toolbar buttons with identical outline styling. Unclear when changes are in draft state versus published to employees.
- **Sam (Accessibility-Dependent User)**: Screen reader cannot read matrix grid coordinates because the matrix uses unannotated `div` elements instead of `role="grid"`. Focus rings missing on cell interaction targets.

### Minor Observations

- The `Search searchQuery` input is fixed width (`w-50` / `w-48`) and can crowd mobile viewports.
- The `Guardar` button remains enabled even when no changes have been made to shifts.
- Conflict alert badge pops up in filter bar rather than inline next to affected matrix rows.

### Questions to Consider

- What if matrix grid cells supported quick click-and-drag range selection to assign multi-day shifts?
- Could LFT compliance warnings show preemptively in the shift creation dialog before saving?
- What would a confident, red-accented header action bar look like with distinct primary/secondary visual hierarchy?
