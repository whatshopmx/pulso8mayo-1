---
target: app/dashboard/inventory
total_score: 25
p0_count: 2
p1_count: 2
timestamp: 2026-07-25T15-55-32Z
slug: app-dashboard-inventory
---
# Critique: Inventory Dashboard (`app/dashboard/inventory`)

**Method:** dual-agent (A: ses_066059d8bffekq26QjeV7rpnDr · B: CLI detect.mjs)
**CLI scan:** `detect.mjs --json` over `app/dashboard/inventory/` — 6 findings (all advisory)
**Browser visualization:** Unavailable (no browser automation tool in this session)

---

## Anti-Patterns Verdict

**LLM assessment:** This inventory dashboard lands in the "pause" zone. It looks competent at a glance — clean layout, consistent OKLCH colors, logical section ordering — but a closer inspection reveals mock data dressed as real metrics, decorative motion that undermines the system's authority, and several cracks in the design system contract. The overall aesthetic is on-brand (restrained, operational) but the execution has demo-grade artifacts: fabricated sparkline trends, hardcoded percentages, a pulsing red dot for alerts that looks more like a waiting-room vital sign than a command center.

**Deterministic scan** found **6 advisory issues** — all `design-system-font-size` violations of `text-[10px]` outside the documented DESIGN.md type ramp:
- `app/dashboard/inventory/page.tsx` lines 293, 306 — tab badge count labels
- `app/dashboard/inventory/invoices/page.tsx` lines 913, 917 — invoice section
- `app/dashboard/inventory/reports/page.tsx` lines 376, 537 — reports section

The detector caught the font-size issue across 3 files that the LLM review identified in `dashboard-kpis.tsx` but missed in the invoices and reports pages. No false positives — all 6 findings are valid design system violations.

**Visual overlays:** Not available — browser injection was not possible in this session.

---

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3/4 | Pulse animation on alerts signals urgency ambiguously |
| 2 | Match System / Real World | 3/4 | "3-Way Match" is untranslated English jargon for Mexican owners |
| 3 | User Control and Freedom | 3/4 | No undo for product creation; no direct alert→resolution path |
| 4 | Consistency and Standards | 3/4 | Tab badge styling mismatch (Badge variant vs inline classes) |
| 5 | Error Prevention | 2/4 | No unsaved-changes guard on 12-field product dialog; silent supplier fetch failure |
| 6 | Recognition Rather Than Recall | 3/4 | Conditional "Stock Actual" column forces recall of branch selection state |
| 7 | Flexibility and Efficiency | 2/4 | No bulk actions, no CSV/PDF export, no keyboard shortcuts |
| 8 | Aesthetic and Minimalist Design | 3/4 | 8-card equal-weight grid creates visual noise; `text-[10px]` below readable floor |
| 9 | Error Recovery | 2/4 | Toast errors lack recovery actions; dialog form data lost on dismiss |
| 10 | Help and Documentation | 1/4 | No inline help, no tooltips, no onboarding cues; unexplained jargon ("Conteo Ciego") |
| **Total** | | **25/40** | **Good** |

The total of 25/40 — in the "Good" band (20-27 = Acceptable, 28-35 = Good) — reflects a competent but not yet polished interface. It functions, it's organized, but it leaks trust through mock data, inconsistent implementation, and missing guardrails. The Help/Docs (1/4) and Error Recovery (2/4) scores are the heaviest drag.

---

## Overall Impression

This page has the right skeleton. The IA is logical: operations hub → metrics → charts → alerts → inventory table mirrors a manager's mental model. The OKLCH palette is used consistently. But the dashboard reads as a demo, not a production command center. Hardcoded KPI values, fabricated sparkline data, and a pulsing red dot undermine the authority the "Operational Red" brand promises. The single biggest opportunity: **make every number real**. Until the CFO can trust the dashboard's numbers, nothing else matters.

---

## What's Working

1. **Information architecture.** The 6-section flow (header → ops hub → KPIs → charts → alerts → table) maps to how a restaurant manager actually triages their day: "what can I do → how are we doing → what needs my attention → let me see the details."

2. **Consistent OKLCH color system.** Chart colors follow the documented palette, Operational Red is used appropriately in icon backgrounds (primary/10 opacity), semantic colors map correctly (green = success, amber = warning, red = destructive).

3. **State coverage.** Loading spinners, empty states with icon + description, error fallback in the product drawer — all present without being asked for. The foundations of a production system are there.

