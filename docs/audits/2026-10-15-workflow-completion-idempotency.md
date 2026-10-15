# Auditoría de Conexión: C27 — Hacer única la transición de finalización (H10)

**Fecha:** 15 de octubre de 2026  
**Tarea:** C27 — Hacer única la transición de finalización  
**Fase:** Fase 4 — Workflows y verificación  
**Hallazgos atendidos:** H10 (Transiciones de estado no atómicas; efectos secundarios duplicados ante completados concurrentes o reintentos)  
**Dependencias:** C24 (Contrato del paso en servidor; instancia terminal bloquea modificaciones con 409)

---

## 1. Contexto y Problema

En la auditoría de conexión [docs/audits/2026-10-10-backend-frontend-wiring-audit.md](2026-10-10-backend-frontend-wiring-audit.md), el hallazgo **H10** documentó que la transición de una instancia de workflow a estado `COMPLETED` no estaba protegida contra concurrencia:

> *"La ruta PATCH de pasos y el servicio de ejecución actualizan el estado sin garantía de unicidad. Dos peticiones concurrentes que completan el último paso dispararían dos veces las acciones de terminación (inventario, notificaciones, extractores) y enviarían el evento de Inngest dos veces."*

Concretamente, en `lib/services/workflow-execution-service.ts`, el método privado `checkProgress` era invocado desde `updateStep` cada vez que un paso pasaba a `COMPLETED`. Cuando todos los pasos de la instancia estaban `COMPLETED`/`SKIPPED`, ejecutaba sin protección:

1. `WorkflowActionRunner.runCompletionActions` — deducciones de inventario, reclamaciones a proveedores, notificaciones.
2. `StockCountService.completeStockCount` — cierre de conteo de inventario.
3. `SmartLinkService.markUsedForInstance` — anulación de enlaces inteligentes.
4. `inngest.send(workflowInstanceCompleted)` — extracciones de recepción, conteo, merma y producción.

Si dos peticiones concurrentes completaban el último paso (pasos diferentes de la misma instancia), ambas leían `allCompleted = true`, ambas corrían los efectos secundarios y ambas escribían `status = 'COMPLETED'`. Además, un reintento de cliente sobre una instancia ya cerrada volvía a disparar los efectos.

---

## 2. Arquitectura de la Solución

### A. Fast-path idempotente en `checkProgress` (`lib/services/workflow-execution-service.ts`)

Antes de tocar la base, `checkProgress` lee el estado actual de la instancia:

- Si la instancia **no existe**: retorna `notFound: true`, sin efectos.
- Si la instancia **ya está `COMPLETED`**: retorna `alreadyCompleted: true` y **no ejecuta ningún efecto secundario** (inventario, notificaciones, smart links ni Inngest). Respuesta idempotente ante llamadas duplicadas.

### B. Bloqueo asesor por instancia dentro de una transacción

Cuando la instancia no está cerrada, `checkProgress` envuelve la transición en una transacción con `pg_advisory_xact_lock(hashtextextended(instanceId, 0))`, el mismo patrón usado por C11 (turnos) y tesorería. Esto serializa las transiciones concurrentes a `COMPLETED` sobre la misma instancia.

Dentro del bloqueo se realiza una **doble comprobación**: se vuelve a leer la instancia y, si otra transacción ya la marcó `COMPLETED`, se retorna `alreadyCompleted: true` sin efectos.

### C. Transición atómica con condición de estado

El `UPDATE` a `COMPLETED` lleva la condición `status != 'COMPLETED'`:

```sql
UPDATE workflow_instances
SET status = 'COMPLETED', completed_at = now(), score = $1
WHERE id = $2 AND status != 'COMPLETED'
RETURNING *;
```

Si otra transacción ya la cerró, **0 filas** se actualizan y `updated` es `undefined`. En ese caso:
- No se envía el evento Inngest `workflowInstanceCompleted` (queda protegido por `if (updated)`).
- No se re-ejecuta `WorkflowActionRunner` ni `SmartLinkService` (ya corrieron una vez).

El `id` del evento Inngest (`workflow-extractors:${instanceId}`) conserva su dedupe de 24h como red adicional.

### D. Resultado estructurado

`checkProgress` devuelve un objeto `CheckProgressResult` con `{ completed, alreadyCompleted, blocked, notFound, score }`, consumido por `recalculateProgress` (usado por `IncidentEngine` al resolver un incidente bloqueante). El llamador `updateStep` ignora el valor (compatibilidad), pero el resultado permite distinguir "cerrado ahora" de "ya estaba cerrado".

---

## 3. Pruebas y Evidencia de Verificación

### Nivel 1: Pruebas Unitarias Aisladas (V1)
Archivo: `tests/unit/workflows/completion-idempotency.test.ts`  
**4 pruebas ejecutadas y aprobadas:**

