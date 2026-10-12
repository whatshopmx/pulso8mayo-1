import { DEFAULT_FINANCIAL_TARGETS } from "@/lib/services/financial-kpi-types";

/**
 * Ida y vuelta del formulario de modelo operativo (C13).
 *
 * Estas conversiones estaban dentro del componente, así que no había forma de
 * comprobar que un valor guardado sobreviviera al viaje. Dos cosas se perdían:
 *
 * - `initialConfig?.managerAuthLimitCents || 100000` convertía un cero
 *   guardado en el default. El umbral "cero" y "sin valor" son estados
 *   distintos y el operador que puso cero veía $1,000 al recargar.
 * - Un campo de monto vacío se mandaba como `parseFloat("") * 100` → `NaN` →
 *   `null` en el JSON, que el PUT rechazaba como "expected number". Y el
 *   contrato de los umbrales dice que `null` significa "sin tope", no "cero".
 *
 * El mapeo vive aquí, sin React ni Drizzle, para poder comprobarlo en V1.
 */

export interface OperatingConfigValues {
  purchasingStructure?: string;
  foodProduction?: string;
  treasuryModel?: string;
  supplierPayment?: string;
  managerAutonomy?: string;
  payrollDispersion?: string;
  tenantType?: string;
  managerAuthLimitCents?: number | null;
  doubleApprovalThresholdCents?: number | null;
  pettyCashLimitCents?: number | null;
  emergencyPurchaseCapCents?: number | null;
  courtesyWasteMonthlyCapCents?: number | null;
  foodCostTargetPercent?: string | null;
  foodCostWarnPercent?: string | null;
  laborCostTargetPercent?: string | null;
  laborCostWarnPercent?: string | null;
  healthyMarginTargetPercent?: string | null;
  healthyMarginWarnPercent?: string | null;
}

export interface OperatingDimensionsValues {
  purchasingStructure: string;
  foodProduction: string;
  treasuryModel: string;
  supplierPayment: string;
  managerAutonomy: string;
  payrollDispersion: string;
  tenantType: string;
}

export interface FinancialThresholdsValues {
  managerAuthLimit: string;
  doubleApprovalThreshold: string;
  pettyCashLimit: string;
  emergencyCap: string;
  courtesyWasteCap: string;
}

export interface CostTargetsValues {
  foodTarget: string;
  foodWarn: string;
  laborTarget: string;
  laborWarn: string;
  marginTarget: string;
  marginWarn: string;
}

export interface OperatingConfigFormState {
  dimensions: OperatingDimensionsValues;
  thresholds: FinancialThresholdsValues;
  costTargets: CostTargetsValues;
}

/** Defaults de módulo para una empresa sin fila; coinciden con el servicio. */
const DIMENSION_DEFAULTS: OperatingDimensionsValues = {
  purchasingStructure: "CENTRALIZADA",
  foodProduction: "IN_SITU",
  treasuryModel: "CUENTA_UNICA",
  supplierPayment: "CENTRALIZADO",
  managerAutonomy: "MEDIA",
  payrollDispersion: "CONSOLIDADA",
  tenantType: "GRUPO_PROPIO",
};

/** Defaults para empresas sin valores registrados; null conserva "sin tope". */
const REQUIRED_THRESHOLD_DEFAULTS = {
  managerAuthLimitCents: 100000,
  doubleApprovalThresholdCents: 1000000,
  pettyCashLimitCents: 500000,
} as const;

/**
 * Centavos a pesos para el input. `null` es "sin tope" y se muestra vacío; un
 * cero guardado es un cero guardado y se muestra como tal.
 */
export function centavosAPesos(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toString();
}

/** Inversa de `centavosAPesos`. Sólo vacío es `null` (sin tope). */
export function pesosACentavos(pesos: string): number | null {
  const trimmed = pesos.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return NaN;
  return Math.round(parsed * 100);
}

/** Un porcentaje guardado es `numeric` → string; sólo `null`/vacío es ausencia. */
function percentAPorcentajeEntero(raw: string | number | null | undefined, fallback: number): string {
  if (raw === null || raw === undefined || raw === "") return String(fallback);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? String(parsed) : String(fallback);
}

