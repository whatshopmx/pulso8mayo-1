# Implementation Plan: Recepción de Mercancía vía Workflow (v3)

## Overview

Cerrar el hueco entre el workflow de recepción de mercancía y el inventario: hoy el
template `tpl-recepcion-mercancia-v2` solo hace inspección de calidad NOM-251 y el
extractor (`receiving-from-workflow.ts`) registra el reporte con `items: []`, así que
**nunca mueve stock ni actualiza la orden de compra**. La ruta UI
(`/dashboard/inventory/receiving` → `/api/inventory/receiving`) sí lo hace pero vive
fuera del flujo de workflows.

La solución: un **template v3** que se lanza desde una Orden de Compra pendiente,
expande pasos dinámicos por cada ítem de la OC (cantidad recibida, lote, caducidad,
costo unitario) usando el motor `metadata.dynamicSource` existente, y un extractor que
construye el `items[]` real y llama a `processReceiving` → stock, lotes, costeo y
cantidades recibidas de la OC se actualizan solos.

## Architecture Decisions

- **La OC se elige al lanzar, no dentro del workflow.** La expansión dinámica ocurre en
  `createExecution`, antes de cualquier respuesta. Preseleccionar la OC en el momento de
  crear la instancia permite filtrar `dynamicSource` por ella sin inventar expansión
  perezosa (lazy) mid-instancia, que sería mucho más invasiva.
- **Nueva entidad dinámica `purchase_order_item`** en `lib/workflows/dynamic-steps.ts`,
  siguiendo el patrón exacto de `inventory_item` / `recipe`: join
  `purchase_orders × purchase_order_items × inventory_items`, scoping por companyId,
  sub-pasos con id `{paso}-{poItemId}` y `entityId` en metadata.
- **Template v3 nuevo**, v2 intacta: quien solo quiera inspección sigue teniendo la
  versión ligera. El extractor mantiene compatibilidad con ambos IDs.
- **Persistencia vía `processReceiving`** (single source ya extraída en Fase 5): el
  extractor no duplica lógica de stock/lotes/costeo/3-way-match; solo traduce respuestas
  de pasos al body validado por Zod.
- **Sin migraciones de BD**: todo usa tablas existentes (`purchase_order_items`,
  `receiving_reports`, `receiving_report_items`, `workflow_*`).

## Task List

### Phase 1: Foundation

- [ ] **Task 1: Entidad dinámica `purchase_order_item`** — Tipos (`DynamicSourceEntity`,
      filtro `purchaseId`) + resolver en `dynamic-steps.ts` con interpolación
      `{{orderedQty}}` + contexto `purchaseId` en `resolveDynamicSteps` y
      `createExecution`.

### Checkpoint: Foundation
- [ ] `pnpm run build` pasa; los templates existentes (conteo, merma, producción) no cambian de comportamiento.

### Phase 2: Core Features

- [ ] **Task 2: Template v3** — `templates/inventory/recepcion-mercancia-v3.json` con
      inspección NOM-251 heredada de v2 + 4 pasos dinámicos por ítem de la OC +
      total de factura; registro en `templates/index.ts`.
- [ ] **Task 3: Lanzador desde OC** — `purchaseId` aceptado por
      `/api/workflows/execute` (validación de OC pendiente + tenant) y botón
      "Recibir mercancía" en `app/dashboard/inventory/purchase-orders/[id]/page.tsx`.
- [ ] **Task 4: Extractor v3** — `receiving-from-workflow.ts` maneja v3: mapea
      sub-pasos `rec-*` → `items[]` (itemId vía `purchase_order_items`) →
      `processReceiving` con `purchaseOrderId` y `supplierId` de la OC.

### Checkpoint: Core Features
- [ ] Flujo end-to-end manual: OC pendiente → botón → instancia con pasos por ítem → completar → stock incrementado, lotes creados, OC actualizada.

### Phase 3: Polish

- [ ] **Task 5: Verificación** — `pnpm run lint`, `pnpm run build`; spec E2E basada en
      `tests/conteo-dinamico.spec.ts` si el harness de BD está disponible.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| OC con muchos ítems infla el stepper (>30 pasos × 4 capturas) | Med | Reutilizar `MAX_DYNAMIC_STEPS`; las OCs HORECA típicas tienen <20 líneas |
| Cantidades parciales rompen `recordReceivedQuantity` | Alto | `processReceiving` ya maneja discrepancias QUANTITY; probar parcial en verificación |
| Unidades distintas entre captura y base del ítem | Medio | `processReceiving` ya convierte vía `UnitConversionService`; pasar `unit` del ítem |
| Doble recepción de la misma OC por reintentos de Inngest | Alto | Idempotencia existente (`instance:{id}` en notes) + estado de la OC |
| `WorkflowStepType` duplicado en 7 archivos | Bajo | No se añade ningún tipo nuevo; solo entidades dinámicas |

## Open Questions

- Ninguno bloqueante. Decisions tomadas con el usuario: v3 nuevo, lanzamiento desde OC,
  captura completa por ítem.
