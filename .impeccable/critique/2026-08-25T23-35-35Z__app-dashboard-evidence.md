---
target: app/dashboard/evidence/
total_score: 18
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
timestamp: 2026-08-25T23-35-35Z
slug: app-dashboard-evidence
---
# Critique — Galería de Evidencias (`app/dashboard/evidence/page.tsx`)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Full-grid spinner on every keystroke (no debounce); no result count; no feedback that stats reflect active filters |
| 2 | Match System / Real World | 2 | Raw enums "PHOTO/VIDEO/AUDIO/TEXT" shown in an otherwise Spanish UI |
| 3 | User Control and Freedom | 2 | No pagination or load-more; "Descargar" button in dialog is dead (no handler) |
| 4 | Consistency and Standards | 2 | Tailwind stock palette (blue/purple/orange/green-500) instead of Pulso OKLCH tokens; `hover:shadow-lg` violates the Flat-By-Default Rule |
| 5 | Error Prevention | 2 | No `dateFrom ≤ dateTo` guard; no AbortController on search → stale responses can overwrite fresh ones |
| 6 | Recognition Rather Than Recall | 2 | VIDEO/AUDIO/TEXT thumbnails are bare icons — zero preview info; must open each to know contents |
| 7 | Flexibility and Efficiency | 1 | No bulk actions, no sorting, no keyboard accelerators; reviewing 50 evidences = 50 dialog round-trips |
| 8 | Aesthetic and Minimalist Design | 2 | Five stat cards (the banned hero-metric template) occupy prime space above the actual evidence |
| 9 | Error Recovery | 2 | Generic toast "Error al cargar evidencias" with no retry; no fallback UI for broken images |
| 10 | Help and Documentation | 1 | "Verificación AI"/score semantics never explained anywhere |
| **Total** | | **18/40** | **Poor — major UX overhaul required before this earns the "command center" brief** |

## Design Specificity Verdict

**Category-interchangeable.** Strip the Spanish copy and this page could ship unchanged inside any admin SaaS. It violates three named rules from the project's own DESIGN.md:

1. **Flat-By-Default Rule** — grid cards use `hover:shadow-lg transition-shadow`; shadows on cards are explicitly banned (tonal layering only).
2. **Hero-metric ban** — the 5-card stat row (big number + small label) is called out verbatim as a forbidden default layout.
3. **Token discipline** — every semantic color is Tailwind stock (`bg-blue-100 text-blue-800`, `text-orange-600`, `bg-green-500`), not the warm OKLCH palette (info/warning/success/destructive). The warm-neutral neutrals and Operational Red system never appear.

Missed product character: `branchName` travels in the payload but is invisible until the detail dialog — on a platform whose stated primary user is an owner overseeing 3–15 branches, evidence is shown branch-less.

**Deterministic scan:** `detect.mjs --json` returned `[]` (0 findings, exit 0). The detector's rule set (gradients, glassmorphism, eyebrow abuse, numbered markers, etc.) simply doesn't cover this file's failure modes — palette drift, banned layout templates, dead controls. Zero detector findings here is *not* evidence of health; the LLM review caught everything material. No false positives to report (nothing was flagged).

**Visual overlays:** Not available — browser automation failed at wrapper level this session (see Run Notes), so no user-visible overlay exists. Fallback signal: source-level review only.

## Overall Impression

Structurally sound scaffolding — sensible IA (header → stats → filters → gallery → detail dialog), working filters, bilingual dates via `date-fns/es`. But execution betrays the brand at every layer: stock-palette colors, a banned stat-card row, shadows on a flat-by-default system, and a primary interaction (open evidence) that is inaccessible to keyboard and screen-reader users. Worst of all for an *audit* product, the page ships dead controls and racy fetching — trust bugs, not just style bugs. Biggest opportunity: rebuild the gallery around the branch dimension and AI-verification status (the two things only Pulso has), on the project's own token system.

## What's Working

1. **Filter architecture.** Server-side filtering via query params, a visible "Limpiar filtros" affordance that appears only when filters are active, and an empty state that names the cause ("con los filtros seleccionados") — correct model, correctly communicated.
2. **Dialog detail composition.** Media-first layout with a tidy 2×2 metadata grid (asignado a / sucursal / fecha / verificación) plus the AI reason callout — the right information, roughly in the right order, with Spanish long-form dates.
3. **Grid/list duality.** Two genuine view modes (not a stub): grid for visual scanning, list for dense scanning with full assignee names and years. Both preserve the same data contract.

## Priority Issues

### [P0] Primary action is keyboard- and screen-reader-inaccessible
- **Why it matters:** Evidence cards and list rows are `<div onClick>` — no `role`, no `tabIndex`, no Enter/Space handling, no focus ring. A keyboard-only or AT user **cannot open a single piece of evidence**. Filter `<label>`s aren't associated with their inputs (no `htmlFor`/`id`). The list-view Eye button is icon-only with no `aria-label`.
- **Fix:** Render cards/rows as `<button>` (or `role="button"` + key handlers); wire `htmlFor`/`id` on all filter labels; add `aria-label="Ver evidencia"` to the Eye button.
- **Suggested command:** `$impeccable harden`

