/**
 * Retención de ISR del aguinaldo — Art. 174 RLISR (Task 13, decisión Q1).
 *
 * El Art. 174 es un método OPCIONAL de retención mensual, distinto del ajuste
 * anual. Se separa primero la parte exenta (Art. 93 XIV LISR / 151 RLISR).
 * La remuneración GRAVADA se lleva a un "mes hipotético" y se obtiene la diferencia entre
 * dos cálculos de tarifa mensual del Art. 96, ANTES del subsidio:
 *
 *   I.   ingresoHipotético = (remuneración gravada / 365) × 30.4
 *   II.  ISR_a = Art. 96(ingresoHipotético + ingreso ordinario mensual)
 *   III. ISR_b = Art. 96(ingreso ordinario mensual solo)
 *        impuestoAtribuible = max(0, ISR_a − ISR_b)
 *   V.   tasaEfectiva = impuestoAtribuible / ingresoHipotético
 *   IV.  RETENCIÓN = tasaEfectiva × remuneración gravada (sin otras deducciones).
 *
 * Fuentes (2026): Anexo 8 RMF 2026 (DOF 28-dic-2025): tarifa mensual
 * apartado B fr. V, anual apartado C fr. II. Subsidio al empleo: Decreto
 * DOF 31-dic-2025 (15.02% × UMA mensual desde febrero; 15.59% para enero
 * por la UMA anual en vigor hasta ene-2026); tope de $11,492.66 mensuales.
 *
 * La tarifa anual del Art. 152 se exporta como dato; no implementa el ajuste
 * anual. El método 174 usa la mensual y exige coincidencia exacta del año.
 * El subsidio se acredita una sola vez contra el ISR del mes real, después de
 * obtener la tasa. El retiro de un beneficio del ordinario se informa aparte:
 * jamás se multiplica por el factor del Art. 174.
 *
 * Montos en CENTAVOS enteros (convención del repo). Sin DB, sin providers.
 */

export interface TramoTarifa {
    /** Límite inferior de la base gravable (centavos). */
    limiteInferiorCents: number;
    /** Límite superior (centavos); Infinity para el último renglón. */
    limiteSuperiorCents: number;
    /** Cuota fija del renglón (centavos). */
    cuotaFijaCents: number;
    /** Tasa sobre el excedente del límite inferior (%). */
    tasaPorcentaje: number;
}

/** Tarifa mensual Art. 96 LISR 2026 (Anexo 8 RMF 2026, apartado B fr. V). */
export const TARIFA_MENSUAL_2026: TramoTarifa[] = [
    { limiteInferiorCents: 0, limiteSuperiorCents: 84_459, cuotaFijaCents: 0, tasaPorcentaje: 1.92 },
    { limiteInferiorCents: 84_460, limiteSuperiorCents: 716_851, cuotaFijaCents: 1_622, tasaPorcentaje: 6.40 },
    { limiteInferiorCents: 716_852, limiteSuperiorCents: 1_259_802, cuotaFijaCents: 42_095, tasaPorcentaje: 10.88 },
    { limiteInferiorCents: 1_259_803, limiteSuperiorCents: 1_464_464, cuotaFijaCents: 101_168, tasaPorcentaje: 16.00 },
    { limiteInferiorCents: 1_464_465, limiteSuperiorCents: 1_753_364, cuotaFijaCents: 133_914, tasaPorcentaje: 17.92 },
    { limiteInferiorCents: 1_753_365, limiteSuperiorCents: 3_536_283, cuotaFijaCents: 185_684, tasaPorcentaje: 21.36 },
    { limiteInferiorCents: 3_536_284, limiteSuperiorCents: 5_573_668, cuotaFijaCents: 566_516, tasaPorcentaje: 23.52 },
    { limiteInferiorCents: 5_573_669, limiteSuperiorCents: 10_641_050, cuotaFijaCents: 1_045_709, tasaPorcentaje: 30.00 },
    { limiteInferiorCents: 10_641_051, limiteSuperiorCents: 14_188_066, cuotaFijaCents: 2_565_923, tasaPorcentaje: 32.00 },
    { limiteInferiorCents: 14_188_067, limiteSuperiorCents: 42_564_199, cuotaFijaCents: 3_700_969, tasaPorcentaje: 34.00 },
    { limiteInferiorCents: 42_564_200, limiteSuperiorCents: Infinity, cuotaFijaCents: 13_348_854, tasaPorcentaje: 35.00 },
];

