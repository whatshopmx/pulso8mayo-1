# TODO: Incidentes V2 — 6 Áreas de Mejora

## Phase 1 — Dashboard Gerencial (Analytics)

- [ ] **Task 1** · `app/api/analytics/incidents/route.ts`
  API endpoint con métricas: total por período, severity distribution, avg time-to-resolution, top incident types, incidents per branch.
  **AC:** Endpoint retorna JSON con `summary`, `bySeverity`, `byBranch`, `trends`, `timeToResolution`.
  **Scope:** S (1 archivo, ~80 líneas)

- [ ] **Task 2** · `components/charts/incident-analytics-charts.tsx`
  Gráficas con Recharts: bar chart por severidad, line chart tendencia temporal, pie chart status distribution.
  **AC:** 3 gráficas renderizan datos. Tooltip muestra valores. Responsive en mobile.
  **Scope:** M (1 archivo, ~150 líneas)

- [ ] **Task 3** · `app/dashboard/analytics/incidents/page.tsx`
  Página con layout, filtros de fecha (7d, 30d, 90d), selector de sucursal, y gráficas.
  **AC:** Página carga datos al montar. Filtros actualizan gráficas. Loading skeleton.
  **Scope:** M (1 archivo, ~120 líneas)

- [ ] **Task 4** · `components/dashboard/incident-kpi-cards.tsx`
  KPI cards: total incidentes, tiempo promedio resolución, % resueltos, activos.
  **AC:** 4 cards con icono, valor, delta vs período anterior. Estilo consistente.
  **Scope:** S (1 archivo, ~60 líneas)

---

### Checkpoint: Phase 1
- [ ] Página analytics carga y muestra gráficas
- [ ] Filtros funcionan
- [ ] `pnpm run build` pasa

---

## Phase 2 — Notificaciones Mejoradas

- [ ] **Task 5** · `app/api/notifications/[id]/read/route.ts`
  Endpoint PATCH para marcar notificación como leída (actualiza `readAt`).
  **AC:** PATCH con `{ read: true }` actualiza `read` y `readAt`. Retorna notificación actualizada.
  **Scope:** XS (1 archivo, ~25 líneas)

- [ ] **Task 6** · `hooks/use-notifications.ts`
  Hook para polling de notificaciones no leídas (cada 30s) y contador unread.
  **AC:** Hook retorna `{ notifications, unreadCount, markAsRead, isLoading }`. Polling se detiene en pestaña inactive.
  **Scope:** S (1 archivo, ~60 líneas)

- [ ] **Task 7** · `components/notifications/notification-bell.tsx`
  Bell icon con dropdown, contador badge, mark-as-read on click.
  **AC:** Bell muestra contador rojo. Dropdown lista últimas 10. Click marca como leída.
  **Scope:** M (1-2 archivos, ~100 líneas)

- [ ] **Task 8** · `lib/whatsapp/templates/incident-templates.ts`
  Templates para incidentes: "Detectado", "Escalación", "Resolución", "Servicio agendado".
  **AC:** Templates con variables dinámicas. Formato WhatsApp y email.
  **Scope:** S (1 archivo, ~50 líneas)

---

### Checkpoint: Phase 2
- [ ] Notificaciones se marcan como leídas
- [ ] Bell icon muestra contador
- [ ] Templates de incidentes funcionan
- [ ] `pnpm run build` pasa

---

## Phase 3 — Remediación Mejorada (AI + Evidencia)

- [ ] **Task 9** · `components/incidents/evidence-gallery.tsx`
  Galería de evidencia: thumbnails con fecha, resultado, paso. Click abre modal.
  **AC:** Galería muestra thumbnails. Modal con foto completa. Empty state si no hay evidencia.
  **Scope:** M (1 archivo, ~100 líneas)

- [ ] **Task 10** · `components/incidents/remediation-wizard.tsx` (modificación)
  Integrar AI verification: foto → `/api/ai/verify` → confidence score → auto-approve >85%.
  **AC:** Wizard sube foto, AI verifica, muestra score, auto-approve o mark for review.
  **Scope:** M (1 archivo, ~40 líneas added)

- [ ] **Task 11** · `app/api/incidents/[id]/evidence/route.ts`
  API que retorna historial de evidencia del incidente (fotos, textos, resultados AI).
  **AC:** Endpoint retorna array de evidence items con tipo, contenido, resultado, timestamp.
  **Scope:** S (1 archivo, ~40 líneas)

- [ ] **Task 12** · `app/dashboard/incidents/[id]/page.tsx` (modificación)
  Tab "Evidencia" en detail page junto a "Línea de tiempo".
  **AC:** Tab aparece. Muestra galería. Empty state si no hay evidencia.
  **Scope:** S (1 archivo, ~30 líneas)

---

### Checkpoint: Phase 3
- [ ] Wizard verifica fotos con AI
- [ ] Galería de evidencia funciona
- [ ] Tab de evidencia en detail page
- [ ] `pnpm run build` pasa

