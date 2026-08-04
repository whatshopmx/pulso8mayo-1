# Cierre de Gaps Fases 9–10 — Task List

Source plan: `tasks/plan-cierre-gaps-ventas-gastos.md`. Baseline: auditoría de código 2026-08-04 sobre `tasks/plan-grupo-restaurantero-unificado.md` (que reporta 26/40; el avance real es ~35/40 tras el commit `34f52f2`).

> **Directiva de producto (2026-08-04):** WhatsApp = canal de verificación con smart links + home menu del bot. Sin flujos conversacionales ni ingesta de documentos por chat. El spike C2 (documentos Wasender) queda **CANCELADO**; T32u se cierra con smart link al upload de la PWA.

**Mapa de numeración:** C# = tareas de este tracker. T#u = numeración unificada (plan ejecutivo). T#t = numeración del tracker fuente (`todo-ventas-gastos.md`, T24–T38).

Convenciones del repo que aplican a todas las tareas:
- Dinero en centavos (integer). Scoping por `companyId`/`branchId` + `requireTenant()`.
- Migraciones con `pnpm db:generate` (nunca `db:push` sin verificar `.env`).
- Verificación base de cada tarea: `pnpm run build` limpio (o baseline documentado en C1).
- Verificación de servicios con scripts tsx en `scripts/verify-*.ts`.
- WHAPI: estructuras exactas de `.agents/skills/whapi/references/msg-interactive.md` — no inventar parámetros.

Open questions (resolver antes de C4/C6/C9 — ver plan):
- Q-C1: ¿Horario de cierre por sucursal? (recomendado: default 23:30 local)
- Q-C2: ¿Umbrales KPI por tenant? (recomendado: defaults; config en Fases 11–14)
- Q-C3: ¿Paso de corte bloqueante? (recomendado: alerta no bloqueante)
- Q-C4: ¿Playwright además de tsx? (recomendado: solo tsx)
- Q-C5: ¿Expiración de action links? (recomendado: 60 min, single-use)
- Q-C6: ¿Opciones extra de gerente? (recomendado: corte de ventas + aprobaciones)
- Q-C7: ¿Fallback oculto de clock-in por chat? (recomendado: no)

---

## Fase A — Fundación de datos

- [ ] **C1** Migración de cierre: 6 tablas implementadas sin migración. *Files: `drizzle/0027_*.sql` (generada), `drizzle/meta/*`. Size M (riesgo alto, diff pequeño). Cierra la brecha de infra de T21u/T34u.*
  - Contexto: `lib/db/schema.ts` contiene `propinas`, `propina_asignaciones`, `petty_cash_funds`, `petty_cash_transactions`, `operating_expenses`, `expense_authorization_rules` (líneas ~2606–2740) pero el snapshot `0026` no las incluye — dev se sincronizó probablemente con `db:push`.
  - Acceptance:
    - [ ] `pnpm db:generate` produce exactamente esas 6 tablas (+ enums `propina_status`, `petty_cash_transaction_type`, `operating_expense_status`, índices y uniques compuestos) **sin drops ni alters inesperados** — el SQL se inspecciona línea por línea antes de aplicar.
    - [ ] FKs a `users.id` como `text` (convención del repo, ver T24t).
    - [ ] Migración aplicada a dev (`pnpm db:migrate`) y verificada con `\dt` o query de conteo a cada tabla.
    - [ ] Baseline de build documentado: correr `pnpm run build` ANTES y registrar si el error preexistente de `lib/services/tenant-config-service.ts` (WIP Fases 11–14, reportado en T25t) sigue presente — ninguna tarea de este plan debe empeorar ese baseline.
  - Verify: SQL inspeccionado; migración aplicada; `pnpm run build` en baseline documentado.
  - Dependencies: None.

---

## Fase C — KPIs reales (cierra T31u / T29t)