---

## Priority Issues

### **[P0] Mock data masquerading as real metrics** (`dashboard-kpis.tsx:36-45, 115, 130`)

**What:** `mockValueHistory` generates fabricated sparkline trends from a static `stockValue` constant. `94.2%` and `2.8%` are hardcoded strings, not computed from reconciliation or waste data.  
**Why it matters:** Inventory management is about real money. First time a restaurant owner or CFO sees a fabricated trend, platform trust collapses irrecoverably.  
**Fix:** Remove `mockValueHistory`. Show the sparkline area only when real time-series data exists — otherwise show a skeleton. Derive 3-Way Match and Waste Loss from actual invoice reconciliation and waste batch records.  
**Suggested command:** `/impeccable harden`

### **[P0] Decorative pulsing motion on Critical Alerts** (`dashboard-kpis.tsx:88, 97-99`)

**What:** `animate-ping` (radar-pulse circle) and `animate-pulse` (breathing icon) run continuously when alerts > 0 with no `prefers-reduced-motion` escape.  
**Why it matters:** Absolute product register ban on decorative motion. The pulsing red dot targets already-stressed restaurant operators with manufactured urgency. It triggers anxiety and can cause physical discomfort for users with vestibular disorders.  
**Fix:** Replace the pulse loop with a static colored indicator. If any animation is needed, use a brief CSS transition on count change (0→>0), not a perpetual loop. Add `@media (prefers-reduced-motion: reduce)` suppression.  
**Suggested command:** `/impeccable quieter`

### **[P1] 8-card operations hub with zero priority hierarchy** (`page.tsx:149-245`)

**What:** All 8 navigation cards (Recepción, Transferencias, Merma, Conteo, Órdenes, Facturas, Recetas, Proveedores) get identical visual weight. Recepción Física (daily use) and Recetas & BOM (weekly/monthly) look equally important.  
**Why it matters:** Cognitive load — a manager scanning for "receive today's delivery" competes with 7 equally-visible options. New users face a paradox of choice: 8 destinations, none prioritized.  
**Fix:** Introduce hierarchy. Promote top-3 daily operations (Recepción, Stock Count, Purchase Orders) with larger cards or a featured section. Move lower-frequency items to a secondary row or "Más" menu.  
**Suggested command:** `/impeccable shape`

### **[P1] Product creation dialog discards all data on dismiss** (`page.tsx:415`)

**What:** Accidentally clicking outside, pressing Escape, or hitting the X button silently discards all 12+ form fields with no confirmation.  
**Why it matters:** Highest-effort action on the page with zero safety. A user spending 2-3 minutes filling product details who fat-fingers Escape loses all work. This is a trust-breaking moment — the interface feels fragile.  
**Fix:** Track dirty state (compare form to initial empty values). Show a confirmation: "¿Descartar cambios? Los datos ingresados se perderán." Only Cancel should reset without confirmation.  
**Suggested command:** `/impeccable harden`

### **[P2] Tab badge styling inconsistent** (`page.tsx:293 vs 306`)

**What:** "Bajo Stock" count uses `<Badge variant="destructive">` (design system component). "Por Vencer" count uses inline `border-orange-500 text-orange-600` classes. Same conceptual element, different implementation.  
**Why it matters:** Erodes the design system contract. Future maintainers won't know which pattern to follow.  
**Fix:** Define a `warning` variant on Badge or use `variant="outline"` with a shared semantic class. Apply consistently across all tab badges and QuickAlerts.  
**Suggested command:** `/impeccable distill`

### **[P2] Conditional "Stock Actual" column causes layout reflow** (`page.tsx:343, 353`)

**What:** The Stock Actual column appears/disappears based on `selectedBranchId`, shifting all column widths.  
**Why it matters:** Layout instability is disorienting. Users see columns shift when branch selection changes. The empty state colSpan must also account for the conditional column, making it fragile.  
**Fix:** Always render the Stock Actual column. When no branch is selected, show "—" or "N/A". This stabilizes layout and removes conditional logic from both header and empty state.  
**Suggested command:** `/impeccable harden`

### **[P2] Empty states are dead ends** (`page.tsx:358-362`)

**What:** Empty product table shows "No hay insumos para mostrar en esta pestaña" with no action button — despite `EmptyState` supporting an `action` prop.  
**Why it matters:** A first-time user has no cue for what to do next. The empty state is a wall, not a launch point.  
**Fix:** Pass an action CTA: `<EmptyState ... action={{ label: 'Agregar Producto', onClick: () => setDialogOpen(true) }} />`.  
**Suggested command:** `/impeccable onboard`

