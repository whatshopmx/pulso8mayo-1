# Implementation Plan: Grupo Restaurantero Unificado (Phases 4 to 10)

## Overview

Este plan unifica, simplifica y detalla la hoja de ruta para cerrar los gaps del diseño de **Grupo Restaurantero v2** (`docs/pulso-diseno-grupo-restaurantero.md`). Consolida las tareas pendientes de las Fases 4 a 10 (T9 a T40, con T23 ya completada), cubriendo la integración de WhatsApp como canal de notificaciones y smart links, plantillas de workflows operativos adicionales, NOM-035, el portal para auditores externos, módulos de Protección Civil, Propinas, alertas IMSS, reportes PDF automáticos y los módulos financieros fundacionales M13 (Ventas y POS) y M16 (Pagos y Gastos).

El objetivo es asegurar que la plataforma pueda calcular y reportar KPIs financieros (Food Cost %, Labor Cost %, P&L y Flujo de Efectivo) e instrumentar notificaciones automáticas y flujos de aprobación robustos.

---

## Architecture Decisions

*   **AD-3 — WhatsApp como Hub de Notificaciones + Smart Links:** WhatsApp notifica y envía enlaces únicos (Smart Links) para ejecutar las acciones dentro de la PWA (web app móvil). No se implementan flujos interactivos de texto complejos en chat.
*   **AD-4 — Portal de externos sin credenciales:** Auditores, contadores y proveedores entran mediante URLs seguras con un token JWT firmado de corta duración (máximo 7 días) que expone reportes de solo lectura.
*   **AD-5 — Dinero en centavos (Integer):** Todos los montos monetarios en la base de datos se manejan como enteros en centavos de peso (MXN) para evitar problemas de redondeo de punto flotante.
*   **AD-6 — Ingesta POS basada en Archivos (M13):** Se evitan integraciones directas con APIs de los POS locales por costo y fragilidad. Se lee el corte diario generado en XLSX/CSV por el POS usando la librería existente `exceljs`.
*   **AD-7 — Esquema canónico + Alias + Diccionario dinámico:** El POS de cada cliente se mapea a un esquema canónico a través de plantillas configurables por tenant en `pos_mapping_templates`. El servicio auto-detecta columnas por aproximación de nombres.
*   **AD-8 — Soporte a múltiples formatos de archivo:** Ingesta de 4 formatos comunes: resumido (corte de caja), detalle por forma de pago, desglose por ticket y archivos multi-hoja.
*   **AD-9 — Segregación de aprobaciones financieras:** El flujo de aprobación de gastos usa un esquema independiente del de asistencia (`shift_approvals`), reutilizando el motor de escalamiento.
*   **AD-10 — P&L y Flujo de Efectivo en tiempo real:** Son servicios de agregación de lectura (`unstable_cache` de 5 minutos) basados en datos reales de ventas, compras conciliadas, nómina y gastos operativos.

---

## Task List

### Phase 4: WhatsApp — Hub de Notificaciones + Smart Links (T9–T12)

