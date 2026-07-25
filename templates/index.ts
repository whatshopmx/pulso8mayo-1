/**
 * Pulso Template Library
 * Comprehensive collection of HORECA operation templates
 */

import type { WorkflowTemplateData as Template } from '../lib/types/workflow';
import { STEP_TYPE_TO_EXECUTOR_TYPE, normalizeOptions } from '../lib/workflow-type-map';

// Atención al Cliente
import reporteIncidentesV2 from './atencion_cliente/reporte-incidentes-v2-enhanced.json';

// Compliance
import dailyAttendance from './compliance/daily-attendance-v1.json';
import fumigacionV1 from './compliance/fumigacion-v1.json';
import inspeccionSistemaIncendiosV1 from './compliance/inspeccion-sistema-contra-incendios-v1.json';
import nom035Survey from './compliance/nom-035-survey-v1.json';

// Control de Calidad
import controlHigieneV2 from './control_calidad/control-higiene-personal-v2-enhanced.json';
import controlTemperaturas from './control_calidad/control-temperaturas-v1.json';
import inspeccionAlimentos from './control_calidad/inspeccion-alimentos-v1.json';
import recepcionMercanciaV2 from './control_calidad/recepcion-mercancia-v2-enhanced.json';

// Mantenimiento
import checklistMantenimiento from './mantenimiento/checklist-mantenimiento-v1.json';
import mantenimientoEquiposRefrigeradores from './mantenimiento/mantenimiento-equipos-v1.json';

// Operaciones Diarias
import aperturaRestauranteV2 from './operaciones_diarias/apertura-restaurante-v2-enhanced.json';
import cierreRestauranteV2 from './operaciones_diarias/cierre-restaurante-v2-enhanced.json';
import limpiezaSanitizacionV2 from './operaciones_diarias/limpieza-sanitizacion-v2-enhanced.json';
import mantenimientoEquiposV2 from './operaciones_diarias/mantenimiento-equipos-v2-enhanced.json';

// Recursos Humanos
import onboardingEmpleadoV2 from './recursos_humanos/onboarding-empleado-v2-enhanced.json';

// Seguridad
import controlAccesos from './seguridad/control-accesos-v1.json';
import seguridadLocal from './seguridad/seguridad-local-v1.json';

// Inventario
import conteoInventarioV1 from './inventory/conteo-inventario-v1.json';


const normalizeTemplate = (json: any): Template => {
  return {
    ...json,
    id: json.id,
    title: json.nombre || json.title || "Sin Título",
    description: json.descripcion || json.description || "",
    category: json.categoria || json.category || "GENERAL",
    aiConfig: json.aiConfig || json.configuracionIA,
    complianceConfig: json.complianceConfig || json.configuracionCumplimiento,
    completionActions: json.completionActions || json.accionesCompletado,
    tags: json.tags || json.etiquetas,
    duracionEstimada: json.duracionEstimada || json.duracion_estimada,
    steps: (json.pasos || json.steps || []).map((step: any) => {
      const rawType = step.fieldType || step.tipo || step.type || 'text';
      const canonicalType = (STEP_TYPE_TO_EXECUTOR_TYPE[rawType] || 'TEXT') as any;

      const rawTitle = step.label || step.titulo || step.nombre || step.title || 'Untitled Step';
      const rawDesc = step.descripcion || step.description || '';
      const rawRequired = step.obligatorio || step.required || false;

      const extra = step.extraAttributes || {};
      const placeholder = step.placeholder || extra.placeholder || '';
      const defaultValue = step.defaultValue || extra.defaultValue || extra.value || '';
      const readOnly = step.readOnly ?? step.static ?? extra.readonly ?? extra.readOnly ?? false;
      const helperText = extra.helperText || '';

      const config = step.config || { ...extra };
      const rawOptions = step.options || step.opciones || config.options || config.items;
      const options = normalizeOptions(rawOptions);

      return {
        id: step.id || crypto.randomUUID(),
        type: canonicalType,
        title: rawTitle,
        description: rawDesc || helperText,
        required: rawRequired,
        aiVerification: (() => {
          const rawAi = step.aiVerification || step.verificacionIA;
          if (!rawAi) return undefined;
          const { threshold, ...rest } = rawAi;
          return {
            ...rest,
            ...(threshold !== undefined ? { confidenceThreshold: threshold } : {}),
          } as any;
        })(),
        logicRules: step.logicRules || step.reglasLogica,
        branches: step.branches || step.ramas,
        validation: step.validation || step.validacion,
        readOnly,
        conditionalLogic: step.conditionalLogic || step.logicaCondicional,
        options: options.length > 0 ? options : undefined,
        placeholder: placeholder || undefined,
        defaultValue: defaultValue || undefined,
        config: {
          ...config,
          ...(options.length > 0 ? { options } : {}),
          ...(placeholder ? { placeholder } : {}),
          ...(defaultValue ? { defaultValue } : {}),
          ...(readOnly ? { readOnly: true } : {}),
        },
      } as any;
    }),
  } as Template;
};

export const templateLibrary: Record<string, Template> = {
  // Atención al Cliente (1)
  'reporte-incidentes-v2': normalizeTemplate(reporteIncidentesV2),

  // Compliance (4)
  'daily-attendance-v1': normalizeTemplate(dailyAttendance),
  'fumigacion-v1': normalizeTemplate(fumigacionV1),
  'inspeccion-sistema-incendios-v1': normalizeTemplate(inspeccionSistemaIncendiosV1),
  'nom-035-survey-v1': normalizeTemplate(nom035Survey),

  // Control de Calidad (4)
  'control-higiene-personal-v2': normalizeTemplate(controlHigieneV2),
  'control-temperaturas-v1': normalizeTemplate(controlTemperaturas),
  'inspeccion-alimentos-v1': normalizeTemplate(inspeccionAlimentos),
  'recepcion-mercancia-v2': normalizeTemplate(recepcionMercanciaV2),

  // Mantenimiento (3)
  'checklist-mantenimiento-v1': normalizeTemplate(checklistMantenimiento),
  'mantenimiento-equipos-refrigeradores-v1': normalizeTemplate(mantenimientoEquiposRefrigeradores),
  'mantenimiento-equipos-v2': normalizeTemplate(mantenimientoEquiposV2),

  // Operaciones Diarias (3)
  'apertura-restaurante-v2': normalizeTemplate(aperturaRestauranteV2),
  'cierre-restaurante-v2': normalizeTemplate(cierreRestauranteV2),
  'limpieza-sanitizacion-v2': normalizeTemplate(limpiezaSanitizacionV2),

  // Recursos Humanos (1)
  'onboarding-empleado-v2': normalizeTemplate(onboardingEmpleadoV2),

  // Seguridad (2)
  'control-accesos-v1': normalizeTemplate(controlAccesos),
  'seguridad-local-v1': normalizeTemplate(seguridadLocal),

  // Inventario (1)
  'conteo-inventario-v1': normalizeTemplate(conteoInventarioV1),
};


export const getTemplateById = (id: string): Template | undefined => {
  return templateLibrary[id];
};

export const getAllTemplates = (): Template[] => {
  return Object.values(templateLibrary);
};

export const getTemplatesByCategory = (category: string): Template[] => {
  return Object.values(templateLibrary).filter(template => template.category === category);
};

export const getTemplatesByType = (type: string): Template[] => {
  return Object.values(templateLibrary).filter(template => (template as any).type === type || (template as any).tipo === type);
};

export default templateLibrary;