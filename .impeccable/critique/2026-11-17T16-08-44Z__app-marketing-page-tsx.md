---
target: landing page
total_score: 22
max_score: 32
na_heuristics: 5,7
p0_count: 0
p1_count: 3
timestamp: 2026-11-17T16-08-44Z
slug: app-marketing-page-tsx
---
# Critique — Landing page (`app/(marketing)/page.tsx`)

Surface mode: **Persuade** · Platform: web · Target: `http://localhost:3000/` (source resolves to `app/(marketing)/page.tsx` + `components/marketing/*`)

## Design Health Score

Mode applicability: heuristics **5 (Error Prevention)** and **7 (Flexibility and Efficiency)** scored `n/a` — the surface has no inputs, no multi-step task, and no expert accelerators. Applicable maximum **/32**.

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Sticky 6-item nav on an 11,137px page with no active-section state, no progress cue, no back-to-top; FAQ open state is fine |
| 2 | Match System / Real World | 3 | Copy is native HORECA Spanish (merma, food cost, OC, corte de venta) but leaks English jargon: "unit economics", "prime cost", "benchmarking", "playbooks", "cockpit", "smart links", "P&L" |
| 3 | User Control and Freedom | 3 | Esc closes the mobile menu, anchors are reversible, nothing traps; no way to jump back up on a 17,067px mobile scroll |
| 4 | Consistency and Standards | 2 | Same destination (`/sign-up`) is labelled "Crear cuenta", "Crear mi cuenta" and "Empezar" (8 links); footer section labels are `<h2>` at 12px |
| 5 | Error Prevention | n/a | No inputs, forms or destructive actions on this surface |
| 6 | Recognition Rather Than Recall | 3 | Everything is visible and named; but 6 consecutive "intro text + panel" sections make the reader re-read headers to know which capability they are looking at |
| 7 | Flexibility and Efficiency | n/a | No repeat-use task; anchors are the only accelerator |
| 8 | Aesthetic and Minimalist Design | 3 | Disciplined flat system, no shadows, restrained red — but 1,876 words across 15 sections is more surface than a Persuade page needs |
| 9 | Help Users Recognize, Diagnose, Recover from Errors | 3 | All 37 links resolve, no broken anchors, no console errors; no recovery messaging because nothing can fail here |
| 10 | Help and Documentation | 3 | The FAQ is unusually honest ("No. Pulso no certifica NOM-251") and task-focused; but no contact channel, no legal/trust links |
| **Total** | | **22/32** | **69% — Acceptable (top of band)** |

## Design Specificity Verdict

**LLM assessment — authored, not interchangeable.** The thesis ("la operación se ejecuta en un lugar, el costo se explica en otro… el mismo registro se ejecuta, se evidencia, se autoriza y se mide") is a real product POV, not a template line, and it is carried structurally: the hero panel is not a screenshot, it is a composed record where *"Apertura sin registrar" → "Mantenimiento · Cámara 2" → $1,160.00* sits in one stack. The disclaimers ("Las cifras, sucursales y nombres de esta página son demostrativos") and the FAQ refusals are the opposite of category habit. Where it goes category-generic: the *skeleton* — hero, problem, three pillars, six alternating feature rows, industries grid, 3-step implementation, three plan cards, FAQ, final CTA — is the stock B2B SaaS page order, and there is zero human evidence (no logos, no case studies, no numbers from real groups).

**Deterministic scan** — `detect.mjs` over `app/(marketing)/page.tsx` + `components/marketing`: **20 findings, exit 2**, all one rule: `design-system-font-size` (advisory) — literal sizes off the DESIGN.md ramp (`0.9375rem` ×3, `1.125rem`, `1.0625rem`, `0.625rem`, `0.8125rem`…). Distribution: `panels.tsx` 13, `page.tsx` 2, `logo.tsx` 2, `faq.tsx` 1, `section.tsx` 1, `site-header.tsx` 1. This is real design-system debt (DESIGN.md documents a dashboard ramp; the landing invented `--l-*` sizes without documenting them) but it is **not** the actual typography problem on this page — see Priority Issue 1.

