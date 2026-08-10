# Todo List: Schedule Builder UI Remediation

## Phase 1: Header Toolbar & Action Hierarchy ($impeccable layout)
- [ ] **Task 1**: Refactor `UnifiedShiftScheduler` toolbar layout into visual clusters
  - **Description**: Group view mode buttons into a segmented control, primary actions (`Guardar`, `Publicar`) into prominent buttons, and secondary utilities (`Plantilla`, `Copiar`, `Exportar`, `Configuración`, `Asignación Masiva`) into a dropdown menu.
  - **Acceptance criteria**:
    - [ ] View switchers use a cohesive segmented control UI
    - [ ] `Publicar` button uses Operational Red primary button styling
    - [ ] Utility actions consolidated into an overflow dropdown menu
    - [ ] Filter bar sits cleanly below action bar
  - **Verification**: Visual check & `pnpm run build`
  - **Files**: `components/labor/unified-shift-scheduler.tsx`

## Phase 2: Design Token & Label Floor Standardization ($impeccable extract & typeset)
- [ ] **Task 2**: Upgrade all off-ramp font sizes to 12px Label Floor
  - **Description**: Replace all 10px and 9px font size utility classes (`text-[10px]`, `text-[9px]`) with `text-xs`.
  - **Acceptance criteria**:
    - [ ] Zero instances of `text-[10px]` or `text-[9px]` in `components/labor/`
  - **Verification**: `node .agents/skills/impeccable/scripts/detect.mjs --json components/labor`
  - **Files**: `components/labor/schedule-calendar.tsx`, `components/labor/shift-assignment-bulk.tsx`, `components/labor/shift-assignment.tsx`, `components/labor/shift-scheduler.tsx`, `components/labor/shifts/ShiftCell.tsx`, `components/labor/weekly-shift-planner.tsx`, `components/labor/labor-quick-action-drawer.tsx`

- [ ] **Task 3**: Standardize shift color badges with design tokens
  - **Description**: Replace hardcoded `bg-blue-500`, `bg-orange-500`, `bg-purple-500` classes with semantic badge variants and token background classes.
  - **Acceptance criteria**:
    - [ ] Shift badges adapt seamlessly to light and dark modes using theme tokens
  - **Verification**: `pnpm run build`
  - **Files**: `components/labor/unified-shift-scheduler.tsx`, `components/labor/shifts/ShiftCell.tsx`, `components/labor/shift-assignment-bulk.tsx`

## Phase 3: AI Slop Removal & Flat Surface Styling ($impeccable distill)
- [ ] **Task 4**: Remove `border-l-4` side-tab accent borders
  - **Description**: Eliminate `border-l-4` and `border-l-2` colored left borders from cards across labor components. Use flat 1px borders with subtle surface background fills.
  - **Acceptance criteria**:
    - [ ] Zero instances of `border-l-4` or `border-l-2` in `components/labor/`
  - **Verification**: `node .agents/skills/impeccable/scripts/detect.mjs --json components/labor`
  - **Files**: `components/labor/lft-conflict-validator.tsx`, `components/labor/shift-assignment-bulk.tsx`, `components/labor/shift-assignment.tsx`, `components/labor/shift-scheduler.tsx`

## Phase 4: Grid Accessibility & Polish ($impeccable harden & polish)
- [ ] **Task 5**: Add ARIA grid semantics and touch target polish to Matrix View
  - **Description**: Add `role="grid"`, `role="row"`, `role="gridcell"` to matrix layout divs. Expand hover action buttons for mobile touch safety.
  - **Acceptance criteria**:
    - [ ] ARIA grid roles added to matrix header, rows, and cells
    - [ ] Hover delete button has at least 24px touch target padding
  - **Verification**: `pnpm run build`
  - **Files**: `components/labor/unified-shift-scheduler.tsx`, `components/labor/shifts/ShiftCell.tsx`
