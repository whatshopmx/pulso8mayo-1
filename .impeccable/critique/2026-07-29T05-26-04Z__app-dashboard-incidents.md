---
target: app/dashboard/incidents
total_score: 16
p0_count: 2
p1_count: 2
timestamp: 2026-07-29T05-26-04Z
slug: app-dashboard-incidents
---
# Critique: app/dashboard/incidents

Method: dual-agent (A: ses_053afc59effeM8Rzc6N5Dr9b0t · B: ses_053af6322ffeE0DOOmeUBTB4YH)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Summary strip + status badges decent; timeline steps have no timestamps; wizard "Validating..." has no progress detail; pagination forces full `window.location` reload (incident-list.tsx:398-401) |
| 2 | Match System / Real World | 1 | FATAL vs CRITICAL never distinguished; workflow UUID gets its own card ([id]/page.tsx:315-325); timeline jargon ("regla de lógica en workflow"); ungrammatical "Incidente Detección" (incident-timeline.tsx:28); English wizard in a Spanish product |
| 3 | User Control and Freedom | 2 | Only one action exists: Resolve. No escalate, reassign, defer, or un-resolve |
| 4 | Consistency and Standards | 1 | AlertCircle = FATAL in incident-list.tsx:67 but = CRITICAL in critical-incidents-list.tsx:32; widget has no FATAL case; UPPERCASE vs sentence-case badges; tokens vs hardcoded palette |
| 5 | Error Prevention | 2 | Resolution note required (good), but a CRITICAL food-safety incident can be resolved from the list with one line, bypassing the entire remediation protocol |
| 6 | Recognition Rather Than Recall | 2 | Sort buttons show no direction state and no aria-sort (incident-list.tsx:209-217); truncated UUID communicates nothing |
| 7 | Flexibility and Efficiency | 1 | No keyboard shortcuts, no bulk actions, filters not deep-linkable, search only scans current 50-row page (incident-list.tsx:181-192) |
| 8 | Aesthetic and Minimalist Design | 2 | Mostly clean and flat; redundant dual badges per row, 4 identical metadata cards, UUID card is noise |
| 9 | Error Recovery | 2 | Detail page has a real error state with Reintentar ([id]/page.tsx:209-224); list has NO error state; resolve failures are generic "Error {status}" toasts |
| 10 | Help and Documentation | 1 | No explanation of severity taxonomy, statuses, or NOM-251 context anywhere |
| **Total** | | **16/40** | **Poor — major UX overhaul required** |

## Anti-Patterns Verdict

**LLM assessment:** AT RISK. The bones are good (flat cards, inline summary strip, skeletons), but three betrayals: (1) the committed OKLCH token system is bypassed almost everywhere — hardcoded `text-amber-500`, `text-emerald-500`, `bg-blue-500/10 text-blue-700`, `text-indigo-500`, `text-orange-500`, `bg-orange-100 text-orange-700`, `text-green-600` across all five component files while `--warning/--success/--info` tokens sit unused; (2) the highest-stakes component, RemediationWizard, is entirely in English inside a Spanish product, plus a 📸 emoji (remediation-wizard.tsx:161); (3) engineer-slop data as UI — a truncated workflow UUID gets its own metadata card. One Voice Rule FAILS: red is simultaneously CRITICAL severity, FATAL severity, DETECTED status, and destructive actions — a list of new criticals renders 20 red badges per screen, so red means nothing. Identical-card-grid ban FAILS on [id]/page.tsx:264-327 (4-up identical metadata cards). Side-stripes, gradient text, glassmorphism, eyebrows, numbered markers: PASS.

**Deterministic scan (detect.mjs):** 1 advisory finding — `text-[10px]` off the DESIGN.md type ramp on the "Paso Actual" badge (incident-timeline.tsx:94). Clean on side-stripes, gradients, glass, shadows at the rule level. No false positives.

**Manual sweep cross-check (caught what the detector missed):** `shadow-sm` on a timeline dot (incident-timeline.tsx:80) violating flat-by-default; icon-only ArrowRight button with NO aria-label, NO tooltip, and NO onClick — a dead control on every widget row (critical-incidents-list.tsx:84-86); zero `motion-reduce`/`prefers-reduced-motion` handling across all 7 files despite animate-spin and ring-pulse transitions; sort headers without aria-sort.

