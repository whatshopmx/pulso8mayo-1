import { db } from "@/lib/db";
import { notifications, notificationPreferences, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  sendWorkflowAssignmentEmail,
  sendWorkflowReminderEmail,
  sendWorkflowOverdueEmail,
  sendIncidentAlertEmail,
  sendStockAlertEmail,
  sendShiftReminderEmail,
  sendDocumentExpirationEmail,
  sendWorkflowUnassignedEmail,
} from "./email-service";

export type NotificationChannel = "whatsapp" | "email" | "in-app";
export type NotificationEventType =
  | "workflow_assignment"
  | "workflow_due_soon"
  | "workflow_overdue"
  | "incident"
  | "stock_alert"
  | "stock_count_variance"
  | "shift_reminder"
  | "schedule_change"
  | "document_expiration"
  | "shift_approval_request"
  | "shift_approval_decision"
  | "shift_change_request"
  | "shift_change_decision"
  | "employee_absence"
  | "announcement_broadcast"
  | "training_assigned"
  | "imss_deadline"
  | "sales_cut_reminder"
  | "sales_cut_missing"
  | "financial_kpi_deviation"
  | "cash_variance_detected"
  | "morning_brief"
  | "supplier_bank_account_changed"
  | "workflow_unassigned";

export interface UserData {
    id: string;
    name: string | null;
    email: string;
    phone: string | null;
    whatsappPhone: string | null;
    role: string | null;
    companyId: string | null;
    branchId: string | null;
}

export interface NotificationPreferencesData {
    userId: string;
    whatsappEnabled: boolean;
    emailEnabled: boolean;
    inAppEnabled: boolean;
    workflowAssignments: boolean;
    workflowDueSoon: boolean;
    workflowOverdue: boolean;
    incidents: boolean;
    inventoryAlerts: boolean;
}

export interface NotificationPayload {
    userId: string;
    title: string;
    message: string;
    type: "info" | "warning" | "error" | "success";
    eventType: NotificationEventType;
    actionUrl?: string;
    actionLabel?: string;
    metadata?: Record<string, unknown>;
}

export interface NotificationTemplate {
    id: string;
    name: string;
    eventType: NotificationEventType;
    channels: NotificationChannel[];
    whatsappTemplate?: string;
    emailSubject?: string;
    emailBody?: string;
    inAppTitle?: string;
    inAppMessage?: string;
    variables?: string[];
}

