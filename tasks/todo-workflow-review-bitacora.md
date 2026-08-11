# TODO: Revisión de Workflows — de inspector de campos a bitácora

Plan: `tasks/plan-workflow-review-bitacora.md` · Creado 2026-08-11
Build gate: `pnpm build` · Tests: `pnpm test:e2e tests/workflow-review.spec.ts`

> **Decidido 2026-08-11:** tabs colapsados a 2 ("Todo" / "Requiere atención"); alcance = las 4 fases
> completas; export a PDF resuelto por diseño (resolver puro y serializable en T1), no se implementa;
> backfill aplicado a todo el histórico.
>
> **Nota de entorno:** `pnpm build` falla al descargar Geist de Google Fonts en esta máquina. Corre con
> `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1 pnpm build`. Sin esa variable el fallo es de red,
> no de código.

## Fase 1 — La bitácora (cliente, sin migración)

- [x] **T1 · Resolver de definiciones de paso** — S — sin dependencias
  `lib/workflows/step-definitions.ts` (nuevo), `lib/types/workflow.ts`
  - [x] Orden del array del template, `position` 1..N
  - [x] `stepId` huérfano → `resolved: false`, conserva la respuesta
  - [x] Módulo puro (sin React, sin `@/lib/db`)
- [x] **T2 · Render del valor por tipo** — M — dep: T1
  `components/workflow/step-value.tsx` (nuevo)
  - [x] 9 tipos sin JSON crudo; `NUMBER` fuera de rango marcado; tipos desconocidos degradados
  - [x] Sólo tokens del sistema de diseño
- [x] **T3 · La fila del paso se lee como bitácora** — M — dep: T2
  `components/workflow/workflow-review.tsx`
  - [x] Sin `Step <id>`; hallazgos auto-expandidos; `completedBy` + hora visibles
  - [x] `rg "Valor Registrado|Comentario del Operador" components/` → vacío
  - [x] Camino de teclado del plan anterior intacto
- [x] **T4 · Dos tabs y numeración canónica** — M — dep: T3
  `components/workflow/workflow-review.tsx`, `app/dashboard/workflows/review/[id]/page.tsx`
  - [x] 2 tabs; conteos evidencia/IA conservados en la tarjeta resumen
  - [x] `page.tsx` delega en `resolveStepDefinitions`; sin fallbacks `|| 'Step ...'` / `|| 'TEXT'`

### ✅ Checkpoint 1
- [x] `pnpm build` limpio (con `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1`)
- [ ] Una ejecución real se entiende sin abrir un solo acordeón
- [x] Medir la instancia más grande — 10 pasos, resolver en 2 ms. El riesgo de "cientos de pasos" no se
      materializa en esta base; revisar si aparece un conteo real grande
- [ ] Capturas claro/oscuro aprobadas por humano **antes** de tocar backend

## Fase 2 — Backend chico (sin migración)

- [x] **T5 · `getExecution`: sucursal, orden y revisor** — S — sin dependencias (paralelizable con Fase 1)
  `lib/services/workflow-execution-service.ts`
  - [x] `branch: { id, name }` en la respuesta (mata el "Sucursal: N/A" permanente)
  - [x] `orderBy` explícito en los pasos
  - [x] `completedBy` resuelto a nombre en una sola consulta (sin N+1)
- [x] **T6 · Un paso no completado no tiene respuesta** — XS — dep: T2
  `components/workflow/workflow-review.tsx`, `components/workflow/step-value.tsx`
  - [x] PENDING/SKIPPED → "Sin registrar" / "Omitido", nunca el blob de metadata
  - [ ] Conteo de inventario sigue mostrando su cantidad — **no verificable en esta base**: no hay
        instancias con `systemQuantity`. `StepValue` desenvuelve `{systemQuantity,itemId,inputValue}` y
        muestra `inputValue` como respuesta con "En sistema: N" como contraste; falta confirmarlo con un
        conteo real.
  - [x] Registrar seguimiento en `PROJECT_CONTEXT.md`: pre-siembra de `value` en `createExecution`