**Visual overlays** — none available to you. This run used headless Playwright with the harness's own browser, not a presented tab, so no `[Human]` overlay exists in your browser. In-page injection did succeed (`document.title` mutation confirmed, `/detect.js` executed) and reported `[impeccable] 10 anti-patterns found` in the page console — i.e. 20 findings collapsed to 10 unique anti-pattern sites.

## Overall Impression

The strongest thing here is the argument: the page sells *one record that ties an incident to a cost*, and it never wanders off that thesis. The weakest thing is that the page is built from a very long corridor of identical rooms — and the typeface it was designed around is not the typeface it ships with. Biggest single opportunity: make the hero's right-hand column carry a full record (incident → authorization → $1,160) instead of a 369px card that stops 253px short.

## What's Working

1. **The hero sentence does the positioning work.** "Tu operación ya cuenta qué pasó. Ahora también cuenta cuánto costó." with `cuánto costó` in Operational Red is a 73.6px, 5-line, `-0.035em` statement that no generic SaaS could reuse. The dot-and-kicker (`Operación y finanzas para cadenas HORECA`) establishes audience in one glance.
2. **The product panels are composed from the real system, not stock screenshots.** Rows, chips, tabular numerics, ink/line tokens, tone variants for deep bands — they read as the product, and each is labelled `Demostración`. This is more credible than a mockup and cheaper than a screenshot pipeline.
3. **Intellectual honesty as differentiation.** "¿Pulso certifica NOM-251 y NOM-035? — No." and "No es el resultado de un cliente" build more trust with an owner who has been oversold than any badge would.

## Priority Issues

### [P1] Geist is never applied — the entire product renders in Segoe UI / system-ui
- **What**: `app/layout.tsx` sets `--font-geist-sans` on `<body>`, `globals.css` maps `--font-sans: var(--font-geist-sans)` inside `@theme inline`, and then nothing applies it. Verified in the live DOM: `getComputedStyle(document.body).fontFamily === "ui-sans-serif, system-ui, sans-serif…"`; `--font-sans` computes to an empty string; every `document.fonts` entry is `Geist:unloaded`. `body { @apply bg-background text-foreground; }` sets colours only. Same on `/sign-in`.
- **Why it matters**: DESIGN.md pins a single Geist family and the landing's tracking (`-0.035em` on display, `-0.028em` on h2) was tuned for a geometric grotesk. In Segoe UI those values read tight rather than precise, and designers who approved the page are looking at a different typeface than users get.
- **Fix**: add `font-family: var(--font-sans)` (or `font-sans` class) to `html`/`body` in `app/globals.css`; verify with `document.fonts` showing `Geist:loaded` and the h1 computed family containing "Geist".
- **Suggested command**: `$impeccable typeset`

### [P1] The "Precios" section contains no prices
- **What**: Three cards (Foundation ≤5, Growth ≤15, Executive ≤50 sucursales), each with a feature list and an `Empezar` → `/sign-up` button, plus the line "El precio se confirma en la propuesta. No publicamos una cifra que todavía no corresponde a tu configuración." Nav and footer both promise `#precios`.
- **Why it matters**: an owner of 3–15 branches is evaluating cost per branch — the one thing the page refuses to give. A visitor who clicks "Precios" and finds no number concludes the price is probably bad news, and self-selects out before ever talking to sales.
- **Fix**: publish either a "desde $X / sucursal / mes" anchor per plan, or a range; if pricing is genuinely configurable, rename the section ("Cómo se cobra", "Planes y alcance") and make the CTA "Solicitar propuesta" so it does not pretend to be a price list.
- **Suggested command**: `$impeccable clarify`

