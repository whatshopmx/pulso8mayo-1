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

## 4. Cierre V2 en Postgres Aislado (NOM-01) y Cierre NOM-02.a

### Cierre NOM-01 V2 en Neon Postgres (`br-round-voice-belheola`, rol `pulso_app`)
- **Runtime verificado:** rol `pulso_app` con `rolsuper: false` y `rolbypassrls: false`.
- **Períodos congelados:** `isPayrollPeriodFrozen` detecta corridas en `COMPLETED` y `executePayrollRun` bloquea reejecución lanzando error explícito (`PERIOD_ALREADY_COMPLETED`).
- **Inmutabilidad:** Recibos previamente generados en `payroll_payslips` mantienen su importe histórico intacto frente a inserciones posteriores en `salary_history`.
- **Aislamiento multi-empresa:** Inserciones foráneas son rechazadas por RLS (`42501`) y consultas sobre otras empresas retornan 0 filas bajo `app.current_company_id`.

### Implementación y Cierre NOM-02.a (Asistencia, Faltas, Festivos y Zona Operativa)
- **Cálculo de base salarial:** Resuelve días pagaderos a partir de asistencia aprobada (`shiftSessions`), festivos de descanso por ley (1x salario base, Art. 74 LFT), festivos trabajados (1x base + 2x prima legal Art. 75 LFT), permisos con goce aprobados, y deducción estricta de ausencias injustificadas (`NO_SHOW`, falta injustificada).
- **Rechazo estricto de asistencia pendiente:** Cualquier turno con `status = 'PENDING'`, `status = 'ACTIVE'` o no aprobado bloquea inmediatamente `validatePayrollPreStamping` con código estructurado `PENDING_ATTENDANCE` y rechaza `calculateEmployeePayroll` con `RangeError`.
- **Zona operativa y salario mínimo CONASAMI:** Convierte marcas de tiempo a fechas civiles locales usando la zona horaria de la sucursal (`branches.timezone`, por defecto `America/Mexico_City`). Compara el salario contra el salario mínimo vigente (`GENERAL`: 31,504¢; `ZLFN`: 44,087¢), reportando `INVALID_SALARY` si no cumple.
- **Pruebas unitarias (V1):** `lib/services/__tests__/payroll-nom02a-attendance.test.ts` (14/14 pruebas aprobadas).
- **Pruebas de integración (V2):** `tests/integration/payroll-db.test.ts` (6/6 pruebas aprobadas en Postgres aislado).

---

## 5. Resultados de Verificación de Suites Completas

### Suite Unitaria de Nómina (38/38 aprobadas)
```bash
pnpm vitest run --configLoader bundle lib/services/__tests__/payroll-nom01-contract.test.ts lib/services/__tests__/payroll-nom02a-attendance.test.ts lib/services/__tests__/payroll-holiday.test.ts lib/services/__tests__/payroll-validation.test.ts --pool=threads --maxWorkers=1
```
- `lib/services/__tests__/payroll-nom02a-attendance.test.ts` (14 passed)
- `lib/services/__tests__/payroll-nom01-contract.test.ts` (17 passed)
- `lib/services/__tests__/payroll-holiday.test.ts` (3 passed)
- `lib/services/__tests__/payroll-validation.test.ts` (4 passed)
- **Total:** 38 passed (38). Exit code: `0`.

### Suite de Integración en Base de Datos Real (6/6 aprobadas)
```bash
pnpm vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/payroll-db.test.ts --pool=threads --maxWorkers=1
```
- `tests/integration/payroll-db.test.ts` (6 passed)
  - `verifica runtime pulso_app con rolsuper: false y rolbypassrls: false en Postgres aislado`
  - `NOM-01 V2: isPayrollPeriodFrozen y bloqueo de executePayrollRun en período completado`
  - `NOM-01 V2: Inmutabilidad de recibos previos frente a incrementos salariales posteriores`
  - `NOM-02.a V2: Rechazo estricto de asistencia pendiente en base de datos real`
  - `NOM-02.a V2: Cálculo de base salarial desde asistencia aprobada, faltas y festivos en DB real`
  - `aislamiento multi-empresa bajo pulso_app (NOBYPASSRLS)`
- **Total:** 6 passed (6). Exit code: `0`.

### Verificación de Linters
```bash
pnpm exec eslint lib/services/payroll-service.ts lib/services/compliance/payroll-calculator.ts lib/services/__tests__/payroll-nom02a-attendance.test.ts tests/integration/payroll-db.test.ts
```
- **Resultado:** 0 errores. Exit code: `0`.

---

## 6. Cambios para Consolidación por Integración (S)

- **`tasks/todo-implementacion-faltantes.md`**:
  - `NOM-01`: marcar como cerrado en V1 y V2.
  - `NOM-02.a`: marcar como cerrado en V1 y V2.
- **`tasks/mapa-implementacion-faltantes.json`**:
  - Registrar cierre de `NOM-01` (V2) y `NOM-02.a` (V1 y V2) referenciando este archivo de evidencia.
- **Siguiente paso recomendado para Frente B (Nómina):**
  - Sesión **B3** (`NOM-02.b`): Propinas auditadas e integradas a percepciones.