export function valoresIniciales(config: OperatingConfigValues | null): OperatingConfigFormState {
  const value = <T,>(guardado: T, porDefecto: T): T =>
    guardado === null || guardado === undefined ? porDefecto : guardado;

  return {
    dimensions: {
      purchasingStructure: value(config?.purchasingStructure, DIMENSION_DEFAULTS.purchasingStructure),
      foodProduction: value(config?.foodProduction, DIMENSION_DEFAULTS.foodProduction),
      treasuryModel: value(config?.treasuryModel, DIMENSION_DEFAULTS.treasuryModel),
      supplierPayment: value(config?.supplierPayment, DIMENSION_DEFAULTS.supplierPayment),
      managerAutonomy: value(config?.managerAutonomy, DIMENSION_DEFAULTS.managerAutonomy),
      payrollDispersion: value(config?.payrollDispersion, DIMENSION_DEFAULTS.payrollDispersion),
      tenantType: value(config?.tenantType, DIMENSION_DEFAULTS.tenantType),
    },
    thresholds: {
      managerAuthLimit: centavosAPesos(
        config?.managerAuthLimitCents === undefined ? REQUIRED_THRESHOLD_DEFAULTS.managerAuthLimitCents : config.managerAuthLimitCents
      ),
      doubleApprovalThreshold: centavosAPesos(
        config?.doubleApprovalThresholdCents === undefined ? REQUIRED_THRESHOLD_DEFAULTS.doubleApprovalThresholdCents : config.doubleApprovalThresholdCents
      ),
      pettyCashLimit: centavosAPesos(
        config?.pettyCashLimitCents === undefined ? REQUIRED_THRESHOLD_DEFAULTS.pettyCashLimitCents : config.pettyCashLimitCents
      ),
      // Los dos topes opcionales no tienen default: "sin tope" es su estado inicial.
      emergencyCap: centavosAPesos(config?.emergencyPurchaseCapCents),
      courtesyWasteCap: centavosAPesos(config?.courtesyWasteMonthlyCapCents),
    },
    costTargets: {
      foodTarget: percentAPorcentajeEntero(config?.foodCostTargetPercent, DEFAULT_FINANCIAL_TARGETS.foodCostTargetPercent),
      foodWarn: percentAPorcentajeEntero(config?.foodCostWarnPercent, DEFAULT_FINANCIAL_TARGETS.foodCostWarnPercent),
      laborTarget: percentAPorcentajeEntero(config?.laborCostTargetPercent, DEFAULT_FINANCIAL_TARGETS.laborCostTargetPercent),
      laborWarn: percentAPorcentajeEntero(config?.laborCostWarnPercent, DEFAULT_FINANCIAL_TARGETS.laborCostWarnPercent),
      marginTarget: percentAPorcentajeEntero(config?.healthyMarginTargetPercent, DEFAULT_FINANCIAL_TARGETS.healthyMarginTargetPercent),
      marginWarn: percentAPorcentajeEntero(config?.healthyMarginWarnPercent, DEFAULT_FINANCIAL_TARGETS.healthyMarginWarnPercent),
    },
  };
}

/**
 * Cuerpo del PUT. `NaN` marca un dato inválido: camposInvalidos impide enviarlo,
 * porque JSON.stringify lo convertiría en null y quitaría el tope.
 */
export interface ConfigBody {
  [campo: string]: string | number | null;
  managerAuthLimitCents: number | null;
  doubleApprovalThresholdCents: number | null;
  pettyCashLimitCents: number | null;
  emergencyPurchaseCapCents: number | null;
  courtesyWasteMonthlyCapCents: number | null;
  foodCostTargetPercent: number;
  foodCostWarnPercent: number;
  laborCostTargetPercent: number;
  laborCostWarnPercent: number;
  healthyMarginTargetPercent: number;
  healthyMarginWarnPercent: number;
}

export function cuerpoDeConfiguracion(state: OperatingConfigFormState): ConfigBody {
  const { dimensions, thresholds, costTargets } = state;
  const porcentaje = (raw: string) => {
    // `Number("")` es 0, no NaN: un objetivo vacío se guardaría como cero
    // justo cuando el operador quería quitarlo, y "sin objetivo" no existe en
    // el contrato — se escribe explícitamente.
    const trimmed = raw.trim();
    if (trimmed === "") return NaN;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : NaN;
  };
  return {
    ...dimensions,
    managerAuthLimitCents: pesosACentavos(thresholds.managerAuthLimit),
    doubleApprovalThresholdCents: pesosACentavos(thresholds.doubleApprovalThreshold),
    pettyCashLimitCents: pesosACentavos(thresholds.pettyCashLimit),
    emergencyPurchaseCapCents: pesosACentavos(thresholds.emergencyCap),
    courtesyWasteMonthlyCapCents: pesosACentavos(thresholds.courtesyWasteCap),
    foodCostTargetPercent: porcentaje(costTargets.foodTarget),
    foodCostWarnPercent: porcentaje(costTargets.foodWarn),
    laborCostTargetPercent: porcentaje(costTargets.laborTarget),
    laborCostWarnPercent: porcentaje(costTargets.laborWarn),
    healthyMarginTargetPercent: porcentaje(costTargets.marginTarget),
    healthyMarginWarnPercent: porcentaje(costTargets.marginWarn),
  };
}

/** Campos que el formulario no puede mandar porque no son un número. */
export function camposInvalidos(state: OperatingConfigFormState): string[] {
  const body = cuerpoDeConfiguracion(state);
  return Object.entries(body)
    .filter(([, value]) => typeof value === "number" && !Number.isFinite(value))
    .map(([campo]) => campo);
}

/** De un error del servidor (`error.details.fieldErrors`) a campo del formulario. */
export function erroresPorCampo(details: unknown): Record<string, string> {
  const fieldErrors = (details as { fieldErrors?: Record<string, string[] | undefined> } | undefined)?.fieldErrors;
  if (!fieldErrors) return {};
  const mensajes: Record<string, string> = {};
  for (const [campo, lista] of Object.entries(fieldErrors)) {
    const primero = lista?.[0];
    if (primero) mensajes[campo] = primero;
  }
  return mensajes;
}
