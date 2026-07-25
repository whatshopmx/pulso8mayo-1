export interface ActionField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean' | 'tags' | 'multiline';
  required?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
  defaultValue?: any;
}

export interface CompletionActionType {
  type: string;
  label: string;
  group: ActionGroup;
  description?: string;
  fields: ActionField[];
}

export interface StepActionType {
  type: string;
  label: string;
  description?: string;
  fields: ActionField[];
}

export type ActionGroup =
  | 'notifications'
  | 'reports'
  | 'inventory'
  | 'maintenance'
  | 'employees'
  | 'branch'
  | 'legal'
  | 'flow'
  | 'claims';

export const ACTION_GROUP_LABELS: Record<ActionGroup, string> = {
  notifications: 'Notificaciones',
  reports: 'Reportes',
  inventory: 'Inventario',
  maintenance: 'Mantenimiento',
  employees: 'Empleados',
  branch: 'Sucursal',
  legal: 'Registros Legales',
  flow: 'Flujo',
  claims: 'Reclamos',
};

export const COMPLETION_ACTION_TYPES: CompletionActionType[] = [
  // Notificaciones
  {
    type: 'SEND_NOTIFICATION',
    label: 'Enviar Notificación',
    group: 'notifications',
    description: 'Envía una notificación por WhatsApp, email o SMS',
    fields: [
      { name: 'target', label: 'Roles Destino', type: 'tags', required: true, placeholder: 'GERENTE, OWNER, RH' },
      { name: 'channel', label: 'Canal', type: 'select', required: true, defaultValue: 'whatsapp', options: [
        { value: 'whatsapp', label: 'WhatsApp' },
        { value: 'email', label: 'Email' },
        { value: 'sms', label: 'SMS' },
        { value: 'in-app', label: 'In-App' },
      ]},
      { name: 'message', label: 'Mensaje', type: 'multiline', required: true, placeholder: 'Mensaje de notificación...' },
      { name: 'condition', label: 'Condición (opcional)', type: 'text', placeholder: 'Ej. issues_found, severity=CRITICAL' },
    ],
  },
  // Reportes
  {
    type: 'GENERATE_PDF_REPORT',
    label: 'Generar Reporte PDF',
    group: 'reports',
    description: 'Genera un reporte en PDF con los datos del flujo',
    fields: [
      { name: 'template', label: 'Plantilla', type: 'text', placeholder: 'default' },
      { name: 'includePhotos', label: 'Incluir Fotos', type: 'boolean', defaultValue: true },
      { name: 'sendTo', label: 'Enviar a (roles)', type: 'tags', placeholder: 'GERENTE, OWNER' },
    ],
  },
  {
    type: 'GENERATE_ANONYMOUS_REPORT',
    label: 'Generar Reporte Anónimo',
    group: 'reports',
    description: 'Genera un reporte anónimo (NOM-035)',
    fields: [
      { name: 'condition', label: 'Condición', type: 'text', placeholder: 'always' },
      { name: 'message', label: 'Mensaje', type: 'multiline' },
    ],
  },
  {
    type: 'GENERATE_DISCREPANCY_REPORT',
    label: 'Generar Reporte de Discrepancias',
    group: 'reports',
    description: 'Genera un reporte de discrepancias de inventario',
    fields: [],
  },
  // Inventario
  {
    type: 'UPDATE_INVENTORY',
    label: 'Actualizar Inventario',
    group: 'inventory',
    description: 'Actualiza los registros de inventario',
    fields: [
      { name: 'condition', label: 'Condición', type: 'text', placeholder: 'rejected' },
      { name: 'message', label: 'Mensaje', type: 'multiline' },
    ],
  },
  {
    type: 'UPDATE_TEMPERATURE_LOG',
    label: 'Actualizar Registro de Temperatura',
    group: 'inventory',
    description: 'Actualiza el log de temperaturas',
    fields: [
      { name: 'message', label: 'Mensaje', type: 'multiline' },
    ],
  },
  {
    type: 'UPDATE_FUMIGATION_LOG',
    label: 'Actualizar Registro de Fumigación',
    group: 'inventory',
    description: 'Actualiza el log de fumigación',
    fields: [
      { name: 'message', label: 'Mensaje', type: 'multiline' },
    ],
  },
  // Mantenimiento
  {
    type: 'CREATE_MAINTENANCE_TICKET',
    label: 'Crear Ticket de Mantenimiento',
    group: 'maintenance',
    description: 'Crea un ticket de mantenimiento',
    fields: [
      { name: 'priority', label: 'Prioridad', type: 'select', defaultValue: 'MEDIUM', options: [
        { value: 'LOW', label: 'Baja' },
        { value: 'MEDIUM', label: 'Media' },
        { value: 'HIGH', label: 'Alta' },
        { value: 'URGENT', label: 'Urgente' },
      ]},
      { name: 'assignTo', label: 'Asignar a', type: 'select', options: [
        { value: 'GERENTE', label: 'Gerente' },
        { value: 'TECHNICAL_SERVICE', label: 'Servicio Técnico' },
        { value: 'CHEF', label: 'Chef' },
        { value: 'OWNER', label: 'Dueño' },
      ]},
      { name: 'condition', label: 'Condición', type: 'text', placeholder: 'issues_detected' },
      { name: 'message', label: 'Descripción', type: 'multiline' },
    ],
  },
  {
    type: 'UPDATE_MAINTENANCE_SCHEDULE',
    label: 'Actualizar Programa de Mantenimiento',
    group: 'maintenance',
    description: 'Actualiza el calendario de mantenimiento',
    fields: [
      { name: 'message', label: 'Mensaje', type: 'multiline' },
    ],
  },
  // Empleados
  {
    type: 'UPDATE_EMPLOYEE_STATUS',
    label: 'Actualizar Estatus Empleado',
    group: 'employees',
    description: 'Actualiza el estatus de un empleado',
    fields: [
      { name: 'status', label: 'Estatus', type: 'text', required: true, placeholder: 'VERIFIED, ACTIVE, SUSPENDED' },
      { name: 'validFor', label: 'Válido por (min)', type: 'number', defaultValue: 480 },
    ],
  },
  {
    type: 'UPDATE_WORK_SHIFT',
    label: 'Actualizar Turno',
    group: 'employees',
    description: 'Actualiza la asignación de turno',
    fields: [
      { name: 'message', label: 'Mensaje', type: 'multiline' },
    ],
  },
  {
    type: 'CALCULATE_HOURS',
    label: 'Calcular Horas Trabajadas',
    group: 'employees',
    description: 'Calcula las horas trabajadas',
    fields: [
      { name: 'message', label: 'Mensaje', type: 'multiline' },
    ],
  },
  {
    type: 'CREATE_EMPLOYEE_RECORD',
    label: 'Crear Registro de Empleado',
    group: 'employees',
    description: 'Crea un expediente de empleado',
    fields: [],
  },
  {
    type: 'ACTIVATE_SYSTEM_ACCESS',
    label: 'Activar Acceso a Sistema',
    group: 'employees',
    description: 'Activa accesos del empleado',
    fields: [],
  },
  {
    type: 'CALCULATE_SCORE',
    label: 'Calcular Puntaje',
    group: 'employees',
    description: 'Calcula puntaje de evaluación',
    fields: [
      { name: 'message', label: 'Mensaje', type: 'multiline' },
    ],
  },
  // Sucursal
  {
    type: 'UPDATE_BRANCH_STATUS',
    label: 'Actualizar Estatus Sucursal',
    group: 'branch',
    description: 'Cambia el estatus de apertura/cierre',
    fields: [
      { name: 'status', label: 'Estatus', type: 'select', required: true, defaultValue: 'OPEN', options: [
        { value: 'OPEN', label: 'Abierto' },
        { value: 'CLOSED', label: 'Cerrado' },
      ]},
    ],
  },
  {
    type: 'SYNC_ACCOUNTING',
    label: 'Sincronizar Contabilidad',
    group: 'branch',
    description: 'Sincroniza datos con el sistema contable',
    fields: [
      { name: 'message', label: 'Descripción', type: 'multiline' },
    ],
  },
  // Registros Legales
  {
    type: 'CREATE_INCIDENT_RECORD',
    label: 'Crear Registro de Incidente',
    group: 'legal',
    description: 'Registra un incidente oficial',
    fields: [],
  },
  {
    type: 'CREATE_COFEPRIS_REPORT',
    label: 'Generar Reporte COFEPRIS',
    group: 'legal',
    description: 'Genera reporte para COFEPRIS',
    fields: [],
  },
  {
    type: 'CREATE_STPS_REPORT',
    label: 'Generar Reporte STPS',
    group: 'legal',
    description: 'Genera reporte para STPS',
    fields: [],
  },
  {
    type: 'REGISTER_ACCESS_DB',
    label: 'Registrar en Base de Accesos',
    group: 'legal',
    description: 'Registra el evento en la base de accesos',
    fields: [
      { name: 'message', label: 'Mensaje', type: 'multiline' },
    ],
  },
  // Flujo
  {
    type: 'TRIGGER_NEXT_WORKFLOW',
    label: 'Activar Siguiente Flujo',
    group: 'flow',
    description: 'Dispara otro flujo de trabajo',
    fields: [
      { name: 'workflowId', label: 'ID del Flujo', type: 'text', required: true, placeholder: 'tpl-siguiente-workflow' },
      { name: 'delay', label: 'Demora (segundos)', type: 'number', defaultValue: 0 },
    ],
  },
  // Reclamos
  {
    type: 'CREATE_CLAIM',
    label: 'Crear Reclamo',
    group: 'claims',
    description: 'Crea un reclamo a proveedor',
    fields: [
      { name: 'condition', label: 'Condición', type: 'text', placeholder: 'rejected' },
      { name: 'message', label: 'Descripción', type: 'multiline' },
    ],
  },
];

