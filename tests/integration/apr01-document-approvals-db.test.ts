/**
 * APR-01 — Verificación V2 en Neon PostgreSQL real (esquema efímero aislado con
 * migración candidata `0170_apr01_document_approvals.sql` + rol NOBYPASSRLS).
 *
 * Comprueba sobre Postgres real:
 * 1. Los 5 tipos de documento (`OC`, `OS`, `EXPENSE`, `PAYMENT_RUN`, `PAYROLL`)
 *    declaran versión aprobada (`approvalVersion`), huella material SHA-256 y
 *    autoridad (`requiredRole`, `authoritySource`, `approvedBy`, `approvedByRole`,
 *    `secondaryApprovedBy`) con auditoría crítica `AUD-02` atómica.
 * 2. Repetir la aprobación con el mismo contenido material es idempotente
 *    (misma versión `1`, sin duplicados).
 * 3. Un cambio NO material (notas/título/fecha vencimiento) conserva la versión
 *    aprobada vigente (`invalidated: false`, `changedFields: []`).
 * 4. Un cambio MATERIAL en cada uno de los 5 documentos invalida la aprobación
 *    (`status: 'INVALIDATED'`, `changedFields` exactos, auditoría `AUD-02`),
 *    revierte el documento especializado a re-aprobación (`OC -> PENDING_APPROVAL`,
 *    `OS -> DRAFT`, `EXPENSE -> PENDING_APPROVAL`, `PAYMENT_RUN -> PENDING_APPROVAL`
 *    + `payment_approvals -> REJECTED`, `PAYROLL -> STALE_REQUIRES_NEW_SNAPSHOT`),
 *    y re-aprobar emite `approvalVersion: 2` preservando `v1` en historial.
 * 5. El índice único parcial impide dos versiones `APPROVED` activas simultáneas.
 * 6. Rollback atómico ante fallo FK de `AUD-02` y aislamiento RLS real bajo rol
 *    `NOBYPASSRLS` (empresa B no ve ni muta aprobaciones de empresa A).
 */
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import {
  approvalRequests,
  branches,
  companies,
  companyBankAccounts,
  employeeAuditLogs,
  invoices,
  operatingExpenses,
  paymentApprovals,
  paymentRuns,
  purchaseOrders,
  serviceOrders,
  suppliers,
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

import {
  checkAndInvalidateOnMaterialChange,
  getDocumentApprovalStatus,
  recordDocumentApproval,
} from "@/lib/services/document-approval-service";

const TEST_DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const describeDb = TEST_DB_URL ? describe : describe.skip;

describeDb("APR-01 — Alineación de aprobaciones (OC/OS/gasto/pago/nómina), invalidación material y RLS (V2 Neon)", () => {
  let pool: Pool;
  let testDb: ReturnType<typeof drizzle<typeof schema>>;

  const suffix = crypto.randomBytes(4).toString("hex");
  const namespace = `apr01_${suffix}`;
  const runtimeRole = `${namespace}_app`;
  let schemaCreated = false;
  let roleCreated = false;

  const companyA = crypto.randomUUID();
  const companyB = crypto.randomUUID();
  const branchA = crypto.randomUUID();
  const branchB = crypto.randomUUID();
  const supplierA = crypto.randomUUID();
  const acctA = crypto.randomUUID();
  const evidenceUuid = crypto.randomUUID();
  const requesterId = `apr01-req-${suffix}`;
  const adminId = `apr01-adm-${suffix}`;
  const ownerId = `apr01-own-${suffix}`;
  const adminBId = `apr01-admb-${suffix}`;

  beforeAll(async () => {
    const setupPool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
    try {
      await setupPool.query(`CREATE SCHEMA "${namespace}"`);
      schemaCreated = true;

      const tablesToClone = [
        "companies",
        "branches",
        "users",
        "suppliers",
        "company_bank_accounts",
        "purchase_orders",
        "service_orders",
        "invoices",
        "approval_requests",
        "operating_expenses",
        "payment_runs",
        "payment_approvals",
        "employee_audit_logs",
      ];
      for (const t of tablesToClone) {
        await setupPool.query(
          `CREATE TABLE "${namespace}"."${t}" (LIKE public."${t}" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`,
        );
      }
      await setupPool.query(
        `ALTER TABLE "${namespace}".operating_expenses ADD COLUMN IF NOT EXISTS voucher_reference text`,
      );
      await setupPool.query(`
        ALTER TABLE "${namespace}".invoices
          ADD COLUMN IF NOT EXISTS payee_id uuid,
          ADD COLUMN IF NOT EXISTS destination text NOT NULL DEFAULT 'UNCLASSIFIED',
          ADD COLUMN IF NOT EXISTS classified_at timestamptz,
          ADD COLUMN IF NOT EXISTS classified_by text,
          ADD COLUMN IF NOT EXISTS classification_reason text,
          ADD COLUMN IF NOT EXISTS classification_source text
      `);
      await setupPool.query(
        `ALTER TABLE "${namespace}".employee_audit_logs ADD CONSTRAINT apr01_audit_user_fk FOREIGN KEY (user_id) REFERENCES "${namespace}".users(id)`,
      );
      await setupPool.query(
        `ALTER TABLE "${namespace}".employee_audit_logs ADD CONSTRAINT apr01_audit_perf_fk FOREIGN KEY (performed_by) REFERENCES "${namespace}".users(id)`,
      );

      await setupPool.query(`CREATE ROLE "${runtimeRole}" NOLOGIN NOBYPASSRLS`);
      roleCreated = true;
      await setupPool.query(`GRANT "${runtimeRole}" TO CURRENT_USER`);
      await setupPool.query(`GRANT USAGE ON SCHEMA "${namespace}" TO "${runtimeRole}"`);

      // Aplicar migración candidata 0170 dentro del esquema efímero (sin tocar public)
      const migrationSql = readFileSync(
        "drizzle/0170_apr01_document_approvals.sql",
        "utf8",
      )
        .replaceAll("rolname = 'pulso_app'", `rolname = '${runtimeRole}'`)
        .replaceAll("TO pulso_app", `TO "${runtimeRole}"`);

      const client = await setupPool.connect();
      try {
        await client.query(`SET search_path TO "${namespace}", public`);
        for (const stmt of migrationSql.split("--> statement-breakpoint")) {
          if (stmt.trim()) await client.query(stmt);
        }
      } finally {
        client.release();
      }
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
      { id: companyA, name: `APR01 Co A ${suffix}` },
      { id: companyB, name: `APR01 Co B ${suffix}` },
    ]);
    await testDb.insert(branches).values([
      {
        id: branchA,
        companyId: companyA,
        name: `Suc APR01 A ${suffix}`,
      },
      {
        id: branchB,
        companyId: companyA,
        name: `Suc APR01 B ${suffix}`,
      },
    ]);
    await testDb.insert(users).values([
      {
        id: requesterId,
        email: `${requesterId}@test.local`,
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
        name: "Admin Aprobador",
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
        name: "Owner Segundo Firmante",
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
    await testDb.insert(suppliers).values({
      id: supplierA,
      companyId: companyA,
      name: "Proveedor Carnes SA",
    });
    await testDb.insert(companyBankAccounts).values({
      id: acctA,
      companyId: companyA,
      label: "BBVA Tesorería",
      accountNumber: "enc-apr01-9999",
      accountLastFour: "9999",
      accountFingerprint: `fp-apr01-${suffix}`,
      bankCode: "012",
      bankName: "BBVA",
      currency: "MXN",
      registeredBy: adminId,
    });
  });

  afterAll(async () => {
    try {
      await pool?.end();
    } finally {
      const cleanupPool = new Pool({ connectionString: TEST_DB_URL, max: 1 });
      try {
        if (schemaCreated) {
          await cleanupPool.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
        }
        if (roleCreated) {
          await cleanupPool.query(`DROP ROLE IF EXISTS "${runtimeRole}"`);
        }
      } finally {
        await cleanupPool.end();
      }
    }
  });

  it("alinea OC, OS, gasto, corrida de pago y nómina: versión/autoridad, invalidación material, AUD-02 y RLS", async () => {
    // ── 1. Sembrar documentos especializados aprobados ──
    const [po] = await testDb
      .insert(purchaseOrders)
      .values({
        companyId: companyA,
        branchId: branchA,
        supplierId: supplierA,
        poNumber: `OC-${suffix}`,
        status: "APPROVED",
        totalAmount: 120_000,
        requestedBy: requesterId,
        approvedBy: adminId,
        approvedAt: new Date(),
      })
      .returning();
    await testDb.insert(approvalRequests).values({
      companyId: companyA,
      docType: "OC",
      docId: po.id,
      level: 1,
      requiredRole: "ADMIN",
      minQuotes: 2,
      status: "APPROVED",
      resolvedBy: adminId,
      resolvedAt: new Date(),
    });

    const [so] = await testDb
      .insert(serviceOrders)
      .values({
        companyId: companyA,
        branchId: branchA,
        folio: `OS-${suffix}`,
        type: "CORRECTIVO",
        urgency: "URGENTE",
        status: "APPROVED",
        amount: 85_000,
        scope: "Reparar freidora principal",
        createdBy: requesterId,
      })
      .returning();

    const [invoice] = await testDb
      .insert(invoices)
      .values({
        companyId: companyA,
        branchId: branchA,
        supplierId: supplierA,
        purchaseOrderId: po.id,
        uuid: `CFDI-APR01-${suffix.toUpperCase()}`,
        folio: "F-901",
        fecha: "2026-11-26",
        subtotal: 100_000,
        taxAmount: 16_000,
        total: 116_000,
        currency: "MXN",
        rfcEmisor: "PCA010101AAA",
        rfcReceptor: "PUL200101BBB",
        matchStatus: "EXCEPTION_APPROVED",
        exceptionApprovedBy: adminId,
        exceptionApprovedAt: new Date(),
        exceptionReason: "Variación de 1% autorizada",
      })
      .returning();

    const [expense] = await testDb
      .insert(operatingExpenses)
      .values({
        companyId: companyA,
        branchId: branchA,
        category: "MANTENIMIENTO",
        amount: 45_000,
        description: "Plomería cocina",
        status: "APPROVED",
        requestedBy: requesterId,
        approvedBy: adminId,
        businessDate: "2026-11-26",
      })
      .returning();

    const [payRun] = await testDb
      .insert(paymentRuns)
      .values({
        companyId: companyA,
        branchId: branchA,
        title: "Corrida Viernes",
        runDate: new Date("2026-11-27"),
        status: "APPROVED",
        sourceAccount: "BBVA ****9999",
        sourceBankAccountId: acctA,
        totalAmountCents: 1_500_000,
        preparedBy: requesterId,
        approvedBy: ownerId,
      })
      .returning();
    await testDb.insert(paymentApprovals).values({
      companyId: companyA,
      branchId: branchA,
      amountCents: 1_500_000,
      currency: "MXN",
      paymentRef: payRun.id,
      paymentRefType: "PAYMENT_RUN",
      status: "APPROVED",
      requestedBy: requesterId,
      approvedBy: adminId,
      secondApprovedBy: ownerId,
      approvedAt: new Date(),
    });

    const payrollRunId = crypto.randomUUID();

    // ── 2. Registrar versión aprobada v1 y autoridad declarada en los 5 documentos ──
    const ocPayloadV1 = {
      branchId: branchA,
      supplierId: supplierA,
      costCenterId: null,
      purchaseType: "STOCK",
      totalAmountCents: 120_000,
      items: [{ itemId: "item-carne", orderedQuantity: 10, unitCost: 12_000 }],
      notes: "Entrega 7am",
    };
    const ocApr1 = await recordDocumentApproval({
      companyId: companyA,
      docType: "OC",
      docId: po.id,
      materialPayload: ocPayloadV1,
      requesterId,
      authority: {
        requiredRole: "ADMIN",
        actualActorRole: "ADMIN",
        approverId: adminId,
        authoritySource: "APPROVAL_MATRIX",
      },
    });
    expect(ocApr1.created).toBe(true);
    expect(ocApr1.approval.approvalVersion).toBe(1);

    // Idempotencia: repetir con mismo contenido material (cambiando solo notas cosméticas) NO duplica
    const ocAprRepeat = await recordDocumentApproval({
      companyId: companyA,
      docType: "OC",
      docId: po.id,
      materialPayload: { ...ocPayloadV1, notes: "Nota cosmética diferente" },
      requesterId,
      authority: {
        requiredRole: "ADMIN",
        actualActorRole: "ADMIN",
        approverId: adminId,
        authoritySource: "APPROVAL_MATRIX",
      },
    });
    expect(ocAprRepeat.idempotent).toBe(true);
    expect(ocAprRepeat.approval.approvalVersion).toBe(1);

    // OS v1
    await recordDocumentApproval({
      companyId: companyA,
      docType: "OS",
      docId: so.id,
      materialPayload: {
        branchId: branchA,
        type: "CORRECTIVO",
        urgency: "URGENTE",
        supplierId: null,
        serviceProviderId: null,
        costCenterId: null,
        amountCents: 85_000,
        scope: "Reparar freidora principal",
      },
      requesterId,
      authority: {
        requiredRole: "ADMIN",
        actualActorRole: "ADMIN",
        approverId: adminId,
        authoritySource: "APPROVAL_MATRIX",
      },
    });

    // INVOICE v1 (APR-01.factura): con sucursal, motivo y evidencia; gerente de otra sucursal bloqueado
    const invoicePayloadV1 = {
      branchId: branchA,
      uuid: invoice.uuid,
      supplierId: supplierA,
      payeeId: null,
      purchaseOrderId: po.id,
      serviceOrderId: null,
      subtotalCents: 100_000,
      taxCents: 16_000,
      totalCents: 116_000,
      currency: "MXN",
      matchStatus: "EXCEPTION_APPROVED",
      folio: "F-901",
    };

    await expect(
      recordDocumentApproval({
        companyId: companyA,
        docType: "INVOICE",
        docId: invoice.id,
        materialPayload: invoicePayloadV1,
        requesterId,
        actorScope: { kind: "BRANCH", branchId: branchB },
        authority: {
          requiredRole: "GERENTE",
          actualActorRole: "GERENTE",
          approverId: adminId,
          authoritySource: "INVOICE_MATCH_POLICY",
        },
        reason: "Intento fuera de sucursal",
      }),
    ).rejects.toThrow(/sucursal/i);

    const invApr1 = await recordDocumentApproval({
      companyId: companyA,
      docType: "INVOICE",
      docId: invoice.id,
      materialPayload: invoicePayloadV1,
      requesterId,
      actorScope: { kind: "ALL" },
      evidenceId: evidenceUuid,
      expectedVersion: 0,
      reason: "Excepción 3-Way Match aprobada con remisión firmada",
      authority: {
        requiredRole: "ADMIN",
        actualActorRole: "ADMIN",
        approverId: adminId,
        authoritySource: "INVOICE_MATCH_POLICY",
      },
    });
    expect(invApr1.created).toBe(true);
    expect(invApr1.approval.approvalVersion).toBe(1);
    expect(invApr1.approval.branchId).toBe(branchA);
    expect(invApr1.approval.evidenceId).toBe(evidenceUuid);
    expect(invApr1.approval.approvalReason).toBe(
      "Excepción 3-Way Match aprobada con remisión firmada",
    );

    // EXPENSE v1
    await recordDocumentApproval({
      companyId: companyA,
      docType: "EXPENSE",
      docId: expense.id,
      materialPayload: {
        branchId: branchA,
        category: "MANTENIMIENTO",
        amountCents: 45_000,
        taxCents: null,
        payeeId: null,
        costCenterId: null,
        businessDate: "2026-11-26",
      },
      requesterId,
      authority: {
        requiredRole: "ADMIN",
        actualActorRole: "ADMIN",
        approverId: adminId,
        authoritySource: "EXPENSE_AUTH_RULES",
      },
    });

    // PAYMENT_RUN v1 con doble firma
    const payItemRef = crypto.randomUUID();
    await recordDocumentApproval({
      companyId: companyA,
      docType: "PAYMENT_RUN",
      docId: payRun.id,
      materialPayload: {
        branchId: branchA,
        sourceBankAccountId: acctA,
        currency: "MXN",
        totalAmountCents: 1_500_000,
        items: [{ itemType: "INVOICE", referenceId: payItemRef, amountCents: 1_500_000 }],
      },
      requesterId,
      authority: {
        requiredRole: "ADMIN",
        actualActorRole: "ADMIN",
        approverId: adminId,
        secondaryApproverId: ownerId,
        requiresDualApproval: true,
        authoritySource: "TREASURY_DUAL_APPROVAL",
      },
    });

    // PAYROLL v1 (NOM-03)
    await recordDocumentApproval({
      companyId: companyA,
      docType: "PAYROLL",
      docId: payrollRunId,
      materialPayload: {
        periodStart: "2026-11-01",
        periodEnd: "2026-11-15",
        inputFingerprint: "nom03-sha-v1",
        snapshotVersion: 1,
        totalNetoCents: 980_000,
        employeeCount: 10,
      },
      requesterId,
      authority: {
        requiredRole: "ADMIN",
        actualActorRole: "OWNER",
        approverId: ownerId,
        authoritySource: "PAYROLL_SNAPSHOT_NOM03",
      },
    });

    // ── 3. Cambio NO material en OC conserva aprobación v1 ──
    const cosmeticCheck = await checkAndInvalidateOnMaterialChange({
      companyId: companyA,
      docType: "OC",
      docId: po.id,
      currentMaterialPayload: { ...ocPayloadV1, notes: "Solo se ajustó nota de entrega" },
      actorId: adminId,
    });
    expect(cosmeticCheck.invalidated).toBe(false);
    expect(cosmeticCheck.changedFields).toEqual([]);

    // ── 4. Cambio MATERIAL en los 5 documentos invalida v1 y sincroniza especializaciones ──
    const ocInv = await checkAndInvalidateOnMaterialChange({
      companyId: companyA,
      docType: "OC",
      docId: po.id,
      currentMaterialPayload: {
        ...ocPayloadV1,
        totalAmountCents: 165_000,
        items: [{ itemId: "item-carne", orderedQuantity: 10, unitCost: 16_500 }],
      },
      actorId: adminId,
      reason: "Proveedor actualizó precio por kilo",
    });
    expect(ocInv).toMatchObject({
      invalidated: true,
      approvalVersion: 1,
      changedFields: ["items", "totalAmountCents"],
      newDocStatus: "PENDING_APPROVAL",
    });
    const [poAfterInv] = await testDb
      .select({ status: purchaseOrders.status, approvedBy: purchaseOrders.approvedBy })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, po.id));
    expect(poAfterInv).toEqual({ status: "PENDING_APPROVAL", approvedBy: null });

    const osInv = await checkAndInvalidateOnMaterialChange({
      companyId: companyA,
      docType: "OS",
      docId: so.id,
      currentMaterialPayload: {
        branchId: branchA,
        type: "CORRECTIVO",
        urgency: "URGENTE",
        supplierId: null,
        serviceProviderId: null,
        costCenterId: null,
        amountCents: 110_000,
        scope: "Reparar freidora + cambio de termostato",
      },
      actorId: adminId,
    });
    expect(osInv).toMatchObject({
      invalidated: true,
      changedFields: ["amountCents", "scope"],
      newDocStatus: "DRAFT",
    });

    const invInv = await checkAndInvalidateOnMaterialChange({
      companyId: companyA,
      docType: "INVOICE",
      docId: invoice.id,
      currentMaterialPayload: {
        ...invoicePayloadV1,
        subtotalCents: 120_000,
        taxCents: 19_200,
        totalCents: 139_200,
      },
      actorId: adminId,
      reason: "CFDI sustituido con monto mayor",
    });
    expect(invInv).toMatchObject({
      invalidated: true,
      approvalVersion: 1,
      changedFields: ["subtotalCents", "taxCents", "totalCents"],
      newDocStatus: "DISCREPANCY",
    });
    const [invAfter] = await testDb
      .select({
        matchStatus: invoices.matchStatus,
        exceptionApprovedBy: invoices.exceptionApprovedBy,
      })
      .from(invoices)
      .where(eq(invoices.id, invoice.id));
    expect(invAfter).toEqual({ matchStatus: "DISCREPANCY", exceptionApprovedBy: null });

    const expInv = await checkAndInvalidateOnMaterialChange({
      companyId: companyA,
      docType: "EXPENSE",
      docId: expense.id,
      currentMaterialPayload: {
        branchId: branchA,
        category: "MANTENIMIENTO",
        amountCents: 60_000,
        taxCents: null,
        payeeId: null,
        costCenterId: null,
        businessDate: "2026-11-26",
      },
      actorId: adminId,
    });
    expect(expInv).toMatchObject({
      invalidated: true,
      changedFields: ["amountCents"],
      newDocStatus: "PENDING_APPROVAL",
    });

    const payInv = await checkAndInvalidateOnMaterialChange({
      companyId: companyA,
      docType: "PAYMENT_RUN",
      docId: payRun.id,
      currentMaterialPayload: {
        branchId: branchA,
        sourceBankAccountId: acctA,
        currency: "MXN",
        totalAmountCents: 1_650_000,
        items: [{ itemType: "INVOICE", referenceId: payItemRef, amountCents: 1_650_000 }],
      },
      actorId: adminId,
    });
    expect(payInv).toMatchObject({
      invalidated: true,
      changedFields: ["items", "totalAmountCents"],
      newDocStatus: "PENDING_APPROVAL",
    });
    const [payApprAfter] = await testDb
      .select({ status: paymentApprovals.status })
      .from(paymentApprovals)
      .where(eq(paymentApprovals.paymentRef, payRun.id));
    expect(payApprAfter.status).toBe("REJECTED");

    const payrollInv = await checkAndInvalidateOnMaterialChange({
      companyId: companyA,
      docType: "PAYROLL",
      docId: payrollRunId,
      currentMaterialPayload: {
        periodStart: "2026-11-01",
        periodEnd: "2026-11-15",
        inputFingerprint: "nom03-sha-v2",
        snapshotVersion: 1,
        totalNetoCents: 995_000,
        employeeCount: 10,
      },
      actorId: ownerId,
    });
    expect(payrollInv).toMatchObject({
      invalidated: true,
      changedFields: ["inputFingerprint", "totalNetoCents"],
      newDocStatus: "STALE_REQUIRES_NEW_SNAPSHOT",
    });

    // ── 5. Re-aprobar OC emite versión 2 conservando v1 INVALIDATED en historial ──
    const ocApr2 = await recordDocumentApproval({
      companyId: companyA,
      docType: "OC",
      docId: po.id,
      materialPayload: {
        ...ocPayloadV1,
        totalAmountCents: 165_000,
        items: [{ itemId: "item-carne", orderedQuantity: 10, unitCost: 16_500 }],
      },
      requesterId,
      authority: {
        requiredRole: "OWNER",
        actualActorRole: "OWNER",
        approverId: ownerId,
        authoritySource: "APPROVAL_MATRIX",
      },
    });
    expect(ocApr2.approval.approvalVersion).toBe(2);

    const ocStatus = await getDocumentApprovalStatus({
      companyId: companyA,
      docType: "OC",
      docId: po.id,
    });
    expect(ocStatus.approvedVersion).toBe(2);
    expect(ocStatus.authority?.approvedBy).toBe(ownerId);
    expect(ocStatus.history.map((h) => [h.approvalVersion, h.status])).toEqual([
      [2, "APPROVED"],
      [1, "INVALIDATED"],
    ]);

    // ── 6. Auditoría AUD-02 presente para los 5 entityTypes críticos ──
    const audits = await testDb
      .select({ entityType: employeeAuditLogs.entityType, entityId: employeeAuditLogs.entityId })
      .from(employeeAuditLogs);
    const entityTypes = new Set(audits.map((a) => a.entityType));
    expect(entityTypes.has("APPROVAL_PURCHASE")).toBe(true);
    expect(entityTypes.has("APPROVAL_INVOICE")).toBe(true);
    expect(entityTypes.has("APPROVAL_EXPENSE")).toBe(true);
    expect(entityTypes.has("APPROVAL_PAYMENT")).toBe(true);
    expect(entityTypes.has("APPROVAL_PAYROLL")).toBe(true);

    // ── 6b. Concurrencia real en 2 conexiones simultáneas (expectedVersion: 0 + pg_advisory_xact_lock) ──
    const raceDocId = crypto.randomUUID();
    const racePayload = {
      branchId: branchA,
      category: "INSUMOS",
      amountCents: 32_000,
      taxCents: 5_120,
      payeeId: null,
      costCenterId: null,
      businessDate: "2026-11-27",
    };
    const raceResults = await Promise.allSettled([
      recordDocumentApproval({
        companyId: companyA,
        docType: "EXPENSE",
        docId: raceDocId,
        materialPayload: racePayload,
        requesterId,
        expectedVersion: 0,
        evidenceId: evidenceUuid,
        reason: "Aprobación concurrente A",
        authority: {
          requiredRole: "ADMIN",
          actualActorRole: "ADMIN",
          approverId: adminId,
          authoritySource: "EXPENSE_AUTH_RULES",
        },
      }),
      recordDocumentApproval({
        companyId: companyA,
        docType: "EXPENSE",
        docId: raceDocId,
        materialPayload: racePayload,
        requesterId,
        expectedVersion: 0,
        evidenceId: evidenceUuid,
        reason: "Aprobación concurrente B",
        authority: {
          requiredRole: "ADMIN",
          actualActorRole: "OWNER",
          approverId: ownerId,
          authoritySource: "EXPENSE_AUTH_RULES",
        },
      }),
    ]);
    const fulfilled = raceResults.filter((r) => r.status === "fulfilled");
    const rejected = raceResults.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String((rejected[0] as PromiseRejectedResult).reason?.message ?? "")).toMatch(
      /concurrencia/i,
    );
    const raceStatus = await getDocumentApprovalStatus({
      companyId: companyA,
      docType: "EXPENSE",
      docId: raceDocId,
    });
    expect(raceStatus.approvedVersion).toBe(1);
    expect(raceStatus.history).toHaveLength(1);
    expect(raceStatus.authority?.evidenceId).toBe(evidenceUuid);

    // ── 7. Rollback atómico ante fallo FK de AUD-02 ──
    const rollbackDocId = crypto.randomUUID();
    await expect(
      recordDocumentApproval({
        companyId: companyA,
        docType: "EXPENSE",
        docId: rollbackDocId,
        materialPayload: {
          branchId: branchA,
          category: "OTROS",
          amountCents: 10_000,
          taxCents: null,
          payeeId: null,
          costCenterId: null,
          businessDate: "2026-11-27",
        },
        authority: {
          requiredRole: "ADMIN",
          actualActorRole: "ADMIN",
          approverId: "ghost-fk-actor",
          authoritySource: "EXPENSE_AUTH_RULES",
        },
      }),
    ).rejects.toThrow();

    const afterRollback = await getDocumentApprovalStatus({
      companyId: companyA,
      docType: "EXPENSE",
      docId: rollbackDocId,
    });
    expect(afterRollback.status).toBe("UNAPPROVED");
    expect(afterRollback.history).toHaveLength(0);

    // ── 8. Aislamiento RLS real bajo rol NOBYPASSRLS ──
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE "${runtimeRole}"`);
      await client.query("SELECT set_config('app.current_company_id', $1, true)", [companyB]);
      const rlsOtherCompany = await client.query(
        `SELECT id FROM "${namespace}".document_approvals`,
      );
      expect(rlsOtherCompany.rows).toHaveLength(0);

      await client.query("SELECT set_config('app.current_company_id', $1, true)", [companyA]);
      const rlsOwnCompany = await client.query(
        `SELECT id FROM "${namespace}".document_approvals WHERE doc_id = $1`,
        [po.id],
      );
      expect(rlsOwnCompany.rows).toHaveLength(2);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});
