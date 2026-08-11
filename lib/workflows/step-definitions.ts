import type { StepValidation, WorkflowStep, WorkflowStepType } from "@/lib/types/workflow";

/**
 * Une la *respuesta* de una ejecución con la *pregunta* que la originó.
 *
 * `workflow_instance_steps` guarda únicamente lo que el operador registró
 * (value, comment, evidenceUrl, aiAnalysis): no tiene `title`, `type` ni orden.
 * La definición del paso vive en `workflow_templates.steps` (JSONB con forma
 * `WorkflowStep`). Sin unir ambas mitades, la revisión sólo puede mostrar
 * "Step <uuid>" y volcar el valor como JSON — que es exactamente el defecto que
 * este módulo existe para cerrar.
 *
 * Es deliberadamente puro (sin React, sin acceso a BD): la Fase 3 del plan
 * cambia la *fuente* de la definición a columnas congeladas en la instancia sin
 * que la UI se entere, y el mismo view model sirve para un futuro export.
 */

/** Opción de un SELECT/CHECKBOX ya normalizada: la plantilla las guarda de dos formas. */
export interface ReviewOption {
  value: string;
  label: string;
}

/** Veredicto de la verificación automática, tal como se guarda en `ai_analysis`. */
export interface AIVerificationData {
  passed?: boolean;
  confidence?: number;
  notes?: string;
  reason?: string;
  detectedIssues?: string;
  [key: string]: unknown;
}

/** La fila de `workflow_instance_steps` tal como la devuelve la API. */
export interface InstanceStepRecord {
  id: string;
  stepId: string;
  status: string | null;
  value: unknown;
  evidenceUrl: string | null;
  aiAnalysis: AIVerificationData | null;
  comment: string | null;
  completedAt: string | Date | null;
  completedBy?: string | null;
  /** Resuelto por `getExecution`; `null` si el usuario ya no existe. */
  completedByName?: string | null;

  // --- Definición congelada al crear la instancia (migración 0050) ---
  // Nullable: las instancias anteriores al backfill no la tienen y caen a la
  // plantilla. Cuando está, gana: es lo que se pidió *ese* día.
  stepOrder?: number | null;
  title?: string | null;
  type?: string | null;
  definition?: WorkflowStep | null;
}

/**
 * Un paso listo para revisarse: lo que se pidió + lo que se registró.
 *
 * `resolved: false` significa que la instancia ejecutó un paso cuya definición
 * ya no es localizable (plantilla editada, o paso dinámico que nunca se
 * persistió). Esos pasos se conservan —son evidencia de que algo ocurrió— y la
 * UI los degrada honestamente en vez de inventarles un título.
 */
export interface ResolvedReviewStep {
  /** ID de la fila de instancia, estable para keys de React. */
  id: string;
  /** ID del paso dentro de la plantilla. Único identificador cuando no resuelve. */
  stepId: string;
  /** Posición canónica 1..N en el flujo. */
  position: number;
  resolved: boolean;

  // --- Lo que se pidió (definición) ---
  /** `null` cuando no hay definición: la UI decide cómo rotularlo. */
  title: string | null;
  description: string | null;
  type: WorkflowStepType | null;
  unit: string | null;
  options: ReviewOption[] | null;
  required: boolean;
  /** Rango numérico esperado, ya reconciliado entre `validation` y `config`. */
  range: { min?: number; max?: number } | null;

  // --- Lo que se registró (ejecución) ---
  status: string;
  value: unknown;
  evidenceUrl: string | null;
  aiAnalysis: AIVerificationData | null;
  comment: string | null;
  completedAt: string | Date | null;
  completedByName: string | null;
}

/** `template.steps` llega como `jsonb`: puede ser cualquier cosa. */
function asTemplateSteps(templateSteps: unknown): WorkflowStep[] {
  return Array.isArray(templateSteps) ? (templateSteps as WorkflowStep[]) : [];
}

/**
 * Las opciones se guardan como `string[]` o como `{value,label}[]`, y unas veces
 * en `step.options` y otras en `step.config.options` (el executor lee la
 * segunda, `workflow-executor.tsx:349`). Se normaliza aquí, una vez.
 */
function normalizeOptions(definition: WorkflowStep | null): ReviewOption[] | null {
  const raw = definition?.options ?? (definition?.config as { options?: unknown } | undefined)?.options;
  if (!Array.isArray(raw) || raw.length === 0) return null;

  return raw.map((option) => {
    if (typeof option === "string") return { value: option, label: option };
    const record = option as { value?: unknown; label?: unknown };
    const value = String(record.value ?? "");
    return { value, label: String(record.label ?? value) };
  });
}

