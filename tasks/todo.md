# Todo: Finanzas Overview — Top 3 P1 Fixes

## Task 1: Cluster SUBSECTIONS into three labeled groups

**Description:** Replace the flat nine-card grid at the bottom of
`app/dashboard/finance/page.tsx` with three labeled groups so the decision
point drops from 9 simultaneous choices to 3. Grouping:
- **Captura diaria** — Cortes de Ventas, Gastos Operativos, Caja Chica
- **Dinero y pagos** — Cuentas por Pagar, Contrapartes, Flujo de Efectivo
- **Control y configuración** — Control Interno, Fiscal y Facturación, Objetivos de Costo

**Acceptance criteria:**
- [ ] Grid renders 3 group headings (`text-sm font-semibold text-muted-foreground`) each above its own `grid` of cards
- [ ] All 9 existing hrefs/titles/descriptions/icons preserved verbatim (no copy changes)
- [ ] Each group ≤3 cards; card markup unchanged (icon tile + title + description)
- [ ] Focus-visible ring behavior on links preserved

**Verification:**
- [ ] Build succeeds: `pnpm run build`
- [ ] Lint passes: `pnpm run lint`
- [ ] Manual check: all nine links navigate correctly; groups read as three chunks, not a wall

**Dependencies:** None

**Files likely touched:**
- `app/dashboard/finance/page.tsx`

**Estimated scope:** Small: 1 file

## Task 2: Make the 4-question narrative visible

**Description:** The page composes four components in a deliberate narrative
order that exists only in code comments. Add small muted section labels before
each chapter (¿Cómo vamos / Qué necesita tu firma / ¿Me alcanza? / Dónde gano
y dónde pierdo), and escalate the MoneyAttentionPanel header to a
destructive-toned band when `highCount > 0` so priority is legible at scan
distance.

**Acceptance criteria:**
- [ ] Four muted section labels present between page header and cards; NOT uppercase-tracked eyebrows; no new color usage beyond `text-muted-foreground`
- [ ] MoneyAttentionPanel computes `highCount` from items; when >0, CardHeader shows destructive tonal treatment (`bg-destructive/5`, border tint, ShieldAlert or count chip) — no shadows, no border-left stripes
- [ ] When highCount = 0, panel styling unchanged from today
- [ ] Existing loading/error/empty states untouched

**Verification:**
- [ ] Build succeeds: `pnpm run build`
- [ ] Manual check: page top-down reads as four answered questions; attention panel visibly outranks cash-flow card when HIGH items exist
- [ ] Manual check: empty-state day renders exactly as before (no red)

**Dependencies:** Task 1 (same file, sequential edits avoid conflicts)

**Files likely touched:**
- `app/dashboard/finance/page.tsx`
- `components/finance/money-attention-panel.tsx`

**Estimated scope:** Medium: 2 files

## Checkpoint: Composition
- [ ] `pnpm run build` && `pnpm run lint` clean
- [ ] Dev server visual pass: narrative legible, groups scannable, no regression in states

## Task 3: Distill P&L table to ≤7 columns with promoted margin

**Description:** Reduce the P&L branch table from 9 columns to ≤7 by removing
the Merma column (value moves into the food-cost cell's NoteTip) and the
Confianza badge column (replaced by a colored dot + sr-only text next to the
branch name, tooltip preserved). Promote Margen % as the emphasized column;
stack Utilidad $ as secondary line beneath it.

**Acceptance criteria:**
- [ ] Column count reduced from 9 to ≤7 (TOTAL GRUPO and branch rows consistent)
- [ ] Merma value accessible via NoteTip on the Food Cost % cell for every row incl. totals; NO_DATA merma still renders "—" semantics in tooltip ("Sin datos capturados")
- [ ] Confidence dot: success-colored when measured, warning when approximate, with sr-only "Medido"/"Aproximado" and existing tooltip content preserved
- [ ] Margen % column visually promoted (font-bold); Utilidad $ stacked as secondary `text-xs` line under margin in same cell, keeping ≈ marker, NO_DATA "—", and success/destructive tinting
- [ ] Provenance markers (†/*/≈), footnotes, warning banner, search/filter/pagination all unchanged
- [ ] No horizontal scroll needed at 1280px viewport with long branch names

**Verification:**
- [ ] Build succeeds: `pnpm run build`
- [ ] Lint passes: `pnpm run lint`
- [ ] Manual check: tooltips carry merma + confidence info; screen-reader text announces confidence; footnotes still explain †/*/—
- [ ] Manual check: TOTAL GRUPO math unchanged (merma still summed where lineHasData)

**Dependencies:** None (independent file; scheduled after composition phase for clean checkpoints)

**Files likely touched:**
- `components/finance/pnl-branch-table.tsx`

**Estimated scope:** Small-Medium: 1 file

## Checkpoint: Complete
- [ ] All acceptance criteria met across Tasks 1–3
- [ ] `pnpm run build`, `pnpm run lint` clean
- [ ] Re-run `$impeccable critique app/dashboard/finance` — target ≥35/40 (baseline 33)
- [ ] Final `$impeccable polish` pass before close-out
