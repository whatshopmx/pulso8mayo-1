# Cierre de Gaps — Diseño Grupo Restaurantero — Task List

Source plan: `tasks/plan-grupo-restaurantero.md`. Gap analysis baseline: 2026-08-02 comparando `docs/pulso-diseno-grupo-restaurantero.md` contra código.

Open questions (answer before starting — see `tasks/plan-grupo-restaurantero.md`):
- Q1: ¿Orden de fases correcto? ¿WhatsApp (Fase 4) debería ser más urgente?
- Q2: ¿Predicciones heurísticas aceptables como MVP?
- Q3: Portal externos: ¿interactivo o solo PDF download?
- Q4: ¿Clientes tienen datos de ventas por platillo (POS)? ¿O ingeniería de menú espera?
- Q5: ¿Las 8 fases o top 4 fases solamente?

---

## Phase 1 — Dashboard Ejecutivo del Grupo (Single Pane of Glass)

- [x] **T1** Crear servicio de agregación cross-sucursal. *Files: `lib/services/cross-branch-service.ts` (new). Size M.*
  - Acceptance: métodos `getAllBranchesCompliance()`, `getAllBranchesMerma()`, `getAllBranchesIncidentesActivos()`, `getAllBranchesLaborMetrics()` retornan arrays con datos de todas las sucursales del tenant; cache 5min vía `unstable_cache`.
  - Verify: `pnpm run build` clean; llamar con un tenant de 3+ sucursales → arrays poblados.

- [x] **T2** Construir ruta y layout del dashboard ejecutivo. *Files: `app/dashboard/executive/page.tsx` (new), `app/dashboard/executive/layout.tsx` (new), `components/dashboard/executive/` (new). Size L.*
  - Acceptance: `/dashboard/executive` carga pantalla completa (sin sidebar); Server Component; secciones: KPI hero cards, ranking sucursales, panel alertas, gráfica tendencia multi-línea.
  - Verify: build clean; carga <2s con 5 sucursales; responsive en tablet.

- [x] **T3** Componentes del dashboard ejecutivo. *Files: `components/dashboard/executive/kpi-hero-cards.tsx`, `branch-ranking.tsx`, `alerts-panel.tsx`, `compliance-trend-chart.tsx` (new). Size L.*
  - Acceptance: 4 KPI cards con delta vs período anterior + sparkline; ranking con barras coloreadas 🟢🟡🔴; panel alertas agrupadas por sucursal; gráfica Recharts multi-línea.
  - Verify: build clean; tooltips en gráfica; colores correctos según thresholds (90+/80+/<80).

### Checkpoint A (after T1–T3)
- [x] `pnpm run build` clean
- [ ] `/dashboard/executive` funcional con datos reales de 3+ sucursales (pending runtime verification w/ seeded tenant)
- [ ] KPI cards, ranking, alertas, gráfica — todos renderizan datos correctos
- [ ] Responsive: tablet adapta a 2 columnas

---

## Phase 2 — Predicciones e Inteligencia

- [x] **T4** Motor de scoring predictivo heurístico. *Files: `lib/services/predictive-scoring-service.ts` (new). Size M.*
  - Acceptance: `predictComplianceRisk(branchId)` → `{ probability, factors[], recommendedActions[] }`; factores ponderados y trazables; al menos compliance, merma, y rotación implementados.
  - Verify: build clean; unit test con datos simulados de sucursal "mala" → probabilidad >70%; sucursal "buena" → <20%.

- [x] **T5** Panel de predicciones en dashboard ejecutivo. *Files: `components/dashboard/executive/predictions-panel.tsx` (new). Size S.*
  - Acceptance: muestra predicción formateada como el mockup ("78% de probabilidad... Factores: ... Acciones: ... Cumpliendo → 12%").
  - Verify: build clean; texto legible sin jerga técnica.

- [x] **T6** API de predicciones. *Files: `app/api/analytics/predictions/route.ts` (new). Size S.* (incl. tenant-ownership check on branchId)
  - Acceptance: GET con `?branchId=X` retorna JSON con predictions; sin branchId retorna todas las sucursales.
  - Verify: `curl localhost:3000/api/analytics/predictions?branchId=...` → JSON 200.

