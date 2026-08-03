# Implementation Plan: Cierre de Gaps — Diseño Grupo Restaurantero

## Overview

Cerrar los gaps identificados en el gap analysis entre `docs/pulso-diseno-grupo-restaurantero.md` y la implementación actual. El plan prioriza los gaps 🔴 (críticos) primero, luego los 🟡 (parciales), organizados en fases que entregan valor vertical incremental. Cada fase deja el sistema en un estado funcional y demostrable.

**Fuente:** Gap analysis del 2026-08-02 comparando 14 secciones del diseño contra código en `lib/`, `app/`, `templates/`, `components/`.

## Architecture Decisions

**AD-1 — Dashboard Ejecutivo como nueva ruta `/dashboard/executive`, no como refactor del home existente.**
El home actual es el dashboard de sucursal individual. El dashboard ejecutivo multi-sucursal del diseño (Sección 14) es un producto distinto para Owner/Director Ops. Se construye como ruta nueva con su propio layout de "single pane of glass", sin modificar el home existente.
*Rationale:* separación clara de concerns; el home ya tiene su propio plan de mejora (`tasks/plan.md`); risk bajo de regresión.

**AD-2 — Predicciones usan scoring heurístico inicial, no ML.**
Las predicciones del diseño ("78% de probabilidad de bajar de 80 en compliance") se implementan primero con un motor de reglas heurísticas (pesos por factores: días sin registro, rotación reciente, incidentes, vencimientos). Un modelo ML requeriría datos históricos que los clientes nuevos no tendrán.
*Rationale:* Time-to-value inmediato; las heurísticas son explicables y calibrables por el consultor; se puede migrar a ML después sin cambiar la interfaz.

**AD-3 — WhatsApp como hub de notificaciones + smart links, no como plataforma de ejecución.**
WhatsApp es el "home center" del empleado: recibe notificaciones y smart links que abren la web app (PWA) para ejecutar workflows. No se construyen handlers multi-turno ni comandos complejos — la ejecución real ocurre en la web app con buena UX. WhatsApp notifica, la web app ejecuta.
*Rationale:* mejor experiencia de usuario; los smart links ya existen (`smart-link-service.ts`); el `notification-dispatcher.ts` ya tiene canales WhatsApp/Email/In-App; no se fuerza una UX de texto en una plataforma diseñada para mensajería.

**AD-4 — Portal de externos como rutas públicas con token, no como tenant separado.**
Contadores, auditores y proveedores acceden vía URLs con token efímero (tipo `/external/report/{token}`) que expiran. Sin login, sin sesión persistente.
*Rationale:* El diseño dice "portal limitado + reportes exportables"; un token link es más simple que gestionar usuarios externos con roles.

## Task List

### Phase 1: Dashboard Ejecutivo del Grupo (Single Pane of Glass)

El gap más visible: el Owner no tiene la vista consolidada del diseño.

- [ ] **T1 — Crear servicio de agregación cross-sucursal.** Nuevo `lib/services/cross-branch-service.ts`: queries que agregan datos de todas las sucursales de un tenant. Métodos: `getAllBranchesCompliance()`, `getAllBranchesMerma()`, `getAllBranchesIncidentesActivos()`, `getAllBranchesLaborMetrics()`. Cache de 5 minutos vía `unstable_cache` para no golpear la DB en cada refresh. *Files: `lib/services/cross-branch-service.ts` (new). Size M.*

- [ ] **T2 — Construir ruta y layout del dashboard ejecutivo.** `app/dashboard/executive/page.tsx` con layout "single pane": sin sidebar tradicional, pantalla completa. Server Component que consume `cross-branch-service`. Secciones: (a) KPI hero cards (compliance promedio, merma promedio, incidentes activos, rotación) con delta vs período anterior, (b) ranking visual de sucursales con barras de compliance score y código de colores 🟢🟡🔴, (c) panel de alertas cross-sucursal (tareas vencidas, scores bajos, documentos por vencer), (d) mini-gráfica de tendencia semanal multi-línea. *Files: `app/dashboard/executive/page.tsx` (new), `app/dashboard/executive/layout.tsx` (new), `components/dashboard/executive/` (new, varios). Size L.*

