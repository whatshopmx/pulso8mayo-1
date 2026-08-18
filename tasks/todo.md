# Todo List: Propinas to Payroll (CFDI) Integration

Plan: `implementation_plan.md`

## Phase 1: Database Foundation

- [ ] **Task 1: Add payroll schema tables**
  - **Description:** Add `payroll_runs` and `payroll_payslips` tables to `lib/db/schema.ts`.
  - **Acceptance criteria:**
    - [ ] `payroll_runs` table exists tracking period dates and status.
    - [ ] `payroll_payslips` table exists tracking base salary, propinas, and CFDI uuid.
  - **Verification:**
    - [ ] Run `pnpm db:generate` and ensure migrations generate without errors.
  - **Dependencies:** None
  - **Files:** `lib/db/schema.ts`
  - **Scope:** S

## Phase 2: Core Features & Logic

- [x] **Task 2: Implement payroll service calculation logic**
  - **Description:** Create `payroll-service.ts` to aggregate tips from `propina_asignaciones` and retrieve base salary from `employeeProfiles` for a given period.
  - **Acceptance criteria:**
    - [ ] `calculateEmployeePayroll` correctly sums all tips in the given date range for the user.
    - [ ] `executePayrollRun` calls `timbrarNomina` from `fiscal-service.ts`.
  - **Verification:**
    - [ ] Build succeeds `npm run build`.
  - **Dependencies:** Task 1
  - **Files:** `lib/services/payroll-service.ts`, `lib/services/propinas-service.ts`
  - **Scope:** M

- [x] **Task 3: Create API Route for Payroll Runs**
  - **Description:** Create an endpoint to trigger payroll processing from the frontend.
  - **Acceptance criteria:**
    - [ ] `POST /api/payroll/run` exists and receives companyId, startDate, endDate.
    - [ ] Returns structured data including any CFDI generation errors.
  - **Verification:**
    - [ ] Endpoint is callable via Postman or frontend fetch without 500 errors (unless due to missing API keys).
  - **Dependencies:** Task 2
  - **Files:** `app/api/payroll/run/route.ts`
  - **Scope:** S

## Phase 3: Polish (UI)

- [x] **Task 4: Payroll Dashboard Page**
  - **Description:** Create a simple table view to see payroll periods and trigger new runs.
  - **Acceptance criteria:**
    - [x] `app/dashboard/labor/payroll/page.tsx` renders a list of `payroll_runs`.
    - [x] Includes a button to execute a new run for a specific date range.
  - **Verification:**
    - [x] Page loads in dev server without UI errors.
  - **Dependencies:** Task 3
  - **Files:** `app/dashboard/labor/payroll/page.tsx`
  - **Scope:** M

- [x] **Task 5: Pre-Flight RFC Validation UI**
  - **Description:** Add a warning or validation block preventing payroll run if employees are missing their RFC.
  - **Acceptance criteria:**
    - [x] Missing RFC blocks the timbrado execution for that specific employee.
  - **Verification:**
    - [x] Manual test: Try to run payroll with a user that has null RFC.
  - **Dependencies:** Task 4
  - **Files:** `app/dashboard/labor/payroll/page.tsx`
  - **Scope:** S