**Visual overlays:** unavailable — browser automation not exposed in this session; review was source-based.

## Overall Impression

The incidents surface has solid structural instincts — the inline summary strip, filter-aware empty state, and skeleton parity are genuinely good — but it fails at its reason to exist. The product sells NOM-251 compliance as a byproduct of good operations, yet the UI lets a CRITICAL cold-chain incident be closed with one sentence of text, presents the remediation protocol in English to a Spanish-speaking manager, and spends the detail-page hero on metadata cards and a truncated UUID instead of answering "¿qué hago ahora?". The single biggest opportunity: make the protocol the hero and make resolution earned.

## What's Working

1. **Inline summary strip with conditional red** (page.tsx:152-180) — text-level stats with `·` separators; the critical count turns red only when > 0. The One Voice Rule executed correctly: restraint by default, alarm when earned. Dodges the banned hero-metric card grid.
2. **Filter-aware empty state** (incident-list.tsx:299-312) — distinguishes "no results with these filters" from "¡Todo en orden!"; teaches and reassures instead of showing a blank table.
3. **Skeleton parity + guarded resolution** — IncidentListSkeleton mirrors real table geometry including rounded badge placeholders (incident-list.tsx:465-499); both resolve dialogs disable confirm until a note exists (incident-list.tsx:445, [id]/page.tsx:402).

## Priority Issues

**[P0] RemediationWizard is entirely in English** (remediation-wizard.tsx:68, 121-123, 133, 136, 153, 161, 175, 189, 196, 205, 208, 213)
- **Why it matters:** The component that executes food-safety remediation — the product's core promise — is unusable for the Spanish-speaking manager at the highest-stakes moment. Includes a 📸 emoji. A Spanish-locale screen reader will mangle it.
- **Fix:** Translate all strings (Paso X de Y, Intento, Intento final, Anterior, Cancelar, Validando…, Completar); replace the emoji with a Camera icon + text.
- **Suggested command:** `/impeccable harden`

**[P0] "Resolver incidente" bypasses the remediation protocol** ([id]/page.tsx:255-260, incident-list.tsx:367-375)
- **Why it matters:** A CRITICAL NOM-251 incident can be closed from the list with a one-line note, protocol untouched. Compliance becomes a byproduct of good intentions, not of the system — exactly what an auditor pokes at. The header CTA is more prominent than the protocol card.
- **Fix:** When hasRemediationProtocol && !isResolved, gate or demote direct resolve ("Completar protocolo para resolver"); remove per-row Resolver for protocol-backed incidents.
- **Suggested command:** `/impeccable shape`

**[P1] Token system bypass + red overload** (incident-list.tsx:70-83,161,168,177; [id]/page.tsx:55-68; incident-timeline.tsx:33-62; critical-incidents-list.tsx:32-42,50; remediation-wizard.tsx:170)
- **Why it matters:** Hardcoded amber/emerald/blue/orange/indigo Tailwind classes ignore committed --warning/--success/--info tokens and drift from theming. DETECTED status in destructive red conflates state with severity — 2 red badges on every new critical row destroys the One Voice Rule.
- **Fix:** Map semantic colors to tokens (bg-warning/10 text-warning, etc.); make DETECTED neutral outline; differentiate or merge FATAL vs CRITICAL.
- **Suggested command:** `/impeccable quieter`

**[P1] Inconsistent severity vocabulary across surfaces** (incident-list.tsx:64-68 vs critical-incidents-list.tsx:30-44; incident-alert.tsx:34-47)
- **Why it matters:** AlertCircle means FATAL in the list but CRITICAL in the dashboard widget; the widget has no FATAL case (renders blue Info); UPPERCASE vs sentence-case labels; IncidentAlert shows severity as a plain outline badge. Three surfaces, three dialects for the same domain concept.
- **Fix:** Extract one shared severity-config (icon, label, token classes) consumed by all four components; handle FATAL everywhere; sentence-case labels.
- **Suggested command:** `/impeccable polish`

