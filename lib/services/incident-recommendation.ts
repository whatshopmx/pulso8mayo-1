import { getServiceNameForType } from '@/lib/compliance-mapping';
import { findSuggestedAction } from '@/lib/services/incident-action-catalog';

/**
 * Resolver determinista de "la única cosa que hay que hacer ahora" en un incidente.
 *
 * Función PURA: no importa `@/lib/db` ni llama a ningún modelo. Todo lo que
 * necesita se le pasa por parámetro, así que se puede probar sin sembrar la base
 * (ver `scripts/test-incident-recommendation.ts`) y reutilizar más adelante desde
 * el router de WhatsApp o un smart link sin arrastrar la capa de datos.
 *
 * La cascada es la de AD-2 en `tasks/plan-incident-remediation-actions.md`:
 * el primer caso que hace match gana.
 */

export type RecommendedActionKind =
  | 'CONFIRM_EXTERNAL'
  | 'AWAIT_SCHEDULED'
  | 'CONFIGURE_PROVIDER'
  | 'REQUEST_EXTERNAL'
  | 'RUN_PROTOCOL_STEP'
  | 'SUGGESTED_FIX'
  | 'ESCALATE'
  | 'RESOLVE_MANUAL';

export type RecommendationUrgency = 'HIGH' | 'MEDIUM' | 'LOW';

export interface RecommendedAction {
  kind: RecommendedActionKind;
  /** Qué hay que hacer, en español y en imperativo. */
  label: string;
  /** Por qué se recomienda esto. Sin esto, la recomendación es una orden opaca. */
  rationale: string;
  urgency: RecommendationUrgency;
  payload?: {
    remediationActionId?: string;
    serviceType?: string;
    stepIndex?: number;
    escalationLevel?: number;
    scheduledDate?: string;
    branchId?: string;
  };
}

export interface RecommendationIncident {
  id: string;
  branchId?: string | null;
  status?: string | null;
  severity?: string | null;
  /** Contexto del que el catálogo deriva la acción cuando no hay protocolo. */
  title?: string | null;
  description?: string | null;
  stepId?: string | null;
  remediationProtocol?: unknown;
  escalationChain?: unknown;
  metadata?: unknown;
}

export interface RecommendationRemediationAction {
  id: string;
  status?: string | null;
  serviceType?: string | null;
  serviceName?: string | null;
  scheduledDate?: string | Date | null;
}

export interface RecommendationProvider {
  id: string;
  serviceName?: string | null;
  serviceType?: string | null;
}

export interface RecommendationInput {
  incident: RecommendationIncident;
  actions?: RecommendationRemediationAction[] | null;
  /** Proveedor activo de la sucursal para el servicio que pide el paso actual. */
  activeProvider?: RecommendationProvider | null;
}

interface ProtocolStep {
  type?: string;
  instruction?: string;
  complianceServiceType?: string;
  [key: string]: unknown;
}

interface NormalizedProtocol {
  steps: ProtocolStep[];
  maxAttempts?: number;
}

/**
 * `remediationProtocol` viene en dos formas incompatibles según la plantilla:
 * `templates/TEMPLATE_SCHEMA.md` lo define como objeto `{ enabled, steps[] }`,
 * pero p.ej. `templates/compliance/inspeccion-sistema-contra-incendios-v1.json`
 * lo guarda como **string**. Normalizar las plantillas es otro plan (AD-8), así
 * que aquí degradamos sin lanzar: lo que no sea un objeto con `steps[]` no
 * cuenta como protocolo.
 */
function normalizeProtocol(raw: unknown): NormalizedProtocol | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const protocol = raw as Record<string, unknown>;

  // Solo un `enabled` explícitamente falso desactiva el protocolo; las
  // plantillas que omiten el campo se consideran activas.
  if (protocol.enabled === false) return null;

  const steps = protocol.steps;
  if (!Array.isArray(steps) || steps.length === 0) return null;

  const maxAttempts = typeof protocol.maxAttempts === 'number' ? protocol.maxAttempts : undefined;

  return { steps: steps as ProtocolStep[], maxAttempts };
}

function asRecord(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function formatDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return null;
  return date.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
}

