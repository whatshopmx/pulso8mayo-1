# Handoff — cierre de la conexión frontend/backend (C35 → C40)

**Creado:** 2026-10-16 · **Continúa desde:** C00–C34 completadas · **Siguiente tarea:** C35 (Fase 6)

Este documento arranca una sesión nueva para **cerrar** el plan de conexión. No reemplaza a las fuentes de verdad; es el atajo. Si algo aquí contradice al plan o al seguimiento, manda el plan/seguimiento.

| Fuente | Para qué |
| --- | --- |
| `tasks/todo-conexion-frontend-backend.md` | Estado real, una fila por tarea con evidencia y límites. **La fila de C34 y la lista de la Fase 6 son el punto de partida.** |
| `tasks/plan-conexion-frontend-backend.md` | Criterios de aceptación, dependencias y verificación de C35–C40. |
| `tasks/handoff-conexion-frontend-backend.md` | Handoff histórico largo (C00–C34). Aquí está la historia detallada y las trampas. |
| `docs/audits/2026-10-10-backend-frontend-wiring-audit.md` | Hallazgos H01–H12 que el plan cierra. H09 es el que gobierna C32–C35. |
| `lib/notifications/routing-policy.ts` · `lib/notifications/preferences-contract.ts` | La decisión única de canal y el contrato de preferencias (C32–C33). |
| `docs/audits/2026-10-16-*.md` | Evidencias de C31–C34 (efecto financiero, preferencias, decisión de canal, reintento por canal). |

---

## 1. Dónde está el plan

**C00–C34 completadas. C35–C40 pendientes.**

- Fases 1–5 cerradas (última: 16-10-2026).
- **Fase 6 (notificaciones verificables)** en curso: **C32, C33 y C34 cerradas; falta C35.**
- **Fase 7 (consolidación y cierre)**: C36–C40, todas pendientes. C36 es el inventario de implementación anterior y desbloquea C37–C39; C40 cierra la auditoría.

```
C36 clasificar implementación anterior ──┬── C37 retirar executor anterior (depende de C28 y C36)
                                          ├── C38 huérfanos por lote
                                          └── C39 documentación y punto de entrada del esquema
C00..C39 ──────────────────────────────────── C40 cierre con evidencia de recorridos
```

No se cierra un hallazgo por la existencia de un campo, servicio o tabla: hace falta recorrido verificado.

---

## 2. Tarea inmediata — C35: consolidar productores de notificaciones

**Objetivo:** migrar los productores activos a la misma decisión de envío, **por productor**, sin cambiar todos de una vez. Un productor por subtarea; máximo dos productores y cinco archivos por sesión.

**Criterios de aceptación (plan):**

- [ ] Hay un inventario de productores activos y una ruta efectiva por tipo de evento.
- [ ] Cada productor migrado conserva destinatarios, preferencias e idempotencia.
- [ ] El recorrido de prueba no genera dos notificaciones para una sola ocurrencia.

**Verificación:** V1/V3 por productor migrado. No hay V2 de navegador para C35.

### 2.1 Ruta durable (el destino de la migración)

```
NotificationQueue.enqueue(payload)                     ← productores deberían llamar esto
  → inngest.send({ name: "notification/dispatch.requested", id: "notification-dispatch:<id>", data })
  → lib/inngest/functions/notification-dispatch.ts
      → runNotificationDispatch(payload, step)
          step "plan-delivery"        → NotificationDispatcher.planDelivery  (decisión C33)
          step "deliver-<canal>" ×N   → NotificationDispatcher.deliverChannel (resultado C34)
```

`notificationIdFor(payload)` (`lib/notifications/notification-queue.ts`) ya deriva un id determinista: si `payload.metadata.dedupeKey` existe, lo usa (`notif_<dedupeKey>`); si no, un hash estable del payload. **Ese `dedupeKey` es la palanca de idempotencia del productor.**

### 2.2 Estado actual de los productores (inventario levantado el 16-10-2026)

**Ya durables (usan `NotificationQueue.enqueue`):**
- `app/api/notifications/dispatch/route.ts`

**Síncronos por `NotificationRouter.sendWithRouting` (ruta de compatibilidad):**
- `app/api/notifications/process/route.ts` (shim QStash; decidir en C36 si sigue vivo)

**Directos a `NotificationDispatcher.*` (candidatos a migrar; el evento es el de la regla de `routing-policy.ts`):**

