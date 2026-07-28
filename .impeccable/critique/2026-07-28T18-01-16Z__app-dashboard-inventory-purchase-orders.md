---
target: purchase-orders
total_score: 19
p0_count: 1
p1_count: 2
timestamp: 2026-07-28T18-01-16Z
slug: app-dashboard-inventory-purchase-orders
---
# Impeccable Critique: Purchase Orders & Suggested Orders

Method: ⚠️ DEGRADED: single-context (no sub-agent tool exposed)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Loading spinner only (no skeleton states); no progress on multi-step PO lifecycle |
| 2 | Match System / Real World | 1 | **Raw UUIDs** shown for products, suppliers, and branches on detail page; breadcrumbs show English slugs ("Purchase-orders", "Suggested-orders") in a Spanish-language app |
| 3 | User Control and Freedom | 2 | No undo on PO creation; can cancel but no "back to draft" from "Por Aprobar"; "Ver" → detail but no inline actions |
| 4 | Consistency and Standards | 3 | Component vocabulary is consistent (Badge, Table, Card, PageHeader); status color mapping is consistent across list and detail |
| 5 | Error Prevention | 2 | PO form allows submitting with quantity 0 if unitCost ≥ 0; no confirmation before creating PO; no guard against duplicate supplier rows |
| 6 | Recognition Rather Than Recall | 2 | Status filter only dropdown (no counts per status); no visual indicator of PO lifecycle stage; suggested orders lack context on *why* each item needs reorder |
| 7 | Flexibility and Efficiency | 1 | No keyboard shortcuts; no bulk actions on PO list; no search/filter on PO list (only status); no sort on any column |
| 8 | Aesthetic and Minimalist Design | 3 | Clean, flat, follows design system; minor visual noise from identical "Borrador" badges on every row and monospaced PO numbers competing for attention |
| 9 | Error Recovery | 2 | Toast messages for errors but generic text ("Error al crear orden"); no inline field validation on create dialog; reason dialog preserves input |
| 10 | Help and Documentation | 1 | No contextual help anywhere; suggested orders page has technical terms (PAR, lead time, reorder point) with no explanation; no tooltips |
| **Total** | | **19/40** | **Poor — major UX improvements needed** |

## Anti-Patterns Verdict

**LLM assessment**: These surfaces do not trigger "AI-made-this" at first glance — they follow the established Pulso design system (flat tonal layering, Geist typography, operational red accent) consistently. The visual grammar is product-native, not decorative. However, the **raw UUID exposure** on the detail page is a data-layer failure that would immediately erode user trust in any product category. The table on the list page is functional but monotonous: every row is "Borrador / Condesa / 28 jul 2026" with no visual differentiation, making scanning difficult. The suggested orders page was caught in an eternal loading state during inspection, which indicates either a slow API or a missing loading timeout.

**Deterministic scan**: The bundled `detect.mjs` returned **0 findings** (exit code 0). These are TSX component files, not rendered HTML — the detector found no AI slop patterns in the markup itself.

## Overall Impression

The **list view** is serviceable but bare: a data table with a single status filter. It does the minimum. The **create PO dialog** is well-structured and has smart features (price-check alerts, auto-fill from last cost), but is missing polish (no inline validation, label alignment quirks on the products grid). The **detail page** is broken for real use: product names, supplier names, and branch names all render as raw UUIDs. This is the single biggest issue — it makes the most important page in the workflow completely unreadable. The **suggested orders page** shows a loading spinner that may never resolve, with no timeout or retry mechanism.

## What's Working

1. **Price check alerts in the create dialog**: The inline historical-price comparison with threshold warning (amber alert with percentage) is genuinely useful. It catches cost anomalies before the PO is committed — exactly the kind of operational intelligence this product should surface.

2. **Status badge vocabulary**: The `STATUS_LABELS` mapping is complete (8 states with appropriate color variants), and the same vocabulary is reused between the list and detail pages. The lifecycle from Draft → Pending Approval → Approved → Sent → Closed with appropriate actions at each stage is a solid state machine.

3. **WhatsApp share on detail page**: The "Compartir WhatsApp" button with pre-formatted message including PO details, supplier, total, and link is a real HORECA workflow feature. The emerald styling differentiates it from other actions without violating the design system.

## Priority Issues

### [P0] Raw UUIDs on PO Detail Page — Data Display Failure

**What**: Product names, supplier name, and branch name on the PO detail page (`/purchase-orders/[id]`) all render as raw UUIDs (e.g. `4565f1f4-cbf6-40cc-bdea-59a2693d33ee` instead of "Pechuga de Pollo"). The breadcrumb also shows the UUID.

**Why it matters**: This page is the primary document users share (via WhatsApp, print/PDF). An owner receiving a PO with UUID product names will immediately lose trust in the system. Every user who views a PO detail sees this — it's the core of the purchase workflow.

**Fix**: The `usePurchaseOrder` hook must JOIN item names, supplier name, and branch name in the API response. The breadcrumb should use `po.poNumber` instead of `params.id`.

**Suggested command**: `$impeccable harden purchase-orders/[id]`

---

### [P1] No Search, Sort, or Advanced Filtering on PO List

**What**: The purchase orders list has only a single status dropdown filter. No search by PO number, supplier name, or date range. No column sorting. With 20+ orders on screen (all showing the same branch, date, and status), finding a specific PO requires scrolling and reading each row.

