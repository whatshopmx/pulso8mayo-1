# NOM-02.e — Sustituir la carga patronal fija del 35%

Fecha: 2026-11-24. Base: `732a815136f0273ee267e564eb58a53fe6fa4548`.

## Implementación y fuentes oficiales

- **Módulo compartido:** `lib/services/payroll-imss-service.ts` (`resolveEmployerSocialSecurityForPeriod`, `resolveCeavEmployerRate2026`, `CEAV_EMPLOYER_TABLE_2026`), re-exportado desde `lib/services/labor-cost-service.ts` para que nómina y costo laboral compartan exactamente el mismo resultado y desglose.
- **Ramas legales implementadas:**
  - E&M Cuota Fija (20.40% × 1 UMA, Art. 106 fr. I LSS), E&M Excedente 3 UMA (1.10%, Art. 106 fr. II), E&M Dinero (0.70%, Art. 107 fr. I), E&M Gastos Médicos Pensionados (1.05%, Art. 25), Invalidez y Vida (1.75%, Art. 147), Retiro SAR (2.00%, Art. 168 fr. I), CEAV Patronal tabla progresiva 2026 en 8 rangos (3.150% a 7.513%, Art. 168 fr. II y Decreto DOF 16-dic-2020 Transitorio Segundo), Guarderías (1.00%, Art. 211), Riesgo de Trabajo configurable (Arts. 71–73 LSS), INFONAVIT (5.00%, Art. 29 fr. II Ley INFONAVIT) e ISN estatal parametrizado.
- **Eliminación del 35% fijo:** retiradas ambas fórmulas `* 0.35` en `validatePayrollPreStamping` y `calculateEmployeePayroll` de `lib/services/payroll-service.ts`.
- **Etiquetado honesto:** solo devuelve `MEASURED` cuando existen prima de riesgo de trabajo e ISN explícitos; si falta alguno conserva `ESTIMATED` con `missingParameters` explícitos (nunca acredita costo medido sin parámetros). Sin UMA vigente devuelve `MISSING_CONFIG`.

## Verificación V1 y V2

- **V1:** `lib/services/__tests__/payroll-nom02e-burden.test.ts` **4/4** (parte de **86/86** regresión nómina), exit 0.
- **V2 (Neon aislado `pulso_app` NOBYPASSRLS):** `tests/integration/payroll-db.test.ts` **15/15**, exit 0 (`employerSocialSecurityBreakdown.status === "ESTIMATED"`, `employerSocialSecurityCents === totalEmployerBurdenCents`).
- **ESLint:** 0 errores.

## Límites

- Requiere captura de prima de riesgo de trabajo e ISN estatal por empresa/sucursal para pasar de `ESTIMATED` a `MEASURED`. Sin despliegue operativo.
