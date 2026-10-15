import { ApiError } from "@/lib/api/error";
import { getStepCategory, normalizeOptions, type StepCategory } from "@/lib/workflow-type-map";
import type { StepUpdateContext } from "@/lib/services/workflow-execution-service";
import type { Role } from "@/lib/permissions";

export type WorkflowStepContractErrorCode =
  | "STEP_NOT_FOUND"
  | "WORKFLOW_TERMINAL"
  | "STEP_ALREADY_COMPLETED"
  | "REQUIRED_VALUE_MISSING"
  | "INVALID_VALUE_TYPE"
  | "VALUE_OUT_OF_BOUNDS"
  | "INVALID_OPTION"
  | "EVIDENCE_REQUIRED"
  | "UNAUTHORIZED_SKIP"
  | "SKIP_JUSTIFICATION_REQUIRED"
  | "INVALID_STATUS_TRANSITION";

/**
 * Error de contrato de paso con código estructurado y mensaje redactado en español.
 */
export class WorkflowStepContractError extends ApiError {
  constructor(
    public readonly code: WorkflowStepContractErrorCode,
    message: string,
    statusCode: number = 400,
    details?: unknown
  ) {
    super(message, statusCode, details);
    this.name = "WorkflowStepContractError";
  }
}

/** Roles autorizados para justificar la omisión de un paso obligatorio. */
const ROLES_SUPERVISION: Role[] = [
  "SUPER_ADMIN",
  "OWNER",
  "ADMIN",
  "GERENTE",
  "SUPERVISOR",
];

export interface StepContractData {
  value?: unknown;
  evidenceUrl?: string | null;
  comment?: string | null;
  status?: "COMPLETED" | "SKIPPED" | "FAILED" | "IN_PROGRESS" | "PENDING";
}

export interface StepContractValidationParams {
  stepDef: any;
  data: StepContractData;
  instance: {
    id: string;
    status: string | null;
    workflowTemplateId?: string | null;
  };
  savedStep?: {
    status?: string | null;
    definition?: unknown;
    value?: unknown;
  } | null;
  ctx: StepUpdateContext;
}

/**
 * Comprueba si la definición del paso exige evidencia documental o fotográfica.
 */
export function pasoExigeEvidencia(stepDef: any, category: StepCategory): boolean {
  if (category === "PHOTO" || category === "VIDEO") {
    return true;
  }
  return Boolean(
    stepDef?.evidenceRequired ||
    stepDef?.config?.evidenceRequired ||
    stepDef?.metadata?.evidenceRequired
  );
}

/**
 * Valida la evidencia adjunta a un paso.
 */
export function validarEvidenciaPaso(
  stepDef: any,
  data: StepContractData,
  category: StepCategory
): void {
  const exigeEvidencia = pasoExigeEvidencia(stepDef, category);
  if (!exigeEvidencia) {
    return;
  }

  const tieneEvidenceUrl =
    typeof data.evidenceUrl === "string" && data.evidenceUrl.trim().length > 0;

  // En pasos de tipo PHOTO o VIDEO, el valor mismo puede ser la URL de la imagen/video
  const tieneValorMedia =
    (category === "PHOTO" || category === "VIDEO") &&
    typeof data.value === "string" &&
    data.value.trim().length > 0;

  if (!tieneEvidenceUrl && !tieneValorMedia) {
    if (category === "PHOTO" || category === "VIDEO") {
      throw new WorkflowStepContractError(
        "EVIDENCE_REQUIRED",
        "Debes adjuntar la fotografía o video requerido para completar este paso.",
        400
      );
    }
    throw new WorkflowStepContractError(
      "EVIDENCE_REQUIRED",
      "Este paso requiere evidencia documental o fotográfica obligatoria.",
      400
    );
  }
}

/**
 * Valida si un valor requerido está presente según la categoría del paso.
 */
export function validarValorRequerido(category: StepCategory, value: unknown): boolean {
  if (category === "INFO") {
    return true;
  }

  if (category === "PHOTO" || category === "VIDEO") {
    // La presencia de la evidencia se valida en validarEvidenciaPaso
    return true;
  }

  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (typeof value === "number") {
    return !isNaN(value);
  }

  if (typeof value === "boolean") {
    return category === "CHECKBOX" ? value === true : true;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }

  return true;
}

/**
 * Valida el tipo de dato y los límites del valor según la definición del paso.
 */
