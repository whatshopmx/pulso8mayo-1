/**
 * EXC-04.presupuesto — Verificación V2 en Neon PostgreSQL real.
 *
 * Comprueba sobre base Postgres aislada (`TEST_DATABASE_URL`) con limpieza
 * determinista en `afterAll`:
 * 1. Gasto fuera de presupuesto (>100% de la partida) nace en
 *    `PENDING_OVERBUDGET_APPROVAL` y crea atómicamente 1 excepción canónica
 *    `budget_overrun` conservando `ruleSnapshot` (umbral, presupuesto,
 *    comprometido previo, excedente, rol requerido >= ADMIN) y `ownerId`
 *    (ADMIN activo distinto de quien solicitó).
 * 2. Repetir `raiseBudgetOverrunException` y ejecutar `budgetOverrunAdapter.run`
 *    dos veces NO duplica la excepción ni sobrescribe `ownerId` ni `ruleSnapshot`.
 * 3. Un `GERENTE` no puede aprobar ni rechazar el gasto fuera de presupuesto
 *    (`403`), ni el solicitante puede auto-aprobarse (`403`).
 * 4. Autorización por `ADMIN` (`approveOperatingExpense`) actualiza el gasto
 *    (`APPROVED`, `overbudgetApprovedBy`, `overbudgetApprovedAt`), cierra la
 *    excepción canónica y escribe bitácora `AUD-02` tanto en `APPROVAL_EXPENSE`
 *    como en `EXCEPTION` dentro de la misma transacción.
 * 5. Rechazo por `ADMIN` (`rejectOperatingExpense`) de un segundo gasto fuera de
 *    presupuesto marca `REJECTED`, cierra su excepción canónica, escribe
 *    bitácora `AUD-02` y libera el compromiso presupuestal; reejecutar el
 *    adaptador NO reabre ni duplica excepciones terminales.
 * 6. Atomicidad ante fallo de auditoría `AUD-02`: si el actor no satisface FK en
 *    `employee_audit_logs`, la transacción revierte por completo (el gasto sigue
 *    `PENDING_OVERBUDGET_APPROVAL` y la excepción sigue `OPEN`).
 * 7. Aislamiento entre empresas: empresa B no puede aprobar un gasto de empresa A.
 */
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import {
  branchBudgets,
  branches,
  companies,
  costCenters,
  employeeAuditLogs,
  exceptions,
  operatingExpenses,
  users,
} from "@/lib/db/schema";

const dbState = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof drizzle<typeof schema>>,
}));

vi.mock("@/lib/db", () => ({
  get db() {
    return dbState.db;
  },
}));