### Checkpoint B (after T4–T6)
- [x] `pnpm run build` clean
- [ ] 1+ predicción visible en dashboard ejecutivo
- [ ] Factores trazables a datos reales
- [ ] API predictions retorna JSON válido

---

## Phase 3 — Benchmarking Interno (can parallel with Phase 2)

- [x] **T7** Servicio de benchmarking cross-sucursal. *Files: `lib/services/cross-branch-service.ts` (extender). Size M.*
  - Acceptance: `getBenchmarking()` rankea sucursales por métrica con mejor/peor/promedio/stddev; `getBestPractices(branchId)` retorna factores diferenciadores.
  - Verify: build clean; para 5 sucursales, best/worst tienen al menos 2 factores correlacionados.

- [x] **T8** Sección de benchmarking en dashboard ejecutivo. *Files: `components/dashboard/executive/benchmarking-insights.tsx` (new). Size S.*
  - Acceptance: tarjetas "🏆 Mejor: X" y "⚠️ Atención: Y" con factores concretos; si <4 semanas de datos, muestra "Recolectando datos...".
  - Verify: build clean; insights son accionables (no genéricos).

### Checkpoint C (after T7–T8)
- [x] `pnpm run build` clean
- [ ] 2+ insights visibles (mejor y peor sucursal)
- [ ] Sin datos suficientes → mensaje "Recolectando datos..."

---

## Phase 4 — WhatsApp: Hub de Notificaciones + Smart Links

WhatsApp es el "home center" del empleado: notifica eventos y entrega smart links que abren la PWA para ejecutar. No se ejecutan workflows desde WhatsApp.

- [x] **T9** Notificación WhatsApp: cambio de turno. *Files: `lib/whatsapp/notification-dispatcher.ts` (extender), `lib/services/smart-link-service.ts` (extender). Size S.*
  - Acceptance: solicitud de cambio de turno → notificación WhatsApp al compañero con smart link a `/dashboard/labor/shift-changes/{id}`; aceptación/rechazo en PWA; confirmación WhatsApp a ambos.
  - Verify: build clean; crear solicitud → compañero recibe WhatsApp con link funcional.

- [x] **T10** Notificación WhatsApp: reportar ausencia. *Files: `lib/whatsapp/notification-dispatcher.ts` (extender). Size S.*
  - Acceptance: `shiftSessions.status = NO_SHOW` → notificación WhatsApp al gerente con smart link a `/dashboard/labor/sessions/{id}`.
  - Verify: build clean; registrar ausencia → gerente recibe WhatsApp con link.

- [ ] **T11** Anuncios del grupo vía WhatsApp. *Files: `lib/whatsapp/notification-dispatcher.ts` (extender), `lib/inngest/functions/announcement-broadcast.ts` (new). Size M.*
  - Acceptance: anuncio "todos los empleados" o "sucursal X" → dispatch WhatsApp vía Inngest; formato: "📢 [Grupo]: [título]... [Leer anuncio]" → smart link a PWA.
  - Verify: build clean; crear anuncio → empleados reciben WhatsApp con link.

- [x] **T12** Notificación WhatsApp: capacitación. *Files: `lib/services/smart-link-service.ts` (extender), `lib/whatsapp/notification-dispatcher.ts` (extender). Size S.*
  - Acceptance: asignación de capacitación → notificación WhatsApp con smart link al workflow executor en PWA; quiz y contenido en web app.
  - Verify: build clean; asignar capacitación → empleado recibe WhatsApp con link al workflow.

### Checkpoint D (after T9–T12)
- [ ] `pnpm run build` clean
- [ ] Cambio de turno → notificación WhatsApp con smart link al compañero
- [ ] Ausencia → gerente recibe WhatsApp con smart link
- [ ] Anuncio broadcast → empleados reciben WhatsApp con link a PWA
- [ ] Capacitación → notificación WhatsApp con smart link al workflow

