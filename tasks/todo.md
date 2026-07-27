# Task List: Inventory Dashboard Refinement

## Phase 1: Low-Risk Mechanical Fixes

### Task 1: Replace chart gradients with solid tonal fills

**Description:** Replace `linearGradient` defs in `dashboard-charts.tsx` area charts with solid fill colors at reduced opacity, per the flat-by-default design rule. Gradients violate the design system and don't work in dark mode.

**Acceptance criteria:**
- [ ] Area charts use solid `fill` with `fillOpacity={0.15}` instead of `url(#color-xxx)`
- [ ] `linearGradient` `<defs>` are removed from the component
- [ ] Chart stroke colors remain unchanged (use same OKLCH COLORS array)
- [ ] All chart functionality preserved (tooltip, legend, responsive container)

**Verification:**
- [ ] Build succeeds: `pnpm run build`
- [ ] Manual check: area chart renders with solid fill, tooltips work

**Dependencies:** None

**Files likely touched:**
- `components/inventory/dashboard-charts.tsx`

**Estimated scope:** XS (1 file)

---

### Task 2: Fix barcode-scanner dead code and fragile type assertion

**Description:** Remove the orphan `useCallback` at `barcode-scanner.tsx:134-136` whose return value is discarded. Simplify the fragile triple-nested type assertion for `BarcodeDetector` with a `// @ts-ignore` or a proper guard.

**Acceptance criteria:**
- [ ] Orphan `useCallback(...)` removed (lines 134-136)
- [ ] `BarcodeDetector` type assertion simplified (no `window as unknown as ...`)
- [ ] All scanner functionality preserved (open, scan, close, permissions)

**Verification:**
- [ ] Build succeeds: `pnpm run build`
- [ ] Manual check: scanner component renders, camera permissions work

**Dependencies:** None

**Files likely touched:**
- `components/inventory/barcode-scanner.tsx`

**Estimated scope:** XS (1 file)

---

### Task 3: Replace hardcoded colors with CSS variable tokens

**Description:** Replace all Tailwind utility color classes (e.g., `bg-slate-50`, `text-emerald-700`, `bg-green-100 text-green-800`) with CSS variable tokens (`--muted`, `--success`, `--warning`, etc.) across reports, movements-client, and other pages. Bump `text-[10px]` in `pulso-intelligence.tsx` to `text-xs` (12px) per WCAG 1.4.4.

**Acceptance criteria:**
- [ ] `reports/page.tsx`: all `bg-slate-*`, `text-slate-*`, `bg-emerald-*`, `text-emerald-*`, `text-amber-*`, `bg-amber-*` replaced with CSS variable equivalents
- [ ] `movements-client.tsx:27`: `bg-green-100 text-green-800` replaced with shadcn badge or CSS variable tokens
- [ ] `pulso-intelligence.tsx:122`: `text-[10px]` changed to `text-xs`
- [ ] No Tailwind utility color classes remain in reviewed files

**Verification:**
- [ ] Build succeeds: `pnpm run build`
- [ ] Manual check: pages render with correct colors, no broken styles

**Dependencies:** None

**Files likely touched:**
- `app/dashboard/inventory/reports/page.tsx`
- `components/inventory/movements-client.tsx`
- `components/inventory/pulso-intelligence.tsx`

**Estimated scope:** S (3 files)

---

## Checkpoint: After Tasks 1-3
- [ ] `pnpm run build` succeeds
- [ ] No visual regressions on charts, scanner, or styled pages
- [ ] Review with human before proceeding

---

## Phase 2: Loading & Form Consistency

### Task 4: Replace all Loader2 spinners with skeleton components

**Description:** Replace every `Loader2` loading state in the inventory module with the appropriate skeleton from `components/shared/skeletons.tsx` (`KpiCardsSkeleton`, `DataTableSkeleton`, `ChartSkeleton`, `CardSkeleton`, `PageHeaderSkeleton`). Also replace `Suspense` fallback spinners.

