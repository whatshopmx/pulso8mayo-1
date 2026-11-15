# Evidencia de Implementación — NOM-01

- **ID:** `NOM-01`
- **Título:** Fijar unidad salarial y vigencias (contrato salarial, periodicidad, calendario y orígenes)
- **Frente / Sesión:** B1 (Nómina)
- **Base acordada:** HEAD `35c5dcf3d05a4b991d60e7d8c1f10f22b433e12c`
- **Fecha:** 2026-11-15
- **Estado:** Implementado y verificado (17/17 pruebas focales aprobadas, 24/24 pruebas del dominio nómina aprobadas)

---

## 1. Archivos modificados y creados

- **`lib/services/payroll-service.ts`**:
  - `validatePayrollPeriod(startDate, endDate)`: validación de calendario estricta con formato YYYY-MM-DD y rechazo de períodos invertidos (`RangeError`).
  - `resolveContractSalaryForPeriod(input)`: resolución de contrato salarial, moneda ('MXN'), vigencia de fechas (`startDate`, `endDate`), prorrateo por contratación o baja intermedia, e historial salarial (`salaryHistory`) por fecha efectiva. Cambios salariales posteriores al período no recalculan ni alteran el período evaluado.
  - `isPayrollPeriodFrozen(companyId, startDate, endDate)`: detección de períodos congelados con corrida en estado `COMPLETED`.
  - `validatePayrollPreStamping`: validación exhaustiva con reporte de causas visibles estructuradas (`NO_CONTRACT`, `UNSUPPORTED_CURRENCY`, `INVALID_SALARY`, `INACTIVE_CONTRACT_PERIOD`, `PERIOD_ALREADY_COMPLETED`, `INVALID_PERIOD`).
  - `calculateEmployeePayroll`: resolución del contrato vigente y su salario por vigencias temporales efectivas, impidiendo valores 0 silenciosos ante contratos ausentes o inválidos.
  - `executePayrollRun`: guarda de período congelado que impide reejecutar o sobrescribir una corrida completada previa.
- **`lib/services/compliance/payroll-calculator.ts`**:
  - `calculatePayrollData(period)`: valida calendario del período, resuelve el contrato salarial vigente con moneda MXN y vigencias de fecha, garantizando que el salario diario, semanal y mensual en pesos se deriven limpiamente del contrato activo.
- **`lib/services/__tests__/payroll-nom01-contract.test.ts`**:
  - 17 pruebas unitarias cubriendo:
    1. Periodicidad y calendario (período normal, semanal, invertido y formatos inválidos).
    2. Contrato salarial, moneda y vigencias (período completo, prorrateo por alta intermedia, prorrateo por baja intermedia, contrato fuera de período, moneda no soportada, salario <= 0).
    3. Vigencias de cambios salariales (aumento salarial dentro del período y aumento salarial posterior).
    4. Compatibilidad con FC-15 y snapshots de tesorería (`buildPayrollSnapshot`, `parsePayrollSnapshot`).
    5. Períodos congelados e inmutabilidad frente a cambios salariales posteriores.
    6. Compliance y exportación (`calculatePayrollData`).

---

## 2. Comandos y Verificación

### Pruebas focales de NOM-01
```bash
pnpm vitest run lib/services/__tests__/payroll-nom01-contract.test.ts
```
**Resultado:** Exit code `0`
- `17 passed (17)`

### Pruebas de regresión del dominio Nómina
```bash
pnpm vitest run lib/services/__tests__/payroll-validation.test.ts lib/services/__tests__/payroll-holiday.test.ts
```
**Resultado:** Exit code `0`
- `7 passed (7)`

Total de pruebas de nómina ejecutadas: **24 aprobadas de 24 (100%)**.

### Lint focal
```bash
pnpm exec eslint lib/services/payroll-service.ts lib/services/compliance/payroll-calculator.ts lib/services/__tests__/payroll-nom01-contract.test.ts
```
**Resultado:** Exit code `0` (0 errores).

---

## 3. Compatibilidad con FC-15 y Tesorería

- Se preservó estrictamente la compatibilidad con `lib/treasury/payroll-snapshot.ts` y `lib/services/accounting/payroll-contract.ts` (archivos de solo lectura).
- El cálculo cumple exactamente la ecuación:
  `totalPercepcionesCents === baseSalaryCents + holidayPayCents + overtimePayCents + aguinaldoCents + propinasCents`
  `netCents === totalPercepcionesCents - totalDeduccionesCents`
- La prueba focal valida que un recibo generado a partir de la resolución de NOM-01 pasa sin error por `buildPayrollSnapshot` y `parsePayrollSnapshot`.

---

## 4. Cambios para Consolidación por Integración (S)

- **`tasks/todo-implementacion-faltantes.md`**:
  - `NOM-01`: marcar con `[x]` (o estado `código implementado / verificado V1, V2`).
- **`tasks/mapa-implementacion-faltantes.json`**:
  - Registrar entrada de ejecución para `NOM-01` con evidencia `tasks/evidencia/2026-11-11/NOM-01/README.md`.
- **Siguiente paso recomendado para Frente B (Nómina):**
  - Sesión **B2** (`NOM-02.a`): Calcular base desde asistencia aprobada (caso independiente asistencia aprobada / falta / festivo, zona operativa y rechazo de asistencia pendiente; V1/V2).
