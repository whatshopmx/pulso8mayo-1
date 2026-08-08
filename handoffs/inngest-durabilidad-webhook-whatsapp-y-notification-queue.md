# Handoff — Durabilidad Inngest: Webhook WhatsApp (slice P0) y siguientes pasos

**Fecha:** 2026 (sesión de auditoría Inngest brownfield + implementación del slice P0)
**Repositorio:** `C:/Users/david/pulso29` — Pulso HORECA (Next.js 16 App Router, TypeScript, Drizzle + Neon, better-auth, Inngest v4.13.0)
**Estado:** ✅ Slice P0 (WhatsApp webhook) implementado, typecheck + lint limpios. ✅ Slice P1 (`NotificationQueue` → Inngest) implementado, typecheck + lint limpios (ver sección 8). ⏭️ Próximo: P2 candidatos (sección 3) y verificación runtime de P0+P1.

---

## 1. Resumen para retomar en nueva sesión

La tarea que quedó pendiente es **migrar el sistema de cola de notificaciones** (`lib/notifications/notification-queue.ts`) a un flujo durable de Inngest. Todo el contexto necesario está en las secciones 5–8. Lee primero las secciones 2–4 para entender el patrón Inngest que ya existe y la rebanada ya implementada (el webhook de WhatsApp), porque la migración de notificaciones debe seguir **el mismo patrón** (evento idempotente + función con `step.run`).

**Regla de oro del repo:** antes de tocar Inngest, lee `plans/migracion-workflow-inngest.md` y los archivos en `lib/inngest/functions/` para seguir las convenciones establecidas (IDs estables, triggers como string literals, `step.run` por boundary, eventos en `lib/inngest/events.ts`).

---

## 2. Estado de Inngest en el repo (maduro y saludable)

- **Cliente único:** `lib/inngest/client.ts` → `new Inngest({ id: "pulso29" })` (slug estable).
- **Serve endpoint:** `app/api/inngest/route.ts` → `serve({ client, functions: Object.values(cronFunctions) })`. GET/POST/PUT. Cualquier función nueva debe exportarse en `lib/inngest/functions/index.ts` para que sincronice.
- **~29 funciones** en `lib/inngest/functions/` (crons + event-triggered).
- **Eventos tipados** en `lib/inngest/events.ts` con `eventType("domain/noun.verb", {})`. Nota: el patrón del repo usa **string literals** en los triggers de las funciones (`triggers: [{ event: "shift/clock-in.requested" }]`) y los `eventType` se usan en el lado emisor (`inngest.send({ name: constant.name, ... })`). El objeto `EventType` expone `.name` (no `.eventName`).
- **Variables de entorno:** `INNGEST_DEV=1` para dev local; `INNGEST_SIGNING_KEY` + `INNGEST_EVENT_KEY` en prod.
- **Patrón de AI durable ya en producción:** `workflow-executor.ts` — `step.run` por boundary, `step.waitForEvent(..., timeout: "2h")` para humanos, `retries: 2`, `concurrency: 10`.

### Inventario actual de funciones (`lib/inngest/functions/index.ts`)
Crons: execute-schedules, check-overdue, workflow-reminders, overdue-workflows, send-reminders, inventory-checks, compliance-alerts, scheduled-reports, stock-check, document-expiration-check, break-reminders, imss-alerts, sales-cut-reminder, financial-alerts, kpi-snapshots, forecast-calculation, advanced-alerts, weekly-insights.
Event-triggered: labor-workflows (clock in/out, break start/end), incident-escalation, workflow-executor, announcement-broadcast, operational-twin, recalculate-executive-twin, backfill-encrypt-employees, refresh-engines, emergency-departure-handler, **whatsapp-router (nuevo, esta sesión)**.

---

## 3. Auditoría brownfield — hallazgos completos

Realizada esta sesión. Los tres candidatos, en orden de prioridad:

