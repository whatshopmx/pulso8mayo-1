import { describe, expect, it } from "vitest";
import {
  auditEntityTypeForDocument,
  computeDocumentMaterialFingerprint,
  detectMaterialChange,
  validateDeclaredAuthority,
} from "../document-approval-rules";

describe("APR-01 V1 — Reglas puras de versión aprobada, autoridad e invalidación material", () => {
  it("calcula huella material estable para OC/OS/gasto/pago/nómina e ignora campos cosméticos", () => {
    // 1. OC: orden de partidas y notas no cambian huella; cambiar cantidad/precio sí
    const oc1 = computeDocumentMaterialFingerprint("OC", {
      branchId: "b1",
      supplierId: "s1",
      costCenterId: "cc1",
      purchaseType: "STOCK",
      totalAmountCents: 150_000,
      items: [
        { itemId: "item-b", orderedQuantity: 2, unitCost: 25_000 },
        { itemId: "item-a", orderedQuantity: 5, unitCost: 20_000 },
      ],
      notes: "Entregar en puerta trasera",
    });
    const ocReorderedNotes = computeDocumentMaterialFingerprint("OC", {
      branchId: "b1",
      supplierId: "s1",
      costCenterId: "cc1",
      purchaseType: "STOCK",
      totalAmountCents: 150_000,
      items: [
        { itemId: "item-a", orderedQuantity: 5, unitCost: 20_000 },
        { itemId: "item-b", orderedQuantity: 2, unitCost: 25_000 },
      ],
      notes: "Nota actualizada cosmética",
    });
    expect(oc1.fingerprint).toBe(ocReorderedNotes.fingerprint);
    expect(detectMaterialChange("OC", oc1.snapshot, ocReorderedNotes.snapshot)).toMatchObject({
      isMaterialChange: false,
      changedFields: [],
    });

    // Simular reordenamiento de llaves de PostgreSQL jsonb (incluso dentro de items[])
    const postgresJsonbReordered = {
      items: [
        { unitCost: 20_000, itemId: "item-a", orderedQuantity: 5 },
        { unitCost: 25_000, itemId: "item-b", orderedQuantity: 2 },
      ],
      branchId: "b1",
      supplierId: "s1",
      costCenterId: "cc1",
      purchaseType: "STOCK",
      totalAmountCents: 150_000,
    };
    expect(detectMaterialChange("OC", postgresJsonbReordered, oc1.snapshot)).toMatchObject({
      isMaterialChange: false,
      changedFields: [],
    });

    const ocMaterialEdit = computeDocumentMaterialFingerprint("OC", {
      branchId: "b1",
      supplierId: "s2",
      costCenterId: "cc1",
      purchaseType: "STOCK",
      totalAmountCents: 180_000,
      items: [
        { itemId: "item-a", orderedQuantity: 5, unitCost: 20_000 },
        { itemId: "item-b", orderedQuantity: 2, unitCost: 40_000 },
      ],
    });
    expect(detectMaterialChange("OC", oc1.snapshot, ocMaterialEdit.snapshot)).toMatchObject({
      isMaterialChange: true,
      changedFields: ["items", "supplierId", "totalAmountCents"],
    });

    // 2. OS: cambiar reporte técnico no invalida; cambiar monto sí
    const os1 = computeDocumentMaterialFingerprint("OS", {
      branchId: "b1",
      type: "CORRECTIVO",
      urgency: "URGENTE",
      supplierId: null,
      serviceProviderId: "sp1",
      costCenterId: "cc1",
      amountCents: 90_000,
      scope: "Reparar compresor",
      technicalReport: "v1",
    });
    const osCosmetic = computeDocumentMaterialFingerprint("OS", {
      branchId: "b1",
      type: "CORRECTIVO",
      urgency: "URGENTE",
      supplierId: null,
      serviceProviderId: "sp1",
      costCenterId: "cc1",
      amountCents: 90_000,
      scope: "Reparar compresor",
      technicalReport: "v2 ampliado",
    });
    expect(os1.fingerprint).toBe(osCosmetic.fingerprint);

    const osMaterial = computeDocumentMaterialFingerprint("OS", {
      branchId: "b1",
      type: "CORRECTIVO",
      urgency: "URGENTE",
      supplierId: null,
      serviceProviderId: "sp1",
      costCenterId: "cc1",
      amountCents: 115_000,
      scope: "Reparar compresor",
    });
    expect(detectMaterialChange("OS", os1.snapshot, osMaterial.snapshot).changedFields).toEqual([
      "amountCents",
    ]);

    // 3. EXPENSE: cambiar dueDate/notes no invalida; cambiar amountCents o costCenterId sí
    const exp1 = computeDocumentMaterialFingerprint("EXPENSE", {
      branchId: "b1",
      category: "SERVICIOS",
      amountCents: 45_000,
      taxCents: 7_200,
      payeeId: "p1",
      costCenterId: "cc1",
      businessDate: "2026-11-20",
      dueDate: "2026-11-30",
    });
    const expCosmetic = computeDocumentMaterialFingerprint("EXPENSE", {
      branchId: "b1",
      category: "SERVICIOS",
      amountCents: 45_000,
      taxCents: 7_200,
      payeeId: "p1",
      costCenterId: "cc1",
      businessDate: "2026-11-20",
      dueDate: "2026-12-05",
      approvalNotes: "Reprogramado",
    });
    expect(exp1.fingerprint).toBe(expCosmetic.fingerprint);

    // 4. PAYMENT_RUN: cambiar cuenta origen o items invalida
    const pay1 = computeDocumentMaterialFingerprint("PAYMENT_RUN", {
      branchId: "b1",
      sourceBankAccountId: "acct-1",
      currency: "MXN",
      totalAmountCents: 500_000,
      items: [{ itemType: "INVOICE", referenceId: "inv-1", amountCents: 500_000, bankAccountId: "sup-acct-1" }],
      title: "Corrida lunes",
    });
    const payMaterial = computeDocumentMaterialFingerprint("PAYMENT_RUN", {
      branchId: "b1",
      sourceBankAccountId: "acct-2",
      currency: "MXN",
      totalAmountCents: 500_000,
      items: [{ itemType: "INVOICE", referenceId: "inv-1", amountCents: 500_000, bankAccountId: "sup-acct-1" }],
      title: "Corrida lunes",
    });
    expect(detectMaterialChange("PAYMENT_RUN", pay1.snapshot, payMaterial.snapshot).changedFields).toEqual([
      "sourceBankAccountId",
    ]);

    // 5. INVOICE (APR-01.factura): folio/serie/exceptionReason son cosméticos; total/matchStatus/uuid son materiales
    const inv1 = computeDocumentMaterialFingerprint("INVOICE", {
      branchId: "b1",
      uuid: "abc-123-cfdi",
      supplierId: "s1",
      payeeId: null,
      purchaseOrderId: "po-1",
      serviceOrderId: null,
      subtotalCents: 100_000,
      taxCents: 16_000,
      totalCents: 116_000,
      currency: "MXN",
      matchStatus: "EXCEPTION_APPROVED",
      folio: "F-100",
      exceptionReason: "Diferencia menor de centavos",
    });
    const invCosmetic = computeDocumentMaterialFingerprint("INVOICE", {
      branchId: "b1",
      uuid: "ABC-123-CFDI",
      supplierId: "s1",
      payeeId: null,
      purchaseOrderId: "po-1",
      serviceOrderId: null,
      subtotalCents: 100_000,
      taxCents: 16_000,
      totalCents: 116_000,
      currency: "MXN",
      matchStatus: "EXCEPTION_APPROVED",
      folio: "F-100-REV",
      serie: "A",
      exceptionReason: "Nota actualizada",
    });
    expect(inv1.fingerprint).toBe(invCosmetic.fingerprint);
    expect(detectMaterialChange("INVOICE", inv1.snapshot, invCosmetic.snapshot)).toMatchObject({
      isMaterialChange: false,
      changedFields: [],
    });

    const invMaterial = computeDocumentMaterialFingerprint("INVOICE", {
      branchId: "b1",
      uuid: "ABC-123-CFDI",
      supplierId: "s1",
      payeeId: null,
      purchaseOrderId: "po-1",
      serviceOrderId: null,
      subtotalCents: 120_000,
      taxCents: 19_200,
      totalCents: 139_200,
      currency: "MXN",
      matchStatus: "EXCEPTION_APPROVED",
    });
    expect(detectMaterialChange("INVOICE", inv1.snapshot, invMaterial.snapshot).changedFields).toEqual([
      "subtotalCents",
      "taxCents",
      "totalCents",
    ]);

    // 6. PAYROLL: cambiar inputFingerprint NOM-03 invalida
    const nom1 = computeDocumentMaterialFingerprint("PAYROLL", {
      periodStart: "2026-11-01",
      periodEnd: "2026-11-15",
      inputFingerprint: "sha-v1",
      snapshotVersion: 1,
      totalNetoCents: 1_250_000,
      employeeCount: 12,
    });
    const nomChanged = computeDocumentMaterialFingerprint("PAYROLL", {
      periodStart: "2026-11-01",
      periodEnd: "2026-11-15",
      inputFingerprint: "sha-v2",
      snapshotVersion: 1,
      totalNetoCents: 1_260_000,
      employeeCount: 12,
    });
    expect(detectMaterialChange("PAYROLL", nom1.snapshot, nomChanged.snapshot).changedFields).toEqual([
      "inputFingerprint",
      "totalNetoCents",
    ]);
  });

  it("valida autoridad declarada, segregación y doble firma respetando especializaciones", () => {
    // Rol insuficiente
    expect(
      validateDeclaredAuthority({
        docType: "OC",
        requesterId: "u-req",
        authority: {
          requiredRole: "ADMIN",
          actualActorRole: "GERENTE",
          approverId: "u-ger",
          authoritySource: "APPROVAL_MATRIX",
        },
      }),
    ).toMatchObject({ ok: false, code: "ROLE" });

    // Auto-aprobación prohibida en OC aunque sea OWNER
    expect(
      validateDeclaredAuthority({
        docType: "OC",
        requesterId: "u-own",
        authority: {
          requiredRole: "OWNER",
          actualActorRole: "OWNER",
          approverId: "u-own",
          authoritySource: "APPROVAL_MATRIX",
        },
      }),
    ).toMatchObject({ ok: false, code: "SELF" });

    // Especialización conservada: OWNER sí puede aprobar su propio EXPENSE (approval-policy.ts)
    expect(
      validateDeclaredAuthority({
        docType: "EXPENSE",
        requesterId: "u-own",
        authority: {
          requiredRole: "OWNER",
          actualActorRole: "OWNER",
          approverId: "u-own",
          authoritySource: "EXPENSE_AUTH_RULES",
        },
      }),
    ).toEqual({ ok: true });

    // Doble firma en PAYMENT_RUN exige segundo firmante distinto
    expect(
      validateDeclaredAuthority({
        docType: "PAYMENT_RUN",
        requesterId: "u-prep",
        authority: {
          requiredRole: "ADMIN",
          actualActorRole: "ADMIN",
          approverId: "u-adm1",
          secondaryApproverId: "u-adm1",
          requiresDualApproval: true,
          authoritySource: "TREASURY_DUAL_APPROVAL",
        },
      }),
    ).toMatchObject({ ok: false, code: "DUAL_APPROVAL" });

    expect(
      validateDeclaredAuthority({
        docType: "PAYMENT_RUN",
        requesterId: "u-prep",
        authority: {
          requiredRole: "ADMIN",
          actualActorRole: "ADMIN",
          approverId: "u-adm1",
          secondaryApproverId: "u-own",
          requiresDualApproval: true,
          authoritySource: "TREASURY_DUAL_APPROVAL",
        },
      }),
    ).toEqual({ ok: true });

    // Alcance de sucursal: GERENTE de b1 no puede aprobar documento de b2 ni nómina corporativa (null)
    expect(
      validateDeclaredAuthority({
        docType: "INVOICE",
        requesterId: "u-req",
        actorScope: { kind: "BRANCH", branchId: "b1" },
        docBranchId: "b2",
        authority: {
          requiredRole: "GERENTE",
          actualActorRole: "GERENTE",
          approverId: "u-ger1",
          authoritySource: "INVOICE_MATCH_POLICY",
        },
      }),
    ).toMatchObject({ ok: false, code: "BRANCH_SCOPE" });

    expect(
      validateDeclaredAuthority({
        docType: "PAYROLL",
        requesterId: "u-req",
        actorScope: { kind: "BRANCH", branchId: "b1" },
        docBranchId: null,
        authority: {
          requiredRole: "GERENTE",
          actualActorRole: "GERENTE",
          approverId: "u-ger1",
          authoritySource: "PAYROLL_SNAPSHOT_NOM03",
        },
      }),
    ).toMatchObject({ ok: false, code: "BRANCH_SCOPE" });

    expect(
      validateDeclaredAuthority({
        docType: "OC",
        requesterId: "u-req",
        actorScope: { kind: "NONE" },
        docBranchId: "b1",
        authority: {
          requiredRole: "GERENTE",
          actualActorRole: "GERENTE",
          approverId: "u-ger-no-branch",
          authoritySource: "APPROVAL_MATRIX",
        },
      }),
    ).toMatchObject({ ok: false, code: "BRANCH_SCOPE" });

    expect(
      validateDeclaredAuthority({
        docType: "INVOICE",
        requesterId: "u-req",
        actorScope: { kind: "BRANCH", branchId: "b1" },
        docBranchId: "b1",
        requireReason: true,
        reason: "ok",
        authority: {
          requiredRole: "GERENTE",
          actualActorRole: "GERENTE",
          approverId: "u-ger1",
          authoritySource: "INVOICE_MATCH_POLICY",
        },
      }),
    ).toMatchObject({ ok: false, code: "REASON" });

    expect(
      validateDeclaredAuthority({
        docType: "INVOICE",
        requesterId: "u-req",
        actorScope: { kind: "BRANCH", branchId: "b1" },
        docBranchId: "b1",
        requireReason: true,
        reason: "Validado contra remisión firmada",
        authority: {
          requiredRole: "GERENTE",
          actualActorRole: "GERENTE",
          approverId: "u-ger1",
          authoritySource: "INVOICE_MATCH_POLICY",
        },
      }),
    ).toEqual({ ok: true });

    expect(auditEntityTypeForDocument("OC")).toBe("APPROVAL_PURCHASE");
    expect(auditEntityTypeForDocument("OS")).toBe("APPROVAL_PURCHASE");
    expect(auditEntityTypeForDocument("INVOICE")).toBe("APPROVAL_INVOICE");
    expect(auditEntityTypeForDocument("EXPENSE")).toBe("APPROVAL_EXPENSE");
    expect(auditEntityTypeForDocument("PAYMENT_RUN")).toBe("APPROVAL_PAYMENT");
    expect(auditEntityTypeForDocument("PAYROLL")).toBe("APPROVAL_PAYROLL");
  });
});