export function validarValorPorTipo(stepDef: any, value: unknown, category: StepCategory): void {
  const validation = stepDef?.validation ?? stepDef?.config?.validation;

  switch (category) {
    case "TEXT": {
      const str = String(value);
      if (validation?.min !== undefined && str.length < validation.min) {
        throw new WorkflowStepContractError(
          "VALUE_OUT_OF_BOUNDS",
          validation.customMessage || `El texto debe tener al menos ${validation.min} caracteres.`,
          400
        );
      }
      if (validation?.max !== undefined && str.length > validation.max) {
        throw new WorkflowStepContractError(
          "VALUE_OUT_OF_BOUNDS",
          validation.customMessage || `El texto no puede exceder ${validation.max} caracteres.`,
          400
        );
      }
      if (validation?.pattern) {
        try {
          const regex = new RegExp(validation.pattern);
          if (!regex.test(str)) {
            throw new WorkflowStepContractError(
              "VALUE_OUT_OF_BOUNDS",
              validation.customMessage || "El formato del texto no es válido.",
              400
            );
          }
        } catch {
          // Ignorar patrones malformados en plantillas de prueba
        }
      }
      break;
    }

    case "NUMBER": {
      const num = Number(value);
      if (isNaN(num)) {
        throw new WorkflowStepContractError(
          "INVALID_VALUE_TYPE",
          "El valor ingresado debe ser un número válido.",
          400
        );
      }
      if (validation?.min !== undefined && num < validation.min) {
        throw new WorkflowStepContractError(
          "VALUE_OUT_OF_BOUNDS",
          validation.customMessage || `El valor mínimo permitido es ${validation.min}.`,
          400
        );
      }
      if (validation?.max !== undefined && num > validation.max) {
        throw new WorkflowStepContractError(
          "VALUE_OUT_OF_BOUNDS",
          validation.customMessage || `El valor máximo permitido es ${validation.max}.`,
          400
        );
      }
      break;
    }

    case "SELECT": {
      const rawOptions = stepDef?.options ?? stepDef?.config?.options;
      const options = normalizeOptions(rawOptions);
      if (options.length > 0) {
        const valStr = String(value).trim().toLowerCase();
        const matches = options.some((opt) => opt.toLowerCase() === valStr);
        if (!matches) {
          throw new WorkflowStepContractError(
            "INVALID_OPTION",
            `La opción seleccionada "${String(value)}" no es válida.`,
            400
          );
        }
      }
      break;
    }

    case "YESNO": {
      if (typeof value !== "boolean") {
        const str = String(value).trim().toLowerCase();
        const valid = ["true", "false", "yes", "no", "si", "sí", "1", "0"];
        if (!valid.includes(str)) {
          throw new WorkflowStepContractError(
            "INVALID_VALUE_TYPE",
            "Debes seleccionar una opción válida (Sí o No).",
            400
          );
        }
      }
      break;
    }

    case "CHECKBOX": {
      if (typeof value === "string") {
        if (value !== "true" && value !== "false") {
          throw new WorkflowStepContractError(
            "INVALID_VALUE_TYPE",
            "El valor de la casilla debe ser verdadero o falso.",
            400
          );
        }
      } else if (typeof value !== "boolean" && !Array.isArray(value)) {
        throw new WorkflowStepContractError(
          "INVALID_VALUE_TYPE",
          "El valor de la casilla debe ser una selección válida.",
          400
        );
      }
      break;
    }

    case "DATE": {
      const parsed = Date.parse(String(value));
      if (isNaN(parsed)) {
        throw new WorkflowStepContractError(
          "INVALID_VALUE_TYPE",
          "La fecha ingresada no es válida.",
          400
        );
      }
      break;
    }

    case "TIME": {
      const str = String(value).trim();
      const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/;
      const isIso = !isNaN(Date.parse(str));
      if (!timeRegex.test(str) && !isIso) {
        throw new WorkflowStepContractError(
          "INVALID_VALUE_TYPE",
          "La hora ingresada debe tener un formato válido (HH:MM).",
          400
        );
      }
      if (validation?.minTime && str < validation.minTime) {
        throw new WorkflowStepContractError(
          "VALUE_OUT_OF_BOUNDS",
          validation.customMessage || `La hora no puede ser anterior a ${validation.minTime}.`,
          400
        );
      }
      if (validation?.maxTime && str > validation.maxTime) {
        throw new WorkflowStepContractError(
          "VALUE_OUT_OF_BOUNDS",
          validation.customMessage || `La hora no puede ser posterior a ${validation.maxTime}.`,
          400
        );
      }
      break;
    }

    case "TIMER": {
      const num = Number(value);
      if (isNaN(num) || num < 0) {
        throw new WorkflowStepContractError(
          "INVALID_VALUE_TYPE",
          "El tiempo registrado debe ser un número positivo.",
          400
        );
      }
      break;
    }

    default:
      break;
  }
}

