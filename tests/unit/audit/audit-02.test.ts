import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getTableConfig } from "drizzle-orm/pg-core";
import { sql, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auth, getSession } from "@/lib/auth";
import * as tables from "@/lib/db/schema";
import { dataAccessLogs } from "@/lib/db/schema/security";
import {
  AuditService,
  AuditValidationError,
  CRITICAL_AUDIT_CATALOG,
  isCriticalInventoryAction,
  isCriticalEmployeeAction,
} from "@/lib/services/audit-service";
import {
  logCriticalDataAccess,
  logDataAccess,
} from "@/lib/security/audit";
import { POST as wasteApprovalPost } from "@/app/api/inventory/waste/[id]/approval/route";

const state = vi.hoisted(() => ({ close: async () => {} }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/lib/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = new PGlite();
  state.close = () => client.close();
  return { db: drizzle(client) };
});

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
  auth: { api: { getSession: vi.fn() } },
}));

// IDs de prueba deterministas
const companyA = "aaaaaaaa-0000-4000-8000-000000000001";
const companyB = "bbbbbbbb-0000-4000-8000-000000000001";
const branchA1 = "aaaaaaaa-0000-4000-8000-000000000011";
const branchA2 = "aaaaaaaa-0000-4000-8000-000000000012";
const branchB1 = "bbbbbbbb-0000-4000-8000-000000000011";
const itemA = "aaaaaaaa-0000-4000-8000-000000000021";
const batchA1 = "aaaaaaaa-0000-4000-8000-000000000031";
const wasteIdA = "aaaaaaaa-0000-4000-8000-000000000041";
const wasteIdB = "bbbbbbbb-0000-4000-8000-000000000041";
const userGerente = "user-gerente-a";

const databaseTables = [
  tables.companies,
  tables.branches,
  tables.users,
  tables.inventoryItems,
  tables.inventoryBatches,
  tables.inventoryMovements,
  tables.inventoryWaste,
  tables.inventoryAuditLog,
  tables.employeeAuditLogs,
  dataAccessLogs,
];