vi.mock("@/lib/services/notification-dispatcher", () => ({
  NotificationDispatcher: {
    sendBatchNotifications: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/lib/services/tenant-config-service", () => ({
  getTenantOperatingConfig: vi.fn().mockResolvedValue({
    managerAuthLimitCents: 200_000,
    doubleApprovalThresholdCents: 1_000_000,
    managerAutonomy: "MEDIA",
  }),
}));

import {
  approveOperatingExpense,
  createOperatingExpense,
  rejectOperatingExpense,
} from "@/lib/services/expense-service";
import {
  BUDGET_OVERRUN_RULE_CODE,
  BUDGET_OVERRUN_SUBJECT_TYPE,
  evaluateOverbudgetRule,
} from "@/lib/services/budget-exception-rules";
import { raiseBudgetOverrunException } from "@/lib/services/budget-exception-service";
import { budgetOverrunAdapter } from "@/lib/services/exception-adapters/budget-overrun";
import { checkBudgetAvailability } from "@/lib/services/budget-service";
import { ExceptionService } from "@/lib/services/exception-service";

const TEST_DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const describeDb = TEST_DB_URL ? describe : describe.skip;

describeDb("EXC-04.presupuesto — Excepción canónica de presupuesto y cierre auditado (V2 Neon)", () => {
  let pool: Pool;
  let testDb: ReturnType<typeof drizzle<typeof schema>>;

  const suffix = crypto.randomBytes(4).toString("hex");
  const namespace = `exc04p_${suffix}`;
  let schemaCreated = false;
  const companyA = crypto.randomUUID();
  const companyB = crypto.randomUUID();
  const branchA = crypto.randomUUID();
  const costCenterA = crypto.randomUUID();
  const gerenteId = `exc04p-ger-${suffix}`;
  const adminId = `exc04p-adm-${suffix}`;
  const ownerId = `exc04p-own-${suffix}`;
  const adminBId = `exc04p-admb-${suffix}`;
  const budgetMonth = "2026-11";
  const businessDate = "2026-11-26";

  beforeAll(async () => {
    // Esquema efímero aislado: no muta `public` en Neon y permite ejercitar
    // columnas candidatas (0148 `voucher_reference`) + FKs/índices reales.
    const setupPool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
    try {
      await setupPool.query(`CREATE SCHEMA "${namespace}"`);
      schemaCreated = true;
      const tablesToClone = [
        "companies",
        "branches",
        "users",
        "cost_centers",
        "branch_budgets",
        "financial_periods",
        "expense_authorization_rules",
        "payees",
        "service_orders",
        "purchase_orders",
        "petty_cash_funds",
        "petty_cash_transactions",
        "operating_expenses",
        "exceptions",
        "employee_audit_logs",
        "domain_events",
      ];
      for (const t of tablesToClone) {
        await setupPool.query(
          `CREATE TABLE "${namespace}"."${t}" (LIKE public."${t}" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`,
        );
      }
      await setupPool.query(
        `ALTER TABLE "${namespace}".operating_expenses ADD COLUMN IF NOT EXISTS voucher_reference text`,
      );
      await setupPool.query(
        `ALTER TABLE "${namespace}".petty_cash_transactions ADD COLUMN IF NOT EXISTS voucher_reference text`,
      );
      await setupPool.query(
        `ALTER TABLE "${namespace}".employee_audit_logs ADD CONSTRAINT exc04p_audit_user_fk FOREIGN KEY (user_id) REFERENCES "${namespace}".users(id)`,
      );
    } finally {
      await setupPool.end();
    }

    pool = new Pool({
      connectionString: TEST_DB_URL,
      max: 6,
      options: `-c search_path=${namespace},public -c timezone=UTC`,
    });
    testDb = drizzle(pool, { schema });
    dbState.db = testDb;

    const now = new Date();
    await testDb.insert(companies).values([
      { id: companyA, name: `EXC04P Co A ${suffix}` },
      { id: companyB, name: `EXC04P Co B ${suffix}` },
    ]);
    await testDb.insert(branches).values({
      id: branchA,
      companyId: companyA,
      name: `Suc EXC04P ${suffix}`,
    });
    await testDb.insert(users).values([
      {
        id: gerenteId,
        email: `${gerenteId}@test.local`,
        name: "Gerente Solicitante",
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
        role: "GERENTE",
        companyId: companyA,
        branchId: branchA,
        active: true,
      },
      {
        id: adminId,
        email: `${adminId}@test.local`,
        name: "Admin Presupuesto",
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
        role: "ADMIN",
        companyId: companyA,
        active: true,
      },
      {
        id: ownerId,
        email: `${ownerId}@test.local`,
        name: "Owner Presupuesto",
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
        role: "OWNER",
        companyId: companyA,
        active: true,
      },
      {
        id: adminBId,
        email: `${adminBId}@test.local`,
        name: "Admin Empresa B",
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
        role: "ADMIN",
        companyId: companyB,
        active: true,
      },
    ]);
    await testDb.insert(costCenters).values({
      id: costCenterA,
      companyId: companyA,
      code: `MNT-${suffix.slice(0, 4).toUpperCase()}`,
      name: "Mantenimiento Cocina",
      active: true,
    });
    // Presupuesto mensual: $1,000.00 MXN (100,000 centavos)
    await testDb.insert(branchBudgets).values({
      branchId: branchA,
      costCenterId: costCenterA,
      month: budgetMonth,
      amount: 100_000,
    });
  });

  afterAll(async () => {
    try {
      await pool?.end();
    } finally {
      if (schemaCreated) {
        const dropPool = new Pool({ connectionString: TEST_DB_URL, max: 1 });
        try {
          await dropPool.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
        } finally {
          await dropPool.end();
        }
      }
    }
  });

  it("conserva regla y responsable, evita duplicados, audita autorización/rechazo/cierre y revierte ante fallo AUD-02", async () => {
    // 1. Gasto inicial dentro de presupuesto: $700.00 MXN (70%) -> PENDING_APPROVAL sin excepción
    const baseExpense = await createOperatingExpense({
      companyId: companyA,
      branchId: branchA,
      costCenterId: costCenterA,
      category: "MANTENIMIENTO",
      amountCents: 70_000,
      description: "Servicio preventivo freidora",
      businessDate,
      requestedBy: gerenteId,
    });
    expect(baseExpense.status).toBe("PENDING_APPROVAL");
    expect(
      await ExceptionService.getBySubject(
        companyA,
        BUDGET_OVERRUN_SUBJECT_TYPE,
        baseExpense.id,
        testDb,
      ),
    ).toBeNull();

    // 2. Segundo gasto empuja a $1,250.00 MXN (125% > 100%) -> PENDING_OVERBUDGET_APPROVAL + excepción canónica
    const overExpense = await createOperatingExpense({
      companyId: companyA,
      branchId: branchA,
      costCenterId: costCenterA,
      category: "MANTENIMIENTO",
      amountCents: 55_000,
      description: "Cambio urgente de compresor",
      businessDate,
      requestedBy: gerenteId,
    });
    expect(overExpense.status).toBe("PENDING_OVERBUDGET_APPROVAL");

    const excInitial = await ExceptionService.getBySubject(
      companyA,
      BUDGET_OVERRUN_SUBJECT_TYPE,
      overExpense.id,
      testDb,
    );
    expect(excInitial).not.toBeNull();
    expect(excInitial!.status).toBe("OPEN");
    expect(excInitial!.domain).toBe("finanzas");
    expect(excInitial!.qsrCategory).toBe("DINERO");
    expect(excInitial!.severity).toBe("critical"); // 125% >= 120%
    // Responsable determinista: ADMIN activo distinto del GERENTE solicitante
    expect(excInitial!.ownerId).toBe(adminId);

    const initialMeta = excInitial!.metadata as Record<string, unknown>;
    const initialSnap = initialMeta.ruleSnapshot as Record<string, unknown>;
    expect(initialSnap).toMatchObject({
      ruleCode: BUDGET_OVERRUN_RULE_CODE,
      thresholdPercent: 100,
      month: budgetMonth,
      costCenterId: costCenterA,
      budgetedCents: 100_000,
      committedBeforeCents: 70_000,
      expenseAmountCents: 55_000,
      committedAfterCents: 125_000,
      overByCents: 25_000,
      consumedPercent: 125,
      requiredApproverRole: "ADMIN",
    });

    // 3. Repetir detección directa y correr budgetOverrunAdapter 2 veces NO duplica ni altera regla/owner
    const fakeLaterEval = evaluateOverbudgetRule({
      budgetedCents: 999_999,
      committedBeforeCents: 990_000,
      expenseAmountCents: 55_000,
      month: budgetMonth,
      costCenterId: costCenterA,
      amountRuleRole: "OWNER",
    });
    const repeated = await raiseBudgetOverrunException(
      {
        companyId: companyA,
        branchId: branchA,
        expenseId: overExpense.id,
        category: overExpense.category,
        description: overExpense.description,
        amountCents: overExpense.amount,
        requestedBy: gerenteId,
        sourceStatus: overExpense.status,
        evaluation: fakeLaterEval,
        costCenterId: costCenterA,
      },
      testDb,
    );
    expect(repeated.created).toBe(false);
    expect(repeated.exception.id).toBe(excInitial!.id);

    await budgetOverrunAdapter.run({ companyId: companyA, branchId: branchA });
    await budgetOverrunAdapter.run({ companyId: companyA, branchId: branchA });

    const allForOver = await testDb
      .select()
      .from(exceptions)
      .where(
        and(
          eq(exceptions.companyId, companyA),
          eq(exceptions.subjectType, BUDGET_OVERRUN_SUBJECT_TYPE),
          eq(exceptions.subjectId, overExpense.id),
        ),
      );
    expect(allForOver).toHaveLength(1);
    expect(allForOver[0].id).toBe(excInitial!.id);
    expect(allForOver[0].ownerId).toBe(adminId);
    expect(
      (allForOver[0].metadata as Record<string, unknown>).ruleSnapshot,
    ).toEqual(initialSnap);

    // 4. Autoridad, segregación y aislamiento entre empresas
    await expect(
      approveOperatingExpense(
        overExpense.id,
        companyA,
        { kind: "BRANCH", branchId: branchA },
        gerenteId,
        "GERENTE",
        "Intento sin autoridad",
      ),
    ).rejects.toThrow(/ADMIN/);

    await expect(
      rejectOperatingExpense(
        overExpense.id,
        companyA,
        { kind: "BRANCH", branchId: branchA },
        gerenteId,
        "GERENTE",
        "Intento rechazo sin autoridad",
      ),
    ).rejects.toThrow(/ADMIN/);

    await expect(
      approveOperatingExpense(
        overExpense.id,
        companyB,
        { kind: "ALL" },
        adminBId,
        "ADMIN",
        "Intento cross-tenant",
      ),
    ).rejects.toThrow(/no fue encontrado/i);

    // 5. Rollback atómico ante fallo de auditoría AUD-02 (actor inexistente viola FK en employee_audit_logs)
    await expect(
      approveOperatingExpense(
        overExpense.id,
        companyA,
        { kind: "ALL" },
        "ghost-actor-fk-violation",
        "ADMIN",
        "Debe revertir todo si falla AUD-02",
      ),
    ).rejects.toThrow();

    const [expenseAfterRollback] = await testDb
      .select({ status: operatingExpenses.status })
      .from(operatingExpenses)
      .where(eq(operatingExpenses.id, overExpense.id));
    expect(expenseAfterRollback.status).toBe("PENDING_OVERBUDGET_APPROVAL");
    const excAfterRollback = await ExceptionService.getBySubject(
      companyA,
      BUDGET_OVERRUN_SUBJECT_TYPE,
      overExpense.id,
      testDb,
    );
    expect(excAfterRollback!.status).toBe("OPEN");

    // 6. Autorización válida por ADMIN: actualiza gasto, cierra excepción y escribe AUD-02 (APPROVAL_EXPENSE + EXCEPTION)
    const approved = await approveOperatingExpense(
      overExpense.id,
      companyA,
      { kind: "ALL" },
      adminId,
      "ADMIN",
      "Aprobado por emergencia operativa en cocina",
    );
    expect(approved.status).toBe("APPROVED");
    expect(approved.overbudgetApprovedBy).toBe(adminId);
    expect(approved.overbudgetApprovedAt).toBeInstanceOf(Date);

    const excAfterApprove = await ExceptionService.getBySubject(
      companyA,
      BUDGET_OVERRUN_SUBJECT_TYPE,
      overExpense.id,
      testDb,
    );
    expect(excAfterApprove!.status).toBe("CANCELLED");
    expect(excAfterApprove!.ownerId).toBe(adminId);
    const metaAfterApprove = excAfterApprove!.metadata as Record<string, unknown>;
    expect(metaAfterApprove.ruleSnapshot).toEqual(initialSnap);
    expect(metaAfterApprove.closure).toMatchObject({
      decision: "APPROVED",
      actorId: adminId,
      actorRole: "ADMIN",
    });

    const expenseAudits = await testDb
      .select()
      .from(employeeAuditLogs)
      .where(
        and(
          eq(employeeAuditLogs.entityType, "APPROVAL_EXPENSE"),
          eq(employeeAuditLogs.entityId, overExpense.id),
        ),
      );
    expect(expenseAudits).toHaveLength(1);
    expect(expenseAudits[0].performedBy).toBe(adminId);
    expect(expenseAudits[0].reason).toContain("Aprobado por emergencia operativa");

    const excAudits = await testDb
      .select()
      .from(employeeAuditLogs)
      .where(
        and(
          eq(employeeAuditLogs.entityType, "EXCEPTION"),
          eq(employeeAuditLogs.entityId, excInitial!.id),
        ),
      );
    // 1 CREATE al detectar + 1 UPDATE al cerrar con actorId=adminId
    expect(excAudits.length).toBeGreaterThanOrEqual(2);
    expect(excAudits.some((a) => a.action === "UPDATE" && a.performedBy === adminId)).toBe(true);

    // 7. Segundo gasto fuera de presupuesto que se RECHAZA -> cierra excepción con AUD-02 y libera presupuesto
    const overToReject = await createOperatingExpense({
      companyId: companyA,
      branchId: branchA,
      costCenterId: costCenterA,
      category: "MANTENIMIENTO",
      amountCents: 30_000,
      description: "Pintura decorativa no presupuestada",
      businessDate,
      requestedBy: gerenteId,
    });
    expect(overToReject.status).toBe("PENDING_OVERBUDGET_APPROVAL");

    // El comprometido incluye PENDING_OVERBUDGET_APPROVAL (70k + 55k + 30k = 155k)
    const availWhilePending = await checkBudgetAvailability(
      branchA,
      costCenterA,
      budgetMonth,
      0,
      testDb,
    );
    expect(availWhilePending.committed).toBe(155_000);

    const rejected = await rejectOperatingExpense(
      overToReject.id,
      companyA,
      { kind: "ALL" },
      ownerId,
      "OWNER",
      "Gasto no prioritario fuera de presupuesto mensual",
    );
    expect(rejected.status).toBe("REJECTED");

    const excAfterReject = await ExceptionService.getBySubject(
      companyA,
      BUDGET_OVERRUN_SUBJECT_TYPE,
      overToReject.id,
      testDb,
    );
    expect(excAfterReject!.status).toBe("CANCELLED");
    expect(
      (excAfterReject!.metadata as Record<string, unknown>).closure,
    ).toMatchObject({
      decision: "REJECTED",
      actorId: ownerId,
      actorRole: "OWNER",
    });

    const rejectAudits = await testDb
      .select()
      .from(employeeAuditLogs)
      .where(
        and(
          eq(employeeAuditLogs.entityType, "APPROVAL_EXPENSE"),
          eq(employeeAuditLogs.entityId, overToReject.id),
        ),
      );
    expect(rejectAudits).toHaveLength(1);
    expect(rejectAudits[0].performedBy).toBe(ownerId);

    // Al rechazar se libera el compromiso (vuelve a 125k)
    const availAfterReject = await checkBudgetAvailability(
      branchA,
      costCenterA,
      budgetMonth,
      0,
      testDb,
    );
    expect(availAfterReject.committed).toBe(125_000);

    // Reejecutar adaptador NO reabre ni duplica las excepciones ya cerradas
    await budgetOverrunAdapter.run({ companyId: companyA, branchId: branchA });
    const finalExceptions = await testDb
      .select()
      .from(exceptions)
      .where(
        and(
          eq(exceptions.companyId, companyA),
          eq(exceptions.subjectType, BUDGET_OVERRUN_SUBJECT_TYPE),
        ),
      );
    expect(finalExceptions).toHaveLength(2);
    expect(finalExceptions.every((e) => e.status === "CANCELLED")).toBe(true);
  });
});
