import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/error";

const {
  mockRequirePermissionApi,
  mockGetDocumentApprovalStatus,
  mockRecordDocumentApproval,
  mockCheckAndInvalidateOnMaterialChange,
} = vi.hoisted(() => ({
  mockRequirePermissionApi: vi.fn(),
  mockGetDocumentApprovalStatus: vi.fn(),
  mockRecordDocumentApproval: vi.fn(),
  mockCheckAndInvalidateOnMaterialChange: vi.fn(),
}));

vi.mock("@/lib/rbac/abac", () => ({
  requirePermissionApi: mockRequirePermissionApi,
}));

vi.mock("@/lib/services/document-approval-service", () => ({
  getDocumentApprovalStatus: mockGetDocumentApprovalStatus,
  recordDocumentApproval: mockRecordDocumentApproval,
  checkAndInvalidateOnMaterialChange: mockCheckAndInvalidateOnMaterialChange,
}));

import {
  GET as getDocumentApproval,
  POST as postDocumentApproval,
} from "@/app/api/finance/approvals/documents/route";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const DOC_ID = "22222222-2222-4222-8222-222222222222";
const BRANCH_A = "33333333-3333-4333-8333-333333333333";
const BRANCH_B = "55555555-5555-4555-8555-555555555555";
const EVIDENCE_ID = "66666666-6666-4666-8666-666666666666";

