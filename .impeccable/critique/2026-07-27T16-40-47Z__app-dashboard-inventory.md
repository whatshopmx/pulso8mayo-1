---
target: app/dashboard/inventory
total_score: 21
p0_count: 2
p1_count: 2
timestamp: 2026-07-27T16-40-47Z
slug: app-dashboard-inventory
---
## Design Health Score

### Heuristic Scores

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Loading uses spinners, not skeletons (despite skeleton components existing). 3-step receiving wizard is a bright spot. |
| 2 | Match System / Real World | 3 | Spanish labels are consistent and industry-appropriate. Some jargon ("FIFO", "deconsolidación") lacks inline explanation. |
| 3 | User Control and Freedom | 2 | No breadcrumb visible on sub-pages. `window.confirm()` in receiving-workflow blocks keyboard/screen-reader users. Modal-heavy flows prevent context switching. |
| 4 | Consistency and Standards | 1 | Four competing form patterns in the same submodule (raw `useState`, `react-hook-form`+zod, server actions, raw HTML `<select>`). Suppliers page skips PageContainer. Raw `<table>` mixed with shadcn Table. |
| 5 | Error Prevention | 3 | Price anomaly detection in purchase orders is excellent. Wizard step validation works well. No undo for stock operations. |
| 6 | Recognition Rather Than Recall | 2 | 8 equally-weighted navigation cards on dashboard force recall. Tab labels on product list help. Tab bar nav is good. |
| 7 | Flexibility and Efficiency | 2 | Barcode scanning is excellent. Batch CSV import is valuable. No bulk edit, no keyboard shortcuts. |
| 8 | Aesthetic and Minimalist Design | 2 | Clean base components. Gradient fills in area charts violate the flat-by-default rule. Hover scale transforms on hub cards are decorative, not functional. Main dashboard is cluttered. |
| 9 | Error Recovery | 3 | Toast feedback on all mutations. Audit log provides trail. No inline recovery for failed stock operations. |
| 10 | Help and Documentation | 1 | No contextual help, tooltips, onboarding flows, or help links anywhere. "Conteo Ciego" card is the only example of contextual explanation done right. |
| **Total** | | **21/40** | **Acceptable** |

## Anti-Patterns Verdict

**Moderate AI tells — not wholesale generation.** The consistent shared component vocabulary (PageContainer, PageHeader, EmptyState, BreadcrumbDynamic) suggests human architectural intent. But several tells are present:

- **Four form patterns** in one submodule is the strongest tell. No experienced developer would mix raw `useState`, `react-hook-form`+zod, server actions, and raw `<select>` across pages that share the same data model.
- **Spinners despite skeletons existing** — `KpiCardsSkeleton`, `DataTableSkeleton`, `ChartSkeleton`, `CardSkeleton`, `PageHeaderSkeleton` are all defined in `components/shared/skeletons.tsx` but zero pages use them. Every loading state uses a generic `Loader2`. This pattern is characteristic of independently-generated pages.
- **`BarcodeScanner.tsx`** contains classic LLM artifacts: `new (window as unknown as { BarcodeDetector: ... })` (triple-nested type cast) and orphan `useCallback` with discarded return value.

**Deterministic scan**: 8 findings (1 genuine, 7 false positives). The genuine finding is a 10px font in `pulso-intelligence.tsx:122` — below the 12px WCAG minimum and off the DESIGN.md type ramp. The 7 color findings in `menu-engineering-matrix.tsx` are intentional data-viz colors, not UI drift.

**The detector caught what the human review missed**: the 10px font issue. The human review caught what the detector can't: form inconsistency, loading pattern mismatch, cognitive load, and architectural fragmentation.

## Overall Impression

The inventory module has strong bones — the shared component layer, operational features (barcode scanning, blind stock counting, 3-way invoice matching), and a consistent visual base. But it feels like 15 pages written by 5 different people at different times. The core tension: architectural intent exists (skeletons, shared components, design tokens) but the actual implementation doesn't follow it. The module works, but it doesn't feel like one product.

The single biggest opportunity: **form standardization and skeleton adoption**. Fixing those two P0 issues would immediately make the module feel cohesive.

## What's Working

