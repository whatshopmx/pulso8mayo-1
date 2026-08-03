# Handoff — Implementación Fases 4-10 (Grupo Restaurantero v2)

**Sesión:** 2026-08-03  
**Plan fuente:** `tasks/plan-grupo-restaurantero-unificado.md` (T1-T40)  
**Skill activa:** incremental-implementation (slices verticales, test→verify→commit)  
**Estado general:** 24 de 40 tareas completadas (T1-T10, T12, T17-T19, T23-T27), T18 finished, T20 en progreso. 16 pendientes.

---

## ⚠️ IMPORTANTE — Cambios sin commitear (no son de esta sesión)

Antes de cualquier `git add`, **revisa `git status`**: hay trabajo previo no commiteado de Fase 11 (T41 — `tenant_operating_config`) y otros archivos que **NO fueron tocados en esta sesión**:

```
M  lib/db/schema.ts                          ← Fase 11 (T41) — NO commitear como nuestro
M  drizzle/meta/_journal.json                ← migraciones 0023/0024 (T41) — NO commitear
M  docs/pulso-estrategia-unificada.md        ← trabajo previo
M  lib/services/company-service.ts           ← trabajo previo
M  lib/services/incident-engine.ts           ← trabajo previo
M  tasks/todo-grupo-restaurantero.md          ← tracker (actualizar al terminar)
M  tasks/todo.md                             ← tracker
?? app/api/tenant/                           ← trabajo previo (T41)
?? lib/services/tenant-config-service.ts     ← trabajo previo (T41)
?? lib/services/tenant-config-service.ts     ← trabajo previo (T41)
?? scripts/extract-code.py                   ← no nuestro
?? scripts/extract-docs.py                   ← no nuestro
?? scripts/ibv.html                         ← no nuestro
?? tasks/plan-fiscal-control-interno.md       ← plan Fases 11-14 (referencia)
?? tasks/todo-fiscal-control-interno.md       ← tracker Fases 11-14 (referencia)
?? drizzle/0023_amazing_unus.sql             ← migración T41 (no aplicar)
?? drizzle/0024_cuddly_gertrude_yorkes.sql    ← migración T41 (no aplicar)
```

### Archivos modificados/creados EN esta sesión (commitear juntos con mensaje `feat(grupo-restaurantero): T9, T10, T17, T18, T19 — WhatsApp smart links, portal externos, buscador comunicaciones`)

**Modificados:**
- `app/api/shift-change-requests/route.ts` — T9: smart link profundo en POST
- `app/api/shift-sessions/route.ts` — T10: smart link + metadata en NO_SHOW
- `app/dashboard/company/communications/page.tsx` — T19: buscador + filtro sucursal
- `app/dashboard/labor/attendance/page.tsx` — T10: banner contextual por `?sessionId=`
- `components/communications/announcement-card.tsx` — T19: `highlight` prop + highlights
- `components/labor/shift-change-request-list.tsx` — T9: `focusId` prop auto-abre diálogo
- `lib/services/notification-dispatcher.ts` — T9+T10: `{smartLinkUrl}` en plantillas

**Nuevos:**
- `app/api/communications/announcements/[id]/read/route.ts` — T18: endpoint autenticado idempotente
- `app/api/external-reports/generate/route.ts` — T17: mintea token JWT (admin)
- `app/dashboard/labor/shift-changes/[id]/page.tsx` — T9: página deep link
- `app/external/report/[token]/page.tsx` — T17: portal externos solo lectura (NOM-251)
- `lib/services/external-report-service.ts` — T17: servicio JWT stateless (máx 7 días, AD-4)

---

## ✅ Tareas Completadas en Esta Sesión (6)

### T9 — Notificación WhatsApp: cambio de turno ✅
**Gap encontrado:** las notificaciones ya se enviaban (POST `/api/shift-change-requests`), pero con `actionUrl` genérico `/dashboard/labor/shift-changes` (sin id, sin smart link). La plantilla WhatsApp no incluía URL.

**Cambios:**
1. Plantilla `shift_change_request` (notification-dispatcher.ts): añadido `{smartLinkUrl}` en whatsapp/email/in-app.
2. POST handler (shift-change-requests/route.ts): `actionUrl` ahora `/dashboard/labor/shift-changes/${requestId}` y `metadata.smartLinkUrl` con URL absoluta.
3. `ShiftChangeRequestList` (shift-change-request-list.tsx):新增 `focusId` prop — autoabre diálogo de respuesta/vista al cargar.
4. Nueva página `/dashboard/labor/shift-changes/[id]/page.tsx` — renderiza `<ShiftChangeRequestList focusId={params.id} />`.

