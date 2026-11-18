> **Revisión de Integración S — 2026-11-16 (prevalece sobre las conclusiones históricas inferiores).** Estado consolidado: código implementado; no aceptado. V1 actual y repetición V2 de 14 casos de nómina pasan usando certificados del sistema; esto no sustituye la revisión de fuentes/saldos. Revisar fuentes/vigencia y saldos por período antes de aceptar. Ver [consolidación actual](../../2026-11-16/CONSOLIDACION/README.md).
> **Checks globales finales:** Webpack compila módulos tras corregir el import salarial; la validación de producción queda bloqueada por siete errores de tipos preexistentes en seis archivos sin cambios de esta sesión. No se acredita build global ni aceptación adicional.

# Evidencia de Implementación — NOM-02.c1

- **ID:** `NOM-02.c1`
- **Título:** Incorporar vacaciones, permisos con goce / sin goce y prima vacacional en el cálculo de nómina (LFT Arts. 76, 79, 80, 81 y LISR Art. 93 Frac. XIV)
- **Frente / Sesión:** Worker Frente B (Nómina) — Ola 4
- **Fecha:** 2026-11-16
- **Estado:** Implementado y verificado (63/63 unitarias V1 aprobadas, 14/14 integración V2 en Postgres real con `pulso_app` NOBYPASSRLS aprobadas, 0 errores de ESLint, 0 errores en `validate-faltantes.ts`)

---

## 1. Archivos Modificados y Creados (Estrictamente 5 archivos)

1. **`lib/services/payroll-service.ts`** (MODIFICADO):
   - Importación de `vacationAccruals` y `leaveBalances` desde `@/lib/db/schema`.
   - Definición y exportación de interfaces `VacationPeriodBreakdown`, `LeavePeriodBreakdown`, `ResolveVacationsInput` y `ResolveLeavesInput`.
   - Actualización de `AttendancePeriodResolution` para exponer `vacationDays` y `otherPaidLeaveDays`.
   - Modificación de `resolveAttendanceForPeriod`:
     - Segrega estrictamente los días de vacaciones aprobadas (`vacationDates`) de otros permisos con goce (`otherPaidLeaveDates`) y permisos sin goce (`unpaidLeaveDates`).
     - Consolida `paidLeaveDays = new Set([...vacationDates, ...otherPaidLeaveDates])` para preservar compatibilidad con suites previas.
     - Permisos sin goce (`isPaid: false`) y `NO_SHOW` se agregan a `unpaidAbsenceDays` deduciendo salario base.
     - Permisos con goce (`isPaid: true`) y vacaciones no descuentan salario base (`payableDays` íntegro).
   - Implementación de `resolveVacationsForPeriod`:
     - Consulta y evalúa solicitudes de vacaciones autorizadas (`status = 'APPROVED'`).
     - Deduplicación idempotente de fechas civiles únicas mediante `Set<string>`.
     - Consulta y valida saldo acumulado disponible en `vacationAccruals` (con fallback secundario a `leaveBalances`).
     - Regla anti-inferencias: ausencia de datos o solicitudes no aprobadas produce `justification: "SIN_VACACIONES"`, `vacationDaysEligible: 0`, `vacationPrimeCents: 0` y cero faltas automáticas.
     - Saldo suficiente: `vacationDaysEligible = vacationDaysTaken`, `justification: "LFT_ARTS_76_80"`.
     - Saldo parcial o saldo cero: `vacationDaysEligible = Math.min(vacationDaysTaken, balance)`, `vacationDaysExceeded = vacationDaysTaken - vacationDaysEligible`, `justification: "EXCEEDED_VACATION_BALANCE"`.
     - Cálculo en centavos enteros: `vacationBasePayCents = vacationDaysEligible * dailySalaryCents` y `vacationPrimeCents = Math.round((vacationBasePayCents * bonusPercent) / 100)`.
     - Aplica prima mínima del 25% (LFT Art. 80) o porcentaje contractual superior (`vacationBonusPercent >= 25`).
   - Implementación de `resolveLeavesForPeriod`:
     - Evalúa solicitudes en `leaveRequests` unidas con `leaveTypes`.
     - Clasifica días en `paidLeaveDays` vs `unpaidLeaveDays`.
     - Reporta detalle por solicitud (`details`).
   - Modificación de `calculateEmployeePayroll`:
     - Resuelve `vacationBreakdown` mediante `resolveVacationsForPeriod`.
     - Suma `vacationPrimeCents` a `totalPercepcionesCents`:
       `totalPercepcionesCents = baseSalaryCents + tipsCents + holidayPayCents + overtimePayCents + vacationPrimeCents`.
     - Retorna `vacationPrimeCents`, `vacationDays`, `vacationBreakdown` y desglose enriquecido en `attendanceBreakdown`.
   - Modificación de `construirDesgloseNomina`:
     - Si `vacationPrimeCents > 0`: emite percepción SAT `"021"` ("Prima vacacional (Art. 80 LFT)").
     - Aplica el régimen de exención fiscal de la LISR Art. 93 Frac. XIV:
       - Tope exento de 15 UMAs diarias (en 2026: UMA diaria = 11,314¢, 15 UMAs = 169,710¢).
       - `exemptAmount = Math.min(vacationPrimeCents, 169710)`.
       - `taxedAmount = vacationPrimeCents - exemptAmount`.
       - Invariante fiscal fundamental SAT: `taxedAmount + exemptAmount === vacationPrimeCents`.
     - Si `vacationPrimeCents === 0`: no emite nodo `"021"` (prohibido por el SAT con importe cero).