### **[P3] Supplier fetch failure silently swallowed** (`page.tsx:58`)

**What:** `.catch(() => {})` discards the supplier API error. The supplier dropdown appears functional but is empty on failure.  
**Why it matters:** User may create a product thinking they skipped the supplier field intentionally, when in fact supplier data was lost to a silent error.  
**Fix:** Show a toast on error, or better: inline message in the supplier select with retry.  
**Suggested command:** `/impeccable harden`

### **[P3] font-size 10px used across 3 inventory files** (detector findings)

**What:** 6 instances of `text-[10px]` in `page.tsx`, `invoices/page.tsx`, and `reports/page.tsx` — all outside the DESIGN.md type ramp (minimum is 12px label).  
**Why it matters:** Tiny text fails WCAG SC 1.4.4 (text resizing), is hard to read at normal zoom, and breaks the design system contract.  
**Fix:** Replace `text-[10px]` with `text-xs` (0.75rem = 12px) from the type ramp, or update the design system to include a smaller step if intentional.  
**Suggested command:** `/impeccable typeset`

---

## Persona Red Flags

**For Alex (Power User):** No bulk selection or batch operations in the product table. No keyboard shortcuts for tabs or new products. No CSV/PDF export. No dashboard customization. Conditional column and client-side-only search mean performance degradation with larger inventories. The 8-card flat nav forces Alex to slow down and scan every time.

**For Jordan (First-Timer):** 8 equally-weighted nav cards with no "start here" signal. "Conteo Ciego" in card description is unexplained industry jargon. Empty states don't teach next steps. Dialog has 12 flat fields with no section groupings or visual milestones. No tooltips anywhere. No inline help.

**For Sam (Accessibility):** `animate-ping`/`animate-pulse` on alerts with no `prefers-reduced-motion` — active vestibular trigger. `text-[10px]` fails minimum text size. Color-only indicators for low stock/alerts without text-label redundancy. `hover:scale` transform on cards may clip content when zoomed.

---

## Minor Observations

- `hover:scale-[1.01]` on 8 ops hub cards causes micro text reflow on hover — subtle but unpolished
- QuickAlerts "Sin alertas" states have no CTA to the full alerts page — a dead end when it could be a launch point
- Product detail drawer renders a full-screen loader inside Sheet content instead of a content skeleton
- `selectedBranchId` checks proliferate — the branch-aware/dumb split is unclear
- Product photo upload sends `photoUrl` via hidden input, but form is controlled state, not a `<form>` element — dead code
- DashboardKpis loading state renders `&nbsp;` in title with a spinner — a proper skeleton would be more polished
- "Stock OK" badge in product drawer uses `variant="secondary"` (gray) — green (success) would be more intuitive

---

## Questions to Consider

1. What is the ONE metric that makes a restaurant manager close this app and walk to the walk-in fridge? Should that be the only thing above the fold?

2. If "3-Way Match" is an English procurement term your Mexican restaurant owners don't say out loud, what phrase do they use when an invoice doesn't match a receipt? Should the dashboard speak that language instead?

3. Does an 8-card operations hub help anyone, or is it a navigation index that should live in the sidebar so the actual dashboard can be the dashboard?

4. What if there were no tabs on the product table — just a smart default sort (stock count ascending) so the things you need to reorder appear first?

5. Is the product creation dialog actually a feature most users need at the dashboard level, or does it belong in a dedicated catalog page?

---

## Cognitive Load Assessment

- [x] **Single focus:** FAIL — 6 content zones compete for attention above the fold
- [x] **Chunking:** FAIL — 8-card ops grid exceeds ≤4 chunking rule
- [ ] **Grouping:** PASS — related items are visually grouped
- [ ] **Visual hierarchy:** PASS — despite some issues, the overall zone flow is clear
- [x] **One thing at a time:** FAIL — everything loads at once with no priority ordering
- [x] **Minimal choices:** FAIL — 8 ops cards, 4 tabs, 4 KPIs, 2 charts, 2 alert lists = information overload
- [ ] **Working memory:** PASS — no cross-screen memory demands
- [x] **Progressive disclosure:** FAIL — no progressive reveal; all content visible simultaneously

**Result:** 4 failures — **High cognitive load**. Critical to address before onboarding new users.
