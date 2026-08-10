---
target: critique app/dashboard/workflows/review/[id]/page.tsx
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
p2_count: 4
timestamp: 2026-08-10T11-48-51Z
slug: app-dashboard-workflows-review-id-page-tsx
---
# Critique: Workflow Review Page

Target: `app/dashboard/workflows/review/[id]/page.tsx` (+ `components/workflow/workflow-review.tsx`)
Mode: Operate — the reviewer inspects a completed execution and makes an approve/reject decision.

## Design Specificity Verdict

**Partially specific, leaning generic.** The artistic skeleton is the standard stacked admin-card layout (Summary → Alert summaries → Gallery → Tabbed ledger → sticky decision bar). Swap the copy and it would serve any QA/approval product unchanged. The genuinely product-specific moments are the AI-verification alerts, the step ledger with evidenced values, and the single sticky decision bar — those speak the language of a compliance review. What dilutes the product voice: the UI alternates Spanish and English on the same row ("Paso 2 · ✓ AI Verified · Evidencia (1)"), every card uses the exact same Card primitives with no tonal differentiation, and there is zero presence of the Operational Red identity token anywhere on the surface (the brand color appears only in hover rings on images). For a product positioned as "confident, sharp, operational" and "compliance as a byproduct," the strongest decision surface in the app is also the most anonymous one.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Header badge reads `status` while the decision bar reads `reviewStatus`; a rejected workflow shows green "Completado" in the header and red "Rechazado" in the sticky bar simultaneously |
| 2 | Match System / Real World | 3 | Spanish copy is natural; "AI Verified"/"AI Fail" English tokens and unexplained "Nivel de confianza: X%" leak in |
| 3 | User Control and Freedom | 2 | Cancel/back/Esc work; an irreversible approve/reject has no undo path and the server blocks re-review (409) |
| 4 | Consistency and Standards | 2 | Status vocabulary and score colors diverge from the history table; three date formats; hardcoded `text-red-500` vs design tokens; three languages on one row |
| 5 | Error Prevention | 3 | Reject requires a reason (UI + server), double-submit disabled, zod validation, ALREADY_REVIEWED guard |
| 6 | Recognition Rather Than Recall | 3 | Summary grid + progressive disclosure are good; but filtered tabs renumber steps ("Paso 1" may be step 4 of the workflow) forcing recall of true order |
| 7 | Flexibility and Efficiency | 1 | No keyboard shortcuts, no batch/bulk review, no queue link, one workflow at a time |
| 8 | Aesthetic and Minimalist Design | 2 | Generic card stack; evidence is presented three times (gallery card + "Con Evidencia" tab + per-step thumbnails); monochrome emerald/red palette, zero brand presence |
| 9 | Error Recovery | 2 | Spanish server messages preserved and shown, but no retry on fetch failure, raw error text, silent image-fallback |
| 10 | Help and Documentation | 1 | No explanation of AI confidence, "Por Revisar" semantics, or review vocabulary; no docs link |
| **Total** | | **21/40** | **Acceptable** |

## Overall Impression

The core decision flow is thoughtfully built — a single pinned decision bar, reject requires a reason, double-submit protection, server-side validation, and a redirect that highlights the reviewed row (the `?revisada=` handoff is a genuinely thoughtful touch). The surface fails where the app's own conventions collide: two contradictory verdict states rendered at once, review outcomes invisible in history, filtered step lists that renumber steps, and a visual language that abandoned the brand for generic green/red admin styling. The biggest opportunity: make the verdict unambiguous everywhere and let a reviewer act without re-reading a 4-card ledger.

## What's Working

1. **The sticky decision bar is the right call.** One decision point, always visible, in the thumb zone on mobile; shows the verdict inline once reviewed, with the date. This is exactly the "operational at every pixel" principle.
2. **Reject-with-reason is enforced twice** (disabled button + `COMMENT_REQUIRED` server check), and double-submission is guarded while "Procesando..." shows.
3. **The step detail expansion is good progressive disclosure** — operator comment, registered value, evidence thumbnails, AI analysis and confidence all appear at need, in Spanish, with mono typography for machine values.

## Priority Issues

### [P1] Contradictory verdict states in the same viewport
- **What**: The header badge branches on `workflow.status` (`COMPLETED` → green "Completado"; `APPROVED`/`REJECTED` branches are dead code because the service keeps status at `COMPLETED`). The decision bar branches on `reviewStatus`. A rejected workflow therefore renders green "Completado" in the header while the sticky bar says "Rechazado el ...".
- **Why**: The reviewer is making a consequential, irreversible decision. Two conflicting statuses at the moment of truth actively undermine trust and invite misreads.
- **Fix**: Derive the header badge from `reviewStatus` first (Aprobado/Rechazado), fall back to `status` only when unreviewed. Remove the dead `status === 'APPROVED'/'REJECTED'` branches.
- **Suggested command**: `$impeccable clarify`

### [P1] The evidence-review path is mouse-only
- **What**: Expandable step rows are `div`s with `onClick` and no `role`/`tabIndex`/`aria-expanded`; gallery thumbnails and per-step thumbnails are the same. Hover-only overlays reveal AI verdict and step captions (invisible on touch and for keyboard users). The preview dialog strips step context (just "Vista Previa de Evidencia").
- **Why**: Screen-reader and keyboard users cannot read the evidence — the core content of this surface — and touch users never see the hover-only verdict overlays. This is a review page whose evidence is inaccessible to a whole class of reviewers.
- **Fix**: Convert interactive rows/thumbs to real buttons (or add `role="button"`, `tabIndex={0}`, keyboard handler, `aria-expanded`); move the AI verdict out of hover-only overlays or into the dialog; carry step title/step number into the preview dialog.
- **Suggested command**: `$impeccable audit`