1. **Completar el último paso ejecuta efectos secundarios exactamente una vez:** `WorkflowActionRunner.runCompletionActions`, `SmartLinkService.markUsedForInstance` e `inngest.send` se invocan una sola vez; `StockCountService.completeStockCount` no se llama cuando no aplica.
2. **Llamada duplicada o concurrente no vuelve a disparar efectos secundarios (idempotente):** `Promise.all` con dos completados concurrentes del último paso deja la instancia en `COMPLETED` y los efectos secundarios se ejecutan una única vez.
3. **`recalculateProgress` sobre instancia ya `COMPLETED` es idempotente:** el fast-path de `checkProgress` retorna `alreadyCompleted: true` sin ejecutar efectos secundarios.
4. **No todos los pasos completos no dispara efectos de terminación:** instancia queda `IN_PROGRESS`, sin acciones de cierre ni evento Inngest.

**Suite completa de workflows:** 16 archivos, 165 pruebas aprobadas sin regresiones.  
**Tests preexistentes de C24 (`step-contract-service.test.ts`):** actualizados para mockear `db.transaction`/`db.execute` (ahora usados por `checkProgress`) y seguir pasando (10 pruebas).

### Nivel 3: Base de Datos Real Neon Postgres (V3)
Script: `scripts/verify-workflow-completion-idempotency.ts`  
**Comprobaciones superadas con éxito contra base viva de Neon Postgres:**

1. **Completar solo el paso 1 de 2:** instancia queda `IN_PROGRESS`, sin efectos de cierre.
2. **Completar el paso 2 y un duplicado concurrentes:** instancia llega a `COMPLETED` con `completedAt` establecido; `completedAt` no nulo; ambas peticiones concurrentes devuelven el paso `COMPLETED` sin error de terminal; el bloqueo asesor serializó la transición.
3. **Completar sobre instancia ya `COMPLETED`:** rechazado por contrato (`WORKFLOW_TERMINAL` / `STEP_ALREADY_COMPLETED`), sin efectos secundarios duplicados.
4. **Sin filas duplicadas ni escrituras parciales:** exactamente una fila por paso, `paso-dos` en estado `COMPLETED`.
5. **Limpieza integral:** todos los registros de prueba (`companies`, `branches`, `users`, `workflow_templates`, `workflow_instances`, `workflow_instance_steps`) purgados sin residuos en Neon.

---

## 4. Archivos Modificados y Creados

| Archivo | Estado | Descripción |
| --- | --- | --- |
| `lib/services/workflow-execution-service.ts` | Modificado | `checkProgress` reescrito con fast-path idempotente, `pg_advisory_xact_lock` por instancia, doble comprobación dentro del bloqueo y `UPDATE ... WHERE status != 'COMPLETED'` atómico. `recalculateProgress` devuelve `CheckProgressResult`. |
| `tests/unit/workflows/completion-idempotency.test.ts` | Creado | 4 pruebas de unidad cubriendo cierre único, idempotencia concurrente, fast-path ya-completado y no-cierre sin todos los pasos. |
| `tests/unit/workflows/step-contract-service.test.ts` | Modificado | Añadidos mocks de `db.transaction` y `db.execute`; `cortarEnUpdate` conserva una única instancia de mock para no alterar aserciones preexistentes. |
| `scripts/verify-workflow-completion-idempotency.ts` | Creado | Script de ciclo de vida completo y concurrencia contra Neon Postgres viva. |
| `docs/audits/2026-10-15-workflow-completion-idempotency.md` | Creado | Documentación de evidencia de auditoría para C27 (este archivo). |

---

## 5. Estado de Criterios de Aceptación (C27)

- [x] **La transición a `COMPLETED` se ejecuta una sola vez por instancia** (`pg_advisory_xact_lock` + condición de estado `status != 'COMPLETED'`). Verificado en V1 (pruebas de unidad) y V3 (concurrencia contra Neon).
- [x] **Solicitudes duplicadas o concurrentes reciben respuesta idempotente sin reinvocar hooks ni acciones de terminación.** Verificado en V1 (fast-path + doble comprobación) y V3 (duplicado concurrente).
- [x] **Los efectos secundarios de finalización quedan registrados de manera trazable.** Evento Inngest con dedupe de 24h (`workflow-extractors:${instanceId}`), smart links marcados `USED` y `completedAt` persistido. Verificado en V3 contra Neon.

**Punto de control C24–C28:** C24–C27 completadas y verificadas. Siguiente tarea: **C28 — Garantizar entrega de eventos y mostrar efectos pendientes**.

---

## 6. Límites Registrados

- El fast-path idempotente de `checkProgress` solo se alcanza por `updateStep` si la instancia leída al inicio todavía no está `COMPLETED`; de lo contrario `validarContratoDePaso` (C24) rechaza con `WORKFLOW_TERMINAL` antes de invocar `checkProgress`. La idempotencia bajo concurrencia es la vía real de protección (criterio 1 y 2).
- `WorkflowActionRunner.runCompletionActions` falla en silencio (try/catch) si una acción de terminación cae; el cierre de la instancia no se bloquea por ello. El fallo se registra en consola y `scripts/audit-extractores-perdidos.ts` cubre la detección de extracciones pendientes.
- El envío del evento Inngest depende de que `UPDATE` devuelva una fila (`updated`). Si dos tx compiten, solo la que marca `COMPLETED` envía el evento; el id de dedupe de 24h evita doble extracción incluso si el envío falla y se reintenta.

---

**Estado de C27: Completada y verificada (V1 y V3 contra Neon Postgres).** Puerta de Fase 4 pendiente de C28.
