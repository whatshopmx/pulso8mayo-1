/**
 * Incident-specific notification templates for WhatsApp and Email.
 *
 * Each template uses Handlebars-style {{variables}} that are replaced
 * at send time by the dispatcher.
 */

export interface IncidentTemplateVars {
  title: string;
  severity: string;
  branch: string;
  detectedAt: string;
  resolution?: string;
  assignedTo?: string;
  resolutionTime?: string;
}

export type IncidentEventType =
  | "detected"
  | "escalation"
  | "resolution"
  | "service_scheduled";

interface IncidentTemplate {
  whatsapp: string;
  email: { subject: string; body: string };
}

const SEVERITY_EMOJI: Record<string, string> = {
  CRITICAL: "🔴",
  HIGH: "🟠",
  WARNING: "🟡",
  FATAL: "⚫",
};

export const incidentTemplates: Record<IncidentEventType, (vars: IncidentTemplateVars) => IncidentTemplate> = {
  detected: (vars) => ({
    whatsapp: `${SEVERITY_EMOJI[vars.severity] || "⚠️"} *Incidente Detectado*

*${vars.title}*
Severidad: ${vars.severity}
Sucursal: ${vars.branch}
Detectado: ${vars.detectedAt}

${vars.assignedTo ? `Asignado a: ${vars.assignedTo}` : "Requiere atención."}

Ingresa al sistema para revisar detalles y iniciar remediación.`,
    email: {
      subject: `[Incidente] ${vars.title} — ${vars.severity}`,
      body: `Se detectó un incidente en la sucursal ${vars.branch}.

Título: ${vars.title}
Severidad: ${vars.severity}
Fecha de detección: ${vars.detectedAt}
${vars.assignedTo ? `Asignado a: ${vars.assignedTo}` : ""}

Inicie el protocolo de remediación desde el dashboard.`,
    },
  }),

  escalation: (vars) => ({
    whatsapp: `🚨 *Escalación de Incidente*

*${vars.title}*
Severidad: ${vars.severity}
Sucursal: ${vars.branch}

El incidente ha sido escalado y requiere atención inmediata.
${vars.assignedTo ? `Responsable: ${vars.assignedTo}` : ""}

Revisa el dashboard para más detalles.`,
    email: {
      subject: `[Escalación] ${vars.title} — ${vars.severity}`,
      body: `El siguiente incidente ha sido escalado:

Título: ${vars.title}
Severidad: ${vars.severity}
Sucursal: ${vars.branch}
Fecha de detección: ${vars.detectedAt}
${vars.assignedTo ? `Responsable: ${vars.assignedTo}` : ""}

Acción requerida: revisar y escalar según protocolo.`,
    },
  }),

  resolution: (vars) => ({
    whatsapp: `✅ *Incidente Resuelto*

*${vars.title}*
Sucursal: ${vars.branch}
${vars.resolutionTime ? `Tiempo de resolución: ${vars.resolutionTime}` : ""}
${vars.resolution ? `Resolución: ${vars.resolution}` : ""}

El incidente ha sido cerrado exitosamente.`,
    email: {
      subject: `[Resuelto] ${vars.title}`,
      body: `El incidente ha sido resuelto:

Título: ${vars.title}
Sucursal: ${vars.branch}
${vars.resolutionTime ? `Tiempo de resolución: ${vars.resolutionTime}` : ""}
${vars.resolution ? `Resolución: ${vars.resolution}` : ""}

El incidente está marcado como cerrado.`,
    },
  }),

  service_scheduled: (vars) => ({
    whatsapp: `🔧 *Servicio Externo Agendado*

*${vars.title}*
Sucursal: ${vars.branch}
${vars.assignedTo ? `Proveedor: ${vars.assignedTo}` : ""}

Se ha programado un servicio externo para resolver el incidente.`,
    email: {
      subject: `[Servicio] ${vars.title} — ${vars.branch}`,
      body: `Se ha agendado un servicio externo para:

Título: ${vars.title}
Sucursal: ${vars.branch}
${vars.assignedTo ? `Proveedor: ${vars.assignedTo}` : ""}

El servicio será atendido según la programación establecida.`,
    },
  }),
};

/**
 * Render a template with the given variables.
 */
export function renderIncidentTemplate(
  eventType: IncidentEventType,
  vars: IncidentTemplateVars,
): IncidentTemplate {
  return incidentTemplates[eventType](vars);
}