**Nota:** No usó `SmartLinkService` (JWT workflow) porque el deep link es interno (PWA autenticada), no un enlace público sin credenciales. AD-3 se cumple vía deep link contextual.

### T10 — Notificación WhatsApp: reportar ausencia (NO_SHOW) ✅
**Gap encontrado:** las notificaciones `employee_absence` ya se enviaban al cambiar status a `NO_SHOW` (shift-sessions/route.ts:245-334), pero `actionUrl` era genérico `/dashboard/labor/attendance` y la plantilla no incluía URL.

**Cambios:**
1. Plantilla `employee_absence`: añadido `{smartLinkUrl}`.
2. PUT handler (shift-sessions/route.ts): `actionUrl` ahora `/dashboard/labor/attendance?sessionId=${existing.id}` para supervisor+managers; `metadata.smartLinkUrl` con URL absoluta al empleado.
3. Página `/dashboard/labor/attendance/page.tsx`: banner contextual "Llegaste desde una alerta de ausencia" cuando hay `?sessionId=`. Envuelto en `<Suspense>` (Next 16 requiere Suspense para `useSearchParams`).

### T12 — Notificación WhatsApp: capacitación ✅ (ya estaba completa)
**Verificación:** `workflow-assignment-service.ts:84-134` ya detecta templates de capacitación (category `TRAINING`/`CAPACITACION` o nombre), crea `SmartLink` real (JWT 7 días → `/workflow/public/[token]`), y despacha `training_assigned` con `smartLinkUrl` + `actionUrl` al executor PWA. Página `/workflow/public/[token]/page.tsx` confirmada existente. **Sin cambios.**

### T17 — Portal de externos con token JWT ✅
**Construido desde cero** (AD-4: JWT 7 días, stateless, solo lectura).

**Nuevos archivos:**
1. `lib/services/external-report-service.ts` — `ExternalReportService`:
   - `generateExternalToken(input)`: firma JWT HS256 con `{reportType, companyId, branchId, startDate, endDate, recipientName, recipientRole, type:'EXTERNAL_REPORT', exp}`. Max 7 días (AD-4). Stateless: sin persistencia.
   - `validateExternalToken(token)`: verifica JWT, retorna payload o null.
2. `app/api/external-reports/generate/route.ts` — POST admin-only (ADMIN/SUPERVISOR/GERENTE/SUPER_ADMIN). Zod valida input. Usa `requireAuth` + `requireTenant`. Retorna `{token, url, expiresAt}`.
3. `app/external/report/[token]/page.tsx` — server component, valida token, genera reporte NOM-251 via `complianceReportService.generateNOM251Report`, renderiza:
   - KPIs (inspecciones totales/completadas/% cumplimiento)
   - Cumplimiento por categoría (barras de progreso)
   - Tabla de inspecciones
   - Footer con firma digital + huella + expiración
   - Vistas de error: token inválido/expirado, tipo no soportado, error genérico

**Solo NOM-251 implementado.** NOM-035 y LABOR_LAW retornan vista "no soportado" (extensible más tarde).

### T18 (finish) — Confirmación de lectura en anuncios ✅
**Gap encontrado:** existía endpoint `mark-read` en `/api/communications` (route.ts:198) pero **inseguro** (userId del body, no autenticado). La métrica "X de Y leídos" ya existía en `AnnouncementCard` (línea 112). Faltaba el **endpoint autenticado**.

**Nuevo archivo:** `app/api/communications/announcements/[id]/read/route.ts`
- POST autenticado vía `requireTenant` (userId de sesión, nunca del body).
- Verifica que el anuncio exista y pertenezca al tenant.
- **Idempotente:** si ya existe recibo, retorna `alreadyRead:true` sin duplicar.
- Si no existe: inserta recibo, incrementa `readCount` en `employeeCommunications`.
- Retorna `{alreadyRead, readAt, readCount, totalRecipients}` para refrescar UI.