- [ ] **T3 — Componentes del dashboard ejecutivo.**
  - `components/dashboard/executive/kpi-hero-cards.tsx` — 4 tarjetas grandes con icono, valor, delta, y sparkline
  - `components/dashboard/executive/branch-ranking.tsx` — lista vertical de sucursales con barra de progreso coloreada
  - `components/dashboard/executive/alerts-panel.tsx` — lista compacta de alertas agrupadas por sucursal
  - `components/dashboard/executive/compliance-trend-chart.tsx` — gráfica multi-línea (Recharts) de compliance semanal por sucursal
  *Files: `components/dashboard/executive/*.tsx` (new). Size L (can be broken into sub-tasks).*

### Checkpoint A — T1–T3
- [ ] `pnpm run build` clean
- [ ] `/dashboard/executive` carga en <2s con datos de 5 sucursales
- [ ] KPI cards muestran valores correctos con deltas
- [ ] Ranking de sucursales ordenado por compliance score descendente
- [ ] Panel de alertas muestra tareas vencidas, scores <80, docs por vencer
- [ ] Gráfica de tendencia renderiza 5 líneas con tooltips
- [ ] Vista responsive: en tablet se adapta a 2 columnas

---

### Phase 2: Predicciones e Inteligencia

El diseño promete predicciones. Implementación con heurísticas como primer paso.

- [ ] **T4 — Motor de scoring predictivo heurístico.** Nuevo `lib/services/predictive-scoring-service.ts`: dado un `branchId`, calcula probabilidad de riesgo para:
  - **Compliance NOM-251:** factores = días sin registro temperaturas (últimos 7d), incidentes de equipo activos, rotación reciente de personal clave, vencimientos próximos (certificados, fumigación). Fórmula ponderada → score 0-100%.
  - **Merma:** factores = desviación últimas 3 semanas, productos por caducar, recepciones con rechazo. Score 0-100%.
  - **Rotación de personal:** factores = retardos acumulados, horas extra cerca del límite, ausencias sin aviso, antigüedad promedio.
  Cada predicción retorna: `{ probability, factors: [{name, weight, currentValue}], recommendedActions: string[] }`.
  *Files: `lib/services/predictive-scoring-service.ts` (new). Size M.*

- [ ] **T5 — Panel de predicciones en dashboard ejecutivo.** Nuevo componente `components/dashboard/executive/predictions-panel.tsx`: muestra la sucursal con mayor riesgo + predicción formateada como el mockup del diseño ("Contry tiene 78% de probabilidad de bajar de 80 en compliance... Factores detectados: ... Acciones recomendadas: 1. 2. 3. ... Cumpliendo estas acciones, probabilidad baja a 12%"). Consume `predictive-scoring-service`. *Files: `components/dashboard/executive/predictions-panel.tsx` (new), `app/dashboard/executive/page.tsx`. Size S.*

- [ ] **T6 — API de predicciones.** `app/api/analytics/predictions/route.ts`: endpoint GET que expone `predictive-scoring-service` para consumo del frontend y potencialmente para notificaciones automáticas. *Files: `app/api/analytics/predictions/route.ts` (new). Size S.*

### Checkpoint B — T4–T6
- [ ] `pnpm run build` clean
- [ ] Al menos 1 predicción visible en el dashboard ejecutivo para un tenant con >3 sucursales
- [ ] Factores de predicción son trazables (cada factor cita datos reales del sistema)
- [ ] Acciones recomendadas son concretas y accionables
- [ ] API `/api/analytics/predictions` retorna JSON válido para un branchId

---

### Phase 3: Benchmarking Interno

"San Pedro consistentemente tiene la merma más baja. ¿Qué prácticas usa?"

- [ ] **T7 — Servicio de benchmarking cross-sucursal.** Extender `cross-branch-service.ts` con:
  - `getBenchmarking()` → para cada métrica (merma%, compliance, rotación, food cost%, horas extra), rankear sucursales y calcular: mejor, peor, promedio, desviación estándar.
  - `getBestPractices(branchId)` → dado que una sucursal es #1 en X métrica, buscar qué características operativas la diferencian (¿tiene menos rotación de personal? ¿completa más % de workflows a tiempo? ¿sus recepciones tienen menos rechazos?). Heurístico, basado en correlaciones simples.
  - `getWorstPractices(branchId)` → inverso, para la sucursal peor rankeada.
  *Files: `lib/services/cross-branch-service.ts` (extender). Size M.*