2. **`lib/services/compliance/payroll-calculator.ts`** (MODIFICADO):
   - Importación de `resolveVacationsForPeriod` y `type VacationPeriodBreakdown` desde `@/lib/services/payroll-service`.
   - Extensión de la interfaz `PayrollEmployeeRecord` con `vacationPrimePay?: number`, `vacationPrimePayCents?: number` y `vacationBreakdown?: VacationPeriodBreakdown`.
   - Enriquecimiento de registros en `calculatePayrollData` mediante invocación de `resolveVacationsForPeriod`.
   - Soporte en `payrollToCSV` de la columna `Prima_Vacacional` en formato genérico, preservando la compatibilidad de importación con CONTPAQi Nóminas (`payrollToContpaqi`) y Aspel NOI (`payrollToNOI`).

3. **`lib/services/__tests__/payroll-nom02c1-vacations.test.ts`** (NUEVO):
   - Suite completa de 15 pruebas unitarias V1 con oráculos en centavos enteros:
     1. Validación de período quincenal y rechazo de período invertido con `RangeError`.
     2. Case 1: Normal con saldo suficiente (6 días solicitados, 12 días saldo, prima 75,000¢, justificación `LFT_ARTS_76_80`, SAT 021 exento 75,000¢).
     3. Case 2: Saldo parcial (6 días solicitados, 4 días saldo disponible, prima 50,000¢ sobre días con saldo, justificación `EXCEEDED_VACATION_BALANCE`, SAT 021 exento 50,000¢).
     4. Case 3: Sin saldo acumulado (5 días solicitados, 0 días saldo, 0¢ prima, justificación `EXCEEDED_VACATION_BALANCE`, sin nodo 021).
     5. Case 4: Ausencia total de datos (0 solicitudes, 0¢ prima, justificación `SIN_VACACIONES`, 0 faltas automáticas, sueldo base 100% íntegro).
     6. Case 5 & 6: Solicitud rechazada / pendiente (0¢ prima, conteo en `rejectedRequestsCount` y `pendingRequestsCount`, justificación `SIN_VACACIONES`).
     7. Case 7 & 8: Permisos con goce (paternidad 10 días, sueldo 100%, 0 prima vacacional) vs permisos sin goce (3 días, deducción de 150,000¢ del sueldo base).
     8. Case 9: Tope de exención fiscal 15 UMA (Alta Dirección: 10 días, salario 250,000¢, prima 625,000¢, exento 169,710¢, gravado 455,290¢, invariante exacta).
     9. Case 10: Deduplicación e idempotencia con solicitudes solapadas (7 días civiles únicos).
     10. Case 11: Prestación contractual superior (prima al 50% = 150,000¢) y protección contra porcentaje inferior al mínimo legal del 25%.
     11. Case 12: Saldo resuelto desde `leaveBalances` (fallback secundario cuando `vacationAccruals` no está disponible).

