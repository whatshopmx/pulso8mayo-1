# NOM-02.d2 — Calcular deducción obrera de seguridad social (IMSS)

Fecha: 2026-11-24. Base: `732a815136f0273ee267e564eb58a53fe6fa4548`.

## Implementación y fuentes oficiales

- **Módulo nuevo:** `lib/services/payroll-imss-service.ts` (`resolveWorkerImssForPeriod`, `resolveUmaForDate`, `calculateMinimumIntegrationFactor`).
  - **Fuentes oficiales registradas:** Ley del Seguro Social (Arts. 25 2o párrafo E&M gastos médicos pensionados 0.375%, Art. 27–28 SBC y tope 25 UMA, Art. 31 ausentismos, Art. 36 exención salario mínimo, Art. 106 fr. II E&M excedente 3 UMA 0.40%, Art. 107 fr. I E&M prestaciones en dinero 0.25%, Art. 147 Invalidez y Vida 0.625%, Art. 168 fr. II CEAV obrera 1.125%); UMA diaria INEGI 2025 ($113.14, vigente enero 2026) y 2026 ($117.31, vigente feb–dic 2026).
  - **Sin simulación de cero:** sin UMA vigente devuelve `status: "MISSING_CONFIG"`; sin base salarial/mínimo válido devuelve `status: "MISSING_BASE"`. Salario mínimo general/ZLFN devuelve `0` con justificación explícita `ART_36_LSS_SALARIO_MINIMO_EXENTO`.
- **Integración en `lib/services/payroll-service.ts`:**
  - `calculateEmployeePayroll` calcula `imssWorkerBreakdown`, suma `imssObreroCents` a `totalDeduccionesCents`.
  - `construirDesgloseNomina` emite deducción SAT `c_TipoDeduccion = "001"` (Seguridad social).
  - `validatePayrollPreStamping` valida existencia de UMA oficial vigente y emite error bloqueante `MISSING_IMSS_CONFIG` cuando falta.

## Verificación V1 y V2

- **V1 (oráculo independiente):** `lib/services/__tests__/payroll-nom02d2-imss.test.ts` **8/8** (parte de **86/86** regresión nómina), exit 0. Cubre UMA enero vs feb–dic 2026, 5 ramas obreras vs oráculo independiente, exención Art. 36 LSS, tope 25 UMA Art. 28 LSS, ausentismos Art. 31 LSS, `MISSING_BASE` / `MISSING_CONFIG` y nodo SAT `"001"`.
- **V2 (Neon aislado `pulso_app` NOBYPASSRLS):** `tests/integration/payroll-db.test.ts` **15/15**, exit 0 (verifica `imssWorkerBreakdown.status === "CALCULATED"`, `quotedDays === 14`, `imssObreroCents > 0`, `totalDeduccionesCents === isrRetenidoCents + imssObreroCents`).
- **ESLint:** 0 errores.

## Límites

- Catálogo UMA cubre vigencias oficiales publicadas hasta 2026-12-31; ejercicios posteriores bloquean explícitamente hasta publicar UMA oficial.
- Sin despliegue operativo ni timbrado externo.
