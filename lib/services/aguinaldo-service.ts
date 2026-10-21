/**
 * Servicio puro de cálculo del aguinaldo proporcional por antigüedad.
 *
 * Fórmula legal vigente (LFT Art. 87, en vigor desde 1970):
 *
 *   díasAguinaldo = aguinaldoDaysMxn / 365 × díasTrabajadosEnElAñoFiscal
 *   bruto         = diasAguinaldo × salarioDiarioORDINARIO
 *   exento        = min(bruto, 30 × UMA diaria vigente al pago)   [transitorios LISR frs. XIV]
 *   gravado       = bruto − exento
 *
 * Reglas de la investigación 2026-10-20 (tasks/plan-aguinaldo.md):
 *   • Base de cálculo: salario ORDINARIO del contrato únicamente. Las
 *     propinas (CFDI clave 038) NO son salario y NO entran al aguinaldo;
 *     las comisiones deben vivir en el salarial del contrato
 *     (Jurisprudencia 1a./J. 24/2023 para la base). El promedio de 30
 *     días del Art. 89 LFT (destajo) queda como override futuro.
 *   • La exención de 30 UMA NO se prorratea: se aplica sobre el bruto.
 *   • La cifra de días proviene de la ley por fecha
 *     (`labor-rules-resolver` → aguinaldoDaysMxn; hoy 15). Los 30 días
 *     progresivos por antigüedad son PENDING_INITIATIVE (catálogo
 *     `AGUINALDO_30_DIAS`) y solo pueden usarse como proyección.
 *   • Días trabajados: los faltas/permisos sin goce/SL general NO
 *     cuentan; vacaciones, festivos, riesgo de trabajo, maternidad y
 *     paternidad SÍ (criterio PROFEDET). El conteo automático no existe
 *     aún — `diasLaborados` llega manual (columna editable de la
 *     preview) y el fallback son días calendario del año fiscal desde
 *     la fecha de antigüedad.
 *
 * Función inofensiva: no toca DB, no importa providers. Montos en
 * CENTAVOS enteros (convención del repo). Idempotente y testeable.
 */
import { getReformStatus, type LaborReformStatus } from "@/lib/company/labor-reform-status-catalog";
import { AGUINALDO_DAYS_VIGENTE } from "@/lib/company/labor-reform-status-catalog";

/** Días calendario que abarca el año fiscal (365 fijo — denominador legal del prorrateo). */
export const DIAS_PRORRATEO = 365;

/** Fracción exenta del aguinaldo: 30 UMA diarias (LISR Art. 93 fr. XIV / transitorios). */
export const EXENCION_UMAS = 30;

export type AguinaldoBase = "REGISTERED" | "EFFECTIVE";

export interface AguinaldoLegalEstatus {
    /** LEY_VIGENTE = Art. 87 (15 días). PROYECCION = config explícita > 15 (no alegable). */
    fuente: "LEY_VIGENTE" | "PROYECCION";
    basis: string;
    /** Días usados contra el marco legal vigente (15 hoy). */
    diasLegalesVigente: number;
}

export interface CalcularAguinaldoAnualInput {
    /** Año natural causado (ENE 1 – DIC 31) — Art. 87 prorratea "en el año". */
    anioFiscal: number;
    /** Salario diario ORDINARIO del contrato, en centavos (nunca incluye propinas). */
    salarioDiarioCents: number;
    /** Fecha de antigüedad "YYYY-MM-DD" (employeeProfiles.seniorityDate ?? hireDate). */
    seniorityDate?: string;
    /** Días trabajados en el año fiscal (override manual con criterio PROFEDET ya aplicado). */
    diasLaborados?: number;
    /** Días de aguinaldo resueltos de la ley por fecha (resolver.aguinaldoDaysMxn). Default 15. */
    aguinaldoDaysMxn?: number;
    /** UMA diaria vigente al pago en centavos; si falta, NO se aplica exención (todo gravado). */
    umaDailyCents?: number | null;
    /** Base salarial a usar (Config de Task 11: REGISTERED default; EFFECTIVE = sub-registro). */
    base?: AguinaldoBase;
}

export interface AguinaldoCalculo {
    anioFiscal: number;
    base: AguinaldoBase;
    /** Días calendario de referencia del año fiscal (para auditar el override manual). */
    diasCalendario: number;
    /** Días usados para el prorrateo (override manual si viene; calendar otherwise). */
    diasLaborados: number;
    fuenteDias: "MANUAL" | "CALENDARIO";
    /** Primas: diasAguinaldo fraccional = days/365 × diasLaborados (sin redondeo). */
    diasAguinaldo: number;
    brutoCents: number;
    exentoCents: number;
    gravadoCents: number;
    /** Cap de exención usado (30 × UMA) en centavos, o null si no había UMA resuelta. */
    exencionCapCents: number | null;
    aguinaldoDaysMxn: number;
    estatusLegal: AguinaldoLegalEstatus;
}

