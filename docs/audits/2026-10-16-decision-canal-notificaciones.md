# C33 — Una sola decisión de canal

Fecha: 16-10-2026. Seguimiento: `tasks/todo-conexion-frontend-backend.md`. C33 cerrada. Fase 6: C32–C33 hechas; C34–C35 pendientes.

## Cambio (H09)

H09 describió dos divergencias en la entrega de notificaciones:

1. **El router decidía y el dispatcher ignoraba la decisión.** `NotificationRouter.route` calculaba canales (incluido el horario) y los metía en `metadata.routedChannels`, pero `NotificationDispatcher.sendNotification` volvía a elegir por su cuenta según plantilla y preferencias. La mayoría de los productores llaman al dispatcher directamente, así que la decisión del router no gobernaba nada.
2. **El horario se medía con la zona del proceso.** `isBusinessHours()` usaba `new Date().getHours()` del servidor, sin contexto de sucursal.

C33 hace que la decisión sea una sola:

- **`lib/notifications/routing-policy.ts` (nuevo, puro).** Concentra las reglas (movidas del router), la evaluación de horario por zona y la decisión única `decideNotificationChannels({ eventType, preferences, templateChannels, now, timezone })`. Los tipos `NotificationChannel`/`NotificationEventType` viven aquí y el dispatcher los re-exporta.
- **El dispatcher decide y envía.** `NotificationDispatcher.decideChannels(payload)` es la decisión pública; `sendNotification` usa `prepareDelivery` (preferencias + plantilla + zona + decisión) y **intenta exactamente `decision.channels`**, ni uno más. `NotificationRouter.route` delega en `decideChannels` y `sendWithRouting` sólo envía: ya no se vuelve a decidir.
- **Zona horaria del contexto.** `resolveTimezone` usa `metadata.timezone` si viene, luego la zona de la sucursal del destinatario, y si no `America/Mexico_City`. Nunca la del proceso. Una zona inválida cae al default sin romper el envío.
- **Preferencias por tipo, también stock y turnos.** `eventTypeEnabled` mapea `stock_alert`/`stock_count_variance` → `inventoryAlerts`, `shift_reminder` → `shiftReminders`, `schedule_change` → `scheduleChanges`. El dispatcher ya no las fuerza a `true`.

### Política declarada (decisión de negocio, 16-10-2026)

1. **Zona**: sucursal → `America/Mexico_City`. La empresa no tiene zona propia en el esquema (sólo `branches.timezone`).
2. **Horario**: lunes a viernes, 09:00–18:00 en la zona resuelta.
3. **Diferido**: un evento `businessHoursOnly` fuera de horario no se pierde ni se manda por WhatsApp/email; se entrega **sólo in-app**. Es la única excepción a los canales de la regla.
4. **Preferencias**: siempre aplican, por canal y por tipo. **No hay excepciones**: ni los eventos críticos (antifraude, faltante de caja) se saltan el opt-out del usuario. Si el negocio quiere que antifraude ignore el opt-out, es una decisión nueva con su contrato, no un defecto que C33 deba introducir.

## Verificación

**V1** — `tests/unit/notifications/routing-policy.test.ts` (20), con reloj y zona controlados:

- `isWithinBusinessHours`/`zonedDayAndHour`: el mismo instante es lunes 10:00 en Ciudad de México (dentro) y lunes 18:00 en Madrid (fuera); bordes 09:00 (dentro) y 18:00 (fuera); sábado fuera; zona inválida cae al default.
- `eventTypeEnabled`: cada tipo a su preferencia, incluidos stock, conteo con varianza, turno y cambio de horario.
- `decideNotificationChannels`: dentro de horario devuelve los canales de la regla; fuera difiere a in-app; la zona cambia la decisión del mismo instante; preferencia de tipo apagada no envía; preferencia de canal quita ese canal; canal sin plantilla no se intenta; un evento crítico no se difiere por horario pero sí respeta preferencias; todas las preferencias apagadas no envían.
- **Dispatcher con adaptadores simulados**: `decideChannels` y `sendNotification` coinciden — dentro de horario se llama a WhatsApp, email e in-app; fuera de horario sólo a in-app; la zona de la sucursal (no la del proceso) decide; `metadata.timezone` sobreescribe; una preferencia de tipo apagada no intenta ningún canal.

Suite unitaria completa: **1414 aprobadas**, 1 omitida, 1 TODO (1416), 110 archivos (eran 1394/109; +20 de C33). `tsc --noEmit` código 0; `lint` 0 errores (2 warnings preexistentes en el dispatcher). Sin cambios de esquema; `build` verificado en C32 sigue vigente.

## Límites declarados

1. **Sin V2.** La verificación del plan para C33 es V1 con adaptadores simulados y reloj controlado; no hay recorrido de navegador que añadir. La prueba monta el dispatcher real con `fetch`/adaptadores mockeados.
2. **Los fallos por canal siguen sin resultado trazable.** `sendNotification` usa `Promise.allSettled` y cada adaptador captura su error: un canal que falla no se distingue de uno exitoso. Registrar resultados y reintentar sin reenviar los canales ya exitosos es **C34**.
3. **`lib/services/notification-service.ts` y los demás productores no se tocaron.** Conservan su propio camino. Consolidarlos por productor es **C35**.
4. **La resolución de zona añade una lectura de `branches` por notificación**, sin caché. Es aceptable para el volumen actual; si molesta, se cachea por sucursal.
5. **Nadie puebla `metadata.timezone` todavía.** La sobreescritura existe y se prueba, pero los productores actuales no la usan: la zona sale de la sucursal.
6. **No hay zona a nivel empresa.** Si el negocio quiere una zona corporativa distinta de la de cada sucursal, requiere columna y tarea propia.
