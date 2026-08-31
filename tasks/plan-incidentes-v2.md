# Implementation Plan: Incidentes V2 — Dashboard, Notificaciones, Remediación, Analytics, Multi-sucursal, Mobile

## Overview

Mejora integral del módulo de incidentes en 6 áreas: dashboard gerencial, notificaciones mejoradas, remediación con AI, analytics/reportes, vista multi-sucursal consolidada, y optimización mobile-first. Cada fase es shipeable independientemente.

## Estado Actual

**Ya existe:**
- Lista de incidentes con filtros, severidad, badges
- Summary strip (total, activos, críticos, resueltos, requieren acción)
- IncidentActionPanel con recomendaciones
- RemediationWizard (self-fix + servicios externos)
- Escalación automática (WhatsApp/email por niveles)
- Notificaciones WhatsApp + email + in-app (NotificationDispatcher)
- Branch scoping en incidentes
- Schema DB: incidents, remediationActions, notifications, notificationPreferences

**No existe:**
- Dashboard analítico de incidentes (tendencias, time-to-resolution, por tipo)
- Confirmación de lectura de notificaciones
- Verificación AI de evidencia fotográfica
- Vista consolidada multi-sucursal con comparativas
- PWA / push notifications / cámara integrada

## Architecture Decisions

- **Dashboard analytics usa la misma API de trends existente** (`/api/analytics/trends`) con un nuevo tipo `incident_analytics`. No duplica infraestructura.
- **Read confirmation se agrega a la tabla `notifications`** con un campo `readAt` que ya existe. Solo falta el endpoint PATCH y el tracking.
- **AI photo verification usa el endpoint `/api/ai/verify`** existente. No crea nuevo servicio AI.
- **Multi-sucursal usa branch scoping existente** con una vista agregada que hace UNION de incidentes de todas las sucursales del usuario.
- **Mobile-first es progressive enhancement**: responsive CSS + PWA manifest + service worker. No requiere cambios de schema.

## Task List

### Phase 1: Dashboard Gerencial — Incident Analytics Page

Crear una página de analytics dedicada para incidentes que muestre al gerente/dueño métricas clave.

- [ ] **Task 1**: API endpoint `/api/analytics/incidents` con métricas: total por período, severity distribution, avg time-to-resolution, top incident types, incidents per branch
  - **AC:** Endpoint retorna JSON con `summary`, `bySeverity`, `byBranch`, `trends`, `timeToResolution`
  - **Scope:** S (1 archivo, ~80 líneas)
  - **Files:** `app/api/analytics/incidents/route.ts`

- [ ] **Task 2**: Gráficas de incidentes con Recharts: bar chart por severidad, line chart de tendencia temporal, pie chart de status distribution
  - **AC:** 3 gráficas renderizan datos del endpoint. Tooltip muestra valores. Responsive en mobile.
  - **Scope:** M (1 archivo, ~150 líneas)
  - **Files:** `components/charts/incident-analytics-charts.tsx`

- [ ] **Task 3**: Página `/dashboard/analytics/incidents` con layout, filtros de fecha (7d, 30d, 90d), selector de sucursal, y las gráficas
  - **AC:** Página carga datos al montar. Filtros actualizan las gráficas. Muestra loading skeleton.
  - **Scope:** M (1 archivo, ~120 líneas)
  - **Files:** `app/dashboard/analytics/incidents/page.tsx`

- [ ] **Task 4**: KPI cards en la parte superior: total incidentes, tiempo promedio de resolución, % resueltos, incidentes activos
  - **AC:** 4 cards con icono, valor, y delta vs período anterior. Estilo consistente con otros dashboards.
  - **Scope:** S (1 archivo, ~60 líneas)
  - **Files:** `components/dashboard/incident-kpi-cards.tsx`

### Checkpoint: Phase 1
- [ ] Página de analytics carga y muestra gráficas
- [ ] Filtros funcionan
- [ ] `pnpm run build` pasa

---

### Phase 2: Notificaciones Mejoradas — Read Confirmation + Templates

Mejorar el sistema de notificaciones con confirmación de lectura y templates específicos para incidentes.

- [ ] **Task 5**: Endpoint PATCH `/api/notifications/[id]/read` para marcar notificación como leída (actualiza `readAt`)
  - **AC:** PATCH con `{ read: true }` actualiza `read` y `readAt`. Retorna notificación actualizada.
  - **Scope:** XS (1 archivo, ~25 líneas)
  - **Files:** `app/api/notifications/[id]/read/route.ts`

- [ ] **Task 6**: Hook `useNotifications` para polling de notificaciones no leídas (cada 30s) y contador de unread
  - **AC:** Hook retorna `{ notifications, unreadCount, markAsRead, isLoading }`. Polling se detiene cuando la pestaña no está activa.
  - **Scope:** S (1 archivo, ~60 líneas)
  - **Files:** `hooks/use-notifications.ts`