**Acceptance criteria:**
- [ ] `dashboard-kpis.tsx`: loading state uses `KpiCardsSkeleton` instead of 4 Loader2 cards
- [ ] `inventory/page.tsx`: loading state uses `DataTableSkeleton` instead of centered Loader2
- [ ] `stock-alerts.tsx`: loading state uses appropriate skeleton
- [ ] `alerts/page.tsx`: loading state uses `CardSkeleton` or `DataTableSkeleton`
- [ ] `transfer-list.tsx`: loading state uses `DataTableSkeleton`
- [ ] `supplier-list.tsx`: loading state uses `DataTableSkeleton`
- [ ] `movements-client.tsx`: loading state uses appropriate skeleton
- [ ] `receiving/page.tsx`: loading state uses `DataTableSkeleton`
- [ ] `audit/page.tsx`: loading state uses `DataTableSkeleton`
- [ ] `suppliers/page.tsx`: `Suspense` fallback uses `<CardSkeleton />` instead of Loader2
- [ ] No `Loader2` usage remains in the inventory module (except submit button loading states, which are different UX)

**Verification:**
- [ ] Build succeeds: `pnpm run build`
- [ ] Grep for Loader2 in app/dashboard/inventory/ and components/inventory/ — only button submit states remain
- [ ] Manual check: each page shows skeleton loading state on slow network

**Dependencies:** None

**Files likely touched:**
- `components/inventory/dashboard-kpis.tsx`
- `app/dashboard/inventory/page.tsx` (loading section)
- `components/inventory/stock-alerts.tsx`
- `app/dashboard/inventory/alerts/page.tsx`
- `components/inventory/transfer-list.tsx`
- `components/inventory/supplier-list.tsx`
- `components/inventory/movements-client.tsx`
- `app/dashboard/inventory/receiving/page.tsx`
- `app/dashboard/inventory/audit/page.tsx`
- `app/dashboard/inventory/suppliers/page.tsx`

**Estimated scope:** M (10 files, each change is small)

---

### Task 5: Standardize inventory page product form to react-hook-form + zod

**Description:** Replace the raw `useState`-based 16-field product creation dialog in `inventory/page.tsx` with `react-hook-form` + zod using shadcn `Form` components (matching the pattern in `waste-form.tsx`). Keep all existing fields, validation, and behavior.

**Acceptance criteria:**
- [ ] All 16 form fields migrated from `useState` to `react-hook-form` + zod
- [ ] Zod schema validates required fields (name) and types (numbers, strings)
- [ ] Dialog open/close/discard behavior preserved
- [ ] Product photo upload integration preserved
- [ ] Form submits correctly and shows toast on success/error
- [ ] No Loader2 used for submit button loading (keep inline spinner)

**Verification:**
- [ ] Build succeeds: `pnpm run build`
- [ ] Manual check: open dialog, fill fields, create product, verify it appears in table
- [ ] Manual check: discard confirmation works when closing dirty form

**Dependencies:** None (isolated to dialog within page.tsx)

**Files likely touched:**
- `app/dashboard/inventory/page.tsx`

**Estimated scope:** M (1 file, moderate-size refactor)

---

### Task 6: Replace remaining raw HTML elements with shadcn equivalents

**Description:** Replace all remaining raw HTML form controls across the inventory module with their shadcn counterparts. Affected: raw `<select>` in stock-count page and receiving-form, raw `<textarea>` in receiving-workflow, raw `<table>` in reports page. Replace `window.confirm()` in receiving-workflow with a shadcn `Dialog`.

**Acceptance criteria:**
- [ ] `stock-count/page.tsx`: raw `<select>` replaced with shadcn `Select`
- [ ] `receiving-form.tsx`: raw `<select>` replaced with shadcn `Select`
- [ ] `receiving-workflow.tsx`: raw `<textarea>` replaced with shadcn `Textarea`
- [ ] `receiving-workflow.tsx`: `window.confirm()` replaced with shadcn `AlertDialog`
- [ ] `reports/page.tsx`: raw `<table>` replaced with shadcn `Table` component
- [ ] No raw `<select>`, `<textarea>`, or `window.confirm()` remains in inventory module
- [ ] All focus rings, disabled states, and keyboard accessibility preserved

**Verification:**
- [ ] Build succeeds: `pnpm run build`
- [ ] Manual check: stock-count form works, receiving workflow works, reports table renders
- [ ] Manual check: keyboard navigation works on replaced controls

**Dependencies:** None

