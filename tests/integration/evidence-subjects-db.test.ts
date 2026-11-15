/**
 * EVI-02.a — Pruebas de Integración en Base de Datos Aislada (Neon Postgres).
 *
 * Valida la persistencia, consulta, aislamiento multi-tenant y acotamiento de sucursal
 * para los nuevos sujetos de evidencia:
 * - INVOICE (Facturas)
 * - PAYMENT (Corridas de pago y partidas)
 * - EXCEPTION (Excepciones operativas)
 * - Preservación de SALE_RECOVERY
 *
 * Utiliza el patrón canónico de DDL aditivo en el test harness (`beforeAll`),
 * sin alterar los archivos de esquema ni el journal de migraciones del repositorio.
 * Ejecuta bajo el rol de runtime `pulso_app` con `NOBYPASSRLS`.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  companies,
  branches,
  users,
  invoices,
  paymentRuns,
  exceptions,
  recipes,
  salesEntries,
} from "@/lib/db/schema";
import {
  EvidenceSubjectService,
  type UserScope,
} from "@/lib/services/evidence-subject-service";
import { ApiError } from "@/lib/api/error";

describe("EVI-02.a: Sujetos de Evidencia en Postgres Aislado (INVOICE, PAYMENT, EXCEPTION)", () => {
  const companyA = randomUUID();
  const companyB = randomUUID();
  const branchA1 = randomUUID();
  const branchA2 = randomUUID();
  const branchB1 = randomUUID();

  const userAdminA: UserScope = {
    id: randomUUID(),
    role: "ADMIN",
    companyId: companyA,
    branchId: null,
  };

  const userGerenteA1: UserScope = {
    id: randomUUID(),
    role: "GERENTE",
    companyId: companyA,
    branchId: branchA1,
  };

  const userGerenteA2: UserScope = {
    id: randomUUID(),
    role: "GERENTE",
    companyId: companyA,
    branchId: branchA2,
  };

  const userGerenteB1: UserScope = {
    id: randomUUID(),
    role: "GERENTE",
    companyId: companyB,
    branchId: branchB1,
  };

  const invoiceA1Id = randomUUID();
  const invoiceCorporateAId = randomUUID();
  const invoiceB1Id = randomUUID();

  const paymentRunA1Id = randomUUID();
  const paymentRunCorporateAId = randomUUID();
  const paymentItemA1Id = randomUUID();
  const paymentRunB1Id = randomUUID();

  const exceptionA1Id = randomUUID();
  const exceptionCorporateAId = randomUUID();
  const exceptionB1Id = randomUUID();

  const recipeA1Id = randomUUID();
  const saleEntryA1Id = randomUUID();

  beforeAll(async () => {
    // 1. Guardias de base aislada
    const testUrl = process.env.TEST_DATABASE_URL;
    expect(testUrl).toBeDefined();
    const host = new URL(testUrl!).hostname.replace(/-pooler(?=\.)/, "");
    expect(host).toBe("ep-cold-morning-bewqoz3o.c-9.us-east-2.aws.neon.tech");

    if (existsSync(".env")) {
      const op = parse(readFileSync(".env")).DATABASE_URL;
      if (op) expect(new URL(op).hostname.replace(/-pooler(?=\.)/, "")).not.toBe(host);
    }

    // 2. Rol pulso_app verificado
    const [role] = (
      await db.execute(sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'pulso_app'`)
    ).rows as Array<{ rolsuper: boolean; rolbypassrls: boolean }>;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });

    // 3. DDL aditivo en harness aislado: agrega INVOICE, PAYMENT, EXCEPTION si no existen
    await db.execute(sql`ALTER TYPE "public"."evidence_entity_type" ADD VALUE IF NOT EXISTS 'INVOICE'`);
    await db.execute(sql`ALTER TYPE "public"."evidence_entity_type" ADD VALUE IF NOT EXISTS 'PAYMENT'`);
    await db.execute(sql`ALTER TYPE "public"."evidence_entity_type" ADD VALUE IF NOT EXISTS 'EXCEPTION'`);
    await db.execute(sql`ALTER TABLE "public"."payment_run_items" ADD COLUMN IF NOT EXISTS "payroll_snapshot" jsonb`);

    // Comprueba catálogo resultante
    const labelsResult = await db.execute<{ label: string }>(
      sql`SELECT enumlabel AS label FROM pg_enum WHERE enumtypid = 'public.evidence_entity_type'::regtype ORDER BY enumsortorder`
    );
    const labels = labelsResult.rows.map((r) => r.label);
    expect(labels).toContain("INVOICE");
    expect(labels).toContain("PAYMENT");
    expect(labels).toContain("EXCEPTION");
    expect(labels).toContain("SALE_RECOVERY");

    // Concede permisos DML a pulso_app
    const tables = [
      "companies",
      "branches",
      "users",
      "invoices",
      "payment_runs",
      "payment_run_items",
      "exceptions",
      "evidence",
      "recipes",
      "sales_entries",
    ];
    for (const t of tables) {
      await db.execute(sql.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON "${t}" TO "pulso_app"`));
    }

    // 4. Sembrado de empresas y sucursales
    await db.insert(companies).values([
      { id: companyA, name: "Empresa EVI-02 A" },
      { id: companyB, name: "Empresa EVI-02 B" },
    ]);

    await db.insert(branches).values([
      { id: branchA1, companyId: companyA, name: "Sucursal EVI A1" },
      { id: branchA2, companyId: companyA, name: "Sucursal EVI A2" },
      { id: branchB1, companyId: companyB, name: "Sucursal EVI B1" },
    ]);

    // 5. Sembrado de usuarios
    await db.insert(users).values([
      {
        id: userAdminA.id,
        name: "Admin Empresa A",
        email: `${userAdminA.id}@test.com`,
        emailVerified: false,
        role: "ADMIN",
        companyId: companyA,
        branchId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: userGerenteA1.id,
        name: "Gerente Sucursal A1",
        email: `${userGerenteA1.id}@test.com`,
        emailVerified: false,
        role: "GERENTE",
        companyId: companyA,
        branchId: branchA1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: userGerenteA2.id,
        name: "Gerente Sucursal A2",
        email: `${userGerenteA2.id}@test.com`,
        emailVerified: false,
        role: "GERENTE",
        companyId: companyA,
        branchId: branchA2,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: userGerenteB1.id,
        name: "Gerente Sucursal B1",
        email: `${userGerenteB1.id}@test.com`,
        emailVerified: false,
        role: "GERENTE",
        companyId: companyB,
        branchId: branchB1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    // 6. Sembrado de facturas (invoices)
    await db.insert(invoices).values([
      {
        id: invoiceA1Id,
        companyId: companyA,
        branchId: branchA1,
        uuid: `uuid-inv-a1-${companyA.slice(0, 8)}`,
        fecha: "2026-11-15",
        subtotal: 100000,
        total: 116000,
        rfcEmisor: "AAA010101AAA",
        rfcReceptor: "BBB020202BBB",
      },
      {
        id: invoiceCorporateAId,
        companyId: companyA,
        branchId: null, // Corporativa
        uuid: `uuid-inv-corp-${companyA.slice(0, 8)}`,
        fecha: "2026-11-15",
        subtotal: 500000,
        total: 580000,
        rfcEmisor: "CORP010101AAA",
        rfcReceptor: "HOLD020202BBB",
      },
      {
        id: invoiceB1Id,
        companyId: companyB,
        branchId: branchB1,
        uuid: `uuid-inv-b1-${companyB.slice(0, 8)}`,
        fecha: "2026-11-15",
        subtotal: 80000,
        total: 92800,
        rfcEmisor: "CCC030303CCC",
        rfcReceptor: "DDD040404DDD",
      },
    ]);

    // 7. Sembrado de corridas de pago (payment_runs y payment_run_items)
    await db.insert(paymentRuns).values([
      {
        id: paymentRunA1Id,
        companyId: companyA,
        branchId: branchA1,
        title: "Dispersión Quincenal A1",
        runDate: new Date(),
        status: "DRAFT",
        totalAmountCents: 50000,
        currency: "MXN",
      },
      {
        id: paymentRunCorporateAId,
        companyId: companyA,
        branchId: null,
        title: "Dispersión Corporativa Holding",
        runDate: new Date(),
        status: "DRAFT",
        totalAmountCents: 200000,
        currency: "MXN",
      },
      {
        id: paymentRunB1Id,
        companyId: companyB,
        branchId: branchB1,
        title: "Dispersión Empresa B",
        runDate: new Date(),
        status: "DRAFT",
        totalAmountCents: 45000,
        currency: "MXN",
      },
    ]);

    await db.execute(sql`
      INSERT INTO payment_run_items (id, payment_run_id, item_type, reference_id, amount_cents)
      VALUES (${paymentItemA1Id}, ${paymentRunA1Id}, 'INVOICE'::payment_run_item_type, ${invoiceA1Id}, 25000)
    `);

    // 8. Sembrado de excepciones (exceptions)
    await db.insert(exceptions).values([
      {
        id: exceptionA1Id,
        companyId: companyA,
        branchId: branchA1,
        domain: "inventario",
        qsrCategory: "ABASTO",
        severity: "warning",
        subjectType: "waste",
        subjectId: randomUUID(),
        reason: "Merma sospechosa en corte",
        status: "OPEN",
      },
      {
        id: exceptionCorporateAId,
        companyId: companyA,
        branchId: null,
        domain: "finanzas",
        qsrCategory: "DINERO",
        severity: "critical",
        subjectType: "audit",
        subjectId: randomUUID(),
        reason: "Falta de conciliación bancaria holding",
        status: "OPEN",
      },
      {
        id: exceptionB1Id,
        companyId: companyB,
        branchId: branchB1,
        domain: "equipos",
        qsrCategory: "ABASTO",
        severity: "warning",
        subjectType: "equipment",
        subjectId: randomUUID(),
        reason: "Falla en cámara fría B1",
        status: "OPEN",
      },
    ]);

    // 9. Sembrado de receta y venta histórica para comprobar SALE_RECOVERY
    await db.insert(recipes).values({
      id: recipeA1Id,
      companyId: companyA,
      name: "Hamburguesa Gourmet",
    });

    await db.insert(salesEntries).values({
      id: saleEntryA1Id,
      companyId: companyA,
      branchId: branchA1,
      recipeId: recipeA1Id,
      quantitySold: "1.00",
      totalRevenue: 15000,
    });
  });

  it("1. Persistencia y consulta de evidencia INVOICE bajo pulso_app con clave canónica", async () => {
    let evidenceRecordId = "";

    await db.transaction(async (tx) => {
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      await tx.execute(
        sql`SELECT set_config('app.current_company_id', ${companyA}, true), set_config('app.current_branch_id', ${branchA1}, true)`
      );

      const record = await EvidenceSubjectService.attachEvidence(
        {
          user: userGerenteA1,
          subjectType: "INVOICE",
          entityId: invoiceA1Id,
          mimeType: "application/pdf",
        },
        tx
      );

      expect(record.id).toBeDefined();
      expect(record.companyId).toBe(companyA);
      expect(record.branchId).toBe(branchA1);
      expect(record.entityType).toBe("INVOICE");
      expect(record.entityId).toBe(invoiceA1Id);
      expect(record.storageKey).toContain(
        `companies/${companyA}/branches/${branchA1}/invoice/${invoiceA1Id}/${record.id}`
      );

      evidenceRecordId = record.id;
    });

    // Consultar evidencia fuera de la transacción bajo pulso_app
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      await tx.execute(
        sql`SELECT set_config('app.current_company_id', ${companyA}, true), set_config('app.current_branch_id', ${branchA1}, true)`
      );

      const list = await EvidenceSubjectService.getEvidenceForSubject(
        {
          user: userGerenteA1,
          subjectType: "INVOICE",
          entityId: invoiceA1Id,
        },
        tx
      );

      expect(list.length).toBeGreaterThanOrEqual(1);
      const found = list.find((e) => e.id === evidenceRecordId);
      expect(found).toBeDefined();
      expect(found?.entityType).toBe("INVOICE");
    });
  });

  it("2. Persistencia de evidencia PAYMENT para corrida corporativa y partida bajo pulso_app", async () => {
    // 2.a Evidencia sobre corrida de pago corporativa
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      await tx.execute(
        sql`SELECT set_config('app.current_company_id', ${companyA}, true)`
      );

      const corpRecord = await EvidenceSubjectService.attachEvidence(
        {
          user: userAdminA,
          subjectType: "PAYMENT",
          entityId: paymentRunCorporateAId,
          mimeType: "application/pdf",
        },
        tx
      );

      expect(corpRecord.entityType).toBe("PAYMENT");
      expect(corpRecord.branchId).toBeNull();
      expect(corpRecord.storageKey).toContain(
        `companies/${companyA}/branches/corporate/payment/${paymentRunCorporateAId}/${corpRecord.id}`
      );
    });

    // 2.b Evidencia sobre partida individual de corrida de pago
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      await tx.execute(
        sql`SELECT set_config('app.current_company_id', ${companyA}, true), set_config('app.current_branch_id', ${branchA1}, true)`
      );

      const itemRecord = await EvidenceSubjectService.attachEvidence(
        {
          user: userGerenteA1,
          subjectType: "PAYMENT",
          entityId: paymentItemA1Id,
          mimeType: "image/png",
        },
        tx
      );

      expect(itemRecord.entityType).toBe("PAYMENT");
      expect(itemRecord.branchId).toBe(branchA1);
      expect(itemRecord.storageKey).toContain(
        `companies/${companyA}/branches/${branchA1}/payment/${paymentItemA1Id}/${itemRecord.id}`
      );
    });
  });

  it("3. Persistencia y borrado lógico (soft-delete) de evidencia EXCEPTION", async () => {
    let excEvidenceId = "";

    await db.transaction(async (tx) => {
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      await tx.execute(
        sql`SELECT set_config('app.current_company_id', ${companyA}, true), set_config('app.current_branch_id', ${branchA1}, true)`
      );

      const record = await EvidenceSubjectService.attachEvidence(
        {
          user: userGerenteA1,
          subjectType: "EXCEPTION",
          entityId: exceptionA1Id,
          mimeType: "image/jpeg",
        },
        tx
      );

      expect(record.entityType).toBe("EXCEPTION");
      excEvidenceId = record.id;
    });

    // Validar que se lista activamente
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      await tx.execute(
        sql`SELECT set_config('app.current_company_id', ${companyA}, true), set_config('app.current_branch_id', ${branchA1}, true)`
      );

      const activeList = await EvidenceSubjectService.getEvidenceForSubject(
        {
          user: userGerenteA1,
          subjectType: "EXCEPTION",
          entityId: exceptionA1Id,
        },
        tx
      );

      expect(activeList.some((e) => e.id === excEvidenceId)).toBe(true);

      // Ejecutar borrado lógico
      const delResult = await EvidenceSubjectService.removeEvidence(
        {
          user: userGerenteA1,
          evidenceId: excEvidenceId,
        },
        tx
      );
      expect(delResult.deleted).toBe(true);

      // Ahora NO debe figurar en listado por defecto
      const afterDelList = await EvidenceSubjectService.getEvidenceForSubject(
        {
          user: userGerenteA1,
          subjectType: "EXCEPTION",
          entityId: exceptionA1Id,
        },
        tx
      );
      expect(afterDelList.some((e) => e.id === excEvidenceId)).toBe(false);

      // Pero sí con includeDeleted: true (preservación inmutable)
      const auditList = await EvidenceSubjectService.getEvidenceForSubject(
        {
          user: userGerenteA1,
          subjectType: "EXCEPTION",
          entityId: exceptionA1Id,
          includeDeleted: true,
        },
        tx
      );
      const auditRecord = auditList.find((e) => e.id === excEvidenceId);
      expect(auditRecord).toBeDefined();
      expect(auditRecord?.deletedAt).not.toBeNull();
    });
  });

  it("4. Preservación del sujeto SALE_RECOVERY", async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      await tx.execute(
        sql`SELECT set_config('app.current_company_id', ${companyA}, true), set_config('app.current_branch_id', ${branchA1}, true)`
      );

      const recoveryRecord = await EvidenceSubjectService.attachEvidence(
        {
          user: userGerenteA1,
          subjectType: "SALE_RECOVERY",
          entityId: saleEntryA1Id,
          mimeType: "application/json",
        },
        tx
      );

      expect(recoveryRecord.entityType).toBe("SALE_RECOVERY");
      expect(recoveryRecord.branchId).toBe(branchA1);
      expect(recoveryRecord.storageKey).toContain(
        `companies/${companyA}/branches/${branchA1}/sale_recovery/${saleEntryA1Id}/${recoveryRecord.id}`
      );
    });
  });

  it("5. Aislamiento estricto de sucursales: Gerente A2 no accede a evidencias de Sucursal A1", async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      await tx.execute(
        sql`SELECT set_config('app.current_company_id', ${companyA}, true), set_config('app.current_branch_id', ${branchA2}, true)`
      );

      // Intento de Gerente A2 de adjuntar evidencia a factura de A1
      await expect(
        EvidenceSubjectService.attachEvidence(
          {
            user: userGerenteA2,
            subjectType: "INVOICE",
            entityId: invoiceA1Id,
            mimeType: "application/pdf",
          },
          tx
        )
      ).rejects.toThrow(ApiError);

      // Intento de Gerente A2 de listar evidencias de excepción de A1
      await expect(
        EvidenceSubjectService.getEvidenceForSubject(
          {
            user: userGerenteA2,
            subjectType: "EXCEPTION",
            entityId: exceptionA1Id,
          },
          tx
        )
      ).rejects.toThrow(ApiError);
    });
  });

  it("6. Aislamiento multi-tenant: Empresa B no puede ver ni adjuntar a entidades de Empresa A", async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      await tx.execute(
        sql`SELECT set_config('app.current_company_id', ${companyB}, true), set_config('app.current_branch_id', ${branchB1}, true)`
      );

      await expect(
        EvidenceSubjectService.attachEvidence(
          {
            user: userGerenteB1,
            subjectType: "INVOICE",
            entityId: invoiceA1Id, // Entidad de Company A
            mimeType: "application/pdf",
          },
          tx
        )
      ).rejects.toThrow(ApiError);

      await expect(
        EvidenceSubjectService.getEvidenceForSubject(
          {
            user: userGerenteB1,
            subjectType: "PAYMENT",
            entityId: paymentRunA1Id,
          },
          tx
        )
      ).rejects.toThrow(ApiError);
    });
  });

  it("7. Atomicidad y reversión: fallo en transacción revierte la inserción de evidencia", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
        await tx.execute(
          sql`SELECT set_config('app.current_company_id', ${companyA}, true), set_config('app.current_branch_id', ${branchA1}, true)`
        );

        // Adjuntar evidencia válida
        await EvidenceSubjectService.attachEvidence(
          {
            user: userGerenteA1,
            subjectType: "INVOICE",
            entityId: invoiceA1Id,
            mimeType: "image/png",
          },
          tx
        );

        // Fallo intencional para forzar rollback de la transacción
        throw new Error("Rollback forzado de prueba de integración de evidencia");
      })
    ).rejects.toThrow("Rollback forzado de prueba de integración de evidencia");

    // Verificar que la evidencia NO quedó en la base de datos
    const [row] = (
      await db.execute(
        sql`SELECT count(*)::int as count FROM evidence WHERE entity_id = ${invoiceA1Id} AND mime_type = 'image/png'`
      )
    ).rows as Array<{ count: number }>;
    expect(row.count).toBe(0);
  });
});