// Template registry
const notificationTemplates: Record<string, NotificationTemplate> = {
    "workflow_assignment": {
        id: "workflow_assignment",
        name: "Asignación de Workflow",
        eventType: "workflow_assignment",
        channels: ["whatsapp", "email", "in-app"],
        whatsappTemplate: "📋 *Nueva Tarea Asignada*\n\nHola {userName},\n\nSe te ha asignado una nueva tarea: {workflowName}\n\nFecha límite: {dueDate}\n\nÁbrelo y complétalo desde tu teléfono:\n{smartLinkUrl}",
        emailSubject: "Nueva Tarea Asignada: {workflowName}",
        emailBody: `<h2>Nueva Tarea Asignada</h2><p>Hola {userName},</p><p>Se te ha asignado una nueva tarea: <strong>{workflowName}</strong></p><p><strong>Fecha límite:</strong> {dueDate}</p><p><a href="{smartLinkUrl}">Abrir y completar la tarea</a></p>`,
        inAppTitle: "Nueva Tarea",
        inAppMessage: "Se te ha asignado: {workflowName}",
        variables: ["userName", "workflowName", "dueDate", "smartLinkUrl"]
    },
    "workflow_due_soon": {
        id: "workflow_due_soon",
        name: "Workflow Por Vencer",
        eventType: "workflow_due_soon",
        channels: ["whatsapp", "in-app"],
        whatsappTemplate: "⏰ *Recordatorio: Tarea Por Vencer*\n\nHola {userName},\n\nTu tarea \"{workflowName}\" vence en {hoursUntilDue} horas.\n\nContinúa donde la dejaste aquí:\n{smartLinkUrl}",
        emailSubject: "⏰ Recordatorio: Tarea por vencer",
        emailBody: `<h2>Recordatorio de Tarea</h2><p>Hola {userName},</p><p>Tu tarea <strong>{workflowName}</strong> vence en <strong>{hoursUntilDue} horas</strong>.</p><p><a href="{smartLinkUrl}">Abrir la tarea</a></p>`,
        inAppTitle: "Tarea Por Vencer",
        inAppMessage: "{workflowName} vence en {hoursUntilDue} horas",
        variables: ["userName", "workflowName", "hoursUntilDue", "smartLinkUrl"]
    },
    "workflow_overdue": {
        id: "workflow_overdue",
        name: "Workflow Vencido",
        eventType: "workflow_overdue",
        channels: ["whatsapp", "email", "in-app"],
        whatsappTemplate: "🚨 *TAREA VENCIDA*\n\nHola {userName},\n\nLa tarea \"{workflowName}\" está VENCIDA desde {overdueTime}.\n\nComplétala ahora mismo aquí:\n{smartLinkUrl}",
        emailSubject: "🚨 TAREA VENCIDA: {workflowName}",
        emailBody: `<h2 style="color: red;">Tarea Vencida</h2><p>Hola {userName},</p><p>La tarea <strong>{workflowName}</strong> está <strong style="color: red;">VENCIDA</strong> desde {overdueTime}.</p><p><a href="{smartLinkUrl}">Completar la tarea ahora</a></p>`,
        inAppTitle: "⚠️ Tarea Vencida",
        inAppMessage: "{workflowName} está vencida",
        variables: ["userName", "workflowName", "overdueTime", "smartLinkUrl"]
    },
    "incident": {
        id: "incident",
        name: "Incidente de Compliance",
        eventType: "incident",
        channels: ["whatsapp", "email", "in-app"],
        whatsappTemplate: "⚠️ *Incidente de Compliance*\n\nHola {userName},\n\nSe detectó un incidente: {incidentTitle}\n\nSeveridad: {severity}\n\nPor favor, toma acción inmediata.",
        emailSubject: "⚠️ Incidente de Compliance: {incidentTitle}",
        emailBody: `<h2>Incidente de Compliance</h2><p>Hola {userName},</p><p>Se detectó un incidente: <strong>{incidentTitle}</strong></p><p><strong>Severidad:</strong> {severity}</p><p>Por favor, toma acción inmediata.</p>`,
        inAppTitle: "Incidente de Compliance",
        inAppMessage: "{incidentTitle} - {severity}",
        variables: ["userName", "incidentTitle", "severity"]
    },
    "stock_alert": {
        id: "stock_alert",
        name: "Alerta de Stock",
        eventType: "stock_alert",
        channels: ["whatsapp", "email", "in-app"],
        whatsappTemplate: "📦 *Alerta de Stock Bajo*\n\nHola {userName},\n\nEl item {itemName} tiene stock bajo.\n\nStock actual: {currentStock}/{minLevel}\n\nPor favor, reordenar.",
        emailSubject: "📦 Alerta de Stock Bajo: {itemName}",
        emailBody: `<h2>Alerta de Stock Bajo</h2><p>Hola {userName},</p><p>El item <strong>{itemName}</strong> tiene stock bajo.</p><p><strong>Stock actual:</strong> {currentStock}/{minLevel}</p><p>Por favor, reordenar.</p>`,
        inAppTitle: "Stock Bajo",
        inAppMessage: "{itemName} - Stock: {currentStock}/{minLevel}",
        variables: ["userName", "itemName", "currentStock", "minLevel"]
    },
    "shift_reminder": {
        id: "shift_reminder",
        name: "Recordatorio de Turno",
        eventType: "shift_reminder",
        channels: ["whatsapp", "in-app"],
        whatsappTemplate: "👷 *Recordatorio de Turno*\n\nHola {userName},\n\nTienes un turno programado:\n\n📅 {shiftDate}\n⏰ {shiftTime}\n📍 {branchName}\n\n¡Nos vemos!",
        emailSubject: "👷 Recordatorio de Turno",
        emailBody: `<h2>Recordatorio de Turno</h2><p>Hola {userName},</p><p>Tienes un turno programado:</p><ul><li><strong>Fecha:</strong> {shiftDate}</li><li><strong>Hora:</strong> {shiftTime}</li><li><strong>Sucursal:</strong> {branchName}</li></ul>`,
        inAppTitle: "Turno Programado",
        inAppMessage: "{shiftDate} a las {shiftTime}",
        variables: ["userName", "shiftDate", "shiftTime", "branchName"]
    },
    "schedule_change": {
        id: "schedule_change",
        name: "Cambio de Horario",
        eventType: "schedule_change",
        channels: ["whatsapp", "email", "in-app"],
        whatsappTemplate: "📅 *Cambio de Horario*\n\nHola {userName},\n\nTu horario ha sido modificado:\n\n{changeDescription}\n\nPor favor, revisa tu nuevo horario en la app.",
        emailSubject: "📅 Cambio de Horario",
        emailBody: `<h2>Cambio de Horario</h2><p>Hola {userName},</p><p>Tu horario ha sido modificado:</p><p>{changeDescription}</p><p>Por favor, revisa tu nuevo horario en la app.</p>`,
        inAppTitle: "Cambio de Horario",
        inAppMessage: "{changeDescription}",
        variables: ["userName", "changeDescription"]
    },
  "document_expiration": {
    id: "document_expiration",
    name: "Documento por Vencer",
    eventType: "document_expiration",
    channels: ["whatsapp", "email", "in-app"],
    whatsappTemplate: "⚠️ *Documento por Vencer*\n\nHola {userName},\n\nTu documento \"{documentName}\" vence en {daysUntilExpiration} días.\n\nPor favor, renuévalo lo antes posible.",
    emailSubject: "⚠️ Documento por Vencer: {documentName}",
    emailBody: `<h2>Documento por Vencer</h2><p>Hola {userName},</p><p>Tu documento <strong>{documentName}</strong> vence en <strong>{daysUntilExpiration} días</strong>.</p><p>Por favor, renuévalo lo antes posible.</p>`,
    inAppTitle: "Documento por Vencer",
    inAppMessage: "{documentName} vence en {daysUntilExpiration} días",
    variables: ["userName", "documentName", "daysUntilExpiration"]
  },
  "shift_approval_request": {
    id: "shift_approval_request",
    name: "Solicitud de Aprobación de Turno",
    eventType: "shift_approval_request",
    channels: ["whatsapp", "email", "in-app"],
    whatsappTemplate: "⏰ *Nueva Solicitud de Aprobación*\n\nHola {userName},\n\n{requesterName} solicita aprobación para:\n\n*Tipo:* {approvalType}\n*Empleado:* {employeeName}\n*Descripción:* {description}\n\nPor favor revisa el dashboard para aprobar o rechazar.",
    emailSubject: "⏰ Nueva Solicitud de Aprobación: {approvalType}",
    emailBody: `<h2>Nueva Solicitud de Aprobación</h2><p>Hola {userName},</p><p><strong>{requesterName}</strong> solicita aprobación para:</p><ul><li><strong>Tipo:</strong> {approvalType}</li><li><strong>Empleado:</strong> {employeeName}</li><li><strong>Descripción:</strong> {description}</li></ul><p>Por favor revisa el dashboard para aprobar o rechazar.</p>`,
    inAppTitle: "Nueva Solicitud de Aprobación",
    inAppMessage: "{approvalType} - {employeeName}",
    variables: ["userName", "requesterName", "approvalType", "employeeName", "description"]
  },
  "shift_approval_decision": {
    id: "shift_approval_decision",
    name: "Decisión de Aprobación de Turno",
    eventType: "shift_approval_decision",
    channels: ["whatsapp", "email", "in-app"],
    whatsappTemplate: "📋 *Solicitud {decision}*\n\nHola {userName},\n\nTu solicitud de *{approvalType}* fue *{decision}* por {approverName}.\n\n{rejectionReasonSection}\n\nRevisa el dashboard para más detalles.",
    emailSubject: "📋 Solicitud {decision}: {approvalType}",
    emailBody: "<h2>Solicitud {decision}</h2><p>Hola {userName},</p><p>Tu solicitud de <strong>{approvalType}</strong> fue <strong>{decision}</strong> por {approverName}.</p>{rejectionReasonSection}<p>Revisa el dashboard para más detalles.</p>",
    inAppTitle: "Solicitud {decision}",
    inAppMessage: "{approvalType} fue {decision}",
    variables: ["userName", "approvalType", "decision", "approverName", "rejectionReasonSection"]
  },
  "shift_change_request": {
    id: "shift_change_request",
    name: "Solicitud de Intercambio de Turno",
    eventType: "shift_change_request",
    channels: ["whatsapp", "email", "in-app"],
    whatsappTemplate: "🔄 *Solicitud de Cambio de Turno*\n\nHola {userName},\n\n{requesterName} te ha enviado una solicitud para cambiar turnos:\n\n*Su Turno:* {requesterShiftDate} ({requesterShiftTime})\n*Tu Turno:* {targetShiftDate} ({targetShiftTime})\n\nResponde a la solicitud aquí:\n{smartLinkUrl}",
    emailSubject: "🔄 Solicitud de Cambio de Turno: {requesterName}",
    emailBody: "<h2>Solicitud de Cambio de Turno</h2><p>Hola {userName},</p><p><strong>{requesterName}</strong> quiere cambiar turnos contigo:</p><ul><li><strong>Su Turno:</strong> {requesterShiftDate} ({requesterShiftTime})</li><li><strong>Tu Turno:</strong> {targetShiftDate} ({targetShiftTime})</li></ul><p><a href=\"{smartLinkUrl}\">Responde a la solicitud aquí</a></p>",
    inAppTitle: "Cambio de Turno Solicitado",
    inAppMessage: "{requesterName} solicita cambiar turno contigo",
    variables: ["userName", "requesterName", "requesterShiftDate", "requesterShiftTime", "targetShiftDate", "targetShiftTime", "smartLinkUrl"]
  },
  "shift_change_decision": {
    id: "shift_change_decision",
    name: "Decisión de Intercambio de Turno",
    eventType: "shift_change_decision",
    channels: ["whatsapp", "email", "in-app"],
    whatsappTemplate: "📋 *Respuesta de Cambio de Turno*\n\nHola {userName},\n\nTu solicitud de cambio de turno con {counterpartyName} fue *{decision}*.\n\nRevisa el dashboard para más detalles.",
    emailSubject: "📋 Cambio de Turno {decision}",
    emailBody: "<h2>Cambio de Turno {decision}</h2><p>Hola {userName},</p><p>Tu solicitud de cambio de turno con <strong>{counterpartyName}</strong> fue <strong>{decision}</strong>.</p>",
    inAppTitle: "Cambio de Turno {decision}",
    inAppMessage: "Tu cambio de turno con {counterpartyName} fue {decision}",
    variables: ["userName", "counterpartyName", "decision"]
  },
  "employee_absence": {
    id: "employee_absence",
    name: "Ausencia de Empleado",
    eventType: "employee_absence",
    channels: ["whatsapp", "email", "in-app"],
    whatsappTemplate: "⚠️ *Ausencia de Empleado*\n\nHola {userName},\n\nSe ha registrado una ausencia para {employeeName} en el turno del {shiftDate} ({shiftTime}).\n\n*Motivo:* {reason}\n\nRevisa la sesión aquí:\n{smartLinkUrl}",
    emailSubject: "⚠️ Ausencia de Empleado: {employeeName}",
    emailBody: "<h2>Ausencia de Empleado</h2><p>Hola {userName},</p><p>Se ha registrado una ausencia para <strong>{employeeName}</strong> en el turno del <strong>{shiftDate} ({shiftTime})</strong>.</p><p><strong>Motivo:</strong> {reason}</p><p><a href=\"{smartLinkUrl}\">Revisa la sesión aquí</a></p>",
    inAppTitle: "Ausencia Registrada",
    inAppMessage: "Ausencia: {employeeName} - {shiftDate}",
    variables: ["userName", "employeeName", "shiftDate", "shiftTime", "reason", "smartLinkUrl"]
  },
  "announcement_broadcast": {
    id: "announcement_broadcast",
    name: "Difusión de Anuncio",
    eventType: "announcement_broadcast",
    channels: ["whatsapp", "email", "in-app"],
    whatsappTemplate: "📢 *Nuevo Anuncio: {title}*\n\nHola {userName},\n\nHay una nueva comunicación importante del grupo:\n\n\"{bodySnippet}...\"\n\nPor favor, lee el anuncio completo y confirma tu lectura aquí:\n{smartLinkUrl}",
    emailSubject: "📢 Nuevo Anuncio: {title}",
    emailBody: "<h2>Nuevo Anuncio</h2><p>Hola {userName},</p><p>Hay una nueva comunicación importante:</p><h3>{title}</h3><p>{body}</p><p>Por favor, ingresa al dashboard para confirmar la lectura.</p>",
    inAppTitle: "Nuevo Anuncio",
    inAppMessage: "{title}",
    variables: ["userName", "title", "bodySnippet", "body", "smartLinkUrl"]
  },
  "training_assigned": {
    id: "training_assigned",
    name: "Capacitación Asignada",
    eventType: "training_assigned",
    channels: ["whatsapp", "email", "in-app"],
    whatsappTemplate: "📚 *Nueva Capacitación Asignada*\n\nHola {userName},\n\nSe te ha asignado el material de capacitación obligatorio: {workflowName}\n\nFecha límite: {dueDate}\n\nPor favor, inicia tu capacitación aquí:\n{smartLinkUrl}",
    emailSubject: "📚 Nueva Capacitación: {workflowName}",
    emailBody: "<h2>Nueva Capacitación Asignada</h2><p>Hola {userName},</p><p>Se te ha asignado el material de capacitación obligatorio: <strong>{workflowName}</strong></p><p><strong>Fecha límite:</strong> {dueDate}</p><p>Por favor, ingresa a la app para completarla.</p>",
    inAppTitle: "Capacitación Asignada",
    inAppMessage: "Material asignado: {workflowName}",
    variables: ["userName", "workflowName", "dueDate", "smartLinkUrl"]
  },
  "imss_deadline": {
    id: "imss_deadline",
    name: "Fecha Límite IMSS",
    eventType: "imss_deadline",
    channels: ["whatsapp", "in-app"],
    whatsappTemplate: "⏰ *Recordatorio IMSS*\n\nHola {userName},\n\nLa fecha límite para *{deadlineLabel}* está próxima:\n\n📅 Vence: {deadlineDate} (en {daysLabel})\n\nGenera tus archivos SUA/IDSE a tiempo desde el módulo IMSS en Pulso.",
    inAppTitle: "Fecha límite IMSS en {daysLabel}",
    inAppMessage: "{deadlineLabel} vence el {deadlineDate}",
    variables: ["userName", "deadlineLabel", "deadlineDate", "daysLabel"]
  },
  "sales_cut_reminder": {
    id: "sales_cut_reminder",
    name: "Recordatorio de Corte de Caja",
    eventType: "sales_cut_reminder",
    channels: ["whatsapp", "in-app"],
    whatsappTemplate: "💰 *Recordatorio de Corte de Caja*\n\nHola {userName},\n\nRecuerda registrar el corte de ventas del turno *{shift}* ({businessDate}).\n\nIngresa directamente desde la app para subir tu reporte:\n{smartLinkUrl}",
    inAppTitle: "Corte de caja pendiente",
    inAppMessage: "Turno {shift} ({businessDate}) pendiente de registrar.",
    variables: ["userName", "shift", "businessDate", "smartLinkUrl"]
  },
  "sales_cut_missing": {
    id: "sales_cut_missing",
    name: "Corte de Caja Faltante",
    eventType: "sales_cut_missing",
    channels: ["whatsapp", "email", "in-app"],
    whatsappTemplate: "🚨 *Alerta: Corte de Caja Faltante*\n\nHola {userName},\n\nNo se ha recibido el corte de caja de la sucursal *{branchName}* para el turno *{shift}* ({businessDate}).\n\nPor favor haz clic para subirlo o revisarlo:\n{smartLinkUrl}",
    emailSubject: "🚨 Corte de caja no registrado: {branchName}",
    emailBody: "<h2>Corte de caja no registrado</h2><p>Sucursal: {branchName}</p><p>Turno: {shift}</p><p>Fecha: {businessDate}</p>",
    inAppTitle: "Corte de caja no recibido",
    inAppMessage: "{branchName} - Turno {shift} del {businessDate}",
    variables: ["userName", "branchName", "shift", "businessDate", "smartLinkUrl"]
  },
  "financial_kpi_deviation": {
    id: "financial_kpi_deviation",
    name: "Desviación de KPI Financiero",
    eventType: "financial_kpi_deviation",
    channels: ["whatsapp", "in-app"],
    whatsappTemplate: "⚠️ *Alerta Financiera*\n\nDesviación de costo en tu sucursal:\n- Food Cost: {foodCostPercent}%\n- Labor Cost: {laborCostPercent}%\n\nVentas registradas: ${totalSales} MXN.",
    inAppTitle: "Desviación de KPI Financiero",
    inAppMessage: "Food Cost {foodCostPercent}% / Labor Cost {laborCostPercent}%",
    variables: ["foodCostPercent", "laborCostPercent", "totalSales"]
  },
  "cash_variance_detected": {
    id: "cash_variance_detected",
    name: "Diferencia en Arqueo de Caja",
    eventType: "cash_variance_detected",
    channels: ["whatsapp", "in-app"],
    whatsappTemplate:
      "💵 *Diferencia en Arqueo*\n\n{branchName} · corte del {businessDate} ({shift})\n\n" +
      "Efectivo declarado: ${declaredAmount} MXN\nEfectivo contado: ${countedAmount} MXN\n" +
      "*{direction} de ${varianceAmount} MXN* ({variancePercent}%)\n\n" +
      "Revisa el corte y documenta la causa.",
    inAppTitle: "Diferencia en arqueo de caja",
    inAppMessage: "{branchName} ({businessDate}): {direction} de ${varianceAmount} MXN",
    variables: [
      "branchName",
      "businessDate",
      "shift",
      "declaredAmount",
      "countedAmount",
      "varianceAmount",
      "variancePercent",
      "direction",
    ]
  },
  "morning_brief": {
    id: "morning_brief",
    name: "Morning Brief del Grupo",
    eventType: "morning_brief",
    // Sin canal email: `sendEmailNotification` despacha por un switch de
    // eventType y no hay plantilla de correo para el brief. Declararlo aquí
    // solo produciría un envío silenciosamente vacío.
    channels: ["whatsapp", "in-app"],
    whatsappTemplate: "☀️ *Morning Brief* — {briefDate}\n\n{headline}\n\n{prioritiesText}",
    inAppTitle: "Morning Brief del grupo",
    inAppMessage: "{headline}",
    variables: ["briefDate", "headline", "prioritiesText"]
  },
  "supplier_bank_account_changed": {
    id: "supplier_bank_account_changed",
    name: "Cambio de CLABE de Proveedor",
    eventType: "supplier_bank_account_changed",
    // Sin canal email, por la misma razón que `morning_brief`:
    // `sendEmailNotification` despacha por un switch de eventType y no hay
    // plantilla de correo aquí, así que declararlo produciría un envío vacío en
    // silencio — inaceptable en una alerta antifraude, donde creer que se envió
    // es peor que saber que no.
    channels: ["whatsapp", "in-app"],
    whatsappTemplate:
      "🏦 *Cambio de cuenta bancaria de proveedor*\n\n" +
      "Proveedor: *{supplierName}*\n" +
      "Cuenta anterior: ****{previousLast4}\n" +
      "Cuenta nueva: ****{newLast4} ({bankName}){sharedLine}\n\n" +
      "La cuenta nueva *todavía no está verificada* y NO se le puede pagar. " +
      "La cuenta anterior sigue vigente.\n\n" +
      "Si no autorizaste este cambio, recházalo desde Pulso ahora.",
    inAppTitle: "Cambio de CLABE: {supplierName}",
    inAppMessage: "****{previousLast4} → ****{newLast4} ({bankName}). Sin verificar.",
    variables: [
      "supplierName",
      "previousLast4",
      "newLast4",
      "bankName",
      "sharedLine",
    ]
  },
  "workflow_unassigned": {
    id: "workflow_unassigned",
    name: "Programación Sin Destinatario",
    eventType: "workflow_unassigned",
    channels: ["whatsapp", "email", "in-app"],
    whatsappTemplate:
      "⚠️ *Programación sin destinatario*\n\nHola {userName},\n\nLa programación *\"{scheduleTitle}\"* de {branchName} no encontró a nadie disponible para ejecutarla.\n\nLa ejecución quedó creada sin asignar. Asígnala a alguien o ajusta horario/rol aquí:\n{smartLinkUrl}",
    emailSubject: "⚠️ Programación sin destinatario: {scheduleTitle}",
    emailBody: `<h2>Programación sin destinatario</h2><p>Hola {userName},</p><p>La programación <strong>{scheduleTitle}</strong> de {branchName} no encontró a nadie disponible para ejecutarla.</p><p>La ejecución quedó creada <strong>sin asignar</strong>.</p><p><a href="{smartLinkUrl}">Ver la ejecución</a></p>`,
    inAppTitle: "Programación sin destinatario",
    inAppMessage: "{scheduleTitle} ({branchName}) no encontró a nadie disponible",
    variables: ["userName", "scheduleTitle", "branchName", "smartLinkUrl"]
  }
};

