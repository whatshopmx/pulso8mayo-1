# Plan: smart link en todos los flujos asignados, no sólo capacitación

**Fecha:** 2026-08-09
**Estado:** implementado (sin commitear en `feat/motor-incidentes`) — 4.1–4.4, 5.1, 5.2, 5.4, 5.5; 5.3 fuera de alcance
**Origen:** revisión de `/dashboard/workflows` (ver `.impeccable/critique/2026-08-09T13-39-04Z__app-dashboard-workflows.md`)

## 1. Objetivo

Que cualquier flujo programado que se asigne a una persona salga por WhatsApp **con un enlace en el que pueda trabajar**, sin iniciar sesión. Hoy eso sólo ocurre con las plantillas de capacitación; el resto recibe un mensaje que lo manda al dashboard.

Es el cierre del modelo operativo real: WhatsApp como canal de aviso y el smart link como terminal de ejecución para quien no se sienta frente a una computadora.

## 2. Estado actual (verificado en código)

La cadena existe y **funciona** hasta el último tramo:

| Paso | Dónde | Estado |
|---|---|---|
| Builder guarda horario, rol y turno | `workflow-settings-modal.tsx` → `/api/templates/[id]/settings` → `workflow_schedules` | ✅ |
| Cron cada 5 min | `lib/inngest/functions/cron-execute-schedules.ts` → `lib/cron/execute-schedules.ts:19` | ✅ |
| Crea la ejecución con `scheduleId` | `workflow-schedule-service.ts:308-315` | ✅ |
| Resuelve destinatario (USER / ROLE / AUTO) | `workflow-assignment-service.ts:145-169` | ✅ |
| Envía notificación | `execute-schedules.ts:53-66` | ✅ |
| El evento `workflow_assignment` tiene canal WhatsApp y plantilla en español | `notification-dispatcher.ts:93-94` | ✅ |
| **La plantilla incluye un enlace ejecutable** | — | ❌ |

### Los tres defectos concretos

1. **La plantilla no lleva enlace.** `notification-dispatcher.ts:94` termina en *"Por favor, revisa tu dashboard para más detalles."* El destinatario típico no tiene dashboard.

2. **El `actionUrl` apunta a una ruta inexistente.** `execute-schedules.ts:59` usa `/dashboard/workflows/${instance.id}`. Bajo `app/dashboard/workflows/[id]/` sólo existe `execute/`; no hay `page.tsx` en `[id]`, así que ese enlace da **404**.

3. **El smart link está detrás de un `if` de capacitación.** `workflow-assignment-service.ts:95-113`: se genera sólo si `template.category` es `TRAINING`/`CAPACITACION` o el nombre contiene "capacitación".

### Lo que ya está resuelto y no hay que rehacer

- El mecanismo de plantilla con enlace ya existe: `{smartLinkUrl}` se usa en `shift_change_request`, ausencia de empleado, anuncios y `training_assignment`. La sustitución es genérica sobre `metadata`.
- `magic_links.session_id` ya es nullable (migración `0044`). Antes era `uuid NOT NULL` y los llamadores metían `''` / `'default'` / un id de usuario, lo que reventaba el INSERT para todo flujo que no colgara de un turno. **Sin ese arreglo este plan no funciona.**
- Los enlaces **no son de un solo uso**: `validateSmartLink` exige `status='PENDING'` y no vencido, y nada llama a `markSmartLinkUsed` salvo `refreshSmartLink`. Un empleado puede abrir, interrumpirse y volver. Es el comportamiento correcto para el caso de uso.

## 3. Decisión de diseño

**Generar el enlace en `assignWorkflow()`, no en el cron.**

`autoAssignWorkflow()` (cron) llama a `assignWorkflow()`, y ahí ya vive el bloque de capacitación. Poniéndolo en `assignWorkflow`:

- se cubre igual la asignación automática por horario y la asignación manual;
- se elimina la duplicación por construcción — si se pusiera en el cron, las plantillas de capacitación generarían **dos** enlaces;
- queda un solo lugar donde se decide vigencia y contenido.

La alternativa (hacerlo en `execute-schedules.ts`) sólo cubriría lo programado y obligaría a mantener dos rutas.

## 4. Cambios por archivo

### 4.1 `lib/services/workflow-assignment-service.ts`