4. **`tests/integration/payroll-db.test.ts`** (MODIFICADO):
   - Aprovisionamiento de `"vacation_accruals"` y `"leave_balances"` en `provisionRuntimeRole`.
   - 4 pruebas de integración V2 ejecutadas contra Neon Postgres real (`.env.test`) con rol `pulso_app` (`NOBYPASSRLS`):
     1. `NOM-02.c1 V2: Cálculo de vacaciones autorizadas y prima vacacional 25% LFT desde Postgres real`:
        Inserta `vacation_accruals` (12 días) y `vacation_requests` (6 días APPROVED), ejecuta `calculateEmployeePayroll` y verifica 6 días, prima 75,000¢, saldo remanente 6 y `totalPercepcionesCents`.
     2. `NOM-02.c1 V2: Validación de saldo de vacaciones en base de datos real (saldo parcial / excedido)`:
        Inserta saldo de 3 días y solicitud de 5 días APPROVED; verifica 3 días elegibles, 2 días excedidos, prima 37,500¢, saldo remanente 0 y justificación `EXCEEDED_VACATION_BALANCE`.
     3. `NOM-02.c1 V2: Permiso sin goce descuenta sueldo base vs permiso con goce mantiene sueldo íntegro sin prima vacacional`:
        Inserta permiso con goce de 3 días (`isPaid: true`) y permiso sin goce de 2 días (`isPaid: false`); verifica que descuenta 2 días del sueldo base (650,000¢ de 750,000¢) y genera 0¢ de prima vacacional.
     4. `NOM-02.c1 V2: Aislamiento multi-empresa de vacaciones y saldos bajo pulso_app (NOBYPASSRLS)`:
        Verifica bloqueo RLS `42501` al intentar insertar corridas para otra empresa, procesa vacaciones legítimas de Empresa A y confirma que usuario B no es accesible bajo contexto A.

5. **`tasks/evidencia/2026-11-11/NOM-02.c1/README.md`** (NUEVO):
   - Este documento formal de evidencia técnica.

---

## 2. Comandos y Verificación

### 2.1 Pruebas Unitarias V1 (Nómina Integral: NOM-01, NOM-02.a, NOM-02.b, NOM-02.c1)
```bash
pnpm exec vitest run lib/services/__tests__/payroll-nom01-contract.test.ts lib/services/__tests__/payroll-nom02a-attendance.test.ts lib/services/__tests__/payroll-nom02b-overtime.test.ts lib/services/__tests__/payroll-nom02c1-vacations.test.ts
```
**Resultado:** Exit code `0`
```
 ✓ lib/services/__tests__/payroll-nom02c1-vacations.test.ts (15 tests) 70ms
 ✓ lib/services/__tests__/payroll-nom01-contract.test.ts (17 tests) 77ms
 ✓ lib/services/__tests__/payroll-nom02b-overtime.test.ts (15 tests) 249ms
 ✓ lib/services/__tests__/payroll-nom02a-attendance.test.ts (16 tests) 241ms

 Test Files  4 passed (4)
      Tests  63 passed (63)
   Duration  15.09s
```

### 2.2 Pruebas de Integración V2 en Postgres Real (`pulso_app`, `NOBYPASSRLS`)
```bash
pnpm exec vitest run --config vitest.integration.config.ts tests/integration/payroll-db.test.ts
```
**Resultado:** Exit code `0`
```
 ✓ tests/integration/payroll-db.test.ts (14 tests) 23222ms
     ✓ verifica runtime pulso_app con rolsuper: false y rolbypassrls: false en Postgres aislado  740ms
     ✓ NOM-01 V2: isPayrollPeriodFrozen y bloqueo de executePayrollRun en período completado  960ms
     ✓ NOM-01 V2: Inmutabilidad de recibos previos frente a incrementos salariales posteriores  937ms
     ✓ NOM-02.a V2: Rechazo estricto de asistencia pendiente en base de datos real  1848ms
     ✓ NOM-02.a V2: Cálculo de base salarial desde asistencia aprobada, faltas y festivos en DB real  1684ms
     ✓ aislamiento multi-empresa bajo pulso_app (NOBYPASSRLS)  1058ms
     ✓ NOM-02.b V2: Cálculo de horas extra en base de datos real con sesiones aprobadas y bandas dobles/triples  1700ms
     ✓ NOM-02.b V2: Persistencia en payroll_payslips.overtime_pay_cents y protección de período congelado  1845ms
     ✓ NOM-02.b V2: Solicitud de horas extra rechazada en shift_approvals produce pago 0  1649ms
     ✓ NOM-02.b V2: Aislamiento multi-empresa de horas extra bajo pulso_app (NOBYPASSRLS)  1894ms
     ✓ NOM-02.c1 V2: Cálculo de vacaciones autorizadas y prima vacacional 25% LFT desde Postgres real  1632ms
     ✓ NOM-02.c1 V2: Validación de saldo de vacaciones en base de datos real (saldo parcial / excedido)  1568ms
     ✓ NOM-02.c1 V2: Permiso sin goce descuenta sueldo base vs permiso con goce mantiene sueldo íntegro sin prima vacacional  1708ms
     ✓ NOM-02.c1 V2: Aislamiento multi-empresa de vacaciones y saldos bajo pulso_app (NOBYPASSRLS)  1971ms

 Test Files  1 passed (1)
      Tests  14 passed (14)
   Duration  31.55s
```