export class NotificationDispatcher {
    /**
     * Send notification through appropriate channels based on user preferences
     */
    static async sendNotification(payload: NotificationPayload): Promise<void> {
        try {
            // Get user preferences
            const prefs = await this.getUserPreferences(payload.userId);
            if (!prefs) {
                console.log(`No preferences found for user ${payload.userId}`);
                return;
            }

            // Check if user wants this type of notification
            if (!this.shouldSendNotification(payload.eventType, prefs)) {
                console.log(`User ${payload.userId} has disabled ${payload.eventType} notifications`);
                return;
            }

            // Get template
            const template = notificationTemplates[payload.eventType];
            if (!template) {
                console.warn(`No template found for event type: ${payload.eventType}`);
                return;
            }

            // Get user data for template variables
            const userData = await this.getUserData(payload.userId);

            // Send through enabled channels
            const promises = [];

            if (prefs.whatsappEnabled && template.channels.includes("whatsapp")) {
                promises.push(this.sendWhatsAppNotification(payload, template, userData));
            }

            if (prefs.emailEnabled && template.channels.includes("email")) {
                promises.push(this.sendEmailNotification(payload, template, userData));
            }

            if (prefs.inAppEnabled && template.channels.includes("in-app")) {
                promises.push(this.sendInAppNotification(payload, template, userData));
            }

            await Promise.allSettled(promises);
        } catch (error) {
            console.error("Error in sendNotification:", error);
        }
    }

