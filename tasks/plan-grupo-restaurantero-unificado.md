# Plan de Implementación Unificado: Diseño para Grupos Restauranteros (Fases 1 a 10)

Este documento unifica, simplifica y secuencia la hoja de ruta para cerrar los gaps del diseño de **Grupo Restaurantero v2** (`docs/pulso-diseno-grupo-restaurantero.md`), consolidando:
1. `tasks/plan-grupo-restaurantero.md` (Fases 1-8: Operación, Notificaciones, NOM-035, PC, Propinas, etc.)
2. `tasks/plan-ventas-gastos.md` (Fases 9-10: Ingesta POS M13 y Caja Chica/Gastos M16)

**Resolución de Conflictos:** Se reenumeraron las tareas de los módulos financieros (originalmente T24 a T38) como **T26 a T40** para eliminar la colisión con la Fase 8 (T24 y T25) y mantener una numeración progresiva y consistente del plan.

> ⚠️ **Nota de sincronización (verificado contra código 2026-08-02):** Los commits y los trackers operativos (`tasks/todo-grupo-restaurantero.md`, `tasks/todo-ventas-gastos.md`) siguen usando la **numeración original** de cada plan fuente (ej. el schema de ventas se commiteó como "T24" = T26 de este plan). Este documento es la vista ejecutiva consolidada; los `todo-*.md` son los trackers operativos.
>
> ➡️ **Continuación (2026-08-04):** Las **Fases 11-14 (T41-T58)** — dimensiones de configuración del tenant (§2), M15 Fiscal vía FiscalAPI, M17 Control Interno, y packaging (tiers + Chef Corporativo) — están planeadas en `tasks/plan-fiscal-control-interno.md` con tracker en `tasks/todo-fiscal-control-interno.md`. Ese plan usa directamente la numeración unificada T41+ (sin renumeración). Quedan sin plan: apertura de sucursal/Digital Twin (§5), adopción (§10), offline (§9), M14 (conciliación de agregadores).

---

## 📊 Estado de Avance General

*(Verificado contra el código el 2026-08-02)*

- **Fases 1, 2 y 3 (T1 a T8):** **COMPLETADAS ✅** (Implementadas e integradas en `/dashboard/executive`).
- **Fase 4 (T9 a T12):** **PARCIAL 🟡** — Solo T11 (broadcast de anuncios) implementada.
- **Fase 5 (T13 a T16):** **COMPLETADA ✅** — Templates y NOM-035 action plans implementados.
- **Fase 6 (T17 a T19):** **PARCIAL 🟡** — Solo T18 (confirmación de lectura), de forma parcial.
- **Fase 7 (T20 a T23):** **PARCIAL 🟡** — Solo T23 (Ingeniería de Menú) implementada.
- **Fase 8 (T24 y T25):** **COMPLETADA ✅** — Con variante técnica: PDFs generados con `pdfkit`/`jspdf` en lugar de `@react-pdf/renderer`.
- **Fase 9 (T26 a T33):** **EN PROGRESO 🔵** — T26 (schema) y T27 (servicio de ingesta) implementadas; falta upload UI, plantillas POS, dashboard y WhatsApp.
- **Fase 10 (T34 a T40):** **PENDIENTE ⏳**

**Resumen:** 18 de 40 tareas completadas (T1–T8, T11, T13–T16, T23–T27), 1 parcial (T18), 21 pendientes.

---

## 🏗️ Decisiones de Arquitectura (AD)