/**
 * Valida la transición de estado solicitada para el paso.
 */
export function validarTransicionEstado(
  params: StepContractValidationParams,
  isRequired: boolean
): void {
  const { instance, savedStep, data, ctx } = params;

  // 1. Estado de la ejecución global
  if (instance.status === "COMPLETED" || instance.status === "CANCELLED") {
    throw new WorkflowStepContractError(
      "WORKFLOW_TERMINAL",
      "Esta ejecución ya está finalizada y no admite modificaciones en sus pasos.",
      409
    );
  }

  const currentStepStatus = savedStep?.status || "PENDING";
  const targetStatus = data.status || "COMPLETED";

  // 2. Un paso ya completado no se puede volver a poner en borrador u omitir
  if (currentStepStatus === "COMPLETED") {
    if (targetStatus === "IN_PROGRESS" || targetStatus === "SKIPPED" || targetStatus === "PENDING") {
      throw new WorkflowStepContractError(
        "STEP_ALREADY_COMPLETED",
        "Este paso ya fue completado y no puede ser omitido o reiniciado.",
        409
      );
    }
  }

  // 3. Reglas de autorización para SKIPPED
  if (targetStatus === "SKIPPED") {
    if (isRequired) {
      if (ctx.kind === "link") {
        throw new WorkflowStepContractError(
          "UNAUTHORIZED_SKIP",
          "Un enlace externo no puede omitir un paso obligatorio.",
          403
        );
      }

      if (ctx.kind === "session") {
        const actorRole = ctx.actor.role;
        if (!ROLES_SUPERVISION.includes(actorRole)) {
          throw new WorkflowStepContractError(
            "UNAUTHORIZED_SKIP",
            "Solo un supervisor o administrador puede omitir un paso obligatorio.",
            403
          );
        }

        const comentario = data.comment?.trim() || "";
        if (comentario.length === 0) {
          throw new WorkflowStepContractError(
            "SKIP_JUSTIFICATION_REQUIRED",
            "Debes indicar el motivo para omitir un paso obligatorio.",
            400
          );
        }
      }
    }
  }
}

/**
 * Validador principal del contrato del paso en servidor (C24 / H08).
 *
 * Se ejecuta en servidor ANTES de persistir cualquier cambio en `workflow_instance_steps`
 * o disparar verificaciones de IA o motores de incidentes.
 */
export function validarContratoDePaso(params: StepContractValidationParams): {
  category: StepCategory;
  isRequired: boolean;
} {
  const { stepDef, data } = params;

  if (!stepDef) {
    throw new WorkflowStepContractError(
      "STEP_NOT_FOUND",
      "No se encontró la definición de este paso.",
      404
    );
  }

  const category = getStepCategory(stepDef.type || "TEXT");
  const isRequired = Boolean(stepDef.required ?? stepDef.obligatorio);

  // Validar estado de la instancia y transiciones permitidas
  validarTransicionEstado(params, isRequired);

  const targetStatus = data.status || "COMPLETED";

  // Si se está guardando como borrador (IN_PROGRESS), permitimos almacenamiento provisional sin exigir completitud
  if (targetStatus === "IN_PROGRESS") {
    // Si viene un valor en borrador, validamos únicamente formato numérico básico si aplica
    if (data.value !== undefined && data.value !== null && category === "NUMBER") {
      const num = Number(data.value);
      if (String(data.value).trim() !== "" && isNaN(num)) {
        throw new WorkflowStepContractError(
          "INVALID_VALUE_TYPE",
          "El valor ingresado debe ser un número válido.",
          400
        );
      }
    }
    return { category, isRequired };
  }

  // Si se está omitiendo (SKIPPED), las reglas de autorización ya fueron validadas arriba
  if (targetStatus === "SKIPPED") {
    return { category, isRequired };
  }

  // Si se está completando (COMPLETED):
  if (targetStatus === "COMPLETED") {
    // 1. Validar evidencia exigida
    validarEvidenciaPaso(stepDef, data, category);

    // 2. Validar presencia si es obligatorio
    if (isRequired) {
      const tieneValor = validarValorRequerido(category, data.value);
      if (!tieneValor) {
        throw new WorkflowStepContractError(
          "REQUIRED_VALUE_MISSING",
          "El campo es obligatorio.",
          400
        );
      }
    }

    // 3. Validar tipo de dato y límites si hay un valor ingresado
    if (data.value !== undefined && data.value !== null && String(data.value).trim() !== "") {
      validarValorPorTipo(stepDef, data.value, category);
    }
  }

  return { category, isRequired };
}