    /**
     * Send batch notifications to multiple users
     */
    static async sendBatchNotifications(payloads: NotificationPayload[]): Promise<void> {
        const promises = payloads.map(payload => this.sendNotification(payload));
        await Promise.allSettled(promises);
    }

    /**
     * Variables de plantilla comunes + degradación de smartLinkUrl (plan 5.4): si
     * el emisor no mandó el enlace, se cae al actionUrl (in-app) para que la
     * plantilla nunca quede con el literal o una frase colgando.
     */
    private static buildTemplateVariables(
        payload: NotificationPayload,
        userData: UserData | null
    ): Record<string, unknown> {
        return {
            ...payload.metadata,
            userName: userData?.name,
            smartLinkUrl: payload.metadata?.smartLinkUrl || payload.actionUrl || '',
        };
    }

    /**
     * Send WhatsApp notification
     */
  private static async sendWhatsAppNotification(
    payload: NotificationPayload,
    template: NotificationTemplate,
    userData: UserData
  ): Promise<void> {
    try {
      if (!template.whatsappTemplate) return;

      if (!userData?.whatsappPhone && !userData?.phone) {
        console.warn('[NotificationDispatcher] No phone number for user, skipping WhatsApp channel');
        return;
      }

      const message = this.replaceTemplateVariables(
        template.whatsappTemplate,
        this.buildTemplateVariables(payload, userData)
      );

      await this.sendWhatsAppMessage(userData.id, message);
    } catch (error) {
      console.error('[NotificationDispatcher] Error sending WhatsApp notification:', error);
    }
}

/**
   * Send email notification
   */
  private static async sendEmailNotification(
    payload: NotificationPayload,
    template: NotificationTemplate,
    userData: UserData
  ): Promise<void> {
    try {
      if (!template.emailSubject || !template.emailBody) return;

      // Get user's email
      if (!userData?.email) {
        console.log(`No email for user ${payload.userId}`);
        return;
      }

      // Send based on event type with appropriate email template
      switch (payload.eventType) {
      case 'workflow_assignment':
        await sendWorkflowAssignmentEmail(userData.email, {
          userName: userData.name || 'Usuario',
          workflowName: (payload.metadata?.workflowName as string) || 'Tarea',
          dueDate: (payload.metadata?.dueDate as string) || new Date().toISOString(),
          priority: (payload.metadata?.priority as string) || 'MEDIUM',
          assignmentUrl: payload.actionUrl || '#',
        });
        break;

      case 'workflow_due_soon':
        await sendWorkflowReminderEmail(userData.email, {
          userName: userData.name || 'Usuario',
          workflowName: (payload.metadata?.workflowName as string) || 'Tarea',
          hoursUntilDue: (payload.metadata?.hoursUntilDue as number) || 1,
          reminderType: (payload.metadata?.reminderType as '24h' | '1h' | '30min') || '1h',
          assignmentUrl: payload.actionUrl || '#',
        });
        break;

      case 'workflow_overdue':
        await sendWorkflowOverdueEmail(userData.email, {
          userName: userData.name || 'Usuario',
          workflowName: (payload.metadata?.workflowName as string) || 'Tarea',
          overdueTime: (payload.metadata?.overdueTime as string) || 'hace poco',
          assignmentUrl: payload.actionUrl || '#',
        });
        break;

      case 'workflow_unassigned':
        await sendWorkflowUnassignedEmail(userData.email, {
          userName: userData.name || 'Usuario',
          scheduleTitle: (payload.metadata?.scheduleTitle as string) || 'Programación',
          branchName: (payload.metadata?.branchName as string) || 'La sucursal',
          workflowUrl: payload.actionUrl || '#',
        });
        break;

      case 'incident':
        await sendIncidentAlertEmail(userData.email, {
          userName: userData.name || 'Usuario',
          incidentTitle: (payload.metadata?.incidentTitle as string) || 'Incidente',
          severity: (payload.metadata?.severity as string) || 'WARNING',
          description: payload.metadata?.description as string | undefined,
          incidentUrl: payload.actionUrl || '#',
        });
        break;

      case 'stock_alert':
        await sendStockAlertEmail(userData.email, {
          userName: userData.name || 'Usuario',
          itemName: (payload.metadata?.itemName as string) || 'Producto',
          currentStock: (payload.metadata?.currentStock as number) || 0,
          minLevel: (payload.metadata?.minLevel as number) || 0,
          branchName: (payload.metadata?.branchName as string) || 'Sucursal',
          inventoryUrl: payload.actionUrl || '#',
        });
        break;

      case 'shift_reminder':
        await sendShiftReminderEmail(userData.email, {
          userName: userData.name || 'Usuario',
          shiftDate: (payload.metadata?.shiftDate as string) || new Date().toLocaleDateString('es-MX'),
          shiftTime: (payload.metadata?.shiftTime as string) || '00:00',
          branchName: (payload.metadata?.branchName as string) || 'Sucursal',
          scheduleUrl: payload.actionUrl,
        });
        break;

      case 'document_expiration':
        await sendDocumentExpirationEmail(userData.email, {
          userName: userData.name || 'Usuario',
          documentName: (payload.metadata?.documentName as string) || 'Documento',
          documentType: (payload.metadata?.documentType as string) || 'General',
          expirationDate: (payload.metadata?.expirationDate as string) || new Date().toISOString(),
          daysUntilExpiration: (payload.metadata?.daysUntilExpiration as number) || 0,
          documentsUrl: payload.actionUrl || '#',
        });
        break;

        default:
          // Fallback to generic template
          const subject = this.replaceTemplateVariables(
            template.emailSubject,
            this.buildTemplateVariables(payload, userData)
          );
          const body = this.replaceTemplateVariables(
            template.emailBody,
            this.buildTemplateVariables(payload, userData)
          );
          // Generic email sending would go here if needed
          console.log(`[Email] Fallback: To: ${userData.email}, Subject: ${subject}`);
      }
    } catch (error) {
      console.error("Error sending email notification:", error);
    }
  }

