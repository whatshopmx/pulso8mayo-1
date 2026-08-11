# Todo List: Dashboard UI Remediation

## Phase 1: Core Layout Consolidation ($impeccable layout & distill)
- [x] **Task 1**: Create a unified tabbed metrics switcher client component
  - **Description**: Introduce `DashboardTabbedMetrics` to manage tabs ("Overview", "Compliance", "Inventory", "Labor") and wrap/display metric cards and metrics grid conditionally based on the active tab.
  - **Acceptance criteria**:
    - [x] Tab buttons for Overview, Compliance, Inventory, Labor exist and toggle active state
    - [x] Standard tabs show only the relevant subset of metrics
  - **Verification**: UI verification & `pnpm run build`
  - **Files**: `components/dashboard/dashboard-tabbed-metrics.tsx`, `app/dashboard/page.tsx`

- [x] **Task 2**: Consolidate top-level metric cards to 4 core items at rest
  - **Description**: Show only Flujos Ejecutados, Cumplimiento NOM-251, Stock Bajo, and Incidentes Abiertos as the default overview KPIs.
  - **Acceptance criteria**:
    - [x] Exactly 4 cards visible under the default Overview tab
    - [x] Other 8 cards grouped/loaded only when switching tabs
  - **Verification**: Visual check
  - **Files**: `app/dashboard/page.tsx`, `components/dashboard/dashboard-tabbed-metrics.tsx`

## Phase 2: Contextual Help & Tooltips ($impeccable clarify)
- [x] **Task 3**: Add tooltip / helpText support to MetricCard
  - **Description**: Update `MetricCard` to accept a `helpText` prop, rendering a hoverable info icon. Inject calculation explanation text for NOM-251 and Labor cost metrics.
  - **Acceptance criteria**:
    - [x] Help info icon visible on cards with a defined `helpText` prop
    - [x] Hovering over the icon displays calculations correctly
  - **Verification**: Manual hover test on browser
  - **Files**: `components/ui/metric-card.tsx`, `components/dashboard/compliance-metrics.tsx`, `components/dashboard/kpi-summary-cards.tsx`

## Phase 3: Announcements & Accessibility ($impeccable quieter & adapt)
- [x] **Task 4**: Make pinned announcements collapsible
  - **Description**: Convert the pinned announcements grid at the bottom into a collapsible section with an expand/collapse toggle.
  - **Acceptance criteria**:
    - [x] Grid collapses, reducing mobile height
  - **Verification**: Verify toggle on mobile viewport emulator
  - **Files**: `app/dashboard/page.tsx`

- [x] **Task 5**: Implement keyboard shortcuts
  - **Description**: Listen for `/` key to focus search table input, `Tab` keys to cycle tabs, and key modifiers for resetting selectors.
  - **Acceptance criteria**:
    - [x] Pressing `/` focuses table search
  - **Verification**: Keyboard input verification
  - **Files**: `app/dashboard/page.tsx`
