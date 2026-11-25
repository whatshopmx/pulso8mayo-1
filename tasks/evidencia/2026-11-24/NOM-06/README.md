# NOM-06 — Bloquear resultados incompletos

Fecha: 2026-11-24. Base: `732a815136f0273ee267e564eb58a53fe6fa4548`.

## Implementación

- **Módulo nuevo:** `lib/services/payroll-completeness-service.ts` (`evaluatePayrollCompleteness`).
  - Verifica que todo importe cero (`OVERTIME`, `VACATION_PRIME`, `ISR`, `IMSS_WORKER`) tenga una justificación explícita y válida (`SIN_HORAS_EXTRA`, `SIN_VACACIONES`, `EXCEEDED_VACATION_BALANCE`, `BASE_GRAVABLE_CERO`, `CUBIERTO_POR_SUBSIDIO_EMPLEO`, `ART_36_LSS_SALARIO_MINIMO_EXENTO`, `SIN_DIAS_COTIZADOS`).
  - Bloquea aprobación y timbrado (`canApprove: false`, `canStamp: false`) con código, dominio y acción recuperable (`recoveryAction`) ante cualquier dato faltante, error de consulta (`QUERY_ERROR`), conflicto histórico (`CONFLICT`) o falta de tabla oficial (`MISSING_ISR_CONFIG`, `MISSING_IMSS_CONFIG`, `MISSING_IMSS_BASE`, `MISSING_EMPLOYER_BURDEN_CONFIG`).
- **Integración:** `calculateEmployeePayroll` expone `completeness`; `executePayrollRun` bloquea el timbrado si `!payrollCalc.completeness.canApprove`.

## Verificación V1 y V3

- **V1 + V3 API:** `lib/services/__tests__/payroll-nom06-completeness.test.ts` **5/5**, exit 0 (ceros válidos justificados, 7 bloqueos distintos con `recoveryAction`, conflicto histórico de vacaciones, 403/400 en `POST /api/payroll/validate` y 403 en `POST /api/payroll/run`).
- **ESLint:** exit 0, 0 errores.

## Límites

- Pruebas HTTP de ruta con `requirePermissionApi` controlado; validación integrada de persistencia en `NOM-03` y timbrado externo en `NOM-04.b`.