  /**
     * Send in-app notification
     */
    private static async sendInAppNotification(
        payload: NotificationPayload,
        template: NotificationTemplate,
        userData: UserData
    ): Promise<void> {
        try {
            if (!template.inAppTitle || !template.inAppMessage) return;

            // Replace template variables
            const title = this.replaceTemplateVariables(
                template.inAppTitle,
                this.buildTemplateVariables(payload, userData)
            );

            const message = this.replaceTemplateVariables(
                template.inAppMessage,
                this.buildTemplateVariables(payload, userData)
            );

            // Store in database
            await db.insert(notifications).values({
                userId: payload.userId,
                title,
                message,
                type: payload.type,
                actionUrl: payload.actionUrl,
                actionLabel: payload.actionLabel,
                read: false
            });

            console.log(`[In-App] To: ${payload.userId}, Title: ${title}`);

        } catch (error) {
            console.error("Error sending in-app notification:", error);
        }
    }

    /**
     * Get user notification preferences
     */
    private static async getUserPreferences(userId: string) {
        try {
            const prefs = await db.query.notificationPreferences.findFirst({
                where: eq(notificationPreferences.userId, userId)
            });

      return prefs || {
        userId: '',
        whatsappEnabled: true,
        emailEnabled: true,
        inAppEnabled: true,
        workflowAssignments: true,
        workflowDueSoon: true,
        workflowOverdue: true,
        incidents: true,
        inventoryAlerts: true
      };
        } catch (error) {
            console.error("Error getting user preferences:", error);
            return null;
        }
    }

