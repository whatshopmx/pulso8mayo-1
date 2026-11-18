import fs from 'node:fs';

const targetPath = 'C:\\Users\\david\\.gemini\\antigravity-cli\\brain\\a2d30b85-62d1-42df-9407-98fcfa144526\\scratch\\.agents\\teamwork\\teamwork_worker_ola4_b\\handoff.md';

const handoffContent = `# Handoff Report — Worker Frente B (M-B4: NOM-02.c1)

## 1. Observation
### File Modifications & Ownership (Strict 5 Files)
1. \`lib/services/payroll-service.ts\`:
   - Lines 52-54: Exported types \`VacationPeriodBreakdown\`, \`LeavePeriodBreakdown\`, \`ResolveVacationsInput\`, \`ResolveLeavesInput\`.
   - Lines 188-212: Updated \`AttendancePeriodResolution\` interface with \`vacationDates: string[]\`, \`otherPaidLeaveDates: string[]\`, \`unpaidLeaveDates: string[]\`.
   - Lines 254-325: Implemented separation of \`vacationDates\` vs \`otherPaidLeaveDates\` vs \`unpaidLeaveDates\` in \`resolveAttendanceForPeriod\`.
   - Lines 420-580: Implemented \`resolveVacationsForPeriod\` and \`resolveLeavesForPeriod\` with \`vacationRequests\` (status \`APPROVED\`), balance resolution (\`vacationAccruals\` / \`leaveBalances\`), idempotency via date Sets, eligible vs exceeded day calculations, and 25% minimum prime (\`LFT Art. 80\`) in integer cents (\`vacationPrimeCents = Math.round((vacationBasePayCents * bonusPercent) / 100)\`).
   - Lines 720-745: Updated \`calculateEmployeePayroll\` to resolve vacations, compute \`vacationPrimeCents\`, and sum into \`totalPercepcionesCents = baseSalaryCents + tipsCents + holidayPayCents + overtimePayCents + vacationPrimeCents\`.
   - Lines 860-890: Updated \`construirDesgloseNomina\` to emit CFDI concept \`021\` ("Prima vacacional (Art. 80 LFT)") with 15 UMA exemption (\`exemptAmount = Math.min(vacationPrimeCents, 169710)\`, \`taxedAmount = vacationPrimeCents - exemptAmount\`).
2. \`lib/services/compliance/payroll-calculator.ts\`:
   - Lines 10-14: Imported \`resolveVacationsForPeriod\` and \`type VacationPeriodBreakdown\`.
   - Lines 58-62: Extended \`PayrollEmployeeRecord\` with \`vacationPrimePay?: number\`, \`vacationPrimePayCents?: number\`, \`vacationBreakdown?: VacationPeriodBreakdown\`.
   - Lines 235-265: Enriched records in \`calculatePayrollData\`.
   - Lines 365-375: Added \`Prima_Vacacional\` in generic CSV output of \`payrollToCSV\`.
3. \`lib/services/__tests__/payroll-nom02c1-vacations.test.ts\`:
   - Newly created suite with 15 tests covering normal 25%, partial balance, zero balance, no data / anti-inference, rejected/pending requests, paid/unpaid leaves, 15 UMA cap, idempotency, 50% superior bonus, and \`leaveBalances\` fallback.
4. \`tests/integration/payroll-db.test.ts\`:
   - Lines 44-46: Provisioned \`vacation_accruals\` and \`leave_balances\` in runtime role permissions.
   - Lines 625-860: Added describe block \`NOM-02.c1 V2: Vacaciones, saldos, prima vacacional y RLS en Postgres aislado\` with 4 tests (normal vacation calculation, partial balance validation, paid vs unpaid leaves, cross-tenant isolation under \`pulso_app\` NOBYPASSRLS).
5. \`tasks/evidencia/2026-11-11/NOM-02.c1/README.md\`:
   - Newly created technical evidence document with diff summary, commands, outputs, and oracle arithmetic table.

### Command Execution Outputs
- **Unit Tests:**
  \`pnpm.cmd exec vitest run lib/services/__tests__/payroll-nom01-contract.test.ts lib/services/__tests__/payroll-nom02a-attendance.test.ts lib/services/__tests__/payroll-nom02b-overtime.test.ts lib/services/__tests__/payroll-nom02c1-vacations.test.ts\`
  Output: \`Test Files 4 passed (4) | Tests 63 passed (63)\`
- **Integration Tests:**
  \`pnpm.cmd exec vitest run --config vitest.integration.config.ts tests/integration/payroll-db.test.ts\`
  Output: \`Test Files 1 passed (1) | Tests 14 passed (14)\`
- **ESLint:**
  \`pnpm.cmd exec eslint lib/services/payroll-service.ts lib/services/compliance/payroll-calculator.ts lib/services/__tests__/payroll-nom02c1-vacations.test.ts tests/integration/payroll-db.test.ts\`
  Output: \`✖ 19 problems (0 errors, 19 warnings)\` (0 errors across all 4 files)
- **Matrix Consistency:**
  \`pnpm.cmd exec tsx scripts/validate-faltantes.ts\`
  Output: \`Validation passed: all tasks and modules in sync.\`

---

## 2. Logic Chain
1. **LFT Legal Requirements (Arts. 76, 79, 80, 81):**
   - Employees are entitled to annual paid vacation days based on years of service.
   - Vacation periods must pay 100% regular salary during vacation days (\`baseSalaryCents\`).
   - LFT Art. 80 requires an additional vacation prime of at least 25% over the salary corresponding to vacation days.
   - Formula implemented: \`vacationPrimeCents = Math.round((vacationDaysEligible * dailySalaryCents * vacationBonusPercent) / 100)\` using integer arithmetic in cents.
2. **Saldo Validation & Eligible vs Exceeded Days:**
   - Approved requests (\`status = 'APPROVED'\`) are queried from \`vacation_requests\`.
   - Balances are validated against \`vacation_accruals\` (with fallback to \`leave_balances\` for \`VACATION\`).
   - If available balance (\`daysBalance\`) is less than requested vacation days:
     - \`vacationDaysEligible = Math.min(requestedDays, availableBalance)\`.
     - \`vacationDaysExceeded = Math.max(0, requestedDays - availableBalance)\`.
     - Only eligible days earn vacation prime.
3. **Absence of Data & Anti-Inference:**
   - When no approved vacation requests exist in the period, the system returns \`justification: "SIN_VACACIONES"\`, \`vacationDays: 0\`, and \`vacationPrimeCents: 0\`.
   - It strictly does NOT invent absences or penalize the employee.
4. **SAT CFDI Concept 021 & LISR Art. 93 Frac. XIV Exemption:**
   - Vacation prime is reported under SAT concept code \`021\` ("Prima vacacional (Art. 80 LFT)").
   - 2026 UMA is $113.14 MXN (11,314¢).
   - 15 UMAs cap = 15 * 11,314¢ = 169,710¢.
   - \`exemptAmount = Math.min(vacationPrimeCents, 169710)\`.
   - \`taxedAmount = vacationPrimeCents - exemptAmount\`.
   - Invariant: \`exemptAmount + taxedAmount === vacationPrimeCents\`.
   - If \`vacationPrimeCents === 0\`, SAT concept \`021\` is omitted from payroll breakdown.
5. **Leaves (Paid vs Unpaid):**
   - Paid leaves (\`isPaid: true\`) pay 100% regular base salary and generate 0¢ vacation prime.
   - Unpaid leaves (\`isPaid: false\`) are classified as \`unpaidAbsenceDays\`, deducting the daily wage from \`payableDays\` and reducing \`baseSalaryCents\`.
6. **Multi-Tenant Isolation:**
   - Isolated Neon Postgres tests run under role \`pulso_app\` (\`NOBYPASSRLS\`).
   - Direct cross-company inserts into \`payroll_runs\` fail with Postgres error code \`42501\`.
   - Company A cannot access or compute payroll for Company B employees.

---

## 3. Caveats
- **Schema Migrations:** As mandated by the dispatch rules, zero schema changes were made. The existing columns in \`vacation_requests\`, \`vacation_accruals\`, \`leave_requests\`, and \`leave_types\` provided complete support for all NOM-02.c1 calculations.
- **Table RLS Status:** \`vacation_accruals\` does not currently have row-level security enabled at the table level in Neon; tenant isolation is strictly enforced via business logic queries and row-level security on \`payroll_runs\` and \`company\` relations.
- **External Network Requirement:** Integration tests connect to Neon Postgres (\`.env.test\`), which requires unsandboxed execution (\`BypassSandbox: true\`) in order to resolve the external DNS endpoint.

---

## 4. Conclusion
- Increment M-B4 (NOM-02.c1) is fully implemented, compliant with Mexican Labor Law (LFT) and Tax Law (LISR).
- All 5 assigned files are updated or created with genuine, non-dummy logic.
- 63/63 unit tests and 14/14 integration tests pass with 0 ESLint errors and 0 matrix validation issues.
- The implementation is robust, production-ready, and ready for forensic audit by \`teamwork_auditor\`.

---

## 5. Verification Method
### Independent Verification Commands
1. **Run Unit Tests (63 tests):**
   \`\`\`bash
   pnpm.cmd exec vitest run lib/services/__tests__/payroll-nom01-contract.test.ts lib/services/__tests__/payroll-nom02a-attendance.test.ts lib/services/__tests__/payroll-nom02b-overtime.test.ts lib/services/__tests__/payroll-nom02c1-vacations.test.ts
   \`\`\`
2. **Run Integration Tests (14 tests against Neon Postgres):**
   \`\`\`bash
   pnpm.cmd exec vitest run --config vitest.integration.config.ts tests/integration/payroll-db.test.ts
   \`\`\`
3. **Run Linter (0 errors):**
   \`\`\`bash
   pnpm.cmd exec eslint lib/services/payroll-service.ts lib/services/compliance/payroll-calculator.ts lib/services/__tests__/payroll-nom02c1-vacations.test.ts tests/integration/payroll-db.test.ts
   \`\`\`
4. **Validate Documentation Matrix (0 errors):**
   \`\`\`bash
   pnpm.cmd exec tsx scripts/validate-faltantes.ts
   \`\`\`

### Invalidation Conditions
- Any floating-point rounding error in \`vacationPrimeCents\` or SAT exemption breakdown.
- Any modification outside the 5 authorized files.
- Any failure in the 15 new V1 unit tests or 4 new V2 integration tests.
`;