*   **AD-1 — Dashboard Ejecutivo segregado (`/dashboard/executive`):** El home de sucursal individual se mantiene sin cambios. El dashboard ejecutivo consolidado para el Owner/Director es una ruta e interfaz separada sin sidebar tradicional ("single pane of glass").
*   **AD-2 — Predicciones heurísticas:** Las estimaciones ("78% de probabilidad de riesgo...") usan pesos ponderados de datos operativos reales (temperaturas, incidentes, rotación). Es calibrable y explicable por consultores sin necesidad de infraestructura de Machine Learning.
*   **AD-3 — WhatsApp como Hub de Notificaciones + Smart Links:** WhatsApp notifica y envía enlaces únicos (Smart Links) para ejecutar las acciones dentro de la PWA (web app móvil). No se implementan flujos interactivos de texto complejos en chat.
*   **AD-4 — Portal de externos sin credenciales:** Auditores, contadores y proveedores entran mediante URLs seguras con un token JWT firmado de corta duración (máximo 7 días).
*   **AD-5 — Dinero en centavos (Integer):** Todos los montos monetarios en base de datos se manejan como enteros en centavos de peso (MXN) para evitar problemas de redondeo float.
*   **AD-6 — Ingesta POS basada en Archivos (M13):** Se evitan integraciones directas con APIs de los POS locales por costo y fragilidad. Se lee el corte diario generado en XLSX/CSV por el POS usando la librería existente `exceljs`.
*   **AD-7 — Esquema canónico + Alias + Diccionario dinámico:** El POS de cada cliente se mapea a un esquema canónico a través de plantillas configurables por tenant en `pos_mapping_templates`. El servicio auto-detecta columnas por aproximación de nombres.
*   **AD-8 — Soporte a múltiples formatos de archivo:** Ingesta de 4 formatos comunes: resumido (corte de caja), detalle por forma de pago, desglose por ticket y archivos multi-hoja.
*   **AD-9 — Segregación de aprobaciones financieras:** El flujo de aprobación de gastos usa un esquema independiente del de asistencia (`shift_approvals`), reutilizando el motor de escalamiento.
*   **AD-10 — P&L y Flujo de Efectivo en tiempo real:** Son servicios de agregación de lectura (`unstable_cache` de 5 minutos) basados en datos reales de ventas, compras conciliadas, nómina y gastos operativos.

---

## 📋 Lista de Tareas Unificada (Tasks T1 a T40)

### Phase 1: Dashboard Ejecutivo del Grupo (Single Pane of Glass) — **COMPLETADA ✅**
*   **T1 — Servicio de agregación cross-sucursal:** Métodos `getAllBranchesCompliance()`, `getAllBranchesMerma()`, `getAllBranchesIncidentesActivos()`, y `getAllBranchesLaborMetrics()` con cache de 5 min.
*   **T2 — Ruta y layout del dashboard ejecutivo:** `app/dashboard/executive/page.tsx` sin sidebar y responsive.
*   **T3 — Componentes del dashboard ejecutivo:** KPI Hero Cards, Branch Ranking con semáforo, Panel de Alertas consolidado y Compliance Trend Chart (Recharts).

### Phase 2: Predicciones e Inteligencia — **COMPLETADA ✅**
*   **T4 — Motor de scoring predictivo heurístico:** `PredictiveScoringService` calcula riesgos ponderados de compliance, merma y rotación de personal.
*   **T5 — Panel de predicciones en dashboard:** Renderizado de la predicción y factores ("Contry tiene 78% de riesgo debido a...").
*   **T6 — API de predicciones:** Endpoint `/api/analytics/predictions` con validación de tenant.

### Phase 3: Benchmarking Interno — **COMPLETADA ✅**
*   **T7 — Servicio de benchmarking:** Métodos para determinar la mejor/peor sucursal por métrica y deducir heurísticamente las mejores prácticas.
*   **T8 — Sección de benchmarking en dashboard:** Insights tipo "🏆 San Pedro: merma más baja..." y manejo de estado de recolección de datos si el historial es menor a 4 semanas.

---

### Phase 4: WhatsApp — Hub de Notificaciones + Smart Links — **PARCIAL 🟡** (1/4)
*   [ ] **T9 — Notificación WhatsApp: cambio de turno:** Solicitud de cambio de turno envía mensaje al compañero con smart link a `/dashboard/labor/shift-changes/{id}`.
*   [ ] **T10 — Notificación WhatsApp: reportar ausencia:** Alerta de `NO_SHOW` al gerente con smart link a la sesión correspondiente.
*   [x] **T11 — Anuncios de grupo vía WhatsApp:** Inngest function que dispersa anuncios globales/locales con smart link a la PWA. *(Implementado en `lib/inngest/functions/announcement-broadcast.ts`, evento `communication/announcement.broadcast` con JWT smart links vía NotificationDispatcher)*
*   [ ] **T12 — Notificación WhatsApp: capacitación:** Notifica asignación de material/quiz con link directo al executor en la PWA.

### Phase 5: Workflows Faltantes + NOM-035 Seguimiento — **COMPLETADA ✅**
*   [x] **T13 — Template: Cambio de Turno:** JSON con entrega de caja, novedades, pendientes y doble firma digital de gerentes. *(Implementado en `templates/operaciones_diarias/cambio-turno-v1.json`)*
*   [x] **T14 — Template: Auditoría Interna:** Checklist unificado NOM-251 y NOM-035 con scoring automático y plan de remediación. *(Implementado en `templates/compliance/auditoria-interna-v1.json`)*
*   [x] **T15 — Template: Muestreo de Calidad:** Registro de temperaturas de cocción, vida de anaquel y foto de platillo con análisis de AI. *(Implementado en `templates/control_calidad/muestreo-calidad-v1.json`)*
*   [x] **T16 — NOM-035: plan de acción y seguimiento:** Tabla `nom035_action_plans`, API CRUD y vista para monitorear medidas correctivas del clima laboral. *(Implementado: tabla `nom035_action_plans` en `lib/db/schema.ts`, servicio `lib/services/compliance/nom035-service.ts`, API `app/api/compliance/nom-035/action-plan/route.ts` + `[id]/route.ts`)*