    /**
     * Check if notification should be sent based on event type and preferences
     */
    private static shouldSendNotification(
        eventType: NotificationEventType,
        prefs: NotificationPreferencesData
    ): boolean {
        switch (eventType) {
            case "workflow_assignment":
                return prefs.workflowAssignments;
            case "workflow_due_soon":
                return prefs.workflowDueSoon;
            case "workflow_overdue":
                return prefs.workflowOverdue;
            case "incident":
                return prefs.incidents;
            case "stock_alert":
                return true; // Always send stock alerts
            case "shift_reminder":
                return true; // Always send shift reminders
            case "schedule_change":
                return true; // Always send schedule changes
            default:
                return true;
        }
    }

    /**
     * Get user data for template variables
     */
    private static async getUserData(userId: string) {
        try {
            const user = await db.query.users.findFirst({
                where: eq(users.id, userId)
            });

            return user;
        } catch (error) {
            console.error("Error getting user data:", error);
            return null;
        }
    }

    /**
     * Replace template variables with actual values
     */
    private static replaceTemplateVariables(
        template: string,
        variables: Record<string, any>
    ): string {
        let result = template;

        Object.entries(variables).forEach(([key, value]) => {
            const regex = new RegExp(`\\{${key}\\}`, "g");
            result = result.replace(regex, String(value ?? ""));
        });

        // Última red (plan 5.4): si quedó algún literal {..} sin resolver — p.ej.
        // {smartLinkUrl} que el emisor no mandó — se elimina en vez de enviarse
        // tal cual en el mensaje.
        result = result.replace(/\{[a-zA-Z0-9_]+}/g, "");

        return result;
    }

