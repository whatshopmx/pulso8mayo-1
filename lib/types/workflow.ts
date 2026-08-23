export type WorkflowStepType =
 | "TEXT" | "NUMBER" | "SELECT" | "PHOTO" | "CHECKBOX"
 | "DATE" | "INFO" | "SIGNATURE"
 | "YESNO" | "TIME" | "TIMER" | "LOCATION" | "AUDIO" | "VIDEO" | "ENTITY_SELECT";

export interface AIVerification {
  enabled: boolean;
  prompt?: string;
  expectedConditions?: string[];
  confidenceThreshold?: number;
}

export interface LogicRule {
  id?: string;
  condition: string;
  severity: string;
  message: string;
  remediationProtocol?: {
    enabled: boolean;
    maxAttempts?: number;
    timeoutMinutes?: number;
    steps?: Array<{ instruction: string; waitSeconds?: number }>;
  };
  escalationChain?: Array<{
    level: number;
    triggerAfterMinutes: number;
    notifyRoles?: string[];
    channel: string;
    message: string;
  }>;
}

export interface Branch {
  condition: string;
  gotoStep?: string;
  label?: string;
}

export interface StepValidation {
  min?: number;
  max?: number;
  minTime?: string;
  maxTime?: string;
  radiusMeters?: number;
  pattern?: string;
  customMessage?: string;
}

/**
 * Entidades que el resolver de pasos dinámicos sabe expandir.
 * Ver `lib/workflows/dynamic-steps.ts`.
 */
export type DynamicSourceEntity = "inventory_item" | "recipe" | "purchase_order_item";

export interface DynamicSourceFilter {
  /** Sólo SKUs marcados 80/20. Únicamente para `inventory_item`. */
  isHighValue?: boolean;
  /** Categoría exacta del item. Únicamente para `inventory_item`. */
  category?: string;
  /** El item debe contener TODAS estas etiquetas. Únicamente para `inventory_item`. */
  tags?: string[];
  /** Por defecto `true`. Únicamente para `inventory_item`. */
  active?: boolean;
  /**
   * OC cuyas líneas alimentan la expansión. Requerido para
   * `purchase_order_item`; normalmente viaja en el contexto de creación de la
   * instancia (la OC se elige al lanzar, no dentro del workflow) y este campo
   * queda como override explícito del template.
   */
  purchaseId?: string;
}

/**
 * Declarado en `WorkflowStep.metadata`, NO como miembro de `WorkflowStepType`:
 * el paso plantilla se expande a N sub-pasos del mismo tipo (ya soportado por
 * todos los renderers) en vez de introducir un tipo nuevo en una unión cerrada
 * que está duplicada en 7 archivos.
 */
export interface DynamicSource {
  entity: DynamicSourceEntity;
  filter?: DynamicSourceFilter;
  /**
   * Tope de sub-pasos que genera este paso. Por defecto
   * `MAX_DYNAMIC_STEPS` (30), el mismo que ya respeta el conteo 80/20 (A10).
   * Se declara por paso porque una expansión sobre recetas no tiene por qué
   * compartir el límite de los SKUs de alto valor.
   */
  limit?: number;
}

export interface WorkflowStep {
  id: string;
  type: WorkflowStepType;
  title: string;
  description?: string;
  required: boolean;
  config?: any;
  unit?: string;
  metadata?: Record<string, any> & { dynamicSource?: DynamicSource; entityType?: "purchase_order" | "invoice" };
  aiVerification?: AIVerification;
  logicRules?: LogicRule[];
  branches?: Branch[];
  validation?: StepValidation;
  readOnly?: boolean;
  conditionalLogic?: any;
  options?: string[];
  placeholder?: string;
  defaultValue?: string;
}

export interface WorkflowTemplateData {
  title: string;
  description?: string;
  category: string;
  steps: WorkflowStep[];
  aiConfig?: any;
  complianceConfig?: any;
  completionActions?: any[];
  tags?: string[];
  duracionEstimada?: string;
}
