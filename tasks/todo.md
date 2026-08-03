# Grupo Restaurantero Unificado (Phases 4 to 10) — Task List

Source plan: `tasks/plan.md`. Estructurado y reenumerado a partir de `tasks/plan-grupo-restaurantero-unificado.md`.

---

## Phase 4 — WhatsApp: Hub de Notificaciones + Smart Links

- [x] **T9** Notificación WhatsApp: cambio de turno. *Files: `lib/services/notification-dispatcher.ts`, `lib/services/smart-link-service.ts`. Size S.*
  - Acceptance: Al dispararse un cambio de turno, el compañero recibe un mensaje WhatsApp del tipo `shift_change_request` que contiene un smart link con JWT efímero.
  - Verify: Generar solicitud de cambio de turno en BD y verificar en logs que se despache la notificación por WhatsApp con el link.
  - Dependencies: None.

- [x] **T10** Notificación WhatsApp: reportar ausencia. *Files: `lib/services/notification-dispatcher.ts`. Size S.*
  - Acceptance: Al cambiar `shiftSessions.status` a `NO_SHOW` o pasar el límite de tolerancia de check-in, se despacha un WhatsApp al gerente de la sucursal con los datos de contacto directo del empleado ausente, y al empleado informándole del registro.
  - Verify: Simular ausencia de empleado y corroborar el despacho de la alerta al gerente de sucursal.
  - Dependencies: None.

- [x] **T11** Anuncios de grupo vía WhatsApp. *Files: `lib/services/notification-dispatcher.ts`, `lib/inngest/functions/announcement-broadcast.ts` (new). Size M.*
  - Acceptance: Al crear un anuncio corporativo en `/api/communications/announcements`, una función de Inngest despacha el mensaje vía WhatsApp con smart link de lectura a la PWA.
  - Verify: Crear un anuncio en base de datos y validar en el dev server de Inngest la ejecución y envío masivo.
  - Dependencies: None.

- [x] **T12** Notificación WhatsApp: capacitación. *Files: `lib/services/notification-dispatcher.ts`, `lib/services/smart-link-service.ts`. Size S.*
  - Acceptance: Al asignar un workflow/quiz de capacitación, notifica al empleado con smart link directo al executor del quiz en la PWA.
  - Verify: Crear asignación de capacitación y comprobar el formato del mensaje y del enlace.
  - Dependencies: None.

### Checkpoint 1
- [x] La app compila sin errores (`pnpm run build`).
- [x] Flujo de envío/recepción de notificaciones validado localmente con mocks.

---

## Phase 5 — Workflows Faltantes + NOM-035 Seguimiento

- [ ] **T13** Template: Cambio de Turno. *Files: `templates/operaciones_diarias/cambio-turno-v1.json` (new). Size S.*
  - Acceptance: Plantilla de checklist de cambio de turno que incluye arqueo de caja (efectivo, vales, tarjetas), bitácora de novedades/pendientes y doble firma digital de gerentes.
  - Verify: Cargar en el workflow builder y validar que sea ejecutable de inicio a fin.
  - Dependencies: None.

- [ ] **T14** Template: Auditoría Interna. *Files: `templates/compliance/auditoria-interna-v1.json` (new). Size M.*
  - Acceptance: Checklist combinado NOM-251 y NOM-035. Configurar scoring automático por sección y auto-generación de plan de remediación en caso de reprobar secciones críticas.
  - Verify: Completar auditoría fallando un punto crítico y confirmar creación automática de plan de acción.
  - Dependencies: None.

- [ ] **T15** Template: Muestreo de Calidad. *Files: `templates/control_calidad/muestreo-calidad-v1.json` (new). Size S.*
  - Acceptance: Checklist de toma de muestras, temperatura de cocción y vida de anaquel de preparados. Incluye campo fotográfico con AI verification.
  - Verify: Completar muestreo; validar que la AI verifique la foto del platillo.
  - Dependencies: None.

- [ ] **T16** NOM-035: plan de acción y seguimiento. *Files: `lib/db/schema.ts`, `lib/services/compliance/nom035-service.ts` (new), `app/api/compliance/nom-035/action-plan/route.ts` (new). Size M.*
  - Acceptance: Tabla `nom035_action_plans` migrada. API CRUD y lógica de servicio para controlar medidas, plazos de remediación y evidencia de soporte.
  - Verify: Registrar plan, asociar acciones correctoras y validar adjunto de evidencias.
  - Dependencies: None.

