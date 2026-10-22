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