function toIsoString(value: string | Date | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

/** El nivel de escalación configurado para "falló la remediación". */
function findRemediationFailureLevel(escalationChain: unknown): number | undefined {
  if (!Array.isArray(escalationChain)) return undefined;

  const level = escalationChain.find(
    (entry) => asRecord(entry).triggerCondition === 'remediation_failed'
  );

  const value = asRecord(level).level;
  return typeof value === 'number' ? value : undefined;
}

/** Paso en curso del protocolo, o null si no hay protocolo utilizable (AD-8). */
function getCurrentStep(incident: RecommendationIncident): ProtocolStep | null {
  const protocol = normalizeProtocol(incident.remediationProtocol);
  if (!protocol) return null;

  const stepIndex = toNumber(asRecord(incident.metadata).remediationCurrentStep, 0);
  return protocol.steps[stepIndex] ?? null;
}

/**
 * Tipo de servicio externo que exige el paso en curso, o null si el paso no es
 * `external_service`.
 *
 * Lo usa la ruta para saber si vale la pena consultar el proveedor activo de la
 * sucursal, sin duplicar el parseo tolerante de `remediationProtocol`.
 */
export function getRequiredServiceType(incident: RecommendationIncident): string | null {
  const step = getCurrentStep(incident);
  if (!step || step.type !== 'external_service') return null;
  return step.complianceServiceType || null;
}

export function resolveRecommendedAction(input: RecommendationInput): RecommendedAction {
  const { incident, actions, activeProvider } = input;
  const list = Array.isArray(actions) ? actions : [];

  // --- Caso 1: hay una acción de remediación PENDIENTE -----------------------
  const pending = list.find((a) => a.status === 'PENDING');
  if (pending) {
    const serviceName =
      pending.serviceName || getServiceNameForType(pending.serviceType || '');
    return {
      kind: 'CONFIRM_EXTERNAL',
      label: `Confirmar visita de ${serviceName}`,
      rationale:
        'Hay una acción de remediación externa pendiente: el incidente no se resuelve ' +
        'hasta que gerencia agende la visita del proveedor.',
      urgency: 'HIGH',
      payload: {
        remediationActionId: pending.id,
        serviceType: pending.serviceType || undefined,
        branchId: incident.branchId || undefined,
      },
    };
  }

  // --- Caso 2: ya hay una visita CONFIRMADA (informativo, sin CTA) -----------
  const confirmed = list.find((a) => a.status === 'CONFIRMED');
  if (confirmed) {
    const serviceName =
      confirmed.serviceName || getServiceNameForType(confirmed.serviceType || '');
    const when = formatDate(confirmed.scheduledDate);
    return {
      kind: 'AWAIT_SCHEDULED',
      label: when
        ? `Visita de ${serviceName} programada para el ${when}`
        : `Visita de ${serviceName} programada`,
      rationale:
        'La visita ya está agendada. El incidente se resuelve solo cuando el workflow ' +
        'del proveedor se complete; no hace falta hacer nada más.',
      urgency: 'LOW',
      payload: {
        remediationActionId: confirmed.id,
        serviceType: confirmed.serviceType || undefined,
        scheduledDate: toIsoString(confirmed.scheduledDate),
        branchId: incident.branchId || undefined,
      },
    };
  }

  // --- Lectura del protocolo (tolerante: AD-8) ------------------------------
  const protocol = normalizeProtocol(incident.remediationProtocol);
  const metadata = asRecord(incident.metadata);
  const isEscalated = incident.status === 'ESCALATED';

  if (!protocol) {
    // Sin protocolo, el catálogo deriva la acción del tipo de incidente. Es el
    // caso mayoritario: sólo 8 de 28 plantillas definen remediationProtocol, y
    // sin esto la mayoría de los incidentes sólo podría decir "resuélvelo tú".
    const suggested = findSuggestedAction({
      title: incident.title,
      description: incident.description,
      stepId: incident.stepId,
    });

    if (suggested) {
      return {
        kind: 'SUGGESTED_FIX',
        label: suggested.label,
        // El rationale declara que es una sugerencia por tipo, no un protocolo
        // configurado: quien la ejecuta debe saber de dónde salió.
        rationale:
          `Detectado como ${suggested.detectedAs}. Este incidente no trae protocolo de ` +
          'remediación configurado, así que la acción es la sugerida para su tipo; ' +
          'ajústala si el caso lo pide.',
        urgency: isEscalated ? 'HIGH' : suggested.urgency,
        payload: { branchId: incident.branchId || undefined },
      };
    }

    return {
      kind: 'RESOLVE_MANUAL',
      label: 'Resolver el incidente manualmente',
      rationale: isEscalated
        ? 'El incidente está escalado y no tiene un protocolo de remediación utilizable.'
        : 'Este incidente no tiene un protocolo de remediación configurado, así que la ' +
          'resolución queda a criterio de quien lo atiende.',
      urgency: 'MEDIUM',
    };
  }

  const stepIndex = toNumber(metadata.remediationCurrentStep, 0);
  const currentStep = protocol.steps[stepIndex];
  const totalSteps = protocol.steps.length;
  const attempts = toNumber(metadata.remediationAttempts, 0);
  const maxAttempts = toNumber(
    metadata.remediationMaxAttempts,
    protocol.maxAttempts ?? 2
  );
  const attemptsLeft = maxAttempts - attempts;
  const stepPosition = `Paso ${Math.min(stepIndex + 1, totalSteps)} de ${totalSteps} del protocolo`;

  if (!currentStep) {
    return {
      kind: 'RESOLVE_MANUAL',
      label: 'Resolver el incidente manualmente',
      rationale: `El protocolo tiene ${totalSteps} paso(s) y el incidente apunta al paso ${stepIndex + 1}, que no existe.`,
      urgency: 'MEDIUM',
    };
  }

  const isExternalStep = currentStep.type === 'external_service';

  if (isExternalStep) {
    const serviceType = currentStep.complianceServiceType || '';
    const serviceName = getServiceNameForType(serviceType);

    // --- Caso 3: paso externo, sin fila, y la sucursal no tiene proveedor ---
    // Es el bloqueo real: recomendar "confirmar visita" no sirve de nada si no
    // hay a quién confirmarle.
    if (!activeProvider) {
      return {
        kind: 'CONFIGURE_PROVIDER',
        label: `Configurar proveedor de ${serviceName} en la sucursal`,
        rationale: `${stepPosition} requiere un servicio externo, pero la sucursal no tiene proveedor de ${serviceName} activo.`,
        urgency: 'HIGH',
        payload: {
          serviceType: serviceType || undefined,
          stepIndex,
          branchId: incident.branchId || undefined,
        },
      };
    }

    // --- Caso 4: paso externo, sin fila, con proveedor (informativo) --------
    return {
      kind: 'REQUEST_EXTERNAL',
      label: `Se solicitará la visita de ${serviceName}`,
      rationale: `${stepPosition} requiere servicio externo · la sucursal tiene proveedor de ${serviceName} activo (${activeProvider.serviceName || serviceName}). La solicitud la genera el motor de workflows.`,
      urgency: 'MEDIUM',
      payload: {
        serviceType: serviceType || undefined,
        stepIndex,
        branchId: incident.branchId || undefined,
      },
    };
  }

  // --- Caso 5: paso self-fix con intentos disponibles ------------------------
  // El `!isEscalated` no está en la lista de AD-2, pero sí en su intención: un
  // incidente ya escalado no debe volver a pedir que se corra el protocolo.
  // En la práctica coinciden (el servicio escala al agotar intentos); el guard
  // cubre la escalación manual, donde aún quedarían intentos.
  if (!isEscalated && attemptsLeft > 0) {
    return {
      kind: 'RUN_PROTOCOL_STEP',
      label: currentStep.instruction
        ? `Ejecutar: ${currentStep.instruction}`
        : 'Ejecutar el siguiente paso del protocolo',
      rationale: `${stepPosition} · quedan ${attemptsLeft} de ${maxAttempts} intento(s) antes de escalar.`,
      urgency: 'HIGH',
      payload: { stepIndex, branchId: incident.branchId || undefined },
    };
  }

  // --- Caso 6: intentos agotados o incidente escalado -----------------------
  const escalationLevel = findRemediationFailureLevel(incident.escalationChain);
  if (escalationLevel !== undefined) {
    return {
      kind: 'ESCALATE',
      label: `Escalar el incidente a nivel ${escalationLevel}`,
      rationale: isEscalated
        ? `El incidente ya está escalado · la cadena define el nivel ${escalationLevel} para remediación fallida.`
        : `${stepPosition} agotó sus ${maxAttempts} intento(s) · la cadena define el nivel ${escalationLevel} para remediación fallida.`,
      urgency: 'HIGH',
      payload: { escalationLevel, stepIndex, branchId: incident.branchId || undefined },
    };
  }

  // --- Caso 7: fallback -----------------------------------------------------
  return {
    kind: 'RESOLVE_MANUAL',
    label: 'Resolver el incidente manualmente',
    rationale: isEscalated
      ? 'El incidente está escalado y su cadena de escalación no define un nivel para remediación fallida.'
      : `${stepPosition} agotó sus ${maxAttempts} intento(s) y no hay una cadena de escalación configurada para remediación fallida.`,
    urgency: 'HIGH',
  };
}
