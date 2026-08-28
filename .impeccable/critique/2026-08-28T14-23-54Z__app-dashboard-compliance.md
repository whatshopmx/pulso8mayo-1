---
target: app/dashboard/compliance
total_score: 24
max_score: 40
na_heuristics: ""
p0_count: 0
p1_count: 2
timestamp: 2026-08-28T14-23-54Z
slug: app-dashboard-compliance
---
#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Spinners and branch badges present, but nested tabs obscure sub-view state. |
| 2 | Match System / Real World | 3 | Strong Mexican HORECA terminology (NOM-251, NOM-035, IMSS SUA/IDSE, RFC/CURP). |
| 3 | User Control and Freedom | 2 | IMSS and Nómina tabs act as link-outs rather than inline views; no inline branch override. |
| 4 | Consistency and Standards | 2 | Period filter is a Select in Dashboard but button pills in Corporate Grid; ad-hoc color classes. |
| 5 | Error Prevention | 3 | Date range validation prevents future dates; branch guards prevent invalid queries. |
| 6 | Recognition Rather Than Recall | 2 | Nested tabs (Tabs inside Tabs) force memorization of where alerts and metrics reside. |
| 7 | Flexibility and Efficiency | 2 | No batch reminders or multi-branch comparison filters; single-branch workflows dominate. |
| 8 | Aesthetic and Minimalist Design | 2 | Double tab bar stacks vertical height; empty link-out cards create visual dead weight. |
| 9 | Error Recovery | 3 | Standard ErrorState with retry button present across main view and subpages. |
| 10 | Help and Documentation | 2 | Minimal context on legal thresholds, inspection frequencies, or IMSS 5-day deadlines. |
| **Total** | | **24/40** | **Acceptable (60%)** |

#### Design Specificity Verdict

**LLM assessment**:
The surface is well-tailored in its domain language to Mexican hospitality operations (NOM-251 sanitary guidelines, NOM-035 psychosocial risk, IMSS movements, SUA layouts). However, the information architecture suffers from structural fragmentation. The page oscillates between being a multi-tab analytical dashboard, a reporting tool, and a sitemap directory of links. The presence of nested tabs (5 sub-tabs nested inside the "Dashboard" tab) combined with placeholder link-out cards for IMSS and Nómina creates an inconsistent hierarchy.

**Deterministic scan**:
Automated AST scan with `detect.mjs` completed with **0 automated rule violations**. Code structure adheres to basic primitive rules (clean Radix/shadcn component usage), but the architectural and visual hierarchy issues exist at the page layout and composition layer.

**Visual overlays**:
Browser subagent encountered a runtime error during tab initialization. Deterministic AST scanning completed cleanly; visual overlay injection was bypassed.

#### Overall Impression
A functionally rich compliance center that feels split across two conflicting mental models: half of it is an interactive real-time dashboard, while the other half is a directory of links to external routes. Flattening the nested tabs and turning placeholder cards into true inline summaries or a unified sub-navigation will elevate this into a true command center for multi-unit operators.

#### What's Working
1. **Domain Fidelity**: Explicit tailoring to NOM-251, NOM-035, IMSS, and SAT requirements with appropriate Mexican regulatory terminology.
2. **Actionable WhatsApp Triggers**: The single-click WhatsApp reminder in the Corporate Compliance Grid directly connects audit status with store manager communication.
3. **Resilient State Handling**: Loading skeletons, explicit error boundaries with retry mechanisms, and date validation are systematically implemented.

#### Priority Issues

- **[P1] Inconsistent Tab Architecture & Link-Out Anti-Pattern**
  - **What**: The main tab list mixes full inline views (Dashboard, Vista Corporativa, NOM reports) with placeholder Cards that only contain buttons linking away to `/dashboard/compliance/imss` and `/dashboard/compliance/payroll`. Meanwhile, sibling features like `/sat`, `/schedules`, and `/expediente` are completely orphaned from the top navigation.
  - **Why it matters**: Breaks user expectations of tabs. Tabs are expected to toggle views within a single workspace, not serve as a sparse link tree. Navigating away causes context loss and breaks back-button workflows.
  - **Fix**: Either embed compact overview widgets and quick actions directly inside the IMSS and Nómina tabs, or replace the tab bar with a structured compliance hub layout.
  - **Suggested command**: `$impeccable layout`