| Productor | Evento(s) | Notas |
| --- | --- | --- |
| `lib/cron/shift-reminders.ts` | `shift_reminder` | Candidato natural: clave `turno+fecha`. |
| `lib/cron/check-overdue.ts` | `workflow_overdue` | Candidato natural: clave `instancia`. |
| `lib/cron/workflow-reminders.ts` | `workflow_due_soon` | |
| `lib/cron/send-reminders.ts` | `workflow_due_soon` | Posible duplicado con el anterior: verificar. |
| `lib/cron/imss-deadline-alerts.ts` | `imss_deadline` | **Migrado (C35.2)** — `enqueueBatch`. |
| `lib/inngest/functions/cron-sales-cut-reminder.ts` | `sales_cut_missing` | **Migrado (C35.2)** — cron `0 * * * *`. |
| `lib/inngest/functions/check-financial-alerts.ts` | `financial_kpi_deviation` | |
| `lib/inngest/functions/generate-morning-brief.ts` | `morning_brief` | |
| `lib/inngest/functions/emergency-departure-handler.ts` | `shift_approval_request` | |
| `lib/inngest/functions/announcement-broadcast.ts` | `announcement_broadcast` | |
| `app/api/shifts/route.ts` | `schedule_change` | `sendBatchNotifications`. |
| `app/api/shift-sessions/route.ts` | `employee_absence` | 3 llamadas. |
| `app/api/shift-change-requests/route.ts` | `shift_change_request`, `shift_change_decision` | 4 llamadas. |
| `app/api/labor/breaks/send-reminder/route.ts` | `shift_reminder` | |
| `app/api/labor/breaks/send-bulk-reminders/route.ts` | `shift_reminder` | |
| `app/api/vacations/approve/route.ts` | `shift_approval_decision` | |
| `lib/services/advanced-alert-service.ts` | `stock_alert` | |
| `lib/services/break-reminder-service.ts` | `shift_reminder`, `incident` | 3 llamadas. |
| `lib/services/cash-variance-alert-service.ts` | `cash_variance_detected`, `recurring_shortage_detected` | 2 llamadas. |
| `lib/services/workflow-assignment-service.ts` | `workflow_unassigned` (+ asignación) | 2 llamadas. |
| `lib/services/workflow-action-runner.ts` | `workflow_assignment` | |
| `lib/services/whatsapp-notification-service.ts` | `workflow_assignment`, `stock_alert`, `incident`, `shift_reminder`, `workflow_overdue` | 4+ llamadas; envuelve al dispatcher. Revisar si es capa redundante (C36). |
| `app/api/notifications/test-whatsapp/route.ts` | varios | Prueba manual; no migrar sin decidir. |

**Legacy con consumidores vivos (clasificar en C36/C38, no tocar en C35):**
- `lib/services/notification-service.ts` — tiene su **propio** tipo `NotificationPreferences` y `updateNotificationPreferences` esparce `stockAlerts` hacia el `set` de Drizzle (bug conocido). Consumidores: `lib/services/performance-reminder-service.ts:52` y `app/api/performance/goals/route.ts:217` (`sendWhatsAppNotification`); `lib/services/escalation-service.ts:242` está comentado.

### 2.2-bis C35.0 — inventario verificado (16-10-2026)

La tabla de arriba era un punto de partida, no el inventario completo. El recorrido real de todos los llamadores (`grep` de `sendNotification`/`sendBatchNotifications`/`sendWithRouting`/`enqueue` + extracción del `eventType` por archivo) dejó estas correcciones, con detalle en [la evidencia](../docs/audits/2026-10-16-consolidacion-productores-notificacion.md):

- **Productores directos que faltaban:** `lib/services/expense-service.ts` (`expense_approval_request`, `budget_threshold_reached`), `insight-generator-service.ts` (`stock_alert`), `overtime-alert-service.ts` (`incident`), `payee-bank-account-service.ts` (`payee_bank_account_changed`), `petty-cash-service.ts` (`stock_alert`), `receiving-service.ts` (`incident`), `shift-approval-service.ts` (`shift_approval_request`, `shift_approval_decision`) y `supplier-bank-account-service.ts` (`supplier_bank_account_changed`). El universo directo queda en **32 archivos**.
- **`lib/cron/shift-reminders.ts` es huérfano:** `sendShiftReminders` no lo importa ninguna función Inngest, ruta ni acción. No hay disparador, así que no es candidato de migración — es candidato de retiro o conexión (C36/C38).
- **`send-reminders.ts` y `workflow-reminders.ts` son un duplicado histórico parcial:** ambos producen `workflow_due_soon` para las próximas 24 h; `workflow-reminders` es el escalonado con seguimiento, `send-reminders` es el recordatorio diario de las 08:00 sin seguimiento. Se clasifican juntos y no se migra el duplicado mientras siga duplicando.
- **`whatsapp-notification-service.ts` no es un productor paralelo:** ya está `@deprecated`, envuelve al dispatcher y su `isDigitalDisconnectActive` está roto. Se clasifica en C36, no se migra.