### [P1] The review loop is not closed in history
- **What**: After approve/reject the app lands on `/dashboard/workflows/history?revisada=<id>` with the row highlighted — but the history table has no `reviewStatus` column/badge, its primary action ("Ver") links to `/execute` not `/review`, and the highlighted row still reads "Completado".
- **Why**: The reviewer can't confirm the outcome persisted, and no one auditing the list can tell which execution was approved or rejected. The "one platform, one truth" principle breaks exactly at the handoff.
- **Fix**: Show a reviewStatus badge on reviewed rows in the history table; link reviewed rows to `/review/<id>`; keep the `?revisada` highlight.
- **Suggested command**: `$impeccable shape`

### [P2] Filtered step tabs renumber steps
- **What**: `stepsToReview.map((step, index) => <StepDetail index={index} …>)` passes the filtered-array index, so in "Por Revisar" or "Con Evidencia" the first row displays "Paso 1" even when it is step 4 of the workflow. The gallery caption does the same (`Paso {index + 1}: {step.title}`).
- **Why**: Order attribution matters in a compliance audit (a step log with renumbered steps is worse than no numbers).
- **Fix**: Derive the step number from its position in `workflow.steps`, not the filtered array.
- **Suggested command**: `$impeccable clarify`

### [P2] Score semantics diverge from the rest of the app
- **What**: History and dashboard tables color-code scores (≥90 emerald, ≥70 amber, else destructive, bold). The review summary renders a plain mono "80%" with no threshold color.
- **Why**: The reviewer's trained eye — built on the tables they use daily — doesn't transfer to the page where the decision happens. The score is the single most decision-relevant number on the page.
- **Fix**: Reuse the same threshold colors on "Puntuación".
- **Suggested command**: `$impeccable colorize`

### [P2] Mixed-language AI vocabulary and repeated evidence presentation
- **What**: "AI Verified"/"AI Fail" in English next to Spanish every step of the way; "Verificación AI" card vs "AI Verified" tab naming; evidence surfaces three times (gallery card, "Con Evidencia" tab, per-step thumbnails), making a long page with the same content at three zoom levels.
- **Why**: Inconsistent vocabulary reads as unpolished to a HORECA owner and undercuts the "operational, no fluff" voice; triplicated content inflates cognitive load on the only decision screen.
- **Fix**: Standardize on Spanish verdict labels ("Verificado por IA" / "Requiere revisión"); cut one evidence presentation level (the gallery card and per-step thumbs can collapse into the tabbed ledger).
- **Suggested command**: `$impeccable distill`

### [P2] Brand color absent; hardcoded Tailwind palette bypasses tokens
- **What**: `bg-emerald-600`, `text-emerald-600`, `bg-emerald-500/10` and `text-red-500` are hardcoded; DESIGN.md defines OKLCH tokens (`success`, `destructive`) and an Operational Red identity used nowhere on this page.
- **Why**: The approve/confirm action is the moment brand confidence should show; instead the surface looks like a generic health-check. Token drift makes future theming impossible.
- **Fix**: Map to tokens (`bg-success`, `text-destructive`), and let the primary identity appear in one deliberate place (e.g., the decision bar's approve accent or the score).
- **Suggested command**: `$impeccable colorize`

## Persona Red Flags

**Alex (Power User)** — No keyboard accelerators anywhere: expandable steps are mouse-only, approve/reject requires a 4-step walk (scroll → sticky button → dialog → type/confirm → redirect) with no bulk path. A gerente with 15 branches and daily reconciliations reviews one execution at a time with zero shortcuts. High abandonment risk.

**Sam (Accessibility-Dependent)** — Step rows and all image thumbnails are keyboard-invisible (no focus, no role, no aria-expanded). AI verdicts live in hover-only overlays. The preview dialog gives a bare image with no step attribution. The approve/reject buttons themselves are accessible, but a keyboard user cannot reach the evidence that justifies the decision.

**María (Owner/Admin, project-specific: 15 branches, "single pane of glass")** — She is dropped out of the pane: no queue/branch link in context, and after reviewing she lands on a history list that doesn't show the outcome she just set (still "Completado", "Ver" points at execute). Her trained score colors don't carry over. Title-case English AI labels next to Spanish compliance copy reads as unpolished to an owner who equates polish with compliance readiness.

## Minor Observations

- `text-red-500` (error state) instead of the `text-destructive` token.
- Three date formats across the page and adjacent surfaces (es-MX long with hour, `toLocaleDateString`, date-fns `dd MMM yyyy`).
- "Descargar" does `window.open` — opens a tab, not a download; no `download` attribute.
- Gallery and per-step `<img>`s load eagerly — add `loading="lazy"` for multi-photo workflows on slow branch networks.
- Fetch failure has no retry button; only a "Volver" escape.
- "Procesando..." text without a spinner icon during submit.
- The step-comment snippet under collapsed rows duplicates the expanded comment — fine, but shifts layout on expand/collapse (minor CLS).
- Empty states in tabs are dashed boxes with decent copy — good pattern, keep.
- `stepsToReview` includes any step with a comment even when AI passed — the "Por Revisar" queue can overflow with chatter; consider a "solo con observaciones de AI o falla" option.

## Questions to Consider

1. What if the decision bar came first (verdict + score + queue position above the ledger) so the reviewer can decide without scrolling a 4-card stack?
2. What if approve were one click with an inline undo snackbar — since only rejection truly needs the reason dialog — and the bar showed the edit queue ("3 por revisar en Sucursal Norte")?
3. Should the review surface inherit the exact status/score semantics of the history table so the reviewer's daily-trained eye transfers?
4. Why does the strongest operational surface in the app speak English where everything else speaks Spanish?