### P0 — Webhook de WhatsApp (✅ IMPLEMENTADO, ver sección 4)
**Antes:** `app/api/whatsapp/webhook/route.ts` hacía todo de forma síncrona antes de ackear: insert en `whatsapp_messages`, detección opt-in/out, y `messageRouter.routeMessage` → `workflowConversationHandler` → `EvidenceProcessor` (descarga de media de WHAPI, upload a R2, self-fetch HTTP a `/api/ai/verify` en `lib/whatsapp/evidence-processor.ts:159`). Sin idempotencia (no unique constraint en `externalMessageId`), sin verificación de firma, crash/retry = duplicados o mensajes perdidos.

### P1 — Cola de notificaciones híbrida (⏭️ PRÓXIMA TAREA, ver sección 5)
**Hallazgos:** `lib/notifications/notification-queue.ts:221` tiene `NotificationQueue.startProcessor()` con un `setInterval(..., 1000)` que se auto-arranca al cargar el módulo (`if (typeof window === "undefined")`). Si QStash no está configurado o falla `publish`, cae a un `memoryQueue` en memoria → **todo el trabajo se pierde en deploy/restart**. El endpoint `/api/notifications/process` (que QStash llama) tiene la verificación de firma **comentada**. IDs de cola no deterministas (`notif_${Date.now()}_${random}`), sin idempotencia real. Además existe un **segundo** queue similar: `lib/whatsapp/notification-queue.ts` (QStash con retries/exponential backoff, templates de email). Verificar si está en uso antes de decidir.

### P2 — Otros candidatos (futuro, no urgente)
- `app/api/reports/generate/route.ts` (587 líneas): generación de Excel/PDF (exceljs, pdfkit) **síncrona dentro del request**. Candidato a export job + polling. No urgente (archivos chicos).
- `inngest.send` sin `id` determinista en `app/api/workflow/route.ts` (`workflow/execution.created`) y `app/api/communications/announcements/route.ts` (`communication/announcement.broadcast`). Doble submit / retry → ejecución duplicada. Agregar `id` determinista (ej. `instanceId`, `announcementId`).
- `app/api/executive/twin/refresh/route.ts` ya usa evento con `id` determinista — es el patrón correcto a replicar.

---

## 4. Lo implementado esta sesión — Webhook WhatsApp durable

### Archivos tocados
| Archivo | Cambio |
|---|---|
| `lib/inngest/events.ts` | + `whatsappMessageReceived = eventType("whatsapp/message.received", {})` |
| `lib/inngest/functions/whatsapp-router.ts` | **NUEVO** — función durable `processWhatsAppMessageFn` |
| `lib/inngest/functions/index.ts` | + `export { processWhatsAppMessageFn } from "./whatsapp-router"` |
| `app/api/whatsapp/webhook/route.ts` | Reescrito: ack rápido + emitir eventos idempotentes |

### Diseño
1. **Webhook:** parsea el payload, por cada mensaje emite `whatsapp/message.received` con `id: message.id` (dedupe de Inngest, ventana 24h) y devuelve `200` rápido. Si la emisión falla → `500` para que WHAPI reintente (at-least-once). Los status updates (`sent/delivered/read/failed`) siguen siendo síncronos en el webhook (escrituras baratas de una fila).
2. **Función `processWhatsAppMessageFn`** (`id: "whatsapp-route-message"`, `retries: 3`, `concurrency: 5`): todas las side effects en `step.run`:
   - `check-already-processed` → guard por `externalMessageId` (idempotencia a nivel DB, incluso si el dedupe de eventos falla). Si existe → no-op.
   - `insert-message` → insert en `whatsapp_messages` con `processed: false`.
   - Si es texto con opt-in/out: `get-session` → `find-user` → `set-preference` (upsert en `notificationPreferences`) → `send-confirmation` (WhatsApp) → `mark-processed`.
   - Si no: `route-message` (mismo `messageRouter.routeMessage` de siempre) → `record-error` si falla → `mark-processed`.
3. **Idempotencia doble:** dedupe por event-id **+** guard en DB por `externalMessageId`. Retries seguros: los steps completados se memoizan; si el proceso muere a mitad, se retoma desde el último step memoizado.

