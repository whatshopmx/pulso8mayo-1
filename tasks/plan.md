# Implementation Plan: Schedule Builder UI Remediation

## Overview
Remediate UX/UI critique findings across the Labor Schedule Builder (`app/dashboard/labor/schedule-builder`) by reorganizing the action toolbar into clean visual clusters, upgrading off-ramp font sizes to the 12px Label Floor, replacing hardcoded color primitives with semantic design system tokens, removing `border-l-4` AI slop side-borders, and adding ARIA matrix grid accessibility.

## Architecture & Design Decisions
1. **Toolbar Visual Hierarchy**:
   - Reorganize 14 un-grouped header controls into 3 distinct functional groups:
     - **View Segmented Control**: `Matriz`, `Calendario`, `Lista`, `Cumplimiento`.
     - **Primary Action Pair**: `Guardar` (outline/primary indicator when dirty) and `Publicar` (solid red primary action).
     - **Utilities Overflow Dropdown**: `Plantilla`, `Copiar`, `Exportar`, `Configuración`, `Asignación Masiva`.
   - Dedicated filter row with responsive input layout and inline conflict counters.

2. **Design Tokens & Label Floor**:
   - Upgrade all `text-[10px]` and `text-[9px]` font size classes across `components/labor/` to `text-xs` (12px Label Floor in DESIGN.md).
   - Convert hardcoded `bg-blue-500`, `bg-orange-500`, `bg-purple-500` shift color classes to semantic theme tokens or badge variants (`bg-primary/10`, `text-primary`, etc.).

3. **Flat Surface Styling**:
   - Replace `border-l-4` and `border-l-2` colored left-side stripes on conflict validator cards and shift assignment lists with 1px borders, subtle surface backgrounds (`bg-card`), and status badge indicators.

4. **Grid Accessibility**:
   - Annotate matrix view container and cells in `unified-shift-scheduler.tsx` with ARIA grid attributes (`role="grid"`, `role="row"`, `role="gridcell"`).

---

## Task List

### Phase 1: Header Toolbar & Action Hierarchy ($impeccable layout)
- [ ] **Task 1**: Refactor `UnifiedShiftScheduler` toolbar layout into clean visual clusters (View Segmented Switcher, Primary Action Pair, Utilities Dropdown Menu, and Filter Bar).

### Checkpoint 1: Action Hierarchy
- [ ] Header controls are visually grouped, responsive, and free of 14-button clutter.

### Phase 2: Design Token & Label Floor Standardization ($impeccable extract & typeset)
- [ ] **Task 2**: Upgrade all 10px/9px font sizes to 12px (`text-xs`) across `schedule-calendar.tsx`, `shift-assignment-bulk.tsx`, `shift-assignment.tsx`, `shift-scheduler.tsx`, `ShiftCell.tsx`, `weekly-shift-planner.tsx`, and `labor-quick-action-drawer.tsx`.
- [ ] **Task 3**: Replace hardcoded `bg-blue-500`, `bg-orange-500`, `bg-purple-500` shift color primitives in `unified-shift-scheduler.tsx`, `ShiftCell.tsx`, and `shift-assignment-bulk.tsx` with semantic token badge variants.

### Checkpoint 2: Design Tokens & Type Floor
- [ ] `detect.mjs` scan reports zero `design-system-font-size` findings on `components/labor`.

### Phase 3: AI Slop Removal & Flat Surface Styling ($impeccable distill)
- [ ] **Task 4**: Remove `border-l-4` and `border-l-2` side-tab accent borders in `lft-conflict-validator.tsx`, `shift-assignment-bulk.tsx`, `shift-assignment.tsx`, and `shift-scheduler.tsx`. Standardize card styling with flat 1px borders.

### Checkpoint 3: Slop Removal
- [ ] `detect.mjs` scan reports zero `side-tab` findings on `components/labor`.

### Phase 4: Grid Accessibility & Polish ($impeccable harden & polish)
- [ ] **Task 5**: Add ARIA grid semantics (`role="grid"`, `role="row"`, `role="gridcell"`) to Matrix View in `unified-shift-scheduler.tsx`, improve cell role indicator visibility, and expand hover action touch targets.

### Checkpoint 4: Complete
- [ ] `pnpm run build` completes with 0 errors.
- [ ] Re-run `detect.mjs` on `app/dashboard/labor/schedule-builder` and `components/labor` confirms clean status.

---

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| View switching state breaks | Medium | Keep existing state machine (`viewMode`, `bulkMode`) unchanged; only restructure JSX wrapper components |
| Matrix grid alignment shifts with `text-xs` font size | Low | Adjust cell padding (`p-1.5`) so matrix row heights stay compact while meeting 12px text floor |

## Verification Plan
1. `node .agents/skills/impeccable/scripts/detect.mjs --json app/dashboard/labor/schedule-builder components/labor` (must exit code 0)
2. `pnpm run build` (must complete cleanly)