function toFiniteNumber(candidate: unknown): number | undefined {
  if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  if (typeof candidate === "string" && candidate.trim() !== "") {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/**
 * El rango numérico vive en dos sitios según quién creó la plantilla: el builder
 * escribe `validation.min/max` (`property-editor.tsx:183`), el stepper lee
 * `config.min/max` (`workflow-stepper.tsx:648`). `validation` gana por ser la
 * forma declarada en `WorkflowStep`; `config` es el respaldo.
 */
function normalizeRange(definition: WorkflowStep | null): { min?: number; max?: number } | null {
  const validation = definition?.validation as StepValidation | undefined;
  const config = definition?.config as { min?: unknown; max?: unknown } | undefined;

  const min = toFiniteNumber(validation?.min) ?? toFiniteNumber(config?.min);
  const max = toFiniteNumber(validation?.max) ?? toFiniteNumber(config?.max);

  if (min === undefined && max === undefined) return null;
  return { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
}

/** `unit` también admite las dos convenciones (`step.unit` y `config.unit`). */
function normalizeUnit(definition: WorkflowStep | null): string | null {
  const fromConfig = (definition?.config as { unit?: unknown } | undefined)?.unit;
  const unit = definition?.unit ?? (typeof fromConfig === "string" ? fromConfig : undefined);
  return unit && unit.trim() !== "" ? unit : null;
}

function buildResolved(
  instanceStep: InstanceStepRecord,
  definition: WorkflowStep | null,
  position: number
): ResolvedReviewStep {
  // El título congelado gana sobre el de la plantilla: si alguien editó la
  // plantilla después de ejecutar, el acta debe seguir diciendo lo que se pidió.
  const frozenTitle = instanceStep.title?.trim() ? instanceStep.title : null;
  const templateTitle = definition?.title?.trim() ? definition.title : null;

  return {
    id: instanceStep.id,
    stepId: instanceStep.stepId,
    position,
    resolved: definition !== null || frozenTitle !== null,

    // Un título vacío vale tanto como no tenerlo: se degrada igual que un paso
    // sin definición, en vez de pintar una fila sin nombre.
    title: frozenTitle ?? templateTitle,
    description: definition?.description?.trim() ? definition.description : null,
    type: ((instanceStep.type as WorkflowStepType | null | undefined) ?? definition?.type) ?? null,
    unit: normalizeUnit(definition),
    options: normalizeOptions(definition),
    required: definition?.required ?? false,
    range: normalizeRange(definition),

    status: instanceStep.status ?? "PENDING",
    value: instanceStep.value,
    evidenceUrl: instanceStep.evidenceUrl,
    aiAnalysis: instanceStep.aiAnalysis,
    comment: instanceStep.comment,
    completedAt: instanceStep.completedAt,
    completedByName: instanceStep.completedByName ?? null,
  };
}

/**
 * Devuelve los pasos de una ejecución en orden canónico, cada uno con su
 * definición unida.
 *
 * El orden lo manda el array de la plantilla, no el orden físico en Postgres:
 * `getExecution` no garantizaba ninguno y la numeración visible dependía del
 * heap. Los pasos sin definición van al final, conservando su orden relativo de
 * llegada — no se descartan nunca.
 */
export function resolveStepDefinitions(
  templateSteps: unknown,
  instanceSteps: InstanceStepRecord[]
): ResolvedReviewStep[] {
  const definitions = asTemplateSteps(templateSteps);

  // Índice del `stepId` en la plantilla: es el orden canónico cuando la
  // instancia todavía no tiene `stepOrder` congelado.
  const templateIndex = new Map<string, number>();
  const templateById = new Map<string, WorkflowStep>();
  definitions.forEach((definition, index) => {
    if (!templateIndex.has(definition.id)) templateIndex.set(definition.id, index);
    if (!templateById.has(definition.id)) templateById.set(definition.id, definition);
  });

  const ordered = instanceSteps
    .map((instanceStep, arrivalIndex) => {
      // La definición congelada gana; la plantilla es el respaldo para las
      // instancias anteriores al backfill.
      const definition = instanceStep.definition ?? templateById.get(instanceStep.stepId) ?? null;

      // Los pasos sin ninguna referencia de orden van al final, conservando su
      // orden de llegada: no se descartan nunca, son evidencia de que algo se
      // ejecutó.
      const order =
        typeof instanceStep.stepOrder === "number"
          ? instanceStep.stepOrder
          : templateIndex.get(instanceStep.stepId) ?? Number.MAX_SAFE_INTEGER;

      return { instanceStep, definition, order, arrivalIndex };
    })
    .sort((a, b) => (a.order - b.order) || (a.arrivalIndex - b.arrivalIndex));

  return ordered.map((entry, index) =>
    buildResolved(entry.instanceStep, entry.definition, index + 1)
  );
}

/**
 * Un paso "requiere atención" si la IA lo reprobó, si terminó mal, o si el
 * operador dejó una nota. En HORECA esa nota suele cargar la discrepancia que
 * alimenta el reporte de recepción, por eso cuenta como hallazgo aunque el paso
 * haya quedado COMPLETED (decisión #3 del plan anterior, conservada).
 */
export function stepNeedsAttention(step: ResolvedReviewStep): boolean {
  if (step.aiAnalysis && step.aiAnalysis.passed === false) return true;
  if (step.status === "FAILED" || step.status === "REJECTED") return true;
  if (step.comment && step.comment.trim() !== "") return true;
  return false;
}

/** Un paso sólo tiene respuesta si llegó a completarse. */
export function stepWasAnswered(step: ResolvedReviewStep): boolean {
  return step.status === "COMPLETED";
}