### T19 — Buscador de comunicaciones ✅
**Cambios:**
1. `announcement-card.tsx`: añadida `highlight?: string` prop + función `highlightText` (resalta coincidencias con `<mark>` en título y contenido, regex escapada).
2. `communications/page.tsx`:
   - Estado `search` (Input con icono) y `branchFilter` (Select de sucursales cargadas desde `/api/branches`).
   - `filteredAnnouncements`: filtra por texto (título/contenido, case-insensitive) Y por sucursal.
   - Contador de resultados cuando hay búsqueda activa.
   - Todos los Tabs ahora usan `filteredAnnouncements` y pasan `highlight={search}`.
   - Empty state distingue "sin resultados de búsqueda" vs "sin comunicaciones".

---

## 🔵 Tarea En Progreso (1)

### T20 — Módulo de Protección Civil 🟡 (INICIADO, no terminado)
**Plan:** bitácora de simulacros/extintores con OCR para fechas y checklist fotográfico de salidas despejadas.

**Investigación realizada:**
- Revisé `lib/db/schema/equipment.ts` — patrón de módulo (pgEnum + pgTable + refs a companies/branches/users).
- Revisé `lib/db/schema/index.ts` — barrel export de auth/core/equipment.
- Revisé `lib/services/ComplianceReportService.ts` — patrón de servicio.
- Revisé `app/api/compliance/corporate-status/route.ts` — patrón de API admin.
- **NO se escribió código todavía** — el slice se interrumpió aquí.

**Slice plan sugerido para continuar T20:**
1. **Schema** (`lib/db/schema/civil-protection.ts`):
   - `civilProtectionDrills` (simulacros): `{id, companyId, branchId, drillType (EVACUACION/CONFINAMIENTO/SIMULACRO_GENERAL), drillDate, participantsCount, evacuationTimeSec, observations, evidenceUrls jsonb, createdBy, createdAt, updatedAt}`
   - `extinguisherInspections` (extintores): `{id, companyId, branchId, extinguisherId (text), location, inspectionDate, pressureOk bool, sealOk bool, expirationDate, ocrRawData jsonb, evidenceUrl, nextInspectionDate, inspectorName, notes, createdAt, updatedAt}`
   - `exitChecklistItems` (checklist salidas): `{id, companyId, branchId, exitLocation, isClear bool, signageOk bool, emergencyLightOk bool, photoUrl, notes, inspectedAt, inspectedBy}`
   - Exportar en `schema/index.ts` y agregar a `schema.ts` ( barrel)
2. **Migración Drizzle** (`pnpm db:generate` — NO `db:push`)
3. **Servicio** (`lib/services/civil-protection-service.ts`): CRUD + queries por tenant
4. **API** (`app/api/civil-protection/drills/route.ts`, `extinguishers/route.ts`, `exits/route.ts`) con `requireTenantAuth`
5. **UI** (`app/dashboard/civil-protection/page.tsx`): 3 tabs (simulacros, extintores, salidas) con formularios + listado + upload de fotos (R2 o fallback local)
6. **OCR:** reutilizar `lib/services/evidence-processor` (motor OCR existente mencionado en plan) para extraer fechas deextintores desde fotos

**Risk-first slicing:** primero probar OCR en una foto de extintor antes de construir toda la UI.

---

## ⏳ Tareas Pendientes (15) — Orden Sugerido

### Fase 7 (restante)
- [ ] **T20** — Módulo de Protección Civil (ver arriba, EN PROGRESO)
- [ ] **T22** — Alertas IMSS: cron Inngest para recordar fechas SUA (días 7, 3, 1 antes). Patrón: ver `lib/inngest/functions/` (11 cron jobs existentes). Nuevo `lib/inngest/functions/imss-alerts.ts` con trigger `0 8 * * *` y lógica de días.

