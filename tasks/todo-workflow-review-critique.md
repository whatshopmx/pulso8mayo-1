# Tasks: Workflow Review — Critique Remediation

> **Plan:** `tasks/plan-workflow-review-critique.md` · **Source critique:** 2026-08-10 (`21/40`, 3×P1, 4×P2)
> **Package manager:** pnpm · **Build gate:** `pnpm build` typechecks *and* lints
> **Tests:** Playwright in `tests/` (dev server auto-starts via `playwright.config.ts`)
> **Reading order:** T1→T3 (history loop) · T2↦T4→T5→T6 (decision surface) · T7 parallel · T8a→T8b (proof)
>
> **Decisiones fijadas (2026-08-10):** ① finalidad de la revisión + copy de irreversibilidad en el diálogo (T4) ·
> ② queue/batch deferido → `PROJECT_CONTEXT.md` · ③ "Por Revisar" sin cambios (comentarios del operador son material) ·
> ④ Aprobar = Operational Red sólido, Rechazar = outline destructive · ⑤ dashboard deferido, `ReviewStatusBadge` reutilizable (T3)

---

## Phase 1 — History closes the loop

### Task 1: History API exposes review state
- [ ] `reviewStatus` + `reviewedAt` added to select in `app/api/workflows/history/route.ts`
- [ ] Unreviewed rows return `reviewStatus: null`; existing fields unchanged
- [ ] `pnpm build` passes

### Task 2: Shared score-color helper (tokens)
- [ ] `lib/utils/score.ts` exports `scoreColorClass(score: number | null): string`
- [ ] ≥90 `text-success`, ≥70 `text-warning-text`, else `text-destructive`, all bold; null → muted
- [ ] No raw Tailwind palette classes in the helper (`rg` sweep)
- [ ] `pnpm build` passes

### Task 3: History table shows the verdict and links to it
- [ ] Item interface carries `reviewStatus`/`reviewedAt`
- [ ] Reviewed rows render "Aprobado" (success) / "Rechazado" (destructive) badge
- [ ] Badge comes from shared `components/workflow/review-status-badge.tsx` (reusable para dashboard)
- [ ] "Ver" routes reviewed rows → `/review/<id>`, unreviewed → `/execute` (unchanged)
- [ ] Score cell uses `scoreColorClass`; local `getScoreColor` deleted (T2)
- [ ] `?revisada` highlight + scroll still works
- [ ] `pnpm build` passes

### ✅ Checkpoint 1
- [ ] Review an execution → history row shows outcome; "Ver" opens the review view
- [ ] `?revisada` highlight intact

---

## Phase 2 — The decision surface

### Task 4: Unambiguous verdict + score semantics + token/brand pass
- [ ] Header badge branches on `reviewStatus` first; dead `status === 'APPROVED'/'REJECTED'` branches deleted
- [ ] Rejected execution shows destructive "Rechazado" in header AND sticky bar — never green "Completado"
- [ ] Puntuación uses `scoreColorClass` (80% amber, 95% green, 45% red)
- [ ] `rg "bg-emerald|text-emerald|text-red-500" components/workflow/workflow-review.tsx` → vacío
- [ ] Approve button = Operational Red (`variant="default"`); result badges keep success/destructive tokens
- [ ] "Procesando..." shows `Loader2` spinner
- [ ] Diálogo informa que la acción es definitiva y quedará registrada (finalidad)
- [ ] `pnpm build` passes; manual light+dark screenshot of rejected view

### Task 5: Spanish vocabulary + single evidence surface
- [ ] "AI Verified" → "Verificado por IA"; "AI Fail" → "Requiere revisión"; tab "Verificados por IA"
- [ ] `rg -i "ai verified|ai fail|galer" components/workflow/workflow-review.tsx` → vacío
- [ ] Standalone "Galería de Evidencias" card removed; evidence only in the ledger
- [ ] Step number derived from canonical `workflow.steps` position (all tabs); gallery caption bug gone
- [ ] `pnpm build` passes

### Task 6: Keyboard/touch evidence path
- [ ] Step rows + thumbnails are keyboard-reachable (`role`/`tabIndex`/Enter/Space/`aria-expanded`)
- [ ] Previews carry step title + "Paso N" in dialog description; verdict readable without hover
- [ ] `loading="lazy"` on images; "Descargar" = `<a download>` with new-tab fallback
- [ ] `pnpm build` passes; keyboard-only walkthrough (Tab→Enter→dialog)

### Task 7: Review page shell polish (parallel-safe)
- [ ] `text-red-500` → `text-destructive` in `[id]/page.tsx` (`rg` sweep)
- [ ] "Reintentar" button re-fetches and clears error; server Spanish messages still verbatim
- [ ] `pnpm build` passes

### ✅ Checkpoint 2
- [ ] Build clean; rg sweeps empty in touched files
- [ ] Manual light+dark pass; human reviews screenshots before Phase 3

---

## Phase 3 — Proof

### Task 8a: E2E — review decision loop
- [ ] `seedReviewInstance`/`cleanupReviewInstance` en `tests/support/db.ts` (COMPLETED + score + steps con `ai_result`/`evidence_url`/`comment`)
- [ ] Spec: open review → reject requires reason → reject lands on highlighted history row "Rechazado"
- [ ] Spec: approve branch → "Aprobado"; persistencia verificada vía executions API
- [ ] Cleanup idempotente en `afterEach`
- [ ] `pnpm test:e2e tests/workflow-review.spec.ts` passes

### Task 8b: E2E — filtered-step numbering + keyboard evidence
- [ ] "Por Revisar" muestra posición real ("Paso 3") con seed desalineado a propósito; "Todos" ordena 1–5
- [ ] Keyboard-only: Tab→Enter expande paso (`aria-expanded`); Enter en thumbnail abre diálogo con título del paso
- [ ] Sin llamadas de mouse API en el spec
- [ ] `pnpm test:e2e tests/workflow-review.spec.ts` passes

### ✅ Checkpoint 3 (Complete)
- [ ] `pnpm build` green
- [ ] E2E spec green
- [ ] All 7 priority issues + listed minors closed (mapping en plan)
- [ ] Decisiones fijadas 2026-08-10 (cabecera); follow-ups deferidos registrados en `PROJECT_CONTEXT.md`
- [ ] Human approves before merge