- [ ] **T8 — Sección de benchmarking en dashboard ejecutivo.** Nuevo componente `components/dashboard/executive/benchmarking-insights.tsx`: muestra tarjetas tipo:
  - "🏆 San Pedro: merma más baja del grupo (2.1%). Completan 98% de recepciones con AI verification."
  - "⚠️ Contry: merma más alta (11.2%). 3 factores correlacionados: rotación de cocinero (32%), 2 incidentes de refrigeración/mes, sin conteo cíclico en 2 semanas."
  *Files: `components/dashboard/executive/benchmarking-insights.tsx` (new). Size S.*

### Checkpoint C — T7–T8
- [ ] `pnpm run build` clean
- [ ] Benchmarking muestra al menos 2 insights (mejor y peor sucursal por métrica)
- [ ] Los insights son accionables (no solo "X es mejor", sino "X hace Y diferente")
- [ ] Sin datos suficientes, muestra "Recolectando datos... (mínimo 2 semanas)"

---

### Phase 4: WhatsApp — Hub de Notificaciones + Smart Links

WhatsApp es el "home center" del empleado: notifica eventos importantes y entrega smart links que abren la PWA para ejecutar. No se ejecutan workflows desde WhatsApp.

- [ ] **T9 — Notificación WhatsApp: cambio de turno.** Extender `lib/whatsapp/notification-dispatcher.ts` y `lib/services/smart-link-service.ts`:
  - Cuando se genera una solicitud de cambio de turno (`shift-change-requests`), se notifica al compañero vía WhatsApp con un smart link.
  - Formato: "🔄 [Nombre] quiere cambiar el turno del [fecha]. [Revisar solicitud]" → smart link a `/dashboard/labor/shift-changes/{id}`.
  - El compañero acepta/rechaza en la web app (PWA). Confirmación a ambos por WhatsApp.
  *Files: `lib/whatsapp/notification-dispatcher.ts` (extender), `lib/services/smart-link-service.ts` (extender). Size S.*

- [ ] **T10 — Notificación WhatsApp: reportar ausencia.** Extender `lib/whatsapp/notification-dispatcher.ts`:
  - Nueva plantilla de notificación para ausencias: "⚠️ [Nombre] reportó ausencia. Motivo: [motivo]. [Ver sesión]" → smart link a `/dashboard/labor/sessions/{id}`.
  - Disparador: cuando `shiftSessions.status` cambia a `NO_SHOW` o se registra ausencia manual.
  - Notifica al gerente de la sucursal.
  *Files: `lib/whatsapp/notification-dispatcher.ts` (extender). Size S.*

- [ ] **T11 — Anuncios del grupo vía WhatsApp.** Extender `lib/whatsapp/notification-dispatcher.ts`:
  - Cuando un anuncio se crea en `/api/communications/announcements`, un Inngest function lo despacha a los empleados vía WhatsApp (si el anuncio está marcado para "todos los empleados" o "sucursal X").
  - Formato: "📢 [Grupo]: [título]. [primeras 2 líneas]... [Leer anuncio]" → smart link abre la PWA en `/dashboard/communications/{id}`.
  *Files: `lib/whatsapp/notification-dispatcher.ts` (extender), `lib/inngest/functions/announcement-broadcast.ts` (new). Size M.*

- [ ] **T12 — Notificación WhatsApp: capacitación.** Extender `lib/services/smart-link-service.ts`:
  - Cuando se asigna una capacitación (`workflowAssignments` con template tipo capacitación), se notifica al empleado vía WhatsApp.
  - Formato: "📚 Nueva capacitación: [título]. [Iniciar capacitación]" → smart link abre la PWA en el workflow executor.
  - El empleado completa el quiz y contenido en la web app (PWA), no en WhatsApp.
  *Files: `lib/services/smart-link-service.ts` (extender), `lib/whatsapp/notification-dispatcher.ts` (extender). Size S.*

### Checkpoint D — T9–T12
- [ ] `pnpm run build` clean
- [ ] Solicitud de cambio de turno → notificación WhatsApp con smart link al compañero
- [ ] Ausencia registrada → gerente recibe notificación WhatsApp con smart link
- [ ] Anuncio de grupo → broadcast WhatsApp con smart link a la PWA
- [ ] Capacitación asignada → notificación WhatsApp con smart link al workflow

---

### Phase 5: Workflows Faltantes + NOM-035 Seguimiento

