---
target: dashboard/company/operating-config
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 5
timestamp: 2026-11-25T16-33-09Z
slug: app-dashboard-company-operating-config-page-tsx
---
# Critique — Modelo Operativo del Grupo (`app/dashboard/company/operating-config`)

Method: dual-agent (A: general/design-review · B: general/detector+browser)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Dirty/saved bar and per-field server errors are strong, but a successful save refetches and collapses the page to the skeleton, losing scroll position. |
| 2 | Match System / Real World | 3 | Excellent HORECA vocabulary (comisariato, merma, cortesías, MXN, LFT art. 516) undercut by engineering words: "Descriptiva", "snapshot", "fraccionamiento", and a literal `MIXED —` enum in a Spanish UI. |
| 3 | User Control and Freedom | 2 | "Descartar cambios" exists, but presets overwrite 7 selections with no confirm/undo and there is no route-leave guard (`beforeunload` absent). |
| 4 | Consistency and Standards | 2 | Five differently-scoped save buttons; `text-base` vs `text-lg` card titles; two toast systems (useToast + sonner); Title Case vs sentence case in adjacent toasts. |
| 5 | Error Prevention | 2 | Cost-pair invariants are well enforced, but nothing prevents `managerAuthLimit` from exceeding `doubleApprovalThreshold`; the authorization ladder can be inverted and saved. |
| 6 | Recognition Rather Than Recall | 3 | Units, hints and "what reads this" prose are in place, but no composed view answers "who can approve $8,000?" — the user must hold 5 settings in working memory. |
| 7 | Flexibility and Efficiency | 2 | Presets only touch the 7 inert dimensions; no ⌘S, no section jump-links on a ~6,000px page, no effective-policy preview, no bulk edit. |
| 8 | Aesthetic and Minimalist Design | 2 | Flat and correct per DESIGN.md, but the same classification definition is printed three times and every field carries a 3–4 line paragraph. |
| 9 | Recognize / Diagnose / Recover from Errors | 3 | Server field errors map to the exact input with `aria-invalid`/`aria-describedby`; load failure offers retry and refuses fake defaults. Deduct: blocked save marks no field. |
| 10 | Help and Documentation | 3 | Extraordinary in-place documentation of consumers, empty states and legal basis — but it documents the implementation, not the decision. |

**Total: 25/40 — Acceptable.** A thoughtful, above-median Operate screen whose ceiling is set by scope (one page, five save models) rather than by craft.

## Design Specificity Verdict

**Authored vocabulary, generic composition.** The content could not survive find-and-replace into Jira; the skeleton could.

Genuinely product-specific:
- HORECA-native presets ("Corporativo Centralizado / Franquicia con Comisariato / Operación Descentralizada") and dimensions (`COCINA_CENTRAL`, `POR_RAZON_SOCIAL`, `CONSOLIDADA`).
- Domain instruments: Food Cost / Labor Cost / Prime Margin with per-metric inverted green zones, "Tope Mensual de Cortesías y Consumo de Personal", "ISN estatal", merma variance.
- Contractual empty states: `null` ≠ `0` ≠ default, stated in words ("Cero deshabilita la caja chica; vacío permite abrir sin tope de grupo").
- Legal specificity: LFT art. 516 / LSS art. 280-B cited inline in payroll settings.

Category-generic:
- Page composition is the default settings archetype: h1 + subtitle + five stacked bordered cards + sticky save bar.
- Organized around database columns (`tenant_operating_config`) rather than the owner's decisions, which is why inert dimensions and applied thresholds share one visual register.
- The UI narrates its own engineering status ("Descriptiva", "Pendiente de decisión", "Ningún servicio lo lee hoy") — authored for the team, not the owner.