- [ ] **C3** Reescribir cálculo de `financial-kpi-service` con fuentes correctas. *Files: `lib/services/financial-kpi-service.ts` (reescritura del núcleo de cálculo), `scripts/verify-financial-kpis.ts` (new). Size M.*
  - Contexto: el servicio actual suma TODO `inventoryBatches` histórico (sin filtro de período) como food cost y usa tarifa fija $60/hr sobre `shiftSessions` para labor; además solo calcula con `branchId` (scope empresa cae al fallback). El acceptance original de T29t pedía reusar `theoretical-consumption-service` y `labor-calculator` — ambos existen (`lib/services/`).
  - Acceptance:
    - [ ] Food cost = consumo teórico del período (reusar `theoretical-consumption-service`) ÷ ventas del período; labor = costo real (reusar `labor-calculator`) ÷ ventas.
    - [ ] Las 3 fuentes (ventas, consumo, labor) respetan `startDate`/`endDate` del filtro.
    - [ ] Funciona con scope empresa (sin `branchId`): agrega todas las sucursales.
    - [ ] Fallbacks 28%/25% solo se devuelven con `estimated: true` + campo `coverage` (ej. `{ daysWithSales: 12, daysInPeriod: 30 }`).
    - [ ] Alerta `financial_kpi_deviation` se mantiene, pero solo dispara con datos NO estimados.
    - [ ] Script de verificación: con datos sembrados food cost 34% → 🟡; forzar 36% → 🔴 + notificación; período sin consumo → `estimated: true`.
  - Verify: build en baseline; `npx tsx scripts/verify-financial-kpis.ts` todos los checks pasan.
  - Dependencies: None (paralelizable con C1).

- [ ] **C4** Cablear KPIs reales a API y UI. *Files: `app/api/sales/analytics/route.ts` (extender), `components/sales/financial-kpi-cards.tsx` (reescribir fetch), `app/api/kpi/dashboard/route.ts` (evaluar reuso). Size M.*
  - Acceptance:
    - [ ] `/api/sales/analytics` incluye `kpis` del servicio corregido (AD-C4: mismo endpoint, mismos filtros).
    - [ ] `financial-kpi-cards.tsx` elimina los porcentajes hardcodeados (28.5/26.2) y renderiza los del API.
    - [ ] Badge "Estimado" visible cuando `estimated: true`; mensaje de cobertura ("12/30 días con corte") siempre visible — nunca un número sin contexto (mitigación del plan unificado).
    - [ ] Umbrales semáforo: defaults del servicio (30/35 food, 28/32 labor) — configurabilidad por tenant queda fuera (Q-C2).
  - Verify: build en baseline; con cortes sembrados, cards reflejan los mismos números que el script de C3; estado sin datos muestra cobertura y "Estimado".
  - Dependencies: C3.

### Checkpoint: KPIs
- [ ] Cards de `/dashboard/sales` muestran datos reales; semáforo cambia al cruzar umbrales
- [ ] Números del API == números del script de verificación
- [ ] Revisión con humano antes de seguir

---

## Fase D — Menú WhatsApp + Smart Links (cierra T32u / T30t bajo directiva)