### Fase 9 (restante) — M13 Ventas/POS
- [ ] **T28** — API y UI de Upload Manual: `app/api/sales/upload/route.ts` (usa `sales-ingestion-service.ts` ya implementado en T27) + UI `app/dashboard/sales/upload/page.tsx` (drag-drop XLSX/CSV, preview de columnas detectadas, confirmación). Mostrar discrepancias.
- [ ] **T29** — Configuración de Plantillas POS: UI admin para definir mapeo de columnas del POS de cada sucursal en `pos_mapping_templates` (tabla ya existe por T26). `app/dashboard/sales/pos-templates/page.tsx`.
- [ ] **T30** — Dashboard de Ventas: visualización por turno, canal (salón/delivery/eventos), ticket promedio. Recharts. `app/dashboard/sales/page.tsx`.
- [ ] **T31** — KPIs de Costo de Alimento y Laboral: fórmulas dinámicas Costo Alimentos % = Consumo Teórico / Ventas, Costo Laboral % = Nómina / Ventas. Servicio de agregación.
- [ ] **T32** — WhatsApp Ingesta: webhook de WhatsApp (`app/api/whatsapp/webhook/route.ts`) captura adjuntos XLSX/CSV, los pasa a `sales-ingestion-service`, fallback formulario de texto. Verificar Wasender API si soporta archivos (riesgo P del plan: fallback OCR/foto).
- [ ] **T33** — Cierre de Turno e Integración de Workflow: bloqueo/alerta en workflow de cierre si corte de ventas no recibido. Hook en `workflow-executor` o guard en `app/api/workflows/execute/route.ts`.

### Fase 10 — M16 Pagos/Gastos
- [ ] **T34** — Schema de Gastos: `petty_cash_funds`, `petty_cash_transactions`, `operating_expenses`, `expense_authorization_rules`. Dinero en centavos (AD-5). Migración aditiva.
- [ ] **T35** — Caja Chica (Servicio + UI): retiros con foto de ticket, control de saldo, reposiciones. CRUD servicio + dashboard.
- [ ] **T36** — Reposición Automática: alerta fondo < 20% + cron Inngest auditoría movimientos. Nuevo `lib/inngest/functions/petty-cash-audit.ts`.
- [ ] **T37** — Gastos Operativos por Categoría: renta, energía, agua, gas, mantenimientos sin OC. Formulario + listado.
- [ ] **T38** — Autorización por Monto: reglas dinámicas (Gerente <$1,000, Dir. Ops <$10,000, Owner ilimitado). Reutilizar motor de escalamiento existente. AD-9: esquema independiente de `shift_approvals`. **Nota:** `tenant_operating_config` (T41, ya en schema sin commitear) ya define `managerAuthLimitCents`, `doubleApprovalThresholdCents`, `pettyCashLimitCents` — integrar con esos campos.
- [ ] **T39** — Calendario de Flujo de Efectivo: proyección 30 días = Ventas estimadas − (Nómina + Gastos + CxP). Servicio de agregación con `unstable_cache` 5 min (AD-10).
- [ ] **T40** — P&L Operativo Estimado por Sucursal: Utilidad Operativa = Ventas − Alimentos − Laboral − Gastos. Widget consolidado con mensaje de cobertura explícito (riesgo del plan: "Calculado con el 80% de los datos").

### Post-Fase 10 (re-priorizada 2026-08-04)
- [ ] **T21** — Distribución de propinas: `propinas` + `propina_asignaciones` con cálculo proporcional a horas trabajadas. Respuesta de producto a compensación en efectivo del sector (LFT Art. 346). Convertir flujo informal en canal legal auditable.

---

## 🏗️ Patrones Clave del Codebase (reutilizar)

### Notificaciones (T9/T10/T12 patrón)
- **Dispatcher:** `NotificationDispatcher.sendNotification({userId, title, message, type, eventType, actionUrl, actionLabel, metadata})` en `lib/services/notification-dispatcher.ts`.
- **Plantillas:** registry `notificationTemplates` en mismo archivo. Variables `{varName}` se reemplazan con `metadata[varName]`.
- **Canales:** WhatsApp (Wasender via `sessionManager.getActiveSession(companyId)`), Email (Resend), In-App (tabla `notifications`).
- **Preferencias:** tabla `notificationPreferences` por usuario. Default true si no existe.
- **Smart links workflow (públicos):** `SmartLinkService.createSmartLink(instanceId, templateId, sessionId, expiresInMinutes, ...)` → `/workflow/public/[token]`. JWT 7 días.
- **Smart links internos (PWA auth):** deep link `actionUrl: /dashboard/...` (no JWT) — usado en T9/T10.

### Auth en API routes
- `requireTenant()` — retorna `{id: companyId, userId, ...}`. Use para endpoints tenant-scoped.
- `requireAuth()` — retorna `{user: AuthUser}`. Sin companyId.
- `requireTenantAuth()` — retorna `{user, tenantId, branchId}`. Lanza `ApiError`.
- `withTenantAuth(handler)` — HOC wrapper. `auth.tenantId`, `auth.user.id`.
- **Reglas hard:** tenantId SIEMPRE de sesión (nunca body). userId SIEMPRE de sesión.
- **Next 16 params:** `params: Promise<{id: string}>` — usar `const { id } = await params`.

