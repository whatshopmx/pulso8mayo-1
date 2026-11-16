/**
 * EXC-01 — Persistencia Canónica de Excepciones y RLS en Neon Postgres Aislado.
 *
 * Certifica:
 * 1. Conexión contra Postgres Neon aislado (.env.test, ep-cold-morning-bewqoz3o) y rol pulso_app (NOBYPASSRLS).
 * 2. Habilitación de RLS aditivo y política "exceptions_tenant_isolation" sobre exceptions.
 * 3. Inserción persistente en PostgreSQL real con isNew: true.
 * 4. Idempotencia y actualización ante conflicto de clave única (company_id, subject_type, subject_id) mediante onConflictDoUpdate.
 * 5. Aislamiento estricto multi-tenant: Company A no ve ni modifica excepciones de Company B bajo pulso_app NOBYPASSRLS.
 * 6. Transiciones completas de ciclo de vida en DB (OPEN -> ASSIGNED -> IN_ACTION -> RESOLVED -> VERIFIED -> CLOSED).
 * 7. Segregación de funciones: verify rechaza que el mismo usuario que resolvió actúe como verificador en DB.
 * 8. Rollback transaccional seguro: transacciones que se revierten dejan cero contaminación residual.
 * 9. Cero dependencias en mocks (todas las pruebas corren contra PostgreSQL real).
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { branches, companies, exceptions, users, employeeAuditLogs, domainEvents } from "@/lib/db/schema";
import { ApiError } from "@/lib/api/error";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { ExceptionService } from "@/lib/services/exception-service";
import {
  RUNTIME_ROLE,
  provisionRuntimeRole,
  runtimeUrl,
} from "./helpers/runtime-role";

neonConfig.webSocketConstructor = ws;

const runtimePool = new Pool({
  connectionString: runtimeUrl(),
  max: 1,
  allowExitOnIdle: true,
});
const runtime = drizzle(runtimePool, { schema });

describe("EXC-01 V2: Persistencia Canónica de Excepciones y RLS en Neon Postgres Aislado", () => {
  const companyA = randomUUID();
  const companyB = randomUUID();
  const branchA1 = randomUUID();
  const branchB1 = randomUUID();

  const userA1 = {
    id: randomUUID(),
    name: "Gerente Sucursal A1",
    email: `gerente.a1.${randomUUID().slice(0, 8)}@exc01.test`,
    companyId: companyA,
    branchId: branchA1,
    role: "GERENTE",
  };

  const userA2 = {
    id: randomUUID(),
    name: "Auditor Verificador Empresa A",
    email: `auditor.a2.${randomUUID().slice(0, 8)}@exc01.test`,
    companyId: companyA,
    branchId: null,
    role: "ADMIN",
  };

  const userB1 = {
    id: randomUUID(),
    name: "Gerente Sucursal B1",
    email: `gerente.b1.${randomUUID().slice(0, 8)}@exc01.test`,
    companyId: companyB,
    branchId: branchB1,
    role: "GERENTE",
  };

  beforeAll(async () => {
    // 1. Guardias de base de datos aislada
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

    // 2. Provisionamiento de pulso_app y concesión de privilegios
    await provisionRuntimeRole([
      "companies",
      "branches",
      "users",
      "exceptions",
      "employee_audit_logs",
    ]);

    // 3. Verificación de rol pulso_app sin bypass de RLS ni superusuario
    const [role] = (
      await db.execute(
        sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = ${RUNTIME_ROLE}`,
      )
    ).rows as Array<{ rolsuper: boolean; rolbypassrls: boolean }>;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });

    // 4. Aplicación del lote revisado 0152, sin DDL improvisado en beforeAll.
    for (const statement of readFileSync(
      "drizzle/0152_exc01_exceptions_rls.sql",
      "utf8",
    ).split("--> statement-breakpoint")) {
      if (statement.trim()) await db.execute(sql.raw(statement));
    }

    // 5. Sembrado de empresas, sucursales y usuarios de prueba
    await db.insert(companies).values([
      { id: companyA, name: `Empresa EXC-01 A ${companyA.slice(0, 8)}` },
      { id: companyB, name: `Empresa EXC-01 B ${companyB.slice(0, 8)}` },
    ]);

    await db.insert(branches).values([
      { id: branchA1, companyId: companyA, name: "Sucursal A1" },
      { id: branchB1, companyId: companyB, name: "Sucursal B1" },
    ]);

    await db.insert(users).values([
      {
        id: userA1.id,
        name: userA1.name,
        email: userA1.email,
        emailVerified: false,
        role: userA1.role,
        companyId: companyA,
        branchId: branchA1,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: userA2.id,
        name: userA2.name,
        email: userA2.email,
        emailVerified: false,
        role: userA2.role,
        companyId: companyA,
        branchId: null,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: userB1.id,
        name: userB1.name,
        email: userB1.email,
        emailVerified: false,
        role: userB1.role,
        companyId: companyB,
        branchId: branchB1,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
  });

  afterAll(async () => {
    // Limpieza de datos sembrados para evitar residuos en la base aislada
    try {
      await db.delete(domainEvents).where(
        sql`company_id IN (${companyA}, ${companyB})`
      );
      await db.delete(employeeAuditLogs).where(
        sql`user_id IN (${userA1.id}, ${userA2.id}, ${userB1.id})`
      );
      await db.delete(exceptions).where(
        sql`company_id IN (${companyA}, ${companyB})`
      );
      await db.delete(users).where(
        sql`company_id IN (${companyA}, ${companyB})`
      );
      await db.delete(branches).where(
        sql`company_id IN (${companyA}, ${companyB})`
      );
      await db.delete(companies).where(
        sql`id IN (${companyA}, ${companyB})`
      );
    } catch (e) {
      console.warn("Cleanup warning:", e);
    } finally {
      await runtimePool.end();
    }
  });

  it("1. Certifica estado RLS en pg_class y pg_policies para exceptions", async () => {
    const [{ relrowsecurity }] = (
      await db.execute(
        sql`SELECT relrowsecurity FROM pg_class WHERE relname = 'exceptions'`,
      )
    ).rows as Array<{ relrowsecurity: boolean }>;
    expect(relrowsecurity).toBe(true);

    const policies = (
      await db.execute(
        sql`SELECT policyname FROM pg_policies WHERE tablename = 'exceptions' AND policyname = 'exceptions_tenant_isolation'`,
      )
    ).rows as Array<{ policyname: string }>;
    expect(policies.length).toBe(1);
    expect(policies[0].policyname).toBe("exceptions_tenant_isolation");
  });

  it("2. Inserción persistente en PostgreSQL real con isNew: true", async () => {
    const subjectId = `temp-probe-${randomUUID().slice(0, 8)}`;

    const row = await ExceptionService.raise({
      companyId: companyA,
      branchId: branchA1,
      domain: "operacion",
      qsrCategory: "INOCUIDAD",
      severity: "warning",
      subjectType: "TEMPERATURE_CHECK",
      subjectId,
      reason: "Cámara fría 1 a 8°C (límite operativo NOM-251 es 4°C)",
      ownerId: userA1.id,
      actionMeta: { probeLocation: "Camara-1", expectedMaxTemp: 4, recordedTemp: 8 },
    });

    // Certificación de flag de inserción nueva
    expect(row.isNew).toBe(true);
    expect(row.id).toBeDefined();
    expect(row.companyId).toBe(companyA);
    expect(row.branchId).toBe(branchA1);
    expect(row.domain).toBe("operacion");
    expect(row.qsrCategory).toBe("INOCUIDAD");
    expect(row.severity).toBe("warning");
    expect(row.subjectType).toBe("TEMPERATURE_CHECK");
    expect(row.subjectId).toBe(subjectId);
    expect(row.status).toBe("OPEN");
    expect(row.ownerId).toBe(userA1.id);
    expect(row.slaDueAt).toBeInstanceOf(Date);
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);

    // Verificación directa en PostgreSQL
    const [persisted] = await db
      .select()
      .from(exceptions)
      .where(eq(exceptions.id, row.id))
      .limit(1);

    expect(persisted).toBeDefined();
    expect(persisted.id).toBe(row.id);
    expect(persisted.reason).toBe("Cámara fría 1 a 8°C (límite operativo NOM-251 es 4°C)");
    expect(persisted.actionMeta).toEqual({
      probeLocation: "Camara-1",
      expectedMaxTemp: 4,
      recordedTemp: 8,
    });
  });

  it("3. Idempotencia y actualización ante conflicto de clave única (company_id, subject_type, subject_id) mediante onConflictDoUpdate", async () => {
    const subjectId = `unique-audit-${randomUUID().slice(0, 8)}`;

    // Primera inserción
    const initial = await ExceptionService.raise({
      companyId: companyA,
      branchId: branchA1,
      domain: "cumplimiento",
      qsrCategory: "INOCUIDAD",
      severity: "warning",
      subjectType: "CLEANING_LOG",
      subjectId,
      reason: "Bitácora matutina incompleta",
    });

    expect(initial.isNew).toBe(true);

    // Transición a IN_ACTION para certificar que el re-raise no destruye el estado
    await ExceptionService.assign(initial.id, companyA, userA1.id, userA2.id);
    await ExceptionService.startAction(initial.id, companyA, userA1.id);

    // Segunda invocación con la misma clave de unicidad (misma company, subjectType, subjectId)
    // pero con severidad mayor y motivo actualizado
    const updated = await ExceptionService.raise({
      companyId: companyA,
      branchId: branchA1,
      domain: "cumplimiento",
      qsrCategory: "INOCUIDAD",
      severity: "critical",
      subjectType: "CLEANING_LOG",
      subjectId,
      reason: "Bitácora matutina ausente tras 4 horas de apertura",
      actionMeta: { escalationLevel: 2 },
    });

    // Debe ser idempotente: no crea fila duplicada, isNew es false
    expect(updated.isNew).toBe(false);
    expect(updated.id).toBe(initial.id);
    expect(updated.severity).toBe("critical");
    expect(updated.reason).toBe("Bitácora matutina ausente tras 4 horas de apertura");
    expect(updated.actionMeta).toEqual({ escalationLevel: 2 });
    // Invariante de ciclo de vida: NO se reinicia a OPEN
    expect(updated.status).toBe("IN_ACTION");

    // Verificación física de unicidad en Postgres: exactamente 1 fila para la tupla
    const allMatches = await db
      .select()
      .from(exceptions)
      .where(
        and(
          eq(exceptions.companyId, companyA),
          eq(exceptions.subjectType, "CLEANING_LOG"),
          eq(exceptions.subjectId, subjectId),
        ),
      );

    expect(allMatches).toHaveLength(1);
    expect(allMatches[0].id).toBe(initial.id);
    expect(allMatches[0].severity).toBe("critical");
  });

  it("4. Aislamiento estricto multi-tenant: Company A no ve ni modifica excepciones de Company B bajo pulso_app NOBYPASSRLS", async () => {
    const subjectA = `iso-sub-a-${randomUUID().slice(0, 8)}`;
    const subjectB = `iso-sub-b-${randomUUID().slice(0, 8)}`;

    // Crear una excepción para Company A y otra para Company B
    const excA = await ExceptionService.raise({
      companyId: companyA,
      branchId: branchA1,
      domain: "inventario",
      qsrCategory: "ABASTO",
      severity: "warning",
      subjectType: "STOCK_OUT",
      subjectId: subjectA,
      reason: "Desabasto de insumo clave Company A",
    });

    const excB = await ExceptionService.raise({
      companyId: companyB,
      branchId: branchB1,
      domain: "inventario",
      qsrCategory: "ABASTO",
      severity: "high",
      subjectType: "STOCK_OUT",
      subjectId: subjectB,
      reason: "Desabasto de insumo clave Company B",
    });

    // 4.1 Default-deny sin contexto de empresa: pulso_app no ve filas de ninguna empresa
    const uncontextedRows = await runtime.select().from(exceptions);
    expect(uncontextedRows).toHaveLength(0);

    // 4.2 En contexto de Company A bajo pulso_app:
    await withCompanyContext({ companyId: companyA }, async (tx) => {
      // Listado del servicio sólo incluye excepciones de Company A
      const listA = await ExceptionService.list(companyA, {}, tx);
      const ids = listA.map((r) => r.id);
      expect(ids).toContain(excA.id);
      expect(ids).not.toContain(excB.id);

      // Consulta directa por SQL en DB sólo retorna Company A
      const rowsA = await tx.select().from(exceptions);
      for (const r of rowsA) {
        expect(r.companyId).toBe(companyA);
      }

      // getById con el ID de Company B lanza 404 indistinto (sin filtrar existencia)
      await expect(
        ExceptionService.getById(excB.id, companyA, tx),
      ).rejects.toThrow(ApiError);

      // Consulta directa por ID de Company B retorna 0 filas bajo pulso_app
      const crossRow = await tx
        .select()
        .from(exceptions)
        .where(eq(exceptions.id, excB.id));
      expect(crossRow).toHaveLength(0);

      // Intento de escritura transversal (insertar con company_id = companyB estando en context A)
      // es bloqueado por PostgreSQL RLS WITH CHECK
      let insertError: any = null;
      try {
        await tx.insert(exceptions).values({
          id: randomUUID(),
          companyId: companyB,
          domain: "finanzas",
          qsrCategory: "DINERO",
          severity: "fatal",
          subjectType: "CROSS_TENANT_ATTACK",
          subjectId: "hack-01",
          reason: "Violación de política RLS",
        });
      } catch (e) {
        insertError = e;
      }
      expect(insertError).toBeDefined();
      const fullErrorText = `${insertError?.message ?? ""} ${insertError?.cause?.message ?? ""}`;
      expect(fullErrorText).toMatch(/row-level security|policy/i);
    }, runtime);

    // 4.3 En contexto de Company B bajo pulso_app:
    await withCompanyContext({ companyId: companyB }, async (tx) => {
      const listB = await ExceptionService.list(companyB, {}, tx);
      const ids = listB.map((r) => r.id);
      expect(ids).toContain(excB.id);
      expect(ids).not.toContain(excA.id);

      await expect(
        ExceptionService.getById(excA.id, companyB, tx),
      ).rejects.toThrow(ApiError);
    }, runtime);
  });

  it("5. Transiciones completas de ciclo de vida en DB (OPEN -> ASSIGNED -> IN_ACTION -> RESOLVED -> VERIFIED -> CLOSED)", async () => {
    const subjectId = `lifecycle-${randomUUID().slice(0, 8)}`;

    // Iniciar excepción en OPEN
    const exc = await ExceptionService.raise({
      companyId: companyA,
      branchId: branchA1,
      domain: "equipos",
      qsrCategory: "DINERO",
      severity: "high",
      subjectType: "EQUIPMENT_FAULT",
      subjectId,
      reason: "Freidora 2 presenta fluctuación de temperatura de aceite",
    });
    expect(exc.status).toBe("OPEN");

    // 1. OPEN -> ASSIGNED
    const assigned = await ExceptionService.assign(
      exc.id,
      companyA,
      userA1.id,
      userA2.id,
    );
    expect(assigned.status).toBe("ASSIGNED");
    expect(assigned.ownerId).toBe(userA1.id);

    const [dbAssigned] = await db
      .select()
      .from(exceptions)
      .where(eq(exceptions.id, exc.id));
    expect(dbAssigned.status).toBe("ASSIGNED");
    expect(dbAssigned.ownerId).toBe(userA1.id);

    // 2. ASSIGNED -> IN_ACTION
    const inAction = await ExceptionService.startAction(
      exc.id,
      companyA,
      userA1.id,
    );
    expect(inAction.status).toBe("IN_ACTION");

    const [dbInAction] = await db
      .select()
      .from(exceptions)
      .where(eq(exceptions.id, exc.id));
    expect(dbInAction.status).toBe("IN_ACTION");

    // 3. IN_ACTION -> RESOLVED
    const resolutionText = "Termostato sustituido por refacción original y calibrado a 180°C";
    const resolved = await ExceptionService.resolve(
      exc.id,
      companyA,
      userA1.id,
      resolutionText,
    );
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.resolution).toBe(resolutionText);
    expect(resolved.resolvedBy).toBe(userA1.id);
    expect(resolved.resolvedAt).toBeInstanceOf(Date);

    const [dbResolved] = await db
      .select()
      .from(exceptions)
      .where(eq(exceptions.id, exc.id));
    expect(dbResolved.status).toBe("RESOLVED");
    expect(dbResolved.resolution).toBe(resolutionText);
    expect(dbResolved.resolvedBy).toBe(userA1.id);

    // 4. RESOLVED -> VERIFIED (segregación: userA2 es distinto de userA1)
    const verified = await ExceptionService.verify(
      exc.id,
      companyA,
      userA2.id,
    );
    expect(verified.status).toBe("VERIFIED");
    expect(verified.verifiedBy).toBe(userA2.id);
    expect(verified.verifiedAt).toBeInstanceOf(Date);

    const [dbVerified] = await db
      .select()
      .from(exceptions)
      .where(eq(exceptions.id, exc.id));
    expect(dbVerified.status).toBe("VERIFIED");
    expect(dbVerified.verifiedBy).toBe(userA2.id);

    // 5. VERIFIED -> CLOSED
    const closed = await ExceptionService.close(
      exc.id,
      companyA,
      userA2.id,
    );
    expect(closed.status).toBe("CLOSED");
    expect(closed.closedAt).toBeInstanceOf(Date);

    const [dbClosed] = await db
      .select()
      .from(exceptions)
      .where(eq(exceptions.id, exc.id));
    expect(dbClosed.status).toBe("CLOSED");
    expect(dbClosed.closedAt).toBeInstanceOf(Date);

    // 6. listOpen excluye excepciones terminales CLOSED
    const openExceptions = await ExceptionService.listOpen(companyA);
    expect(openExceptions.map((e) => e.id)).not.toContain(exc.id);
  });

  it("6. Segregación de funciones: verify rechaza que el mismo usuario que resolvió actúe como verificador en DB", async () => {
    const subjectId = `segregation-${randomUUID().slice(0, 8)}`;

    const exc = await ExceptionService.raise({
      companyId: companyA,
      branchId: branchA1,
      domain: "personal",
      qsrCategory: "PERSONAL",
      severity: "warning",
      subjectType: "SHIFT_TARDINESS",
      subjectId,
      reason: "Retardo injustificado de personal de cocina",
    });

    await ExceptionService.assign(exc.id, companyA, userA1.id, userA2.id);
    await ExceptionService.startAction(exc.id, companyA, userA1.id);
    await ExceptionService.resolve(
      exc.id,
      companyA,
      userA1.id, // userA1 resuelve la excepción
      "Turno cubierto con relevo de apoyo",
    );

    // Intento de auto-verificación por parte de userA1 debe ser rechazado con conflicto (409)
    await expect(
      ExceptionService.verify(exc.id, companyA, userA1.id),
    ).rejects.toThrow(ApiError);

    // Comprobación de estado intacto en PostgreSQL
    const [persisted] = await db
      .select()
      .from(exceptions)
      .where(eq(exceptions.id, exc.id));

    expect(persisted.status).toBe("RESOLVED");
    expect(persisted.verifiedBy).toBeNull();
    expect(persisted.verifiedAt).toBeNull();
  });

  it("7. Rollback transaccional seguro: transacciones que se revierten dejan cero contaminación residual", async () => {
    const rollbackSubject = `rollback-${randomUUID().slice(0, 8)}`;
    let createdId: string | null = null;

    // Ejecutar raise dentro de una transacción que explícitamente se revierte
    await expect(
      db.transaction(async (tx) => {
        const created = await ExceptionService.raise(
          {
            companyId: companyA,
            branchId: branchA1,
            domain: "equipos",
            qsrCategory: "DINERO",
            severity: "critical",
            subjectType: "EXPERIMENTAL_PROTOTYPE",
            subjectId: rollbackSubject,
            reason: "Esta excepción no debe persistir tras rollback",
          },
          tx,
        );

        createdId = created.id;
        expect(createdId).toBeDefined();

        // En la transacción actual la fila es visible
        const [inTx] = await tx
          .select()
          .from(exceptions)
          .where(eq(exceptions.id, createdId));
        expect(inTx).toBeDefined();

        // Disparar error para forzar ROLLBACK
        throw new Error("SIMULATED_TRANSACTION_FAILURE");
      }),
    ).rejects.toThrow("SIMULATED_TRANSACTION_FAILURE");

    // Verificar en conexión separada que la fila jamás quedó guardada en PostgreSQL
    expect(createdId).not.toBeNull();
    const outside = await db
      .select()
      .from(exceptions)
      .where(eq(exceptions.id, createdId!));

    expect(outside).toHaveLength(0);

    // Verificar que getBySubject devuelve null
    const notFound = await ExceptionService.getBySubject(
      companyA,
      "EXPERIMENTAL_PROTOTYPE",
      rollbackSubject,
    );
    expect(notFound).toBeNull();
  });

  it("8. Ciclo de reapertura (REOPEN) y escalamiento (ESCALATE) con persistencia en DB", async () => {
    const subjectId = `reopen-esc-${randomUUID().slice(0, 8)}`;

    const exc = await ExceptionService.raise({
      companyId: companyA,
      branchId: branchA1,
      domain: "operacion",
      qsrCategory: "INOCUIDAD",
      severity: "warning",
      subjectType: "PEST_CONTROL",
      subjectId,
      reason: "Avistamiento de fauna nociva menor en almacén seco",
    });

    // Escalar la excepción
    const escalated = await ExceptionService.escalate(
      exc.id,
      companyA,
      userA2.id,
      "Reincidencia observada en menos de 24 horas",
    );
    expect(escalated.status).toBe("ESCALATED");

    const [dbEscalated] = await db
      .select()
      .from(exceptions)
      .where(eq(exceptions.id, exc.id));
    expect(dbEscalated.status).toBe("ESCALATED");

    // Llevar al cierre para probar reapertura
    await ExceptionService.assign(exc.id, companyA, userA1.id, userA2.id);
    await ExceptionService.startAction(exc.id, companyA, userA1.id);
    await ExceptionService.resolve(
      exc.id,
      companyA,
      userA1.id,
      "Fumigación de emergencia aplicada por proveedor certificado",
    );
    await ExceptionService.verify(exc.id, companyA, userA2.id);
    await ExceptionService.close(exc.id, companyA, userA2.id);

    // Reabrir excepción cerrada
    const reopened = await ExceptionService.reopen(
      exc.id,
      companyA,
      userA2.id,
      "Se detectó nuevo vector en área adyacente a cocina",
    );
    expect(reopened.status).toBe("REOPENED");
    expect(reopened.reopenedFromId).toBe(exc.id);

    const [dbReopened] = await db
      .select()
      .from(exceptions)
      .where(eq(exceptions.id, exc.id));
    expect(dbReopened.status).toBe("REOPENED");
    expect(dbReopened.reopenedFromId).toBe(exc.id);
  });
});