beforeAll(async () => {
  for (const table of databaseTables) {
    const config = getTableConfig(table);
    const columns = config.columns.map((column) => {
      const type = column.getSQLType();
      return `"${column.name}" ${
        /^(uuid|text|boolean|integer|numeric|timestamp|jsonb|varchar)/.test(type)
          ? type
          : "text"
      }`;
    });
    await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS "${config.name}" (${columns.join(",")})`));
  }

  // Sembrado base
  await db.execute(sql`INSERT INTO companies (id, name, courtesy_waste_monthly_cap_cents) VALUES
    (${companyA}, 'Empresa A', 500000),
    (${companyB}, 'Empresa B', 500000)`);

  await db.execute(sql`INSERT INTO branches (id, company_id, name) VALUES
    (${branchA1}, ${companyA}, 'Sucursal A1'),
    (${branchA2}, ${companyA}, 'Sucursal A2'),
    (${branchB1}, ${companyB}, 'Sucursal B1')`);

  await db.execute(sql`INSERT INTO inventory_items (id, company_id, name, unit) VALUES
    (${itemA}, ${companyA}, 'Carne para Hamburguesa', 'KG')`);

  await db.execute(sql`INSERT INTO inventory_batches (id, item_id, branch_id, initial_quantity, current_quantity, status) VALUES
    (${batchA1}, ${itemA}, ${branchA1}, 10, 5.0, 'AVAILABLE')`);

  await db.execute(sql`INSERT INTO users (id, company_id, role, branch_id, name) VALUES
    (${userGerente}, ${companyA}, 'GERENTE', ${branchA1}, 'Gerente Sucursal A1')`);
}, 60_000);

afterAll(() => state.close());

function setSession(role = "GERENTE", branchId: string | null = branchA1, companyId: string | null = companyA, userId = userGerente) {
  const value = {
    user: { id: userId, role, branchId, companyId, tenantId: companyId },
  };
  vi.mocked(getSession).mockResolvedValue(value as never);
  vi.mocked(auth.api.getSession).mockResolvedValue(value as never);
}

beforeEach(async () => {
  vi.clearAllMocks();
  setSession();

  // Reset tablas mutables
  await db.execute(sql`TRUNCATE inventory_audit_log, employee_audit_logs, data_access_logs, inventory_movements, inventory_waste`);
  await db.execute(sql`UPDATE inventory_batches SET status='AVAILABLE', current_quantity=5.0 WHERE id=${batchA1}`);

  // Insertar merma STAFF pendiente en branchA1
  await db.execute(sql`INSERT INTO inventory_waste (
    id, company_id, branch_id, item_id, batch_id, quantity, unit, reason, total_loss, approval_status, recorded_at
  ) VALUES (
    ${wasteIdA}, ${companyA}, ${branchA1}, ${itemA}, ${batchA1}, 1.5, 'KG', 'STAFF', 15000, 'PENDING_APPROVAL', NOW()
  )`);

  // Insertar merma STAFF pendiente en branchB1 (otra empresa)
  await db.execute(sql`INSERT INTO inventory_waste (
    id, company_id, branch_id, item_id, batch_id, quantity, unit, reason, total_loss, approval_status, recorded_at
  ) VALUES (
    ${wasteIdB}, ${companyB}, ${branchB1}, ${itemA}, ${batchA1}, 1.0, 'KG', 'STAFF', 10000, 'PENDING_APPROVAL', NOW()
  )`);
});

describe("AUD-02: Catálogo e Invariantes de Auditoría Crítica", () => {
  it("el catálogo formal contiene los 4 dominios y todas las operaciones críticas declaradas", () => {
    expect(CRITICAL_AUDIT_CATALOG.length).toBeGreaterThanOrEqual(18);

    const domains = new Set(CRITICAL_AUDIT_CATALOG.map((c) => c.domain));
    expect(domains).toContain("INVENTORY");
    expect(domains).toContain("LABOR");
    expect(domains).toContain("SECURITY");
    expect(domains).toContain("FINANCE");

    // Verifica que cada descriptor exija motivo y transacción
    for (const descriptor of CRITICAL_AUDIT_CATALOG) {
      expect(descriptor.reasonRequired).toBe(true);
      expect(descriptor.transactionRequired).toBe(true);
      expect(descriptor.description).toBeTruthy();
    }
  });

  it("isCriticalInventoryAction clasifica correctamente acciones de stock", () => {
    expect(isCriticalInventoryAction("WASTE", "CREATE")).toBe(true);
    expect(isCriticalInventoryAction("WASTE", "UPDATE")).toBe(true);
    expect(isCriticalInventoryAction("ADJUSTMENT", "CREATE")).toBe(true);
    expect(isCriticalInventoryAction("ADJUSTMENT", "UPDATE")).toBe(true);
    expect(isCriticalInventoryAction("BATCH", "UPDATE")).toBe(true);
    expect(isCriticalInventoryAction("TRANSFER", "CREATE")).toBe(true);
    expect(isCriticalInventoryAction("SALE_RECOVERY_APPLY", "CREATE")).toBe(true);
    expect(isCriticalInventoryAction("SALE_VOID", "CREATE")).toBe(true);

    // Acciones y entidades no críticas
    expect(isCriticalInventoryAction("ITEM", "CREATE")).toBe(false);
    expect(isCriticalInventoryAction("SUPPLIER", "UPDATE")).toBe(false);
    expect(isCriticalInventoryAction("PAYEE", "CREATE")).toBe(false);
  });

  it("isCriticalEmployeeAction clasifica correctamente acciones laborales y de excepción", () => {
    expect(isCriticalEmployeeAction("SALARY", "CREATE")).toBe(true);
    expect(isCriticalEmployeeAction("SALARY", "UPDATE")).toBe(true);
    expect(isCriticalEmployeeAction("SALARY", "DELETE")).toBe(true);
    expect(isCriticalEmployeeAction("CONTRACT", "UPDATE")).toBe(true);
    expect(isCriticalEmployeeAction("IMSS_MOVEMENT", "CREATE")).toBe(true);
    expect(isCriticalEmployeeAction("EXCEPTION", "UPDATE")).toBe(true);

    // No críticas
    expect(isCriticalEmployeeAction("PROFILE", "VIEW")).toBe(false);
    expect(isCriticalEmployeeAction("DOCUMENT", "VIEW")).toBe(false);
  });
});

describe("AUD-02: Exigencia Estricta de Motivo y Transacción", () => {
  it("logCriticalInventoryAction rechaza motivos vacíos, nulos o de solo espacios", async () => {
    await db.transaction(async (tx) => {
      // Sin motivo
      await expect(
        AuditService.logCriticalInventoryAction(
          {
            companyId: companyA,
            branchId: branchA1,
            action: "UPDATE",
            entityType: "WASTE",
            entityId: wasteIdA,
            performedBy: userGerente,
            reason: "" as never,
          },
          tx
        )
      ).rejects.toThrow(AuditValidationError);

      // Solo espacios
      await expect(
        AuditService.logCriticalInventoryAction(
          {
            companyId: companyA,
            branchId: branchA1,
            action: "UPDATE",
            entityType: "WASTE",
            entityId: wasteIdA,
            performedBy: userGerente,
            reason: "    ",
          },
          tx
        )
      ).rejects.toThrow(AuditValidationError);

      // Demasiado corto (< 4 chars)
      await expect(
        AuditService.logCriticalInventoryAction(
          {
            companyId: companyA,
            branchId: branchA1,
            action: "UPDATE",
            entityType: "WASTE",
            entityId: wasteIdA,
            performedBy: userGerente,
            reason: "abc",
          },
          tx
        )
      ).rejects.toThrow(AuditValidationError);
    });

    const logs = await db.select().from(tables.inventoryAuditLog);
    expect(logs).toHaveLength(0);
  });

  it("logCriticalInventoryAction rechaza ejecución sin transacción activa (o con db suelto)", async () => {
    // Sin executor
    await expect(
      AuditService.logCriticalInventoryAction(
        {
          companyId: companyA,
          branchId: branchA1,
          action: "UPDATE",
          entityType: "WASTE",
          entityId: wasteIdA,
          performedBy: userGerente,
          reason: "Motivo legítimo de prueba",
        },
        undefined as never
      )
    ).rejects.toThrow(AuditValidationError);

    // Con db suelto
    await expect(
      AuditService.logCriticalInventoryAction(
        {
          companyId: companyA,
          branchId: branchA1,
          action: "UPDATE",
          entityType: "WASTE",
          entityId: wasteIdA,
          performedBy: userGerente,
          reason: "Motivo legítimo de prueba",
        },
        db
      )
    ).rejects.toThrow(AuditValidationError);
  });

  it("logCriticalEmployeeAction rechaza motivo inválido y ejecución sin transacción", async () => {
    // Sin transacción
    await expect(
      AuditService.logCriticalEmployeeAction(
        {
          userId: userGerente,
          action: "UPDATE",
          entityType: "SALARY",
          performedBy: userGerente,
          reason: "Ajuste anual de nómina",
        },
        db
      )
    ).rejects.toThrow(AuditValidationError);

    // Con transacción pero sin motivo
    await db.transaction(async (tx) => {
      await expect(
        AuditService.logCriticalEmployeeAction(
          {
            userId: userGerente,
            action: "UPDATE",
            entityType: "SALARY",
            performedBy: userGerente,
            reason: "   ",
          },
          tx
        )
      ).rejects.toThrow(AuditValidationError);
    });
  });

  it("logCriticalDataAccess rechaza motivo ausente o ejecución sin transacción", async () => {
    const decision = { allowed: true, reason: "OK" };

    // Sin transacción
    await expect(
      logCriticalDataAccess(
        {
          userId: userGerente,
          companyId: companyA,
          action: "APPROVE",
          resource: "financial_periods",
          decision,
          reason: "Aprobación de cierre contable",
        },
        db
      )
    ).rejects.toThrow(AuditValidationError);

    // Con transacción pero sin motivo
    await db.transaction(async (tx) => {
      await expect(
        logCriticalDataAccess(
          {
            userId: userGerente,
            companyId: companyA,
            action: "APPROVE",
            resource: "financial_periods",
            decision,
            reason: "  ",
          },
          tx
        )
      ).rejects.toThrow(AuditValidationError);
    });
  });
});

describe("AUD-02: Atomicidad y Reversión ante Fallo de Auditoría", () => {
  it("si la auditoría de inventario falla dentro de la transacción, la mutación de negocio se revierte completamente", async () => {
    // Creamos trigger en Postgres para simular fallo de base de datos en la bitácora
    await db.execute(sql.raw(`
      CREATE OR REPLACE FUNCTION fail_inventory_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'Simulated audit log disk failure';
      END $$;
    `));
    await db.execute(sql.raw(`
      CREATE TRIGGER fail_inventory_audit_trg
      BEFORE INSERT ON inventory_audit_log
      FOR EACH ROW EXECUTE FUNCTION fail_inventory_audit();
    `));

    try {
      // Intentamos una mutación de negocio (descontar lote) con auditoría atómica
      const attempt = db.transaction(async (tx) => {
        await tx
          .update(tables.inventoryBatches)
          .set({ currentQuantity: "2.0" })
          .where(eq(tables.inventoryBatches.id, batchA1));

        // Esta llamada fallará por el trigger
        await AuditService.logCriticalInventoryAction(
          {
            companyId: companyA,
            branchId: branchA1,
            action: "UPDATE",
            entityType: "WASTE",
            entityId: wasteIdA,
            performedBy: userGerente,
            reason: "Descuento de merma por corte",
          },
          tx
        );
      });

      await expect(attempt).rejects.toThrow();

      // Verificamos que el lote SIGUE en su estado original (5.0, no 2.0)
      const [batch] = await db
        .select()
        .from(tables.inventoryBatches)
        .where(eq(tables.inventoryBatches.id, batchA1));
      expect(Number(batch.currentQuantity)).toBe(5.0);

      // Y que no quedó ningún registro en la bitácora
      const logs = await db.select().from(tables.inventoryAuditLog);
      expect(logs).toHaveLength(0);
    } finally {
      await db.execute(sql.raw("DROP TRIGGER IF EXISTS fail_inventory_audit_trg ON inventory_audit_log"));
      await db.execute(sql.raw("DROP FUNCTION IF EXISTS fail_inventory_audit()"));
    }
  });

  it("si la auditoría de empleado falla, revierte la transacción laboral", async () => {
    await db.execute(sql.raw(`
      CREATE OR REPLACE FUNCTION fail_employee_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'Simulated employee audit failure';
      END $$;
    `));
    await db.execute(sql.raw(`
      CREATE TRIGGER fail_employee_audit_trg
      BEFORE INSERT ON employee_audit_logs
      FOR EACH ROW EXECUTE FUNCTION fail_employee_audit();
    `));

    try {
      const attempt = db.transaction(async (tx) => {
        await tx
          .update(tables.users)
          .set({ role: "SUPER_ADMIN" })
          .where(eq(tables.users.id, userGerente));

        await AuditService.logCriticalEmployeeAction(
          {
            userId: userGerente,
            action: "UPDATE",
            entityType: "SALARY",
            performedBy: userGerente,
            reason: "Aumento de rango salarial",
          },
          tx
        );
      });

      await expect(attempt).rejects.toThrow();

      // El usuario no cambió de rol (sigue siendo GERENTE)
      const [user] = await db.select().from(tables.users).where(eq(tables.users.id, userGerente));
      expect(user.role).toBe("GERENTE");
    } finally {
      await db.execute(sql.raw("DROP TRIGGER IF EXISTS fail_employee_audit_trg ON employee_audit_logs"));
      await db.execute(sql.raw("DROP FUNCTION IF EXISTS fail_employee_audit()"));
    }
  });

  it("si logCriticalDataAccess falla, revierte la mutación financiera", async () => {
    await db.execute(sql.raw(`
      CREATE OR REPLACE FUNCTION fail_access_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'Simulated security audit failure';
      END $$;
    `));
    await db.execute(sql.raw(`
      CREATE TRIGGER fail_access_audit_trg
      BEFORE INSERT ON data_access_logs
      FOR EACH ROW EXECUTE FUNCTION fail_access_audit();
    `));

    try {
      const attempt = db.transaction(async (tx) => {
        await tx
          .update(tables.companies)
          .set({ name: "Empresa Modificada" })
          .where(eq(tables.companies.id, companyA));

        await logCriticalDataAccess(
          {
            userId: userGerente,
            companyId: companyA,
            action: "APPROVE",
            resource: "financial_periods",
            decision: { allowed: true },
            reason: "Cierre contable anual 2026",
          },
          tx
        );
      });

      await expect(attempt).rejects.toThrow();

      const [comp] = await db.select().from(tables.companies).where(eq(tables.companies.id, companyA));
      expect(comp.name).toBe("Empresa A");
    } finally {
      await db.execute(sql.raw("DROP TRIGGER IF EXISTS fail_access_audit_trg ON data_access_logs"));
      await db.execute(sql.raw("DROP FUNCTION IF EXISTS fail_access_audit()"));
    }
  });
});

describe("AUD-02: Preservación de Usos No Críticos (Best-effort)", () => {
  it("logInventoryAction sobre entidades no críticas conserva semántica no transaccional", async () => {
    // SUPPLIER no está en el catálogo crítico; no requiere razón ni executor
    const log = await AuditService.logInventoryAction({
      companyId: companyA,
      branchId: branchA1,
      action: "UPDATE",
      entityType: "SUPPLIER",
      entityId: "supplier-123",
      performedBy: userGerente,
      // sin reason, sin executor
    });

    expect(log).not.toBeNull();
    expect(log?.entityType).toBe("SUPPLIER");
    expect(log?.reason).toBeNull();

    const stored = await db.select().from(tables.inventoryAuditLog);
    expect(stored).toHaveLength(1);
    expect(stored[0].entityType).toBe("SUPPLIER");
  });

  it("logEmployeeAction sobre acciones no críticas conserva semántica no transaccional", async () => {
    // VIEW no es crítico; puede llamarse sin executor ni reason
    const log = await AuditService.logEmployeeAction({
      userId: userGerente,
      action: "VIEW",
      entityType: "PROFILE",
      performedBy: userGerente,
    });

    expect(log).not.toBeNull();
    expect(log?.action).toBe("VIEW");

    const stored = await db.select().from(tables.employeeAuditLogs);
    expect(stored).toHaveLength(1);
  });

  it("logDataAccess en modo guardia de lectura no lanza error si ocurre fallo de inserción", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await db.execute(sql.raw(`
      CREATE OR REPLACE FUNCTION fail_read_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'guard disk full'; END $$;
    `));
    await db.execute(sql.raw(`
      CREATE TRIGGER fail_read_audit_trg BEFORE INSERT ON data_access_logs
      FOR EACH ROW EXECUTE FUNCTION fail_read_audit();
    `));

    try {
      // READ guard call: best-effort must not throw
      await expect(
        logDataAccess({
          userId: userGerente,
          companyId: companyA,
          action: "READ",
          resource: "employees.clabe",
          decision: { allowed: false, reason: "Forbidden" },
        })
      ).resolves.toBeUndefined();
    } finally {
      await db.execute(sql.raw("DROP TRIGGER IF EXISTS fail_read_audit_trg ON data_access_logs"));
      await db.execute(sql.raw("DROP FUNCTION IF EXISTS fail_read_audit()"));
      errorSpy.mockRestore();
    }
  });
});

describe("AUD-02: Primer Caller Crítico Acotado (POST /api/inventory/waste/[id]/approval)", () => {
  const callApproval = (wasteId: string, body: Record<string, unknown>) => {
    const req = new NextRequest(`http://localhost/api/inventory/waste/${wasteId}/approval`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return wasteApprovalPost(req, {
      params: Promise.resolve({ id: wasteId }),
      auth: {
        tenantId: companyA,
        user: { id: userGerente, role: "GERENTE", branchId: branchA1 },
      },
    });
  };

  it("Aprobación exitosa: muta lote, crea movimiento, aprueba merma y registra auditoría atómicamente", async () => {
    const res = await callApproval(wasteIdA, {
      action: "APPROVE",
      notes: "Aprobación autorizada de consumo de personal",
    });
    expect(res.status).toBe(200);

    // 1. Merma actualizada a APPROVED
    const [waste] = await db
      .select()
      .from(tables.inventoryWaste)
      .where(eq(tables.inventoryWaste.id, wasteIdA));
    expect(waste.approvalStatus).toBe("APPROVED");
    expect(waste.approvedBy).toBe(userGerente);

    // 2. Lote descontado (de 5.0 a 3.5 porque la merma era de 1.5)
    const [batch] = await db
      .select()
      .from(tables.inventoryBatches)
      .where(eq(tables.inventoryBatches.id, batchA1));
    expect(Number(batch.currentQuantity)).toBe(3.5);

    // 3. Movimiento de inventario creado
    const movements = await db.select().from(tables.inventoryMovements);
    expect(movements).toHaveLength(1);
    expect(movements[0].type).toBe("USAGE");
    expect(Number(movements[0].quantityChange)).toBe(-1.5);

    // 4. Auditoría obligatoria registrada en la misma transacción
    const logs = await db.select().from(tables.inventoryAuditLog);
    expect(logs).toHaveLength(1);
    expect(logs[0].entityType).toBe("WASTE");
    expect(logs[0].action).toBe("UPDATE");
    expect(logs[0].entityId).toBe(wasteIdA);
    expect(logs[0].performedBy).toBe(userGerente);
    expect(logs[0].reason).toContain("Aprobación autorizada de consumo de personal");
  });

  it("Rechazo exitoso: actualiza estatus a REJECTED con motivo obligatorio y no toca stock", async () => {
    const res = await callApproval(wasteIdA, {
      action: "REJECT",
      reason: "No procede: porción no autorizada para el turno",
    });
    expect(res.status).toBe(200);

    const [waste] = await db
      .select()
      .from(tables.inventoryWaste)
      .where(eq(tables.inventoryWaste.id, wasteIdA));
    expect(waste.approvalStatus).toBe("REJECTED");
    expect(waste.approvedBy).toBe(userGerente);

    // Lote sin tocar (sigue en 5.0)
    const [batch] = await db
      .select()
      .from(tables.inventoryBatches)
      .where(eq(tables.inventoryBatches.id, batchA1));
    expect(Number(batch.currentQuantity)).toBe(5.0);

    // Sin movimientos de inventario
    const movements = await db.select().from(tables.inventoryMovements);
    expect(movements).toHaveLength(0);

    // Bitácora registrada
    const logs = await db.select().from(tables.inventoryAuditLog);
    expect(logs).toHaveLength(1);
    expect(logs[0].entityType).toBe("WASTE");
    expect(logs[0].reason).toContain("No procede: porción no autorizada para el turno");
  });

  it("Rechazo sin motivo es denegado con 400 Bad Request y no altera datos", async () => {
    const res = await callApproval(wasteIdA, {
      action: "REJECT",
      notes: "   ", // vacío
    });
    expect(res.status).toBe(400);

    const [waste] = await db
      .select()
      .from(tables.inventoryWaste)
      .where(eq(tables.inventoryWaste.id, wasteIdA));
    expect(waste.approvalStatus).toBe("PENDING_APPROVAL");

    const logs = await db.select().from(tables.inventoryAuditLog);
    expect(logs).toHaveLength(0);
  });

  it("Reversión Atómica: si la auditoría falla en la aprobación, se revierten merma, lote y movimientos", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await db.execute(sql.raw(`
      CREATE OR REPLACE FUNCTION fail_waste_approval_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Audit failure in approval transaction'; END $$;
    `));
    await db.execute(sql.raw(`
      CREATE TRIGGER fail_waste_approval_audit_trg
      BEFORE INSERT ON inventory_audit_log
      FOR EACH ROW EXECUTE FUNCTION fail_waste_approval_audit();
    `));

    try {
      const res = await callApproval(wasteIdA, {
        action: "APPROVE",
        notes: "Aprobación regular",
      });

      // Debe retornar 500 porque la transacción de aprobación falló por la bitácora
      expect(res.status).toBe(500);

      // 1. Merma SIGUE PENDING_APPROVAL
      const [waste] = await db
        .select()
        .from(tables.inventoryWaste)
        .where(eq(tables.inventoryWaste.id, wasteIdA));
      expect(waste.approvalStatus).toBe("PENDING_APPROVAL");

      // 2. Lote NO fue descontado (sigue en 5.0)
      const [batch] = await db
        .select()
        .from(tables.inventoryBatches)
        .where(eq(tables.inventoryBatches.id, batchA1));
      expect(Number(batch.currentQuantity)).toBe(5.0);

      // 3. NO hay movimientos de inventario creados
      const movements = await db.select().from(tables.inventoryMovements);
      expect(movements).toHaveLength(0);

      // 4. NO hay bitácoras
      const logs = await db.select().from(tables.inventoryAuditLog);
      expect(logs).toHaveLength(0);
    } finally {
      await db.execute(sql.raw("DROP TRIGGER IF EXISTS fail_waste_approval_audit_trg ON inventory_audit_log"));
      await db.execute(sql.raw("DROP FUNCTION IF EXISTS fail_waste_approval_audit()"));
      errorSpy.mockRestore();
    }
  });

  it("Alcance de sucursal: Gerente no puede aprobar merma de otra sucursal", async () => {
    // Sesión en branchA2 intentando aprobar waste de branchA1
    setSession("GERENTE", branchA2, companyA, "otro-gerente");

    const req = new NextRequest(`http://localhost/api/inventory/waste/${wasteIdA}/approval`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "APPROVE", notes: "Aprobación cruzada" }),
    });

    const res = await wasteApprovalPost(req, {
      params: Promise.resolve({ id: wasteIdA }),
      auth: {
        tenantId: companyA,
        user: { id: "otro-gerente", role: "GERENTE", branchId: branchA2 },
      },
    });

    expect(res.status).toBe(403);

    const [waste] = await db
      .select()
      .from(tables.inventoryWaste)
      .where(eq(tables.inventoryWaste.id, wasteIdA));
    expect(waste.approvalStatus).toBe("PENDING_APPROVAL");
  });

  it("Idempotencia: no permite volver a aprobar o rechazar una merma ya resuelta", async () => {
    // Primera resolución: aprobada
    const res1 = await callApproval(wasteIdA, {
      action: "APPROVE",
      notes: "Primera aprobación",
    });
    expect(res1.status).toBe(200);

    // Segunda resolución: debe fallar con 400 NOT_PENDING
    const res2 = await callApproval(wasteIdA, {
      action: "APPROVE",
      notes: "Segunda aprobación intento",
    });
    expect(res2.status).toBe(400);

    // El lote solo se descontó UNA vez (5.0 - 1.5 = 3.5)
    const [batch] = await db
      .select()
      .from(tables.inventoryBatches)
      .where(eq(tables.inventoryBatches.id, batchA1));
    expect(Number(batch.currentQuantity)).toBe(3.5);

    // Solo un movimiento
    const movements = await db.select().from(tables.inventoryMovements);
    expect(movements).toHaveLength(1);

    // Solo una auditoría
    const logs = await db.select().from(tables.inventoryAuditLog);
    expect(logs).toHaveLength(1);
  });
});