### Phase 6: Portal de Externos + Comunicaciones — **PARCIAL 🟡** (T18 parcial; T17 y T19 pendientes)
*   [ ] **T17 — Portal de externos con token:** Ruta pública `/external/report/[token]` con validación de JWT temporal (7 días) para reportes de solo lectura.
*   [~] **T18 — Confirmación de lectura en anuncios:** Tabla `communication_read_receipts` y endpoint para registrar lectura con métrica visible en la UI. **(PARCIAL 🟡)** — *La tabla `communication_read_receipts` existe y registra lecturas desde la página pública `app/communication/public/[token]/` (page + actions). Falta: endpoint `POST /api/communications/announcements/{id}/read` para usuarios autenticados y la métrica "X de Y empleados confirmaron" en la UI.*
*   [ ] **T19 — Buscador de comunicaciones:** Campo de búsqueda por texto en título/contenido con filtros por sucursal y highlights.

### Phase 7: Módulos Faltantes (Protección Civil, Propinas, IMSS, Menú) — **PARCIAL 🟡** (1/4: solo T23)
*   [ ] **T20 — Módulo de Protección Civil:** Bitácora de simulacros/extintores con OCR para fechas y checklist fotográfico de salidas despejadas.
*   [ ] **T21 — Distribución de propinas:** Tablas `propinas` y `propina_asignaciones` con cálculo automático proporcional a las horas trabajadas. **⬆️ RE-PRIORIZADA (2026-08-04):** ejecutar inmediatamente después de la Fase 10 (M16), antes de Fases 11-14. Es la respuesta de producto a la realidad de compensación en efectivo del sector: las propinas no integran el salario ni el SBC (LFT Art. 346), y su distribución documentada convierte flujo informal en canal legal y auditable (ver AD-19 en `tasks/plan-fiscal-control-interno.md`).
*   [ ] **T22 — Alertas IMSS:** Cron de Inngest para recordar fechas de SUA y modificaciones (días 7, 3 y 1 antes del límite).
*   [x] **T23 — Ingeniería de Menú (Popularidad vs Rentabilidad):** Servicio de matriz 2x2 (Estrellas, Vacas, Puzzles, Perros) y scatter plot interactivo en inventario. *(Completado en `app/api/inventory/menu-engineering` y `components/inventory/menu-engineering-matrix.tsx`)*

### Phase 8: Reportes Automáticos Formateados — **COMPLETADA ✅** *(con variante técnica)*
*   [x] **T24 — Reportes PDF recurrentes:** Envíos programados (diario, semanal, mensual) con PDF adjunto por email. *(Implementado en `lib/inngest/functions/cron-scheduled-reports.ts` con soporte PDF/EXCEL. **Variante:** se usó `pdfkit`/`jspdf` en lugar de `@react-pdf/renderer`)*
*   [x] **T25 — Reporte pre-auditoría COFEPRIS:** Generación de reporte de cumplimiento formateado según requisitos COFEPRIS desde la página de compliance. *(Implementado en `lib/services/ComplianceReportService.ts` + UI en `app/dashboard/compliance/compliance-page-client.tsx`)*

### Phase 9: M13 — Ventas y POS (Gap Financiero) — **EN PROGRESO 🔵** (2/8)
*   [x] **T26 — Schema de Ventas y Migración:** Tabla `daily_sales_cuts` (branch, fecha, turno, canal, monto, estatus) y `pos_mapping_templates`. *(Implementado en commit `5d84e34` — commiteado como "T24" con numeración del plan fuente. Migración `0021` aditiva aplicada a dev; dinero en centavos, unique compuesto `(companyId, branchId, businessDate, shift, channel)` para rechazo de duplicados)*
*   [x] **T27 — Servicio de Ingesta de Cortes:** Parseo con `exceljs`, mapeo de alias del POS y reglas de validación/detección de duplicados. *(Implementado en `lib/services/sales-ingestion-service.ts` + `lib/services/pos-column-aliases.ts`; 119 checks en `scripts/verify-sales-ingestion.ts`. Cortes con desglose de pago se dividen en filas SALON + DELIVERY para el dashboard por canal)*
*   [ ] **T28 — API y UI de Upload Manual:** Carga directa del archivo de corte, visualización de discrepancias y confirmación de columnas.
*   [ ] **T29 — Configuración de Plantillas POS:** Interfaz administrativa para definir el mapeo de columnas del POS de cada sucursal.
*   [ ] **T30 — Dashboard de Ventas:** Visualización de ventas por turno, canal de venta (salón, delivery, eventos) y ticket promedio.
*   [ ] **T31 — KPIs de Costo de Alimento y Laboral:** Fórmulas dinámicas: Costo Alimentos % = (Consumo Teórico / Ventas) y Costo Laboral % = (Nómina / Ventas).
*   [ ] **T32 — WhatsApp Ingesta:** Captación de archivos adjuntos (XLSX/CSV) en el webhook de WhatsApp y fallback con formulario de texto.
*   [ ] **T33 — Cierre de Turno e Integración de Workflow:** Bloqueo o alerta en el workflow de cierre de sucursal si el corte de ventas no ha sido recibido.