    /**
     * Send inventory alert through appropriate channels
     */
    static async sendInventoryAlert(payload: {
        userId: string;
        eventType: string;
        data: {
            itemName: string;
            currentStock: number;
            minLevel: number;
            severity: string;
            branchId: string;
            message?: string;
        }
    }): Promise<void> {
        try {
            // Get user preferences
            const prefs = await this.getUserPreferences(payload.userId);
            if (!prefs) {
                console.log(`No preferences found for user ${payload.userId}`);
                return;
            }

            // Check if user wants inventory alerts
            if (!prefs.inventoryAlerts) {
                console.log(`User ${payload.userId} has disabled inventory alert notifications`);
                return;
            }

            // Get user data
            const userData = await this.getUserData(payload.userId);
            if (!userData) return;

            // Format message
            const severityEmoji = {
                'CRITICA': '🔴',
                'ALTA': '🟠',
                'MEDIA': '🟡',
                'BAJA': '🟢'
            }[payload.data.severity] || '⚪';

            const message = payload.data.message || (`${severityEmoji} *ALERTA DE INVENTARIO*\n\n` +
                `Producto: ${payload.data.itemName}\n` +
                `Stock Actual: ${payload.data.currentStock}\n` +
                `Stock Mínimo: ${payload.data.minLevel}\n` +
                `Severidad: ${payload.data.severity}\n\n` +
                `Por favor revisa el inventario y toma las acciones necesarias.`);

            // Send through enabled channels
            const promises = [];

            if (prefs.whatsappEnabled) {
                promises.push(this.sendWhatsAppMessage(payload.userId, message));
            }

            if (prefs.inAppEnabled) {
                promises.push(
                    db.insert(notifications).values({
                        userId: payload.userId,
                        type: 'warning',
                        title: `Alerta de Inventario: ${payload.data.itemName}`,
                        message: payload.data.message || `El stock de ${payload.data.itemName} está por debajo del mínimo (${payload.data.currentStock} < ${payload.data.minLevel})`,
                        actionUrl: `/dashboard/inventory/alerts`,
                    })
                );
            }

            await Promise.allSettled(promises);
        } catch (error) {
            console.error("Error in sendInventoryAlert:", error);
        }
    }