- [ ] **T13 — Template: Cambio de Turno.** `templates/operaciones_diarias/cambio-turno-v1.json`:
  - Checklist de entrega/recepción: novedades, pendientes, incidentes, inventario de caja
  - Firma de conformidad (SignatureField) de ambos gerentes
  - Campos: efectivo inicial, novedades del turno saliente, equipos con fallas, tareas pendientes
  *Files: `templates/operaciones_diarias/cambio-turno-v1.json` (new). Size S.*

- [ ] **T14 — Template: Auditoría Interna.** `templates/compliance/auditoria-interna-v1.json`:
  - Checklist completo NOM-251 + NOM-035 combinado
  - Scoring automático por área (AI verification + campos numéricos)
  - Plan de remediación generado automáticamente al completar
  - Secciones: higiene personal, temperaturas, limpieza, plagas, documentos, capacitación, clima laboral
  *Files: `templates/compliance/auditoria-interna-v1.json` (new). Size M.*

- [ ] **T15 — Template: Muestreo de Calidad de Alimentos.** `templates/control_calidad/muestreo-calidad-v1.json`:
  - Toma de muestras periódicas (aleatoria o programada)
  - Registro de temperaturas de cocción y conservación
  - Vida de anaquel por producto preparado
  - AI: foto del producto con análisis visual
  *Files: `templates/control_calidad/muestreo-calidad-v1.json` (new). Size S.*

- [ ] **T16 — NOM-035: plan de acción y seguimiento.** Extender `app/api/compliance/` con:
  - `POST /api/compliance/nom-035/action-plan` — genera plan basado en resultados del cuestionario
  - `GET /api/compliance/nom-035/action-plan/{branchId}` — consulta estado
  - `PATCH /api/compliance/nom-035/action-plan/{id}` — marcar medida como implementada
  - Schema: nueva tabla `nom035_action_plans` (branchId, surveyId, medidas: jsonb[{description, responsible, deadline, status, evidence}])
  *Files: `lib/db/schema.ts` (nueva tabla), `app/api/compliance/nom-035/action-plan/route.ts` (new), `lib/services/compliance/nom035-service.ts` (new). Size M.*

### Checkpoint E — T13–T16
- [ ] `pnpm run build` clean
- [ ] Template Cambio de Turno ejecutable en una sucursal
- [ ] Template Auditoría Interna genera score por área y plan de remediación
- [ ] Template Muestreo de Calidad registra vida de anaquel
- [ ] NOM-035: plan de acción se genera, se puede marcar como implementado con evidencia

---

### Phase 6: Portal de Externos + Comunicaciones

- [ ] **T17 — Portal de externos con token.** Nuevo layout `app/external/`:
  - `app/external/report/[token]/page.tsx` — página pública que muestra reportes específicos según el token (decodifica: branchId, reportType, expiry).
  - `app/api/external/generate-link/route.ts` — endpoint (admin-only) que genera token JWT con scope limitado: `{ branchId, reportTypes: ['compliance', 'nomina'], exp: +7d }`.
  - Reportes renderizados como Server Components (no interactivos, solo lectura + descarga PDF).
  *Files: `app/external/layout.tsx` (new), `app/external/report/[token]/page.tsx` (new), `app/api/external/generate-link/route.ts` (new). Size M.*

- [ ] **T18 — Confirmación de lectura en comunicaciones.** Extender schema de announcements:
  - Nueva tabla `announcement_reads` (announcementId, userId, readAt)
  - Endpoint `POST /api/communications/announcements/{id}/read` — marca como leído
  - UI: en `announcement-card.tsx`, mostrar "X de Y empleados confirmaron" con lista de no-lectores
  - Dashboard ejecutivo: badge "N anuncios sin leer por N empleados"
  *Files: `lib/db/schema.ts` (nueva tabla), `app/api/communications/announcements/{id}/read/route.ts` (new), `components/communications/announcement-card.tsx`. Size S.*

- [ ] **T19 — Buscador de comunicaciones.** `app/dashboard/communications/search`:
  - Input de búsqueda full-text sobre `title` y `body` de announcements
  - Filtros: por sucursal, por fecha, por tipo
  - Resultados con highlight del término buscado
  *Files: `app/dashboard/communications/page.tsx` o nueva ruta de búsqueda. Size S.*

### Checkpoint F — T17–T19
- [ ] `pnpm run build` clean
- [ ] Token de externo generado desde `/api/external/generate-link` renderiza reporte legible
- [ ] Anuncio muestra cuántos empleados lo leyeron
- [ ] Búsqueda de comunicaciones encuentra por palabra clave en título/cuerpo

