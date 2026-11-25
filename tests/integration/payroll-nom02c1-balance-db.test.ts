import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { beforeAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { branches, companies, leaveRequests, leaveTypes, users, vacationAccruals } from "@/lib/db/schema";
import { setTenantContext } from "@/lib/db/tenant-context";
import { provisionRuntimeRole } from "./helpers/runtime-role";
import { resolveLeavesForPeriod, resolveVacationsForPeriod } from "@/lib/services/payroll-service";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Fixtures = { company: string[]; branch: string[]; user: string[] };

const approved = [
  { startDate: "2026-11-04", endDate: "2026-11-09", totalDays: 6, status: "APPROVED" },
];

beforeAll(async () => {
  await provisionRuntimeRole([
    "companies",
    "branches",
    "users",
    "vacation_accruals",
    "leave_balances",
    "leave_types",
    "leave_requests",
    "vacation_requests",
  ]);
});

/**
 * Ejecuta `setup` como dueño y `check` bajo `pulso_app` (NOBYPASSRLS) dentro de
 * una transacción que siempre revierte. `resolveVacationsForPeriod` recibe el
 * `tx` para que sus consultas corran con el rol y el contexto de tenant reales.
 */
async function probe(
  setup: (tx: Tx, f: Fixtures) => Promise<void>,
  check: (tx: Tx, f: Fixtures) => Promise<void>,
) {
  const host = (url: string) => new URL(url).hostname.replace(/-pooler(?=\.)/, "");
  expect(host(process.env.TEST_DATABASE_URL!)).not.toBe(host(parse(readFileSync(".env")).DATABASE_URL));

  const f: Fixtures = {
    company: [randomUUID(), randomUUID()],
    branch: [randomUUID(), randomUUID()],
    user: [`u-${randomUUID()}`, `u-${randomUUID()}`],
  };
  const rollback = new Error("NOM-02.c1 balance fixture rollback");
  try {
    await db.transaction(async (tx) => {
      await tx.insert(companies).values(f.company.map((id) => ({ id, name: "Synthetic NOM-02.c1 company" })));
      await tx.insert(branches).values(f.branch.map((id, n) => ({ id, companyId: f.company[n], name: "Synthetic branch" })));
      await tx.insert(users).values(f.user.map((id, n) => ({
        id, name: "Synthetic payroll user", email: `${id}@nom02c1.test`,
        createdAt: new Date(), updatedAt: new Date(), companyId: f.company[n],
      })));

      await setup(tx, f);

      await setTenantContext(tx, { companyId: f.company[0], branchId: f.branch[0] });
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      const role = (await tx.execute(sql`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0];
      expect(role).toMatchObject({ rolbypassrls: false, rolsuper: false });

      await check(tx, f);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  for (const id of f.company) {
    expect(await db.select({ id: companies.id }).from(companies).where(eq(companies.id, id))).toEqual([]);
  }
}

function resolve(tx: Tx, f: Fixtures) {
  return resolveVacationsForPeriod({
    userId: f.user[0],
    companyId: f.company[0],
    startDate: "2026-11-01",
    endDate: "2026-11-15",
    dailySalaryCents: 50000,
    vacationRequests: approved,
    dbInstance: tx,
  });
}

it("NOM-02.c1 V2: saldo real con fila de accrual es AVAILABLE", async () => {
  await probe(
    async (tx, f) => {
      await tx.insert(vacationAccruals).values({
        userId: f.user[0],
        companyId: f.company[0],
        year: 2026,
        daysAccrued: 12,
        daysTaken: 12,
        daysBalance: 0,
        yearsOfService: 1,
        applicableLawDays: 12,
        periodStart: new Date("2026-01-01"),
        periodEnd: new Date("2026-12-31"),
      });
    },
    async (tx, f) => {
      const res = await resolve(tx, f);
      expect(res.vacationBalanceStatus).toBe("AVAILABLE");
      expect(res.vacationAvailableBalance).toBe(0);
      expect(res.vacationDaysTaken).toBe(6);
      expect(res.vacationDaysEligible).toBe(0);
      expect(res.justification).toBe("EXCEEDED_VACATION_BALANCE");
    },
  );
});

it("NOM-02.c1 V2: sin accrual ni saldo es MISSING, no EXCEEDED", async () => {
  await probe(
    async () => {},
    async (tx, f) => {
      const res = await resolve(tx, f);
      expect(res.vacationBalanceStatus).toBe("MISSING");
      expect(res.vacationPrimeCents).toBe(0);
      expect(res.justification).toBe("VACATION_BALANCE_MISSING");
      expect(res.justification).not.toBe("EXCEEDED_VACATION_BALANCE");
    },
  );
});

it("NOM-02.c1 V2: SELECT revocado sobre vacation_accruals produce QUERY_ERROR", async () => {
  await probe(
    async (tx) => {
      await tx.execute(sql.raw("REVOKE SELECT ON public.vacation_accruals FROM pulso_app"));
    },
    async (tx, f) => {
      const res = await resolve(tx, f);
      expect(res.vacationBalanceStatus).toBe("QUERY_ERROR");
      expect(res.vacationPrimeCents).toBe(0);
      expect(res.justification).toBe("VACATION_BALANCE_QUERY_ERROR");
      expect(res.justification).not.toBe("EXCEEDED_VACATION_BALANCE");
    },
  );
});

it("NOM-02.c1 V2: accrual de otra empresa no se lee para la empresa 0", async () => {
  await probe(
    async (tx, f) => {
      // Accrual de la empresa 1 (otra empresa); la empresa 0 no debe verlo.
      await tx.insert(vacationAccruals).values({
        userId: f.user[1],
        companyId: f.company[1],
        year: 2026,
        daysAccrued: 12,
        daysTaken: 0,
        daysBalance: 12,
        yearsOfService: 1,
        applicableLawDays: 12,
        periodStart: new Date("2026-01-01"),
        periodEnd: new Date("2026-12-31"),
      });
    },
    async (tx, f) => {
      const res = await resolve(tx, f);
      expect(res.vacationBalanceStatus).toBe("MISSING");
      expect(res.vacationAvailableBalance).toBe(0);
    },
  );
});

it("NOM-02.c1 V2: permisos con goce y sin goce se enlazan por empresa y no filtran otra empresa", async () => {
  await probe(
    async (tx, f) => {
      const [paidType] = await tx.insert(leaveTypes).values({
        companyId: f.company[0],
        name: "PATERNITY_SYNTH",
        isPaid: true,
        daysPerYear: 5,
      }).returning({ id: leaveTypes.id });
      const [unpaidType] = await tx.insert(leaveTypes).values({
        companyId: f.company[0],
        name: "UNPAID_SYNTH",
        isPaid: false,
        daysPerYear: 10,
      }).returning({ id: leaveTypes.id });
      const [otherType] = await tx.insert(leaveTypes).values({
        companyId: f.company[1],
        name: "OTHER_PAID_SYNTH",
        isPaid: true,
        daysPerYear: 5,
      }).returning({ id: leaveTypes.id });

      await tx.insert(leaveRequests).values([
        {
          companyId: f.company[0],
          userId: f.user[0],
          leaveTypeId: paidType.id,
          startDate: new Date("2026-11-02T12:00:00Z"),
          endDate: new Date("2026-11-03T12:00:00Z"),
          totalDays: 2,
          reason: "Permiso con goce sintético",
          status: "APPROVED",
        },
        {
          companyId: f.company[0],
          userId: f.user[0],
          leaveTypeId: unpaidType.id,
          startDate: new Date("2026-11-10T12:00:00Z"),
          endDate: new Date("2026-11-10T12:00:00Z"),
          totalDays: 1,
          reason: "Permiso sin goce sintético",
          status: "APPROVED",
        },
        {
          companyId: f.company[1],
          userId: f.user[1],
          leaveTypeId: otherType.id,
          startDate: new Date("2026-11-05T12:00:00Z"),
          endDate: new Date("2026-11-07T12:00:00Z"),
          totalDays: 3,
          reason: "Permiso empresa ajena sintético",
          status: "APPROVED",
        },
      ]);
    },
    async (tx, f) => {
      const leaves = await resolveLeavesForPeriod({
        userId: f.user[0],
        companyId: f.company[0],
        startDate: "2026-11-01",
        endDate: "2026-11-15",
        dbInstance: tx,
      });
      expect(leaves.leavesStatus).toBe("AVAILABLE");
      expect(leaves.paidLeaveDays).toBe(2);
      expect(leaves.unpaidLeaveDays).toBe(1);
      expect(leaves.details).toHaveLength(2);
    },
  );
});
