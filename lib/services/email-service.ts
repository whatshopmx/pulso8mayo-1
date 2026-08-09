/**
 * Email Service
 *
 * Handles email sending using Resend API
 * Provides HTML email templates and fallback handling
 */

import { Resend } from 'resend';

// Initialize Resend client lazily to avoid build-time errors
let resend: Resend | null = null;

function getResendClient(): Resend {
  if (!resend) {
    if (!process.env.RESEND_API_KEY) {
      console.warn('[Email Service] RESEND_API_KEY not set. Email functionality will be disabled.');
    }
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

export interface EmailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
  }>;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send email via Resend
 */
export async function sendEmail(options: EmailOptions): Promise<EmailResult> {
  try {
    const client = getResendClient();

    // If no API key is configured, log and return early
    if (!process.env.RESEND_API_KEY) {
      console.log('[Email Service] Email not sent - RESEND_API_KEY not configured:', {
        to: options.to,
        subject: options.subject,
      });
      return {
        success: false,
        error: 'RESEND_API_KEY not configured',
      };
    }

    const attachments = options.attachments?.map((a) => ({
      filename: a.filename,
      content:
        typeof a.content === "string"
          ? a.content
          : a.content.toString("base64"),
    }));

    const { data, error } = await client.emails.send({
      from: options.from || 'Pulso HORECA <notifications@pulso.app>',
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
      cc: options.cc,
      bcc: options.bcc,
      attachments,
    });

    if (error) {
      console.error('[Email Service] Resend error:', error);
      return {
        success: false,
        error: error.message,
      };
    }

    console.log(`[Email Service] Email sent successfully: ${data?.id}`);
    return {
      success: true,
      messageId: data?.id,
    };
  } catch (error) {
    console.error('[Email Service] Failed to send email:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Build HTML email with Pulso branding
 */
export function buildEmailHtml(options: {
  title: string;
  content: string;
  actionUrl?: string;
  actionLabel?: string;
  footerText?: string;
}): string {
  const { title, content, actionUrl, actionLabel, footerText } = options;

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background-color: #f5f5f5;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 30px 20px;
      text-align: center;
    }
    .header h1 {
      color: #ffffff;
      margin: 0;
      font-size: 24px;
      font-weight: 600;
    }
    .content {
      padding: 30px 20px;
    }
    .content p {
      margin: 0 0 15px 0;
      color: #555;
    }
    .button {
      display: inline-block;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #ffffff !important;
      text-decoration: none;
      padding: 12px 30px;
      border-radius: 6px;
      margin: 20px 0;
      font-weight: 500;
    }
    .footer {
      background-color: #f8f9fa;
      padding: 20px;
      text-align: center;
      border-top: 1px solid #e9ecef;
    }
    .footer p {
      margin: 0;
      color: #6c757d;
      font-size: 14px;
    }
    .alert-box {
      background-color: #fff3cd;
      border: 1px solid #ffeaa7;
      border-radius: 6px;
      padding: 15px;
      margin: 20px 0;
    }
    .alert-box.warning {
      background-color: #fff3cd;
      border-color: #ffc107;
    }
    .alert-box.error {
      background-color: #f8d7da;
      border-color: #dc3545;
    }
    .alert-box.success {
      background-color: #d4edda;
      border-color: #28a745;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Pulso HORECA</h1>
    </div>
    <div class="content">
      <h2>${title}</h2>
      ${content}
      ${actionUrl && actionLabel ? `
      <div style="text-align: center;">
        <a href="${actionUrl}" class="button">${actionLabel}</a>
      </div>
      ` : ''}
    </div>
    <div class="footer">
      <p>${footerText || 'Este es un mensaje automático de Pulso HORECA. Por favor no respondas a este correo.'}</p>
      <p style="margin-top: 10px; font-size: 12px;">
        &copy; ${new Date().getFullYear()} Pulso HORECA. Todos los derechos reservados.
      </p>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Send workflow assignment email
 */
export async function sendWorkflowAssignmentEmail(
  to: string,
  data: {
    userName: string;
    workflowName: string;
    dueDate: string;
    priority: string;
    assignmentUrl: string;
  }
): Promise<EmailResult> {
  const priorityEmoji = {
    LOW: '🟢',
    MEDIUM: '🟡',
    HIGH: '🟠',
    URGENT: '🔴',
  }[data.priority] || '⚪';

  const html = buildEmailHtml({
    title: 'Nueva Tarea Asignada',
    content: `
      <p>Hola ${data.userName},</p>
      <p>Se te ha asignado una nueva tarea:</p>
      <div class="alert-box">
        <strong>${data.workflowName}</strong><br>
        Prioridad: ${priorityEmoji} ${data.priority}<br>
        Fecha límite: ${new Date(data.dueDate).toLocaleString('es-MX')}
      </div>
      <p>Por favor, revisa tu dashboard para más detalles y completa la tarea antes de la fecha límite.</p>
    `,
    actionUrl: data.assignmentUrl,
    actionLabel: 'Ver Tarea',
  });

  return sendEmail({
    to,
    subject: `Nueva Tarea Asignada: ${data.workflowName}`,
    html,
  });
}

/**
 * Send workflow reminder email
 */
export async function sendWorkflowReminderEmail(
  to: string,
  data: {
    userName: string;
    workflowName: string;
    hoursUntilDue: number;
    reminderType: '24h' | '1h' | '30min';
    assignmentUrl: string;
  }
): Promise<EmailResult> {
  const urgencyClass = data.reminderType === '30min' ? 'error' : data.reminderType === '1h' ? 'warning' : '';
  const urgencyText = {
    '24h': '24 horas',
    '1h': '1 hora',
    '30min': '30 minutos',
  }[data.reminderType];

  const html = buildEmailHtml({
    title: '⏰ Recordatorio: Tarea por Vencer',
    content: `
      <p>Hola ${data.userName},</p>
      <p>Tu tarea está por vencer:</p>
      <div class="alert-box ${urgencyClass}">
        <strong>${data.workflowName}</strong><br>
        Tiempo restante: ${urgencyText}
      </div>
      <p>¡No olvides completarla antes de que venza!</p>
    `,
    actionUrl: data.assignmentUrl,
    actionLabel: 'Completar Ahora',
  });

  return sendEmail({
    to,
    subject: `⏰ Recordatorio: ${data.workflowName} vence en ${urgencyText}`,
    html,
  });
}

/**
 * Send workflow overdue email
 */
export async function sendWorkflowOverdueEmail(
  to: string,
  data: {
    userName: string;
    workflowName: string;
    overdueTime: string;
    assignmentUrl: string;
  }
): Promise<EmailResult> {
  const html = buildEmailHtml({
    title: '🚨 TAREA VENCIDA',
    content: `
      <p>Hola ${data.userName},</p>
      <div class="alert-box error">
        <strong>${data.workflowName}</strong><br>
        Estado: VENCIDA desde ${data.overdueTime}
      </div>
      <p>Por favor, complétala lo antes posible para evitar problemas de cumplimiento.</p>
    `,
    actionUrl: data.assignmentUrl,
    actionLabel: 'Completar Ahora',
  });

  return sendEmail({
    to,
    subject: `🚨 TAREA VENCIDA: ${data.workflowName}`,
    html,
  });
}

/**
 * Send workflow-unassigned email (plan 5.2): una programación no encontró
 * destinatario elegible — el gerente de la sucursal debe asignarla a mano.
 */
export async function sendWorkflowUnassignedEmail(
  to: string,
  data: {
    userName: string;
    scheduleTitle: string;
    branchName: string;
    workflowUrl: string;
  }
): Promise<EmailResult> {
  const html = buildEmailHtml({
    title: '⚠️ Programación sin destinatario',
    content: `
      <p>Hola ${data.userName},</p>
      <div class="alert-box warning">
        <strong>${data.scheduleTitle}</strong><br>
        Sucursal: ${data.branchName}
      </div>
      <p>La programación no encontró a <strong>nadie disponible</strong> para ejecutarla a la hora programada. La ejecución quedó creada pero <strong>sin asignar</strong>.</p>
      <p>Asígnala a alguien o ajusta el horario/rol para que no se repita.</p>
    `,
    actionUrl: data.workflowUrl,
    actionLabel: 'Ver Ejecución',
  });

  return sendEmail({
    to,
    subject: `⚠️ Programación sin destinatario: ${data.scheduleTitle}`,
    html,
  });
}


/**
 * Send incident alert email
 */
export async function sendIncidentAlertEmail(
  to: string,
  data: {
    userName: string;
    incidentTitle: string;
    severity: string;
    description?: string;
    incidentUrl: string;
  }
): Promise<EmailResult> {
  const severityClass = {
    CRITICAL: 'error',
    WARNING: 'warning',
    FATAL: 'error',
  }[data.severity] || '';

  const html = buildEmailHtml({
    title: '⚠️ Incidente de Compliance',
    content: `
      <p>Hola ${data.userName},</p>
      <p>Se ha detectado un incidente que requiere tu atención:</p>
      <div class="alert-box ${severityClass}">
        <strong>${data.incidentTitle}</strong><br>
        Severidad: ${data.severity}
        ${data.description ? `<br>Descripción: ${data.description}` : ''}
      </div>
      <p>Por favor, toma acción inmediata para resolver este incidente.</p>
    `,
    actionUrl: data.incidentUrl,
    actionLabel: 'Ver Incidente',
  });

  return sendEmail({
    to,
    subject: `⚠️ Incidente ${data.severity}: ${data.incidentTitle}`,
    html,
  });
}

/**
 * Send stock alert email
 */
export async function sendStockAlertEmail(
  to: string,
  data: {
    userName: string;
    itemName: string;
    currentStock: number;
    minLevel: number;
    branchName: string;
    inventoryUrl: string;
  }
): Promise<EmailResult> {
  const html = buildEmailHtml({
    title: '📦 Alerta de Stock Bajo',
    content: `
      <p>Hola ${data.userName},</p>
      <div class="alert-box warning">
        <strong>${data.itemName}</strong><br>
        Stock actual: ${data.currentStock}<br>
        Stock mínimo: ${data.minLevel}<br>
        Sucursal: ${data.branchName}
      </div>
      <p>Por favor, reordenar este producto lo antes posible.</p>
    `,
    actionUrl: data.inventoryUrl,
    actionLabel: 'Ver Inventario',
  });

  return sendEmail({
    to,
    subject: `📦 Stock Bajo: ${data.itemName}`,
    html,
  });
}

/**
 * Send shift reminder email
 */
export async function sendShiftReminderEmail(
  to: string,
  data: {
    userName: string;
    shiftDate: string;
    shiftTime: string;
    branchName: string;
    scheduleUrl?: string;
  }
): Promise<EmailResult> {
  const html = buildEmailHtml({
    title: '👷 Recordatorio de Turno',
    content: `
      <p>Hola ${data.userName},</p>
      <p>Tienes un turno programado:</p>
      <div class="alert-box">
        <strong>📅 ${data.shiftDate}</strong><br>
        ⏰ ${data.shiftTime}<br>
        📍 ${data.branchName}
      </div>
      <p>¡Nos vemos!</p>
    `,
    actionUrl: data.scheduleUrl,
    actionLabel: 'Ver Horario',
  });

  return sendEmail({
    to,
    subject: `👷 Recordatorio de Turno: ${data.shiftDate}`,
    html,
  });
}

/**
 * Send document expiration email
 */
export async function sendDocumentExpirationEmail(
  to: string,
  data: {
    userName: string;
    documentName: string;
    documentType: string;
    expirationDate: string;
    daysUntilExpiration: number;
    documentsUrl: string;
  }
): Promise<EmailResult> {
  const urgencyClass = data.daysUntilExpiration <= 7 ? 'error' : 'warning';

  const html = buildEmailHtml({
    title: '⚠️ Documento por Vencer',
    content: `
      <p>Hola ${data.userName},</p>
      <div class="alert-box ${urgencyClass}">
        <strong>${data.documentName}</strong> (${data.documentType})<br>
        Vence en: ${data.daysUntilExpiration} días<br>
        Fecha de vencimiento: ${new Date(data.expirationDate).toLocaleDateString('es-MX')}
      </div>
      <p>Por favor, renuévalo lo antes posible para mantener tu expediente completo.</p>
    `,
    actionUrl: data.documentsUrl,
    actionLabel: 'Ver Expediente',
  });

  return sendEmail({
    to,
    subject: `⚠️ Documento por Vencer: ${data.documentName}`,
    html,
  });
}