### [P1] Zero third-party evidence on the page
- **What**: no customer logos, no quotes, no case study, no "n grupos operando", no audit-passed numbers, no external link. `externalLinks: 0`.
- **Why it matters**: for a multi-branch purchase with compliance exposure, "does a group like mine run on this?" outranks feature lists. Right now the only proof on the page is the honesty of its disclaimers.
- **Fix**: one band between `#inteligencia` and `#precios`: three group names (with permission) or, if none are publishable yet, a single named quote with role + branch count, plus one operational number ("31 plantillas en uso en 12 sucursales"). Keep the demo disclaimer; it does not conflict.
- **Suggested command**: `$impeccable bolder`

### [P2] Hero columns end 253px apart
- **What**: measured at 1440×900 — left column bottom 779px, hero panel bottom 526px, `lg:items-start`. The H1 is 5 lines (361px tall) opposite a 369px panel.
- **Why it matters**: the eye reads the gap as a missing element. The page's densest argument (`incidencia → costo`) is also the shortest card on the page, so the hero under-sells the thesis it just made.
- **Fix**: make the hero panel a full record — incident row, authorization row, cost row, `Verificación` footer — targeting the same 620–650px depth as the left column, or bottom-align it to the CTA row and give the freed space to a one-line proof strip.
- **Suggested command**: `$impeccable layout`

### [P2] Six consecutive sections with the same composition
- **What**: `#operaciones`, `#finanzas`, `#workflows`, `#compras`, `#personal`, `#inteligencia` are all *one text column (intro + bullets + note) + one ~300px panel*, alternating sides twice. Total page: 11,137px desktop, 17,067px mobile, 1,876 words, 15 sections.
- **Why it matters**: alternation is not variety. By the fourth repetition the reader is scrolling without reading, and the sections that carry the differentiated claims (`#workflows` timeline, `#inteligencia` cockpit) get the same visual weight as the least important one (`#personal`).
- **Fix**: cut or merge `#personal` and `#compras` into a two-panel block inside `#finanzas`; give `#workflows` a full-width timeline instead of a half column; let `#inteligencia` use the dark band with a wider panel. Target four distinct compositions, not six copies.
- **Suggested command**: `$impeccable distill`

### [P2] No Open Graph / Twitter metadata anywhere in the project
- **What**: grep for `openGraph|twitter:` across `app`, `components`, `lib` returns nothing. The live page exposes only `description`.
- **Why it matters**: this product is sold through WhatsApp. Paste the landing URL into a group chat today and it renders as a bare link — no title card, no image, no `es_MX` locale. The channel the product is built around is the one the marketing page doesn't serve.
- **Fix**: add `openGraph` + `twitter` (1200×630 image, `title`, `description`, `locale: es_MX`, `type: website`) and `alternates.canonical` to the `app/(marketing)/layout.tsx` metadata.
- **Suggested command**: `$impeccable harden`

### [P3] Three labels for one action
- **What**: `/sign-up` appears 8 times as "Crear cuenta" (header), "Crear mi cuenta" (hero, final CTA) and "Empezar" (×3 pricing cards).
- **Fix**: one verb — "Crear cuenta" everywhere; pricing cards read "Empezar con Growth" so the plan is still in the label.
- **Suggested command**: `$impeccable clarify`

### [P3] No legal or contact surface in the footer
- **What**: footer has only `Producto` and `Acceso`; no Aviso de privacidad, términos, contacto.
- **Why it matters**: the product stores employee attendance, geolocation, evidence photos and payroll. A Mexican B2B buyer — and the LFPDPPP — expects the privacy notice link from the landing page. Its absence is the one place the page looks unfinished.
- **Fix**: third footer column with Aviso de privacidad, Términos, and a real contact (email + WhatsApp number).
- **Suggested command**: `$impeccable harden`

### [P3] Marketing palette lives as literals in TSX
- **What**: 21 literal `oklch(...)` values across the 6 landing files (11 distinct), including `hover:bg-[oklch(0.46_0.17_25)]` repeated in `page.tsx` and `site-header.tsx` and inverse-band text colours (`oklch(0.68_0.008_80)` ×4) shadowing the `--l-*` variables that already exist.
- **Fix**: promote `--l-signal-hover`, `--l-deep-fg-soft`, `--l-deep-fg-faint` to `globals.css` and reference them.
- **Suggested command**: `$impeccable polish`

