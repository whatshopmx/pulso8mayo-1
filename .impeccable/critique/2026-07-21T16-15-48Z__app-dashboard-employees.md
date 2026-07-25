---
timestamp: 2026-07-21T16-15-48Z
slug: app-dashboard-employees
---
#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3/4 | Loading state replaces full table with spinner instead of skeleton rows |
| 2 | Match System / Real World | 3/4 | Mixed language (English "Onboarding" / Spanish date format `MMM d, yyyy`) |
| 3 | User Control and Freedom | 3/4 | List/Grid view toggles working well, clear search button present |
| 4 | Consistency and Standards | 2/4 | `text-[10px]` and `text-[11px]` microtext break the system type ramp |
| 5 | Error Prevention | 2/4 | Bulk actions execute without confirmation modals or undo capabilities |
| 6 | Recognition Rather Than Recall | 3/4 | Clear table column headers, avatar fallbacks, dropdown menus |
| 7 | Flexibility and Efficiency of Use | 2/4 | No quick search keyboard shortcuts (`Cmd+K` or `/`), page-only selection |
| 8 | Aesthetic and Minimalist Design | 2/4 | Flat table header lacks visual grouping, dense badges in cards |
| 9 | Error Recovery | 2/4 | Generic "Error fetching employees" toasts lack retry triggers |
| 10 | Help and Documentation | 1/4 | No inline tooltips or contextual help for employee status badges |
| **Total** | | **23/40** | **Acceptable** |

#### Anti-Patterns Verdict

**LLM assessment**: The interface follows a standard admin table structure, but feels unpolished. It relies on arbitrary utility microtext (`text-[10px]`) for badges and labels, disrupting the system typography defined in `DESIGN.md`. Loading states replace content with generic centered spinners rather than skeleton UI, causing layout shift.

**Deterministic scan**: Detector found 9 total issues across employee components:
- **7 type-ramp violations**: `text-[10px]` and `text-[11px]` used in `status-badge.tsx`, `contract-card.tsx`, `asset-checklist.tsx`, `settlement-calculator.tsx`, `benefits-tab.tsx`, `training-tab.tsx`, and `exit-interview-form.tsx`.
- **2 border-accent violations**: `border-b-2` bottom border accents on rounded tab containers in `audit-tab.tsx` and `documents-tab.tsx`.

#### Overall Impression
The Employee Directory (`app/dashboard/employees`) provides a functional operational workflow with list/grid toggle and bulk actions, but lacks visual precision and polish. Fixing type-ramp inconsistencies and replacing full-screen spinners with skeleton loaders will elevate the user experience significantly.

#### What's Working
1. **View Mode Flexibility**: Seamless switching between List and Grid layouts (`List` vs `LayoutGrid`) to suit different dense vs visual browsing preferences.
2. **Search & Debounce Mechanics**: Smooth search integration with a 300ms debounce timer preventing unnecessary API request spamming.
3. **Comprehensive Quick Actions**: Action menu per employee item covers viewing profiles, editing details, messaging, and accessing documents directly.

#### Priority Issues

- **[P1] Loading Layout Shift & Missing Skeletons**: In `employee-table.tsx`, fetching data swaps the entire table with a single centered `<Loader2 />` spinner. This causes high visual jumpiness when switching pages or typing search queries.
  - *Why it matters*: Users lose structural context during data fetches and experience annoying layout thrashing.
  - *Fix*: Replace spinner fallback with a 5-row table skeleton UI matching exact column widths.
  - *Suggested command*: `$impeccable layout`

- **[P1] Arbitrary Microtext (Type-Ramp Violations)**: Widespread usage of `text-[10px]` and `text-[11px]` in `status-badge.tsx`, `contract-card.tsx`, and sub-tabs.
  - *Why it matters*: Text below 12px (`0.75rem`) severely impacts readability, breaks accessibility guidelines, and violates the Geist type hierarchy in `DESIGN.md`.
  - *Fix*: Refactor all badge and metadata text to `text-xs` (`0.75rem` / 12px) with appropriate padding.
  - *Suggested command*: `$impeccable typeset`

- **[P2] Border Accent Clashing on Rounded Tabs**: `border-b-2` accent borders applied inside rounded containers (`audit-tab.tsx`, `documents-tab.tsx`).
  - *Why it matters*: Sharp accent lines inside rounded card borders create awkward visual collisions and anti-pattern warnings.
  - *Fix*: Replace `border-b-2` accent lines with subtle background fills (`bg-accent/50`) or border-less tab indicators.
  - *Suggested command*: `$impeccable polish`

- **[P2] Empty State Needs Actionable Recovery**: When no employees match search criteria, the empty state displays a static text block without direct action buttons.
  - *Why it matters*: Forces users to manually scroll back up to clear search inputs or click the top header button.
  - *Fix*: Add primary CTA button ("Add Employee") and secondary CTA ("Clear Search") inside the empty state component.
  - *Suggested command*: `$impeccable onboard`

- **[P2] Bulk Actions Lack Confirmation & Select-All Scope Messaging**: Selecting all rows only checks visible page items without indicating total matching record count, and bulk actions trigger without modal confirmations.
  - *Why it matters*: Increases risk of accidental bulk edits or confusion when acting on multi-page data sets.
  - *Fix*: Add an explicit banner ("Selected 20 employees on this page. Select all 145 employees?") and confirmation dialogs.
  - *Suggested command*: `$impeccable harden`

#### Persona Red Flags

**Alex (Power User)**:
- No quick keyboard shortcut (like `/` or `Cmd+K`) to focus the search bar.
- Selecting all employees only affects the current 20-item page; no quick select-all-across-pages option.
- Must click through dropdown menus row-by-row to open profiles instead of row-click navigation or keyboard navigation.

**Jordan (First-Timer / Operations Manager)**:
- English status terms ("Onboarding", "On Leave", "Suspended") mixed with Spanish date formatting.
- No tooltip explanations on status badges (e.g. what distinguishes "Suspended" vs "Terminated" in HORECA compliance).
- Toast messages on network failure state "Error fetching employees" without suggesting action steps or retry buttons.

**Casey (Mobile User)**:
- Table layout requires horizontal scrolling on mobile viewports; grid view cards lack touch-optimized quick action buttons.
- Search input and view mode toggle buttons stack tightly on small screens.

#### Minor Observations
- Select dropdown for pagination limit (`10 per page`, `20 per page`) uses unstyled native `<select>` element instead of Shadcn `<Select>`.
- Avatar fallback defaults to uppercase single letter without subtle color variation by employee name.

#### Questions to Consider
- Should employee status badges use HORECA-specific Mexican labor compliance terms (NOM-035/NOM-251 tracking)?
- Could row clicking on the employee directory navigate directly to profile view without needing the 3-dot dropdown menu?