### Schema y migraciones
- **Módulos:** `lib/db/schema/{core,auth,equipment}.ts` + barrel `index.ts` + agregados en `lib/db/schema.ts`.
- **Migraciones:** `pnpm db:generate` (genera SQL en `drizzle/`). `pnpm db:migrate` aplica. **NUNCA `pnpm db:push` sin revisar** (puede dropear tablas).
- **Dinero:** centavos enteros (AD-5). `integer("amount_cents")`.
- **Multi-tenant:** todas las tablas scoped por `companyId` (FK a `companies.id`).

### Inngest cron jobs
- Cliente: `lib/inngest/client.ts`. Funciones en `lib/inngest/functions/`. Serve: `app/api/inngest/route.ts`.
- Patrón: `inngest.createFunction({id, triggers:[{event}]|[{cron}]}, async ({event, step}) => {...})`.
- Step.run para memoización/durabilidad. Retries: 2 default.
- Para T22/T36: nuevo archivo en `lib/inngest/functions/`, importar en `lib/inngest/functions/index.ts` (si existe barrel) o donde se registren las funciones para serve.

### UI (dashboard)
- App Router, React 19, Radix UI + Tailwind CSS v4.
- `useRequireRole([...roles])` hook para guards de página.
- Server components por defecto; `'use client'` solo cuando necesario (state, fetch, events).
- `useSearchParams()` requiere `<Suspense>` boundary (Next 16).

### Lint/typecheck
- `pnpm run lint` (ESLint). `npx tsc --noEmit` (typecheck). `pnpm run build` (build completo).
- TypeScript `strict: false` — algunos issues no surfacean.
- **Regla 0.5 (scope discipline):** NO limpiar `any`/warnings preexistentes fuera de tu scope. NO tocar archivos adyacentes.

---

## 📋 Tracker a Actualizar al Continuar

`tasks/todo-grupo-restaurantero.md` — marcar T9, T10, T12, T17, T18, T19 como `[x]`. T20 queda `[~]` (parcial). El plan unificado (`tasks/plan-grupo-restaurantero-unificado.md`) línea 20 actualizar resumen a "24 de 40 completadas".

---

## 🚀 Cómo Continuar en Nueva Sesión

1. **Leer este documento** + `tasks/plan-grupo-restaurantero-unificado.md` (planes Fases 4-10) + `AGENTS.md` (comandos, arquitectura).
2. **`git status`** para ver cambios sin commitear (verificar que coincidan con esta lista).
3. **Primero commitear** el trabajo de esta sesión (ver mensaje sugerido arriba) — antes de empezar T20, para tener rollback limpio.
4. **Continuar T20** con el slice plan de arriba (schema → migración → servicio → API → UI → OCR).
5. **Después T22** (Alertas IMSS — Inngest cron, slice único).
6. **Después Fase 9** (T28→T33, ventas/POS — ya existen T26 schema + T27 servicio).
7. **Después Fase 10** (T34→T40, pagos/gastos — desde schema). **Integrar T38 con `tenant_operating_config` ya existente.**
8. **Último T21** (propinas, re-priorizada post-Fase 10).
9. Por cada slice: implementar → `npx eslint <archivos>` → `npx tsc --noEmit` (si toca types) → verificar → commitear → actualizar tracker.

---

## 🔑 Decisiones de Arquitectura Relevantes (AD)

- **AD-3:** WhatsApp como Hub + Smart Links. Notifica y envía enlace único para ejecutar acciones en PWA. No flujos interactivos de texto complejos en chat.
- **AD-4:** Portal externos sin credenciales. URLs seguras con JWT firmado, máx 7 días. Solo lectura. Stateless (no persistencia del token). Implementado en T17.
- **AD-5:** Dinero en centavos (Integer MXN). Todas las tablas financieras (T34+).
- **AD-6/7/8:** Ingesta POS por archivos (no API directa), esquema canónico + alias + diccionario dinámico, 4 formatos comunes. T27 ya hecho.
- **AD-9:** Segregación de aprobaciones financieras (independiente de `shift_approvals`), reutiliza motor de escalamiento. T38.
- **AD-10:** P&L y flujo de efectivo en tiempo real. Servicios de agregación de lectura con `unstable_cache` 5 min. T39/T40.