Quitar el `if (isTraining)` de `assignWorkflow()` y generar el enlace **siempre** que haya destinatario:

- Vigencia atada a `dueDate` en vez de constantes (`7 días` en capacitación, `24 h` en el generador manual): `expiresInMinutes = minutos hasta dueDate + margen de 12 h`, con piso de 2 h y techo de 30 días. Un flujo de cierre que vence a las 23:00 no debe traer un enlace de 7 días.
- Pasar `assignedTo` y `assignmentId` a `createSmartLink` (parámetros que ya acepta) para que el token lleve el contexto.
- Conservar el `eventType: 'training_assignment'` cuando la plantilla sea de capacitación; para el resto usar `workflow_assignment`. Cambia el enlace, no la voz del mensaje.
- **La generación del enlace no puede tumbar la asignación.** Envolver en `try/catch`: si falla, se registra y la notificación sale sin enlace (ver 5.4).

### 4.2 `lib/services/notification-dispatcher.ts`

- Añadir `{smartLinkUrl}` a la plantilla WhatsApp de `workflow_assignment` (línea 94), sustituyendo el cierre *"revisa tu dashboard"* por *"Ábrelo y complétalo desde tu teléfono:"*.
- Lo mismo en `workflow_reminder` (línea 106) y `workflow_overdue` (línea 118): un recordatorio de algo vencido sin enlace obliga a buscar la tarea a mano.
- Declarar `smartLinkUrl` en el arreglo `variables` de esos tres eventos.
- Ajustar `emailBody` de los tres para incluir el enlace como `<a>`.

### 4.3 `lib/cron/execute-schedules.ts`

- Corregir `actionUrl` a `/dashboard/workflows/${instance.id}/execute` (línea 59).
- ~~Pasar `metadata.smartLinkUrl` con el enlace que devolvió la asignación~~ **ajustado en implementación:** el bloque de notificación del cron se eliminó — `assignWorkflow` ya envía la notificación con enlace (4.1); las dos llamadas con el mismo `eventType` duplicaban el WhatsApp/email/in-app para todo flujo programado.

### 4.4 Recordatorios y vencidos

`cron-workflow-reminders.ts`, `cron-check-overdue.ts` y `cron-overdue-workflows.ts` envían sobre una ejecución que **ya tiene** enlace. Deben **reutilizar** el vigente, no emitir uno nuevo en cada recordatorio:

- buscar en `magic_links` el registro de esa `instanceId` con `status='PENDING'` y `expiresAt > now()`;
- si existe, reutilizar; si venció, `refreshSmartLink()`;
- si no hay ninguno (ejecuciones creadas antes de este cambio), generar uno.

Conviene un helper `SmartLinkService.getOrCreateForInstance(instanceId, templateId, opts)` que encapsule esas tres ramas, y que `assignWorkflow` también use.

## 5. Riesgos y casos borde

### 5.1 Idempotencia del cron

Todo el cuerpo de `executeScheduledWorkflows()` corre dentro de un solo `step.run` (`cron-execute-schedules.ts:11`). Si Inngest reintenta tras un fallo parcial, se repite ejecución + asignación + enlace. Es un riesgo **preexistente** que este cambio amplifica (ahora también duplicaría enlaces).

Mitigación mínima: antes de `executeSchedule`, comprobar que no exista ya una ejecución de ese `scheduleId` dentro del día local de la sucursal — la misma consulta que usa `WorkflowTodayService`. `getOrCreateForInstance` cubre la parte del enlace.

### 5.2 Sucursal sin usuario elegible

`autoAssignWorkflow` lanza `'No suitable user found for assignment'` (`workflow-assignment-service.ts:160`). El cron lo atrapa, cuenta un error y **sigue**: la ejecución queda creada, sin asignar y sin avisar a nadie. En el tablero nuevo aparecerá como pendiente y luego vencida, que es lo correcto, pero nadie recibe aviso.

**Implementado:** aviso al GERENTE de la sucursal (`notifyManagerUnassigned`):