---

### Phase 7: Módulos Faltantes (Propinas, Protección Civil, IMSS, Ingeniería de Menú)

- [ ] **T20 — Módulo de Protección Civil.** Nuevo sub-módulo en compliance:
  - Tabla `proteccion_civil_checklists` (branchId, tipo [simulacro, extintores, salidas, señalización], fecha, evidencia, estado)
  - Template `seguridad/proteccion-civil-v1.json`: checklist de revisión con AI para extintores (OCR fecha), salidas (foto de ruta despejada), señalización
  - Calendario de simulacros: scheduler en `workflow-schedule-service`
  *Files: `lib/db/schema.ts` (nueva tabla), `templates/seguridad/proteccion-civil-v1.json` (new), `app/api/compliance/proteccion-civil/route.ts` (new). Size M.*

- [ ] **T21 — Distribución de propinas.** Nuevo módulo `app/api/propinas/`:
  - Tabla `propinas` (branchId, fecha, montoTotal, metodoCalculo [POR_HORAS, POR_PUNTOS, POR_PORCENTAJE])
  - Tabla `propina_asignaciones` (propinaId, userId, monto, porcentaje)
  - UI simple en `/dashboard/labor/propinas`: formulario de distribución, historial
  - Cálculo automático según horas trabajadas en el período
  *Files: `lib/db/schema.ts` (nuevas tablas), `app/api/propinas/route.ts` (new), `app/dashboard/labor/propinas/page.tsx` (new). Size M.*

- [ ] **T22 — Alertas de fechas límite IMSS.** Extender `cron-compliance-alerts.ts`:
  - Detectar fechas de presentación IMSS próximas (bimestrales: día 17 de meses impares para SUA, etc.)
  - Alerta a Admin/Owner 7, 3, 1 día antes
  - Nueva entrada en `complianceConfig` del tenant: `imssBimestralAlert: boolean`
  *Files: `lib/inngest/functions/cron-compliance-alerts.ts` (extender). Size S.*

- [ ] **T23 — Ingeniería de Menú (matriz rentabilidad vs popularidad).** Nuevo `lib/services/menu-engineering-service.ts`:
  - Para cada receta en un branchId + período, calcular:
    - **Popularidad:** % de unidades vendidas vs total del menú
    - **Rentabilidad:** margen de contribución (precio - food cost)
  - Clasificar en matriz 2x2: ⭐ Estrella (alta pop + alta rent), 🐄 Vaca (baja pop + alta rent), ❓ Puzzle (alta pop + baja rent), 🗑️ Perro (baja pop + baja rent)
  - UI: scatter plot interactivo (Recharts) en `/dashboard/inventory/menu-engineering`
  *Files: `lib/services/menu-engineering-service.ts` (new), `app/dashboard/inventory/menu-engineering/page.tsx` (new), `app/api/inventory/menu-engineering/route.ts` (new). Size M.*

### Checkpoint G — T20–T23
- [ ] `pnpm run build` clean
- [ ] Checklist de protección civil con OCR de extintores ejecutable
- [ ] Distribución de propinas calcula montos automáticamente por horas
- [ ] Alerta IMSS dispara 7 días antes de fecha límite
- [ ] Matriz de ingeniería de menú muestra scatter plot con los 4 cuadrantes

---

### Phase 8: Reportes Automáticos Formateados

- [ ] **T24 — Reportes PDF diarios/semanales/mensuales.** Extender `cron-scheduled-reports.ts`:
  - Reemplazar envío de datos crudos por PDF formateado:
    - **Diario:** resumen de sucursal estilo mockup del diseño (workflows completados, incidentes, merma, asistencia)
    - **Semanal:** food cost, compliance score, horas extra, incidentes con tendencia
    - **Mensual:** reporte ejecutivo completo, costos laborales, rotación
  - Usar `@react-pdf/renderer` o `puppeteer` serverless para generar PDF
  - Enviar por email (Resend) y opcionalmente WhatsApp al Owner/Director
  *Files: `lib/inngest/functions/cron-scheduled-reports.ts` (extender), `lib/services/report-pdf-generator.ts` (new). Size L.*