### 2.3 Patrón de migración por productor

1. Leer el productor y anotar: destinatarios, evento, si ya tiene una clave natural, y si necesita ser síncrono (respuesta inmediata al usuario) o puede ser durable.
2. Cambiar `NotificationDispatcher.sendNotification(payload)` → `NotificationQueue.enqueue(payload)`. Para lotes, `enqueueBatch`.
3. Añadir `metadata.dedupeKey` con la clave natural (p. ej. `shift:<id>:<fecha>` o `workflow:<instanceId>:overdue`). Si el productor puede dispararse dos veces por la misma ocurrencia, esto es lo que evita el duplicado.
4. Conservar el payload (destinatario, `actionUrl`, `metadata`) sin cambios de contenido.
5. Probar con `NotificationQueue` mockeado (o `inngest.send` mockeado): una ocurrencia → **una** llamada, con id determinista; dos ocurrencias iguales → mismo id.
6. Registrar la migración en el inventario (sección 2.2) y anotar el límite si algo quedó síncrono a propósito.

### 2.4 Primer lote propuesto (decidir al abrir la sesión)

`lib/cron/shift-reminders.ts` (`shift_reminder`, clave `turno+fecha`) y `lib/cron/check-overdue.ts` (`workflow_overdue`, clave `instancia`). Ambos son cron, tienen clave natural clara y no devuelven respuesta a un usuario, así que el cambio a durable es de bajo riesgo y demuestra el patrón. Si el inventario revela que `workflow-reminders.ts` y `send-reminders.ts` son el mismo trabajo, clasificarlos juntos antes de migrar (posible duplicado histórico).

**Regla del plan:** una tarea que pase de cinco archivos se divide **antes** de implementar. C35 es "M por productor": no intentes migrarlos todos de una vez.

---

## 3. Después de C35 — Fase 7 (C36–C40)

| ID | Qué pide | Depende de |
| --- | --- | --- |
| **C36** | Inventario de implementación anterior y módulos sin uso: categoría (activo/compatible/prototipo/prueba/retirado), importadores, registros Inngest, consumidores externos. Incluye `lib/notifications/notification-dispatcher.ts` (directorio `lib/notifications/`, dispatcher anterior con logs), `lib/whatsapp/notification-queue.ts`, `workflow-conversation-handler-fixed`, `break-management-service`, `compliance/payroll-calculator`, el executor anterior y el esquema raíz. | C00 |
| **C37** | Retirar el executor anterior (`app/api/workflow/route.ts`, `lib/inngest/functions/workflow-executor.ts`, registro en `lib/inngest/functions/index.ts`, `lib/inngest/events.ts`) **si** C36 confirma que no hay consumidores; dejar reversión y no dejar funciones esperando eventos sin productor. | C28, C36 |
| **C38** | Resolver huérfanos por lote (máx. 3 relacionados): conectar con prueba, aislar como demostración o retirar. Pantallas activas no deben llamar endpoints inexistentes. | C36 |
| **C39** | Alinear documentación y punto de entrada del esquema: `AGENTS.md` (dice Wasender; la fábrica usa **WHAPI**), `lib/db/schema.ts` (raíz vs módulos), `docs/admin-guide.md`, `docs/user-guide.md`. No mover tablas. | C36 |
| **C40** | Cerrar la auditoría: los 12 hallazgos con estado y evidencia; recorridos con dos empresas y roles distintos; build/lint/pruebas registrados. | C00–C39 |

**No fusionar** por similitud de nombres: ventas/cortes, RH/compras y periodos de dominios distintos conservan su separación (ver tabla en la auditoría).

---

## 4. Cómo se trabaja (verificaciones y comandos)

| Clave | Qué es | Cómo corre |
| --- | --- | --- |
| **V0** | Línea base y puertas de fase | `pnpm run lint` · `pnpm run build` · `pnpm test:unit` |
| **V1** | Contrato, integración o regla | `pnpm exec vitest run --configLoader bundle tests/unit/<área>/` |
| **V2** | Recorrido en navegador aislado | `pnpm exec playwright test --config tests/playwright-shifts.config.ts` |
| **V3** | Fallos y concurrencia | Pruebas enfocadas con adaptadores simulados |