- **[P1] Nested Tabs Anti-Pattern in Dashboard View**
  - **What**: The "Dashboard" tab contains a second, nested `<Tabs>` component with 5 sub-tabs (`Evaluaciones`, `Tendencias`, `Vencimientos`, `Alertas`, `Por Sucursal`).
  - **Why it matters**: Creates severe cognitive load (tab-inside-a-tab). Critical operational information like active critical alerts is hidden behind multiple clicks and separate tab states.
  - **Fix**: Flatten the dashboard into a unified single-scroll operational layout featuring top KPI cards, a side-by-side Alertas & Vencimientos action board, and a comparative performance chart.
  - **Suggested command**: `$impeccable distill`

- **[P2] Fragmented Filter Controls & Design Token Inconsistencies**
  - **What**: Period selection uses a `<Select>` dropdown in `ComplianceDashboard` but a button-group pill selector in `CorporateComplianceGrid`. Hardcoded Tailwind color classes (`bg-yellow-50`, `text-yellow-700`, `border-yellow-200`, `border-green-200`) and arbitrary RGB values `[133, 22, 28]` in jsPDF bypass the project's OKLCH design tokens.
  - **Why it matters**: Visual inconsistency across sibling views and degraded appearance in dark mode.
  - **Fix**: Standardize on a unified filter bar component and migrate all ad-hoc color classes to semantic CSS variable tokens (`--warning-subtle`, `--success-subtle`, `--primary`).
  - **Suggested command**: `$impeccable colorize`

- **[P2] High-Friction Branch Scope Handling in NOM Reports**
  - **What**: When viewing "Todas las sucursales", switching to NOM-251 or NOM-035 renders a blocking `SelectBranchNotice` instructing the user to scroll up and change the header branch selector.
  - **Why it matters**: Forces a disjointed visual context shift to the global header instead of allowing seamless branch selection or showing an aggregate compliance rollup.
  - **Fix**: Embed an inline branch dropdown directly inside the empty notice card or display a multi-branch NOM compliance summary table when "Todas" is active.
  - **Suggested command**: `$impeccable clarify`

#### Persona Red Flags

**Rodrigo (Multi-Unit Operations Director)**:
- Must navigate through 2 layers of tabs and bounce between different URLs to verify NOM inspection status vs IMSS alta/baja deadlines.
- Cannot download a consolidated multi-branch executive compliance dossier in a single action.

**Alex (Impatient Power User / Store Manager)**:
- Forced to click through nested sub-tabs to check if there are unresolved sanitary alerts for their branch.
- Clicking the "IMSS" tab requires an extra click on "Ir a Gestión IMSS" to actually see any employee data.

**Sam (Accessibility & Keyboard User)**:
- Nested tab lists create dual tab-stop rings with confusing roving focus indices.
- Ad-hoc yellow/green alert borders rely on low-contrast pastel backgrounds without strong semantic border variables.

#### Minor Observations
- The jsPDF export function runs entirely on the client with hardcoded column styling and RGB values `[133, 22, 28]` instead of using the company's branded report template.
- The `showCorporate` conditional tab disappears when only 1 branch is configured, altering the tab grid layout (`grid-cols-6` vs `grid-cols-5`) unexpectedly.
- Empty states in NOM-251 and NOM-035 could show actionable sample checklists or preflight audit prompts.

#### Questions to Consider
- What if the Compliance view were structured as a single Executive Command Center with unified widgets (Sanitary NOMs, Labor IMSS, and SAT Tax validations) rather than siloed link pages?
- Could the "Vista Corporativa" semáforo and "Dashboard" metrics merge into a cohesive multi-branch view with inline branch drill-down?