---

## Phase 4 — Reportes + Compliance Score

- [ ] **Task 13** · `app/api/reports/incidents/route.ts`
  API que genera CSV con incidentes filtrados (fecha, sucursal, severidad).
  **AC:** Acepta query params. Retorna CSV con headers: ID, Título, Severidad, Status, Sucursal, Detectado, Resuelto, Tiempo.
  **Scope:** S (1 archivo, ~60 líneas)

- [ ] **Task 14** · `app/dashboard/analytics/incidents/page.tsx` (modificación)
  Botón "Exportar CSV" que descarga reporte con filtros activos.
  **AC:** Botón usa filtros activos. Descarga .csv. Toast éxito/error.
  **Scope:** XS (1 archivo, ~20 líneas)

- [ ] **Task 15** · `components/dashboard/compliance-score-card.tsx`
  Compliance Score: (resueltos a tiempo / total) × 100 con tendencia mensual.
  **AC:** Score 0-100. Color: verde >80, amarillo 60-80, rojo <60. Tendencia vs mes anterior.
  **Scope:** S (1 archivo, ~50 líneas)

- [ ] **Task 16** · `app/api/analytics/compliance/route.ts`
  API que calcula score por sucursal y período.
  **AC:** Retorna `{ overall, byBranch: [{ branchId, name, score, trend }] }`
  **Scope:** S (1 archivo, ~50 líneas)

---

### Checkpoint: Phase 4
- [ ] CSV export funciona
- [ ] Compliance score calculado y mostrado
- [ ] `pnpm run build` pasa

---

## Phase 5 — Multi-sucursal

- [ ] **Task 17** · `app/dashboard/incidents/page.tsx` (modificación)
  Soporte "all branches" cuando no hay filtro (ya parcialmente existe).
  **AC:** "Todas las sucursales" muestra incidentes de todas con badge de sucursal.
  **Scope:** S (1 archivo, ~20 líneas)

- [ ] **Task 18** · `components/dashboard/branch-incident-summary.tsx`
  Card por sucursal: total, activos, resueltos, score cumplimiento.
  **AC:** Grid de cards. Click filtra lista. Ordenable por más incidentes.
  **Scope:** M (1 archivo, ~80 líneas)

- [ ] **Task 19** · `components/dashboard/branch-ranking.tsx`
  Ranking de sucursales por incidentes (peor a mejor) con tendencia.
  **AC:** Lista ordenada con rank, nombre, incidentes mes, cambio vs anterior (flecha).
  **Scope:** S (1 archivo, ~60 líneas)

- [ ] **Task 20** · `app/dashboard/incidents/page.tsx` (modificación)
  Filtro de sucursal en header con "Todas" + dropdown.
  **AC:** Selector persiste en URL. "Todas" muestra vista consolidada. Sucursal filtra.
  **Scope:** S (1 archivo, ~30 líneas)

---

### Checkpoint: Phase 5
- [ ] Vista multi-sucursal funciona
- [ ] Ranking de sucursales muestra
- [ ] Filtro "Todas" opera correctamente
- [ ] `pnpm run build` pasa

---

## Phase 6 — Mobile-first

- [ ] **Task 21** · `public/manifest.json`
  PWA manifest con iconos, nombre, colores, display: standalone.
  **AC:** Manifest válido. Chrome muestra prompt instalación. Iconos 192x192 y 512x512.
  **Scope:** XS (1 archivo, ~30 líneas)

- [ ] **Task 22** · `public/sw.js`
  Service worker para cache de assets y offline fallback.
  **AC:** SW cachea CSS/JS/images. Offline muestra página estática. Update prompt.
  **Scope:** S (1 archivo, ~60 líneas)

- [ ] **Task 23** · `lib/push-subscription.ts` + `app/api/push/subscribe/route.ts` + integración
  Push notifications con Web Push API.
  **AC:** Usuario activa push. Server envía push en incidente nuevo. Click abre detail page.
  **Scope:** L (3 archivos, ~120 líneas)

- [ ] **Task 24** · `components/incidents/remediation-wizard.tsx` (modificación)
  Botón cámara para tomar foto con `navigator.mediaDevices`.
  **AC:** Botón "Tomar foto" abre cámara. Foto se captura y sube. iOS Safari + Android Chrome.
  **Scope:** M (1 archivo, ~40 líneas)

- [ ] **Task 25** · `app/globals.css` + ajustes componentes
  CSS responsive: cards apiladas, tablas scroll horizontal, touch targets 44px.
  **AC:** Lighthouse mobile >90. Botones touch-friendly. Tablas scrolleables.
  **Scope:** S (1-2 archivos, ~50 líneas)

---

### Checkpoint: Complete
- [ ] PWA instalable
- [ ] Push notifications funcionan
- [ ] Cámara captura fotos
- [ ] Lighthouse mobile >90
- [ ] `pnpm run build` pasa
- [ ] Todos los checkpoints anteriores completados
