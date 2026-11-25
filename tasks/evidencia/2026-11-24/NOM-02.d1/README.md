# NOM-02.d1 — Calcular ISR ordinario

Fecha: 2026-11-24. Base: `732a815136f0273ee267e564eb58a53fe6fa4548`.

## Implementación y fuentes oficiales

- **Módulo nuevo:** `lib/services/payroll-isr-service.ts` (`resolveOrdinaryIsrForPeriod`).
  - Reutiliza `TARIFA_MENSUAL_2026`, `SUBSIDIO_EMPLEO_2026`, `resolverTarifaParaAnio` y `calcularISRMensual96` de `lib/services/isr-annual-withholding.ts`.
  - **Fuentes oficiales registradas:** Anexo 8 RMF 2026 (DOF 28-dic-2025, apartado B fr. V Art. 96 LISR); Decreto de Subsidio para el Empleo (DOF 31-dic-2025: 15.02% × UMA mensual feb–dic = $535.65, 15.59% × UMA 2025 enero = $536.21, tope $11,492.66); procedimiento proporcional para períodos sub-mensuales conforme a Art. 175 RLISR (factor 30.4 días/mes).
  - **Bloqueo sin configuración:** ejercicios sin tabla oficial publicada (ej. 2025, 2027) devuelven `status: "MISSING_CONFIG"` sin fallback ni extrapolación.
- **Integración en `lib/services/payroll-service.ts`:**
  - `calculateEmployeePayroll` calcula la base gravable desde `construirDesgloseNomina` (respetando exenciones LISR Art. 93 de propinas, festivos, horas extra y prima vacacional), resuelve `isrBreakdown` y suma `isrRetenidoCents` a `totalDeduccionesCents`.
  - `construirDesgloseNomina` emite la deducción SAT `c_TipoDeduccion = "002"` (ISR retenido) cuando `isrRetenidoCents > 0`.
  - `validatePayrollPreStamping` valida la existencia de tarifa oficial vigente para el período y emite error bloqueante `MISSING_ISR_CONFIG` cuando falta configuración.

## Verificación V1 y V2

- **V1 (oráculo independiente):** `lib/services/__tests__/payroll-nom02d1-isr.test.ts` (9/9) + `lib/__tests__/isr-annual-withholding.test.ts` (53/53) = **62/62**, exit 0. Cubre los 11 tramos y fronteras exactas, tope de subsidio ($11,492.66 vs $11,492.67), enero especial, piso 0 cubierto por subsidio, semanal (7d) / catorcenal (14d) / quincenal (15d) / mensual (30d), base cero, ejercicios sin tabla (`MISSING_CONFIG`) y nodo SAT `"002"`.
- **V2 (Neon aislado `pulso_app` NOBYPASSRLS):** `tests/integration/payroll-db.test.ts` **15/15**, exit 0 (incluye cálculo real de ISR en `calculateEmployeePayroll` y bloqueo `MISSING_ISR_CONFIG` en 2027).
- **ESLint:** 0 errores sobre todos los archivos nuevos y modificados.

## Límites

- Actualmente cubre tablas oficiales publicadas para 2026; ejercicios futuros requieren publicación oficial DOF y actualización versionada del catálogo (bloqueados explícitamente mientras tanto).
- No ejecuta despliegue operativo ni timbrado externo.