- [ ] **Task 7**: Bell icon en el header con dropdown de notificaciones, contador badge, y mark-as-read on click
  - **AC:** Bell muestra contador rojo. Dropdown lista últimas 10 notificaciones. Click marca como leída.
  - **Scope:** M (1-2 archivos, ~100 líneas)
  - **Files:** `components/notifications/notification-bell.tsx`, actualización de layout

- [ ] **Task 8**: Templates específicos para incidentes: "Incidente detectado", "Escalación", "Resolución", "Servicio externo agendado"
  - **AC:** Cada template tiene variables dinámicas (título, severidad, sucursal, fecha). Formato WhatsApp y email.
  - **Scope:** S (1 archivo, ~50 líneas)
  - **Files:** `lib/whatsapp/templates/incident-templates.ts`

### Checkpoint: Phase 2
- [ ] Notificaciones se marcan como leídas
- [ ] Bell icon muestra contador
- [ ] Templates de incidentes funcionan
- [ ] `pnpm run build` pasa

---

### Phase 3: Remediación Mejorada — AI Photo Verification + Evidence History

Mejorar el wizard de remediación con verificación AI de fotos y historial de evidencia.

- [ ] **Task 9**: Componente `EvidenceGallery` que muestra fotos/evidencia de intentos anteriores del incidente
  - **AC:** Galería muestra thumbnails con fecha, resultado (pass/fail), y paso. Click abre modal con foto completa.
  - **Scope:** M (1 archivo, ~100 líneas)
  - **Files:** `components/incidents/evidence-gallery.tsx`

- [ ] **Task 10**: Integrar AI verification en RemediationWizard: cuando el paso tiene `validationCriteria.type === 'photo'`, enviar foto a `/api/ai/verify` y mostrar resultado
  - **AC:** Wizard sube foto → AI verifica → muestra confidence score → si >85% auto-approve, si no → mark for review
  - **Scope:** M (1 archivo modificado, ~40 líneas added)
  - **Files:** `components/incidents/remediation-wizard.tsx`

- [ ] **Task 11**: API endpoint `/api/incidents/[id]/evidence` que retorna todo el historial de evidencia del incidente (fotos, textos, resultados AI)
  - **AC:** Endpoint retorna array de evidence items con tipo, contenido, resultado, timestamp, stepIndex
  - **Scope:** S (1 archivo, ~40 líneas)
  - **Files:** `app/api/incidents/[id]/evidence/route.ts`

- [ ] **Task 12**: Tab "Evidencia" en el detail page del incidente que muestra la galería de evidencia
  - **AC:** Tab aparece junto a "Línea de tiempo". Muestra galería. Si no hay evidencia, muestra empty state.
  - **Scope:** S (1 archivo modificado, ~30 líneas)
  - **Files:** `app/dashboard/incidents/[id]/page.tsx`

### Checkpoint: Phase 3
- [ ] Wizard verifica fotos con AI
- [ ] Galería de evidencia funciona
- [ ] Tab de evidencia en detail page
- [ ] `pnpm run build` pasa

---

### Phase 4: Reportes y Analytics — Export + Compliance Score

Generar reportes descargables y un score de cumplimiento basado en incidentes.

- [ ] **Task 13**: API endpoint `/api/reports/incidents` que genera CSV/Excel con incidentes filtrados por fecha, sucursal, severidad
  - **AC:** Endpoint acepta query params (start, end, branchId, severity). Retorna CSV con headers: ID, Título, Severidad, Status, Sucursal, Detectado, Resuelto, Tiempo resolución, Resolución.
  - **Scope:** S (1 archivo, ~60 líneas)
  - **Files:** `app/api/reports/incidents/route.ts`

- [ ] **Task 14**: Botón "Exportar CSV" en la página de analytics que descarga el reporte
  - **AC:** Botón usa los mismos filtros activos. Descarga archivo .csv. Muestra toast de éxito/error.
  - **Scope:** XS (1 archivo, ~20 líneas)
  - **Files:** `app/dashboard/analytics/incidents/page.tsx` (modificación)

- [ ] **Task 15**: Compliance Score calculado: (incidentes resueltos a tiempo / total) × 100, con tendencia mensual
  - **AC:** Score de 0-100. Color: verde >80, amarillo 60-80, rojo <60. Muestra tendencia vs mes anterior.
  - **Scope:** S (1 archivo, ~50 líneas)
  - **Files:** `components/dashboard/compliance-score-card.tsx`

- [ ] **Task 16**: API endpoint `/api/analytics/compliance` que calcula el score por sucursal y período
  - **AC:** Retorna `{ overall, byBranch: [{ branchId, name, score, trend }] }`
  - **Scope:** S (1 archivo, ~50 líneas)
  - **Files:** `app/api/analytics/compliance/route.ts`

### Checkpoint: Phase 4
- [ ] CSV export funciona
- [ ] Compliance score calculado y mostrado
- [ ] `pnpm run build` pasa

---

### Phase 5: Multi-sucursal — Vista Consolidada + Comparativas

Vista que consolida incidentes de todas las sucursales con comparativas.