fs.writeFileSync(targetPath, handoffContent, 'utf-8');
console.log('Handoff written successfully to:', targetPath);

// Also update BRIEFING.md
const briefingPath = 'C:\\Users\\david\\.gemini\\antigravity-cli\\brain\\a2d30b85-62d1-42df-9407-98fcfa144526\\scratch\\.agents\\teamwork\\teamwork_worker_ola4_b\\BRIEFING.md';
let briefing = fs.readFileSync(briefingPath, 'utf-8');

briefing = briefing.replace(
  /- \*\*Files modified\*\*: TBD[\s\S]*?- \*\*Pending issues\*\*: Ninguno/,
  `- **Files modified**:
  1. lib/services/payroll-service.ts (resolveVacationsForPeriod, vacationPrimeCents, SAT 021)
  2. lib/services/compliance/payroll-calculator.ts (vacationPrimePay, vacationBreakdown)
  3. lib/services/__tests__/payroll-nom02c1-vacations.test.ts (15 tests V1)
  4. tests/integration/payroll-db.test.ts (4 tests V2)
  5. tasks/evidencia/2026-11-11/NOM-02.c1/README.md (evidence log)
- **Build status**: 63/63 V1 tests PASS, 14/14 V2 tests PASS
- **Pending issues**: None (completed)`
);

briefing = briefing.replace(
  /- \*\*Build\/test result\*\*: TBD[\s\S]*?- \*\*Tests added\/modified\*\*: TBD/,
  `- **Build/test result**: PASS (63 V1 tests pass, 14 V2 tests pass)
- **Lint status**: 0 errors (19 pre-existing any warnings in payroll-service.ts)
- **Tests added/modified**: 15 new V1 tests in payroll-nom02c1-vacations.test.ts, 4 new V2 tests in payroll-db.test.ts`
);

fs.writeFileSync(briefingPath, briefing, 'utf-8');
console.log('BRIEFING updated successfully to:', briefingPath);