### Verificación realizada
- ✅ `pnpm exec tsc --noEmit -p tsconfig.json` — limpio.
- ✅ `pnpm exec eslint app/api/whatsapp/webhook/route.ts lib/inngest/functions/whatsapp-router.ts lib/inngest/events.ts lib/inngest/functions/index.ts` — limpio (1 warning preexistente `_req`).
- ⚠️ **Runtime NO verificado:** no se corrió el dev server de Inngest. Pendiente: `INNGEST_DEV=1 pnpm run dev` + `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest`, confirmar sync de la función, y POST de un payload de prueba a `/api/whatsapp/webhook`.

### Problemas latentes flaggeados (NO resueltos, decisión pendiente)
1. **Bug latente (preexistente):** `whatsapp_messages.session_id` es columna **uuid** pero el webhook (y ahora la función, fielmente) inserta `'default'`. Esto fallaría en runtime de Postgres. La migración preservó el comportamiento exacto; NO se intentó arreglar. Requiere resolver `'default'` → el `id` uuid real de `whatsapp_sessions` (el `SessionManager` trabaja con `sessionId: 'default'` en memoria y no expone el id uuid de la fila).
2. **Sin unique constraint en `externalMessageId`:** agregarla requiere migración (`db:push`/`db:migrate` — OJO: `db:push` puede dropear tablas según AGENTS.md). La idempotencia actual está cubierta por dedupe de eventos + guard en DB, así que no es bloqueante.
3. **Sin verificación de firma** en el webhook de WhatsApp (la auditoría previa de tenant-scoping ya lo había marcado: `docs/audits/2026-08-01-tenant-scoping-audit.md`). WHAPI expone `verifyWebhookSignature` en el client (`lib/whatsapp/client-factory.ts`). No se agregó para no romper tráfico legítimo sin conocer el mecanismo exacto de WHAPI.

---

## 5. ⏭️ PRÓXIMA TAREA — Migrar NotificationQueue a Inngest (P1)

> ✅ **IMPLEMENTADO** (sección 8).

### Objetivo
Eliminar el fallback `memoryQueue` + `setInterval` de `lib/notifications/notification-queue.ts` (trabajo perdido en deploy/restart) y mover el procesamiento a una función durable de Inngest con idempotencia, siguiendo el patrón del webhook (sección 4).

### Cómo funciona hoy (mapeado esta sesión)
1. **Cola única dual** en `lib/notifications/notification-queue.ts`:
   - `enqueue(payload)` → genera `notif_${Date.now()}_${Math.random()}` (NO determinista) → si hay `QSTASH_API_KEY`/`QSTASH_TOKEN` hace `client.publish` a `/api/notifications/process` con `retries: 3`; si falla → **fallback a `memoryQueue`**.
   - `startProcessor()` → `setInterval(1s)` que procesa `memoryQueue` llamando `processNotification(payload)` → `NotificationRouter.sendWithRouting(payload)` → `NotificationDispatcher.sendNotification` (canales WhatsApp/Email/In-App según preferencias, ver `lib/notifications/notification-router.ts:249` y `lib/services/notification-dispatcher.ts:314`).
   - Auto-arranque en carga de módulo server-side → **cualquier restart pierde la cola en memoria**.
2. **Endpoints:** `/api/notifications/process` (llamado por QStash; verificación de firma comentada), `/api/notifications/dispatch` (POST que llama `NotificationQueue.enqueue`), `/api/notifications` (listado).
3. **Productores** (usan `NotificationDispatcher.sendNotification` directamente o `NotificationQueue.enqueue`): muchos — `lib/cron/*` (algunos ya migrados a Inngest), `lib/services/*` (break-reminder, advanced-alert, workflow-assignment, whatsapp-notification-service, workflow-action-runner), `lib/inngest/functions/*` (check-financial-alerts, announcement-broadcast, cron-sales-cut-reminder, emergency-departure-handler).
4. **Segundo queue similar:** `lib/whatsapp/notification-queue.ts` (QStash puro, templates de email). **Verificar si sigue en uso** (`rg "whatsapp/notification-queue"`) antes de decidir si se migra junto o se depreca.

