# Implementation Plan: Inventory Dashboard Refinement

## Overview

Address the 6 critique findings from the design audit (`app/dashboard/inventory` — score 21/40) across 9 tasks in 3 phases. The work covers replacing spinners with skeletons, standardizing form patterns, fixing hardcoded colors, removing gradient chart fills, fixing dead code in barcode-scanner, and distilling the cluttered main dashboard into a focused command center.

## Architecture Decisions

- **Form pattern**: Standardize on `react-hook-form` + zod (currently used only by `waste-form.tsx`). Server actions remain for simple create/edit pages that don't need complex validation, but all new/modified forms use RHF+zod.
- **Skeletons**: Use existing `KpiCardsSkeleton`, `DataTableSkeleton`, `ChartSkeleton`, `CardSkeleton`, `PageHeaderSkeleton` from `components/shared/skeletons.tsx`
- **Colors**: Use CSS variable tokens (`--primary`, `--muted-foreground`, etc.) defined in `globals.css` and DESIGN.md. No Tailwind utility colors (e.g., `bg-slate-50`, `text-emerald-700`).
- **Charts**: Solid tonal fills with `fillOpacity` instead of `linearGradient` defs, per flat-by-default design rule.
- **No shadcn `Form` wrapper on server components**: Server action pages (stock-count) that don't need complex validation stay with server actions but use shadcn form controls (Select, Textarea).

## Task List

### Phase 1: Low-Risk Mechanical Fixes

- [ ] Task 1: Replace chart gradients with solid tonal fills
- [ ] Task 2: Fix barcode-scanner dead code and fragile type assertion
- [ ] Task 3: Replace hardcoded colors with CSS variable tokens

### Checkpoint: After Tasks 1-3
- [ ] `pnpm run build` succeeds
- [ ] No visual regressions on charts or pages
- [ ] Review with human

### Phase 2: Loading & Form Consistency

- [ ] Task 4: Replace all Loader2 spinners with skeleton components (10 files)
- [ ] Task 5: Standardize inventory page product form to react-hook-form + zod
- [ ] Task 6: Replace remaining raw HTML elements with shadcn equivalents
- [ ] Task 7: Add error handling in createStockCount and remove shadow-sm

### Checkpoint: After Tasks 4-7
- [ ] All loading states use skeletons, no Loader2 remains in inventory module
- [ ] All forms use consistent pattern (RHF+zod or server actions + shadcn controls)
- [ ] `pnpm run build` succeeds

### Phase 3: Information Architecture & Polish

- [ ] Task 8: Distill main inventory dashboard (reduce cognitive load)
- [ ] Task 9: Final quality pass (lint, build, manual verification)

### Checkpoint: Complete
- [ ] All acceptance criteria met across all 9 tasks
- [ ] Critique score improves from 21/40
- [ ] `pnpm run build` succeeds with no errors
- [ ] Ready for human review

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Task 5 form refactor (inventory page dialog) breaks product creation | High | Work in isolation on the dialog; test create flow after |
| Task 6 replacing window.confirm() changes UX behavior | Med | Keep same dialog text and button labels; test keyboard nav |
| Task 8 dashboard distill removes cards users rely on | Med | Move to "Más operaciones" section, don't delete; make reversible |
| Skeleton replacements miss a loading state | Low | Search for all Loader2 instances in inventory module before starting |
| Color replacement misses a hardcoded instance | Low | Grep for Tailwind color classes in inventory directory |

## Open Questions

- Should the dashboard distill include role-based visibility (receiving clerk sees different cards than manager)? — Deferred, beyond current scope.
- The critique mentions 4 form patterns but `react-hook-form` + zod is only used in waste-form; should we also migrate the server-action-based product-form? — No, server actions are fine for simple create/edit.
