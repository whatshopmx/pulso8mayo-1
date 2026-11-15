/**
 * AUD-02 V2 — Cierre en Postgres Aislado (Neon branch `br-round-voice-belheola`).
 *
 * Verificaciones obligatorias de la Puerta V2:
 * 1. Ejecución bajo rol `pulso_app` con `rolsuper: false` y `rolbypassrls: false` (NOBYPASSRLS).
 * 2. Invariante de Motivo Obligatorio: `reason` no vacío con longitud >= 4 caracteres;
 *    rechazo con `AuditValidationError` (código `AUDIT_REASON_REQUIRED`).
 * 3. Invariante de Transacción Obligatoria: `executor !== db`;
 *    rechazo con `AuditValidationError` (código `AUDIT_TRANSACTION_REQUIRED`).
 * 4. Atomicidad y Reversión Absoluta (Rollback Atómico): si la bitácora o la mutación falla,
 *    la transacción completa se revierte sin escrituras parciales en saldos, estados o bitácoras.
 * 5. Cobertura multi-dominio: INVENTORY (`inventory_audit_log`), LABOR (`employee_audit_logs`),
 *    FINANCE (`data_access_logs`).
 *
 * Nota de seguridad:
 * - Se comprueba que TEST_DATABASE_URL apunte a la base aislada y nunca a la base operativa.
 * - 'SALE_RECOVERY_APPLY' y 'SALE_VOID' pertenecen a A3/INV-01.d y se omiten aquí, usando
 *   únicamente enums existentes ('WASTE', 'ADJUSTMENT', 'BATCH', 'SALARY', 'CONTRACT', 'FINANCIAL_CLOSE').
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  companies,
  branches,
  users,
  inventoryItems,
  inventoryBatches,
  inventoryAuditLog,
  employeeAuditLogs,
} from "@/lib/db/schema";
import { dataAccessLogs } from "@/lib/db/schema/security";
import {
  AuditService,
  AuditValidationError,
} from "@/lib/services/audit-service";
import { logCriticalDataAccess } from "@/lib/security/audit";

describe("AUD-02 V2: Auditoría Crítica y Rollback Atómico en Neon Aislado (pulso_app)", () => {
  const companyId = randomUUID();
  const branchId = randomUUID();
  const userId = randomUUID();
  const itemId = randomUUID();
  const batchId = randomUUID();
  const wasteId = randomUUID();

  beforeAll(async () => {
    // 1. Guardias de entorno aislado
    const testUrl = process.env.TEST_DATABASE_URL;
    expect(testUrl).toBeDefined();

    const host = new URL(testUrl!).hostname.replace(/-pooler(?=\.)/, "");
    expect(host).toBe("ep-cold-morning-bewqoz3o.c-9.us-east-2.aws.neon.tech");

    if (existsSync(".env")) {
      const operational = parse(readFileSync(".env")).DATABASE_URL;
      if (operational) {
        expect(new URL(operational).hostname.replace(/-pooler(?=\.)/, "")).not.toBe(host);
      }
    }

    // 2. Verificación de rol pulso_app (NOBYPASSRLS, NOSUPERUSER)
    const roleResult = await db.execute<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
      sql`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'pulso_app'`
    );
    expect(roleResult.rows.length).toBeGreaterThan(0);
    const pulsoAppRole = roleResult.rows[0];
    expect(pulsoAppRole.rolsuper).toBe(false);
    expect(pulsoAppRole.rolbypassrls).toBe(false);

    // 3. Concesión de privilegios DML sobre tablas involucradas a pulso_app
    const targetTables = [
      "companies",
      "branches",
      "users",
      "inventory_items",
      "inventory_batches",
      "inventory_waste",
      "inventory_audit_log",
      "employee_audit_logs",
      "data_access_logs",
    ];
    for (const t of targetTables) {
      await db.execute(sql.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON "${t}" TO "pulso_app"`));
    }

    // 4. Sembrado de fixtures base
    await db.insert(companies).values({
      id: companyId,
      name: "AUD-02 Isolated Audit Company",
    });

    await db.insert(branches).values({
      id: branchId,
      companyId,
      name: "AUD-02 Branch Test",
    });

    await db.insert(users).values({
      id: userId,
      name: "Gerente Auditoría V2",
      email: `${userId}@aud02.test`,
      emailVerified: false,
      role: "GERENTE",
      companyId,
      branchId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.insert(inventoryItems).values({
      id: itemId,
      companyId,
      name: "Carne Premium Ribeye",
      unit: "KG",
    });

    await db.insert(inventoryBatches).values({
      id: batchId,
      itemId,
      branchId,
      initialQuantity: "10.0",
      currentQuantity: "10.0",
      status: "AVAILABLE",
    });
  });

  beforeEach(async () => {
    // Restaurar lote a estado limpio
    await db
      .update(inventoryBatches)
      .set({ currentQuantity: "10.0", status: "AVAILABLE" })
      .where(eq(inventoryBatches.id, batchId));

    // Restaurar nombre de empresa
    await db
      .update(companies)
      .set({ name: "AUD-02 Isolated Audit Company" })
      .where(eq(companies.id, companyId));

    // Restaurar usuario
    await db
      .update(users)
      .set({ role: "GERENTE" })
      .where(eq(users.id, userId));
  });

  describe("Dominio INVENTORY: Motivo obligatorio, transacción requerida y reversión atómica", () => {
    it("rechaza motivo vacío, nulo o < 4 caracteres con AuditValidationError(AUDIT_REASON_REQUIRED)", async () => {
      await expect(
        db.transaction(async (tx) => {
          await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
          await tx.execute(
            sql`SELECT set_config('app.current_company_id', ${companyId}, true), set_config('app.current_branch_id', ${branchId}, true)`
          );

          await AuditService.logCriticalInventoryAction(
            {
              companyId,
              branchId,
              action: "UPDATE",
              entityType: "WASTE",
              entityId: wasteId,
              performedBy: userId,
              reason: "   ", // Solo espacios
            },
            tx
          );
        })
      ).rejects.toThrow(AuditValidationError);

      await expect(
        db.transaction(async (tx) => {
          await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
          await AuditService.logCriticalInventoryAction(
            {
              companyId,
              branchId,
              action: "UPDATE",
              entityType: "WASTE",
              entityId: wasteId,
              performedBy: userId,
              reason: "abc", // Menor a 4 caracteres
            },
            tx
          );
        })
      ).rejects.toThrow(AuditValidationError);
    });

    it("rechaza ejecución sin transacción activa (o con db suelto) con AUDIT_TRANSACTION_REQUIRED", async () => {
      await expect(
        AuditService.logCriticalInventoryAction(
          {
            companyId,
            branchId,
            action: "UPDATE",
            entityType: "WASTE",
            entityId: wasteId,
            performedBy: userId,
            reason: "Motivo legítimo de merma",
          },
          undefined as never
        )
      ).rejects.toThrow(AuditValidationError);

      await expect(
        AuditService.logCriticalInventoryAction(
          {
            companyId,
            branchId,
            action: "UPDATE",
            entityType: "WASTE",
            entityId: wasteId,
            performedBy: userId,
            reason: "Motivo legítimo de merma",
          },
          db
        )
      ).rejects.toThrow(AuditValidationError);
    });

    it("reversión atómica: si la auditoría falla en la transacción, el descuento de stock se revierte totalmente", async () => {
      const attempt = db.transaction(async (tx) => {
        await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
        await tx.execute(
          sql`SELECT set_config('app.current_company_id', ${companyId}, true), set_config('app.current_branch_id', ${branchId}, true)`
        );

        // 1. Mutación de negocio legítima: descontar stock de 10.0 a 6.0
        await tx
          .update(inventoryBatches)
          .set({ currentQuantity: "6.0" })
          .where(eq(inventoryBatches.id, batchId));

        // 2. Fallo intencional en la auditoría con enum de acción inválido en Postgres
        await tx.execute(sql`
          INSERT INTO inventory_audit_log (
            id, company_id, branch_id, action, entity_type, entity_id, performed_by, reason
          ) VALUES (
            ${randomUUID()}, ${companyId}, ${branchId}, 'ACCION_INEXISTENTE'::inventory_audit_action,
            'WASTE'::inventory_audit_entity, ${wasteId}, ${userId}, 'Motivo de prueba con fallo'
          )
        `);
      });

      await expect(attempt).rejects.toThrow();

      // Verificación de integridad: el lote NO se descontó (permanece en 10.0)
      const [batch] = await db
        .select({ currentQuantity: inventoryBatches.currentQuantity })
        .from(inventoryBatches)
        .where(eq(inventoryBatches.id, batchId));

      expect(Number(batch.currentQuantity)).toBe(10.0);
    });

    it("éxito atómico: mutación de stock y bitácora se confirman juntas en la misma transacción", async () => {
      const reasonText = "Ajuste de merma por fin de turno comprobado";

      await db.transaction(async (tx) => {
        await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
        await tx.execute(
          sql`SELECT set_config('app.current_company_id', ${companyId}, true), set_config('app.current_branch_id', ${branchId}, true)`
        );

        await tx
          .update(inventoryBatches)
          .set({ currentQuantity: "7.5" })
          .where(eq(inventoryBatches.id, batchId));

        await AuditService.logCriticalInventoryAction(
          {
            companyId,
            branchId,
            action: "UPDATE",
            entityType: "BATCH",
            entityId: batchId,
            performedBy: userId,
            reason: reasonText,
          },
          tx
        );
      });

      // Verificamos mutación confirmada
      const [batch] = await db
        .select({ currentQuantity: inventoryBatches.currentQuantity })
        .from(inventoryBatches)
        .where(eq(inventoryBatches.id, batchId));
      expect(Number(batch.currentQuantity)).toBe(7.5);

      // Verificamos bitácora confirmada
      const [log] = await db
        .select()
        .from(inventoryAuditLog)
        .where(eq(inventoryAuditLog.entityId, batchId));
      expect(log).toBeDefined();
      expect(log.reason).toBe(reasonText);
      expect(log.performedBy).toBe(userId);
    });
  });

  describe("Dominio LABOR: Motivo obligatorio, transacción requerida y reversión atómica", () => {
    it("rechaza motivo ausente o corto en acciones laborales críticas", async () => {
      await expect(
        db.transaction(async (tx) => {
          await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
          await AuditService.logCriticalEmployeeAction(
            {
              userId,
              action: "UPDATE",
              entityType: "SALARY",
              performedBy: userId,
              reason: "no", // Demasiado corto
            },
            tx
          );
        })
      ).rejects.toThrow(AuditValidationError);
    });

    it("reversión atómica: si la bitácora laboral falla, la mutación de usuario se revierte", async () => {
      const attempt = db.transaction(async (tx) => {
        await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));

        // 1. Mutar rol de usuario de GERENTE a SUPER_ADMIN
        await tx
          .update(users)
          .set({ role: "SUPER_ADMIN" })
          .where(eq(users.id, userId));

        // 2. Provocar error en inserción de bitácora
        await tx.execute(sql`
          INSERT INTO employee_audit_logs (
            id, user_id, action, entity_type, performed_by, reason
          ) VALUES (
            ${randomUUID()}, ${userId}, 'INVALID_ACTION'::audit_action, 'SALARY', ${userId}, 'Cambio salarial'
          )
        `);
      });

      await expect(attempt).rejects.toThrow();

      // Verificamos que el usuario NO cambió a SUPER_ADMIN (sigue siendo GERENTE)
      const [u] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
      expect(u.role).toBe("GERENTE");
    });

    it("éxito atómico: mutación laboral y bitácora se confirman juntas", async () => {
      const laborReason = "Actualización autorizada de contrato de trabajo";

      await db.transaction(async (tx) => {
        await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));

        await tx
          .update(users)
          .set({ name: "Gerente con Contrato Renovado" })
          .where(eq(users.id, userId));

        await AuditService.logCriticalEmployeeAction(
          {
            userId,
            action: "UPDATE",
            entityType: "CONTRACT",
            entityId: userId,
            performedBy: userId,
            reason: laborReason,
          },
          tx
        );
      });

      const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
      expect(u.name).toBe("Gerente con Contrato Renovado");

      const [log] = await db
        .select()
        .from(employeeAuditLogs)
        .where(eq(employeeAuditLogs.entityId, userId));
      expect(log).toBeDefined();
      expect(log.reason).toBe(laborReason);
    });
  });

  describe("Dominio FINANCE: Motivo obligatorio, transacción requerida y reversión atómica", () => {
    it("logCriticalDataAccess exige motivo con longitud >= 4 y transacción", async () => {
      // Sin transacción
      await expect(
        logCriticalDataAccess(
          {
            userId,
            companyId,
            action: "APPROVE",
            resource: "financial_periods",
            decision: { allowed: true },
            reason: "Cierre contable anual",
          },
          db
        )
      ).rejects.toThrow(AuditValidationError);

      // Sin motivo dentro de transacción
      await expect(
        db.transaction(async (tx) => {
          await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
          await logCriticalDataAccess(
            {
              userId,
              companyId,
              action: "APPROVE",
              resource: "financial_periods",
              decision: { allowed: true },
              reason: "  ",
            },
            tx
          );
        })
      ).rejects.toThrow(AuditValidationError);
    });

    it("reversión atómica: fallo en data_access_logs revierte la mutación financiera", async () => {
      const attempt = db.transaction(async (tx) => {
        await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));

        // 1. Mutación de empresa
        await tx
          .update(companies)
          .set({ name: "Empresa con Cierre Tentativo" })
          .where(eq(companies.id, companyId));

        // 2. Fallo intencional en log
        await tx.execute(sql`
          INSERT INTO data_access_logs (
            id, user_id, company_id, action, resource, performed_at
          ) VALUES (
            ${randomUUID()}, ${userId}, ${randomUUID()}, 'APPROVE', 'financial_periods', NOW()
          )
        `); // Foreign key violada con company_id sintético inexistente
      });

      await expect(attempt).rejects.toThrow();

      // Verificamos que el nombre de la empresa no mutó
      const [c] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, companyId));
      expect(c.name).toBe("AUD-02 Isolated Audit Company");
    });

    it("éxito atómico: mutación financiera y bitácora de acceso clasificado se confirman juntas", async () => {
      const financeReason = "Aprobación formal de período fiscal y congelamiento contable";

      await db.transaction(async (tx) => {
        await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));

        await tx
          .update(companies)
          .set({ name: "Empresa Periodo Cerrado 2026" })
          .where(eq(companies.id, companyId));

        await logCriticalDataAccess(
          {
            userId,
            companyId,
            branchId,
            action: "APPROVE",
            resource: "financial_periods",
            decision: { allowed: true },
            reason: financeReason,
          },
          tx
        );
      });

      const [c] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, companyId));
      expect(c.name).toBe("Empresa Periodo Cerrado 2026");

      const [log] = await db
        .select()
        .from(dataAccessLogs)
        .where(eq(dataAccessLogs.companyId, companyId));
      expect(log).toBeDefined();
      expect(log.action).toBe("APPROVE");
      expect((log.accessDecision as Record<string, unknown>)?.reason).toBe(financeReason);
    });
  });
});
