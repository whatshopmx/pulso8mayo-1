# Plan de Migración: workflow-sdk → Inngest

## Resumen

Migrar las 7 funciones del workflow-sdk (`"workflow"` package) a Inngest durable functions. El proyecto ya tiene Inngest v4.1.0 configurado con 11 funciones cron — se extiende esa misma infraestructura.

---

## Fase 1 — Eventos nuevos

**Archivo:** `lib/inngest/events.ts`

Agregar tipos de evento para los nuevos workflows:

| Evento | Propósito |
|---|---|
| `shift/clock-in.requested` | Dispara clock-in workflow |
| `shift/clock-out.requested` | Dispara clock-out workflow |
| `shift/break.start.requested` | Dispara inicio de pausa |
| `shift/break.end.requested` | Dispara fin de pausa |
| `incident/detected` | Dispara escalación de incidente |
| `incident/escalation.requested` | Dispara cadena de escalación |
| `workflow/execution.timeout` | Marca workflow como expirado |

**Dependencias:** Ninguna

---

## Fase 2 — Labor Workflows (más simples)

**Archivo nuevo:** `lib/inngest/functions/labor-workflows.ts`

3 funciones Inngest:

#### 2a. `handleClockInWorkflowFn`
- Trigger: `shift/clock-in.requested`
- Steps:
  1. `step.run` — `getShiftWorkflowStep` (cargar turno + template)
  2. `step.run` — `registerClockInStep` (registrar entrada con geolocalización)
  3. `step.run` — `createWorkflowInstanceStep` (crear instancia si hay template)
  4. `step.run` — `generateSmartLinkStep` (generar link si hay instancia)
  5. `step.run` — `sendWhatsAppMessageStep` (notificar al usuario)

#### 2b. `handleClockOutWorkflowFn`
- Trigger: `shift/clock-out.requested`
- Steps:
  1. `step.run` — `endSessionStep` (cerrar sesión + geolocalización)
  2. `step.run` — `sendWhatsAppMessageStep` (enviar resumen)

#### 2c. `handleBreakStartWorkflowFn`
- Trigger: `shift/break.start.requested`
- Steps:
  1. `step.run` — `startBreakStep` (iniciar pausa)
  2. `step.run` — `sendWhatsAppMessageStep` (confirmar inicio)
  3. `step.sleep("30m")` — esperar 30 minutos
  4. `step.run` — `checkBreakStatusStep` + notificar si sigue en pausa

#### 2d. `handleBreakEndWorkflowFn`
- Trigger: `shift/break.end.requested`
- Steps:
  1. `step.run` — `endBreakStep` (finalizar pausa)
  2. `step.run` — `sendWhatsAppMessageStep` (confirmar fin + duración)

**Dependencias:** Fase 1 (eventos)

---

## Fase 3 — Incident Escalation

**Archivo nuevo:** `lib/inngest/functions/incident-escalation.ts`

2 funciones:

#### 3a. `handleIncidentWorkflowFn`
- Trigger: `incident/detected`
- Steps:
  1. `step.run` — `loadIncidentStep`
  2. `step.run` — `findSupervisorStep` + notificar
  3. `step.sleep("30m")` — esperar resolución
  4. `step.run` — `checkIncidentStatusStep`
  5. Si no resuelto: `step.run` — escalar + notificar manager

#### 3b. `incidentEscalationChainFn`
- Trigger: `incident/escalation.requested`
- Steps (dinámicos según `event.data.chain`):
  1. Loop sobre cada nivel: `step.sleepUntil` + `step.run` para ejecutar nivel
  2. Cada nivel: notificar roles vía `EscalationService`
- Usa retry por nivel con `NonRetriableError` si el incidente ya está resuelto

**Dependencias:** Fase 1 (eventos)

---

## Fase 4 — Workflow Executor (más complejo)

**Archivo nuevo:** `lib/inngest/functions/workflow-executor.ts`

1 función:

