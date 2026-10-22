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
  // C14 — parámetros que los motores ya consumían sin editor.
  vatRatePercent?: string | null;
  laborBurdenFactorPercent?: string | null;
  payrollStateTaxPercent?: string | null;
  mermaVarianceThresholdPct?: string | null;
  // Task 10 plan-aguinaldo — práctica de nómina y base del aguinaldo.
  payrollPracticeMode?: string | null;
  aguinaldoBase?: string | null;
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

/**
 * Parámetros fiscales/laborales/merma (C14). El vacío NO es un default: es el
 * estado `null` con su propio efecto en el consumidor, y por eso no reutiliza
 * `percentAPorcentajeEntero` — ese helper convierte `null` en el fallback, que
 * aquí sería mentir (vaciar el IVA apagaría la estimación, no la pondría en 16).
 */
export interface FiscalParamsValues {
  /** Tasa de IVA estimada (%). Vacío = `null` = no estimar, base bruta. */
  vatRate: string;
  /** Carga patronal sobre bruto (%). Vacío = `null` = nómina bruta. */
  laborBurden: string;
  /** ISN estatal (%). Vacío = `null` = no se suma. */
  stateTax: string;
  /** Umbral de varianza de conteo (%). Vacío = `null` = 5% del sistema. */
  mermaThreshold: string;
  /** Práctica de nómina. "" = `null` = FORMAL (comportamiento actual). */
  payrollPracticeMode: string;
  /** Base del aguinaldo. "" = `null` = REGISTERED (salario de registro). */
  aguinaldoBase: string;
}

export interface OperatingConfigFormState {
  dimensions: OperatingDimensionsValues;
  thresholds: FinancialThresholdsValues;
  costTargets: CostTargetsValues;
  fiscal: FiscalParamsValues;
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

/**
 * `numeric(5,2)` a texto de input para un parámetro con estado `null` real.
 *
 * `null` guardado → vacío (el estado apagado se muestra apagado);
 * `undefined` → `porDefecto` (la empresa no tiene fila o el campo nunca se
 * escribió); cualquier otro valor se normaliza a número sin caer a defaults.
 */
function percentONulo(raw: string | number | null | undefined, porDefecto: string): string {
  if (raw === null) return "";
  if (raw === undefined || raw === "") return porDefecto;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? String(parsed) : porDefecto;
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
    fiscal: {
      // Los defaults coinciden con `DEFAULT_TENANT_OPERATING_CONFIG`: IVA 16 y
      // merma 5; carga e ISN no tienen default porque son captura del grupo.
      vatRate: percentONulo(config?.vatRatePercent, "16"),
      laborBurden: percentONulo(config?.laborBurdenFactorPercent, ""),
      stateTax: percentONulo(config?.payrollStateTaxPercent, ""),
      mermaThreshold: percentONulo(config?.mermaVarianceThresholdPct, "5"),
      // Task 10: "" = `null` = default (FORMAL / REGISTERED). FORMAL guardado
      // explícito se muestra como "" — comportamentalmente son el mismo estado.
      payrollPracticeMode:
        config?.payrollPracticeMode === "MIXED" ? "MIXED" : "",
      aguinaldoBase:
        config?.aguinaldoBase === "EFFECTIVE" ? "EFFECTIVE" : "",
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
  vatRatePercent: number | null;
  laborBurdenFactorPercent: number | null;
  payrollStateTaxPercent: number | null;
  mermaVarianceThresholdPct: number | null;
  payrollPracticeMode: string | null;
  aguinaldoBase: string | null;
}

export function cuerpoDeConfiguracion(state: OperatingConfigFormState): ConfigBody {
  const { dimensions, thresholds, costTargets, fiscal } = state;
  const porcentaje = (raw: string) => {
    // `Number("")` es 0, no NaN: un objetivo vacío se guardaría como cero
    // justo cuando el operador quería quitarlo, y "sin objetivo" no existe en
    // el contrato — se escribe explícitamente.
    const trimmed = raw.trim();
    if (trimmed === "") return NaN;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : NaN;
  };
  /** Vacío = `null` apagado; texto no numérico = `NaN` bloquea el guardado. */
  const porcentajeONulo = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
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
    vatRatePercent: porcentajeONulo(fiscal.vatRate),
    laborBurdenFactorPercent: porcentajeONulo(fiscal.laborBurden),
    payrollStateTaxPercent: porcentajeONulo(fiscal.stateTax),
    mermaVarianceThresholdPct: porcentajeONulo(fiscal.mermaThreshold),
    // Vacío = `null` = default del inquilino; nunca se escribe "FORMAL"/"REGISTERED"
    // explícito porque el estado default ya significa eso.
    payrollPracticeMode: fiscal.payrollPracticeMode.trim() === "" ? null : fiscal.payrollPracticeMode,
    aguinaldoBase: fiscal.aguinaldoBase.trim() === "" ? null : fiscal.aguinaldoBase,
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
