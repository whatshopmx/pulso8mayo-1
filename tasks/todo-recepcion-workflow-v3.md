# Todo: Recepción de Mercancía vía Workflow (v3)

Plan: `tasks/plan-recepcion-workflow-v3.md`

## Phase 1: Foundation
- [ ] **T1** — Entidad dinámica `purchase_order_item`: tipos (`lib/types/workflow.ts`), resolver con join OC×ítems (`lib/workflows/dynamic-steps.ts`), contexto `purchaseId` hasta `createExecution` (`lib/services/workflow-execution-service.ts`). Verificar: build pasa, comportamiento existente intacto.

## Checkpoint 1: build limpio

## Phase 2: Core Features
- [ ] **T2** — Template v3 `templates/inventory/recepcion-mercancia-v3.json` + registro en `templates/index.ts`. Verificar: aparece en la librería y sus pasos dinámicos se expanden contra una OC.
- [ ] **T3** — Lanzador: `purchaseId` en `/api/workflows/execute` + validación de OC + botón "Recibir mercancía" en detalle de OC. Verificar: crear instancia desde OC genera N×4 sub-pasos.
- [ ] **T4** — Extractor v3 en `lib/services/receiving-from-workflow.ts`: sub-pasos → `items[]` → `processReceiving`. Verificar: al completar, stock/lotes/OC actualizados; re-ejecución del extractor es no-op.

## Checkpoint 2: flujo end-to-end funciona

## Phase 3: Polish
- [ ] **T5** — `pnpm run lint` && `pnpm run build`; spec E2E opcional basada en `tests/conteo-dinamico.spec.ts`.