---

## Phase 5 — Workflows Faltantes + NOM-035 Seguimiento (can parallel with Phase 4)

- [ ] **T13** Template: Cambio de Turno. *Files: `templates/operaciones_diarias/cambio-turno-v1.json` (new). Size S.*
  - Acceptance: checklist entrega/recepción; campos: efectivo inicial, novedades, equipos con fallas, pendientes; SignatureField de ambos gerentes.
  - Verify: build clean; ejecutar template → firma digital registrada.

- [ ] **T14** Template: Auditoría Interna. *Files: `templates/compliance/auditoria-interna-v1.json` (new). Size M.*
  - Acceptance: checklist NOM-251 + NOM-035 combinado; scoring por área; plan de remediación auto-generado al completar.
  - Verify: build clean; ejecutar → score >0 y plan de remediación generado.

- [ ] **T15** Template: Muestreo de Calidad de Alimentos. *Files: `templates/control_calidad/muestreo-calidad-v1.json` (new). Size S.*
  - Acceptance: registro de temperaturas cocción/conservación; vida de anaquel por producto; AI foto con análisis visual.
  - Verify: build clean; ejecutar → datos de anaquel guardados.

- [ ] **T16** NOM-035: plan de acción y seguimiento. *Files: `lib/db/schema.ts` (nueva tabla), `app/api/compliance/nom-035/action-plan/route.ts` (new), `lib/services/compliance/nom035-service.ts` (new). Size M.*
  - Acceptance: POST genera plan; GET consulta estado; PATCH marca medida implementada con evidencia; tabla `nom035_action_plans`.
  - Verify: build clean; API CRUD funcional; UI muestra plan con progreso.

### Checkpoint E (after T13–T16)
- [ ] `pnpm run build` clean
- [ ] Template Cambio de Turno ejecutable
- [ ] Template Auditoría Interna con scoring
- [ ] Template Muestreo Calidad con anaquel
- [ ] NOM-035 plan de acción CRUD completo

---

## Phase 6 — Portal de Externos + Comunicaciones

- [x] **T17** Portal de externos con token. *Files: `app/external/layout.tsx` (new), `app/external/report/[token]/page.tsx` (new), `app/api/external/generate-link/route.ts` (new). Size M.*
  - Acceptance: token JWT con scope (branchId, reportTypes, expiry); página pública renderiza reporte solo-lectura + descarga PDF; link expira en 7 días.
  - Verify: build clean; generar link → abrir en incógnito → reporte visible; token expirado → error 401.

- [x] **T18** Confirmación de lectura en comunicaciones. *Files: `lib/db/schema.ts` (nueva tabla), `app/api/communications/announcements/{id}/read/route.ts` (new), `components/communications/announcement-card.tsx`. Size S.*
  - Acceptance: tabla `announcement_reads`; POST marca leído; UI muestra "X de Y confirmaron"; dashboard ejecutivo badge "N sin leer".
  - Verify: build clean; marcar como leído → contador se actualiza.

- [x] **T19** Buscador de comunicaciones. *Files: `app/dashboard/communications/` (extender). Size S.*
  - Acceptance: búsqueda full-text sobre title+body; filtros sucursal/fecha/tipo; resultados con highlight.
  - Verify: build clean; buscar "junta" → resultados con la palabra resaltada.

### Checkpoint F (after T17–T19)
- [ ] `pnpm run build` clean
- [ ] Token externo → reporte legible
- [ ] Anuncio muestra lectores
- [ ] Búsqueda funcional

---

## Phase 7 — Módulos Faltantes (can parallelize internally)

- [x] **T20** Módulo de Protección Civil. *Files: `lib/db/schema.ts` (nueva tabla), `templates/seguridad/proteccion-civil-v1.json` (new), `app/api/compliance/proteccion-civil/route.ts` (new). Size M.*
  - Acceptance: tabla `proteccion_civil_checklists`; template con OCR extintores, foto rutas evacuación, señalización; calendario simulacros.
  - Verify: build clean; ejecutar template → checklist guardado.