### ✅ Checkpoint 2
- [x] `pnpm build` limpio (con `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1`)
- [x] Sucursal real, orden estable, sin valores fantasma
- [x] **Ejecutar T11 aquí** — la suite debe estar verde antes de abrir la Fase 3

## Fase 3 — Congelar la definición (migración)

- [x] **T7 · Migración 0050** — S — dep: CP2
  `lib/db/schema.ts`, `drizzle/0050_*.sql`
  - [x] `step_order`, `title`, `type`, `definition` — todas nullable
  - [x] ⚠️ Verificar que está **aplicada en la base**, no sólo commiteada
- [x] **T8 · `createExecution` congela la definición** — S — dep: T7
  `lib/services/workflow-execution-service.ts`, `lib/services/stock-count-service.ts`
  - [x] Escribe desde los `steps` ya expandidos (único punto donde los dinámicos existen completos)
  - [x] ⚠️ **Segunda ruta de creación encontrada:** `StockCountService.startStockCount` inserta sus propios
        pasos por SKU. Congela también, si no los conteos nuevos seguían perdiendo el título.
- [x] **T9 · Backfill de instancias existentes** — M — dep: T8
  `scripts/backfill-step-definitions.ts` (nuevo), `package.json`
  - [x] Idempotente; informe de irrecuperables; jamás toca `value`/`comment`/`evidence_url`/`ai_analysis`
  - [x] Probar antes de escribir — se corrió en modo simulación contra la misma base (no rama de Neon):
        567 instancias / 4385 pasos / 15 irrecuperables, y la re-ejecución reportó 0 filas
- [x] **T10 · El resolver prefiere lo congelado** — S — dep: T9
  `lib/workflows/step-definitions.ts`
  - [x] Editar la plantilla no altera una revisión ya ejecutada
  - [x] Fallback al template sin regresión

## Fase 4 — Prueba

- [x] **T11 · Actualizar la suite E2E existente** — M — dep: T4 (ejecutar en CP2)
  `tests/workflow-review.spec.ts`, `tests/support/db.ts`
  - [x] ⚠️ Los 4 tests actuales **fallarán** tras la Fase 1: 4 tabs (`:174-191`), `"Valor Registrado:"` (`:217`), `aria-expanded="false"` (`:211`)
  - [x] Conservar la cobertura de numeración canónica sobre los tabs restantes
  - [x] Camino de teclado sobre un paso **sin** hallazgo (llega colapsado)
  - [x] `seedReviewInstance` siembra `type`/`unit`/`validation` reales
  - [x] Nuevos casos: paso sin definición degradado; `NUMBER` fuera de rango marcado
- [x] **T12 · E2E dinámicos y durabilidad** — M — dep: T10, T11
  `tests/workflow-review.spec.ts`, `tests/support/db.ts`
  - [x] Editar plantilla ≠ alterar revisión ejecutada
  - [x] Pasos dinámicos con título real

### ✅ Checkpoint 3 — Completo
- [x] `pnpm build` verde (exit 0) · `tsc --noEmit` limpio · sin errores de lint nuevos
- [x] `pnpm test:e2e tests/workflow-review.spec.ts` verde
- [x] Migración 0050 verificada como aplicada
- [x] Backfill ejecutado, informe archivado
- [x] Seguimientos en `PROJECT_CONTEXT.md` (pre-siembra de `value`; export PDF de la bitácora)
- [ ] Humano aprueba antes de merge

## Preguntas abiertas (bloquean tareas concretas)

1. **¿Backfill de todo el histórico o sólo de lo no revisado?** → bloquea T9. Se decide al llegar a la
   Fase 3.
2. **Ejecutar el backfill contra producción** requiere confirmación explícita en el momento; primero rama
   de Neon + informe.
