# C34 — Fallos y reintento por canal

Fecha: 16-10-2026. Seguimiento: `tasks/todo-conexion-frontend-backend.md`. C34 cerrada (C34.1–C34.2). Fase 6: C32–C34 hechas; C35 pendiente.

## Cambio (H09)

H09 señaló que el dispatcher usaba `Promise.allSettled` sin mirar resultados y que los adaptadores capturaban sus errores: la función durable devolvía éxito aunque un canal fallara, y el correo genérico registraba el texto sin enviarlo. Un fallo parcial era indistinguible de un envío total.

C34 da a cada canal un resultado y un reintento propios:

- **C34.1 — Resultado verificable por canal.** `ChannelDeliveryResult` con `status: sent | skipped | failed` y, en los fallos, `kind: transient | terminal`. Los tres canales dejan de tragarse los errores: devuelven `skipped`/terminal cuando falta el teléfono, el correo o el remitente; `failed`/transient cuando el proveedor o la base fallan. El fallback de correo —que sólo registraba el texto— ahora se declara **omitido**, no enviado. `sendNotification` devuelve `ChannelDeliveryResult[]` en el orden de la decisión; un canal caído no tumba a los demás.
- **C34.2 — Reintento durable por canal.** El plan de entrega es un paso memoizado y **cada canal es su propio `step.run`**. Un fallo transitorio **lanza** dentro del paso del canal para que Inngest no lo memoize; los canales ya completados quedan cacheados. En un reintento sólo se re-ejecuta el canal que falló. Se esperan todos los canales (`allSettled`) antes de lanzar, para que los exitosos terminen y se memoicen. `skipped` y los fallos terminales completan el paso sin reintento.

La lógica vive en `runNotificationDispatch(payload, step)` con un `step` mínimo (`run`), así que se prueba sin levantar el runtime de Inngest.

## Verificación

- **V1 — resultado por canal** `tests/unit/notifications/channel-delivery.test.ts` (11): WhatsApp sin teléfono → omitido terminal; sin sesión → fallo transitorio; proveedor caído → fallo transitorio; correo sin dirección → omitido; **tipo sin remitente de correo → omitido, no enviado**; correo caído → transitorio; insert in-app caído → transitorio; in-app exitoso → `sent`; y `sendNotification` devolviendo un resultado por canal, con el fallo de correo conviviendo con WhatsApp e in-app exitosos.
- **V3 — reintento por canal** `tests/unit/notifications/channel-retry.test.ts` (6) con un `step` que memoiza como Inngest: todo exitoso (un paso por canal); **reintento tras fallo de correo** (WhatsApp e in-app salen una sola vez en total, el correo dos); agotamiento (tres intentos, el correo tres veces, los demás una); fallo terminal sin reintento; preferencia de tipo apagada sin pasos de canal; payload inválido sin pasos.
- Suite unitaria completa: **1431 aprobadas**, 1 omitida, 1 TODO (1433), 112 archivos (eran 1414/110; +17 de C34). `tsc --noEmit` código 0; `lint` 0 errores. Sin migraciones ni cambios de esquema.

## Límites declarados

1. **Sin runtime de Inngest.** La memoización por paso se emula con un `step` de prueba; no se levantó Inngest contra Neon ni se ejercitó su backoff real. Lo verificado es la lógica de qué paso se repite y cuál no, no el motor.
2. **El reintento por canal sólo aplica al camino durable.** Los productores que llaman a `NotificationDispatcher.sendNotification` directamente reciben los resultados pero no los reintentan: el reintento vive en la función de Inngest que escucha `notification/dispatch.requested`. Migrar esos productores es **C35**.
3. **No hay registro de entregas consultable.** Agotados los reintentos de Inngest, el fallo queda en la corrida de Inngest, no en una tabla del producto. Si el negocio quiere una bandeja de entregas fallidas, es una tarea nueva con su esquema.
4. **`sin sesión de WhatsApp activa` se clasifica transitoria.** Un reintento con backoff puede encontrar la sesión ya activa, pero si está caída mucho tiempo se reintenta en vano. Declarado, no resuelto.
5. **Un error de inserción in-app se clasifica transitorio** aunque suela ser terminal; reintentar es seguro porque es un insert idempotente por contenido. Si deja de serlo, se reclasifica.
6. **`lib/services/notification-service.ts` y los demás productores siguen sin tocar.** Consolidarlos por productor es **C35**.
