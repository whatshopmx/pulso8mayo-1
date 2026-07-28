---
target: app/dashboard/inventory/purchase-orders and suggested-orders
total_score: 25
p0_count: 0
p1_count: 2
timestamp: 2026-07-28T03-08-30Z
slug: shboard-inventory-purchase-orders-suggested-orders
---
# Design Critique: Inventory Purchase Orders & Suggested Orders

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | No running subtotal/total calculations in the PO creation dialog. |
| 2 | Match System / Real World | 3 | Suggested orders table misses the supplier identity at the item level. |
| 3 | User Control and Freedom | 2 | No search or filtering on products list, no bulk-selection filters. |
| 4 | Consistency and Standards | 3 | Consistent with shadcn styles, but table structures and page metrics differ slightly. |
| 5 | Error Prevention | 3 | Historical cost warnings are helpful, but duplicate product entries are allowed in POs. |
| 6 | Recognition Rather Than Recall | 2 | Manual unit cost entry requires the user to recall or look up supplier price lists. |
| 7 | Flexibility and Efficiency | 1 | Standard Radix Select dropdown is extremely inefficient for scrolling large inventories. |
| 8 | Aesthetic and Minimalist Design | 3 | Clean and flat look, but PO item lines get cluttered on narrow screens. |
| 9 | Error Recovery | 3 | Good Sonner toasts and recovery states on validation errors. |
| 10 | Help and Documentation | 2 | Missing tooltips or help icons for PAR metrics and price alert thresholds. |
| **Total** | | **25/40** | **Acceptable** |

## Anti-Patterns Verdict

### LLM Assessment
- **AI Scaffolding Tells**: The `CreatePODialog` uses a generic inline list mapping over standard input groups. While styling is clean and compliant with the flat-by-default rules in `DESIGN.md`, the lack of search filters in select dropdowns and the missing running calculations are classic tells of AI-generated boilerplate code that works with mock data but breaks down in real enterprise operations.
- **Visual Contrast & Colors**: Good usage of red for destructive states and amber for price warnings. Standard Off-White backgrounds are applied correctly.

### Deterministic Scan
No design anti-patterns were flagged by the automated detector (`detect.mjs`) on `app/dashboard/inventory/purchase-orders` or `app/dashboard/inventory/suggested-orders`.

### Visual Overlays
No browser overlays were injected since this was an static code analysis run.

## Overall Impression
The purchase orders and suggested orders interfaces are clean, structured, and visually consistent with the rest of the application. However, they suffer from significant usability bottlenecks when scaled to real HORECA operations (dense product lists, supplier-based grouping, and manual data entry). Solving the dropdown search, adding supplier transparency, and pre-filling historic costs will turn this from a basic form into a robust utility.

## What's Working
- **Price Safeguards**: The price alert mechanism in `CreatePODialog` using `usePriceCheck` is a great operational guardrail.
- **Workflow State Management**: The detail page shows clear disabled actions based on status flows (Draft -> Pending Approval -> Approved -> Sent).
- **Clean Table Layout**: Standardized tables without vertical borders fit the visual identity perfectly.

## Priority Issues

### [P1] Missing Product Search/Combobox in PO Builder
- **Why it matters**: Selecting items from a standard Radix `<Select>` without autocomplete/search is extremely frustrating when the list grows beyond 20 items.
- **Fix**: Replace the product `<Select>` dropdown in `CreatePODialog` with a searchable `<Combobox>` or searchable Popover.
- **Suggested command**: `$impeccable polish`

### [P1] Missing Supplier Visibility and Filter in Suggested Orders
- **Why it matters**: Suggested orders generate POs per supplier. If the UI doesn't show the supplier name next to each suggested item, and doesn't allow filtering items by supplier, the manager cannot verify which supplier will receive the order.
- **Fix**: Add a "Proveedor" column to the table. Implement a filter/search bar at the top of the suggested orders page to filter items by supplier.
- **Suggested command**: `$impeccable layout`

### [P2] No Pre-filled Unit Cost in PO Builder
- **Why it matters**: Forcing the user to manually enter the unit cost for each item is a massive friction point and error vector.
- **Fix**: When a product is selected in `CreatePODialog`, pre-fill the cost input with the historical average or the last supplier price.
- **Suggested command**: `$impeccable polish`

### [P2] Lack of Running Grand Total in PO Builder
- **Why it matters**: Managers need to track the budget impact of a purchase order *before* submitting it. Not showing a running total (subtotal, tax, grand total) inside the dialog forces users to guess or calculate manually.
- **Fix**: Calculate and display a running Subtotal, IVA (16%), and Total at the bottom of the `CreatePODialog` based on the input quantities and unit costs.
- **Suggested command**: `$impeccable layout`

### [P2] Missing Direct "Receive" Link on Sent Purchase Orders
- **Why it matters**: The user has to go back to the general "Recepción" tab, find the PO, and start the flow.
- **Fix**: On the Purchase Order details page, if the status is `SENT` or `PARTIALLY_RECEIVED`, add a prominent action button "Registrar Recepción" that links to `/dashboard/inventory/receiving?poId=XYZ`.
- **Suggested command**: `$impeccable layout`

## Persona Red Flags

- **Alex (Power User)**:
  - Scrolling through Radix `<Select>` dropdowns to select products is a major efficiency bottleneck.
  - No keyboard shortcut or focus-trap flow to quickly add new items (e.g. pressing Enter to append a row).
  - Lack of filter by supplier on the Suggested Orders page requires scanning the entire table.
- **Jordan (First-Timer)**:
  - Form has no explanation of what "PAR" or "Lead Time" stands for.
  - Price alert triggers are a bit cryptic: a small yellow triangle warning "Promedio histórico: $X.XX" might make them hesitate and think they made a mistake, rather than understanding it's just a warning.
- **Riley (Deliberate Stress Tester)**:
  - Can select the same product multiple times in `CreatePODialog`, creating duplicate items in the PO.
  - Can submit a PO with 0 quantity or negative costs if they type fast before state updates.

## Minor Observations
- **Date Inputs**: Standard browser date input is used without custom styles, which can look mismatched on some operating systems.
- **WhatsApp Share URL**: Links to `window.location.href`. If the user is on localhost, the supplier will receive a localhost link which won't load for them.

## Questions to Consider
- What if the Suggested Orders page grouped items by Supplier first, rather than showing a flat list?
- Can we automatically lock or disable manual unit cost entry unless the user has "Admin" or "Purchasing Manager" permissions?
