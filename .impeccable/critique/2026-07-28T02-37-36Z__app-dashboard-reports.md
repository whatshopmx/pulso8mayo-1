---
target: "c:\\Users\\david\\pulso29\\app\\dashboard\\reports"
total_score: 22
p0_count: 0
p1_count: 2
timestamp: 2026-07-28T02-37-36Z
slug: app-dashboard-reports
---
# Critique: c:\Users\david\pulso29\app\dashboard\reports

⚠️ DEGRADED: single-context (spawn_agent unavailable in this session)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Report download spinner uses a spinning `Calendar` icon; preview state lacks page-level loading indicators. |
| 2 | Match System / Real World | 1 | Severe language inconsistency: Mexican compliance dashboard is Spanish-themed, but the custom builder is completely in English. |
| 3 | User Control and Freedom | 2 | The custom builder lacks a back navigation button and a quick reset filters button, trapping the user. |
| 4 | Consistency and Standards | 2 | Non-standard layouts (no `PageHeader` in custom builder/schedule page); different toast utilities (`sonner` vs `useToast`). |
| 5 | Error Prevention | 3 | Block validations exist on field selection, but missing for empty filter parameters or date ranges. |
| 6 | Recognition Rather Than Recall | 2 | Fields checklist lacks a search input; selected fields are not aggregated in a visual summary. |
| 7 | Flexibility and Efficiency | 2 | No bulk actions (Select All/None) for fields checklist. Record preview counts text displays a bug (`X of X` instead of `X of Total`). |
| 8 | Aesthetic and Minimalist Design | 3 | Clean flat UI following the visual system, but vertical filter stacks consume too much space. |
| 9 | Error Recovery | 3 | Basic error toasts exist, but custom builder's are not actionable or detailed. |
| 10 | Help and Documentation | 1 | No inline tooltips or help documentation for custom builder fields/filters. |
| **Total** | | **22/40** | **Acceptable** |

## Anti-Patterns Verdict

* **LLM Assessment**: The visual architecture follows the design system's flat-by-default rule and spacing tokens. However, the identical card grid on the main page feels template-y and lacks the typographic rhythm (`text-wrap: pretty/balance`) specified in `DESIGN.md`. The major design anti-pattern is the language split across pages.
* **Deterministic Scan**: The automated design detector (`detect.mjs`) returned `[]` (0 issues found).
* **Visual Overlays**: N/A (CLI scan only, no browser overlay run).

## Overall Impression

The reports module provides a solid functional foundation but suffers from a severe language split (Spanish main/schedule pages, English custom builder), inconsistent page layout structures (PageHeader not used consistently), and some usability friction on the custom builder page (no back button, bulky filters list, no search/bulk actions).

## What's Working

1. **Flat-By-Default Alignment**: Surfaces are flat at rest, utilizing border boundaries and background tones instead of shadow layers.
2. **Scheduled Reports Layout**: The schedule form page utilizes a clean, centered two-column layout limiting width to `max-w-2xl` for high readability.

## Priority Issues

* **[P1] Language Inconsistency (Spanish vs. English)**
  * **Why it matters**: The custom report builder is entirely in English, whereas the main reports dashboard and schedule pages are in Spanish. The target audience of Mexican HORECA managers will struggle with technical terms like "Contracts", "Termination Reason", and "Compensation".
  * **Fix**: Translate the entire `custom-builder.tsx` interface and its fields metadata to Spanish to align with the rest of the application.
  * **Suggested command**: `$impeccable clarify`
* **[P1] Inconsistent Page Layouts and Wrapping**
  * **Why it matters**: The main reports page uses `@/components/shared`'s `<PageContainer>` and `<PageHeader>` layouts, but the custom builder and schedule pages use raw, unstyled headers, which breaks visual coherence.
  * **Fix**: Refactor `custom-builder.tsx` and `schedule/page.tsx` to use `<PageContainer>` and `<PageHeader>`.
  * **Suggested command**: `$impeccable layout`
* **[P2] Custom Builder Usability and Navigation**
  * **Why it matters**: Users feel trapped on the custom builder page because there is no back button to return to the reports dashboard. Furthermore, selecting fields in the scrollable checklist is tedious because there is no search bar, and no "Select All / Select None" buttons.
  * **Fix**: Add a back button matching the page header pattern, implement a search/filter input for fields, and add bulk actions (Select All/Deselect All) for the checkboxes.
  * **Suggested command**: `$impeccable adapt`
* **[P2] Visual Bugs and Odd Affordances**
  * **Why it matters**: The preview description says `Showing {previewData.length} of {previewData.length} records` which is a bug that hides the actual count. The report download button shows a spinning `Calendar` icon instead of a loader spinner.
  * **Fix**: Fix the preview count text to display the correct total count from the API. Replace the spinning `Calendar` icon with a standard `Loader2` or generic spinner.
  * **Suggested command**: `$impeccable polish`
* **[P3] Bulky Filter Layout**
  * **Why it matters**: Each filter added in the custom builder takes up 4 vertical rows of space, creating massive visual clutter when multiple filters are applied.
  * **Fix**: Reposition filter controls into a single horizontal row (Field | Operator | Value | Close) for a more compact and readable list.
  * **Suggested command**: `$impeccable layout`

## Persona Red Flags

* **Alex (Power User)**: Alex wants to quickly build a custom report. When opening the builder, there is no search box to filter the long list of fields. He has to manually scroll and click dozens of checkboxes without any "Select All" accelerator. He has no keyboard shortcuts or quick way to add/remove filters.
* **Jordan (First-Timer)**: Jordan is a restaurant manager who only speaks Spanish. Clicking the "Constructor de Reportes" button, they are confronted with a fully English page. They do not know what "CURP", "RFC", or "Compensation" fields mean in this context. They also do not see any back button to escape this page, making them feel lost.
* **Riley (Stress Tester)**: Riley adds multiple filters without specifying a field or value and clicks "Generate Preview". The UI does not validate these fields and sends empty strings to the backend, failing silently without showing an actionable error state.

## Minor Observations

* Toast library usage is split: the main page uses `sonner` via `toast.success/error`, while `custom-builder.tsx` uses a custom `useToast` hook. Standardizing on `sonner` will clean up dependencies.
* The calendar input fields use standard `<Input type="date">` which renders differently on mobile browsers. Consider a stylized Popover with a calendar picker if browser defaults look bad.

## Questions to Consider

* Should we extract the available fields list to a separate config file or load them from the backend dynamically?
* What if the custom report builder were structured as a step-by-step wizard (1. Source, 2. Columns, 3. Filters, 4. Preview) instead of a single crowded page?
