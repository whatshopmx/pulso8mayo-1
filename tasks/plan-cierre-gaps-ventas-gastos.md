# Plan de Implementación: Cierre de Gaps Fases 9–10 (Ventas/POS + Pagos/Gastos)

> Cierra los gaps detectados en la auditoría de código 2026-08-04 sobre `tasks/plan-grupo-restaurantero-unificado.md`. Tracker operativo: `tasks/todo-cierre-gaps-ventas-gastos.md`.
>
> ⚠️ **Directiva de producto (2026-08-04):** WhatsApp se usa **solo como canal de verificación con smart links**. El bot ofrece un home menu (1. Registro entrada/salida/break, 2. Tareas diarias, 3. Reportar incidencia, 4. Cambio de turno / vacaciones) y cada opción genera un smart link con ese contexto que abre la PWA. **No hay flujos conversacionales ni ingesta de documentos por chat** — la ejecución siempre ocurre en la PWA. Esto cancela el spike de documentos (C2 original) y reemplaza la ingesta WhatsApp de cortes (T32u) por un smart link al upload.

## Overview

El commit `34f52f2 "cambios nuevos"` (2026-08-03) implementó la mayoría de Fases 9–10 y T21 **sin actualizar los trackers ni generar migraciones**. Este plan cubre: (1) la deuda de infraestructura (migración faltante), (2) los KPIs reales (T31u), (3) el menú WhatsApp con smart links autenticados (cierra T32u bajo la nueva directiva), (4) el cierre de turno (T33u), (5) el cron faltante de caja chica (resto de T36u), y (6) la verificación + sincronización documental de todo lo ya implementado.

**Convención de numeración:** se usa prefijo **C#** (cierre) para no colisionar con T41–T58 reservados por `tasks/plan-fiscal-control-interno.md`. Cada tarea C mapea explícitamente al T unificado (T#u) y al T del tracker `todo-ventas-gastos.md` (T#t).

## Estado auditado (fuente: código, no trackers)

| Bloque | Real en código | Brecha |
|---|---|---|
| T26u–T30u (schema, ingesta, upload, mapping UI, dashboard) | ✅ Implementado | Sin migración verificada para T34u; trackers sin marcar |
| T31u KPIs financieros | 🟡 Servicio existe pero **semántica incorrecta** y **desconectado**; UI usa % hardcodeados (28.5/26.2) | Rehacer cálculo + cablear API/UI |
| T32u WhatsApp cortes | ❌ No existe | **Redirigido por directiva:** menú + smart link a `/dashboard/sales` (sin pipeline de documentos) |
| T33u cierre de turno | ❌ Nada referencia `dailySalesCuts` desde workflows | Falta `isCutReceived()` + paso template + cron |
| T34u–T40u (gastos, caja chica, autorización, cash flow, P&L) | ✅ Implementado | **6 tablas sin migración**; falta cron de T36u |
| T21u propinas | ✅ Implementado (servicio + API + UI) | Misma migración faltante |

**Infra WhatsApp existente (auditada 2026-08-04):** `message-router` mapea teléfono→usuario por sesión; `command-parser` ejecuta acciones en chat (CLOCK_IN con saludos, BREAK, etc. vía `labor-handler` — **a deprecar por la directiva**); `SmartLinkService` + `magic_links` son workflow-specific (requieren `instanceId`/`templateId`, no sirven para deep links genéricos); better-auth sin plugin magic-link (sesiones DB + cookies). WHAPI soporta `sendMessageInteractive` (`list` con secciones) pero con **estabilidad no garantizada** (WhatsApp puede degradar a texto plano — ver `.agents/skills/whapi/references/msg-interactive.md`).

## Architecture Decisions

