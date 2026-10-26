/** FIS-01: oráculo independiente. No importar constantes ni calculadores de producción. */
export const minimumWageFixtures = [
    { from: "2025-01-01", to: "2025-12-31", zone: "GENERAL", dailyCents: 27_880 },
    { from: "2025-01-01", to: "2025-12-31", zone: "ZLFN", dailyCents: 41_988 },
    { from: "2026-01-01", to: "2026-12-31", zone: "GENERAL", dailyCents: 31_504 },
    { from: "2026-01-01", to: "2026-12-31", zone: "ZLFN", dailyCents: 44_087 },
] as const;

export const umaFixtures = [
    { from: "2025-02-01", to: "2026-01-31", dailyCents: 11_314, monthlyCents: 343_946 },
    { from: "2026-02-01", to: "2027-01-31", dailyCents: 11_731, monthlyCents: 356_622 },
] as const;

// Resultados calculados a mano desde B.V del Anexo 8 y el decreto de subsidio.
// Véanse operaciones y fuentes en la evidencia FIS-01/README.md.
export const monthlyIsrFixtures = [
    { baseCents: 300_000, month: 12, taxCents: 15_417, subsidyCents: 53_565, netCents: 0 },
    { baseCents: 1_000_000, month: 1, taxCents: 72_902, subsidyCents: 53_621, netCents: 19_281 },
    { baseCents: 1_000_000, month: 2, taxCents: 72_902, subsidyCents: 53_565, netCents: 19_337 },
    { baseCents: 1_149_266, month: 12, taxCents: 89_142, subsidyCents: 53_565, netCents: 35_577 },
    { baseCents: 1_149_267, month: 12, taxCents: 89_142, subsidyCents: 0, netCents: 89_142 },
    { baseCents: 1_500_000, month: 12, taxCents: 140_282, subsidyCents: 0, netCents: 140_282 },
] as const;

export const aguinaldoTaxableFixtures = [
    { grossCents: 225_000, umaDailyCents: 11_731, exemptCents: 225_000, taxableCents: 0 },
    { grossCents: 900_000, umaDailyCents: 11_731, exemptCents: 351_930, taxableCents: 548_070 },
] as const;

/** Se exige resolver exacto; estos casos no deben heredar una tarifa de 2026. */
export const unsupportedTaxYears = [2025, 2027, 2031] as const;

/** AGU-02: operaciones independientes documentadas en AGU-02/README.md. */
export const art174Fixtures = [
    { grossCents: 225_000, taxableCents: 0, monthlyCents: 1_824_000, month: 12,
        hypotheticalCents: 0, ordinaryTaxCents: 200_772, combinedTaxCents: 200_772, withholdingCents: 0 },
    { grossCents: 900_000, taxableCents: 548_070, monthlyCents: 1_824_000, month: 12,
        hypotheticalCents: 45_647, ordinaryTaxCents: 200_772, combinedTaxCents: 210_522, withholdingCents: 117_065 },
    { grossCents: 0, taxableCents: 0, monthlyCents: 1_824_000, month: 12,
        hypotheticalCents: 0, ordinaryTaxCents: 200_772, combinedTaxCents: 200_772, withholdingCents: 0 },
    // Gravado 3650 → hipotético exacto 304; el ingreso real mensual 13650
    // elimina subsidio. Los impuestos de los escenarios son ANTES del crédito.
    { grossCents: 704_420, taxableCents: 365_000, monthlyCents: 1_000_000, month: 1,
        hypotheticalCents: 30_400, ordinaryTaxCents: 72_902, combinedTaxCents: 76_209, withholdingCents: 39_706 },
    { grossCents: 716_930, taxableCents: 365_000, monthlyCents: 1_000_000, month: 2,
        hypotheticalCents: 30_400, ordinaryTaxCents: 72_902, combinedTaxCents: 76_209, withholdingCents: 39_706 },
] as const;

