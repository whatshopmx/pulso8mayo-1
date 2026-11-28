import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/error";
import {
  HistoricalCorrectionProtocolError,
  validateHistoricalCorrectionProtocolInput,
} from "@/lib/services/historical-correction-protocol-service";

const {
  mockRequirePermissionApi,
  mockTransaction,
  mockReadRevalidation,
  mockApplyProtocol,
} = vi.hoisted(() => ({
  mockRequirePermissionApi: vi.fn(),
  mockTransaction: vi.fn(),
  mockReadRevalidation: vi.fn(),
  mockApplyProtocol: vi.fn(),
}));

vi.mock("@/lib/rbac/abac", () => ({
  requirePermissionApi: mockRequirePermissionApi,
}));

vi.mock("@/lib/db", () => ({
  db: {
    transaction: mockTransaction,
  },
}));

vi.mock("@/lib/services/receiving-overcount-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/receiving-overcount-service")>();
  return {
    ...actual,
    readReceivingOvercountRevalidation: mockReadRevalidation,
  };
});

vi.mock("@/lib/services/historical-correction-protocol-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/historical-correction-protocol-service")>();
  return {
    ...actual,
    applyHistoricalCorrectionProtocol: mockApplyProtocol,
  };
});

import {
  GET as getHistoricalCorrection,
  POST as postHistoricalCorrection,
} from "@/app/api/inventory/batches/historical-correction/route";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const BATCH_ID = "22222222-2222-4222-8222-222222222222";

