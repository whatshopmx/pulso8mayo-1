# Evidencia de Implementación — NOM-02.b

- **ID:** `NOM-02.b`
- **Título:** Incorporar horas extra aprobadas en nómina (LFT Arts. 61, 66, 67, 68 y LISR Art. 93 Frac. I)
- **Frente / Sesión:** Frente B3 (Nómina) — Ola 3
- **Fecha:** 2026-11-15
- **Estado:** Implementado y verificado (46/46 unitarias V1 aprobadas, 10/10 integración V2 en Postgres con `pulso_app` NOBYPASSRLS aprobadas, 0 errores de ESLint)

---

## 1. Archivos Modificados y Creados (Estrictamente 5 archivos)

1. **`lib/services/payroll-service.ts`** (MODIFICADO):
   - Definición y exportación de interfaces `OvertimeWeeklyBreakdown`, `OvertimeBreakdown` y `ResolveOvertimeInput`.
   - Implementación de `calculateOvertimeBreakdown` y `resolveOvertimeForPeriod`:
     - Cuota horaria legal: cuota hora `salarioDiarioCents / 8`, cuota minuto `salarioDiarioCents / 480`.
     - Segregación estricta por semana calendario (Lunes a Domingo) usando `diaCivilEnZona` en la zona operativa y `startOfWeek`.
     - Primeras 9 horas de la semana calendario al 200% (dobles, factor 2.0x, LFT Art. 67).
     - Excedente sobre 9 horas semanales al 300% (triples, factor 3.0x, LFT Art. 68).
     - Aritmética entera exacta en centavos: `Math.round((doubleMinutes * dailySalaryCents * 2) / 480)` y `Math.round((tripleMinutes * dailySalaryCents * 3) / 480)`.
     - Cero justificado cuando no hay horas extra: `overtimePayCents: 0`, `justification: "SIN_HORAS_EXTRA"`, `hasOvertime: false`, `weeklyBreakdown: []`.
     - Justificación con horas extra: `justification: "LFT_ARTS_66_67_68"`.
     - Deduplicación por `sessionId` y descarte de turnos o solicitudes rechazadas (`REJECTED`) o canceladas (`CANCELLED`) (pago 0, conteo en `rejectedCount`).
     - Soporta modo síncrono en memoria (cuando se pasan `sessions`) y modo asíncrono con base de datos transaccional (`dbInstance`).
   - Actualización de `ResolveAttendanceInput` y `resolveAttendanceForPeriod`:
     - Admite `overtimeMinutes` y `rejectionReason` en las sesiones.
     - Lee y evalúa el estatus de solicitudes en `shift_approvals`, evitando catalogar turnos dictaminados como rechazados como asistencias pendientes.
   - Actualización de `calculateEmployeePayroll`:
     - Resuelve `overtimeBreakdown` vía `resolveOvertimeForPeriod`.
     - Asigna `overtimePayCents: overtimeBreakdown.totalPayCents` y `overtimeBreakdown`.
     - Integra `overtimePayCents` en `totalPercepcionesCents`:
       `totalPercepcionesCents = baseSalaryCents + tipsCents + holidayPayCents + overtimePayCents`.
     - Mantiene las invariantes contables y de tesorería (`payrollPlan`, `buildPayrollSnapshot`).
   - Actualización de `construirDesgloseNomina`:
     - Si `overtimePayCents > 0`: incorpora la percepción SAT `"019"` (`Horas extra (LFT Arts. 66-68)`).
     - Aplica el régimen de exención fiscal de la LISR Art. 93 Frac. I:
       - Horas triples: 100% gravadas, 0% exentas.
       - Horas dobles: 50% exentas, 50% gravadas, topadas a 5 UMA/semana (en 2026: UMA diaria = 11,314¢, tope semanal = 56,570¢ por semana en que hubo dobles).
       - Invariante fiscal: `taxedAmount + exemptAmount === overtimePayCents`.
     - Si `overtimePayCents === 0`: no emite el concepto fiscal `"019"` (evita nodos vacíos prohibidos por el SAT).

2. **`lib/services/compliance/payroll-calculator.ts`** (MODIFICADO):
   - Extensión de la interfaz `PayrollEmployeeRecord` con `overtimePay?: number`, `overtimePayCents?: number` y `overtimeBreakdown?: OvertimeBreakdown`.
   - Consulta `id` y `rejectionReason` en `rawSessions`.
   - Invoca `resolveOvertimeForPeriod` para enriquecer cada registro de empleado.
   - Preserva intactos `overtimeHours` y las funciones de exportación `payrollToCSV`, `payrollToContpaqi` y `payrollToNOI` para interoperabilidad con CONTPAQi Nóminas y Aspel NOI.

3. **`lib/services/__tests__/payroll-nom02b-overtime.test.ts`** (NUEVO):
   - Suite completa de 15 pruebas unitarias V1 organizadas en 9 bloques:
     1. Horas extra <= 9h en semana calendario única (6h extra al 200% doble).
     2. Límite frontera exacto de 9.0 horas (540 min al 200%).
     3. Horas extra > 9h en semana calendario única (12h extra segregadas en 9h dobles + 3h triples).
     4. Período quincenal con múltiples semanas calendario (semanas independientes con reinicio de tope de 9h).
     5. Período sin horas extra (cero justificado con `SIN_HORAS_EXTRA` y sin concepto 019 vacío).
     6. Horas extra pendientes de aprobación (bloqueo preventivo en asistencia / pago 0).
     7. Horas extra rechazadas y canceladas (pago 0 e incremento de `rejectedCount`).
     8. Deduplicación e idempotencia (mismo sessionId no duplica minutos).
     9. Integración contable con `totalPercepcionesCents`, `payrollPlan` y `buildPayrollSnapshot`.
     10. Desglose fiscal CFDI concepto 019 bajo LISR Art. 93 Frac. I (casos bajo tope UMA, sobre tope UMA, horas triples y multi-semana).