**Deterministic scan:** `detect.mjs --json` over the page + `components/company` returned exit 0 / `[]` — **zero findings, but this is a false negative, not a clean bill.** The detector is regex-based on non-HTML TSX and has no rule for raw Tailwind palette classes, which the surface uses in 10 places (`bg-amber-500/80`, `bg-emerald-500/80`, `text-emerald-600`, `border-amber-500/40`). Browser overlay was skipped: no dev server and the route is auth-gated (`app/dashboard/*` needs a better-auth session + tenant), so no reliable user-visible overlay exists for this run.

## Overall Impression

The trust engineering is genuinely excellent — refusing to mount the form after a failed load, preserving `null` vs `0`, mapping server errors back to inputs. But the page is organized around the schema instead of the owner's decisions, and it leads with 21 options that openly declare they change nothing. The single biggest opportunity: turn this from a database editor into a policy console that shows the *resulting* authorization model.

## What's Working

1. **Three-state load contract.** A failed GET never mounts the form, so defaults can't be saved over a real row (`page.tsx:15-25`, `:71-98`). Rare and exactly right for a financial surface.
2. **`null` vs `0` vs default is modeled end-to-end.** `centavosAPesos` / `pesosACentavos` preserve a stored zero and treat only empty as "no cap" (`lib/company/operating-config-values.ts:121-137`), and the UI states the consequence in words.
3. **Inversion-aware cost gauges.** Green/amber/red flip direction per metric and the pair invariant is explained, not just rejected (`cost-targets-section.tsx:48-97`, `:225-267`). It teaches the domain rule.

## Priority Issues

### P0 — Five save scopes on one page, one bar claiming all of them
`page.tsx:92-96` stacks the config form plus three independent editors. The sticky bar says "Guarda para aplicar las nuevas políticas al grupo" (`operating-config-sticky-bar.tsx:43`), while the approval matrix ("Guardar matriz de compras"), the request/emit delegation rules (2 buttons) and the commission rates ("Guardar") are outside that `<form>` and still unsaved. An owner who edits a delegation rule and then hits the prominent red "Guardar Configuración" believes group policy was applied.
**Why it matters:** silent state divergence in an authorization system.
**Fix:** scope the bar copy to "Guardar umbrales y parámetros"; add per-section dirty indicators; surface a page-level "3 secciones con cambios sin guardar" summary, or move the editors to their own routes.
**Command:** `/impeccable layout`

### P1 — No cross-field validation between the two authorization thresholds
`operating-config-form.tsx:122-127` validates only the three cost-percentage pairs. Nothing stops `managerAuthLimit` (line 94) from exceeding `doubleApprovalThreshold` (line 132). With `ALTA` autonomy a manager can approve up to the owner threshold, so an inverted ladder silently grants authority the owner reserved.
**Fix:** add a third pair validation with the same visual language as the cost pairs, an inline `role="alert"` under the offending field, and a blocking `disabledMessage` that names it.
**Command:** `/impeccable harden`

### P1 — A successful save destroys the user's place on the page
`operating-config-form.tsx:198` calls `onSuccess`, `page.tsx:93` wires it to `cargar()`, which sets `loading=true` (`page.tsx:35`) — the form unmounts, the page collapses to `OperatingConfigSkeleton`, scroll is lost. The reward for saving a field near the bottom is being teleported to the top with a flash.
**Fix:** revalidate silently, keep the form mounted, re-baseline `initialConfig` without a loading state, show a persistent "Guardado · hace un momento".
**Command:** `/impeccable optimize`

### P1 — Save can be blocked with no field marked
`camposInvalidos` returns DB column names (`lib/company/operating-config-values.ts:281-286`), rendered only as a count in `disabledMessage` (`operating-config-form.tsx:242-247`). The offending input gets no `aria-invalid`, no inline message, no focus. Reachable by clearing a required cost target (`:245` returns `NaN`).
**Fix:** produce a per-field invalid map (mirror `UMBRAL_POR_CAMPO`), set `aria-invalid` + inline `role="alert"`, focus and scroll to the first invalid input on attempted save.
**Command:** `/impeccable harden`