/**
 * AGU-02C: oráculo independiente para el crédito único del mes real.
 * ISR mensual: tramo 3 = 42095 + (base − 716852) × 10.88%;
 * tramo 2 = 1622 + (base − 84460) × 6.4%; tramo 1 = base × 1.92%.
 * Se redondean impuesto e hipotético a centavos antes de formar la tasa.
 * Ningún ajuste del subsidio se multiplica por 365/30.4.
 */
export const art174SubsidyFixtures = [
    { case: "mes real un centavo debajo del tope", monthlyCents: 1_000_000, taxableCents: 149_265, month: 12,
        hypotheticalCents: 12_432, ordinaryTaxCents: 72_902, combinedTaxCents: 74_254, nominalCents: 16_233,
        monthlySubsidyCents: 53_565, bonusCreditCents: 0, causedAdjustmentCents: 0, ordinaryAdjustmentCents: 0, withholdingCents: 16_233, additionalCents: 16_233 },
    { case: "mes real exactamente en el tope", monthlyCents: 1_000_000, taxableCents: 149_266, month: 12,
        hypotheticalCents: 12_432, ordinaryTaxCents: 72_902, combinedTaxCents: 74_254, nominalCents: 16_233,
        monthlySubsidyCents: 53_565, bonusCreditCents: 0, causedAdjustmentCents: 0, ordinaryAdjustmentCents: 0, withholdingCents: 16_233, additionalCents: 16_233 },
    { case: "mes real cruza el tope sin cruce hipotético", monthlyCents: 1_000_000, taxableCents: 149_267, month: 12,
        hypotheticalCents: 12_432, ordinaryTaxCents: 72_902, combinedTaxCents: 74_254, nominalCents: 16_233,
        monthlySubsidyCents: 0, bonusCreditCents: 0, causedAdjustmentCents: 53_565, ordinaryAdjustmentCents: 53_565, withholdingCents: 16_233, additionalCents: 69_798 },
    { case: "ordinario un centavo debajo del tope; cruza el hipotético", monthlyCents: 1_149_265, taxableCents: 120_000, month: 12,
        hypotheticalCents: 9_995, ordinaryTaxCents: 89_142, combinedTaxCents: 90_229, nominalCents: 13_051,
        monthlySubsidyCents: 0, bonusCreditCents: 0, causedAdjustmentCents: 53_565, ordinaryAdjustmentCents: 53_565, withholdingCents: 13_051, additionalCents: 66_616 },
    { case: "regresión: ordinario en el tope; no extrapolar 535.65", monthlyCents: 1_149_266, taxableCents: 120_000, month: 12,
        hypotheticalCents: 9_995, ordinaryTaxCents: 89_142, combinedTaxCents: 90_229, nominalCents: 13_051,
        monthlySubsidyCents: 0, bonusCreditCents: 0, causedAdjustmentCents: 53_565, ordinaryAdjustmentCents: 53_565, withholdingCents: 13_051, additionalCents: 66_616 },
    { case: "ordinario un centavo encima del tope; sin subsidio previo", monthlyCents: 1_149_267, taxableCents: 120_000, month: 12,
        hypotheticalCents: 9_995, ordinaryTaxCents: 89_142, combinedTaxCents: 90_229, nominalCents: 13_051,
        monthlySubsidyCents: 0, bonusCreditCents: 0, causedAdjustmentCents: 0, ordinaryAdjustmentCents: 0, withholdingCents: 13_051, additionalCents: 13_051 },
    { case: "un centavo gravado cruza el mes real aunque el hipotético sea cero", monthlyCents: 1_149_266, taxableCents: 1, month: 12,
        hypotheticalCents: 0, ordinaryTaxCents: 89_142, combinedTaxCents: 89_142, nominalCents: 0,
        monthlySubsidyCents: 0, bonusCreditCents: 0, causedAdjustmentCents: 53_565, ordinaryAdjustmentCents: 53_565, withholdingCents: 0, additionalCents: 53_565 },
    { case: "enero: retiro del subsidio ordinario de 536.21", monthlyCents: 1_000_000, taxableCents: 365_000, month: 1,
        hypotheticalCents: 30_400, ordinaryTaxCents: 72_902, combinedTaxCents: 76_209, nominalCents: 39_706,
        monthlySubsidyCents: 0, bonusCreditCents: 0, causedAdjustmentCents: 53_621, ordinaryAdjustmentCents: 53_621, withholdingCents: 39_706, additionalCents: 93_327 },
    { case: "febrero: retiro del subsidio ordinario de 535.65", monthlyCents: 1_000_000, taxableCents: 365_000, month: 2,
        hypotheticalCents: 30_400, ordinaryTaxCents: 72_902, combinedTaxCents: 76_209, nominalCents: 39_706,
        monthlySubsidyCents: 0, bonusCreditCents: 0, causedAdjustmentCents: 53_565, ordinaryAdjustmentCents: 53_565, withholdingCents: 39_706, additionalCents: 93_271 },
    { case: "remanente cubre todo el ISR del aguinaldo", monthlyCents: 650_000, taxableCents: 150_000, month: 12,
        hypotheticalCents: 12_493, ordinaryTaxCents: 37_817, combinedTaxCents: 38_616, nominalCents: 9_593,
        monthlySubsidyCents: 53_565, bonusCreditCents: 9_593, causedAdjustmentCents: 0, ordinaryAdjustmentCents: 0, withholdingCents: 0, additionalCents: 0 },
    { case: "enero: remanente parcial sin duplicar el crédito", monthlyCents: 700_000, taxableCents: 400_000, month: 1,
        hypotheticalCents: 33_315, ordinaryTaxCents: 41_017, combinedTaxCents: 43_886, nominalCents: 34_447,
        monthlySubsidyCents: 53_621, bonusCreditCents: 12_604, causedAdjustmentCents: 0, ordinaryAdjustmentCents: 0, withholdingCents: 21_843, additionalCents: 21_843 },
    { case: "febrero: remanente parcial sin duplicar el crédito", monthlyCents: 700_000, taxableCents: 400_000, month: 2,
        hypotheticalCents: 33_315, ordinaryTaxCents: 41_017, combinedTaxCents: 43_886, nominalCents: 34_447,
        monthlySubsidyCents: 53_565, bonusCreditCents: 12_548, causedAdjustmentCents: 0, ordinaryAdjustmentCents: 0, withholdingCents: 21_899, additionalCents: 21_899 },
    { case: "sin ordinario: todo el crédito se reserva al aguinaldo", monthlyCents: 0, taxableCents: 548_070, month: 12,
        hypotheticalCents: 45_647, ordinaryTaxCents: 0, combinedTaxCents: 876, nominalCents: 10_518,
        monthlySubsidyCents: 53_565, bonusCreditCents: 10_518, causedAdjustmentCents: 0, ordinaryAdjustmentCents: 0, withholdingCents: 0, additionalCents: 0 },
    { case: "aguinaldo totalmente exento no consume otro subsidio", monthlyCents: 1_140_000, taxableCents: 0, month: 12,
        hypotheticalCents: 0, ordinaryTaxCents: 88_134, combinedTaxCents: 88_134, nominalCents: 0,
        monthlySubsidyCents: 53_565, bonusCreditCents: 0, causedAdjustmentCents: 0, ordinaryAdjustmentCents: 0, withholdingCents: 0, additionalCents: 0 },
    { case: "retiro del causado es distinto al ISR ordinario efectivamente reducido", monthlyCents: 500_000, taxableCents: 700_000, month: 12,
        hypotheticalCents: 58_301, ordinaryTaxCents: 28_217, combinedTaxCents: 31_948, nominalCents: 44_797,
        monthlySubsidyCents: 0, bonusCreditCents: 0, causedAdjustmentCents: 53_565, ordinaryAdjustmentCents: 28_217, withholdingCents: 44_797, additionalCents: 73_014 },
] as const;
