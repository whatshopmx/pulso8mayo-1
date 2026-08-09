# HANDOFF — Smart links en flujos programados (plan-smartlinks-flujos-programados)

**Generado:** 2026-08-09
**Rama:** `feat/motor-incidentes`
**Último commit:** `9bca243` — feat(workflows): smart link en toda asignación programada, cierre 5.2 y 5.5 (16 archivos, +870/−233)
**Estado del working tree al cierre:** solo `scripts/verify-smartlink-flow.ts` sin commitear (+ este doc).

> **Propósito:** que un agente nuevo en sesión nueva use ESTE documento como fuente
> de verdad para continuar. El detalle de diseño vive en `docs/plan-smartlinks-flujos-programados.md`
> (actualizado a estado "implementado"); este doc agrega estado real de entorno,
> verificación runtime, hallazgos críticos y próximos pasos.

---

## 1. Resumen ejecutivo

| Pieza | Estado |
|---|---|
| Plan completo (4.1–4.4, 5.1, 5.2, 5.4, 5.5) | ✅ implementado y commitado (`9bca243`) |
| 5.3 (reparto a varios destinatarios por rol) | ⏳ pendiente — requiere decisión de diseño (ver §6) |
| Sección 6 (verificación runtime) | ✅ 16/16 checks PASS vía `scripts/verify-smartlink-flow.ts` |
| Verificación en navegador (abrir link sin login) | ⏳ pendiente — requiere dev server + WhatsApp config |
| Migración `0044` (session_id nullable) | ❌→✅ **no estaba aplicada en la BD viva**; aplicada manualmente (ver §4) |

El modelo operativo está cerrado: cualquier flujo programado asignado sale por WhatsApp
con **smart link ejecutable sin login** (`/workflow/public/{token}`), el enlace se
**cierra al completar** la tarea, la **apertura queda registrada** (`used_at`), y si la
programación **no encuentra destinatario**, se avisa al **gerente de la sucursal**.

## 2. Qué se implementó (referencia rápida)

| Cambio | Dónde |
|---|---|
| Enlace generado en `assignWorkflow` para TODO flujo (no solo capacitación), vigencia atada a `dueDate` (piso 2h / techo 30d / +12h), contexto `assignedTo`+`assignmentId`, `try/catch` que no tumba la asignación, devuelve `smartLinkUrl` | `lib/services/workflow-assignment-service.ts` |
| Plantillas `workflow_assignment` / `workflow_due_soon` / `workflow_overdue` con `{smartLinkUrl}` (WhatsApp + email `<a>` + in-app) | `lib/services/notification-dispatcher.ts` |
| Limpieza de literales `{..}` sin resolver + degradación `smartLinkUrl → actionUrl` | `notification-dispatcher.ts` (`buildTemplateVariables`, `replaceTemplateVariables`) |
| `actionUrl` corregido a `/dashboard/workflows/{id}/execute` + **eliminada la doble notificación del cron** (assignWorkflow ya notifica) | `lib/cron/execute-schedules.ts` |
| Dedup del cron (`alreadyExecutedToday` con timezone de sucursal) | `lib/cron/execute-schedules.ts` |
| `getOrCreateForInstance` (reutiliza PENDING vigente / invalida viejos / crea) — usado por asignación, recordatorios y vencidos | `lib/services/smart-link-service.ts` |
| Reutilización de token en recordatorios y vencidos; `cron-overdue-workflows` fusionado en `check-overdue` (evitaba carrera de doble aviso y nombre "undefined") | `lib/cron/workflow-reminders.ts`, `lib/cron/send-reminders.ts`, `lib/cron/check-overdue.ts`, `lib/inngest/functions/index.ts` |
| **5.5a**: al completar, `markUsedForInstance` cierra todos los PENDING (preserva `used_at` con `coalesce`); `getOrCreateForInstance` rehúsa instancias COMPLETED | `smart-link-service.ts`, `workflow-execution-service.ts` (`checkProgress`) |
| **5.5b**: `recordOpen` llena `used_at` la primera vez sin tocar status (enlace reabrible); se llama desde la página pública y el GET API (después de los checks de acceso) | `smart-link-service.ts`, `app/workflow/public/[token]/page.tsx`, `app/api/workflows/public/[token]/route.ts` |
| **5.2**: `NO_SUITABLE_USER_ERROR` tipado; `notifyManagerUnassigned` avisa al GERENTE (fallback SUPERVISOR/ADMIN) con el nuevo evento `workflow_unassigned`, enlace absoluto al dashboard | `workflow-assignment-service.ts`, `execute-schedules.ts` (catch), `notification-dispatcher.ts`, `email-service.ts` (`sendWorkflowUnassignedEmail`), `lib/notifications/notification-router.ts` (priority `high`, fuera de horario a propósito) |

## 3. Entorno de trabajo

- **BD:** Neon Postgres de demo, viva y accesible. `.env` tiene `DATABASE_URL` real.
  Datos: 41 plantillas, 25 schedules, 8 usuarios, 3 sucursales, 566 instancias, 50 asignaciones, 3 magic_links (antes de la verificación).
