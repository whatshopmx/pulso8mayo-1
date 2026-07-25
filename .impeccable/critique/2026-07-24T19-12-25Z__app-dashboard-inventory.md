---
target: app/dashboard/inventory components/inventory
total_score: 22
p0_count: 1
p1_count: 2
timestamp: 2026-07-24T19-12-25Z
slug: app-dashboard-inventory
---
# Critique: app/dashboard/inventory & components/inventory

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3/4 | Spinners are used (`Loader2`), but complex actions like OCR lack explicit progress states beyond text changes. |
| 2 | Match System / Real World | 3/4 | Strong operational HORECA terms used ("Lotes", "Merma"), but status strings ("AVAILABLE") and fallbacks ("units") leak in English. |
| 3 | User Control and Freedom | 2/4 | No "undo" action for inventory receipts. Canceling a complex form immediately discards all progress without confirmation. |
| 4 | Consistency and Standards | 2/4 | Mismatched card border radii and shadows (standard card component uses `shadow-sm` and `rounded-xl` instead of the flat `rounded-lg`). |
| 5 | Error Prevention | 2/4 | Temperature boundaries are checked, but dates allow historical/future inputs without validation, and form data is easily lost. |
| 6 | Recognition Rather Than Recall | 3/4 | Form product selects lack inline visual indicators (images, inventory status), requiring users to recall SKU names. |
| 7 | Flexibility and Efficiency | 2/4 | Keyboard shortcuts are missing, and the barcode scanner mode relies on a rigid manual text-input field focus. |
| 8 | Aesthetic and Minimalist Design | 2/4 | High cognitive load. The receiving workflow dialog is overloaded with inputs and violates the "no nested cards" design rule. |
| 9 | Error Recovery | 2/4 | Server errors are toasted directly without translation or suggesting constructive solutions for correction. |
| 10 | Help and Documentation | 1/4 | No contextual help tooltips for complex compliance fields (e.g. allergen info, storage temperature requirements). |
| **Total** | | **22/40** | **Acceptable** |

---

## Anti-Patterns Verdict

### LLM Assessment
The interface has a clean functional foundation but falls into several SaaS layout clichés:
- **Card Clutter & Nested Layouts**: The receiving workflow dialog features an outer `<Card>` containing a list of item records, which are styled as individual cards (border and `bg-card`). This creates a visual nested-card stack that increases clutter.
- **Mismatched Colors**: The charts in `dashboard-charts.tsx` use hardcoded Tailwind HEX colors (`#2563eb`, `#16a34a`, etc.) rather than using OKLCH CSS variables from the design system.
- **Elevation Violations**: Cards import the standard `components/ui/card.tsx` layout, which includes `shadow-sm` and `rounded-xl`, violating the flat-by-default (tonal layering) and `rounded-lg` (10px) rules.

### Deterministic Scan
The automated design system scan found **6 font size violations**:
- **`app/dashboard/inventory`**: 5 violations where `10px` or `text-[10px]` is used in `recipes/page.tsx` and `reports/page.tsx`.
- **`components/inventory`**: 1 violation in `components/inventory/receiving-workflow.tsx` on line 468 (`text-[10px]`).
These violate the standard typography scale documented in `DESIGN.md`, where the smallest font size is the `label` (0.75rem / 12px) or `mono` (0.8125rem / 13px).

### Visual Overlays
Visual overlay mutation was not attempted because browser devtools logs / write actions are not exposed in this session; fallback CLI scanning was used instead.

---

## Overall Impression
The inventory workspace has excellent operations-focused features (OCR parsing of remisiones, barcode scanning, temperature quarantines, batch history). However, the interface looks like a generic SaaS template that was rapidly assembled. It suffers from nested borders, shadows, generic chart colors, and heavy cognitive load on workflows like receiving.

---

## What's Working
- **OCR and Barcode Integrations**: Very practical for real restaurant kitchens where quick inputs are essential.
- **Detailed History Tabulation**: Clear tracking of inventory batches, movements, and price shifts with explicit user audit logging.

---

## Priority Issues

### [P0] Data Loss on Cancel / Dismiss
- **Why it matters**: If a user is manually receiving 10 items and accidentally clicks the backdrop or presses the Cancel button, the entire modal dismisses and all inputs are immediately lost.
- **Fix**: Add a confirmation prompt before closing the dialog if the form state is dirty.
- **Suggested command**: `$impeccable harden`

### [P1] Cognitive Overload & Nested Cards in Receiving
- **Why it matters**: The receiving workflow is a single massive dialog containing headers, scan toggles, OCR file drops, and a list of cards containing 6 form fields each. This exceeds the user's working memory.
- **Fix**: Restructure the workflow into a clean multi-step wizard (Step 1: Supplier & PO, Step 2: Item Scanning/OCR, Step 3: Verify & Log Temperatures/Costs). Remove the nested card styling.
- **Suggested command**: `$impeccable layout`

### [P1] Off-Ramp Typography (10px)
- **Why it matters**: Using `text-[10px]` for metadata reduces readability and fails basic contrast requirements for operational staff in active, high-glare kitchen environments.
- **Fix**: Update the font size to the standard `label` size (0.75rem / 12px) or use `mono` text for numbers.
- **Suggested command**: `$impeccable typeset`

### [P2] Hardcoded Colors in Charts
- **Why it matters**: Recharts components are styled with hardcoded hex strings that do not adapt to dark mode or align with the HORECA color palette.
- **Fix**: Bind chart strokes and fills to design system CSS variables (`var(--chart-1)`, `var(--success)`, etc.).
- **Suggested command**: `$impeccable colorize`

### [P2] Inconsistent Language & Terminology
- **Why it matters**: Spanish and English terms are mixed directly in user-facing fields (e.g. status "AVAILABLE", unit fallback "units", item name fallback "Insumo").
- **Fix**: Fully localize statuses and units into Spanish, ensuring professional and consistent terminology.
- **Suggested command**: `$impeccable clarify`

---

## Persona Red Flags

### Alex (Power User)
- **Red Flag**: Alex has to receive a delivery of 15 items. He has to manually click "Agregar Item" 15 times, choose a product, click the quantity input, type, click the lot number, and type. The barcode scanner mode is rigid and requires manual click focus on the scanner input to capture inputs.
- **Will abandon at**: Item 4 when he realizes he cannot tab-navigate the fields easily or use keyboard shortcuts.

### Jordan (First-Timer)
- **Red Flag**: Jordan opens the receiving dialog. He is met with a wall of inputs. He doesn't know which fields are strictly required (e.g. temperature is only required for cold items, but looks identical to batch number). The page is visually overwhelming and loud.
- **Will abandon at**: Step 1 due to high cognitive load.

### Riley (Stress Tester)
- **Red Flag**: Riley clicks "Cancelar" after typing several items to see if the form warns him about losing his inputs. The modal closes instantly and wipes his data. He enters a negative unit cost and a date in 2035, and the application accepts it without validating input ranges.
- **Will abandon at**: Finding that the system allows invalid, corrupt data entries.

---

## Minor Observations
- **Missing Skeletons**: Loading states use text descriptions or spinner icons (`Loader2`) rather than layout skeletons (`KpiCardsSkeleton`, etc.).
- **Image Fallbacks**: The product table uses raw `img` elements instead of Next.js `Image` wrappers with proper aspect-ratio boxes.

---

## Questions to Consider
- How can we break the receiving form into a multi-step stepper to decrease the visual clutter and help Jordan input data accurately?
- Should the status strings ("AVAILABLE", "RECEIVED") be mapped to client-side Spanish translations in the list views?
- What would a custom keyboard-friendly scanning interface look like for Alex?