- [ ] **T21** Distribución de propinas. *Files: `lib/db/schema.ts` (nuevas tablas), `app/api/propinas/route.ts` (new), `app/dashboard/labor/propinas/page.tsx` (new). Size M.* **⬆️ RE-PRIORIZADA (2026-08-04): ejecutar inmediatamente después de la Fase 10 (M16).** Canal legal de compensación en efectivo del sector — propinas no integran salario ni SBC (LFT Art. 346); ver AD-19 en `tasks/plan-fiscal-control-interno.md`.
  - Acceptance: tablas `propinas` + `propina_asignaciones`; cálculo automático por horas trabajadas; UI formulario + historial. La distribución queda documentada por empleado (quién recibió qué, cuándo, con qué regla) — es evidencia auditable, no solo un cálculo.
  - Verify: build clean; crear distribución → montos calculados correctamente.

- [ ] **T22** Alertas de fechas límite IMSS. *Files: `lib/inngest/functions/cron-compliance-alerts.ts` (extender). Size S.*
  - Acceptance: detecta fechas bimestrales IMSS; alerta a Admin/Owner 7, 3, 1 día antes.
  - Verify: build clean; simular fecha cercana → alerta disparada.

- [ ] **T23** Ingeniería de Menú (matriz rentabilidad vs popularidad). *Files: `lib/services/menu-engineering-service.ts` (new), `app/dashboard/inventory/menu-engineering/page.tsx` (new), `app/api/inventory/menu-engineering/route.ts` (new). Size M.*
  - Acceptance: scatter plot Recharts con 4 cuadrantes (⭐🐄❓🗑️); clasificación por popularidad + rentabilidad; filtro por período.
  - Verify: build clean; recetas clasificadas en los 4 cuadrantes.

### Checkpoint G (after T20–T23)
- [ ] `pnpm run build` clean
- [ ] Protección Civil checklist funcional
- [ ] Propinas calculadas automáticamente
- [ ] Alerta IMSS dispara
- [ ] Matriz ingeniería de menú con scatter plot

---

## Phase 8 — Reportes Automáticos Formateados

- [ ] **T24** Reportes PDF diarios/semanales/mensuales. *Files: `lib/inngest/functions/cron-scheduled-reports.ts` (extender), `lib/services/report-pdf-generator.ts` (new). Size L.*
  - Acceptance: PDF diario (resumen sucursal), semanal (food cost, compliance, incidentes), mensual (ejecutivo completo) generados con `@react-pdf/renderer`; envío por email + WhatsApp opcional.
  - Verify: build clean; generar PDF → inspeccionar visualmente que siga el mockup del diseño.

- [ ] **T25** Reporte pre-auditoría one-click. *Files: `app/dashboard/compliance/page.tsx`, `lib/services/ComplianceReportService.ts` (extender). Size M.*
  - Acceptance: botón "Generar reporte pre-auditoría COFEPRIS"; PDF con portada, score, bitácoras organizadas, checklist "lo que el auditor va a pedir".
  - Verify: build clean; descargar PDF → contiene todas las secciones requeridas.

### Checkpoint H (after T24–T25)
- [ ] `pnpm run build` clean
- [ ] PDF diario se ve como el mockup
- [ ] PDF semanal incluye tendencias
- [ ] Reporte pre-auditoría COFEPRIS completo

---

## Definition of Done (per-task, standing bar)

- [ ] `pnpm run build` exits 0
- [ ] `pnpm run lint` exits 0 (or pre-existing warning count unchanged)
- [ ] Multi-tenant: any new data access scoped by `companyId`/`tenantId`; no leaked cross-tenant reads
- [ ] i18n: new user-facing strings in Spanish via `next-intl`; no new English strings in UI
- [ ] No half-migrated state shipped — each task leaves the app building and a section fully done
- [ ] Accessibility: new interactive elements keyboard-reachable; colors meet ≥4.5:1 contrast
- [ ] Templates: new template JSONs validate against `templates/TEMPLATE_SCHEMA.md`