- **Cómo correr scripts contra la BD:**
  ```
  npx tsx --env-file=.env scripts/verify-smartlink-flow.ts
  ```
  ⚠️ tsx **no** carga `.env` solo; `--env-file=.env` es obligatorio. Los scripts deben vivir DENTRO del repo (fuera, no resuelven `@/`).
- **WhatsApp:** NO configurado para enviar (`WHAPI_API_TOKEN not configured`) → el envío falla con gracia (log `WhapiNotConfiguredError`, no rompe nada). La sustitución de plantilla WhatsApp se verifica por otra vía.
- **Email:** `RESEND_KEY` presente → el dispatcher SÍ envía correos reales a los emails de los usuarios demo. La verificación genera emails reales (aceptable en demo; tenerlo presente).
- **Dashboard/dev server:** no corriendo. Para la prueba de navegador hay que `pnpm run dev` (o `INNGEST_DEV=1 pnpm run dev`).

## 4. Hallazgos críticos (no saltar)

### 4.1 Migración 0044 NO estaba aplicada en la BD viva (¡el plan la daba por aplicada!)
- Síntoma: al generar un enlace fuera de turno, el INSERT de `magic_links` fallaba con `23502 NOT NULL violation on session_id`.
- Causa raíz: la BD se construyó por **`db:push`** (no existe tabla `__drizzle_migrations`; el journal de `drizzle/meta/_journal.json` NO es fuente de verdad de lo aplicado). `0043` está en la BD (vía push), `0044` se generó después del último push → nunca llegó.
- **Arreglo aplicado** (manual, solo a esta BD de demo):
  ```sql
  ALTER TABLE "magic_links" ALTER COLUMN "session_id" DROP NOT NULL;
  ```
  Verificado con `information_schema` (ahora `is_nullable = YES`).
- **Acción futura:** aplicar `0044` a CUALQUIER otro entorno (producción/staging) antes de desplegar este feature; si se usa `db:migrate` en otro entorno hay que validar el baseline (la BD actual no tiene tabla de migraciones).

### 4.2 La URL del smart link NO se guarda en `magic_links`
- Se construye: `` `${process.env.NEXT_PUBLIC_APP_URL}/workflow/public/{token}` ``. No existe columna `url`.
- Al inspeccionar filas de `magic_links`, reconstruir la URL desde `token` (el script de verificación ya lo hace).

### 4.3 Dedup del cron = un aviso por programación y por día
- Si `assignWorkflow` falla sin destinatario, `advanceSchedule` NO corre, pero en la siguiente pasada `alreadyExecutedToday` (instancia ya existe) avanza el schedule → el aviso al gerente no se duplica.
- Si el enlace falla, la asignación NO se tumba (try/catch en `assignWorkflow`).

## 5. Verificación runtime — estado

**Script:** `scripts/verify-smartlink-flow.ts` (reutilizable; la sección 6 del plan convertida en código; se auto-limpia).

**Última corrida: 16/16 PASS** — `npx tsx --env-file=.env scripts/verify-smartlink-flow.ts`

Checks cubiertos:
1. Ejecución creada con `scheduleId` y `instance.assigneeId == assignment.assignedTo`
2. EXACTAMENTE un `magic_link` por instancia con `session_id NULL`
3. `expiresAt`: futuro, piso 2h, techo 30d, atado a `dueDate` (+12h margen; observado diff = 12.0h real)
4. Notificación in-app con `actionUrl` = smart link y sin literales `{..}`
5. Plantilla WhatsApp `workflow_assignment` sustituye `{smartLinkUrl}` y contiene el link
6. `getOrCreateForInstance` devuelve el MISMO token (`fresh: false`) — no duplica
7. Tras `markUsedForInstance`, `validateSmartLink` rechaza el token

**Fallo real detectado y reparado por la verificación:** migración 0044 (ver §4.1).
Una vez aplicado el ALTER, todo pasó en verde. No hubo otros fallos de implementación.

**El script usó la cadena real del cron** (`executeScheduledWorkflows()` → schedule due → executeSchedule → autoAssignWorkflow → link + notificación), no una simulación.

## 6. Próximos pasos sugeridos (en orden)

### P1. Commitear el estado actual
- `scripts/verify-smartlink-flow.ts` + este doc + referencia cruzada en el plan (§7).
- Mensaje sugerido: `test(workflows): verificación runtime smart links (sección 6) + handoff`

### P2 — 5.3: Reparto a varios destinatarios por rol (DECISIÓN REQUERIDA ANTES DE IMPLEMENTAR)
El plan lo dejó explícitamente fuera ("es un cambio de modelo de asignación uno-a-muchos, no de notificación"). El usuario lo trajo a alcance. **No implementar sin fijar la semántica:**