1. **Shared component vocabulary is well-designed.** `PageHeader`, `PageContainer`, `EmptyState`, `KpiCard`/`KpiGrid`, `BreadcrumbDynamic` — these components, when used, create consistent, professional-looking pages. The suppliers and transfers pages (both use these consistently) look noticeably better than alerts and movements pages (which don't).

2. **Domain-specific operational features are excellent.** The 3-step receiving workflow with barcode scan, OCR, temperature checks, PO discrepancy alerts is genuinely industry-grade. Blind stock counting, FIFO lot tracking, 3-way price conciliation, and suggested ordering show deep HORECA domain understanding.

3. **Good error feedback patterns across the module.** Toast notifications on mutations, snackbar-style feedback, confirmation dialogs on destructive actions (discard form, delete supplier), and the audit log provide a solid error recovery foundation.

## Priority Issues

### [P0] Spinner everywhere, skeletons nowhere
**What**: Every loading state uses a generic `Loader2` spinner despite `DataTableSkeleton`, `KpiCardsSkeleton`, `ChartSkeleton`, `CardSkeleton`, and `PageHeaderSkeleton` being fully defined in `components/shared/skeletons.tsx`. Affected: `dashboard-kpis.tsx:28`, `inventory/page.tsx:359`, `stock-alerts.tsx:117`, `alerts/page.tsx:189`, `transfer-list.tsx:466`, `supplier-list.tsx:164`, `movements-client.tsx:163`, `receiving/page.tsx:97`, `audit/page.tsx:168`, and the `Suspense fallback` in `suppliers/page.tsx:12`.
**Why**: Product register demands skeleton states. Spinners in the middle of content are the #1 tell of an unfinished product UI.
**Fix**: Replace every `Loader2` loading state with the appropriate skeleton from `components/shared/skeletons.tsx`. For Suspense boundaries, use `<CardSkeleton />` as fallback.
**Suggested command**: `/impeccable polish`

### [P0] Four competing form patterns
**What**: The module uses raw `useState` (inventory page, receiving-form, stock-manager), `react-hook-form`+zod (waste-form), server actions+useFormStatus (product-form), and raw HTML `<select>`/`<textarea>` elements (stock-count page, reports page, receiving-workflow).
**Why**: Inconsistency undermines user trust. A user who learns one pattern can't apply it elsewhere. Developer velocity suffers from context-switching between approaches.
**Fix**: Standardize on one pattern — recommend `react-hook-form`+zod (most flexible for complex inventory forms with conditional fields) or server actions (best for simple create/edit flows). Migrate all forms to the chosen approach.
**Suggested command**: `/impeccable harden`

### [P1] Raw HTML elements mixed with shadcn UI
**What**: Raw `<select>` in `stock-count/page.tsx:115-125` and `receiving-form.tsx:147-159`, raw `<table>` in `reports/page.tsx:431`, `window.confirm()` in `receiving-workflow.tsx:62`, raw `<textarea>` in `receiving-workflow.tsx:656` instead of the shadcn `Textarea` component.
**Why**: Raw HTML elements break the design system — they have no focus rings, no error states, no disabled styling, and no keyboard accessibility improvements provided by shadcn wrappers. `window.confirm()` is not keyboard-navigable, not screen-reader-friendly, and blocks the JS event loop.
**Fix**: Replace all raw HTML form controls with their shadcn equivalents. Replace `window.confirm()` with a shadcn `Dialog`.
**Suggested command**: `/impeccable audit`

### [P1] Hardcoded color tokens across several pages
**What**: `reports/page.tsx` uses `bg-slate-50`, `text-slate-700`, `bg-emerald-50`, `text-emerald-700`, `text-amber-600`, `bg-amber-50` — Tailwind utility colors, not CSS variable tokens from the design system. `movements-client.tsx:27` hardcodes `bg-green-100 text-green-800` for badge variants. `pulso-intelligence.tsx:122` uses `text-[10px]` — below DESIGN.md type ramp and below 12px WCAG minimum.
**Why**: Hardcoded colors break theme switching (if dark mode is ever enabled). They make systematic color updates impossible without finding every instance. The 10px font is an accessibility violation per WCAG 1.4.4 (resize text).
**Fix**: Replace all Tailwind utility colors with `bg-{semantic}/text-{semantic}-foreground` or `text-muted-foreground`. Bump 10px to `text-xs` (12px).
**Suggested command**: `/impeccable colorize`

### [P2] Main inventory dashboard cognitive overload
**What**: The inventory homepage shows 8 operation hub cards + 4 KPI cards + 2 charts + 2 alert lists + a tabbed product table with 4 filter tabs + a search bar — all above the fold on a 1920px screen.
**Why**: The "command center" intent becomes a hallway of doors. An owner scanning 15 branches will look at this and not know what demands their attention first.
**Fix**: Show 4-6 most-used operations, move the rest under "Más operaciones" (which already exists but only hides 2 cards). Surface the most critical alert type prominently. Consider a configurable or role-based dashboard.
**Suggested command**: `/impeccable distill`

### [P2] Decorative gradient fills in charts
**What**: `dashboard-charts.tsx:118-123` uses `linearGradient` defs with `stopOpacity={0.3}` fading to `stopOpacity={0}` for area chart fills. DESIGN.md explicitly bans gradient text and flat-by-default.
**Why**: The design system says the interface is "flat with tonal layering (no shadows)." Gradient fills contradict this principle. They also don't work in dark mode.
**Fix**: Replace `linearGradient` with solid fill using `fillOpacity={0.15}` at a single color. Keep the stroke at full opacity.
**Suggested command**: `/impeccable quieter`

### [P3] Dead code and fragile patterns in barcode-scanner
**What**: `BarcodeScanner.tsx:134-136` has an orphan `useCallback(..., [checkPermissions])` whose return value is discarded. Line 82-84 uses a needlessly complex type assertion `(window as unknown as { BarcodeDetector: ... })`.
**Why**: Dead code signals incomplete implementation. The type assertion is fragile and will fail in browsers that don't support the BarcodeDetector API.
**Fix**: Remove the orphan `useCallback`. Replace the type assertion with a feature detection guard.
**Suggested command**: `/impeccable polish`

### [P3] Stock-count page UX drift
**What**: `stock-count/page.tsx:115-125` uses a raw `<select>` with `className="shadow-sm"` — introducing a shadow that DESIGN.md explicitly bans. The `createStockCount` server action catches errors with `error: any` and logs to console, giving the user no feedback on failure.
**Why**: Shadow on a raw element contradicts the design system. Silent failure on stock count creation leaves users in the dark.
**Fix**: Replace raw `<select>` with shadcn `Select`. Remove `shadow-sm`. Add proper error handling in `createStockCount` with toast or form-level feedback.
**Suggested command**: `/impeccable harden`

## Persona Red Flags

### Alex (Power User)
- Will immediately notice the spinner-vs-skeleton inconsistency and the form pattern fragmentation. Will ask: "Why can't I bulk-edit stock levels?"
- Will be frustrated that `window.confirm()` blocks the JS event loop — no keyboard dismiss, no "don't show again" option.
- Will want configurable dashboard layout to hide operation cards they never use.
- No keyboard shortcuts for any primary action (new product, new receiving, new transfer). Will time-to-complete a "create product" flow — the 16-field modal dialog with no autofill or defaults will feel slow.
- Barcode scanning is a genuine power-user win, but the inconsistent scanner integration (some pages use `BarcodeScanner`, some don't) will confuse.

### Sam (Accessibility User)
- Raw `<select>` elements lack proper ARIA attributes and are not focusable with visible focus indicators.
- `window.confirm()` is not focus-trapped, not keyboard-dismissable (Esc does close it, but NVDA/JAWS don't announce the dialog).
- `hover:scale-[1.02]` transforms on hub cards (`inventory/page.tsx:164,176,188`) use `transition-all` which triggers layout — may cause vestibular discomfort and don't respect `prefers-reduced-motion`.
- Color-only indicators for stock levels (amber text, red text) fail WCAG 1.4.1 at small font sizes. Add an icon or shape indicator.
- The `tabular-nums` usage on movement quantities is good — a rare accessible practice in this module.
- The alerts page "Update Status" dialog on line 278-305 has a `Textarea` for notes with no associated `<label>` or `aria-label`.

### Owner (Owner/Operator, project-specific)
- Will appreciate that the system covers real HORECA workflows (receiving, transfers, 3-way match, blind stock counts).
- Will be confused by the main dashboard: 8 equally-weighted operation cards with no priority signal. Will ask: "What should I pay attention to first?"
- Will find "Más operaciones" hidden behind a `<details>` element unintuitive — looks like collapsed metadata, not a navigation pattern.
- Will expect the most costly problems (critical stock-out, expired products with high value) to surface aggressively, not as one alert card among two.
- The "3-way match" KPI showing 0% with no actionable next step will cause confusion: "How do I improve this?"
- Will not understand "FIFO" or "deconsolidación" without inline explanation.

## Minor Observations

1. `inventory/page.tsx:662` — Dialog open/close handler calls `setDialogOpen` in `onOpenChange` *and* in `confirmDiscardOpen` flow. Fragile — a component re-render could fire both.
2. `stock-manager.tsx:203` — Comment says "Placeholder for movement history — needs to be passed in or fetched" left in production code.
3. `movements-client.tsx:123-133` — Custom `<button>` elements for filter pills instead of `Button` component. Breaks component vocabulary.
4. `barcode-scanner.tsx:82-84` — The `BarcodeDetector` type assertion would be cleaner with `// @ts-ignore`.
5. `reports/page.tsx:244-253` — `r.varianceQty` destructured twice (filter + sort) when a single pass could do both.
6. `<details>` for "Más operaciones" — at screen sizes under `lg`, `grid-cols-2` shows 2 cards; the collapsed area is very small for meaningful navigation.
7. `waste-form.tsx:84` — `totalLoss = quantity * costPerUnit` recalculates on every render. Fine for a form, but if extracted, ensure cents conversion.

## Questions to Consider

1. **Form approach**: Should the team standardize on `react-hook-form`+zod (currently only waste-form) or server actions+useFormStatus (product-form)? The answer determines the P0 refactoring scope.
2. **Skeleton intent**: Given skeleton components exist but are never used, was this a conscious decision (spinners felt faster) or oversight? If intentional, remove skeleton components.
3. **Dashboard personalization**: Should the main dashboard be redesigned around role-based defaults (receiving clerk sees receiving first, manager sees alerts first) rather than the current one-size-fits-all grid of 8 cards?
4. **Design system compliance tooling**: Several drift issues (hardcoded colors, raw HTML elements, shadows) could be caught by a lint rule — is adding one worth the effort for a team of this size?

## Trend for `app-dashboard-inventory` (last 5 runs): First run for this target, no trend yet.