describe("APR-01 V3 — Contrato HTTP de versión aprobada, autoridad e invalidación material", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /api/finance/approvals/documents exige RBAC (403), valida parámetros (400) y expone versión + autoridad", async () => {
    mockRequirePermissionApi.mockRejectedValueOnce(ApiError.forbidden("Sin permiso"));
    const denied = await getDocumentApproval(
      new NextRequest(
        `http://localhost:3000/api/finance/approvals/documents?docType=OC&docId=${DOC_ID}`,
      ),
    );
    expect(denied.status).toBe(403);

    mockRequirePermissionApi.mockResolvedValue({
      ctx: { userCompanyId: COMPANY_ID, userId: "admin-1", userRole: "ADMIN" },
    });

    const missing = await getDocumentApproval(
      new NextRequest("http://localhost:3000/api/finance/approvals/documents"),
    );
    expect(missing.status).toBe(400);

    mockGetDocumentApprovalStatus.mockResolvedValueOnce({
      docType: "PAYMENT_RUN",
      docId: DOC_ID,
      approvedVersion: 2,
      latestVersion: 2,
      status: "APPROVED",
      isCurrentValid: true,
      materialFingerprint: "sha-pay-v2",
      authority: {
        requiredRole: "ADMIN",
        authoritySource: "TREASURY_DUAL_APPROVAL",
        approvedBy: "admin-1",
        approvedByRole: "ADMIN",
        secondaryApprovedBy: "owner-1",
        approvedAt: "2026-11-27T12:00:00.000Z",
      },
      history: [],
    });

    const ok = await getDocumentApproval(
      new NextRequest(
        `http://localhost:3000/api/finance/approvals/documents?docType=PAYMENT_RUN&docId=${DOC_ID}`,
      ),
    );
    expect(ok.status).toBe(200);
    const json = await ok.json();
    expect(json.data).toMatchObject({
      docType: "PAYMENT_RUN",
      approvedVersion: 2,
      status: "APPROVED",
      authority: {
        requiredRole: "ADMIN",
        authoritySource: "TREASURY_DUAL_APPROVAL",
        secondaryApprovedBy: "owner-1",
      },
    });
  });

  it("POST RECORD_APPROVAL y EVALUATE_MATERIAL_CHANGE propagan 403/409 y devuelven invalidación con campos cambiados", async () => {
    mockRequirePermissionApi.mockResolvedValue({
      ctx: { userCompanyId: COMPANY_ID, userId: "admin-1", userRole: "ADMIN" },
    });

    // 1. Aprobación válida de OC
    mockRecordDocumentApproval.mockResolvedValueOnce({
      approval: {
        id: "apr-1",
        docType: "OC",
        docId: DOC_ID,
        approvalVersion: 1,
        status: "APPROVED",
        requiredRole: "ADMIN",
        authoritySource: "APPROVAL_MATRIX",
        approvedBy: "admin-1",
        approvedByRole: "ADMIN",
      },
      created: true,
      idempotent: false,
      previousVersionInvalidated: null,
    });
    const recRes = await postDocumentApproval(
      new NextRequest("http://localhost:3000/api/finance/approvals/documents", {
        method: "POST",
        body: JSON.stringify({
          action: "RECORD_APPROVAL",
          docType: "OC",
          docId: DOC_ID,
          requiredRole: "ADMIN",
          requesterId: "gerente-1",
          materialPayload: {
            branchId: "33333333-3333-4333-8333-333333333333",
            supplierId: "44444444-4444-4444-8444-444444444444",
            costCenterId: null,
            totalAmountCents: 150_000,
            items: [{ itemId: "item-1", orderedQuantity: 2, unitCost: 75_000 }],
          },
        }),
      }),
    );
    expect(recRes.status).toBe(200);
    const recJson = await recRes.json();
    expect(recJson.data.approval.approvalVersion).toBe(1);
    expect(mockRecordDocumentApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_ID,
        docType: "OC",
        authority: expect.objectContaining({
          requiredRole: "ADMIN",
          actualActorRole: "ADMIN",
          approverId: "admin-1",
          authoritySource: "APPROVAL_MATRIX",
        }),
      }),
    );

    // 2. Autoridad insuficiente / segregación -> 403
    mockRecordDocumentApproval.mockRejectedValueOnce(
      ApiError.forbidden("Autoridad insuficiente para PAYROLL"),
    );
    const forbiddenRes = await postDocumentApproval(
      new NextRequest("http://localhost:3000/api/finance/approvals/documents", {
        method: "POST",
        body: JSON.stringify({
          action: "RECORD_APPROVAL",
          docType: "PAYROLL",
          docId: DOC_ID,
          requiredRole: "OWNER",
          materialPayload: {
            periodStart: "2026-11-01",
            periodEnd: "2026-11-15",
            inputFingerprint: "sha-1",
            snapshotVersion: 1,
            totalNetoCents: 500_000,
            employeeCount: 5,
          },
        }),
      }),
    );
    expect(forbiddenRes.status).toBe(403);

    // 3. Cambio material invalida aprobación y devuelve campos cambiados + nuevo estado
    mockCheckAndInvalidateOnMaterialChange.mockResolvedValueOnce({
      hadApproval: true,
      invalidated: true,
      approvalVersion: 1,
      changedFields: ["totalAmountCents", "items"],
      approvedFingerprint: "sha-v1",
      currentFingerprint: "sha-v2",
      newDocStatus: "PENDING_APPROVAL",
    });
    const invRes = await postDocumentApproval(
      new NextRequest("http://localhost:3000/api/finance/approvals/documents", {
        method: "POST",
        body: JSON.stringify({
          action: "EVALUATE_MATERIAL_CHANGE",
          docType: "OC",
          docId: DOC_ID,
          reason: "Cambio de precio unitario tras cotización final",
          currentMaterialPayload: {
            branchId: "33333333-3333-4333-8333-333333333333",
            supplierId: "44444444-4444-4444-8444-444444444444",
            costCenterId: null,
            totalAmountCents: 190_000,
            items: [{ itemId: "item-1", orderedQuantity: 2, unitCost: 95_000 }],
          },
        }),
      }),
    );
    expect(invRes.status).toBe(200);
    const invJson = await invRes.json();
    expect(invJson.data).toMatchObject({
      invalidated: true,
      approvalVersion: 1,
      changedFields: ["totalAmountCents", "items"],
      newDocStatus: "PENDING_APPROVAL",
    });
  });

  it("cubre factura (INVOICE), alcance de sucursal, evidencia, motivo y conflicto de concurrencia (409)", async () => {
    // 1. GERENTE sin sucursal (NONE) recibe 403 fail-closed en GET
    mockRequirePermissionApi.mockResolvedValueOnce({
      ctx: { userCompanyId: COMPANY_ID, userId: "ger-none", userRole: "GERENTE", userBranchId: null },
    });
    const noneRes = await getDocumentApproval(
      new NextRequest(
        `http://localhost:3000/api/finance/approvals/documents?docType=INVOICE&docId=${DOC_ID}`,
      ),
    );
    expect(noneRes.status).toBe(403);

    // 2. GERENTE de sucursal A no puede leer aprobación de sucursal B -> 403
    mockRequirePermissionApi.mockResolvedValueOnce({
      ctx: { userCompanyId: COMPANY_ID, userId: "ger-a", userRole: "GERENTE", userBranchId: BRANCH_A },
    });
    mockGetDocumentApprovalStatus.mockResolvedValueOnce({
      docType: "INVOICE",
      docId: DOC_ID,
      branchId: BRANCH_B,
      approvedVersion: 1,
      status: "APPROVED",
    });
    const crossBranchGet = await getDocumentApproval(
      new NextRequest(
        `http://localhost:3000/api/finance/approvals/documents?docType=INVOICE&docId=${DOC_ID}`,
      ),
    );
    expect(crossBranchGet.status).toBe(403);

    // 3. POST INVOICE propaga actorScope de sesión, evidenceId, expectedVersion y reason
    mockRequirePermissionApi.mockResolvedValue({
      ctx: { userCompanyId: COMPANY_ID, userId: "ger-a", userRole: "GERENTE", userBranchId: BRANCH_A },
    });
    mockRecordDocumentApproval.mockResolvedValueOnce({
      approval: {
        id: "apr-inv-1",
        docType: "INVOICE",
        docId: DOC_ID,
        branchId: BRANCH_A,
        approvalVersion: 1,
        status: "APPROVED",
        requiredRole: "GERENTE",
        authoritySource: "INVOICE_MATCH_POLICY",
        approvedBy: "ger-a",
        approvedByRole: "GERENTE",
        evidenceId: EVIDENCE_ID,
        approvalReason: "Discrepancia menor validada contra CFDI",
      },
      created: true,
      idempotent: false,
      previousVersionInvalidated: null,
    });
    const invPost = await postDocumentApproval(
      new NextRequest("http://localhost:3000/api/finance/approvals/documents", {
        method: "POST",
        body: JSON.stringify({
          action: "RECORD_APPROVAL",
          docType: "INVOICE",
          docId: DOC_ID,
          branchId: BRANCH_A,
          requiredRole: "GERENTE",
          requesterId: "emp-1",
          evidenceId: EVIDENCE_ID,
          expectedVersion: 0,
          reason: "Discrepancia menor validada contra CFDI",
          materialPayload: {
            branchId: BRANCH_A,
            uuid: "CFDI-UUID-001",
            supplierId: "44444444-4444-4444-8444-444444444444",
            payeeId: null,
            purchaseOrderId: null,
            serviceOrderId: null,
            subtotalCents: 100_000,
            taxCents: 16_000,
            totalCents: 116_000,
            currency: "MXN",
            matchStatus: "EXCEPTION_APPROVED",
          },
        }),
      }),
    );
    expect(invPost.status).toBe(200);
    expect(mockRecordDocumentApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_ID,
        docType: "INVOICE",
        branchId: BRANCH_A,
        actorScope: { kind: "BRANCH", branchId: BRANCH_A },
        evidenceId: EVIDENCE_ID,
        expectedVersion: 0,
        reason: "Discrepancia menor validada contra CFDI",
        authority: expect.objectContaining({
          authoritySource: "INVOICE_MATCH_POLICY",
        }),
      }),
    );

    // 4. Conflicto de concurrencia (expectedVersion desactualizado) -> 409
    mockRecordDocumentApproval.mockRejectedValueOnce(
      ApiError.conflict("Conflicto de concurrencia en aprobación de INVOICE"),
    );
    const conflictRes = await postDocumentApproval(
      new NextRequest("http://localhost:3000/api/finance/approvals/documents", {
        method: "POST",
        body: JSON.stringify({
          action: "RECORD_APPROVAL",
          docType: "INVOICE",
          docId: DOC_ID,
          requiredRole: "GERENTE",
          expectedVersion: 0,
          materialPayload: {
            branchId: BRANCH_A,
            uuid: "CFDI-UUID-001",
            supplierId: null,
            payeeId: null,
            purchaseOrderId: null,
            serviceOrderId: null,
            subtotalCents: 100_000,
            taxCents: 16_000,
            totalCents: 116_000,
            currency: "MXN",
            matchStatus: "EXCEPTION_APPROVED",
          },
        }),
      }),
    );
    expect(conflictRes.status).toBe(409);
  });
});