**Opción A (recomendada): repartir a TODOS los usuarios del rol — semántica de equipo**
- Un `instance` por corrida; N filas en `workflow_assignments` (una por destinatario, mismo `instanceId`, `dueDate`, `priority`).
- Cada destinatario recibe su propia notificación + smart link con `assignmentId` propio.
- Cierre: la instancia se completa con los pasos; `markUsedForInstance` ya mata todos los enlaces al completar (cubre a los hermanos). Las asignaciones hermanas que no completaron deben marcarse (COMPLETED/superseded) al cerrar la instancia para no aparecer como "vencidas" en el tablero de colegas — decidir el status.
- `autoAssignWorkflow` debe iterar `schedule.assignedRoles` (JSONB ya existe y el builder ya guarda varios roles; hoy solo se lee el escalar `assignedRole`, primer elemento — AD-7) y, por rol, buscar TODOS los usuarios (`findUserByRole` hoy devuelve 1; hace falta `findUsersByRole → array`).
- Mantener firma: devolver la PRIMERA asignación (el cron solo la usa para logs; las notificaciones salen del servicio).

**Opción B: todos DEBEN completar (agregado)** — más correcto para checklists de higiene individual, pero cambia completado/score/stats del dashboard y deja la instancia "medio completa". Caro.

**Opción C: instancia por destinatario** — modelo más limpio, pero rompe el dedup `alreadyExecutedToday` (1 instancia/día) y la semántica "la corrida creó N ejecuciones".

**Preguntas a confirmar con el usuario:**
1. ¿Elegibles = todos los usuarios con el rol en la sucursal, o solo los del turno (`assignedShifts`, matchear contra el modelo de turnos laborales)?
2. ¿Semántica de cierre: primer completado cierra para todos (A) vs todos deben completar (B)?
3. Datos demo: 1 usuario por rol/sucursal (8 usuarios) — el escenario "3 cocineros" no existe en seed; probar requerirá sembrar usuarios extra o unit test.

### P3. Verificación en navegador (sección 6, punto 4)
- Levantar `pnpm run dev` (puerto 3000) con el `.env`.
- Generar un enlace (el script deja uno, o crear schedule a mano) y abrir con `agent_browser` en sesión privada: `http://localhost:3000/workflow/public/{token}`.
- Verificar: renderiza el stepper SIN login; recargar sigue funcionando (no es de un solo uso); tras completar todos los pasos el enlace da 404 (higiene 5.5).

### P4. Verificación de recordatorio que reutiliza token (sección 6, punto 6)
- Craft una asignación PENDING con `dueDate` en ~30 min y llama `sendWorkflowReminders()`; assert: el metadata del recordatorio lleva el MISMO token y no crea fila nueva en `magic_links`.

### P5. Verificación voz de capacitación (sección 6, punto 8)
- Correr el flujo con plantilla TRAINING: assert `eventType = training_assigned` en la notificación y UN solo enlace (`getOrCreateForInstance` no duplica).

### P6. Aplicar 0044 a otros entornos
- Antes de cualquier deploy: `ALTER TABLE magic_links ALTER COLUMN session_id DROP NOT NULL;` en prod/staging (o migración equivalente). Validar baseline si se usa `db:migrate`.

## 7. Gotchas / reglas para el nuevo agente

1. **tsx no carga `.env`**: usar siempre `npx tsx --env-file=.env <script>`; scripts dentro del repo.
2. **`magic_links.url` no existe**: reconstruir `` `${NEXT_PUBLIC_APP_URL}/workflow/public/{token}` ``.
3. **El cron puede procesar schedules ajenos**: si corres `executeScheduledWorkflows` y hay otros schedules due, los procesa (efecto benigno en demo; emails reales a usuarios demo).
4. **Lint preexistente** (no tocar): `no-explicit-any` en varios archivos, `prefer-const`, imports sin usar (`users`, `sql`, `isNull`, `workflowSchedules`, `score`) — `tsc --noEmit` sí pasa limpio.
5. **`db:push` vs `db:migrate`**: esta BD se construyó con push; el journal de migraciones no garantiza lo aplicado. Verificar siempre `information_schema` ante features que dependan de columnas nuevas.
6. **Dedup**: `alreadyExecutedToday` usa `localDayRangeUtc` con la timezone de la sucursal — no cambiar sin romper el un-aviso-por-día.
7. **`workflow_due_soon`** es el nombre real del evento que el plan llamaba "workflow_reminder"; `training_assigned` es el eventType real (el plan decía "training_assignment").
8. `assignWorkflow` se llama desde `autoAssignWorkflow` (cron) — el plan decía "cubre asignación manual", pero hoy el único caller es el cron; la "manual" es `reassignWorkflow` (no notifica ni regenera enlace; el token vigente se reutiliza en el siguiente recordatorio).

## 8. Referencias

- Plan de diseño (fuente de verdad de decisiones): `docs/plan-smartlinks-flujos-programados.md`
- Verificación runtime: `scripts/verify-smartlink-flow.ts`
- Núcleo: `lib/services/smart-link-service.ts`, `lib/services/workflow-assignment-service.ts`, `lib/services/notification-dispatcher.ts`, `lib/cron/execute-schedules.ts`
- Cierre de enlaces: `lib/services/workflow-execution-service.ts` (`checkProgress`)
- Aviso al gerente: `lib/services/email-service.ts`, `lib/notifications/notification-router.ts`
- Migraciones: `drizzle/0043_workflow-review-fields.sql`, `drizzle/0044_smartlink-session-optional.sql`