**Why it matters**: The owner overseeing 15 branches with multiple daily POs will hit a wall fast. A list with only status filtering scales to about 20 orders before it becomes unusable.

**Fix**: Add a search input (PO number + supplier name), date range filter, and column sort headers. Consider adding total-value sorting for cost oversight.

**Suggested command**: `$impeccable craft purchase-orders-search`

---

### [P1] Suggested Orders Page — Eternal Loading / No Feedback on Empty

**What**: The suggested orders page showed only a loading spinner during inspection, with no timeout. If the API fails silently or returns empty, the user gets no resolution — just an indefinite spinner.

**Why it matters**: PAR-based reordering is a key automation feature. If users can't trust the page to load, they'll stop using it and revert to manual tracking.

**Fix**: Add a loading timeout (5s) with a retry prompt. If the API returns empty, show the existing `EmptyState` component (which exists in code but may not be reached if the loading state never clears). Add skeleton loading states instead of a centered spinner.

**Suggested command**: `$impeccable harden suggested-orders`

---

### [P2] Create PO Dialog — Missing Inline Validation and UX Gaps

**What**: The create dialog has no inline validation: users can attempt to submit without a supplier and only get a toast. Quantity accepts 0 and negative values. The product search popover uses a raw `<input>` instead of the design system's `<Input>` component. The "×" delete button uses a text character instead of an icon, and the label column on subsequent rows shows empty space rather than being removed entirely.

**Why it matters**: A restaurant manager creating a PO during a busy shift needs clear inline feedback, not toast messages that disappear in 3 seconds.

**Fix**: Add inline error borders/messages on required fields (Proveedor, at least one product with qty > 0). Constrain quantity input to min="1". Replace the text "×" with a Trash icon from lucide-react. Align the label-hide pattern (use a proper spacer or remove the label row entirely after index 0).

**Suggested command**: `$impeccable polish purchase-orders`

---

### [P2] Breadcrumbs Show English Slugs in a Spanish-Language App

**What**: Breadcrumbs render as "Pulso HORECA Demo > Inventario > Purchase-orders" and "Suggested-orders" — mixing English URL slugs into a Spanish interface.

**Why it matters**: Every page has this mismatch in the top navigation. It breaks the "Match System / Real World" heuristic and signals an unfinished localization.

**Fix**: The breadcrumb component should have a label map or use `next-intl` to translate route segments: "Purchase-orders" → "Órdenes de Compra", "Suggested-orders" → "Órdenes Sugeridas".

**Suggested command**: `$impeccable clarify breadcrumbs`

## Persona Red Flags

**Alex (Power User)**: No keyboard shortcuts for any action. No bulk status change on the PO list. Can't sort columns by clicking headers. Can't search by PO number. The create dialog requires mouse-driven popover interaction for every product line — adding 10 items means 10 popover click sequences with no typeahead-enter shortcut. The pagination shows "pág. 1 de N" but no jump-to-page. High friction for someone managing 50+ POs weekly.

**Jordan (First-Timer)**: The suggested orders page uses domain jargon: "PAR", "Lead Time", "Punto Reorden", "Consumo Prom." — none explained inline or via tooltips. The PO detail page shows raw UUIDs instead of product names; a first-time user would think the system is broken. No help link or documentation pointer on any of these pages. The breadcrumb shows English slugs, adding confusion. Would abandon at the detail page.

**Riley (Stress Tester)**: The PO detail shows `formatCurrency(0)` returns "$0.00" even for null values because the guard is `if (!cents)` which treats 0 as falsy — legitimate $0.00 items would show the same as missing data. The create dialog allows selecting the same product multiple times across rows with no deduplication warning. Refreshing mid-creation loses all form state.

## Minor Observations

- **Spinner-only loading** on both pages (a centered `Loader2`). Skeleton loading would better communicate what's about to appear and reduce perceived wait time.
- **Pagination UX**: "Anterior/Siguiente" with no page numbers. With 20+ pages of POs, navigating to page 15 means clicking "Siguiente" 14 times.
- **Suggested orders "Crear PO (0)"** button renders even when disabled — showing a disabled primary button with "(0)" is visual noise. Hide the count when zero or disable with a tooltip explaining why.
- **No print stylesheet on the list page** — only the detail page has `@media print` rules. Users wanting to print a list of all POs get the full sidebar and nav.
- **`shadow-sm` on supplier group cards** in suggested orders violates the "flat by default" design principle from DESIGN.md. The rest of the app uses tonal layering without shadows.
- **Total in emerald green** (`text-emerald-700`) on both the create dialog and detail page — not from the design system color tokens. Should use the semantic color vocabulary or a consistent accent.
- **`formatCurrency` bug**: `if (!cents)` returns "$0.00" for a legitimate 0-cent value. Should be `if (cents === null || cents === undefined)`.

## Questions to Consider

- "What if the PO list had a quick-action column (approve, reject, send) instead of requiring navigation to the detail page for every status change?"
- "What if suggested orders calculated estimated cost per supplier group, so the owner could see the financial impact before creating POs?"
- "What if the PO detail was printable as a proper purchase order document — with company logo, supplier address, and item descriptions — instead of just the raw data card?"