/** Tarifa anual Art. 152 LISR 2026 (Anexo 8 RMF 2026, apartado C fr. II). */
export const TARIFA_ANUAL_2026: TramoTarifa[] = [
    { limiteInferiorCents: 0, limiteSuperiorCents: 1_013_511, cuotaFijaCents: 0, tasaPorcentaje: 1.92 },
    { limiteInferiorCents: 1_013_512, limiteSuperiorCents: 8_602_211, cuotaFijaCents: 19_459, tasaPorcentaje: 6.40 },
    { limiteInferiorCents: 8_602_212, limiteSuperiorCents: 15_117_619, cuotaFijaCents: 505_137, tasaPorcentaje: 10.88 },
    { limiteInferiorCents: 15_117_620, limiteSuperiorCents: 17_573_566, cuotaFijaCents: 1_214_013, tasaPorcentaje: 16.00 },
    { limiteInferiorCents: 17_573_567, limiteSuperiorCents: 21_040_369, cuotaFijaCents: 1_606_964, tasaPorcentaje: 17.92 },
    { limiteInferiorCents: 21_040_370, limiteSuperiorCents: 42_435_397, cuotaFijaCents: 2_228_214, tasaPorcentaje: 21.36 },
    { limiteInferiorCents: 42_435_398, limiteSuperiorCents: 66_884_014, cuotaFijaCents: 6_798_192, tasaPorcentaje: 23.52 },
    { limiteInferiorCents: 66_884_015, limiteSuperiorCents: 127_692_598, cuotaFijaCents: 12_548_507, tasaPorcentaje: 30.00 },
    { limiteInferiorCents: 127_692_599, limiteSuperiorCents: 170_256_797, cuotaFijaCents: 30_791_081, tasaPorcentaje: 32.00 },
    { limiteInferiorCents: 170_256_798, limiteSuperiorCents: 510_770_392, cuotaFijaCents: 44_411_623, tasaPorcentaje: 34.00 },
    { limiteInferiorCents: 510_770_393, limiteSuperiorCents: Infinity, cuotaFijaCents: 160_186_246, tasaPorcentaje: 35.00 },
];

/** Subsidio para el empleo 2026 (Decreto DOF 31-dic-2025). */
export const SUBSIDIO_EMPLEO_2026 = {
    /** Tope del ingreso mensual que sirve de base para el impuesto. */
    topeIngresoMensualCents: 1_149_266, // $11,492.66
    /** Febrero–diciembre: 15.02% × UMA mensual 2026 ($3,566.22) = $535.65. */
    subsidioMensualCents: 53_565,
    /** Enero especial: 15.59% × UMA mensual 2025 ($3,439.46) = $536.21. */
    subsidioEneroCents: 53_621,
};

interface TarifaAnio {
    anio: number;
    mensual: TramoTarifa[];
    anual: TramoTarifa[];
    subsidio: typeof SUBSIDIO_EMPLEO_2026;
    fuente: string;
}

const TARIFAS_POR_ANIO: TarifaAnio[] = [
    {
        anio: 2026,
        mensual: TARIFA_MENSUAL_2026,
        anual: TARIFA_ANUAL_2026,
        subsidio: SUBSIDIO_EMPLEO_2026,
        fuente:
            "Anexo 8 RMF 2026 (DOF 28-dic-2025); subsidio al empleo: Decreto DOF 31-dic-2025 (15.02% × UMA mensual; enero 15.59%).",
    },
];

/** Tabla publicada para el año exacto; sin fallback a otro ejercicio. */
export function resolverTarifaParaAnio(anio: number): TarifaAnio {
    const exacta = TARIFAS_POR_ANIO.find((t) => t.anio === anio);
    if (exacta) return exacta;
    throw new RangeError(`Tarifa ISR y subsidio sin publicación soportada para el año ${anio}.`);
}

function validarCentavos(nombre: string, valor: unknown): asserts valor is number {
    if (typeof valor !== "number" || !Number.isSafeInteger(valor) || valor < 0) {
        throw new RangeError(`${nombre} inválido: ${valor}; se requieren centavos enteros no negativos.`);
    }
}

export interface ISRMensual96Resultado {
    /** Impuesto sobre la base gravable, ANTES del subsidio (centavos). */
    impuestoCents: number;
    /** Subsidio aplicado (centavos, 0 sobre el tope de ingresos). */
    subsidioCents: number;
    /** impuestoCents − subsidioCents, piso en 0 (el excedente no se entrega en efectivo). */
    impuestoNetoCents: number;
    /** Renglón usado de la tarifa, para auditar. */
    renglon: number;
}

/**
 * Procedimiento del Art. 96 LISR: ubicar renglón por base gravable mensual,
 * cuota fija + tasa sobre el excedente; restar el subsidio al empleo cuando
 * el ingreso mensual que sirve de base no rebasa el tope. Base ≥ 0.
 */