### Plan sugerido (rebanada mínima segura)
1. **Evento nuevo** en `lib/inngest/events.ts`: `notification/dispatch.requested`.
2. **Función nueva** `lib/inngest/functions/notification-dispatch.ts`:
   - Trigger `notification/dispatch.requested`, `concurrency` moderado (los envíos externos WhatsApp/Email tienen límites; considerar `throttle`/`rateLimit` del SDK si hay 429s).
   - Un `step.run` por side effect: cargar prefs → filtrar por `shouldSendNotification` → resolver template → enviar por canal (cada canal su propio step) → marcar completado.
   - Reutilizar `NotificationRouter.sendWithRouting`/`NotificationDispatcher.sendNotification` **dentro de `step.run`** (preservar dominio, no reescribir la lógica de envío).
   - Idempotencia: `inngest.send({ id: <id determinista>, ... })` (ej. basado en `userId + eventType + entityId` si existe, o un id persistido en DB).
3. **Reemplazar `enqueue`:** que `NotificationQueue.enqueue`/`dispatch` emitan el evento Inngest en vez de `memoryQueue`/QStash publish. Eliminar `startProcessor()` y `setInterval` y el bloque `if (typeof window === "undefined")`.
4. **Borrar/neutralizar** `/api/notifications/process` (ya no llamado por QStash) o dejarlo como compat por un tiempo (deprecation: ver skill `deprecation-and-migration`).
5. **Agregar unique constraint** opcional en una tabla de notificaciones (si existe `notifications` en `lib/db/schema.ts`) para idempotencia DB, con migración segura (NO `db:push` a ciegas).

### Riesgos y decisiones pendientes
- Los envíos WhatsApp/Email **no son idempotentes** (un retry puede duplicar un mensaje). Mitigar con `id` determinista del evento + guard en DB antes del envío.
- Confirmar si `notificationPreferences` (`whatsappEnabled`, etc.) ya filtra; el dispatcher ya lo hace (`shouldSendNotification`).
- Decidir destino del segundo queue `lib/whatsapp/notification-queue.ts`.

### Archivos que se tocarán
`lib/inngest/events.ts`, `lib/inngest/functions/notification-dispatch.ts` (nuevo), `lib/inngest/functions/index.ts`, `lib/notifications/notification-queue.ts`, quizá `app/api/notifications/process/route.ts` (deprecar), `app/api/notifications/dispatch/route.ts`.

---

## 6. Comandos útiles

```bash
pnpm run dev              # Dev server (INNGEST_DEV=1 para Inngest local)
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest   # UI dev server
pnpm run build            # Verificar build antes de commit
pnpm exec tsc --noEmit -p tsconfig.json   # Typecheck rápido
pnpm exec eslint <archivos>               # Lint de archivos puntuales
pnpm test:e2e             # Playwright (config: playwright.config.ts)
```

---

## 7. Gotchas del repo (relevantes para esta línea de trabajo)

1. **`db:push` puede dropear tablas** — verificar contra `.env` antes de correr. Para cambios de schema preferir `db:generate` + `db:migrate`, o SQL manual.
2. **Triggers Inngest como string literals** en `createFunction`; constantes `eventType` para `inngest.send` (usar `.name`).
3. **Multi-tenant:** toda data scoped por `tenantId`/`companyId` (`lib/tenant-context.ts`, `lib/api/with-auth.ts`). Las funciones Inngest deben cargar el tenant desde DB (event data), NO confiar en headers.
4. **`strict: false`** en tsconfig — typecheck puede no surfear algunos issues. Correr eslint además de tsc.
5. **Auth:** `auth.api.getSession()` — verificar sesión en cada endpoint; NO hay `middleware.ts` (cada ruta se protege sola; ver `docs/audits/2026-08-01-tenant-scoping-audit.md`).
6. **Docs de referencia:** `plans/migracion-workflow-inngest.md`, `docs/pulso-executive-os-v2.md` (§5 eventos), `PROJECT_CONTEXT.md` (estado de fases), `AGENTS.md`.

