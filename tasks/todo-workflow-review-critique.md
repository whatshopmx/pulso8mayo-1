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
- [x] `reviewStatus` + `reviewedAt` added to select in `app/api/workflows/history/route.ts`
- [x] Unreviewed rows return `reviewStatus: null`; existing fields unchanged
- [x] `pnpm build` passes ✓ Compiled 338/338

### Task 2: Shared score-color helper (tokens)
- [x] `lib/utils/score.ts` exports `scoreColorClass(score: number | null): string`
- [x] ≥90 `text-success`, ≥70 `text-warning-text`, else `text-destructive`, all bold; null → muted
- [x] No raw Tailwind palette classes in the helper (`rg` sweep)
- [x] `pnpm build` passes

### Task 3: History table shows the verdict and links to it
- [x] Item interface carries `reviewStatus`/`reviewedAt`
- [x] Reviewed rows render "Aprobado" (success) / "Rechazado" (destructive) badge
- [x] Badge comes from shared `components/workflow/review-status-badge.tsx` (reusable para dashboard)
- [x] "Ver" routes reviewed rows → `/review/<id>`, unreviewed → `/execute` (unchanged)
- [x] Score cell uses `scoreColorClass`; local `getScoreColor` deleted (T2)
- [x] `?revisada` highlight + scroll still works
- [x] `pnpm build` passes ✓ Compiled 338/338; `tsc --noEmit` clean; eslint 0 errors

### ✅ Checkpoint 1
- [ ] Review an execution → history row shows outcome; "Ver" opens the review view
- [ ] `?revisada` highlight intact

### ✅ Checkpoint 1
- [x] Review an execution → history row shows outcome; "Ver" opens the review view (código; verificación manual/e2e pendiente T8a)
- [x] `?revisada` highlight intact (código sin tocar)

---

## Phase 2 — The decision surface

### Task 4: Unambiguous verdict + score semantics + token/brand pass
- [x] Header badge branches on `reviewStatus` first; dead `status === 'APPROVED'/'REJECTED'` branches deleted
- [x] Rejected execution shows destructive "Rechazado" in header AND sticky bar — never green "Completado"
- [x] Puntuación usa `scoreColorClass` (80% amber, 95% green, 45% red)
- [x] `rg "bg-emerald|text-emerald|text-red-500" components/workflow/workflow-review.tsx` → vacío
- [x] Approve button = Operational Red (`variant="default"`); result badges keep success/destructive tokens
- [x] "Procesando..." muestra `Loader2` spinner
- [x] Diálogo informa que la acción es definitiva y quedará registrada (finalidad)
- [x] `pnpm build` passes ✓ Compiled 338/338

### Task 5: Spanish vocabulary + single evidence surface
- [x] "AI Verified" → "Verificado por IA"; "AI Fail" → "Requiere revisión"; tab "Verificados por IA"
- [x] `rg -i "ai verified|ai fail|galer" components/workflow/workflow-review.tsx` → vacío
- [x] Standalone gallery card removed; evidence only in the ledger
- [x] Step number from canonical `workflow.steps` (Map por id); gallery caption bug gone
- [x] `pnpm build` passes ✓ Compiled 338/338

### Task 6: Keyboard/touch evidence path
- [x] Step rows + thumbnails son `<button>` reales con `aria-expanded`/`aria-controls`/aria-label; Enter/Space nativo
- [x] Previews llevan "Paso N: título" + veredicto en `DialogDescription`; veredicto sin hover (badge siempre visible)
- [x] `loading="lazy"` en imágenes; "Descargar" = `<a download target=_blank>` (fallback nueva pestaña)
- [x] `pnpm build` passes ✓ Compiled 338/338; tsc clean

### Task 7: Review page shell polish (parallel-safe)
- [x] `text-red-500` → `text-destructive` en `[id]/page.tsx` (`rg` sweep vacío)
- [x] "Reintentar" re-ejecuta el fetch (extraído a `useCallback`) y limpia el error en éxito; mensajes del servidor verbatim
- [x] `pnpm build` passes ✓ Compiled 338/338

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