#### `executeWorkflowFn`
- Trigger: `workflow/execution.created`
- Steps:
  1. `step.run` — `loadWorkflowInstance`
  2. `step.run` — `markWorkflowStarted`
  3. `step.run` — `generateSmartlink`
  4. `step.run` — `sendWhatsAppNotification`
  5. `step.waitForEvent("wait-for-completion", { event: "workflow/step.completed", timeout: "2h", match: "data.instanceId" })` — Reemplaza todo el polling loop
  6. Si el evento llega:
     - `step.run` — `markWorkflowCompleted`
     - `step.run` — notificar éxito
  7. Si timeout (null):
     - `step.run` — `markWorkflowExpired`
     - `step.run` — notificar timeout
     - `step.sendEvent` — disparar `incident/escalation.requested`
- Config:
  - `timeouts: { finish: "2h" }`
  - `retries: 2`
  - `concurrency: 10`

**Dependencias:** Fase 1 (eventos)

---

## Fase 5 — Integración con entry points

#### 5a. Actualizar `lib/inngest/functions/index.ts`
- Exportar las 4 nuevas funciones (labor, incident, escalation, executor)

#### 5b. Actualizar `app/api/inngest/route.ts`
- Las nuevas funciones ya se sirven automáticamente (se registran en `app/api/inngest/route.ts` vía `Object.values(cronFunctions)`)
- Verificar que el import de funciones incluya las nuevas

#### 5c. Reemplazar `app/api/workflow/route.ts` (entry point legacy)
- Cambiar de `import { start } from "workflow/api"` a `inngest.send()`
- Mapear los workflow names a eventos Inngest
- Ejemplo: `executeWorkflow` → `inngest.send({ name: "workflow/execution.created", data: { ... } })`

#### 5d. Actualizar WhatsApp handlers (`lib/whatsapp/handlers/labor-handler.ts`)
- Reemplazar `start(handleClockInWorkflow, args)` con `inngest.send({ name: "shift/clock-in.requested", data: args })`
- Mismo patrón para clock-out, break-start, break-end

**Dependencias:** Fases 2, 3, 4

---

## Fase 6 — Limpieza

#### 6a. Remover dependencia `workflow`
- `package.json`: eliminar `"workflow": "4.1.0-beta.52"`
- Ejecutar `pnpm install`

#### 6b. Remover `withWorkflow` de Next.js
- `next.config.ts`: eliminar `import { withWorkflow } from "workflow/next"` y el wrapper

#### 6c. Eliminar archivos del workflow-sdk
- `app/workflows/` (directorio completo)
- `app/workflows/steps/` (directorio completo)
- `app/api/workflow/route.ts`
- `app/api/test-workflow/route.ts`
- `app/api/test-assignment/route.ts`
- `app/api/test-ai/route.ts`

#### 6d. Eliminar endpoints cron HTTP legacy
- `app/api/cron/` (directorio completo) — la lógica ya corre en Inngest

#### 6e. Verificar build
- `pnpm run build` — debe pasar sin errores
- Verificar que no queden imports a `"workflow"` en el codebase

**Dependencias:** Fases 5

---

## Orden de implementación sugerido

```
Fase 1 (eventos)
  └── Fase 2 (labor workflows) ────┐
  └── Fase 3 (incident escalation) ─┤
  └── Fase 4 (workflow executor) ───┤
                                     └── Fase 5 (entry points) ──┐
                                                                  └── Fase 6 (cleanup)
```

Cada fase es independiente después de Fase 1. Se pueden implementar en paralelo.

---

## Archivos a crear

| Archivo | Subtarea |
|---|---|
| `lib/inngest/functions/labor-workflows.ts` | Fase 2a-2d |
| `lib/inngest/functions/incident-escalation.ts` | Fase 3a-3b |
| `lib/inngest/functions/workflow-executor.ts` | Fase 4 |

## Archivos a modificar

| Archivo | Subtarea |
|---|---|
| `lib/inngest/events.ts` | Fase 1 |
| `lib/inngest/functions/index.ts` | Fase 5a |
| `app/api/inngest/route.ts` | Fase 5b |
| `app/api/workflow/route.ts` | Fase 5c |
| `lib/whatsapp/handlers/labor-handler.ts` | Fase 5d |
| `package.json` | Fase 6a |
| `next.config.ts` | Fase 6b |

## Archivos a eliminar

| Archivo | Subtarea |
|---|---|
| `app/workflows/` | Fase 6c |
| `app/api/cron/` | Fase 6d |
| `app/api/test-*.ts` | Fase 6c |