### Checkpoint 2
- [ ] Correr `pnpm run build` sin errores.
- [ ] Ejecución de los 3 nuevos checklists de inicio a fin probada en simulador.
- [ ] Base de datos migrada para plan de acción NOM-035.

---

## Phase 6 — Portal de Externos + Comunicaciones

- [ ] **T17** Portal de externos con token JWT. *Files: `app/external/layout.tsx` (new), `app/external/report/[token]/page.tsx` (new), `app/api/external/generate-link/route.ts` (new). Size M.*
  - Acceptance: Generador de links seguros con JWT limitado a 7 días. Vista pública que decodifica token y renderiza reportes operativos de solo lectura estática con descarga PDF (jsPDF), sin controles interactivos de filtrado.
  - Verify: Generar token, acceder sin credenciales a `/external/report/[token]`. Expirar token y verificar error 401.
  - Dependencies: None.

- [ ] **T18** Confirmación de lectura en anuncios. *Files: `lib/db/schema.ts`, `app/api/communications/announcements/[id]/read/route.ts` (new), `components/communications/announcement-card.tsx`. Size S.*
  - Acceptance: Tabla `communication_read_receipts` migrada. Endpoint `/read` registra lectura del usuario. Tarjeta de anuncio despliega porcentaje y total de lectura.
  - Verify: Registrar lectura y corroborar incremento en contador y visualización en UI.
  - Dependencies: None.

- [ ] **T19** Buscador de comunicaciones. *Files: `app/dashboard/company/communications/page.tsx`. Size S.*
  - Acceptance: Input de búsqueda full-text y filtros por sucursal/tags en panel de anuncios y comunicados.
  - Verify: Buscar palabra clave y verificar filtrado en pantalla de forma instantánea.
  - Dependencies: None.

### Checkpoint 3
- [ ] Correr `pnpm run build` sin errores.
- [ ] Enlace de externos renderiza datos operacionales reales del tenant de forma estática.

---

## Phase 7 — Módulos Faltantes (Protección Civil, Propinas, IMSS)

- [ ] **T20** Módulo de Protección Civil. *Files: `lib/db/schema.ts`, `templates/seguridad/proteccion-civil-v1.json` (new), `app/api/compliance/proteccion-civil/route.ts` (new). Size M.*
  - Acceptance: Tabla `proteccion_civil_checklists` migrada. Plantilla de Protección Civil con OCR de vigencias de extintores y subida de fotos de salidas despejadas.
  - Verify: Cargar imagen de extintor y comprobar extracción OCR de la fecha.
  - Dependencies: None.

- [ ] **T21** Distribución de propinas. *Files: `lib/db/schema.ts`, `app/api/propinas/route.ts` (new), `app/dashboard/labor/propinas/page.tsx` (new). Size M.*
  - Acceptance: Tablas `propinas` y `propina_asignaciones` migradas. Distribución automática de bolsa ingresada proporcional a las horas registradas de empleados en `shiftSessions`.
  - Verify: Ingresar monto de propina y comprobar cálculos proporcionales en reporte.
  - Dependencies: None.

- [ ] **T22** Alertas de fechas límite IMSS. *Files: `lib/inngest/functions/cron-compliance-alerts.ts`. Size S.*
  - Acceptance: Cron de Inngest envía recordatorios a Owner/Admin en los días 7, 3 y 1 antes del plazo bimestral del IMSS (día 17).
  - Verify: Ejecutar cron y validar despacho del payload a través del dashboard inngest.
  - Dependencies: None.

### Checkpoint 4
- [ ] Base de datos migrada para Protección Civil y Propinas.
- [ ] Distribución de propinas calcula montos correctos según horas de asistencia reales.

---

## Phase 8 — Reportes Automáticos Formateados

- [ ] **T24** Reportes PDF recurrentes. *Files: `lib/inngest/functions/cron-scheduled-reports.ts`, `lib/services/report-pdf-generator.ts` (new). Size L.*
  - Acceptance: Generación asíncrona de PDFs para reportes diarios, semanales y mensuales conteniendo gráficos (Recharts convertidos) y resúmenes. Despacho por Email/WhatsApp.
  - Verify: Trigger de envío en Inngest y validar el adjunto PDF en los logs del despachador.
  - Dependencies: None.