**Dos configs de Playwright, no confundir:**
- `tests/playwright-shifts.config.ts` → UI aislada (servidor Vite de pruebas con módulos reales y stubs de auth/DB). Es la que usan turnos, configuración, liga, workflows y notificaciones. **No requiere Next, auth ni Postgres.** Para añadir una pantalla: entrada en `tests/support/shifts-browser-server.ts` (`resolveId` + `load` + URL en `configureServer`) y el spec en `testMatch`.
- `playwright.config.ts` (`pnpm test:e2e`) → specs con base real y `auth.setup`. Más lento y frágil.

**Reglas del plan que se incumplen fácil:**
- Una tarea que pase de cinco archivos **se divide antes** de implementar.
- Una tarea no se marca porque compile: hace falta evidencia. "No ejecutado" se registra como tal.
- Cada evidencia va en `docs/audits/AAAA-MM-DD-<nombre>.md` y se enlaza desde el seguimiento y el plan.

---

## 5. Base de datos

- **Nunca `db:push`** (puede borrar tablas; Neon compartida).
- `db:migrate` compara `created_at` del registro contra el `when` del journal y aplica **todas** las entradas mayores, sin mirar hashes. Antes de correr, comprobar qué se aplicaría:
  ```bash
  node -e "const j=require('./drizzle/meta/_journal.json'); console.log(j.entries.slice(-4).map(e=>e.idx+' '+e.tag+' '+e.when).join('\n'))"
  ```
- Última migración: **`0097_cooing_william_stryker`** (`shift_reminders`, `schedule_changes` en `notification_preferences`), aplicada y verificada el 16-10-2026.
- Doce entradas del journal (0000–0008, 0040, 0083) tienen hash distinto al registrado pero **sus efectos ya están aplicados**; su `when` es anterior al último `created_at`, así que no son pendientes.

---

## 6. Línea base y límites que NO hay que dar por cubiertos

**Línea base (16-10-2026, tras C34; actualizada tras C35.2):** `test:unit` **1444** aprobadas / 1 omitida / 1 TODO (113 archivos) · `lint` 0 errores · `build` exitoso · `tsc --noEmit` limpio · navegador aislado **94/94**.

Límites abiertos que las tareas arrastran (no usar como evidencia de lo contrario):

| Área | Límite |
| --- | --- |
| C04, C05 | El recorrido ejecutar/revisar de workflows nunca se probó en navegador con sesión real. |
| C08, C09 | El planificador y el botón de excepción de jornada no se probaron en navegador. |
| C13–C15 | La pantalla de configuración usa respuestas simuladas: no hay V2 con Next/auth/Postgres. |
| C16–C19, C21, C22 | Verificados por servicio contra Neon, no con capa HTTP ni sesión. Scripts de verificación **siembran y borran en Neon compartida**; una interrupción deja empresas de prueba. |
| C32 | `notification-service.ts` conserva su tipo y su bug de `set`. Las dos rutas de preferencias sin consumidor interno siguen registradas hasta C36. |
| C33 | La resolución de zona añade una lectura de `branches` por notificación, sin caché. `metadata.timezone` existe pero nadie la puebla; no hay zona a nivel empresa. |
| C34 | **Sin runtime de Inngest**: la memoización por paso se emula. El reintento por canal **solo aplica al camino durable**; los productores directos no reintentan — eso es exactamente C35. No hay registro de entregas consultable. |
| C30 | El cockpit ejecutivo conserva los defaults del `ExecutiveTwinEngine` y los umbrales 60/65; no lee objetivos del inquilino. |
| C14.3 | `getPnLSnapshots` sigue sin consumidores. |

---

## 7. Decisiones ya tomadas (no reabrir sin evidencia nueva)

| Decisión | Fecha | Dónde |
| --- | --- | --- |
| Un solo contrato de preferencias: `inventoryAlerts` canónico, `stockAlerts` sólo alias; el guardado combina con lo existente | 16-10 | Evidencia de C32 |
| Una sola decisión de canal: router y dispatcher comparten `routing-policy.ts`; horario L–V 09:00–18:00 en zona de sucursal; fuera de horario sólo in-app; **las preferencias siempre aplican, también a eventos críticos** | 16-10 | Evidencia de C33 |
| Resultado por canal (`sent`/`skipped`/`failed`, `transient`/`terminal`); el correo sin remitente es `skipped`, no enviado; cada canal es su propio paso de Inngest | 16-10 | Evidencia de C34 |
| Los parámetros se aplican con el valor vigente **al cierre** del periodo | 12-10 | Evidencia de C14.3 |
| Responsables de comprar configurables; la modalidad no concede permisos | 13-10 | Evidencia de C16.2 |
| El filtro de rol de tesorería vive en el servicio, con `actorRole` obligatorio | 13-10 | Evidencia de C18.2 |
| Una obligación se agenda una sola vez (`FOR UPDATE`) | 14-10 | Evidencia de C19 |
| `managerAutonomy` se aplica en `rolExigidoPorMonto` y `expense-service` | 14-10 | Evidencia de C20 |
| `payrollDispersion`, `foodProduction`, `treasuryModel`, `supplierPayment` permanecen descriptivas con contrato honesto | 13–14-10 | Evidencias de C17–C21 |
| `tenantType` segmenta la Liga en redes; `branchVisibilityFilter` acota visibilidad | 15-10 | Evidencia de C22 |

