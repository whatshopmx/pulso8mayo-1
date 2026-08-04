---
target: app/dashboard/finance
total_score: 20
p0_count: 0
p1_count: 2
timestamp: 2026-08-04T15-20-15Z
slug: app-dashboard-finance
---
# Critique — app/dashboard/finance (cash-flow, expenses, petty-cash)

Method: ⚠️ DEGRADED: single-context (no sub-agent tool exposed in this session)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Toast on approve success; loading spinners present, but fetch failures are silent (console.error only) |
| 2 | Match System / Real World | 3 | Spanish + HORECA/finanzas terms (caja chica, food cost) feel native |
| 3 | User Control and Freedom | 2 | No undo on Approve; petty-cash has no filter/reset; expense approve irreversible |
| 4 | Consistency and Standards | 2 | Badge colors hardcoded to Tailwind emerald/amber/blue/rose, not OKLCH semantic tokens; status vocabulary drifts page to page |
| 5 | Error Prevention | 2 | Approve irreversible w/o confirmation; delete has confirm() only |
| 6 | Recognition Rather Than Recall | 2 | Filters visible, but petty-cash renders null when no fund — no empty state |
| 7 | Flexibility and Efficiency | 1 | No keyboard shortcuts, no batch approve, no table sort/column toggle |
| 8 | Aesthetic and Minimalist Design | 2 | 3-up KPI "hero-metric" cards in petty-cash (banned pattern); card-heavy |
| 9 | Error Recovery | 1 | Errors only surface in console.error; no user-facing error UI anywhere |
| 10 | Help and Documentation | 1 | No tooltips/contextual help beyond inline copy |
| **Total** | | **20/40** | **Acceptable (low end)** |

## Anti-Patterns Verdict

**LLM assessment**: Not screaming "AI" on first glance — the flat surfaces and Spanish copy read operational. But the 3-up saldo/umbral/movimientos card row in petty-cash is the textbook hero-metric template (big number, small label, badge accent) that DESIGN.md's Don'ts bans explicitly. Compliance vocabulary is correctly downplayed; the bigger tell is generic SaaS grammar: the emerald-50/amber-50/blue-50 badge trio is the same badge palette every generic dashboard ships, and it ignores the documented OKLCH semantic tokens.

**Deterministic scan**: 0 findings on the three finance page files (detector clean for finance). All 6 detector hits landed on the sales surface.

**Visual overlays**: No reliable user-visible overlay. These are authenticated dashboard routes requiring DATABASE_URL + better-auth session + seeded branches to render; the dev server cannot be started reliably offline. Fallback signal: source-level review + detector only.

## Overall Impression
Operationally literate pages that mostly honor the flat, Geist, restrained-red system — but they lean on the exact SaaS clichés (hero-metric cards, generic Tailwind badge colors) the design system tells them to avoid, and error states are invisible to the user.

## What's Working
- **Flat-by-default respected**: no box-shadows, tonal layering only, 1px borders — matches Elevation rules.
- **Operational Red stays scarce**: red only on `text-primary` icons + destructive/10 badges, honoring the One Voice 10-15% rule.
- **Cash-flow calendar** earns its surface: the 30-day grid + concentration alert is real operational value, not decoration.

## Priority Issues
- **[P1] Hero-metric KPI template dominates petty-cash**: 3 identical big-number cards (Saldo / Umbral / Movimientos) — banned by DESIGN.md Don'ts and the absolute bans.
  - Fix: collapse the 3 cards into a single fund-status surface: one prominent balance, an inline threshold bar (balance % of fund), and movimientos count as a secondary line. Keep one number, demote the rest.
  - Suggested command: `$impeccable distill`

- **[P1] Color system drift off OKLCH tokens**: badges use raw Tailwind `emerald-50/700`, `amber-50/700`, `blue-50/700`, `rose-*` instead of DESIGN.md `success`/`warning`/`info`/`destructive` semantic tokens. Cash-flow chart and calendar grids hardcode `#f43f5e`/`rose-*` and `emerald-*` instead of `chart-1..5`.
  - Fix: replace every hardcoded semantic color with the documented tokens; give charts a defined OKLCH ramp (chart-1..5) for Entradas/Salidas.
  - Suggested command: `$impeccable colorize`

- **[P2] Silent error handling**: cash-flow and expenses `catch (err) { console.error(...) }` swallow fetch failures — the user sees a perpetual spinner or stale empties with no message.
  - Fix: surface an inline error state with a retry affordance; expenses approve should toast on failure (it toasts on success only).
  - Suggested command: `$impeccable harden`

- **[P2] Irreversible Approve, no confirmation/undo**: expenses "Aprobar" commits immediately on click with no confirm and no undo path; approve failure also disappears silently.
  - Fix: add an optimistic confirm or a 5s undo toast; show failure feedback.
  - Suggested command: `$impeccable harden`

## Persona Red Flags

**Alex (Power User)**: Approve is one-at-a-time only — no batch select for pending expenses. No keyboard shortcut to approve. Table has no column sort, no filtering by status/category, no column toggle. The `confirm()` on template delete is a blocking native dialog that breaks flow.

**Sam (Accessibility)**: Status badges carry icons (good — not color-only), but the 10-11px micro-type in calendar labels and validation notes fails low-vision and 200% zoom. Recharts SVG charts have no aria-label/role and are keyboard inaccessible.

**El Dueño de Cadena (project persona — owner overseeing 3-15 branches)**: petty-cash is single-branch only — must pick one sucursal from the dropdown; there is no cross-branch aggregate view of all cajas chicas. Cash-flow projection has no branch selector at all and no "all branches" rollup. This breaks the "single pane of glass across 15 branches" promise — the owner cannot survey liquidity or petty-cash health for the chain in one glance.

## Minor Observations
- `if (!kpis) return null` in KPI cards — blank screen when analytics has no data, no empty state.
- Expenses table headings say "Monto ($)" but formatMXN renders MXN — label/value mismatch.
- Cash-flow calendar legend uses 12px (off ramp); hero copy says "Proyección a 30 días" but chart shows 14 days — slight mismatch.

## Questions to Consider
- Should cash-flow offer an "all branches" rollup the way expenses does, so the owner sees chain liquidity at once?
- Does petty-cash's single-branch focus fight the product's command-center premise? What would a cross-branch treasury view look like?