### 2.3 Verificación de Estilo y Calidad (ESLint)
```bash
pnpm exec eslint lib/services/payroll-service.ts lib/services/compliance/payroll-calculator.ts lib/services/__tests__/payroll-nom02c1-vacations.test.ts tests/integration/payroll-db.test.ts
```
**Resultado:** Exit code `0` (0 errores).

### 2.4 Verificación de Matriz de Trazabilidad Documental
```bash
pnpm exec tsx scripts/validate-faltantes.ts
```
**Resultado:** Exit code `0`
```json
{
  "rows": 239,
  "planTasks": 86,
  "children": 92,
  "acceptedTasks": 21,
  "errors": 0,
  "scope": "Integridad documental; no acredita aceptación operativa ni despliegue."
}
```

---

## 3. Matriz de Casos y Oráculos Aritméticos

| Caso | Escenario | Días Solicitados | Saldo Disponible | Salario Diario | Días Elegibles | Días Excedidos | Prima Vacacional | Justificación | SAT Concepto 021 |
|---|---|---|---|---|---|---|---|---|---|
| **Case 1** | Normal con saldo suficiente | 6 días | 12 días | 50,000¢ ($500) | 6 días | 0 días | 75,000¢ ($750) | `LFT_ARTS_76_80` | Exento: 75,000¢, Gravado: 0¢ |
| **Case 2** | Saldo parcial | 6 días | 4 días | 50,000¢ ($500) | 4 días | 2 días | 50,000¢ ($500) | `EXCEEDED_VACATION_BALANCE` | Exento: 50,000¢, Gravado: 0¢ |
| **Case 3** | Sin saldo acumulado | 5 días | 0 días | 50,000¢ ($500) | 0 días | 5 días | 0¢ | `EXCEEDED_VACATION_BALANCE` | No emitir nodo 021 |
| **Case 4** | Ausencia total de datos | 0 días | N/A | 50,000¢ ($500) | 0 días | 0 días | 0¢ | `SIN_VACACIONES` | No emitir nodo 021 (0 faltas) |
| **Case 5** | Solicitud rechazada / cancelada | 5 días (REJECTED) | 10 días | 50,000¢ ($500) | 0 días | 0 días | 0¢ | `SIN_VACACIONES` | No emitir nodo 021 |
| **Case 6** | Solicitud pendiente (PENDING) | 5 días (PENDING) | 10 días | 50,000¢ ($500) | 0 días | 0 días | 0¢ | `SIN_VACACIONES` | No emitir nodo 021 |
| **Case 7** | Permiso con goce (Paternidad 10d) | 10 días con goce | N/A | 50,000¢ ($500) | N/A | N/A | 0¢ prima (sueldo 100%) | N/A | Salario base íntegro sin prima |
| **Case 8** | Permiso sin goce (3 días) | 3 días sin goce | N/A | 50,000¢ ($500) | N/A | N/A | 0¢ (deduce 150,000¢) | N/A | Salario base deducido en 150,000¢ |
| **Case 9** | Superación de tope 15 UMA (Directivo) | 10 días | 20 días | 250,000¢ ($2,500) | 10 días | 0 días | 625,000¢ ($6,250) | `LFT_ARTS_76_80` | Exento: 169,710¢, Gravado: 455,290¢ |
| **Case 10** | Deduplicación e idempotencia | Solicitudes solapadas | 15 días | 50,000¢ ($500) | 7 días únicos | 0 días | 87,500¢ | `LFT_ARTS_76_80` | No duplica días ni centavos |
| **Case 11** | Prestación superior (Prima 50%) | 6 días | 12 días | 50,000¢ ($500) | 6 días | 0 días | 150,000¢ ($1,500) | `LFT_ARTS_76_80` | Exento: 150,000¢, Gravado: 0¢ |
| **Case 12** | Saldo desde `leaveBalances` | 5 días | 8 días | 50,000¢ ($500) | 5 días | 0 días | 62,500¢ | `LFT_ARTS_76_80` | Fallback secundario verificado |
