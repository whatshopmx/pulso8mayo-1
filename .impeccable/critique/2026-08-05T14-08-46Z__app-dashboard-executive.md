---
target: app/dashboard/executive
total_score: 22
p0_count: 0
p1_count: 2
timestamp: 2026-08-05T14-08-46Z
slug: app-dashboard-executive
---
#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Raw tech message `POST /api/executive/twin/refresh` exposed on cards when data loading |
| 2 | Match System / Real World | 3 | Mixed English labels (`Group Health`, `Op. Risk`) in Spanish HORECA app |
| 3 | User Control and Freedom | 2 | Read-only dashboard with zero filters, date pickers, or branch drill-downs |
| 4 | Consistency and Standards | 2 | `border-l-4` side-stripe anti-pattern in Alerts, inline emoji, unstyled table |
| 5 | Error Prevention | 3 | Static data coverage note without explanation of estimation assumptions |
| 6 | Recognition Rather Than Recall | 2 | Unexplained "drift 12" metric score without business context scale |
| 7 | Flexibility and Efficiency | 1 | No keyboard shortcuts, search, or click-through links to branch detail pages |
| 8 | Aesthetic and Minimalist Design | 2 | Fragmented card overload (8 stacked cards) creating visual noise |
| 9 | Error Recovery | 2 | Technical API endpoints leaked in empty/waiting state components |
| 10 | Help and Documentation | 2 | High-concept metrics (Executive Twin, drift) lack inline info tooltips |
| **Total** | | **22/40** | **[Acceptable]** |

#### Anti-Patterns Verdict

**LLM assessment**: 
- **Side-stripe border**: `AlertsPanel` uses `border-l-4 border-l-amber-500` in `alerts-panel.tsx`, violating flat-by-default rules.
- **Card grid overload**: 8 separate stacked cards across 4 grid sections without unified spatial rhythm.
- **Language bleed**: English card titles (`Group Health`, `Cash Available`, `Op. Risk`, `Brand`, `People Risk`) mixed with Spanish HORECA copy.
- **Tech jargon leak**: Displaying raw API endpoint strings (`POST /api/executive/twin/refresh`) in end-user components.
- **Emoji in code**: Using raw `⚠️` text emoji in `branch-ranking.tsx` instead of structured icons.

**Deterministic scan**: 
- 1 issue detected by `detect.mjs`:
  - `components/dashboard/executive/alerts-panel.tsx:146` — `side-tab` (`border-l-4` accent border on card).

**Visual overlays**:
- Skipped (no local dev server URL running).

#### Overall Impression
The Executive Dashboard provides a strong single-pane-of-glass data foundation (Cash flow 14d, P&L, NOM-251 compliance, AI predictions). However, visually and ergonomically it functions as a disconnected grid of cards with mixed language, side-border anti-patterns, technical jargon leaks, and a complete lack of interactive drill-downs.

#### What's Working
- **Comprehensive Executive Metrics**: Combines financial, operational, compliance, and human risk into one screen.
- **Suspense-enabled Performance**: Server Components with granular `Suspense` fallbacks prevent rendering blocks.
- **Clean Currency Formatting**: Compact MXN formatting (`$1.82M`, `$45.3K`) presents large numbers effectively.

#### Priority Issues
- **[P1] Remove Side-Stripe Accent Border in Alerts Panel**
  - *Why it matters*: Violates system design rules (no `border-left` > 1px) and signals AI code generation.
  - *Fix*: Remove `border-l-4 border-l-amber-500` in `alerts-panel.tsx`. Use a subtler card header tint or header badge.
  - *Suggested command*: `$impeccable quieter app/dashboard/executive`

- **[P1] Eliminate Technical API/Developer Jargon Leaks in UI**
  - *Why it matters*: Revealing `POST /api/executive/twin/refresh` and unexplained `drift 12` damages trust with executive users.
  - *Fix*: Replace `WaitingCard` text with user-friendly copy ("Calculando métricas del grupo...") and add inline tooltip for Drift score.
  - *Suggested command*: `$impeccable clarify app/dashboard/executive`

- **[P2] Unify Typography & Language (English → Spanish)**
  - *Why it matters*: Mixed English/Spanish card labels create visual friction for Mexican HORECA directors.
  - *Fix*: Translate hero card titles to Spanish ("Salud del Grupo", "Flujo Proyectado", "Riesgo Operativo", "Cumplimiento NOM", "Consistencia de Marca", "Riesgo de Personal").
  - *Suggested command*: `$impeccable typeset app/dashboard/executive`

- **[P2] Add Interactivity & Branch Drill-down Links**
  - *Why it matters*: Directors cannot click on branches in `BranchRanking` or `PnlBranchTable` to investigate issues.
  - *Fix*: Make branch names clickable links pointing to `/dashboard/branches/[id]`.
  - *Suggested command*: `$impeccable shape app/dashboard/executive`

- **[P3] Refine Table Hierarchy & Progress Indicators**
  - *Why it matters*: `PnlBranchTable` lacks column visual contrast and `BranchRanking` uses raw emoji `⚠️`.
  - *Fix*: Replace emoji in `branch-ranking.tsx` with Lucide icons and add subtle background highlight to Profit columns in `pnl-branch-table.tsx`.
  - *Suggested command*: `$impeccable polish app/dashboard/executive`

#### Persona Red Flags
- **Alex (Power User / Executive Director)**: Cannot filter data by date range or branch group. Cannot click branch rows to navigate directly to branch dashboards.
- **Jordan (First-Time Restaurant Owner)**: Confused by technical terms like "drift 12" or "Executive Twin".
- **Sam (Accessibility User)**: Recharts graphs lack text table alternatives for screen readers.

#### Minor Observations
- Dynamic Tailwind class construction in `HeroCard` (`text-${dColor}-600`) will be purged in production builds.
- `PredictionsPanel` hardcodes `slice(0, 2)` with no "Ver todas" overflow link.

#### Questions to Consider
- Should we add a global group/date filter bar at the top of the Executive Dashboard?
- Would a 2-row consolidated metric header work better than 6 large stacked cards?
- Can we enable CSV export for the P&L Operativo Estimado table?
