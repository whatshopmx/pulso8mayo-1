# Implementation Plan: Inventory Movements Refactor

## Overview
Based on the Impeccable Critique for the Inventory Movements page (`app/dashboard/inventory/movements`), this plan addresses visual bureaucracy (nested cards/shadows) and lack of brand specificity. It will refactor the UI to align with Pulso's "flat by default" command center design and improve accessibility.

## Architecture Decisions
- **Distill Layout**: Remove redundant `Card` wrappers around filters and the data table.
- **Tonal Layering**: Rely on background colors (`--sidebar`, `--background`) and borders (`--border`) instead of shadows for depth.
- **Accessibility Improvements**: Implement `aria-pressed` states on the custom toggle badges and introduce keyboard shortcuts for power users.
- **Responsive Adaptations**: Ensure the table and filters remain usable on mobile devices, potentially stacking filters or hiding less critical columns.

## Task List

### Phase 1: Layout Distillation
- [x] Task 1: Remove Card wrappers around the filter bar and the main table. Replace with unified container or standard page background integration.

### Phase 2: Brand Alignment & Token Application
- [x] Task 2: Apply Pulso-specific tonal tokens (`--sidebar`, `--border`) to the filter bar. Ensure shadows are completely removed (`shadow-none`) per the "flat by default" rule.

### Phase 3: Accessibility & UX Harden
- [x] Task 3: Add `aria-pressed` states to the type toggle badges (`Entrada`, `Salida`, etc.).
- [x] Task 4: Add keyboard shortcut support (e.g., `Esc` to clear filters).

### Phase 4: Polish
- [ ] Task 5: Final responsive checks and visual alignment. Run `impeccable polish`.

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| Layout shift on mobile | Medium | Test specifically on <768px viewports after removing Card padding. |
| Contrast issues | Low | Verify new background colors against text using standard contrast tools. |

## Open Questions
- Should we integrate the filters into the `PageHeader` component to save vertical space, or keep them as a distinct horizontal bar below it?