/** Días calendario entre dos fechas ISO inclusivas (mediodía UTC para evitar drift). */
function diasCalendarioInclusive(desdeISO: string | null, hastaISO: string): number {
    if (!desdeISO) return 0;
    const desde = new Date(desdeISO.slice(0, 10) + "T12:00:00Z");
    const hasta = new Date(hastaISO.slice(0, 10) + "T12:00:00Z");
    return Math.round((hasta.getTime() - desde.getTime()) / 86_400_000) + 1;
}

/**
 * Fallback de días trabajados: calendario COMPLETO del año fiscal desde la
 * fecha de antigüedad (el aguinaldo anual se paga por el año; para un año
 * futuro cuenta 0). El ajuste fino por faltas/incapacidades es el override
 * manual `diasLaborados` (criterio PROFEDET aplicado por el admin). Cuando
 * exista el conteo automático (Task 14) llenará esa columna.
 */
export function diasCalendarioAguinaldo(
    anioFiscal: number,
    seniorityDate?: string
): number {
    if (!seniorityDate) return 0;
    const anioISO = String(anioFiscal);
    const desde = seniorityDate > anioISO + "-12-31" ? null : maxISO(seniorityDate, anioISO + "-01-01");
    if (!desde) return 0;
    const hasta = anioISO + "-12-31";
    return diasCalendarioInclusive(desde, hasta);
}

function maxISO(a: string, b: string): string {
    return a.slice(0, 10) > b.slice(0, 10) ? a.slice(0, 10) : b.slice(0, 10);
}

/** Estatus legal según el catálogo de reformas [H04]. */
export function resolverEstatusLegal(aguinaldoDaysMxn: number): AguinaldoLegalEstatus {
    const vigente = AGUINALDO_DAYS_VIGENTE;
    const entry: LaborReformStatus | undefined = getReformStatus("AGUINALDO_30_DIAS");
    if (aguinaldoDaysMxn > vigente) {
        return {
            fuente: "PROYECCION",
            basis: entry?.basis ?? `Más de ${vigente} días NO es ley (solo iniciativa).`,
            diasLegalesVigente: vigente,
        };
    }
    return {
        fuente: "LEY_VIGENTE",
        basis: "LFT Art. 87 (vigente): 15 días de salario por año cumplido, prorrateados por tiempo trabajado en el año.",
        diasLegalesVigente: vigente,
    };
}

/**
 * Cálculo puro del aguinaldo anual. Lanza RangeError ante inputs
 * imposibles (debe ser imposible timbrar un CFDI de aguinaldo inválido).
 */
export function calcularAguinaldoAnual(input: CalcularAguinaldoAnualInput): AguinaldoCalculo {
    const {
        anioFiscal,
        salarioDiarioCents,
        seniorityDate,
        diasLaborados,
        aguinaldoDaysMxn = AGUINALDO_DAYS_VIGENTE,
        umaDailyCents = null,
        base = "REGISTERED",
    } = input;

    if (!Number.isInteger(anioFiscal) || anioFiscal < 1970 || anioFiscal > 2200) {
        throw new RangeError(`anioFiscal inválido: ${anioFiscal}`);
    }
    if (!Number.isFinite(salarioDiarioCents) || salarioDiarioCents < 0) {
        throw new RangeError(`salarioDiarioCents inválido: ${salarioDiarioCents}`);
    }
    if (diasLaborados !== undefined && (!Number.isInteger(diasLaborados) || diasLaborados < 0 || diasLaborados > DIAS_PRORRATEO + 1)) {
        throw new RangeError(`diasLaborados inválido (0..${DIAS_PRORRATEO + 1}): ${diasLaborados}`);
    }

    const diasCalendario = diasCalendarioAguinaldo(anioFiscal, seniorityDate);
    const fuenteDias: AguinaldoCalculo["fuenteDias"] = diasLaborados !== undefined && diasLaborados !== diasCalendario ? "MANUAL" : "CALENDARIO";
    const diasUsados = diasLaborados ?? diasCalendario;

    const diasAguinaldo = (aguinaldoDaysMxn / DIAS_PRORRATEO) * diasUsados;
    const brutoCents = Math.round(diasAguinaldo * salarioDiarioCents);

    const exencionCapCents = umaDailyCents != null ? Math.round(EXENCION_UMAS * umaDailyCents) : null;
    const exentoCents = exencionCapCents !== null ? Math.min(brutoCents, exencionCapCents) : 0;
    const gravadoCents = brutoCents - exentoCents;

    return {
        anioFiscal,
        base,
        diasCalendario,
        diasLaborados: diasUsados,
        fuenteDias,
        diasAguinaldo,
        brutoCents,
        exentoCents,
        gravadoCents,
        exencionCapCents,
        aguinaldoDaysMxn,
        estatusLegal: resolverEstatusLegal(aguinaldoDaysMxn),
    };
}