- [ ] **C5** Action links autenticados (JWT single-use → sesión PWA). *Files: `lib/db/schema/auth.ts` o `schema.ts` (tabla `action_links`), `drizzle/` (migración), `lib/services/action-link-service.ts` (new), `app/api/auth/wa-link/route.ts` (new). Size M. Base para C6, C7 y C9.*
  - Contexto: `SmartLinkService`/`magic_links` son workflow-specific (requieren `instanceId`/`templateId`) y las páginas destino del menú (`/dashboard/labor/attendance`, `/dashboard/my-tasks`, `/dashboard/incidents`, `/dashboard/labor/shift-changes`, `/dashboard/labor/vacations`, `/dashboard/sales`) requieren sesión better-auth — no existe login mágico genérico.
  - Acceptance:
    - [ ] Tabla `action_links(token text PK, userId text→users, action text, targetPath text, expiresAt, usedAt nullable, createdAt)` vía `pnpm db:generate`.
    - [ ] `ActionLinkService.create(userId, action, targetPath, expiresInMinutes=60)`: JWT firmado (`JWT_SECRET`, payload `{userId, action, jti: token}`) + fila persistida; retorna URL absoluta `https://<host>/api/auth/wa-link?token=`.
    - [ ] Endpoint GET valida: firma, no expirado, no usado → marca `usedAt` (single-use), crea sesión better-auth para `userId` (insert en `sessions` respetando el adapter), setea cookie y **302 a `targetPath`**.
    - [ ] `targetPath` solo contra whitelist (`/dashboard/labor/attendance`, `/dashboard/my-tasks`, `/dashboard/incidents`, `/dashboard/labor/shift-changes`, `/dashboard/labor/vacations`, `/dashboard/sales`, `/dashboard/labor/approvals`) — cualquier otro → 400. Sin open redirects.
    - [ ] Token expirado/usado → página de error amable con instrucción "Responde MENU al WhatsApp para un enlace nuevo" (sin revelar si el token existió).
    - [ ] Auditoría: log de creación y de uso (quién, acción, cuándo).
  - Verify: build en baseline; script tsx: crear link → GET → cookie de sesión + redirect correcto; reusar → rechazo; expirado → rechazo; path fuera de whitelist → 400.
  - Dependencies: C1 (infra de migración y baseline).

- [ ] **C6** Home menu del bot con smart links contextuales. *Files: `lib/whatsapp/handlers/menu-handler.ts` (new), `lib/whatsapp/message-router.ts` (ruta al handler), `lib/whatsapp/whapi-client.ts` (método `sendInteractiveList`), `lib/whatsapp/message-formatter.ts` (menú en texto). Size M.*
  - Acceptance:
    - [ ] Trigger: saludo, "menu"/"menú", comando desconocido → home menu.
    - [ ] Envío con `sendMessageInteractive` type `list` (estructura `action.list{ sections[].rows[{id,title,description}], label }` — ver skill whapi; 4+ opciones NO caben en 3 botones).
    - [ ] Opciones empleado (todas generan action link vía C5): **1** `ATTENDANCE` → `/dashboard/labor/attendance` ("Registrar entrada/salida/break"); **2** `TASKS` → `/dashboard/my-tasks`; **3** `INCIDENT` → `/dashboard/incidents`; **4** `SHIFT_VACATION` → `/dashboard/labor/shift-changes` (con mención a vacaciones en la descripción).
    - [ ] Opciones adicionales GERENTE/ADMIN (Q-C6): **5** `SALES_CUT` → `/dashboard/sales` ("Enviar corte de ventas"); **6** `APPROVALS` → `/dashboard/labor/approvals`.
    - [ ] Selección acepta indistintamente: row id, título de opción, o número "1"–"6" (los taps llegan como texto plano; fallback gratis si WhatsApp degrada la lista — AD-C9).
    - [ ] Respuesta: "🔗 *Registro de asistencia* — abre este enlace (válido 60 min, un solo uso): <url>".
    - [ ] Rol no autorizado para opción de gerente → menú de empleado con nota.
    - [ ] `message-router` enruta a este handler ANTES del flujo conversacional de workflows (que se mantiene para ejecución de workflows asignados — T12 no cambia).
  - Verify: build en baseline; sandbox WHAPI: "hola" → lista renderiza (o texto si degrada); tap/“1” → link válido; abrir link → PWA autenticada en la página correcta; rol empleado no ve opciones 5–6.
  - Dependencies: C5.