---

## 8. ✅ Implementado esta sesión — NotificationQueue durable (P1)

### Archivos tocados

| Archivo | Cambio |
|---|---|
| `lib/inngest/events.ts` | + `notificationDispatchRequested = eventType("notification/dispatch.requested", {})` |
| `lib/inngest/functions/notification-dispatch.ts` | **NUEVO** — función durable `notificationDispatchFn` |
| `lib/inngest/functions/index.ts` | + `export { notificationDispatchFn } from "./notification-dispatch"` |
| `lib/notifications/notification-queue.ts` | Reescrito — `enqueue` emite evento Inngest; eliminado `memoryQueue` + `startProcessor`/`setInterval`, QStash client y el bloque `if (typeof window === "undefined")` |
| `app/api/notifications/process/route.ts` | Deprecado → compat shim **síncrono** (`NotificationRouter.sendWithRouting`) para colas QStash legacy |
| `app/api/notifications/dispatch/route.ts` | GET devuelve un stub (ya no hay estado local); quitados `NotificationDispatcher` y `auth` innecesarios |
| `lib/whatsapp/notification-queue.ts` | **NO tocado** (decisión: ver abajo) |

### Diseño
1. **Productor:** `enqueue` genera id determinista `notificationIdFor(payload)` — hash estable FNV-1a de `{userId, eventType, title, message, metadata}`, o `notif_${dedupeKey}` si `payload.metadata.dedupeKey` trae un key explícito. Emite `notification/dispatch.requested` con `id: "notification-dispatch:" + id` (dedupe 24h). **Sin fallback local** — si `inngest.send` falla, `enqueue` lanza → el endpoint devuelve 500 (at-least-once vía retry del cliente).
2. **Función `notificationDispatchFn`** (`id: "notification-dispatch"`, `retries: 3`, `concurrency: 10`): un solo `step.run("dispatch-notification")` que llama `NotificationRouter.sendWithRouting(payload)`. No se dividen los canales en pasos porque `NotificationDispatcher` ya aísla fallos por canal (`Promise.allSettled`); dividir rompería la regla de no reescribir la lógica de dominio.
3. **Idempotencia:** dedupe por event-id determinista (24h) + memoización de `step.run` (retries no re-envían). Se opta por NO agregar `unique constraint` a `notifications` (no hay columna de dedupe; hubiera requerido migración) — aceptable.
4. **Compat:** `/api/notifications/process` queda como shim síncrono. `GET /api/notifications/dispatch` devuelve un stub (ya no hay estado local).

### Verificación realizada
- ✅ `pnpm exec tsc --noEmit -p tsconfig.json` — limpio.
- ✅ `pnpm exec eslint` sobre los 6 archivos del P1 — 0 errores / 0 warnings.
- ⚠️ **Runtime NO verificado** (igual que P0). Pendiente: levantar dev server de Inngest (`INNGEST_DEV=1 pnpm run dev`), confirmar sync de `notification-dispatch`, y POST a `/api/notifications/dispatch`.

### Decisión sobre el segundo queue (`lib/whatsapp/notification-queue.ts`)
- `rg "whatsapp/notification-queue"` solo aparece en `docs/` y handoffs; **no hay imports en `lib/` ni `app/`** → código muerto.
- Se dejó **sin tocar** (evitar scope creep; tocar un archivo muerto con tipado laxo era riesgo sin beneficio). No se migra. Para limpiar: borrar el archivo (+ su mención en docs/plans).

### Próximos pasos
1. Verificar runtime P0+P1 (dev Inngest + POST real).
2. Bug latente P0: `whatsapp_messages.session_id` uuid vs `'default'` (sección 4, problema 1).
3. Si hay 429s de WhatsApp/Email en runtime, agregar `throttle`/`rateLimit` a `notificationDispatchFn` (hoy `concurrency: 10`).
4. P2 (sección 3): `inngest.send` sin id determinista en `app/api/workflow/route.ts` y `app/api/communications/announcements/route.ts`; reporte Excel/PDF síncrono.