**[P2] Detail-page hero is a banned identical-card grid featuring a truncated UUID** ([id]/page.tsx:264-327)
- **Why it matters:** Four same-shape metadata cards push the remediation protocol down the page; the "Workflow" card (instanceId.slice(0,12)…) is meaningless to a restaurant owner.
- **Fix:** Replace with an inline definition row (Sucursal · Detectado · Por — label + value, no cards); move instance ID to a mono footer line or drop it; let timeline + protocol lead.
- **Suggested command:** `/impeccable layout`

## Persona Red Flags

**Alex (power user):** Zero keyboard support (no j/k, no Cmd+K, per-row mouse-only resolve). Search filters only the fetched 50-row page — silent false negatives across pages. Sort is client-side over the same page and resets on pagination; filter/sort state in useState — no deep-linkable views. No bulk resolve for a wave of related WARNINGs.

**Sam (accessibility-dependent):** Sort headers are plain buttons with no aria-sort and no direction indicator. Full date lives only in a Tooltip whose trigger is a non-focusable span (incident-list.tsx:340-349) — keyboard users can never reach the absolute timestamp. Repeated "Resolver" row buttons have no per-incident aria-label (contrast with the Eye button, correctly labeled at line 359). Wizard auto-advances via setTimeout(1500) with no aria-live announcement (remediation-wizard.tsx:87-97). Dead icon-only ArrowRight button with no accessible name on every widget row (critical-incidents-list.tsx:84). Zero prefers-reduced-motion handling anywhere.

**Don Ricardo (owner, 52, anxious, non-technical):** The most prominent button says "Resolver incidente" — he'll click it, type "ya se arregló", and close a CRITICAL cold-chain incident in 10 seconds; the UI invites compliance theater. If he reaches the protocol, it says "Step 1 of 3 — Validating..." in English: hard stop. "Fatal" vs "Crítico" are both red with no explanation of what each demands. The timeline says "regla de lógica en workflow de operación" — system-speak when he needs "El refrigerador de Sucursal Centro superó 8°C". A truncated hex UUID sits where reassurance should be.

## Minor Observations

- Resolve dialog copy diverges: list warns "Esta acción no se puede deshacer fácilmente" (incident-list.tsx:429); detail omits it ([id]/page.tsx:385).
- toast.success interpolates full incident titles (incident-list.tsx:158) — long titles overflow toasts.
- Timeline step titles are bureaucratic Spanglish: "Incidente Detección", "Workflow Completado e Incidente Resuelto" (incident-timeline.tsx:28, 57).
- getStats computes active/critical/resolved from a 500-row subset while total uses count(*) (page.tsx:80-91) — the strip can contradict itself at scale.
- Pagination via window.location.search forces full reloads and loses scroll position (incident-list.tsx:398-415).
- Success step uses variant="default" with text-green-600 icon instead of the success token (remediation-wizard.tsx:168-170).
- text-[10px] "Paso Actual" badge off the type ramp (incident-timeline.tsx:94); shadow-sm on completed dot (line 80); w-6.5 arbitrary sizing + redundant font-sans (lines 78, 68).
- Table row has `group` class but no group-hover style uses it — no hover state on rows (incident-list.tsx:318).
- IncidentAlert missing AWAITING_EXTERNAL/CONFIRMED status styles (incident-alert.tsx:14); "Descartar" has no confirm; "Iniciar remediación" has no loading state.
- `·` separators in text-border (page.tsx:158) will vanish at low contrast — verify WCAG.

## Questions to Consider

1. If a CRITICAL food-safety incident can be closed with one sentence and no evidence, is the remediation protocol a control or a suggestion — and what would a NOM-251 inspector conclude from that audit trail?
2. What does "Fatal" demand from Don Ricardo that "Crítico" doesn't? If the team can't answer in one sentence, why are both on screen competing for the same red?
3. Why does the incident detail page open with four metadata cards and a truncated UUID instead of answering the only question the manager is asking: "¿Qué hago ahora?"