- [ ] **C7** Deprecar acciones en chat del labor handler. *Files: `lib/whatsapp/command-parser.ts` (saludos ya no = CLOCK_IN), `lib/whatsapp/handlers/labor-handler.ts` (responder con link), `lib/whatsapp/message-router.ts` (rama). Size S.*
  - Acceptance:
    - [ ] `CLOCK_IN`, `CLOCK_OUT`, `BREAK_START`, `BREAK_END`, `STATUS` ya no ejecutan en chat: responden con el action link de asistencia (vía C5) + nota "Ahora el registro es en la app".
    - [ ] Saludos ("hola", "buenos días") → home menu (C6), no clock-in.
    - [ ] Se elimina la rama de geolocalización en chat para asistencia (la PWA `/dashboard/labor/geolocation` ya la captura); mensajes de ubicación reciben respuesta orientando al link.
    - [ ] `REGISTER` (invitación por token) y el flujo conversacional de workflows NO se tocan.
  - Verify: build en baseline; sandbox: "entrada" → link de asistencia (no crea registro en chat); "hola" → menú; invitación por token sigue funcionando.
  - Dependencies: C5, C6.

---

## Fase E — Cierre de turno (cierra T33u / T31t)

- [ ] **C8** Paso auto-completable en workflow de cierre. *Files: `lib/services/sales-ingestion-service.ts` (método `isCutReceived(branchId, date, shift?)`), `templates/operaciones_diarias/cierre-restaurante-v2-enhanced.json` (paso nuevo), motor de ejecución si el template no soporta auto-complete (verificar `workflow-execution-service.ts`). Size M.*
  - Acceptance:
    - [ ] `isCutReceived()` retorna el corte VALIDATED del día (o null).
    - [ ] Template de cierre incluye paso "Ventas del día registradas" que se auto-completa con evidencia ligada al corte cuando `isCutReceived()` es true.
    - [ ] Sin corte: paso queda pendiente con alerta **no bloqueante** (Q-C3) y nota de que el recordatorio llegará por WhatsApp con link al upload (C9).
  - Verify: build en baseline; ejecutar cierre con corte recibido → paso ✓ automático; sin corte → paso pendiente, workflow completable.
  - Dependencies: None (paralelizable con Fase D).

- [ ] **C9** Cron recordatorio de corte faltante. *Files: `lib/inngest/functions/cron-sales-cut-reminder.ts` (new), registro en serve (`app/api/inngest/route.ts` o índice de funciones). Size M.*
  - Acceptance:
    - [ ] Corre 30 min después del horario de cierre (default 23:30 local, Q-C1): sucursales sin corte VALIDATED → notificación `SALES_CUT_MISSING` al gerente por WhatsApp con **action link a `/dashboard/sales`** (vía C5 — no deep link plano).
    - [ ] +2h sin corte → escala a Director Ops (patrón de `cron-check-overdue`).
    - [ ] Idempotente por `(branchId, fecha)` (AD-C5): una segunda corrida el mismo día no re-notifica.
    - [ ] Registrado en el serve de Inngest y listado en la sección de crons de `AGENTS.md`.
  - Verify: build en baseline; en Inngest dev server: sucursal sin corte → evento y notificación con action link funcional; segunda corrida → sin duplicado.
  - Dependencies: C8, C5.

---

## Fase F — Caja chica (resto de T36u / T34t)

- [ ] **C10** Cron diario de auditoría de caja chica. *Files: `lib/inngest/functions/cron-petty-cash-check.ts` (new), `lib/services/notification-dispatcher.ts` (evento `PETTY_CASH_LOW` si no existe), registro en serve. Size S.*
  - Contexto: la alerta de umbral 20% al registrar salida y `replenishFund()` ya existen en `petty-cash-service.ts` (líneas 97–126); falta el cron de auditoría que pide T36u.
  - Acceptance:
    - [ ] Cron diario: fondos activos con `currentBalance < lowThreshold` → notificación `PETTY_CASH_LOW` a gerente + admin con **monto sugerido de reposición** (fondo − saldo).
    - [ ] Idempotente por `(fundId, fecha)`; no duplica si ya hubo alerta ese día.
    - [ ] Registrado en serve de Inngest + `AGENTS.md`.
  - Verify: build en baseline; fondo sembrado bajo umbral → notificación en Inngest dev; fondo sano → silencio.
  - Dependencies: C1 (requiere las tablas migradas).