  static async sendStockCountVarianceAlert(payload: {
    userId: string;
    data: {
      branchId: string;
      category: string;
      alertCount: number;
      totalProducts: number;
      instanceId: string;
    };
  }): Promise<void> {
    try {
      const prefs = await this.getUserPreferences(payload.userId);
      if (!prefs || !prefs.inventoryAlerts) return;

      const userData = await this.getUserData(payload.userId);
      if (!userData) return;

      const message = `📊 *ALERTA DE CONTEO DE INVENTARIO*\n\n` +
        `Categoría: ${payload.data.category}\n` +
        `Productos con varianza >10%: ${payload.data.alertCount} de ${payload.data.totalProducts}\n\n` +
        `Revisa los resultados para tomar las acciones necesarias.`;

      const promises = [];

      if (prefs.whatsappEnabled) {
        promises.push(this.sendWhatsAppMessage(payload.userId, message));
      }

      if (prefs.inAppEnabled) {
        promises.push(
          db.insert(notifications).values({
            userId: payload.userId,
            type: 'warning',
            title: `Varianza en Conteo: ${payload.data.category}`,
            message: `${payload.data.alertCount} de ${payload.data.totalProducts} productos con varianza >10%`,
            actionUrl: `/dashboard/inventory/stock-count/${payload.data.instanceId}/results`,
          })
        );
      }

      await Promise.allSettled(promises);
    } catch (error) {
      console.error("Error in sendStockCountVarianceAlert:", error);
    }
  }

  /**
   * Send WhatsApp message to user
     */
  private static async sendWhatsAppMessage(userId: string, message: string): Promise<void> {
    try {
      const { whatsappClient } = await import('@/lib/whatsapp/client-factory');
      const { sessionManager } = await import('@/lib/whatsapp/session-manager');

      const userData = await this.getUserData(userId);
      if (!userData?.phone && !userData?.whatsappPhone) {
        console.warn('[NotificationDispatcher] No phone number for user, skipping WhatsApp send', userId);
        return;
      }

      const companyId = userData.companyId || process.env.DEFAULT_COMPANY_ID || 'default';
      const session = await sessionManager.getActiveSession(companyId);
      if (!session) {
        console.warn('[NotificationDispatcher] No active WhatsApp session, skipping WhatsApp send for user', userId);
        return;
      }

      const phone = userData.whatsappPhone || userData.phone!;
      await whatsappClient.sendMessage({
        sessionId: session.sessionId,
        to: phone,
        message,
      });
    } catch (error) {
      console.error('[NotificationDispatcher] WhatsApp send failed for user', userId, error);
    }
}

/**
     * Get available templates
     */
    static getTemplates(): Record<string, NotificationTemplate> {
        return notificationTemplates;
    }

    /**
     * Get template by event type
     */
    static getTemplate(eventType: NotificationEventType): NotificationTemplate | undefined {
        return notificationTemplates[eventType];
    }

    /**
     * Send document expiration alert through appropriate channels
     */
    static async sendDocumentExpirationAlert(payload: {
        userId: string;
        userName: string;
        documentName: string;
        documentType: string;
        expirationDate: Date;
        daysUntilExpiration: number;
    }): Promise<void> {
        try {
            // Get user preferences
            const prefs = await this.getUserPreferences(payload.userId);
            if (!prefs) {
                console.log(`No preferences found for user ${payload.userId}`);
                return;
            }

            // Format message
            const message = `⚠️ *DOCUMENTO POR VENCER*\n\n` +
                `Hola ${payload.userName},\n\n` +
                `Tu documento "${payload.documentName}" vence en ${payload.daysUntilExpiration} días.\n\n` +
                `Fecha de vencimiento: ${payload.expirationDate.toLocaleDateString('es-MX')}\n\n` +
                `Por favor, renuévalo lo antes posible para mantener tu expediente completo.`;

            // Send through enabled channels
            const promises = [];

            if (prefs.whatsappEnabled) {
                promises.push(this.sendWhatsAppMessage(payload.userId, message));
            }

            if (prefs.inAppEnabled) {
                promises.push(
                    db.insert(notifications).values({
                        userId: payload.userId,
                        type: 'warning',
                        title: `Documento por Vencer: ${payload.documentName}`,
                        message: `Tu documento "${payload.documentName}" vence en ${payload.daysUntilExpiration} días`,
                        actionUrl: `/dashboard/labor/documents`,
                        actionLabel: 'Ver Expediente',
                    })
                );
            }

            await Promise.allSettled(promises);
        } catch (error) {
            console.error("Error in sendDocumentExpirationAlert:", error);
        }
    }
}
