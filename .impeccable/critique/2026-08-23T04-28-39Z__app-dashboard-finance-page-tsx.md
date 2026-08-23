---
target: app/dashboard/finance
total_score: 33
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-08-23T04-28-39Z
slug: app-dashboard-finance-page-tsx
---
# Critique — Finanzas overview (app/dashboard/finance/page.tsx)

Method: dual-agent (A: design review, B: detector scan). Detector: 0 findings across 5 files (scanner functionality verified against synthetic violations). Browser evidence skipped: dev server not running.

## Design Health Score: 33/40 (Good)

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Four independent fetches assemble page in jumps; no skeletons/stable layout |
| 2 | Match System / Real World | 4 | Solid — arqueo, merma, CFDI, es-MX voice |
| 3 | User Control and Freedom | 3 | Reintentar everywhere; En Rojo toggle changes meaning not state |
| 4 | Consistency and Standards | 3 | Provenance vocabulary shared; raw button pagination |
| 5 | Error Prevention | 4 | NO_DATA renders as em-dash never zero; refuses to sum unmeasured lines |
| 6 | Recognition Rather Than Recall | 3 | 4-question narrative only in comments |
| 7 | Flexibility and Efficiency | 3 | No column sort on P&L |
| 8 | Aesthetic and Minimalist Design | 2 | 9-column text-xs dense table violates DESIGN.md anti-reference |
| 9 | Error Recovery | 4 | Specific errors per card, EmptyState with retry |
| 10 | Help and Documentation | 4 | Exemplary tooltips defining what margin is NOT |

na_heuristics: none. Cognitive load: 4/8 failures (chunking, hierarchy, choices, working memory).

## Design Specificity Verdict
Authored, not generic. Could not be transplanted: arqueo de caja, timbrado de nomina, merma as P&L line, MXN, es-MX, accountant-addressed footnotes.

## Strengths
1. Provenance system (MEASURED/DERIVED/SECTOR_DEFAULT/NO_DATA, daggers/asterisks/approx, tooltips, honest refusal to sum unmeasured).
2. MoneyAttentionPanel consolidation with aging policy encoded visually (>48h -> HIGH).
3. FinancialKpiCards semaphore bars: target tick, scaleX animation with motion-reduce, DeltaBadge noise floor.

## Priority Issues
1. [P1] Nine undifferentiated SUBSECTIONS cards — fails chunking/choices/working memory; page ends on gray sitemap. Fix: cluster into <=3 labeled groups or promote top targets + collapse rest. Cmd: $impeccable shape
2. [P1] 4-question narrative invisible — all cards identical anatomy. Fix: escalate MoneyAttentionPanel header when highCount>0 (tonal band), muted section kickers. Cmd: $impeccable layout
3. [P1] P&L density violates anti-reference (9 cols, text-xs, icon-only badges). Fix: cut columns (Merma to tooltip), promote margin %, dot+sr-only confidence. Cmd: $impeccable distill
4. [P2] Decorative red dilutes One Voice Rule (~14 red glyphs). Fix: mute non-status icons to muted-foreground. Cmd: $impeccable colorize
5. [P2] No sort + long-name overflow in P&L. Fix: sortable sales/margin columns, max-w-[16ch] truncate + tooltip. Cmd: $impeccable polish

## Persona Red Flags
- Alex (power user): no sorting on densest component; four sequential spinners; 9-card hunt for repeat nav.
- Sam (a11y): title-only DeltaBadge info; no caption/scope on 9-col table; En Rojo state announced nowhere; 12px floor with low-contrast xs metadata.
- Contador externo (project persona): no CSV/export on P&L, period in fine print, no printable provenance legend.

## Minor Observations
Italic Geist at 12px marginal; cash-flow grid wraps 3rd stat alone on tablet; formatMXN duplicates formatCents; attention panel double truncation hides branch; total sales number lacks provenance treatment.

## Questions to Consider
- Should the happy path collapse to one reassuring strip?
- Why does the biggest number have no provenance treatment?
- Do the 9 links belong where the related numbers live?