- [ ] **T25** Reporte pre-auditoría COFEPRIS. *Files: `app/dashboard/compliance/page.tsx`, `lib/services/ComplianceReportService.ts`. Size M.*
  - Acceptance: Botón de descarga en UI de cumplimiento que invoca `ComplianceReportService` y exporta PDF estructurado según requerimientos oficiales de la secretaría de salud (bitácoras ordenadas NOM-251).
  - Verify: Descargar reporte y validar que el PDF agrupe e ilustre evidencias del rango seleccionado.
  - Dependencies: None.

### Checkpoint 5
- [ ] Reportes en formato PDF generados y visualmente consistentes con el diseño de Pulso.

---

## Phase 9 — M13: Ventas y POS (Gap Financiero)

- [ ] **T26** Schema de Ventas y Migración. *Files: `lib/db/schema.ts`. Size M.*
  - Acceptance: Tablas `daily_sales_cuts` y `pos_mapping_templates` migradas. Llave única `(companyId, branchId, businessDate, shift, channel)`.
  - Verify: `pnpm db:generate` corre exitosamente; comprobar tablas y FKs creadas.
  - Dependencies: None.

- [ ] **T27** Servicio de Ingesta de Cortes. *Files: `lib/services/sales-ingestion-service.ts` (new), `lib/services/pos-column-aliases.ts` (new). Size M.*
  - Acceptance: Parseo de archivos con `exceljs`. Mapeo a esquema canónico usando diccionario de alias dinámicos. Detección automática del shape del archivo (`summary` | `payment_summary` | `ticket_detail` | `multi_sheet`). Validación de cuadre ±2%.
  - Verify: Probar ingesta de 3 fixtures diferentes de cortes de caja y verificar mapeo exacto de montos.
  - Dependencies: T26.

- [ ] **T28** API y UI de Upload Manual. *Files: `app/api/sales/cuts/upload/route.ts` (new), `app/dashboard/sales/page.tsx` (new), `components/sales/sales-cut-upload.tsx` (new). Size M.*
  - Acceptance: Endpoint POST carga archivo, aplica T27 y persiste registro. UI con dropzone, selector de meta-datos (turno/sucursal) y tabla de estatus.
  - Verify: Subir corte manual; comprobar que figure como VALIDATED.
  - Dependencies: T27.

- [ ] **T29** Configuración de Plantillas POS. *Files: `app/api/sales/mapping-templates/route.ts` (new), `app/dashboard/sales/mapping/page.tsx` (new), `components/sales/mapping-template-form.tsx` (new). Size M.*
  - Acceptance: Cargar archivo de ejemplo en UI, proponer mapeo de headers a campos canónicos con semáforo de confianza. Permitir persistencia de JSONB de mapeo.
  - Verify: Guardar plantilla custom; subir archivo no estándar y validar parseo exitoso.
  - Dependencies: T27.

- [ ] **T30** Dashboard de Ventas. *Files: `lib/services/sales-analytics-service.ts` (new), `components/sales/sales-dashboard.tsx` (new). Size M.*
  - Acceptance: Métricas consolidadas: venta total, ticket promedio, transacciones y ventas por agregador (DELIVERY). Gráficas Recharts por sucursal y turno.
  - Verify: Mostrar histórico de 15 días con montos distribuidos.
  - Dependencies: T28.

- [ ] **T31** KPIs de Costo de Alimento y Laboral. *Files: `lib/services/financial-kpi-service.ts` (new), `components/sales/financial-kpi-cards.tsx` (new). Size M.*
  - Acceptance: Fórmulas de Food Cost % y Labor Cost % contra ventas reales de T26. Semáforo y dispatch de alerta `FINANCIAL_KPI_DEVIATION` en caso de desviación.
  - Verify: Simular venta baja para forzar Food Cost > 35% y comprobar alerta generada.
  - Dependencies: T30.

- [ ] **T32** WhatsApp Ingesta. *Files: `lib/whatsapp/workflow-conversation-handler.ts`, `lib/whatsapp/evidence-processor.ts`, `app/api/whatsapp/webhook/route.ts`. Size L.*
  - Acceptance: Webhook procesa documentos XLSX/CSV de cortes. Si falla, activa formulario conversacional (fallback) pidiendo datos clave del corte vía chat de WhatsApp.
  - Verify: Enviar archivo de corte por WhatsApp sandbox; verificar que la confirmación detalle montos correctos.
  - Dependencies: T27.