export function calcularISRMensual96(
    baseGravableMensualCents: number,
    anio = 2026,
    mes = 12
): ISRMensual96Resultado {
    validarCentavos("baseGravableMensualCents", baseGravableMensualCents);
    if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
        throw new RangeError(`mes inválido: ${mes}`);
    }
    const tarifa = resolverTarifaParaAnio(anio);
    const renglon = tarifa.mensual.find(
        (t) => baseGravableMensualCents >= t.limiteInferiorCents && baseGravableMensualCents <= t.limiteSuperiorCents
    )!;
    const excedente = Math.max(0, baseGravableMensualCents - renglon.limiteInferiorCents);
    // El impuesto se calcula en pesos (2 decimales) y se vuelve centavos: la
    // tarifa oficial está en pesos y el CFDIreporta importes a 2 decimales.
    const impuestoPesos = renglon.cuotaFijaCents / 100 + (excedente / 100) * (renglon.tasaPorcentaje / 100);
    const impuestoCents = Math.round(impuestoPesos * 100);

    const aplicaSubsidio = baseGravableMensualCents <= tarifa.subsidio.topeIngresoMensualCents;
    const subsidioCents = aplicaSubsidio
        ? (mes === 1 ? tarifa.subsidio.subsidioEneroCents : tarifa.subsidio.subsidioMensualCents)
        : 0;
    const impuestoNetoCents = Math.max(0, impuestoCents - subsidioCents);

    return { impuestoCents, subsidioCents, impuestoNetoCents, renglon: tarifa.mensual.indexOf(renglon) + 1 };
}

export const FACTOR_NOTIONAL_174 = 30.4; // fr. I RLISR: remuneración/365 × 30.4
const DIAS_NOTIONAL_174 = 365;

export interface RetencionAguinaldoArt174Input {
    anioPago: number;
    mesPago: number; // 1-12
    /** Pago íntegro del aguinaldo (exento + gravado), centavos. */
    aguinaldoBrutoCents: number;
    /** Parte gravada ya resuelta con UMA vigente; jamás inferirla del bruto. */
    aguinaldoGravadoCents: number;
    /**
     * Ingreso ordinario mensual REGULAR del trabajador (centavos). Si falta,
     * fallback: salarioDiarioCents × 30.4 (mes nuevo de 30.4 días, art. 96).
     */
    salarioOrdinarioMensualCents?: number | null;
    /** Fallback del mensual ordinario cuando no se pasa el mensual explícito. */
    salarioDiarioCents?: number | null;
}

export interface RetencionAguinaldoArt174Resultado {
    metodo: "ART174_RLISR";
    anioFuente: number;
    fuente: string;
    /** fr. I: aguinaldo gravado / 365 × 30.4. */
    ingresoHipoteticoCents: number;
    /** Ingreso ordinario mensual usado (explícito o fallback SD × 30.4). */
    ingresoOrdinarioMensualCents: number;
    /** fr. II: impuesto de tarifa sobre hipotético + ordinario, ANTES del subsidio. */
    impuestoConRemuneracionCents: number;
    /** fr. III: impuesto de tarifa sobre el ordinario solo, ANTES del subsidio. */
    impuestoOrdinarioCents: number;
    /** Crédito mensual remanente efectivamente aplicado al impuesto del aguinaldo. */
    subsidioAplicadoCents: number;
    /** fr. V: impuestoAtribuible / ingresoHipotético × 100. */
    tasaEfectivaPct: number;
    /** fr. IV: tasaEfectiva × aguinaldo gravado, ANTES del crédito mensual. */
    retencionArt174Cents: number;
    /** Ordinario + aguinaldo gravado REAL: no incluir exento ni mensualizar el aguinaldo. */
    ingresoGravadoMesCents: number;
    /** Subsidio nominal permitido para ese mes real completo (0 si rebasa el tope). */
    subsidioCausadoMesCents: number;
    /** Subsidio causado del ordinario que deja de corresponder al considerar el mes real. */
    ajusteSubsidioCausadoCents: number;
    /** ISR ordinario dejado de retener según la línea base Art. 96; regularizar aparte. */
    ajusteIsrOrdinarioCents: number;
    /** ISR del aguinaldo después del crédito mensual remanente; sin ajuste del ordinario. */
    retencionCents: number;
    /** Comparación mensual: retencionCents + ajusteIsrOrdinarioCents. No autoriza descontar ni timbrar. */
    totalRetencionAdicionalCents: number;
}

/**
 * Retención opcional Art. 174 RLISR del aguinaldo. Con aguinaldo = 0 la
 * retención es 0. Compara un mes completo con ordinario + este aguinaldo y
 * una línea base Art. 96 del ordinario; no representa acumulados ya timbrados.
 */