export function getCompletionActionType(type: string): CompletionActionType | undefined {
  return COMPLETION_ACTION_TYPES.find(a => a.type === type);
}

export function getCompletionActionsByGroup(group: ActionGroup): CompletionActionType[] {
  return COMPLETION_ACTION_TYPES.filter(a => a.group === group);
}

export const STEP_ACTION_TYPES: StepActionType[] = [
  {
    type: 'AUTO_REMINDER',
    label: 'Recordatorio Automático',
    description: 'Envía un recordatorio después de un tiempo',
    fields: [
      { name: 'delay', label: 'Demora (segundos)', type: 'number', defaultValue: 30 },
      { name: 'message', label: 'Mensaje', type: 'multiline', placeholder: 'Mensaje del recordatorio...' },
    ],
  },
  {
    type: 'CREATE_MAINTENANCE_TICKET',
    label: 'Crear Ticket de Mantenimiento',
    description: 'Crea un ticket de mantenimiento correctivo',
    fields: [
      { name: 'priority', label: 'Prioridad', type: 'select', defaultValue: 'MEDIUM', options: [
        { value: 'LOW', label: 'Baja' },
        { value: 'MEDIUM', label: 'Media' },
        { value: 'HIGH', label: 'Alta' },
        { value: 'URGENT', label: 'Urgente' },
      ]},
      { name: 'assignTo', label: 'Asignar a', type: 'select', options: [
        { value: 'GERENTE', label: 'Gerente' },
        { value: 'TECHNICAL_SERVICE', label: 'Servicio Técnico' },
        { value: 'CHEF', label: 'Chef' },
        { value: 'OWNER', label: 'Dueño' },
      ]},
    ],
  },
  {
    type: 'BLOCK_WORKFLOW_COMPLETION',
    label: 'Bloquear Finalización',
    description: 'Impide que el flujo continúe hasta que se resuelva',
    fields: [],
  },
  {
    type: 'SEND_HOME_PROTOCOL',
    label: 'Enviar Protocolo a Casa',
    description: 'Envía al empleado a casa (incumplimiento higiene)',
    fields: [
      { name: 'message', label: 'Mensaje', type: 'multiline', placeholder: 'Instrucciones para el empleado...' },
    ],
  },
  {
    type: 'CREATE_PURCHASE_ORDER',
    label: 'Crear Orden de Compra',
    description: 'Genera una orden de compra para reposición',
    fields: [
      { name: 'item', label: 'Artículo', type: 'text', placeholder: 'Nombre del artículo...' },
      { name: 'quantity', label: 'Cantidad', type: 'number', defaultValue: 1 },
    ],
  },
  {
    type: 'ESCALATE',
    label: 'Escalar a Nivel Superior',
    description: 'Escala el incidente a roles superiores',
    fields: [
      { name: 'message', label: 'Mensaje', type: 'multiline', placeholder: 'Razón de escalación...' },
    ],
  },
  {
    type: 'AUTO_REJECT',
    label: 'Rechazar Automáticamente',
    description: 'Rechaza el ítem o solicitud automáticamente',
    fields: [
      { name: 'message', label: 'Motivo', type: 'multiline', placeholder: 'Motivo del rechazo...' },
    ],
  },
  {
    type: 'SEND_NOTIFICATION',
    label: 'Enviar Notificación',
    description: 'Envía una notificación a un rol específico',
    fields: [
      { name: 'target', label: 'Rol Destino', type: 'text', required: true, placeholder: 'GERENTE, OWNER, RH' },
      { name: 'channel', label: 'Canal', type: 'select', defaultValue: 'whatsapp', options: [
        { value: 'whatsapp', label: 'WhatsApp' },
        { value: 'email', label: 'Email' },
        { value: 'in-app', label: 'In-App' },
      ]},
      { name: 'message', label: 'Mensaje', type: 'multiline', placeholder: 'Mensaje de notificación...' },
    ],
  },
  {
    type: 'LOG_RETARD',
    label: 'Registrar Retardo',
    description: 'Registra un retardo en el sistema',
    fields: [
      { name: 'message', label: 'Nota', type: 'multiline' },
    ],
  },
  {
    type: 'LOG_ABSENCE',
    label: 'Registrar Ausencia',
    description: 'Registra una ausencia en el sistema',
    fields: [
      { name: 'message', label: 'Nota', type: 'multiline' },
    ],
  },
  {
    type: 'LOG_VIOLATION',
    label: 'Registrar Violación',
    description: 'Registra una violación a la normativa',
    fields: [
      { name: 'message', label: 'Nota', type: 'multiline' },
    ],
  },
  {
    type: 'GENERATE_ACTION_PLAN',
    label: 'Generar Plan de Acción',
    description: 'Genera un plan de acción correctivo',
    fields: [
      { name: 'message', label: 'Descripción', type: 'multiline' },
    ],
  },
  {
    type: 'SCHEDULE_COMPLIANCE_SERVICE',
    label: 'Agendar Servicio de Cumplimiento',
    description: 'Agenda un servicio externo de cumplimiento',
    fields: [
      { name: 'message', label: 'Nota', type: 'multiline' },
    ],
  },
  {
    type: 'REQUIRE_REMEDIATION',
    label: 'Requerir Remedición',
    description: 'Requiere un paso de remediación guiada',
    fields: [
      { name: 'message', label: 'Instrucciones', type: 'multiline', placeholder: 'Instrucciones para remediar...' },
    ],
  },
  {
    type: 'NOTIFY_RH',
    label: 'Notificar a RH',
    description: 'Envía una notificación al departamento de RH',
    fields: [
      { name: 'message', label: 'Mensaje', type: 'multiline' },
    ],
  },
  {
    type: 'NOTIFY_RH_ANONYMOUS',
    label: 'Notificar a RH (Anónimo)',
    description: 'Notificación anónima a RH (NOM-035)',
    fields: [
      { name: 'message', label: 'Mensaje', type: 'multiline' },
    ],
  },
  {
    type: 'CREATE_COFEPRIS_REPORT',
    label: 'Generar Reporte COFEPRIS',
    description: 'Genera un reporte para COFEPRIS',
    fields: [],
  },
  {
    type: 'CREATE_STPS_REPORT',
    label: 'Generar Reporte STPS',
    description: 'Genera un reporte para STPS',
    fields: [],
  },
];

export function getStepActionType(type: string): StepActionType | undefined {
  return STEP_ACTION_TYPES.find(a => a.type === type);
}

export function getDefaultActionFields(type: string): Record<string, any> {
  const def = getCompletionActionType(type) || getStepActionType(type);
  if (!def) return {};
  const defaults: Record<string, any> = {};
  for (const field of def.fields) {
    if (field.defaultValue !== undefined) {
      defaults[field.name] = field.defaultValue;
    }
  }
  return defaults;
}
