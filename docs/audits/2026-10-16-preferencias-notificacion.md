# C32 — Preferencias de notificación con un solo contrato

Fecha: 16-10-2026. Seguimiento: `tasks/todo-conexion-frontend-backend.md`. C32 cerrada (C32.1–C32.3). Abre la Fase 6; C33–C35 siguen pendientes.

## Cambio (H09)

H09 encontró tres APIs de preferencias para la misma área con contratos distintos: `/api/notifications/preferences` devolvía `stockAlerts`, `/api/profile/notification-preferences` inventaba `shiftReminders`/`scheduleChanges` en `true` en cada lectura, y `/api/users/profile/preferences` exponía la fila cruda. El dispatcher lee `inventoryAlerts`. Además, la pantalla arrancaba con todos los interruptores en `true` sin pedir la fila guardada, así que guardar sin tocar nada sobrescribía las preferencias reales con defaults.

C32 no cambia **qué se envía** (eso es C33). Fija **qué es una preferencia y cómo viaja**:

- **C32.1 — Contrato canónico y persistencia.** `lib/notifications/preferences-contract.ts` define los diez campos, los defaults, la normalización de un cuerpo arbitrario y el mapeo a columnas. `stockAlerts` se acepta como alias de entrada y se traduce a `inventoryAlerts` (el nombre canónico, que es el de la tabla y el que lee el dispatcher). Migración aditiva `0097_cooing_william_stryker` añade `shift_reminders` y `schedule_changes`: la interfaz ya las ofrecía y la API las fabricaba porque no había columna.
- **C32.2 — Las tres APIs comparten el contrato.** Las tres rutas derivan el usuario de la sesión, normalizan el cuerpo con el contrato y **combinan** lo que llegó con lo guardado. Antes, un cuerpo parcial reseteaba a `true` los campos omitidos. Un cuerpo sin preferencias válidas se rechaza con 400 en vez de escribir defaults silenciosos. `NotificationPreferencesData` duplicado de la ruta de perfil se retiró.
- **C32.3 — La pantalla carga antes de editar.** El componente pide `GET /api/notifications/preferences` al montar, usa el contrato para normalizar y sólo entonces muestra el formulario. Un fallo de carga muestra un error con reintento y **no** muestra interruptores con defaults; guardar envía el contrato canónico.

## Verificación

- **V1 — contrato puro** `tests/unit/notifications/preferences-contract.test.ts` (13): normalización, alias, `false` conservado frente a `null`/ausente, descarte de claves desconocidas y una prueba que ata cada campo del contrato a su columna real en la tabla.
- **V1 — rutas reales** `tests/unit/notifications/preferences-routes.test.ts` (11): las tres rutas corren con la base simulada. Comprueban misma forma de campos, `userId` de la sesión (un `userId` en el cuerpo se ignora), campo omitido conservado en lugar de reseteado, alias traducido al guardar, 400 sin escritura, y la ruta de usuario permitiendo guardar sólo el teléfono.
- **V2 aislada** `tests/e2e/notification-preferences.spec.ts` (4), en Chromium con el componente real y `fetch` interceptado: muestra los `false` guardados (no defaults), guardar envía `inventoryAlerts` sin `stockAlerts` y conserva lo no tocado, un `GET` 500 muestra error sin interruptores, y reintentar recupera la carga.
- **Base real** — migración `0097_cooing_william_stryker` aplicada a Neon; `notification_preferences` tiene `shift_reminders` y `schedule_changes` `boolean not null default true` (verificado contra `information_schema.columns`). Última migración registrada: `0097`.
- Suite unitaria completa: **1394 aprobadas**, 1 omitida, 1 TODO (1396), 109 archivos (eran 1370/107; +24 de C32).
- Suite de navegador aislada: **94/94** (eran 90; +4 de C32.3).
- `tsc --noEmit` código 0; `lint` 0 errores.

## Límites declarados

1. **Sin V2 con Next/auth/Postgres.** El servidor de la prueba intercepta `fetch` y las rutas se prueban con la base simulada. La autorización (usuario de la sesión, no del cuerpo) se respalda en las unitarias sobre los manejadores reales, no en una sesión viva.
2. **El envío sigue sin respetar las preferencias de stock, turno y cambio de horario.** `NotificationDispatcher.shouldSendNotification` devuelve `true` para `stock_alert`, `shift_reminder` y `schedule_change`, y el dispatcher ignora `metadata.routedChannels` del router. C32 sólo unificó el contrato y la persistencia; hacer efectiva la decisión de canal y horario es **C33**.
3. **La cola y el dispatcher anteriores no se tocaron.** `lib/services/notification-service.ts` conserva su propio tipo `NotificationPreferences` (con `stockAlerts`) y `updateNotificationPreferences` sigue esparciendo `stockAlerts` hacia el `set` de Drizzle. Consolidar productores es **C35**.
4. **`scheduleChanges` se persiste y se devuelve, pero aún no tiene interruptor en la pantalla.** El contrato lo cubre para no volver a inventarlo; su control visible depende de la decisión de C33.
5. **Las otras dos rutas no tienen consumidores internos localizados.** Sólo la pantalla usa `/api/notifications/preferences`. `/api/profile/notification-preferences` y `/api/users/profile/preferences` se conservan compatibles (y ahora coherentes) hasta que **C36** clasifique consumidores externos antes de retirar.