export function calcularRetencionAguinaldoArt174(
    input: RetencionAguinaldoArt174Input
): RetencionAguinaldoArt174Resultado {
    const { anioPago, mesPago, aguinaldoBrutoCents, aguinaldoGravadoCents } = input;
    validarCentavos("aguinaldoBrutoCents", aguinaldoBrutoCents);
    validarCentavos("aguinaldoGravadoCents", aguinaldoGravadoCents);
    if (aguinaldoGravadoCents > aguinaldoBrutoCents) {
        throw new RangeError("El aguinaldo gravado no puede exceder el bruto.");
    }
    if (!Number.isInteger(mesPago) || mesPago < 1 || mesPago > 12) {
        throw new RangeError(`mesPago inválido: ${mesPago}`);
    }

    const tarifa = resolverTarifaParaAnio(anioPago);
    const ingresoHipoteticoCents = Math.round((aguinaldoGravadoCents / DIAS_NOTIONAL_174) * FACTOR_NOTIONAL_174);
    let ingresoOrdinarioMensualCents: number;
    if (input.salarioOrdinarioMensualCents != null) {
        validarCentavos("salarioOrdinarioMensualCents", input.salarioOrdinarioMensualCents);
        ingresoOrdinarioMensualCents = input.salarioOrdinarioMensualCents;
    } else {
        const salarioDiarioCents = input.salarioDiarioCents;
        validarCentavos("salarioDiarioCents", salarioDiarioCents);
        ingresoOrdinarioMensualCents = Math.round(salarioDiarioCents * FACTOR_NOTIONAL_174);
    }

    // fr. II — el "mes hipotético" lleva hipotético + ordinario.
    const conRemuneracion = calcularISRMensual96(
        ingresoHipoteticoCents + ingresoOrdinarioMensualCents,
        anioPago,
        mesPago
    );
    // fr. III — el ordinario solo, en el mismo procedimiento.
    const ordinarioSolo = calcularISRMensual96(ingresoOrdinarioMensualCents, anioPago, mesPago);

    const impuestoAtribuible = Math.max(0, conRemuneracion.impuestoCents - ordinarioSolo.impuestoCents);
    const tasaEfectivaPct =
        ingresoHipoteticoCents > 0 ? (impuestoAtribuible / ingresoHipoteticoCents) * 100 : 0;
    // Redondear sólo el importe final; la tasa mostrada es informativa.
    const retencionArt174Cents = Math.round(aguinaldoGravadoCents * (tasaEfectivaPct / 100));

    // Decreto de subsidio, Art. Segundo: elegibilidad y crédito del mes real.
    // Su pérdida no forma parte de la tasa Art. 174, ni se extrapola al año.
    const ingresoGravadoMesCents = ingresoOrdinarioMensualCents + aguinaldoGravadoCents;
    const subsidioCausadoMesCents = calcularISRMensual96(ingresoGravadoMesCents, anioPago, mesPago).subsidioCents;
    const remanenteSubsidioCents = Math.max(0, subsidioCausadoMesCents - ordinarioSolo.impuestoCents);
    const subsidioAplicadoCents = Math.min(retencionArt174Cents, remanenteSubsidioCents);
    const retencionCents = retencionArt174Cents - subsidioAplicadoCents;
    const ajusteSubsidioCausadoCents = Math.max(0, ordinarioSolo.subsidioCents - subsidioCausadoMesCents);
    const creditoOrdinarioBaseCents = Math.min(ordinarioSolo.impuestoCents, ordinarioSolo.subsidioCents);
    const ajusteIsrOrdinarioCents = Math.max(0, creditoOrdinarioBaseCents - subsidioCausadoMesCents);

    return {
        metodo: "ART174_RLISR",
        anioFuente: tarifa.anio,
        fuente: `Retención opcional Art. 174 RLISR sobre ${tarifa.fuente}`,
        ingresoHipoteticoCents,
        ingresoOrdinarioMensualCents,
        impuestoConRemuneracionCents: conRemuneracion.impuestoCents,
        impuestoOrdinarioCents: ordinarioSolo.impuestoCents,
        subsidioAplicadoCents,
        tasaEfectivaPct: Math.round(tasaEfectivaPct * 10000) / 10000,
        retencionArt174Cents,
        ingresoGravadoMesCents,
        subsidioCausadoMesCents,
        ajusteSubsidioCausadoCents,
        ajusteIsrOrdinarioCents,
        retencionCents,
        totalRetencionAdicionalCents: retencionCents + ajusteIsrOrdinarioCents,
    };
}