## Persona Red Flags

**Jordan (First-Timer)** — reads the hero, understands the pitch, then hits `#problema`: three dense statements at 15px inside a 52ch column, then a 12-card corridor. He wants "what will I see in the first hour"; the page gives him a feature census. Also: "unit economics", "prime cost", "benchmarking", "smart links" are undefined — he cannot tell if these are his words or the vendor's. Never finds a human to ask: no phone, no WhatsApp, no email anywhere on the page.

**Casey (Distracted Mobile)** — 390px hero puts both CTAs above the fold (good, 350×44 each) but the product panel starts at ~700px and is cut by the fold; the scroll is 17,067px ≈ 20 screens; `#precios` alone is 1,744px. No sticky CTA after the hero, so after the first screen there is no way to act without scrolling back up or reaching the final CTA. Footer link rows are 19px tall — below the 44px touch floor.

**Riley (Stress Tester)** — all 37 internal anchors resolve, no console errors, no horizontal overflow at 390/834/1440, FAQ toggles without layout jump. But: the pricing cards say `Hasta 15 sucursales` with no unit, so he cannot compute anything; "31 plantillas" and "14 días" have no supporting breakdown; and there is no way to see *any* real screen of the product before creating an account — the entire evidence set is synthetic panels marked `Demostración`. He will ask "what does the real dashboard look like?" and the page has no answer.

**Marisol (Dueña de grupo, 6 sucursales, CDMX — project persona)** — she is the buyer PRODUCT.md describes. She wants: what it costs, who else uses it, what her gerentes will have to learn, what happens in week one. The page answers the last one well (`#implementacion`: diagnóstico → configuración → operación), answers cost with nothing, answers "who else" with nothing, and answers "what my gerentes learn" only indirectly. She will forward the link to her accountant, who will ask for the price and the privacy notice — neither exists, so the forward stalls.

## Minor Observations

- `#problema` h2 hard-codes a `<br />`; on narrow widths it produces "La operación se ejecuta en un lugar." / "El costo se explica en otro." — fine, but the break is load-bearing and will not survive any copy edit.
- Footer uses `<h2>` at 12px for "Producto" and "Acceso": heading-level noise for screen readers (both navs already carry `aria-label`).
- Pricing card h3 is 18px while every other card h3 is 21px — the plan names are the least prominent element in their own cards.
- `#precios` note "Los límites de sucursales aplican al configurar la empresa" is a support answer, not a sales promise; it reads as a caveat next to the one thing the visitor came for.
- Primary CTA contrast is solid: white on `oklch(0.52 0.17 25)` = **6.04:1**. All text sampled passes AA (lowest: 4.68:1 on the 13px hero note); deep-band smallest text 6.38:1.
- No motion anywhere beyond a 150ms colour transition and a 2px arrow nudge on pillar hover. On an 11,000px page, one deliberate reveal on the wireframe panels would help pacing; the reduced-motion guard is already correct (`scroll-behavior` gated).
- Skip link, `lang="es"`, focus-visible rings (`2px solid var(--l-signal)`, offset 3px) and mobile-menu `aria-expanded`/Esc are all correct — keyboard walk of 22 stops hit every interactive element with a visible ring.
- The dev-only Next.js indicator sits on top of the "Condesa" row at mobile; not present in production builds.
- Detector false-positive note: the 20 `design-system-font-size` findings are all in marketing files that legitimately use a marketing scale; the finding to act on is to *document* `--l-*` in DESIGN.md, not to shrink the type.

## Questions to Consider

- If the hero panel showed the actual record (incident → authorization → $1,160 → resultado), would the page still need six feature sections?
- What is the smallest number of words that still convinces Marisol — 1,876 or closer to 700?
- Would publishing "desde $X por sucursal" cost more in negotiation leverage than it gains in qualified leads?
- Should the page show one real, redacted screen from a live group instead of six synthetic panels?