- [ ] **T25 — Reporte pre-auditoría one-click.** Botón en compliance: "Generar reporte pre-auditoría COFEPRIS". Llama a `ComplianceReportService` y renderiza PDF con:
  - Portada: sucursal, fecha, score compliance
  - Secciones organizadas como las pide COFEPRIS (bitácora temperaturas, limpieza, plagas, capacitación, certificados médicos) con evidencia relevante
  - Checklist de "lo que el auditor va a pedir" con status de cada item
  *Files: `app/dashboard/compliance/page.tsx` (botón + acción), `lib/services/ComplianceReportService.ts` (extender). Size M.*

### Checkpoint H — T24–T25
- [ ] `pnpm run build` clean
- [ ] PDF diario se genera y se ve como el mockup del diseño
- [ ] PDF semanal incluye tendencias y comparativas
- [ ] Reporte pre-auditoría contiene todas las secciones requeridas por COFEPRIS

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **T1–T3: queries cross-sucursal pesadas** con 15+ sucursales y datos históricos | Medium | `unstable_cache` + Recharts data downsampling. Si una query tarda >1s, se streamea con Suspense. |
| **T4–T6: predicciones heurísticas parecen "fake"** si no usan ML real | Medium | Transparencia total: cada predicción muestra sus factores. UI dice "Estimación basada en datos operativos" no "IA predice". |
| **T8: "best practices" puede ser ruido** si no hay suficientes datos para correlaciones | High | Threshold: mínimo 4 semanas de datos para emitir insights. Si no, mostrar "Recolectando datos..." en vez de insights basura. |
| **T9–T12: WhatsApp handlers complejidad de estado** — conversaciones multi-turno requieren session state | Medium | `whatsapp-session-manager.ts` ya existe. Cada handler usa `sessionManager.getContext(phone)` para tracking de estado de conversación. |
| **T17: tokens de externos — seguridad** | High | JWT con `exp` corto (máx 7 días), scope limitado en payload, validación server-side en cada request. Sin refresh. |
| **T24: generación de PDF en serverless** puede exceder límites de memoria/tiempo | Medium | `@react-pdf/renderer` corre en Node sin browser; probar con tenant de 5 sucursales primero. Si no escala, mover a Inngest step con timeout largo. |
| **Plan ambicioso: 25 tasks** — riesgo de fatiga y calidad decreciente | High | Fases independientes; cada fase entrega valor standalone. Se puede pausar después de cualquier checkpoint y el sistema está en mejor estado que antes. |

## Open Questions

- **Q1 (priorización):** ¿El orden de fases (1. Dashboard Ejecutivo → 2. Predicciones → 3. Benchmarking → 4. WhatsApp → 5. Workflows → 6. Externos → 7. Módulos → 8. Reportes) es el correcto para el negocio? La fase 4 (WhatsApp) podría ser más urgente si hay clientes esperando la capa de ejecución móvil.

- **Q2 (alcance de predicciones):** ¿Las predicciones heurísticas son aceptables como MVP, o se prefiere esperar a tener datos suficientes para un modelo ML desde el inicio?

- **Q3 (portal externos):** ¿Contadores y auditores necesitan acceso interactivo (filtrar, ordenar) o solo descarga de PDF? PDF-only simplifica T17 significativamente.

- **Q4 (ingeniería de menú):** ¿Los clientes actuales tienen datos de ventas por platillo (integraciones POS) o esto sería una feature para después de integraciones externas?

- **Q5 (alcance total):** ¿Hacemos las 8 fases (25 tasks) o priorizamos top 4 fases y el resto queda como backlog?

## Parallelization Opportunities

- **Phase 4 (WhatsApp) + Phase 5 (Workflows)** pueden correr en paralelo — comparten zero dependencies
- **T20 + T21 + T22 + T23** (Phase 7) son independientes entre sí — 4 desarrollos paralelos
- **T13 + T14 + T15** (templates) son independientes — 3 templates en paralelo
- **Phase 1 DEBE ir primero** (todo lo demás depende del cross-branch service de T1)
- **Phase 2 depende de Phase 1** (predicciones consumen cross-branch data)
- **Phase 3 depende de Phase 1** (benchmarking consume cross-branch data)

## Estimated Total

**25 tasks** en 8 fases, ~8 checkpoints. Mezcla de S (5), M (16), L (4). Las fases 1-3 (~9 tasks) son el core estratégico del diseño. Las fases 4-8 (~16 tasks) cierran gaps específicos. Cada fase es standalone y entregable.
