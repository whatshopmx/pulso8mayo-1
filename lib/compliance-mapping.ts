/**
 * Compliance Service to Workflow Template Mapping
 * 
 * Maps regulatory and compliance service types (e.g. FUMIGATION, FIRE_SYSTEM_CHECK)
 * to their default workflow template IDs and metadata.
 */

export interface ComplianceServiceMapping {
  serviceType: string;
  name: string;
  defaultTemplateId: string;
  description: string;
}

export const COMPLIANCE_SERVICE_MAPPINGS: Record<string, ComplianceServiceMapping> = {
  FUMIGATION: {
    serviceType: 'FUMIGATION',
    name: 'Fumigación y Control de Plagas',
    defaultTemplateId: 'fumigacion-v1',
    description: 'Servicio de fumigación y certificado de manejo integrado de plagas',
  },
  PEST_CONTROL: {
    serviceType: 'PEST_CONTROL',
    name: 'Control de Plagas',
    defaultTemplateId: 'fumigacion-v1',
    description: 'Inspección y control preventivo de plagas',
  },
  FIRE_SYSTEM_CHECK: {
    serviceType: 'FIRE_SYSTEM_CHECK',
    name: 'Inspección de Extintores y Sistema Contra Incendios',
    defaultTemplateId: 'extintores-v1',
    description: 'Revisión y recarga de extintores y sistemas de supresión de incendios',
  },
  WATER_QUALITY: {
    serviceType: 'WATER_QUALITY',
    name: 'Limpieza y Cloración de Cisternas / Trampas de Grasa',
    defaultTemplateId: 'trampa-grasa-v1',
    description: 'Análisis microbiológico de agua y limpieza de depósitos o trampas de grasa',
  },
  HYGIENE_AUDIT: {
    serviceType: 'HYGIENE_AUDIT',
    name: 'Auditoría de Higiene y NOM-251',
    defaultTemplateId: 'nom251-v1',
    description: 'Auditoría de cumplimiento de la norma NOM-251-SSA1-2009',
  },
  SAFETY_INSPECTION: {
    serviceType: 'SAFETY_INSPECTION',
    name: 'Inspección de Seguridad y Protección Civil',
    defaultTemplateId: 'proteccion-civil-v1',
    description: 'Verificación de rutas de evacuación, botiquín y elementos de seguridad',
  },
};

/**
 * Gets the workflow template ID for a given compliance service type.
 * Falls back to explicitly provided templateId or default template for service type.
 */
export function getWorkflowTemplateForServiceType(serviceType: string, overrideTemplateId?: string): string {
  if (overrideTemplateId) return overrideTemplateId;
  const mapping = COMPLIANCE_SERVICE_MAPPINGS[serviceType.toUpperCase()];
  return mapping?.defaultTemplateId || 'fumigacion-v1';
}

/**
 * Gets human-readable name for a service type.
 */
export function getServiceNameForType(serviceType: string): string {
  const mapping = COMPLIANCE_SERVICE_MAPPINGS[serviceType.toUpperCase()];
  return mapping?.name || serviceType;
}