describe("REC-03B V3 — Protocolo de corrección histórica (reglas puras + contrato HTTP)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
  });

  it("valida reglas puras REC-03B: conteo, unidad, segregación de aprobador, rol >= ADMIN, motivo y respaldo", () => {
    const valid = {
      companyId: COMPANY_ID,
      batchId: BATCH_ID,
      expectedDelta: 10,
      countedQuantity: 10,
      unit: "KG",
      countedBy: "gerente-1",
      approverId: "admin-1",
      approverRole: "ADMIN",
      reason: "Conteo físico verificado contra remisión y respaldo Neon",
      backupReference: "neon-snap-2026-11-27-01",
    };

    expect(() => validateHistoricalCorrectionProtocolInput(valid)).not.toThrow();

    // Auto-aprobación prohibida
    expect(() =>
      validateHistoricalCorrectionProtocolInput({ ...valid, approverId: "gerente-1" }),
    ).toThrow(expect.objectContaining({ code: "SELF_APPROVAL", httpStatus: 403 }));

    // Rol insuficiente (GERENTE no puede aprobar corrección histórica operativa)
    expect(() =>
      validateHistoricalCorrectionProtocolInput({ ...valid, approverRole: "GERENTE" }),
    ).toThrow(expect.objectContaining({ code: "INSUFFICIENT_ROLE", httpStatus: 403 }));

    // Sin respaldo verificado
    expect(() =>
      validateHistoricalCorrectionProtocolInput({ ...valid, backupReference: "abc" }),
    ).toThrow(expect.objectContaining({ code: "BACKUP_REQUIRED", httpStatus: 400 }));

    // Motivo corto
    expect(() =>
      validateHistoricalCorrectionProtocolInput({ ...valid, reason: "corto" }),
    ).toThrow(expect.objectContaining({ code: "INVALID_INPUT", httpStatus: 400 }));
  });

  it("GET ejecuta dry-run READ ONLY acotado a la empresa de sesión y exige RBAC (403)", async () => {
    mockRequirePermissionApi.mockRejectedValueOnce(ApiError.forbidden("Sin permiso"));
    const denied = await getHistoricalCorrection(
      new NextRequest("http://localhost:3000/api/inventory/batches/historical-correction"),
    );
    expect(denied.status).toBe(403);

    mockRequirePermissionApi.mockResolvedValueOnce({
      ctx: { userCompanyId: COMPANY_ID, userId: "admin-1", userRole: "ADMIN" },
    });
    mockReadRevalidation.mockResolvedValueOnce({
      protocol: "REC-03A",
      mode: "DRY_RUN",
      scope: { companyId: COMPANY_ID },
      summary: { candidates: 2, sufficient: 1, ambiguous: 1, alreadyCorrected: 0, byReason: {}, nonReceivingMismatches: 0 },
      batches: [],
    });

    const ok = await getHistoricalCorrection(
      new NextRequest("http://localhost:3000/api/inventory/batches/historical-correction"),
    );
    expect(ok.status).toBe(200);
    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), { accessMode: "read only" });
    expect(mockReadRevalidation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ companyId: COMPANY_ID }),
    );
  });

  it("POST deriva aprobador/empresa de sesión, mapea 400/403/409 y permite replay idempotente", async () => {
    mockRequirePermissionApi.mockResolvedValue({
      ctx: { userCompanyId: COMPANY_ID, userId: "admin-1", userRole: "ADMIN" },
    });

    const baseBody = {
      batchId: BATCH_ID,
      expectedDelta: 10,
      countedQuantity: 10,
      unit: "KG",
      countedBy: "gerente-1",
      reason: "Conteo físico verificado contra remisión y respaldo Neon",
      backupReference: "neon-snap-2026-11-27-01",
    };

    // 1. Lote SUFFICIENT respaldado -> 200 APPLIED
    mockApplyProtocol.mockResolvedValueOnce({
      status: "APPLIED",
      batchId: BATCH_ID,
      adjustment: -10,
      before: 20,
      after: 10,
      movementId: "mov-1",
      auditId: "aud-1",
      protocol: "REC-03B",
      unit: "KG",
      countedBy: "gerente-1",
      approverId: "admin-1",
      backupReference: "neon-snap-2026-11-27-01",
    });

    const ok = await postHistoricalCorrection(
      new NextRequest("http://localhost:3000/api/inventory/batches/historical-correction", {
        method: "POST",
        body: JSON.stringify(baseBody),
      }),
    );
    expect(ok.status).toBe(200);
    const okJson = await ok.json();
    expect(okJson.data).toMatchObject({ status: "APPLIED", protocol: "REC-03B", after: 10 });
    expect(mockApplyProtocol).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId: COMPANY_ID,
        approverId: "admin-1",
        approverRole: "ADMIN",
        countedBy: "gerente-1",
        unit: "KG",
        backupReference: "neon-snap-2026-11-27-01",
      }),
    );

    // 2. Auto-aprobación -> 403
    mockApplyProtocol.mockRejectedValueOnce(
      new HistoricalCorrectionProtocolError("SELF_APPROVAL", 403, "Segregación de funciones"),
    );
    const selfRes = await postHistoricalCorrection(
      new NextRequest("http://localhost:3000/api/inventory/batches/historical-correction", {
        method: "POST",
        body: JSON.stringify({ ...baseBody, countedBy: "admin-1" }),
      }),
    );
    expect(selfRes.status).toBe(403);

    // 3. Lote AMBIGUOUS retenido -> 409
    mockApplyProtocol.mockRejectedValueOnce(
      new HistoricalCorrectionProtocolError("NOT_SUFFICIENT", 409, "Lote ambiguo retenido", [
        "DELTA_NOT_RECEIVED_QUANTITY",
      ]),
    );
    const ambRes = await postHistoricalCorrection(
      new NextRequest("http://localhost:3000/api/inventory/batches/historical-correction", {
        method: "POST",
        body: JSON.stringify(baseBody),
      }),
    );
    expect(ambRes.status).toBe(409);

    // 4. Unidad incorrecta -> 400
    mockApplyProtocol.mockRejectedValueOnce(
      new HistoricalCorrectionProtocolError("UNIT_MISMATCH", 400, "Unidad distinta"),
    );
    const unitRes = await postHistoricalCorrection(
      new NextRequest("http://localhost:3000/api/inventory/batches/historical-correction", {
        method: "POST",
        body: JSON.stringify({ ...baseBody, unit: "LITRO" }),
      }),
    );
    expect(unitRes.status).toBe(400);

    // 5. Repetición idempotente -> 200 ALREADY_CORRECTED
    mockApplyProtocol.mockResolvedValueOnce({
      status: "ALREADY_CORRECTED",
      batchId: BATCH_ID,
      protocol: "REC-03B",
      unit: "KG",
      countedBy: "gerente-1",
      approverId: "admin-1",
      backupReference: "neon-snap-2026-11-27-01",
    });
    const replayRes = await postHistoricalCorrection(
      new NextRequest("http://localhost:3000/api/inventory/batches/historical-correction", {
        method: "POST",
        body: JSON.stringify(baseBody),
      }),
    );
    expect(replayRes.status).toBe(200);
    expect((await replayRes.json()).data.status).toBe("ALREADY_CORRECTED");
  });
});
