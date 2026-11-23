import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { resolveVacationsForPeriod } from "@/lib/services/payroll-service";

const pg = new PGlite();
const database = drizzle(pg);
const companyId = "aaaaaaaa-0000-4000-8000-000000000001";
const otherCompanyId = "bbbbbbbb-0000-4000-8000-000000000002";
const userId = "vacation-period-user";
const typeId = "aaaaaaaa-0000-4000-8000-000000000003";

beforeAll(async () => {
  await pg.exec(`
    CREATE TABLE vacation_accruals (
      user_id text, company_id uuid, year integer, period_start timestamp, days_balance integer
    );
    CREATE TABLE leave_types (id uuid PRIMARY KEY, company_id uuid, name text);
    CREATE TABLE leave_balances (user_id text, leave_type_id uuid, year integer, balance integer);
  `);
});
beforeEach(async () => {
  await pg.exec("TRUNCATE vacation_accruals, leave_balances, leave_types");
});
afterAll(async () => { await pg.close(); });

function resolve() {
  return resolveVacationsForPeriod({
    userId, companyId, startDate: "2026-05-01", endDate: "2026-05-15",
    dailySalaryCents: 50000,
    vacationRequests: [{ startDate: "2026-05-04", endDate: "2026-05-09", status: "APPROVED" }],
    dbInstance: database,
  });
}

it("SQL: excluye años futuros, acumulaciones posteriores y otra empresa; incluye el último microsegundo del cierre", async () => {
  await pg.query(`INSERT INTO vacation_accruals VALUES
    ($1, $2, 2026, '2026-05-15 23:59:59.999999', 2),
    ($1, $2, 2026, '2026-05-16 00:00:00', 10),
    ($1, $2, 2027, '2026-01-01', 12),
    ($1, $3, 2026, '2026-01-01', 12)`, [userId, companyId, otherCompanyId]);
  const result = await resolve();
  expect(result.vacationBalanceStatus).toBe("AVAILABLE");
  expect(result.vacationAvailableBalance).toBe(2);
  expect(result.vacationDaysEligible).toBe(2);
  expect(result.vacationPrimeCents).toBe(25000);
});

it("SQL: saldo cero registrado es AVAILABLE aunque haya acumulaciones futuras", async () => {
  await pg.query(`INSERT INTO vacation_accruals VALUES
    ($1, $2, 2026, '2026-01-01', 0), ($1, $2, 2027, '2027-01-01', 12)`, [userId, companyId]);
  const result = await resolve();
  expect(result.vacationBalanceStatus).toBe("AVAILABLE");
  expect(result.justification).toBe("EXCEEDED_VACATION_BALANCE");
  expect(result.vacationAvailableBalance).toBe(0);
});

it("SQL: sin saldo aplicable queda MISSING", async () => {
  await pg.query("INSERT INTO vacation_accruals VALUES ($1, $2, 2027, '2027-01-01', 12)", [userId, companyId]);
  const result = await resolve();
  expect(result.vacationBalanceStatus).toBe("MISSING");
  expect(result.justification).toBe("VACATION_BALANCE_MISSING");
});

it("SQL: fallback excluye saldos futuros y tipos de otra empresa", async () => {
  await pg.query("INSERT INTO leave_types VALUES ($1, $2, 'VACATION'), ($3, $4, 'VACATION')",
    [typeId, companyId, otherCompanyId, otherCompanyId]);
  await pg.query(`INSERT INTO leave_balances VALUES
    ($1, $2, 2026, 1), ($1, $2, 2027, 12), ($1, $3, 2026, 12)`, [userId, typeId, otherCompanyId]);
  const result = await resolve();
  expect(result.vacationBalanceStatus).toBe("AVAILABLE");
  expect(result.vacationAvailableBalance).toBe(1);
  expect(result.vacationPrimeCents).toBe(12500);
});

it("SQL: errores de lectura se conservan como QUERY_ERROR", async () => {
  await pg.exec("ALTER TABLE vacation_accruals RENAME TO unavailable_accruals");
  try {
    const result = await resolve();
    expect(result.vacationBalanceStatus).toBe("QUERY_ERROR");
    expect(result.justification).toBe("VACATION_BALANCE_QUERY_ERROR");
    expect(result.vacationPrimeCents).toBe(0);
  } finally {
    await pg.exec("ALTER TABLE unavailable_accruals RENAME TO vacation_accruals");
  }
});