### [P1] Off-brand visual world — stock Tailwind palette, banned shadows, banned stat-row
- **Why it matters:** The page reads as generic admin, directly contradicting the anti-reference "Not generic SaaS." Three named DESIGN.md rules are violated (see verdict).
- **Fix:** Map PHOTO→info, AUDIO→accent/warning, TEXT→muted, verification→success token; delete `hover:shadow-lg` (use border/background tonal shift); collapse the 5 stat cards into one compact summary strip (e.g., inline counts beside the header).
- **Suggested command:** `$impeccable colorize` (re-tokenize) + `$impeccable quieter` (demote the stat row)

### [P1] Trust bugs in an audit surface: dead controls, wrong field, racy search
- **Why it matters:** "Descargar" (dialog) and the Eye button (list) have no handlers — promises without delivery. TEXT evidence renders `selectedEvidence.url` as its *content*, which is almost certainly the storage key, not the text. Search fires a fetch per keystroke with no debounce and no AbortController, so out-of-order responses can silently show the wrong result set — fatal credibility for a compliance tool.
- **Fix:** Implement download (`<a download>` to the R2/local URL); wire or remove Eye; bind TEXT evidence to its content field; debounce 300 ms + `AbortController` on `fetchEvidences`; add pagination (or infinite scroll) with a total count.
- **Suggested command:** `$impeccable harden`

### [P1] Missing branch dimension
- **Why it matters:** The primary persona (owner of 3–15 branches) asks "which branch is behind on evidence?" — the page can't answer it. `branchName` exists in the payload but appears nowhere in cards, list rows, or filters.
- **Fix:** Add a "Sucursal" filter (needs API support), show branch as a caption on cards and a column in list view, and offer group-by-branch in list mode. Make recency sort explicit.
- **Suggested command:** `$impeccable shape` (IA decision), then implement

### [P2] Language and labeling drift
- **Why it matters:** Raw enum values ("PHOTO", "AUDIO") leak into an otherwise careful Spanish UI. Initials derive as `name.split(" ").map(n => n[0]).join("").slice(0, 2)` — "María De La O" → "MDLO"→"MD", but "Ana" → "A"; inconsistent and occasionally meaningless. The green "AI" badge is cryptic; stats give no hint they reflect active filters.
- **Fix:** Label map (Foto/Video/Audio/Texto); take initials of the first two words only; rename badge to "Verificada por IA" (or tooltip); either label the strip "de N filtradas" or compute stats server-side pre-filter.
- **Suggested command:** `$impeccable clarify`

## Persona Red Flags

**Alex (Impatient Power User)** — ops manager reviewing evidence daily:
- Typing "limpieza" fires 8 sequential fetches; with no abort, results can arrive out of order. Alex loses trust in minute one.
- No keyboard path to open evidence, no bulk verify/download, no sort control. 50-item review = 50 clicks minimum.
- View-mode buttons are full `Button`s in the header — heavy for a toggle he hits constantly.

**Sam (Accessibility-Dependent User)**:
- Cannot open any evidence via keyboard (P0 above). Focus never becomes visible because nothing is focusable.
- Verification state is color-first (green badge); type is color-first (blue/purple/orange chips). Screen reader gets "PHOTO" but not "verified."
- Unlabeled date inputs announced as bare edit fields.

**Mauricio — Multi-Branch Owner** *(project persona, from PRODUCT.md)*:
- Cannot filter or compare by sucursal — his #1 question goes unanswered.
- Stats row tells him counts of *what was fetched*, not how branches differ. No drill-down path from number → branch → evidence.
- WhatsApp-originated evidence (a core Pulso differentiator) isn't surfaced or distinguished here at all.

## Minor Observations

- `h1` lacks `tracking-tight`, unlike sibling dashboard pages (`Incidentes`, `Equipo y Permisos`) — small consistency drift.
- Loading spinner swaps the whole grid → layout jump; a skeleton grid would hold position.
- Empty state could embed a "Limpiar filtros" button instead of making users scroll up.
- `next/image` with external R2 URLs requires `remotePatterns` config — verify or evidence photos 500 at runtime.
- Audio player sits inside an `aspect-video` muted box — awkward dead space; give audio its own compact row layout.
- No result count anywhere ("128 evidencias · filtros activos").
- `aiScore` displays only in dialog and only when truthy — a 0-score (failed verification) renders as if absent.

## Questions to Consider

- What if the gallery led with *exceptions* — pending/failed verifications and missing evidence — instead of a raw count wall? That's the compliance-byproduct principle made visible.
- What would this page look like designed around branches first: a strip of 15 branch chips where each chip carries its own verification ratio?
- Does "Verificación AI" deserve richer treatment — score bars, reason excerpts inline on cards — given it's Pulso's sharpest differentiator versus paper checklists?
- If WhatsApp is the field terminal, shouldn't evidence originating from WhatsApp carry a visible channel mark here, in the command center?