*   [ ] **Task T9: Notificación WhatsApp: cambio de turno**
    *   *Description:* Cuando se genere una solicitud de cambio de turno, notifica al compañero asignado vía WhatsApp con un smart link que le permita aceptar o rechazar en la PWA.
    *   *Acceptance Criteria:*
        *   Envía mensaje estructurado con detalles del turno a cambiar.
        *   Genera smart link a `/dashboard/labor/shift-changes/{id}`.
    *   *Verification:*
        *   Crear solicitud de cambio de turno en la base de datos.
        *   Verificar que se genere el log de despacho de WhatsApp.
    *   *Dependencies:* None
    *   *Files likely touched:*
        *   [notification-dispatcher.ts](file:///c:/Users/david/pulso29/lib/services/notification-dispatcher.ts)
        *   [smart-link-service.ts](file:///c:/Users/david/pulso29/lib/services/smart-link-service.ts)
    *   *Estimated scope:* Small

*   [ ] **Task T10: Notificación WhatsApp: reportar ausencia**
    *   *Description:* Notifica al gerente de la sucursal de manera inmediata cuando un empleado marque su estado como `NO_SHOW` o no registre check-in en su horario establecido.
    *   *Acceptance Criteria:*
        *   WhatsApp automático al teléfono del gerente de sucursal.
        *   Smart link directo a la sesión de asistencia correspondiente.
    *   *Verification:*
        *   Simular ausencia de un empleado en un turno programado.
        *   Verificar la recepción del mensaje por el gerente correspondiente.
    *   *Dependencies:* None
    *   *Files likely touched:*
        *   [notification-dispatcher.ts](file:///c:/Users/david/pulso29/lib/services/notification-dispatcher.ts)
    *   *Estimated scope:* Small

*   [ ] **Task T11: Anuncios de grupo vía WhatsApp**
    *   *Description:* Creación de una función en Inngest para dispersar anuncios globales o locales creados por el corporativo directamente a los teléfonos de los empleados con enlace de confirmación.
    *   *Acceptance Criteria:*
        *   Función programada en Inngest para emitir mensajes masivos.
        *   Smart link de solo lectura al anuncio en la PWA.
    *   *Verification:*
        *   Crear anuncio corporativo y verificar la ejecución de la función de Inngest en el Inngest Dev Server.
    *   *Dependencies:* None
    *   *Files likely touched:*
        *   [notification-dispatcher.ts](file:///c:/Users/david/pulso29/lib/services/notification-dispatcher.ts)
        *   [announcement-broadcast.ts](file:///c:/Users/david/pulso29/lib/inngest/functions/announcement-broadcast.ts) [NEW]
    *   *Estimated scope:* Medium

*   [ ] **Task T12: Notificación WhatsApp: capacitación**
    *   *Description:* Avisa al empleado sobre nuevos materiales de capacitación o quizzes obligatorios asignados a su puesto, con enlace directo al executor.
    *   *Acceptance Criteria:*
        *   Notificación instantánea al asignar material.
        *   Smart link que abre el workflow executor en el quiz específico.
    *   *Verification:*
        *   Asignar workflow de capacitación a un usuario y validar el envío del smart link.
    *   *Dependencies:* None
    *   *Files likely touched:*
        *   [notification-dispatcher.ts](file:///c:/Users/david/pulso29/lib/services/notification-dispatcher.ts)
        *   [smart-link-service.ts](file:///c:/Users/david/pulso29/lib/services/smart-link-service.ts)
    *   *Estimated scope:* Small

#### Checkpoint 1: WhatsApp Channels
- [ ] La app compila sin errores (`pnpm run build`).
- [ ] Envío y recepción de notificaciones de cambio de turno, ausencias, anuncios y capacitaciones verificado en Inngest Dev Server.

---

### Phase 5: Workflows Faltantes + NOM-035 Seguimiento (T13–T16)

*   [ ] **Task T13: Template: Cambio de Turno**
    *   *Description:* Crear la plantilla JSON oficial para el checklist de entrega/recepción de turno (doble firma digital, entrega de caja, pendientes y novedades).
    *   *Acceptance Criteria:*
        *   Formulario JSON que incluye arqueo de caja, bitácora de novedades y firmas digitales.
    *   *Verification:*
        *   Importar y ejecutar el checklist en el simulador de workflows.
    *   *Dependencies:* None
    *   *Files likely touched:*
        *   [cambio-turno-v1.json](file:///c:/Users/david/pulso29/templates/operaciones_diarias/cambio-turno-v1.json) [NEW]
    *   *Estimated scope:* Small

*   [ ] **Task T14: Template: Auditoría Interna**
    *   *Description:* Integración en una sola plantilla JSON del checklist para auditorías internas NOM-251 y NOM-035.
    *   *Acceptance Criteria:*
        *   Scoring automático y generación automática de plan de acción corrector al fallar secciones críticas.
    *   *Verification:*
        *   Completar auditoría simulando fallas críticas; verificar la creación del plan de remediación en base de datos.
    *   *Dependencies:* None
    *   *Files likely touched:*
        *   [auditoria-interna-v1.json](file:///c:/Users/david/pulso29/templates/compliance/auditoria-interna-v1.json) [NEW]
    *   *Estimated scope:* Medium

*   [ ] **Task T15: Template: Muestreo de Calidad**
    *   *Description:* Plantilla JSON para el control de temperaturas de cocción, vida de anaquel de preparados y fotos del platillo verificado por AI.
    *   *Acceptance Criteria:*
        *   Registro de temperaturas con thresholds; validación por AI de la fotografía de evidencia del platillo.
    *   *Verification:*
        *   Completar workflow y validar que la AI asigne score de confianza a la foto.
    *   *Dependencies:* None
    *   *Files likely touched:*
        *   [muestreo-calidad-v1.json](file:///c:/Users/david/pulso29/templates/control_calidad/muestreo-calidad-v1.json) [NEW]
    *   *Estimated scope:* Small

*   [ ] **Task T16: NOM-035: plan de acción y seguimiento**
    *   *Description:* Base de datos, API y vistas para la creación y control de medidas correctoras asociadas al clima laboral (NOM-035).
    *   *Acceptance Criteria:*
        *   Tabla `nom035_action_plans` migrada.
        *   Endpoints CRUD para planes de acción y subida de evidencia de remediación.
    *   *Verification:*
        *   Crear plan de acción, actualizar estatus a "remediado" adjuntando evidencia y validar persistencia.
    *   *Dependencies:* None
    *   *Files likely touched:*
        *   [schema.ts](file:///c:/Users/david/pulso29/lib/db/schema.ts)
        *   [nom035-service.ts](file:///c:/Users/david/pulso29/lib/services/compliance/nom035-service.ts) [NEW]
        *   [route.ts](file:///c:/Users/david/pulso29/app/api/compliance/nom-035/action-plan/route.ts) [NEW]
    *   *Estimated scope:* Medium

#### Checkpoint 2: Workflows & NOM-035
- [ ] Ejecutar checklists de cambio de turno, auditorías y muestreos de calidad.
- [ ] Guardar plan de acción NOM-035 exitosamente.

---

### Phase 6: Portal de Externos + Comunicaciones (T17–T19)

*   [ ] **Task T17: Portal de externos con token**
    *   *Description:* Ruta `/external/report/[token]` pública que valida un JWT de corta duración y despliega reportes operacionales y de cumplimiento de solo lectura para entes de auditoría o consultores.
    *   *Acceptance Criteria:*
        *   Expiración automática del token JWT a los 7 días.
        *   Sin pantalla de inicio de sesión requerida.
        *   Vista estática de solo lectura con descarga en PDF (jsPDF). Sin controles de filtrado o interactividad.
    *   *Verification:*
        *   Generar link de externos, verificar acceso sin credenciales; expirar token manualmente y validar error 401/403.
    *   *Dependencies:* None
    *   *Files likely touched:*
        *   [layout.tsx](file:///c:/Users/david/pulso29/app/external/layout.tsx) [NEW]
        *   [page.tsx](file:///c:/Users/david/pulso29/app/external/report/[token]/page.tsx) [NEW]
        *   [route.ts](file:///c:/Users/david/pulso29/app/api/external/generate-link/route.ts) [NEW]
    *   *Estimated scope:* Medium

*   [ ] **Task T18: Confirmación de lectura en anuncios**
    *   *Description:* Tabla `communication_read_receipts` y endpoint para registrar cuando un empleado abre y confirma un anuncio, con desglose de métrica en panel de administración.
    *   *Acceptance Criteria:*
        *   Persiste confirmación con timestamp y ID del empleado.
        *   Muestra conteo de lectura en UI de anuncios.
    *   *Verification:*
        *   Hacer click en "Marcar como leído" y verificar que se inserte el registro y se actualice el contador en tiempo real.
    *   *Dependencies:* None
    *   *Files likely touched:*
        *   [schema.ts](file:///c:/Users/david/pulso29/lib/db/schema.ts)
        *   [route.ts](file:///c:/Users/david/pulso29/app/api/communications/announcements/[id]/read/route.ts) [NEW]
        *   [announcement-card.tsx](file:///c:/Users/david/pulso29/components/communications/announcement-card.tsx)
    *   *Estimated scope:* Small

*   [ ] **Task T19: Buscador de comunicaciones**
    *   *Description:* Añadir búsqueda textual y filtrado por sucursales/tags sobre anuncios e instructivos del corporativo.
    *   *Acceptance Criteria:*
        *   Input de búsqueda en `/dashboard/communications` que busque en `title` y `body`.
    *   *Verification:*
        *   Buscar palabra clave y validar que se filtren los resultados correspondientes de forma instantánea.
    *   *Dependencies:* None
    *   *Files likely touched:*
        *   [page.tsx](file:///c:/Users/david/pulso29/app/dashboard/company/communications/page.tsx)
    *   *Estimated scope:* Small

#### Checkpoint 3: External Access & Read Confirmation
- [ ] Probar link externo de visualización de reporte.
- [ ] Confirmar lectura de anuncios e ilustrar conteo en el panel.

---

### Phase 7: Módulos Faltantes (Protección Civil, Propinas, IMSS) (T20–T22)

*   [ ] **Task T20: Módulo de Protección Civil**
    *   *Description:* Bitácora de simulacros, estado de extintores, checklists fotográficos de salidas de emergencia con extracción OCR de fechas de vigencia.
    *   *Acceptance Criteria:*
        *   Tabla `proteccion_civil_checklists` migrada.
        *   Checklist con OCR funcionando para la carga de vigencia de extintor.
    *   *Verification:*
        *   Subir imagen de extintor; verificar la extracción de texto y el cálculo automático de días de vigencia restante.
    *   *Dependencies:* None
    *   *Files likely touched:*
        *   [schema.ts](file:///c:/Users/david/pulso29/lib/db/schema.ts)
        *   [proteccion-civil-v1.json](file:///c:/Users/david/pulso29/templates/seguridad/proteccion-civil-v1.json) [NEW]
        *   [route.ts](file:///c:/Users/david/pulso29/app/api/compliance/proteccion-civil/route.ts) [NEW]
    *   *Estimated scope:* Medium

*   [ ] **Task T21: Distribución de propinas**
    *   *Description:* Tablas `propinas` y `propina_asignaciones` con lógica de cálculo automático proporcional a las horas trabajadas registradas en `shiftSessions`.
    *   *Acceptance Criteria:*
        *   Asignación automática de propinas basado en horas reales de asistencia del período seleccionado.
        *   API CRUD e interfaz básica de visualización.
    *   *Verification:*
        *   Ingresar bolsa de propina de $10,000 MXN para un día de 2 empleados (8h y 4h respectivamente); verificar asignaciones exactas ($6,666.67 MXN y $3,333.33 MXN).
    *   *Dependencies:* None
    *   *Files likely touched:*
        *   [schema.ts](file:///c:/Users/david/pulso29/lib/db/schema.ts)
        *   [route.ts](file:///c:/Users/david/pulso29/app/api/propinas/route.ts) [NEW]
        *   [page.tsx](file:///c:/Users/david/pulso29/app/dashboard/labor/propinas/page.tsx) [NEW]
    *   *Estimated scope:* Medium

*   [ ] **Task T22: Alertas IMSS**
    *   *Description:* Cron en Inngest para alertar al corporativo sobre vencimientos de SUA y modificaciones patronales del IMSS.
    *   *Acceptance Criteria:*
        *   Recordatorios automáticos en días 7, 3 y 1 antes de la fecha límite patronal (día 17 de cada mes).
    *   *Verification:*
        *   Trigger manual de la función de cron; verificar el despacho correcto del payload de alerta.
    *   *Dependencies:* None
    *   *Files likely touched:*
        *   [cron-compliance-alerts.ts](file:///c:/Users/david/pulso29/lib/inngest/functions/cron-compliance-alerts.ts)
    *   *Estimated scope:* Small

#### Checkpoint 4: PC & Propinas
- [ ] Ejecutar auditoría de Protección Civil e ingresar / distribuir bolsa de propinas.
- [ ] Alertamiento de SUA verificado en panel local de Inngest.

---

### Phase 8: Reportes Automáticos Formateados (T24–T25)

*   [ ] **Task T24: Reportes PDF recurrentes**
    *   *Description:* Generador de reportes con `@react-pdf/renderer` para el envío programado de resúmenes operativos en formato PDF vía Email/WhatsApp.
    *   *Acceptance Criteria:*
        *   Generación de PDFs del reporte diario, semanal y mensual con tablas e históricos consolidados.
    *   *Verification:*
        *   Generar un reporte mensual y comprobar visualmente el layout y datos agregados.
    *   *Dependencies:* None
    *   *Files likely touched:*
        *   [cron-scheduled-reports.ts](file:///c:/Users/david/pulso29/lib/inngest/functions/cron-scheduled-reports.ts)
        *   [report-pdf-generator.ts](file:///c:/Users/david/pulso29/lib/services/report-pdf-generator.ts) [NEW]
    *   *Estimated scope:* Large

*   [ ] **Task T25: Reporte pre-auditoría COFEPRIS**
    *   *Description:* Generar un PDF descargable estructurado conforme al formato de auditoría de COFEPRIS (bitácoras sanitarias, limpieza, plagas, higiene).
    *   *Acceptance Criteria:*
        *   Botón de descarga instantánea en el dashboard de cumplimiento.
    *   *Verification:*
        *   Click en descargar; validar que el PDF agrupe y ordene evidencias de NOM-251 correspondientes al período.
    *   *Dependencies:* None
    *   *Files likely touched:*
        *   [page.tsx](file:///c:/Users/david/pulso29/app/dashboard/compliance/page.tsx)
        *   [ComplianceReportService.ts](file:///c:/Users/david/pulso29/lib/services/ComplianceReportService.ts)
    *   *Estimated scope:* Medium

#### Checkpoint 5: PDF Reports
- [ ] Descargar reporte COFEPRIS en un solo click.
- [ ] Comprobar renderizado correcto de tablas y logos del restaurante en el PDF.

---

### Phase 9: M13 — Ventas y POS (Gap Financiero) (T26–T33)

*   [ ] **Task T26: Schema de Ventas y Migración**
    *   *Description:* Tablas `daily_sales_cuts` y `pos_mapping_templates` para almacenar los cierres de caja y mapeos de columnas por POS.
    *   *Acceptance Criteria:*
        *   Campos requeridos: venta total, efectivo, tarjeta, tickets, fecha comercial, turno y canal.
        *   Unique compuesto: `(companyId, branchId, businessDate, shift, channel)`.
    *   *Verification:*
        *   Aplicar migración y verificar las llaves únicas en PostgreSQL.
    *   *Dependencies:* None
    *   *Files likely touched:*
        *   [schema.ts](file:///c:/Users/david/pulso29/lib/db/schema.ts)
    *   *Estimated scope:* Medium

*   [ ] **Task T27: Servicio de Ingesta de Cortes**
    *   *Description:* Lógica en `sales-ingestion-service.ts` para parsear archivos XLSX/CSV, aplicar plantillas de mapeo POS y validar cuadres matemáticos (tolerancia ±2%).
    *   *Acceptance Criteria:*
        *   Auto-detección del formato de archivo (`summary` | `payment_summary` | `ticket_detail` | `multi_sheet`).
        *   Diccionario de alias dinámico para emparejar headers.
    *   *Verification:*
        *   Probar parseador con un CSV real; verificar que detecte el canal DELIVERY sumando agregadores.
    *   *Dependencies:* T26
    *   *Files likely touched:*
        *   [sales-ingestion-service.ts](file:///c:/Users/david/pulso29/lib/services/sales-ingestion-service.ts) [NEW]
        *   [pos-column-aliases.ts](file:///c:/Users/david/pulso29/lib/services/pos-column-aliases.ts) [NEW]
    *   *Estimated scope:* Medium

*   [ ] **Task T28: API y UI de Upload Manual**
    *   *Description:* Endpoint `/api/sales/cuts/upload` para subir el archivo de corte diario y la pantalla `/dashboard/sales` para la interacción de gerentes.
    *   *Acceptance Criteria:*
        *   Dropzone funcional con selector de sucursal, fecha comercial y turno.
    *   *Verification:*
        *   Subir un archivo a través de la UI; verificar que aparezca en la lista de cortes recientes con estatus "VALIDATED".
    *   *Dependencies:* T27
    *   *Files likely touched:*
        *   [route.ts](file:///c:/Users/david/pulso29/app/api/sales/cuts/upload/route.ts) [NEW]
        *   [page.tsx](file:///c:/Users/david/pulso29/app/dashboard/sales/page.tsx) [NEW]
        *   [sales-cut-upload.tsx](file:///c:/Users/david/pulso29/components/sales/sales-cut-upload.tsx) [NEW]
    *   *Estimated scope:* Medium

*   [ ] **Task T29: Configuración de Plantillas POS**
    *   *Description:* Pantalla administrativa para que el tenant defina alias y mapeos de columnas cuando suba formatos no estándar.
    *   *Acceptance Criteria:*
        *   Proponer mapeo con badges de confianza (🟢 exacto, 🟡 fuzzy, ⚪ sin mapear).
    *   *Verification:*
        *   Crear nueva plantilla; editar un header manualmente en el formulario y confirmar que se use al ingestar.
    *   *Dependencies:* T27
    *   *Files likely touched:*
        *   [route.ts](file:///c:/Users/david/pulso29/app/api/sales/mapping-templates/route.ts) [NEW]
        *   [page.tsx](file:///c:/Users/david/pulso29/app/dashboard/sales/mapping/page.tsx) [NEW]
        *   [mapping-template-form.tsx](file:///c:/Users/david/pulso29/components/sales/mapping-template-form.tsx) [NEW]
    *   *Estimated scope:* Medium

*   [ ] **Task T30: Dashboard de Ventas**
    *   *Description:* Visualizaciones para el seguimiento de ventas agregadas por turno, canal de venta e históricos con ticket promedio.
    *   *Acceptance Criteria:*
        *   Gráficas Recharts integradas y filtros de fecha comercial/sucursal funcionales.
    *   *Verification:*
        *   Filtrar por rango y verificar que el ticket promedio total se recalcule dinámicamente.
    *   *Dependencies:* T28
    *   *Files likely touched:*
        *   [sales-analytics-service.ts](file:///c:/Users/david/pulso29/lib/services/sales-analytics-service.ts) [NEW]
        *   [sales-dashboard.tsx](file:///c:/Users/david/pulso29/components/sales/sales-dashboard.tsx) [NEW]
    *   *Estimated scope:* Medium

*   [ ] **Task T31: KPIs de Costo de Alimento y Laboral**
    *   *Description:* Integrar consumo teórico de inventario y costo de nómina real vs ventas para estimar en tiempo real los márgenes (Food Cost % y Labor Cost %).
    *   *Acceptance Criteria:*
        *   Semáforo y alertas automáticas si el Food Cost supera el 35% o Labor Cost supera el 30%.
    *   *Verification:*
        *   Introducir ventas bajas en un período; validar que las tarjetas marquen alerta 🟡 o 🔴.
    *   *Dependencies:* T30
    *   *Files likely touched:*
        *   [financial-kpi-service.ts](file:///c:/Users/david/pulso29/lib/services/financial-kpi-service.ts) [NEW]
        *   [financial-kpi-cards.tsx](file:///c:/Users/david/pulso29/components/sales/financial-kpi-cards.tsx) [NEW]
    *   *Estimated scope:* Medium

*   [ ] **Task T32: WhatsApp Ingesta**
    *   *Description:* Recibir el archivo adjunto (CSV/XLSX) vía WhatsApp en el webhook de Wasender, procesarlo con el servicio de ingesta y responder confirmación.
    *   *Acceptance Criteria:*
        *   Conversión fallback: responder con preguntas de texto si el archivo no se procesa correctamente (formulario conversacional).
    *   *Verification:*
        *   Simular envío de archivo por WhatsApp; verificar log de confirmación y creación de registro `daily_sales_cuts`.
    *   *Dependencies:* T27
    *   *Files likely touched:*
        *   [workflow-conversation-handler.ts](file:///c:/Users/david/pulso29/lib/whatsapp/workflow-conversation-handler.ts)
        *   [evidence-processor.ts](file:///c:/Users/david/pulso29/lib/whatsapp/evidence-processor.ts)
        *   [route.ts](file:///c:/Users/david/pulso29/app/api/whatsapp/webhook/route.ts)
    *   *Estimated scope:* Large

*   [ ] **Task T33: Cierre de Turno e Integración de Workflow**
    *   *Description:* Restricción lógica en el checklist de cierre del restaurante para que no permita enviar si no se ha detectado el corte de ventas del día.
    *   *Acceptance Criteria:*
        *   Validación en `isCutReceived(branchId, date)`.
        *   Recordatorios automatizados a gerentes que no hayan enviado el corte tras el cierre.
    *   *Verification:*
        *   Intentar completar workflow de cierre sin haber subido venta; validar alerta de bloqueo en pantalla.
    *   *Dependencies:* T31, T32
    *   *Files likely touched:*
        *   [cierre-restaurante-v2-enhanced.json](file:///c:/Users/david/pulso29/templates/operaciones_diarias/cierre-restaurante-v2-enhanced.json) [NEW]
        *   [cron-sales-cut-reminder.ts](file:///c:/Users/david/pulso29/lib/inngest/functions/cron-sales-cut-reminder.ts) [NEW]
    *   *Estimated scope:* Medium

#### Checkpoint 6: Ingesta POS & M13
- [ ] Subida manual y procesamiento por WhatsApp de cortes.
- [ ] KPIs financieros visibles en el panel de Ventas.
- [ ] Workflow de cierre bloquea la entrega si no hay corte cargado.

---

### Phase 10: M16 — Pagos y Gastos (Gap Financiero) (T34–T40)

*   [ ] **Task T34: Schema de Gastos**
    *   *Description:* Estructurar tablas para Caja Chica (`petty_cash_funds`, `petty_cash_transactions`), Gastos Operativos (`operating_expenses`) y reglas de aprobación (`expense_authorization_rules`).
    *   *Acceptance Criteria:*
        *   Montos en integer. Relación a facturas conciliadas en compras.
    *   *Verification:*
        *   Aplicar migraciones y validar relaciones y constraints en la base de datos.
    *   *Dependencies:* None
    *   *Files likely touched:*
        *   [schema.ts](file:///c:/Users/david/pulso29/lib/db/schema.ts)
    *   *Estimated scope:* Medium

*   [ ] **Task T35: Caja Chica (Servicio + UI)**
    *   *Description:* Gestión de fondos fijos por sucursal. Registro de salidas con desglose detallado de denominaciones de billetes y monedas, concepto, monto total y foto del ticket (evidencia R2).
    *   *Acceptance Criteria:*
        *   Validación de saldo disponible suficiente en transacciones tipo `OUT`.
        *   Formulario de registro exige el desglose físico por denominación de efectivo entregado.
    *   *Verification:*
        *   Registrar un egreso de caja chica en la UI; verificar el descuento atómico del saldo de la sucursal.
    *   *Dependencies:* T34
    *   *Files likely touched:*
        *   [petty-cash-service.ts](file:///c:/Users/david/pulso29/lib/services/petty-cash-service.ts) [NEW]
        *   [page.tsx](file:///c:/Users/david/pulso29/app/dashboard/finance/petty-cash/page.tsx) [NEW]
        *   [petty-cash-register.tsx](file:///c:/Users/david/pulso29/components/finance/petty-cash-register.tsx) [NEW]
    *   *Estimated scope:* Medium

*   [ ] **Task T36: Reposición Automática**
    *   *Description:* Alerta cuando el saldo desciende del 20% del fondo fijo de caja chica. Cron de auditoría diaria.
    *   *Acceptance Criteria:*
        *   Notificación automática al gerente y administrador vía WhatsApp.
    *   *Verification:*
        *   Reducir el saldo de caja chica al 18%; verificar que la alerta de reposición se guarde en base de datos.
    *   *Dependencies:* T35
    *   *Files likely touched:*
        *   [cron-petty-cash-check.ts](file:///c:/Users/david/pulso29/lib/inngest/functions/cron-petty-cash-check.ts) [NEW]
        *   [notification-dispatcher.ts](file:///c:/Users/david/pulso29/lib/services/notification-dispatcher.ts)
    *   *Estimated scope:* Small

*   [ ] **Task T37: Gastos Operativos por Categoría**
    *   *Description:* Registro de facturas o salidas sin orden de compra (servicios públicos, renta, reparaciones) categorizadas.
    *   *Acceptance Criteria:*
        *   Filtros en UI por categoría y sucursal. Agrupador mensual de gastos.
    *   *Verification:*
        *   Agregar un gasto de "Energía Eléctrica" y corroborar la asignación del estatus inicial según el flujo.
    *   *Dependencies:* T34
    *   *Files likely touched:*
        *   [expense-service.ts](file:///c:/Users/david/pulso29/lib/services/expense-service.ts) [NEW]
        *   [page.tsx](file:///c:/Users/david/pulso29/app/dashboard/finance/expenses/page.tsx) [NEW]
        *   [expense-form.tsx](file:///c:/Users/david/pulso29/components/finance/expense-form.tsx) [NEW]
    *   *Estimated scope:* Medium

*   [ ] **Task T38: Autorización por Monto**
    *   *Description:* Reglas dinámicas de aprobación de gastos en base a límites (Gerente < $1,000, Director Ops < $10,000, Owner ilimitado).
    *   *Acceptance Criteria:*
        *   Asignación automática del aprobador correspondiente y bloqueo del pago hasta la resolución.
    *   *Verification:*
        *   Registrar gasto de $15,000 MXN; verificar que el estatus sea `PENDING_APPROVAL` requiriendo al rol "Owner".
    *   *Dependencies:* T37
    *   *Files likely touched:*
        *   [expense-approval-service.ts](file:///c:/Users/david/pulso29/lib/services/expense-approval-service.ts) [NEW]
        *   [route.ts](file:///c:/Users/david/pulso29/app/api/expenses/approvals/route.ts) [NEW]
        *   [expense-approval-list.tsx](file:///c:/Users/david/pulso29/components/finance/expense-approval-list.tsx) [NEW]
    *   *Estimated scope:* Medium

*   [ ] **Task T39: Calendario de Flujo de Efectivo**
    *   *Description:* Interfaz de proyección a 30 días sumando ventas promedio contra salidas fijadas (pagos programados, nómina y gastos) netas de impuestos.
    *   *Acceptance Criteria:*
        *   Calendario interactivo que despliegue balances diarios estimados.
        *   Todas las proyecciones y egresos se calculan netos (sin IVA).
    *   *Verification:*
        *   Verificar que la proyección de nómina del día 15/30 se refleje como una salida en el calendario de flujo.
    *   *Dependencies:* T30, T38
    *   *Files likely touched:*
        *   [page.tsx](file:///c:/Users/david/pulso29/app/dashboard/finance/cash-flow/page.tsx) [NEW]
        *   [cash-flow-projection.tsx](file:///c:/Users/david/pulso29/components/finance/cash-flow-projection.tsx) [NEW]
    *   *Estimated scope:* Medium

*   [ ] **Task T40: P&L Operativo Estimado por Sucursal**
    *   *Description:* Widget consolidado en el dashboard ejecutivo que deduce heurísticamente la utilidad operativa restando costos de ventas, operando a nivel neto de impuestos.
    *   *Acceptance Criteria:*
        *   Utilidad Operativa = Ventas − Alimentos − Laboral − Gastos Operativos.
        *   Todos los sumandos y deducciones se obtienen netos (sin IVA).
        *   Uso de cache de 5 minutos.
    *   *Verification:*
        *   Asegurar que los montos coincidan con la sumatoria de las subcategorías cargadas en el dashboard ejecutivo.
    *   *Dependencies:* T31, T38
    *   *Files likely touched:*
        *   [page.tsx](file:///c:/Users/david/pulso29/app/dashboard/executive/page.tsx)
        *   [pl-widget.tsx](file:///c:/Users/david/pulso29/components/dashboard/executive/pl-widget.tsx) [NEW]
    *   *Estimated scope:* Medium

#### Checkpoint 7: Complete Finance M16
- [ ] Salidas y reposiciones de caja chica operando.
- [ ] Flujo de autorizaciones según el monto configurado.
- [ ] Calendario de flujo de efectivo y widget de P&L estimando correctamente la rentabilidad operativa.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
| :--- | :--- | :--- |
| **Incompatibilidad de formatos de POS** | Alto | Esquema canónico + Alias flexibles normalizados para mapeo dinámico en vez de parsers hardcodeados. |
| **Wasender no recibe XLSX por API** | Medio | spike de 1h en webhook (T32) para probar recepción; fallback de emergencia: foto + OCR o formulario conversacional. |
| **Errores de redondeo de flotantes** | Alto | Forzar base de datos y lógica de servicios a usar enteros en centavos de pesos (MXN). |
| **Proyecciones desfasadas por datos faltantes** | Medio | Advertencia en UI sobre el porcentaje de datos cubiertos para el cálculo (ej. "calculado con el 80% de ventas registradas"). |

## Open Questions (Resoluciones)

1. **¿El orden de las fases es adecuado?**
   *Resolución:* Sí, se mantiene el orden lineal propuesto de las fases (Fases 4 a 10 progresivamente).
2. **¿Interactividad en el portal de externos?**
   *Resolución:* Se mantiene 100% estático/PDF de lectura (descarga mediante jsPDF), sin controles interactivos para simplificar seguridad y lógica.
3. **¿La caja chica requiere desglose de billetes/monedas?**
   *Resolución:* Sí, se requiere desglose detallado de denominaciones (billetes y monedas) para control de caja chica en T35.
4. **¿Los impuestos están incluidos en P&L?**
   *Resolución:* Operación neta (sin IVA) para reflejar la salud financiera real del negocio sin distorsiones fiscales en proyecciones y P&L (T39 y T40).