### Phase 10: M16 — Pagos y Gastos (Gap Financiero) — **PENDIENTE ⏳**
*   [ ] **T34 — Schema de Gastos:** Tablas `petty_cash_funds`, `petty_cash_transactions`, `operating_expenses`, y `expense_authorization_rules`.
*   [ ] **T35 — Caja Chica (Servicio + UI):** Registro de retiros de efectivo con foto del ticket/evidencia, control de saldo disponible y reposiciones.
*   [ ] **T36 — Reposición Automática:** Alerta cuando el fondo desciende del 20% y cron en Inngest para auditoría de movimientos.
*   [ ] **T37 — Gastos Operativos por Categoría:** Flujo para registrar renta, energía, agua, gas y mantenimientos sin OC asociada.
*   [ ] **T38 — Autorización por Monto:** Reglas dinámicas (Gerente < $1,000, Dir. Ops < $10,000, Owner ilimitado) con notificaciones de aprobación.
*   [ ] **T39 — Calendario de Flujo de Efectivo:** Proyección a 30 días sumando Ventas estimadas contra salidas (Nómina + Gastos + CxP).
*   [ ] **T40 — P&L Operativo Estimado por Sucursal:** Widget consolidado que calcula Utilidad Operativa = Ventas − Alimentos − Laboral − Gastos Operativos.

---

## 📈 Tabla de Riesgos y Mitigaciones Consolidada

| Riesgo | Impacto | Mitigación |
| :--- | :--- | :--- |
| **Integraciones POS complejas** | Alto | Ingesta por archivo (AD-6). El usuario sube el reporte que su POS ya genera; Pulso mapea columnas vía diccionario de alias dinámico (AD-7). |
| **Wasender no recibe archivos por API** | Medio | Fallback: El gerente envía foto del corte de caja por WhatsApp y se usa el motor OCR existente en `evidence-processor`, o bien se provee el formulario rápido. |
| **Queries cross-sucursal lentas** | Medio | Cache estricto con `unstable_cache` a nivel servicio (AD-10). Paginación o downsampling de datos si hay más de 15 sucursales. |
| **Datos incompletos en el P&L** | Medio | Mensaje de cobertura explícito: "Calculado con el 80% de los datos del período", evitando mostrar números erróneos sin contexto. |
| **Exceder límites de memoria en PDF** | Medio | Generación en servidor mediante `@react-pdf/renderer`. Si la sucursal tiene demasiada data, el reporte se segmenta o se procesa asíncronamente en Inngest. |

---

## 📚 Preguntas Abiertas

*   **P1: ¿Es el orden de las fases el ideal?**
    *   *Recomendación:* Se propone mantener el orden unificado. Las Fases 1-3 ya están listas. La Fase 4 (WhatsApp) y Fase 9 (Ventas/POS) tienen alta demanda operativa y comercial, por lo que deberían priorizarse antes que el resto de las fases de compliance secundario.
*   **P2: ¿El portal de externos requiere interactividad?**
    *   *Recomendación:* Mantenerlo como descarga de PDFs o visualización estática de solo lectura para evitar lógica compleja de filtrado en rutas sin sesión.
*   **P3: ¿Ingreso de Caja Chica con desglose de monedas?**
    *   *Recomendación:* Monto total + foto de ticket para mantenerlo simple y ágil en WhatsApp/PWA, evitando que el gerente pierda tiempo contando monedas en pantalla.
*   **P4: ¿Proyecciones financieras incluyen IVA?**
    *   *Recomendación:* Operación neta (sin IVA) para reflejar la rentabilidad del negocio de forma real y no distorsionar el P&L del restaurante.
