# Implementation Plan: Finanzas Overview — Top 3 P1 Fixes

## Overview

Address the three P1 issues from the critique of `app/dashboard/finance/page.tsx`
(snapshot: `.impeccable/critique/2026-08-23T04-28-39Z__app-dashboard-finance-page-tsx.md`,
score 33/40):

1. Nine undifferentiated subsection link cards (cognitive-load failures: chunking,
   choices, working memory).
2. The page's 4-question narrative ("¿cómo vamos → qué necesita mi firma →
   me alcanza → dónde gano") is invisible — hierarchy is order-only.
3. P&L table density violates DESIGN.md's own anti-reference (9 columns ×
   `text-xs`, icon-only confidence badges).

Scope agreed with user: **Top 3 only**. P2s (red discipline, sort/overflow)
are deferred to a later pass.

## Architecture Decisions

- **Grouping over disclosure for the link grid.** Three labeled groups
  (Captura diaria / Dinero y pagos / Configuración) preserve all nine
  destinations at equal discoverability while cutting the decision point from
  9 to 3. A "more tools" disclosure was rejected because it hides
  destinations the owner needs weekly (e.g., Caja Chica) and adds a click.
- **Escalation via tonal layering, not new components.** The attention panel's
  urgent state uses a destructive-toned header band (`bg-destructive/5` +
  border tint), consistent with the Flat-By-Default Rule. No shadows, no
  accent stripes, no new primitives.
- **Section kickers are muted labels, not eyebrows-on-every-section.**
  DESIGN.md bans tracked uppercase eyebrow text as a default pattern. The
  four questions become small muted headings (`text-sm text-muted-foreground`)
  that group cards into narrative chapters — one deliberate voice, not decoration.
- **P&L distillation keeps every data point reachable, none invisible.**
  Merma moves from a column to a per-cell tooltip (the row already has the
  NoteTip infrastructure); confidence badges collapse to a color dot + sr-only
  text; margin % becomes the promoted column with utilidad $ demoted to
  secondary line in the same cell. Provenance system (†/*/≈/—/footnotes) is
  untouched — it is the product's signature.

## Task List

### Phase 1: Composition (page.tsx)

- [ ] Task 1: Cluster SUBSECTIONS into three labeled groups
- [ ] Task 2: Make the 4-question narrative visible (kickers + escalated attention header)

### Checkpoint: Composition
- [ ] `pnpm run build` passes, `pnpm run lint` clean
- [ ] Page reads top-down as: KPIs → firma → tesorería → P&L, with each
      chapter visually distinct and the link grid scannable in 3 groups

### Phase 2: Density (pnl-branch-table.tsx)

- [ ] Task 3: Distill P&L table to ≤7 columns with promoted margin

### Checkpoint: Complete
- [ ] All acceptance criteria met
- [ ] Re-run `$impeccable critique` — target ≥35/40
- [ ] Final `$impeccable polish` pass

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Grouping mislabels a destination (e.g., Objetivos de Costo is config but semantically ties to KPIs) | Med | Keep group names descriptive not taxonomic; verify each href lands logically under its label |
| Removing Merma column loses at-a-glance waste comparison across branches | Med | Merma stays in tooltip per cell AND remains in TOTAL GRUPO row context via food-cost %; if owner pushback occurs, restore column before adding others |
| Escalated destructive header fires too often (normal MEDIUM days read as alarm) | High | Escalate only when `highCount > 0`; MEDIUM-only days keep current neutral styling |
| Confidence dot drops information for color-blind users | Med | Dot pairs with sr-only text ("Medido"/"Aproximado") and existing tooltip; shape+text, never color alone |

## Open Questions

- None blocking. If Task 3 review shows owners miss absolute Utilidad $,
  promote margin % + utilidad as stacked dual-line cell (already the plan's
  fallback) rather than re-adding a column.

## Parallelization

Tasks 1 and 2 both touch `page.tsx` (different regions) — run sequentially in
one session or two. Task 3 touches an independent file and could parallelize
with Task 1, but sequential keeps verification checkpoints clean.