- El cron detecta el fallo **por identidad** del error (`NO_SUITABLE_USER_ERROR`, exportado por el servicio) y, si la ejecución ya se creó, llama al método — otros fallos (DB, red) no disparan el aviso.
- `notifyManagerUnassigned` busca GERENTE de la sucursal (fallback SUPERVISOR/ADMIN), resuelve nombre de sucursal y plantilla, y envía el nuevo evento `workflow_unassigned` (WhatsApp + email + in-app) con enlace **absoluto** al `/dashboard/workflows/{id}/execute` — el gerente sí tiene login; el smart link público no aplica porque no hay destinatario.
- Nuevo evento en el dispatcher (plantilla WhatsApp con `{scheduleTitle}`/`{branchName}`/`{smartLinkUrl}`, email dedicado `sendWorkflowUnassignedEmail`, in-app) y en el router (priority `high`, `businessHoursOnly: false` a propósito: un turno de cierre que no encontró nadie no puede esperar a la mañana).
- **Un solo aviso por programación y por día**: si el cron reintenta (Inngest step.run) o corre otra vez, el dedup de 5.1 ve la instancia ya creada y avanza el schedule sin re-avisar.
- Si la sucursal no tiene ni gerente ni supervisor/admin, se registra un warning y no se envía (no hay a quién).

### 5.3 Rol con varias personas

`findUserByRole` devuelve **un** usuario. Si el turno tiene tres cocineros con el mismo rol, sólo uno recibe el WhatsApp. Es el comportamiento actual y este plan no lo cambia; si se quiere repartir a todos, es un cambio de modelo de asignación (uno-a-muchos), no de notificación.

### 5.4 Variable sin valor deja el literal en el mensaje

`replaceTemplateVariables` (`notification-dispatcher.ts:682-694`) sólo sustituye las claves presentes en `variables`. Si `smartLinkUrl` no llega, el WhatsApp sale con el texto literal `{smartLinkUrl}`.

Dos medidas, ambas necesarias:
- que el dispatcher limpie cualquier `{...}` sin resolver antes de enviar;
- que la plantilla degrade con sentido: si no hay enlace, no dejar una frase colgando ("Ábrelo aquí:" seguido de nada).

### 5.5 Seguridad del enlace

El enlace da acceso sin autenticación a una ejecución concreta. Con la vigencia atada a `dueDate` la ventana se acorta respecto de los 7 días actuales de capacitación. **Decisión tomada en implementación (ambas):**

- **Marcar el enlace como usado al completar el flujo ✅** — `SmartLinkService.markUsedForInstance(instanceId)` marca USED todos los PENDING de la instancia al cerrar (preservando `usedAt` con `coalesce`). Se llama desde `checkProgress` en el branch COMPLETED. Además `getOrCreateForInstance` rehúsa crear/reutilizar enlaces para instancias COMPLETED (no se resucitan).
- **Registrar la apertura ✅** — `SmartLinkService.recordOpen(token)` llena `usedAt` la primera vez (`coalesce`, sin tocar status: el enlace sigue siendo reabrible). Se llama desde la página `/workflow/public/[token]` y desde el GET `/api/workflows/public/[token]`, **después** de los checks de acceso (un 403 no cuenta como apertura). Para NOM, `magic_links.usedAt` ya distingue qué enlace se abrió.

## 6. Verificación

1. Programar una plantilla **no** de capacitación con hora a 5 minutos y rol asignado.
2. Confirmar que el cron crea ejecución, asignación y **un** registro en `magic_links` con `session_id` nulo.
3. Confirmar que el WhatsApp llega con enlace y **sin** literales `{...}`.
4. Abrir el enlace en sesión privada: debe permitir ejecutar sin login.
5. Cerrar y reabrir el mismo enlace: debe seguir funcionando (no es de un solo uso).
6. Dejar pasar el recordatorio: debe reutilizar el mismo token, no crear otro.
7. Comprobar que el `actionUrl` in-app abre `/execute` y ya no da 404.
8. Plantilla de capacitación: debe seguir con su propia voz y **un solo** enlace.

## 7. Fuera de alcance

- Reparto a varios destinatarios por rol (5.3).
- Idempotencia general del cron más allá de la comprobación puntual de 5.1.
- Unificar `SmartLinkGenerator` (sigue en inglés, con modal anidado, en `templates-tab.tsx` y `app/dashboard/execute/page.tsx`).

## 8. Dependencias

- `drizzle/0044_smartlink-session-optional.sql` **aplicada**. Sin ella, generar enlaces fuera de un turno falla.
- `drizzle/0043_workflow-review-fields.sql` aplicada (no bloquea este plan, pero está pendiente en la misma tanda).
