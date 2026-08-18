---
timestamp: 2026-08-18T15-55-51Z
slug: app-dashboard-inventory-movements
---
Method: degraded (browser visualization failed, using source analysis)

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Good use of skeletons and empty states |
| 2 | Match System / Real World | 3 | Uses clear operational terminology (Merma, Ajuste) |
| 3 | User Control and Freedom | 3 | Easy to toggle filters and navigate |
| 4 | Consistency and Standards | 4 | Predictable table and filter patterns |
| 5 | Error Prevention | 3 | Disabled states on export and pagination |
| 6 | Recognition Rather Than Recall | 3 | Filters are exposed as toggle badges |
| 7 | Flexibility and Efficiency | 2 | Multi-select filters are good, but no saved views |
| 8 | Aesthetic and Minimalist Design | 3 | Clean but slightly generic |
| 9 | Error Recovery | n/a | Read-only view |
| 10 | Help and Documentation | 2 | Basic header description, no contextual help |
| **Total** | | **26/36** | **Acceptable** |

#### Design Specificity Verdict

The interface is highly functional but feels category-interchangeable. It heavily relies on default component structures (a Card for filters, a Card for the table). While it aligns with the "Operate" mode, it misses opportunities to express the specific "Pulso" brand voice and command-center feel defined in the design guidelines.

The deterministic scan found 0 issues (clean code structure). Because browser injection failed, this assessment relies on source code analysis of the React component layout and styling.

#### Overall Impression
A solid, functional data table that needs visual refinement to match the intended "flat by default" tonal architecture.

#### What's Working
- **Filter Ergonomics**: Exposing the transaction types as clickable badges rather than hiding them in a select dropdown is an excellent pattern for quick scanning and toggling.
- **Data Formatting**: Strict column alignment (numeric values right-aligned) and color-coded badges for movement types make scanning the table easy.

#### Priority Issues

- **[P1] Visual Bureaucracy (Cards in Cards)**
  - **Why it matters**: Wrapping filters in one Card and the table in another creates a heavy, administrative feel rather than a modern operational command center.
  - **Fix**: Remove the Card wrappers. Let the table and filters sit directly on the background, using tonal separation or a single unified container.
  - **Suggested command**: `$impeccable distill`

- **[P2] Lack of Brand Specificity**
  - **Why it matters**: The design looks like a default template. It doesn't strongly signal the Pulso identity or follow the "flat by default" tonal layering specified in the design docs.
  - **Fix**: Apply the specific `--sidebar` or `--border` tokens and remove default shadows to align with the brand.
  - **Suggested command**: `$impeccable bolder`

#### Persona Red Flags

**Alex (Power User)**:
- No keyboard shortcuts for common filters or pagination.
- No quick way to clear all filters at once.

**Sam (Accessibility-Dependent)**:
- The custom badge toggle filters (`button` elements) lack `aria-pressed` states, relying solely on visual color changes to indicate selection.

#### Minor Observations
- The `Table` cells for numeric values correctly use `tabular-nums`, which prevents jitter during updates.
- The Date inputs use native `type="date"` which is accessible but can look inconsistent across browsers.

#### Questions to Consider
- What if the filters were integrated directly into the table header or page header to save vertical space?
- Does the user ever need to see aggregate metrics (e.g., total value of Mermas this month) alongside the raw data list?