- [ ] **Task 17**: Modificar query de incidentes para soportar "all branches" cuando no hay filtro de sucursal (ya parcialmente existe con `buildConditions`)
  - **AC:** Cuando el usuario selecciona "Todas las sucursales", la lista muestra incidentes de todas las sucursales con badge de sucursal
  - **Scope:** S (1 archivo modificado, ~20 líneas)
  - **Files:** `app/dashboard/incidents/page.tsx`

- [ ] **Task 18**: Componente `BranchIncidentSummary` que muestra una card por sucursal con: total incidentes, activos, resueltos, score de cumplimiento
  - **AC:** Grid de cards, una por sucursal. Click filtra la lista a esa sucursal. Ordenable por más incidentes.
  - **Scope:** M (1 archivo, ~80 líneas)
  - **Files:** `components/dashboard/branch-incident-summary.tsx`

- [ ] **Task 19**: Ranking de sucursales por incidentes (peor a mejor) con indicadores de tendencia
  - **AC:** Lista ordenada con rank, nombre sucursal, incidentes este mes, cambio vs mes anterior (flecha arriba/abajo)
  - **Scope:** S (1 archivo, ~60 líneas)
  - **Files:** `components/dashboard/branch-ranking.tsx`

- [ ] **Task 20**: Filtro de sucursal en el header de la página de incidentes con selector "Todas" + dropdown de sucursales
  - **AC:** Selector persiste en URL con query param. "Todas" muestra vista consolidada. Sucursal específica filtra.
  - **Scope:** S (1 archivo modificado, ~30 líneas)
  - **Files:** `app/dashboard/incidents/page.tsx`

### Checkpoint: Phase 5
- [ ] Vista multi-sucursal funciona
- [ ] Ranking de sucursales muestra
- [ ] Filtro "Todas las sucursales" opera correctamente
- [ ] `pnpm run build` pasa

---

### Phase 6: Mobile-first — PWA + Push Notifications + Cámara

Optimizar la experiencia para uso desde celular.

- [ ] **Task 21**: PWA manifest (`public/manifest.json`) con iconos, nombre, colores, display: standalone
  - **AC:** Manifest válido. Chrome muestra prompt de instalación. Iconos en 192x192 y 512x512.
  - **Scope:** XS (1 archivo, ~30 líneas)
  - **Files:** `public/manifest.json`

- [ ] **Task 22**: Service worker básico para cache de assets estáticos y offline fallback
  - **AC:** SW cachea CSS/JS/images. Offline muestra página estática. Update prompt cuando hay nueva versión.
  - **Scope:** S (1 archivo, ~60 líneas)
  - **Files:** `public/sw.js`

- [ ] **Task 23**: Push notifications con Web Push API: suscripción en el bell icon, envío desde el server cuando hay incidente nuevo
  - **AC:** Usuario puede activar push. Server envía push cuando se crea incidente. Click en push abre detail page.
  - **Scope:** L (3 archivos, ~120 líneas)
  - **Files:** `lib/push-subscription.ts`, `app/api/push/subscribe/route.ts`, integración en incident-engine

- [ ] **Task 24**: Botón de cámara en el RemediationWizard para tomar foto directamente (usando `navigator.mediaDevices`)
  - **AC:** Botón "Tomar foto" abre cámara del celular. Foto se captura y sube. Funciona en iOS Safari y Android Chrome.
  - **Scope:** M (1 archivo modificado, ~40 líneas)
  - **Files:** `components/incidents/remediation-wizard.tsx`

- [ ] **Task 25**: CSS responsive optimizado: cards apiladas en mobile, tablas con scroll horizontal, touch targets mínimos 44px
  - **AC:** Lighthouse mobile score >90. Todos los botones touch-friendly. Tablas scrolleables.
  - **Scope:** S (1-2 archivos, ~50 líneas)
  - **Files:** `app/globals.css` + ajustes en componentes

### Checkpoint: Phase 6
- [ ] PWA instalable
- [ ] Push notifications funcionan
- [ ] Cámara captura fotos
- [ ] Lighthouse mobile >90
- [ ] `pnpm run build` pasa

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| AI photo verification cost/latency | Medium | Cache results, limit to CRITICAL incidents, fallback to manual |
| Push notifications requires HTTPS | High | Ensure production URL is HTTPS, local dev uses localhost |
| PWA caching may serve stale content | Medium | Use versioned cache names, update SW on deploy |
| Multi-sucursal query performance | Medium | Add composite index on (branchId, status, createdAt) |
| Camera API not available in all browsers | Low | Feature detect, hide button if not available |
| Schema changes needed for evidence | Low | Use existing `metadata` JSONB column, no migration needed |

## Open Questions

- ¿Las gráficas de analytics deben ser server-side rendered o client-side con Recharts? (Propongo client-side para interactividad)
- ¿El compliance score debe incluir solo incidentes o también otros factores de cumplimiento (NOM-251, NOM-035)?
- ¿Push notifications debe ser obligatorio o opt-in por defecto?
- ¿La cámara integrada debe soportar múltiples fotos por paso o solo una?