- **AD-C1 — Una sola migración de cierre:** las 6 tablas (`propinas`, `propina_asignaciones`, `petty_cash_funds`, `petty_cash_transactions`, `operating_expenses`, `expense_authorization_rules`) se generan en una migración `pnpm db:generate` inspeccionada manualmente antes de aplicar. La DB dev probablemente se sincronizó con `db:push` → riesgo de drift; el SQL generado es la fuente de verdad a revisar.
- ~~**AD-C2 — Spike documentos Wasender**~~ **CANCELADO (2026-08-04):** la directiva elimina la ingesta de documentos por chat; ya no se necesita verificar descarga de archivos.
- **AD-C3 — KPIs con fuentes correctas:** `financial-kpi-service` se reescribe para reusar `theoretical-consumption-service` (food cost por período) y `labor-calculator` (costo laboral real), con filtros de fecha en las 3 fuentes y scope empresa (no solo sucursal). Los fallbacks (28%/25%) solo se devuelven con flag `estimated: true` para que la UI los etiquete — nunca como dato silencioso.
- **AD-C4 — Extender `/api/sales/analytics` en vez de crear endpoint nuevo:** recibe los mismos filtros (branchId, rango de fechas); un solo roundtrip para la página de ventas.
- **AD-C5 — Idempotencia en crons nuevos:** recordatorio de corte y chequeo de caja chica deduplican por `(branchId, fecha)` usando el patrón de `cron-check-overdue`, para no re-notificar en cada corrida.
- **AD-C6 — Verificación por scripts tsx:** se sigue la convención del repo (`scripts/verify-sales-ingestion.ts`, 119 checks), no Playwright, para la verificación de servicios financieros.
- **AD-C7 — WhatsApp = menú + smart links (directiva de producto):** el bot responde a saludos/"menu"/selecciones con un home menu de 4 opciones de empleado (asistencia, tareas, incidencia, cambio de turno/vacaciones) + opciones de gerente (enviar corte → `/dashboard/sales`, aprobaciones → `/dashboard/labor/approvals`). Cada opción genera un **action link autenticado** y la ejecución ocurre en la PWA. Se deprecan las acciones en chat de `labor-handler` (CLOCK_IN/OUT/BREAK pasan a responder con el action link de asistencia; la geolocalización la maneja la PWA).
- **AD-C8 — Action links: JWT single-use con sesión minteada:** nueva tabla `action_links (token PK, userId, action, targetPath, expiresAt, usedAt)` + endpoint `GET /api/auth/wa-link?token=` que valida (firma, exp ≤60 min, no usado), marca `usedAt`, crea sesión better-auth para ese usuario, setea cookie y redirige a `targetPath` (whitelist de rutas internas — sin open redirects). Se elige tabla propia sobre extender `magic_links` (que es workflow-shaped) y sobre el plugin magic-link de better-auth (cambiaría la superficie de auth global). Canal de auditoría: cada link registra creación y uso.
- **AD-C9 — Menú: lista interactiva con fallback automático a texto:** se envía `sendMessageInteractive` type `list` (4+ opciones no caben en 3 botones) y el handler acepta indistintamente el row id, el título de la opción o el número ("1"–"6") como selección — los taps de botón/lista llegan como texto plano, así el fallback es gratis. Estructura exacta del payload según `.agents/skills/whapi/references/msg-interactive.md` (`action.list.sections[].rows[]`, `action.list.label` — no inventar parámetros).

## Task List

### Fase A — Fundación de datos
- [ ] **C1** Migración de cierre: 6 tablas sin migrar (T21u/T34u) + baseline de build documentado

### Fase C — KPIs reales (cierra T31u / T29t)
- [ ] **C3** Reescribir cálculo de `financial-kpi-service` (fuentes correctas, período, scope empresa, flag `estimated`)
- [ ] **C4** Cablear KPIs reales: extender `/api/sales/analytics` + reemplazar hardcodes en `financial-kpi-cards.tsx` + mensaje de cobertura

### Checkpoint: KPIs
- [ ] Cards de `/dashboard/sales` muestran datos reales; semáforo cambia al cruzar umbrales; "estimado" visible cuando aplica

### Fase D — Menú WhatsApp + Smart Links (cierra T32u / T30t bajo directiva)
- [ ] **C5** Action links autenticados: tabla `action_links` + servicio + endpoint `/api/auth/wa-link` (sesión minteada, single-use, whitelist de rutas)
- [ ] **C6** Home menu bot: `menu-handler` con lista interactiva + fallback numerado, role-aware, genera action link contextual
- [ ] **C7** Deprecar acciones en chat: `command-parser`/`labor-handler` responden con action link de asistencia

