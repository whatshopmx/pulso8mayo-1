# Todo List: Inventory Movements Refactor

Plan: `tasks/plan.md`

## Fase 1: Layout Distillation

- [x] **Task 1: Remove Card wrappers**
  - **Description:** Remove the `<Card>` and `<CardContent>` wrapping the filters and the table in `movements-client.tsx`.
  - **Acceptance criteria:**
    - [x] Filters and table sit directly on the page background or in a unified `div`.
    - [x] No `box-shadow` is applied to these containers.
  - **Verification:**
    - [x] Visual inspection and `npm run dev` builds clean.
  - **Dependencies:** None
  - **Files:** `app/dashboard/inventory/movements/movements-client.tsx`
  - **Scope:** XS

## Fase 2: Brand Alignment

- [x] **Task 2: Apply tonal tokens and flat-by-default styles**
  - **Description:** Style the filter container using `--sidebar` or `--muted` background, and 1px `--border`. 
  - **Acceptance criteria:**
    - [x] The filter bar has a distinct but flat background.
    - [x] The design feels more like a command center than a generic template.
  - **Verification:**
    - [x] Impeccable review passes for specific brand tokens.
  - **Dependencies:** Task 1
  - **Files:** `app/dashboard/inventory/movements/movements-client.tsx`
  - **Scope:** XS

## Fase 3: Accessibility & UX Harden

- [x] **Task 3: Add `aria-pressed` to badges**
  - **Description:** Ensure the type filter badges function as proper toggle buttons for screen readers.
  - **Acceptance criteria:**
    - [x] Badge buttons have `aria-pressed={active}`.
    - [x] They have visible focus states.
  - **Verification:**
    - [x] Screen reader simulation or markup review.
  - **Dependencies:** None
  - **Files:** `app/dashboard/inventory/movements/movements-client.tsx`
  - **Scope:** XS

- [x] **Task 4: Implement keyboard shortcuts**
  - **Description:** Allow clearing filters via the `Escape` key.
  - **Acceptance criteria:**
    - [x] Pressing `Esc` clears all selected types and date inputs.
  - **Verification:**
    - [x] Manual test in browser.
  - **Dependencies:** None
  - **Files:** `app/dashboard/inventory/movements/movements-client.tsx`
  - **Scope:** S

## Fase 4: Polish

- [x] **Task 5: Final review and responsive polish**
  - **Description:** Run `$impeccable polish` to catch any remaining padding or alignment issues, especially on mobile.
  - **Acceptance criteria:**
    - [x] Responsive layout does not overflow horizontally.
    - [x] Padding is consistent.
  - **Verification:**
    - [x] Mobile viewport test.
  - **Dependencies:** Tasks 1-4
  - **Files:** `app/dashboard/inventory/movements/movements-client.tsx`
  - **Scope:** S