**Files likely touched:**
- `app/dashboard/inventory/stock-count/page.tsx`
- `components/inventory/receiving-form.tsx`
- `components/inventory/receiving-workflow.tsx`
- `app/dashboard/inventory/reports/page.tsx`

**Estimated scope:** M (4 files)

---

### Task 7: Add error handling in createStockCount and remove shadow-sm

**Description:** Fix the `createStockCount` server action in `stock-count/page.tsx` to provide user-facing error feedback instead of silently logging to console. Remove `shadow-sm` from the raw `<select>` element (which will be replaced in Task 6, but ensure the replacement has no shadow either).

**Acceptance criteria:**
- [ ] `createStockCount` shows error toast or form-level feedback on failure
- [ ] `error: any` catch clause replaced with proper typed error handling
- [ ] No `shadow-sm` class exists on any element in stock-count/page.tsx
- [ ] Stock count creation flow still works (redirect to workflow execution)

**Verification:**
- [ ] Build succeeds: `pnpm run build`
- [ ] Manual check: trigger stock count creation with invalid data, see error feedback
- [ ] Grep for `shadow-sm` in stock-count/page.tsx — returns no matches

**Dependencies:** Task 6 (shadcn Select replacement removes the raw select that had shadow-sm)

**Files likely touched:**
- `app/dashboard/inventory/stock-count/page.tsx`

**Estimated scope:** S (1 file)

---

## Checkpoint: After Tasks 4-7
- [ ] All loading states use skeletons, no Loader2 remains in inventory module (except submit buttons)
- [ ] All forms use consistent pattern (RHF+zod or server actions + shadcn controls)
- [ ] No raw HTML elements remain in inventory module
- [ ] `pnpm run build` succeeds
- [ ] Review with human before proceeding to Phase 3

---

## Phase 3: Information Architecture & Polish

### Task 8: Distill main inventory dashboard

**Description:** Reduce cognitive load on the main inventory page. Show 4-6 most-used operation cards prominently, move the rest under "Más operaciones" (which currently only hides 2 cards). Surface critical alerts (low stock, expiring items) more prominently — consider merging QuickAlerts into a single prominent alert bar above the fold. Remove decorative hover scale transforms that cause layout on `transition-all`.

**Acceptance criteria:**
- [ ] Top row shows only 4-6 primary operation cards (Recepción, Auditorías/Conteo, Órdenes de Compra, Transferencias, Mermas)
- [ ] Remaining operations moved under "Más operaciones" expandable section
- [ ] Critical alerts (low stock + expiring) merged into a single prominent alert bar or moved above the product table
- [ ] Hover scale transforms removed from operation cards (or use `transform` without `transition-all` and respect `prefers-reduced-motion`)
- [ ] Empty state and product table functionality preserved
- [ ] All existing page navigation still works

**Verification:**
- [ ] Build succeeds: `pnpm run build`
- [ ] Manual check: dashboard displays 4-6 primary cards, rest under "Más operaciones"
- [ ] Manual check: all links on operation cards navigate correctly
- [ ] Manual check: alert section shows critical items prominently

**Dependencies:** Task 4 (skeletons for loading state), Task 5 (form standardization — same file)

**Files likely touched:**
- `app/dashboard/inventory/page.tsx`

**Estimated scope:** M (1 file, significant layout changes)

---

### Task 9: Final quality pass

**Description:** Run lint, build, and manual verification across the entire inventory module. Confirm no regression in any of the 14 sub-pages. Verify that all critique findings are addressed.

**Acceptance criteria:**
- [ ] `pnpm run lint` passes with no new errors
- [ ] `pnpm run build` succeeds
- [ ] All 14 inventory sub-pages load without errors
- [ ] Product creation, stock count, waste reporting, receiving, and transfers flows work
- [ ] All critique findings from the audit are addressed

**Verification:**
- [ ] Lint: `pnpm run lint`
- [ ] Build: `pnpm run build`
- [ ] Manual walkthrough of all inventory pages

**Dependencies:** Tasks 1-8

**Files likely touched:** None (inspection only)

**Estimated scope:** S (verification only)

---

## Checkpoint: Complete
- [ ] All 9 tasks complete
- [ ] `pnpm run build` succeeds
- [ ] `pnpm run lint` passes
- [ ] Critique score improves from 21/40
- [ ] Ready for human review