### Fase E — Cierre de turno (cierra T33u / T31t)
- [ ] **C8** `isCutReceived()` + paso auto-completable en template de cierre
- [ ] **C9** Cron `cron-sales-cut-reminder` con escalamiento gerente → Director Ops (recordatorio incluye action link al upload, vía C5)

### Fase F — Caja chica (resto de T36u / T34t)
- [ ] **C10** Cron diario `cron-petty-cash-check` con evento `PETTY_CASH_LOW` y monto sugerido

### Checkpoint: Features
- [ ] Build en baseline; menú WA genera links que abren la PWA autenticada; paso de cierre se auto-completa; crons visibles en Inngest dev

### Fase G — Verificación y sincronización
- [ ] **C11** Scripts `scripts/verify-*.ts` para lo implementado sin verificar (T28u–T30u, T35u, T37u–T40u, T21u) + menú/action links
- [ ] **C12** Sincronizar trackers: Estado de Avance del plan unificado + checkboxes de `todo-ventas-gastos.md` + desviaciones + directiva WhatsApp

## Risks and Mitigations

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Migración revela drift de `db:push` en dev | Alto | Inspeccionar SQL generado antes de aplicar; usar branch de Neon para probar `migrate` antes de tocar dev principal |
| Botones/listas interactivas de WHAPI no renderizan (inestabilidad documentada) | Medio | AD-C9: el handler acepta texto plano ("1"–"6", título o row id); la experiencia degrada a menú numerado sin romperse |
| Action link como vector de account takeover si se reenvía | Alto | AD-C8: single-use + exp 60 min + sesión del usuario dueño del teléfono (no eleva privilegios) + whitelist de rutas + auditoría de uso |
| `theoretical-consumption-service` sin datos por período | Medio | Fallback con flag `estimated` (AD-C3); la UI nunca muestra un número sin etiqueta |
| Crons re-notifican en cada corrida | Medio | Idempotencia `(branchId, fecha)` (AD-C5) |
| Deprecar clock-in por chat rompe hábito operativo | Medio | C7 responde con el action link (misma fricción: 1 tap); la PWA de asistencia ya captura geolocalización |
| Build ya roto por WIP ajeno (Fases 11–14, `tenant-config-service.ts`) | Bajo | C1 documenta el baseline para no atribuir errores preexistentes a este plan |

## Open Questions

- **Q-C1: ¿Horario de cierre por sucursal para C9?** ¿Existe configuración en branch settings? Si no, default 23:30 hora local de la sucursal y se deja configurable después. *(Recomendación: default fijo + TODO.)*
- **Q-C2: ¿Umbrales KPI configurables por tenant ahora?** `tenant_operating_config` es WIP de Fases 11–14. *(Recomendación: defaults del servicio (30/35, 28/32); configurabilidad queda para el plan fiscal.)*
- **Q-C3: ¿El paso de corte en el cierre bloquea o solo alerta?** El plan unificado dice "Bloqueo o alerta". *(Recomendación: alerta no bloqueante con evidencia requerida — bloquear rompe la operación si el POS falla.)*
- **Q-C4: ¿Verificación E2E con Playwright además de scripts tsx?** *(Recomendación: solo tsx por convención del repo; Playwright ya cubre flujos de UI generales.)*
- **Q-C5: ¿Expiración de action links?** *(Recomendación: 60 min, single-use — suficiente para abrir la PWA; si expira, el usuario pide menú de nuevo con "menu".)*
- **Q-C6: ¿Opciones extra de gerente en el menú?** Además de las 4 de empleado. *(Recomendación: "📊 Enviar corte de ventas" → `/dashboard/sales` y "✅ Aprobaciones" → `/dashboard/labor/approvals`; crecer el menú después por demanda.)*
- **Q-C7: ¿Mantener clock-in por chat como fallback oculto?** *(Recomendación: no — deprecar de inmediato respondiendo con el action link; doble vía genera asistencias inconsistentes.)*