### P1 — Descriptive dimensions lead the page, and their explanation is printed three times
The first card is 21 option cards that declare they change nothing (`operating-dimensions-section.tsx:294-297`), and the same three definitions appear as a legend (`:298-309`), a badge (`:346`) and a paragraph (`:349-351`) for each of 7 fields. It is the first impression, the largest effort block, and the most off-brand moment (PRODUCT.md: "confidence without bureaucracy").
**Fix:** invert the order — applied thresholds and cost targets first, descriptive dimensions last and collapsed behind "Documentar el modelo operativo del grupo". Keep one legend; drop per-field repetition to a single badge.
**Command:** `/impeccable distill`

### P2 — The sticky bar breaks the design system it lives in
`operating-config-sticky-bar.tsx:26` uses `backdrop-blur-md shadow-lg` + `ring-1 ring-primary/20` and an infinite `animate-ping` dot (`:35-38`). DESIGN.md is explicit: flat by default, no shadows on containers, no glassmorphism as a default pattern.
**Fix:** flat `bg-card` with a 1px top border and a tonal step; static dot or one-shot pulse; ring only in the dirty state.
**Command:** `/impeccable polish`

## Persona Red Flags

**Alex (power user).** No ⌘S/Ctrl+S; no section navigation on a ~6,000px page; presets don't touch thresholds/cost/fiscal, so "1 Clic" saves nothing he cares about; no effective-policy preview; `1000.50` rounds to `1000.5` and string-compare `isDirty` can read as dirty.

**Sam (screen reader / keyboard).** Card titles are `<div>`s (`components/ui/card.tsx:31`), so most cards emit no heading and the outline jumps h1 → h3/h4; `role="progressbar"` has no `aria-valuenow/min/max`; zone boundaries are `title`-only and color-only; the disabled save button is unfocusable while its blocking reason is conditionally rendered; both rule editors use `<fieldset>` without `<legend>`; `animate-ping` dies under reduced motion (globals.css:220-237), so the unsaved cue becomes a static dot.

**Marisol (owner, 15 branches, desktop + tablet).** Lands on 1,200px of declarations that don't matter; no "what changed since last time" or who set it; no blast-radius framing next to the money inputs; the thing she came for (thresholds) is card 3 of 5; inputs are 36px, `sm` buttons 32px, switches 20px — below 44px on the device she actually uses.

## Minor Observations

- Presets block is a bare `<div>` with `p-4` vs cards' `py-6 px-6` — different padding rhythm at the top of the page.
- `Sparkles` + "1 Clic" frames deterministic templates as AI magic; "1 Clic" should be "1 clic".
- Toast copy mixes Title Case and sentence case across the surface.
- `payrollPracticeMode` round-trips through two representations ("" ↔ "FORMAL") and the select placeholder doubles as an option label.
- The permanent amber legal-citation block becomes wallpaper on a screen with no other warnings.
- `ErrorDeCampo` uses `role="alert"` per field; a 5-field submit fires 5 alerts plus a toast.
- `max-w-md` on only the last threshold input creates an unlabeled asymmetry.
- `isWide` derives layout from `options.length === 2` rather than label length.
- The gauge disappears entirely when a pair is invalid, removing the reference exactly when it's needed.
- Money inputs use `step` 100/500/1000 inconsistently, implying precision the field doesn't enforce.
- Double padding: page `py-6` inside a wrapper already providing `p-4 pt-0`.
- Skeleton geometry (6 dimension blocks, 4 threshold cells, no gauge rows) doesn't match the real layout, producing a second layout shift.

## Questions to Consider

1. If 5 of 7 structural dimensions change nothing today, why are they the first 1,200 pixels an owner sees — and what would this page look like with the applied thresholds on top and a read-only "modelo declarado" summary at the bottom?
2. What stops Marisol from changing the manager limit from $1,000 to $100,000 by accident? Right now the answer is a toast that says "Configuración Actualizada."
3. If this screen were organized around her decisions — who can spend what, where the money lands, what counts as waste — how many of these five cards would survive, and how many of the five save buttons would collapse into one?
