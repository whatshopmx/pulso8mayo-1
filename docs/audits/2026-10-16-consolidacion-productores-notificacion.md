# C35 — Consolidación de productores de notificaciones

Fecha: 16 de octubre de 2026. Estado: **en curso** (C35.0 inventario cerrado; C35.1 primer lote migrado).

Plan: [conexión frontend/backend](../../tasks/plan-conexion-frontend-backend.md#c35). Seguimiento: [todo](../../tasks/todo-conexion-frontend-backend.md). Handoff: [cierre C35–C40](../../tasks/handoff-cierre-conexion-frontend-backend.md).

H09 encontró varias entradas de notificación que no compartían la misma decisión de envío. C32–C34 construyeron la ruta durable: un contrato único de preferencias, una sola política de canal (`lib/notifications/routing-policy.ts`) y un resultado verificable por canal con reintento memoizado. C35 migra los productores activos a esa ruta **de uno en uno**, sin cambiar todos a la vez.

La ruta destino es:

```
NotificationQueue.enqueue(payload)                     ← productores deben llamar esto
  → inngest.send({ name: "notification/dispatch.requested", id: "notification-dispatch:<id>", data })
  → lib/inngest/functions/notification-dispatch.ts
      step "plan-delivery"        → NotificationDispatcher.planDelivery  (decisión C33)
      step "deliver-<canal>" ×N   → NotificationDispatcher.deliverChannel (resultado C34)
```

`notificationIdFor(payload)` (`lib/notifications/notification-queue.ts`) deriva un id determinista: si existe `payload.metadata.dedupeKey`, usa `notif_<dedupeKey>`; si no, un hash estable del payload. Ese `dedupeKey` es la palanca de idempotencia del productor.

---

## C35.0 — Inventario de productores activos

Método: se recorrieron todos los archivos de `lib/` y `app/` que llaman a `NotificationDispatcher.sendNotification`, `NotificationDispatcher.sendBatchNotifications`, `NotificationRouter.sendWithRouting` o `NotificationQueue.enqueue`, y se extrajo el `eventType` de cada llamada. Se revisó además el registro de funciones Inngest (`lib/inngest/functions/index.ts`) para distinguir un productor con disparador real de uno huérfano.

### Ruta efectiva por productor

Leyenda de estado: **durable** = ya usa `NotificationQueue.enqueue`; **directo** = usa `NotificationDispatcher`/`NotificationRouter` de forma síncrona (candidato a migrar); **compat** = capa de compatibilidad sobre el dispatcher; **legacy** = implementación anterior con consumidores vivos (clasificar en C36); **huérfano** = sin consumidor interno ni registro.

| Productor | Evento(s) | Estado | Nota |
| --- | --- | --- | --- |
| `app/api/notifications/dispatch/route.ts` | cualquiera (payload del cliente) | durable | Ya llama `NotificationQueue.enqueue`. Punto de entrada genérico. |
| `app/api/notifications/process/route.ts` | cualquiera | compat | Shim QStash sobre `sendWithRouting`. Decidir en C36 si sigue vivo. |
| `lib/notifications/notification-router.ts` | cualquiera | compat | `sendWithRouting` delega en el dispatcher; no decide por su cuenta (C33). |
| `lib/services/whatsapp-notification-service.ts` | `workflow_assignment`, `stock_alert`, `incident`, `shift_reminder`, `workflow_overdue` | legacy | `@deprecated`, envuelve al dispatcher y tiene `isDigitalDisconnectActive` roto (`db.query` mal usado). Clasificar en C36. |
| `lib/services/notification-service.ts` | (tipo propio) | legacy | Conserva su propio tipo `NotificationPreferences` y el bug de `set`. Consumidores vivos: `performance-reminder-service.ts` y `app/api/performance/goals/route.ts`. Clasificar en C36. |
| `lib/cron/shift-reminders.ts` | `shift_reminder` | **huérfano** | `sendShiftReminders` **no está importado por ninguna función Inngest, ruta ni acción**. No hay disparador. No se migra: se clasifica en C36/C38. |
| `lib/cron/check-overdue.ts` | `workflow_overdue` | directo → **migrado (C35.1)** | Registrado como `cronCheckOverdue` (`0 * * * *`). |
| `lib/cron/workflow-reminders.ts` | `workflow_due_soon` | directo → **migrado (C35.1)** | Registrado como `cronWorkflowReminders` (`0 * * * *`). Lleva seguimiento `remindersSent` por intervalo. |
| `lib/cron/send-reminders.ts` | `workflow_due_soon` | directo (duplicado) | Registrado como `cronSendReminders` (`0 8 * * *`). Recordatorio diario grueso **sin seguimiento**: solapa con `workflow-reminders.ts` para las mismas asignaciones dentro de 24 h. Clasificar en C36/C38; no migrar mientras siga duplicando. |
| `lib/cron/imss-deadline-alerts.ts` | `imss_deadline` | directo | Registrado como `imssAlerts`. Usa `sendBatchNotifications`. |
| `lib/inngest/functions/cron-sales-cut-reminder.ts` | `sales_cut_missing` | directo | Cron. |
| `lib/inngest/functions/check-financial-alerts.ts` | `financial_kpi_deviation` | directo | Cron. |
| `lib/inngest/functions/generate-morning-brief.ts` | `morning_brief` | directo | Cron. |
| `lib/inngest/functions/emergency-departure-handler.ts` | `shift_approval_request` | directo | Reacción a evento. |
| `lib/inngest/functions/announcement-broadcast.ts` | `announcement_broadcast` | directo | Reacción a evento. |
| `app/api/shifts/route.ts` | `schedule_change` | directo | `sendBatchNotifications`. |
| `app/api/shift-sessions/route.ts` | `employee_absence` | directo | 3 llamadas. |
| `app/api/shift-change-requests/route.ts` | `shift_change_request`, `shift_change_decision` | directo | 4 llamadas. |
| `app/api/labor/breaks/send-reminder/route.ts` | `shift_reminder` | directo | |
| `app/api/labor/breaks/send-bulk-reminders/route.ts` | `shift_reminder` | directo | |
| `app/api/vacations/approve/route.ts` | `shift_approval_decision` | directo | |
| `lib/services/advanced-alert-service.ts` | `stock_alert` | directo | |
| `lib/services/break-reminder-service.ts` | `shift_reminder`, `incident` | directo | 3 llamadas. |
| `lib/services/cash-variance-alert-service.ts` | `cash_variance_detected`, `recurring_shortage_detected` | directo | 2 llamadas. |
| `lib/services/expense-service.ts` | `expense_approval_request`, `budget_threshold_reached` | directo | **No estaba en el inventario del handoff.** |
| `lib/services/insight-generator-service.ts` | `stock_alert` | directo | **No estaba en el inventario del handoff.** |
| `lib/services/overtime-alert-service.ts` | `incident` | directo | **No estaba en el inventario del handoff.** |
| `lib/services/payee-bank-account-service.ts` | `payee_bank_account_changed` | directo | **No estaba en el inventario del handoff.** |
| `lib/services/petty-cash-service.ts` | `stock_alert` | directo | **No estaba en el inventario del handoff.** |
| `lib/services/receiving-service.ts` | `incident` | directo | **No estaba en el inventario del handoff.** |
| `lib/services/shift-approval-service.ts` | `shift_approval_request`, `shift_approval_decision` | directo | **No estaba en el inventario del handoff.** |
| `lib/services/supplier-bank-account-service.ts` | `supplier_bank_account_changed` | directo | **No estaba en el inventario del handoff.** |
| `lib/services/workflow-action-runner.ts` | `workflow_assignment` | directo | |
| `lib/services/workflow-assignment-service.ts` | `workflow_unassigned` | directo | |
| `app/api/notifications/test-whatsapp/route.ts` | `workflow_assignment` | prueba | Prueba manual; no migrar sin decidir. |

### Hallazgos del inventario

1. **`lib/cron/shift-reminders.ts` es huérfano.** El handoff lo proponía como primer candidato, pero `sendShiftReminders` no lo importa nadie: no hay función Inngest que lo dispare, ni ruta, ni acción. Un productor sin consumidor no se "migra" — se retira o se conecta. Se registra para C36/C38 y se sustituye en el primer lote por `workflow-reminders.ts`.
2. **`send-reminders.ts` y `workflow-reminders.ts` son un duplicado histórico parcial.** Ambos producen `workflow_due_soon` para asignaciones dentro de las próximas 24 h. `workflow-reminders` es la versión refinada (intervalos escalonados 24 h/1 h/30 min con seguimiento `remindersSent`); `send-reminders` es un recordatorio diario de las 08:00 **sin seguimiento**, que puede volver a avisar de lo mismo que el escalonado. No son el mismo trabajo, pero solapan; se clasifican juntos y no se migra el duplicado mientras siga duplicando.
3. **El inventario del handoff estaba incompleto.** Faltaban ocho productores directos (`expense-service`, `insight-generator-service`, `overtime-alert-service`, `payee-bank-account-service`, `petty-cash-service`, `receiving-service`, `shift-approval-service`, `supplier-bank-account-service`). Con ellos, el universo de productores directos es de **32 archivos** (más los dos `compat`, dos `legacy` y el huérfano).
4. **`whatsapp-notification-service.ts` no es un productor paralelo, es una capa redundante.** Ya está marcado `@deprecated`, envuelve al dispatcher y contiene un `isDigitalDisconnectActive` que no funciona. No se migra: se clasifica en C36.

---

## C35.1 — Primer lote migrado

Productores: `lib/cron/check-overdue.ts` (`workflow_overdue`) y `lib/cron/workflow-reminders.ts` (`workflow_due_soon`). Ambos son cron, tienen una clave natural clara y no devuelven respuesta a un usuario, así que el cambio a durable es de bajo riesgo y demuestra el patrón.

Cambio por productor (patrón de la sección 2.3 del handoff):

1. `NotificationDispatcher.sendNotification(payload)` → `NotificationQueue.enqueue(payload)`.
2. `metadata.dedupeKey` con la clave natural:
   - `check-overdue`: `workflow-overdue:<assignmentId>`.
   - `workflow-reminders`: `workflow-due-soon:<assignmentId>:<reminderType>`.
3. El payload (destinatario, `actionUrl`, `metadata`) se conserva sin cambios de contenido.

### Verificación

V1/V3 en `tests/unit/notifications/producer-migration.test.ts`:

- Una ocurrencia produce **una** llamada a `inngest.send` con id determinista.
- Dos corridas de la misma ocurrencia producen el **mismo** id de evento (deduplicación de Inngest).
- El `dedupeKey` viaja en el payload y el id deriva de él (`notif_<dedupeKey>`).
- Un fallo de encolado no se cuenta como enviado: el productor lo registra como error y no marca `remindersSent`.

### Límites declarados

- El productor sólo **encola**; la entrega real la verifica C34 con adaptadores simulados. Este corte no levanta el runtime de Inngest.
- `send-reminders.ts` sigue directo y sigue solapando con `workflow-reminders.ts` hasta que C36/C38 decidan su retiro. El `dedupeKey` evita duplicados **dentro** de `workflow-reminders`, no entre los dos productores.
- `check-overdue.ts` marca `isOverdue` antes de encolar. Una caída entre la marca y el encolado no se recupera con el `dedupeKey` (el `isOverdue=false` impide re-seleccionar); es el mismo límite que ya tenía el cron y queda declarado.
