---
target: app/dashboard/page.tsx
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-08-10T23-58-56Z
slug: app-dashboard-page-tsx
---
# Design Critique: app/dashboard/page.tsx

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Good; use of Next.js Suspense skeleton state prevents blank flashes, but page-level filters lack loading/transition indication. |
| 2 | Match System / Real World | 4 | Excellent; localized to es-MX, terms like "Flujos Ejecutados" and "NOM-251" match restaurant operations perfectly. |
| 3 | User Control and Freedom | 3 | Good; remediation cards have clear action triggers, but filters lack a clear reset state and the attention queue cannot be dismissed. |
| 4 | Consistency and Standards | 2 | Partial; MetricCard is visually unified, but the spacing and layout flow are disjointed. KPI card grids are split across three separate rows sandwiching other charts. |
| 5 | Error Prevention | 3 | Good; destructive remediation actions require double confirmation in dialogs. |
| 6 | Recognition Rather Than Recall | 2 | Some aids; main operations are visible, but the sheer quantity of metrics (12 separate cards) degrades recognition under visual noise. |
| 7 | Flexibility and Efficiency | 2 | Some shortcuts; no keyboard navigation for branch selectors, search, or filters. |
| 8 | Aesthetic and Minimalist Design | 2 | Moderate clutter; violates the rule against using hero-metric templates as default layout (12 identical cards stacked). Spacing and grid layouts are dense. |
| 9 | Error Recovery | 3 | Good; SectionErrorBoundary isolates card loading failures so the page remains interactive. |
| 10 | Help and Documentation | 1 | Help exists but is not contextual; cards don't explain how NOM-251 or labor cost scores are calculated. |
| **Total** | | **25/40** | **Acceptable (75% / Good)** |

*Note: The score of 25/40 sits in the **Acceptable** band (62.5% of total points), indicating that while the functional elements exist, visual structure, hierarchy, and usability require refinement.*

## Design Specificity Verdict

- **LLM Assessment**: The dashboard is tailored specifically for Pulso HORECA operations (NOM-251, branch ranking, and remediation alerts). However, the page suffers from structural sameness—it piles up 12 metric cards and multiple charts in a single long scroll, which could belong to any generic dashboard. It misses the opportunity to establish a clear hierarchy, feeling more like a visual catalog of components than a focused command center.
- **Deterministic Scan**: 0 findings (no automatic rule violations detected by `detect.mjs` in the page file).
- **Visual Overlays**: Overlays were checked via browser screenshot verification. The page renders correctly with the OKLCH theme but suffers from poor rhythm and layout fatigue.

## Overall Impression

The dashboard is functional and loads quickly using async server components and skeletons. However, it lacks operational focus: displaying 12 cards, 3 charts, and a table on a single page overwhelms the user. Consolidating the visual elements and improving the layout rhythm is the single biggest opportunity.

## What's Working
- **Remediation Attention Queue**: Placing the critical external remediation cards ("Fumigation Alert") at the top ensures critical items are seen first before secondary metric cards.
- **Tonal Theming**: High-contrast, clean typography (Geist) combined with distinct neutral background colors ensures a premium, modern feel.
- **Robust Loading States**: Proper Suspense skeletons prevent layout shifting during data fetching.

## Priority Issues

- **[P1] Information Overload & Grid Disorganization (Aesthetic & Minimalist Design)**
  - **Why it matters**: HORECA managers must scan the dashboard in under 10 seconds. Piling up 12 metric cards (in three separate rows) interspersed with tables and cost charts creates cognitive fatigue.
  - **Fix**: Consolidate the KPI summary cards. Group them into a tabbed layout (e.g., "Operaciones", "Finanzas", "RH") or move detailed sub-KPIs into their respective detail views.
  - **Suggested command**: `$impeccable layout`

- **[P1] Metric Card Redundancy (Consistency & Standards)**
  - **Why it matters**: Piling up cards from `ComplianceMetrics`, `ExecutiveSummary`'s alert strip, and `KpiSummaryCards` makes it hard to distinguish between high-level company health and local indicators.
  - **Fix**: Distill the card count down to 4 critical, high-level operational indicators. Allow expanding or drill-downs for detail.
  - **Suggested command**: `$impeccable distill`

- **[P2] Lack of Keyboard Accelerators (Flexibility & Efficiency of Use)**
  - **Why it matters**: Regional managers toggle branches frequently. Scrolling and clicking selectors manually degrades efficiency.
  - **Fix**: Add shortcut key bindings to focus filters or search fields.
  - **Suggested command**: `$impeccable adapt`

- **[P2] Missing Contextual Help (Help & Documentation)**
  - **Why it matters**: Metrics like "Cumplimiento NOM-251: 77%" do not explain how they are calculated.
  - **Fix**: Add hover tooltip overlays describing the calculation formula.
  - **Suggested command**: `$impeccable clarify`

- **[P2] Announcement Section Spacing (Aesthetic & Minimalist Design)**
  - **Why it matters**: Pinned announcements at the bottom occupy a lot of vertical space on mobile and push important controls off-screen.
  - **Fix**: Redesign announcements into a compact scrollable list or collapsible card widget.
  - **Suggested command**: `$impeccable quieter`

## Persona Red Flags

- **Alex (Power User)**: Needs to review branches fast. Must click the dropdown filter 12 times to compare branches since the main page only shows Polanco and Roma. Keyboard navigation is missing.
- **Jordan (First-Timer)**: Confronted with 12 metric cards and 3 charts without any onboarding tooltips or calculations explanations. Will get confused by "Labor Cost: 28% (Meta: 30%)" and abandon.
- **Casey (Distracted Mobile User)**: On mobile, 12 metric cards stacked vertically create a page that requires a long scroll to reach the recent activity table. Touch targets in the data table are dense.
- **Mateo (Restaurant Owner)**: Mateo wants to oversee his group of 12 branches at a glance. Only the top and bottom branches are ranked in the executive summary card, hiding the intermediate ones.