4. **`tests/integration/payroll-db.test.ts`** (MODIFICADO):
   - Aprovisionamiento de `"shift_approvals"` en `provisionRuntimeRole`.
   - Importación de `shiftApprovals` desde `@/lib/db/schema`.
   - 4 pruebas de integración V2 ejecutadas contra Neon Postgres real con rol `pulso_app` (`NOBYPASSRLS`):
     1. `NOM-02.b V2: Cálculo de horas extra en base de datos real con sesiones aprobadas y bandas dobles/triples`.
     2. `NOM-02.b V2: Persistencia en payroll_payslips.overtime_pay_cents y protección de período congelado`.
     3. `NOM-02.b V2: Solicitud de horas extra rechazada en shift_approvals produce pago 0`.
     4. `NOM-02.b V2: Aislamiento multi-empresa de horas extra bajo pulso_app (NOBYPASSRLS)`.

5. **`tasks/evidencia/2026-11-11/NOM-02.b/README.md`** (NUEVO):
   - Documento de evidencia formal de implementación y resultados de verificación.

---

## 2. Comandos y Verificación

### 2.1 Pruebas Unitarias V1 (Nómina Integral: NOM-01, NOM-02.a, NOM-02.b)
```bash
pnpm vitest run lib/services/__tests__/payroll-nom01-contract.test.ts lib/services/__tests__/payroll-nom02a-attendance.test.ts lib/services/__tests__/payroll-nom02b-overtime.test.ts
```
**Resultado:** Exit code `0`
```
 ✓ lib/services/__tests__/payroll-nom01-contract.test.ts (17 tests) 152ms
 ✓ lib/services/__tests__/payroll-nom02b-overtime.test.ts (15 tests) 365ms
 ✓ lib/services/__tests__/payroll-nom02a-attendance.test.ts (14 tests) 398ms

 Test Files  3 passed (3)
      Tests  46 passed (46)
   Start at  21:20:56
   Duration  18.86s
```

### 2.2 Pruebas de Integración V2 en Postgres Real (`pulso_app`, `NOBYPASSRLS`)
```bash
pnpm vitest run --config vitest.integration.config.ts tests/integration/payroll-db.test.ts
```
**Resultado:** Exit code `0`
```
 ✓ tests/integration/payroll-db.test.ts (10 tests) 29834ms
     ✓ verifica runtime pulso_app con rolsuper: false y rolbypassrls: false en Postgres aislado  1314ms
     ✓ NOM-01 V2: isPayrollPeriodFrozen y bloqueo de executePayrollRun en período completado  1771ms
     ✓ NOM-01 V2: Inmutabilidad de recibos previos frente a incrementos salariales posteriores  1712ms
     ✓ NOM-02.a V2: Rechazo estricto de asistencia pendiente en base de datos real  4146ms
     ✓ NOM-02.a V2: Cálculo de base salarial desde asistencia aprobada, faltas y festivos en DB real  2861ms
     ✓ aislamiento multi-empresa bajo pulso_app (NOBYPASSRLS)  1991ms
     ✓ NOM-02.b V2: Cálculo de horas extra en base de datos real con sesiones aprobadas y bandas dobles/triples  2692ms
     ✓ NOM-02.b V2: Persistencia en payroll_payslips.overtime_pay_cents y protección de período congelado  2989ms
     ✓ NOM-02.b V2: Solicitud de horas extra rechazada en shift_approvals produce pago 0  2732ms
     ✓ NOM-02.b V2: Aislamiento multi-empresa de horas extra bajo pulso_app (NOBYPASSRLS)  3218ms

 Test Files  1 passed (1)
      Tests  10 passed (10)
   Start at  21:28:50
   Duration  45.84s
```

### 2.3 Verificación de Linter (ESLint)
```bash
pnpm exec eslint lib/services/payroll-service.ts lib/services/compliance/payroll-calculator.ts lib/services/__tests__/payroll-nom02b-overtime.test.ts tests/integration/payroll-db.test.ts
```
**Resultado:** Exit code `0` (0 errores, 16 warnings preexistentes de `@typescript-eslint/no-explicit-any`).

---

## 3. Conformidad Normativa y Restricciones del Sistema

- **LFT Arts. 61 y 89**: Cuota horaria legal calculada como cuota diaria / 8 horas.
- **LFT Arts. 66 y 67**: Primeras 9 horas de la semana calendario se remuneran al 200% (tarifa doble).
- **LFT Art. 68**: Excedente sobre 9 horas semanales se remunera al 300% (tarifa triple).
- **Segregación semanal estricta**: Los límites de 9 horas se reinician cada semana calendario (Lunes a Domingo); no se calculan de forma plana sobre la quincena.
- **LISR Art. 93 Fracción I**:
  - Horas triples: 100% gravadas, 0% exentas.
  - Horas dobles: 50% exentas, 50% gravadas, con tope semanal de 5 UMA (56,570 centavos en 2026).
- **Invariante Contable y de Tesorería**:
  - `totalPercepcionesCents` refleja exactamente la suma de sueldo base, propinas, festivos y horas extra.
  - `payrollPlan` genera asientos de reconocimiento consistentes (`PAYROLL_EXPENSE`).
  - `buildPayrollSnapshot` inmutable valida la ecuación patrimonial.
- **Restricción de base de datos**: Cero migraciones (`lib/db/schema*` y `drizzle/meta/*` intactos).
- **Aislamiento de archivos**: Modificaciones limitadas estrictamente a los 5 archivos asignados.