### Checkpoint: Features
- [ ] Build en baseline; menú WA genera links que abren la PWA autenticada
- [ ] Paso de cierre se auto-completa con corte; recordatorio y escalamiento funcionan en Inngest dev
- [ ] Alerta de caja chica llega con monto sugerido
- [ ] Revisión con humano antes de Fase G

---

## Fase G — Verificación y sincronización

- [ ] **C11** Verificación de lo implementado sin verificar. *Files: `scripts/verify-sales-upload.ts`, `scripts/verify-finance.ts`, `scripts/verify-action-links.ts` (o consolidado), seeds de apoyo en `scripts/`. Size M. Cubre T28u–T30u, T35u, T37u–T40u, T21u + Fase D.*
  - Contexto: el commit `34f52f2` aterrizó upload UI, mapping UI, dashboard, caja chica, gastos, autorizaciones, cash flow, P&L y propinas **sin scripts de verificación** (a diferencia de T27u que tiene 119 checks).
  - Acceptance (mínimo por módulo):
    - [ ] Ventas: POST upload con fixture → VALIDATED; re-upload mismo día/turno → 409; analytics summary cuadra con suma de cortes sembrados.
    - [ ] Caja chica: salida con evidencia → saldo descuenta atómico; salida > saldo → error; reposición → saldo restaurado.
    - [ ] Gastos: crear $3,000 → auto-aprobado o GERENTE según regla; $60,000 → pendiente OWNER; aprobar → APPROVED + notificación; bitácora con `approvedBy` + timestamp.
    - [ ] Cash flow: proyección 30 días cuadra entradas − salidas; P&L por sucursal muestra **cobertura de datos** junto a cada número.
    - [ ] Propinas: distribución proporcional a horas trabajadas cuadra al centavo; unique `(branchId, date, shift)` rechaza duplicado.
    - [ ] Action links: single-use, expiración y whitelist verificados (reusa script de C5 si existe).
  - Verify: `npx tsx` de cada script con todos los checks en verde; build en baseline.
  - Dependencies: C1, C3–C10 (verifica el estado final).

- [ ] **C12** Sincronización documental de trackers. *Files: `tasks/plan-grupo-restaurantero-unificado.md` (Estado de Avance), `tasks/todo-ventas-gastos.md` (checkboxes), `tasks/todo-grupo-restaurantero.md` (T21), `AGENTS.md` (crons nuevos). Size XS.*
  - Acceptance:
    - [ ] Plan unificado: resumen actualizado (de "26 de 40" al estado real tras C1–C11), nota de sincronización con fecha de re-verificación, y registro de la **directiva WhatsApp** (AD-C7) como resolución de T32u.
    - [ ] `todo-ventas-gastos.md`: marcar T24t–T28t y T32t–T38t según corresponda, con nota "implementado en `34f52f2`, verificado en C11" o "completado por C# de `todo-cierre-gaps-ventas-gastos.md`"; T30t marcado como **resuelto por directiva** (menú + smart link, sin pipeline de documentos).
    - [ ] Desviaciones registradas: KPI service reescrito (C3), variante `pdfkit`/`jspdf` ya documentada, crons nuevos en `AGENTS.md`, deprecación de acciones en chat (C7).
  - Verify: lectura cruzada — ninguna casilla marcada sin evidencia en código o script de verificación.
  - Dependencies: C11.

### Checkpoint: Complete
- [ ] Todos los acceptance criteria cumplidos; scripts de verificación en verde
- [ ] Trackers consistentes con el código (sin casillas pendientes de trabajo ya implementado)
- [ ] Directiva WhatsApp documentada en el plan unificado
- [ ] Listo para revisión humana y merge