**Pendientes de decisión** (no bloquean C35): quién revisa un workflow (hoy `requireReviewAccess` = `SUPERVISOR`+); consumidores externos del executor anterior (C36).

---

## 8. Trampas ya pagadas (no repetir)

1. **Caracteres CJK corruptos** en comentarios/documentos al escribir español. Revisar antes de commitear:
   `LC_ALL=C.UTF-8 grep -nP '[\x{4e00}-\x{9fff}]' <archivos>`
2. **`db.insert(tabla)` y `.values(filas)` son llamadas distintas**: para inspeccionar filas hay que capturar el argumento de `.values()`.
3. **`schema.parse()` devuelve las claves en el orden del shape**, no del JSON; comparar por campo, no con `toEqual([...])`.
4. **Mocks que ignoran filtros SQL** hacen pasar pruebas cuya lógica real filtra. Simular el filtro.
5. **Un `useMemo`/hook después de un `return` temprano** rompe la pantalla en silencio; los hooks van antes del `if (isLoading) return`.
6. **Un alias nuevo en el servidor de pruebas** puede romper pantallas que no eran del caso. Declarar cada dependencia en `optimizeDeps` y no sustituir hooks reales si basta con enrutar la API.
7. **La prueba del catálogo** `tests/unit/company/operating-policy-catalog.test.ts` falla si una política `descriptiva` aparece nombrada en `lib/` o `app/` fuera de la lista blanca. Para explicar por qué no se conecta, decirlo sin escribir su nombre en el código.
8. **El texto corregido se contrasta contra el código, no contra el nombre.**
9. **Verificación doble de comandos:** tras una corrida verde, no repetir el mismo build/test sin cambios intermedios.
10. **`build` puede fallar por red (Google Fonts) o memoria.** No es un fallo de código: reintentar con `NODE_OPTIONS=--max-old-space-size=8192`. Si persiste la red, registrarlo como bloqueo del entorno, no como aprobado.

---

## 9. Primeros pasos exactos de la nueva sesión

1. Leer `tasks/todo-conexion-frontend-backend.md` (Fase 6 y fila C34) y la sección C35 del plan.
2. Confirmar que el árbol está limpio (`git status`) y la línea base: `pnpm test:unit` (esperado 1431 aprobadas).
3. **C35.0 — cerrar el inventario** (hecho el 16-10-2026): verificado `workflow-reminders.ts` vs `send-reminders.ts` (duplicado parcial, no idéntico), clasificado `whatsapp-notification-service.ts` (legacy) y descubierto que `shift-reminders.ts` es huérfano. Inventario completo en [la evidencia](../docs/audits/2026-10-16-consolidacion-productores-notificacion.md).
4. **C35.1 — migrar el primer lote** (hecho el 16-10-2026): `shift-reminders.ts` quedó fuera por huérfano; se migraron `check-overdue.ts` (`workflow-overdue:<assignmentId>`) y `workflow-reminders.ts` (`workflow-due-soon:<assignmentId>:<reminderType>`) a `NotificationQueue.enqueue`, con `tests/unit/notifications/producer-migration.test.ts`.
4-bis. **C35.2 — segundo lote** (hecho el 16-10-2026): `imss-deadline-alerts.ts` (`imss-deadline:<tipo>:<fecha>:<ventana>:<userId>`, vía `enqueueBatch`) y `cron-sales-cut-reminder.ts` (`sales-cut-missing:<branchId>:<businessDate>`). El test acumula 13 casos.
5. Repetir por productor en sesiones siguientes, máximo dos por sesión, y solo entonces marcar C35 y abrir C36. Próximo lote sugerido: `check-financial-alerts.ts` (`financial_kpi_deviation`) y `generate-morning-brief.ts` (`morning_brief`).