- [ ] **T33** Cierre de Turno e Integración de Workflow. *Files: `templates/operaciones_diarias/cierre-restaurante-v2-enhanced.json` (new), `lib/inngest/functions/cron-sales-cut-reminder.ts` (new). Size M.*
  - Acceptance: Bloquear checklist de cierre si `daily_sales_cuts` no ha sido recibido para la sucursal/fecha. Cron recordatorio y escalación en Inngest.
  - Verify: Intentar cerrar sin corte y validar bloqueo; validar cron en inngest local.
  - Dependencies: T31, T32.

### Checkpoint 6
- [ ] Carga manual e ingesta WhatsApp de cortes operativa de inicio a fin.
- [ ] KPIs de costos estimándose correctamente.
- [ ] El workflow de cierre valida y restringe la operación si falta el corte.

---

## Phase 10 — M16: Pagos y Gastos (Gap Financiero)

- [ ] **T34** Schema de Gastos. *Files: `lib/db/schema.ts`. Size M.*
  - Acceptance: Tablas `petty_cash_funds`, `petty_cash_transactions`, `operating_expenses` y `expense_authorization_rules` migradas. Montos integer.
  - Verify: Generar y aplicar migración en base de datos.
  - Dependencies: None.

- [ ] **T35** Caja Chica: Servicio + UI. *Files: `lib/services/petty-cash-service.ts` (new), `app/dashboard/finance/petty-cash/page.tsx` (new), `components/finance/petty-cash-register.tsx` (new). Size M.*
  - Acceptance: CRUD de fondos. Registro de salidas con desglose físico detallado de denominaciones (billetes y monedas), monto total y foto de comprobante. Descuento atómico del balance.
  - Verify: Registrar salida; corroborar disminución de saldo y registro de transacción.
  - Dependencies: T34.

- [ ] **T36** Reposición Automática y Alerta de Umbral. *Files: `lib/services/petty-cash-service.ts`, `lib/inngest/functions/cron-petty-cash-check.ts` (new). Size S.*
  - Acceptance: Si el balance es menor al 20% del fondo fijo, el cron de Inngest dispara notificación `PETTY_CASH_LOW` a Gerente/Admin con monto sugerido.
  - Verify: Forzar saldo bajo y verificar alerta en Inngest.
  - Dependencies: T35.

- [ ] **T37** Gastos Operativos por Categoría. *Files: `lib/services/expense-service.ts` (new), `app/dashboard/finance/expenses/page.tsx` (new), `components/finance/expense-form.tsx` (new). Size M.*
  - Acceptance: Registro categorizado de renta, servicios, reparaciones, etc. Integración con ID de factura para conciliación. UI con filtros y agregados mensuales.
  - Verify: Registrar gasto y validar su asignación a la categoría correcta.
  - Dependencies: T34.

- [ ] **T38** Autorización de Gastos por Niveles de Monto. *Files: `lib/services/expense-approval-service.ts` (new), `app/api/expenses/approvals/route.ts` (new), `components/finance/expense-approval-list.tsx` (new). Size M.*
  - Acceptance: Aplicación de reglas `expense_authorization_rules` (por límites). Notificaciones y vista de aprobaciones pendientes para los roles autorizados.
  - Verify: Cargar gasto de $12,000 MXN; validar que requiera aprobación del Owner y se bloquee.
  - Dependencies: T37.

- [ ] **T39** Calendario de Flujo de Efectivo. *Files: `app/dashboard/finance/cash-flow/page.tsx` (new), `components/finance/cash-flow-projection.tsx` (new). Size M.*
  - Acceptance: Calendario interactivo a 30 días sumando proyecciones de ventas de T26 vs egresos fijos (nómina de labor-calculator, gastos aprobados de T38 y cuentas por pagar). Todo calculado neto (sin IVA).
  - Verify: Comprobar balance diario proyectado para los siguientes 15 días.
  - Dependencies: T30, T38.

- [ ] **T40** P&L Operativo Estimado por Sucursal. *Files: `app/dashboard/executive/page.tsx`, `components/dashboard/executive/pl-widget.tsx` (new). Size M.*
  - Acceptance: Widget agregador en Dashboard Ejecutivo que calcule heurísticamente la Utilidad Operativa = Ventas - Costo Alimentos - Costo Laboral - Gastos Operativos. Todo calculado neto (sin IVA). Caching con unstable_cache.
  - Verify: Cargar dashboard ejecutivo y validar que cuadren las deducciones contra los KPIs de la sucursal.
  - Dependencies: T31, T38.

### Checkpoint 7
- [ ] Caja chica y gastos operando con niveles de autorización.
- [ ] Calendario de flujo de efectivo y widget de P&L estimando utilidad operativa cross-sucursal.