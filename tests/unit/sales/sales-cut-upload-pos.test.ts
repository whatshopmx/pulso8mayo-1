import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/error";

const mocks = vi.hoisted(() => {
  class SalesIngestionError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = "SalesIngestionError";
      this.code = code;
    }
  }

  return {
    SalesIngestionError,
    auth: {
      user: {
        id: "u1000000-0000-4000-8000-000000000001",
        role: "ADMIN" as string,
        companyId: "c1000000-0000-4000-8000-000000000001" as string | null,
        branchId: null as string | null,
        email: "a@b.c",
      },
      tenantId: "c1000000-0000-4000-8000-000000000001",
      branchId: null as string | null,
    },
    scope: { kind: "ALL" } as { kind: "ALL" | "BRANCH" | "NONE"; branchId?: string },
    assertBranchOfCompany: vi.fn(async () => {}),
    isR2Configured: vi.fn(() => true),
    uploadToR2: vi.fn(async (_buffer: Buffer, key: string) => key),
    previewSalesCut: vi.fn(),
    ingestSalesCut: vi.fn(),
  };
});

vi.mock("@/lib/api/with-auth", async () => {
  const { isApiError } = await vi.importActual<typeof import("@/lib/api/error")>(
    "@/lib/api/error"
  );
  return {
    withRoleAuth:
      (_roles: unknown, handler: (req: unknown, ctx: unknown) => Promise<Response>) =>
      async (req: unknown, ctx: unknown) => {
        try {
          return await handler(req, { ...(ctx as object), auth: mocks.auth });
        } catch (error) {
          if (isApiError(error)) {
            return Response.json(
              { success: false, error: { message: error.message, details: error.details } },
              { status: (error as { statusCode: number }).statusCode }
            );
          }
          throw error;
        }
      },
  };
});

vi.mock("@/lib/branch-scope", () => ({
  resolveBranchScope: () => mocks.scope,
  assertBranchOfCompany: mocks.assertBranchOfCompany,
}));

vi.mock("@/lib/storage/r2-client", () => ({
  isR2Configured: mocks.isR2Configured,
  uploadToR2: mocks.uploadToR2,
  generatePresignedUrl: vi.fn(),
}));

vi.mock("@/lib/services/sales-ingestion-service", () => ({
  SalesIngestionError: mocks.SalesIngestionError,
  previewSalesCut: mocks.previewSalesCut,
  ingestSalesCut: mocks.ingestSalesCut,
}));

import { POST } from "@/app/api/sales/cuts/upload/route";

const companyId = "c1000000-0000-4000-8000-000000000001";
const branchId = "b1000000-0000-4000-8000-000000000001";
const otherBranch = "b2000000-0000-4000-8000-000000000002";

/** Resultado mínimo de `previewSalesCut` que la ruta consume. */
function build(overrides: Record<string, unknown> = {}) {
  return {
    fileShape: "flat_rows",
    businessDate: "2026-11-12",
    cuts: [{ channel: "TOTAL", data: { businessDate: "2026-11-12", totalSales: 1000 } }],
    issues: [],
    errors: [] as string[],
    mapping: [],
    previewRows: [],
    fileName: "corte.csv",
    status: "VALIDATED",
    ...overrides,
  };
}

function request(
  fields: {
    file?: File | null;
    branchId?: string;
    shift?: string;
    businessDate?: string;
  } = {}
) {
  const form = new FormData();
  const file =
    fields.file === undefined
      ? new File(["sku,cantidad\nA,2\n"], "corte.csv", { type: "text/csv" })
      : fields.file;
  if (file) form.set("file", file);
  form.set("branchId", fields.branchId ?? branchId);
  form.set("shift", fields.shift ?? "MATUTINO");
  if (fields.businessDate !== undefined) form.set("businessDate", fields.businessDate);

  return new NextRequest("http://localhost/api/sales/cuts/upload", {
    method: "POST",
    body: form,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.tenantId = companyId;
  mocks.auth.user.companyId = companyId;
  mocks.auth.user.role = "ADMIN";
  mocks.auth.user.branchId = null;
  mocks.scope = { kind: "ALL" };
  mocks.isR2Configured.mockReturnValue(true);
  mocks.uploadToR2.mockImplementation(async (_buffer: Buffer, key: string) => key);
  mocks.assertBranchOfCompany.mockResolvedValue(undefined);
  mocks.previewSalesCut.mockResolvedValue(build());
  mocks.ingestSalesCut.mockImplementation(async (params: { fileName: string }) => ({
    ...build(),
    fileName: params.fileName,
    rows: [],
  }));
});

describe("productor POS del corte de ventas", () => {
  it("persiste la key canónica con el día efectivo del archivo, no con el del formulario", async () => {
    mocks.previewSalesCut.mockResolvedValue(build({ businessDate: "2026-11-12" }));

    const res = await POST(request({ businessDate: "2026-11-10" }));

    expect(res.status).toBe(200);
    expect(mocks.assertBranchOfCompany).toHaveBeenCalledWith(companyId, branchId);

    const [, key, mimeType] = mocks.uploadToR2.mock.calls[0];
    expect(key).toMatch(
      new RegExp(
        `^companies/${companyId}/branches/${branchId}/pos/2026-11-12/\\d+_corte\\.csv$`
      )
    );
    expect(mimeType).toBe("text/csv");

    const ingestArgs = mocks.ingestSalesCut.mock.calls[0][0];
    expect(ingestArgs.rawFileUrl).toBe(key);
    expect(ingestArgs.precomputed).toEqual(build({ businessDate: "2026-11-12" }));
    expect(ingestArgs.businessDate).toBe("2026-11-10");
    expect(ingestArgs.companyId).toBe(companyId);
    expect(ingestArgs.branchId).toBe(branchId);
  });

  it("rechaza otra sucursal antes de leer o escribir evidencia", async () => {
    mocks.scope = { kind: "BRANCH", branchId: otherBranch };

    const res = await POST(request());

    expect(res.status).toBe(403);
    expect(mocks.previewSalesCut).not.toHaveBeenCalled();
    expect(mocks.uploadToR2).not.toHaveBeenCalled();
    expect(mocks.ingestSalesCut).not.toHaveBeenCalled();
  });

  it("rechaza un rol acotado sin sucursal asignada", async () => {
    mocks.scope = { kind: "NONE" };

    const res = await POST(request());

    expect(res.status).toBe(403);
    expect(mocks.previewSalesCut).not.toHaveBeenCalled();
  });

  it("rechaza una sucursal ajena a la empresa antes de tocar storage", async () => {
    mocks.assertBranchOfCompany.mockRejectedValue(
      ApiError.badRequest("La sucursal seleccionada no existe para esta empresa.")
    );

    const res = await POST(request());

    expect(res.status).toBe(400);
    expect(mocks.previewSalesCut).not.toHaveBeenCalled();
    expect(mocks.uploadToR2).not.toHaveBeenCalled();
  });

  it("rechaza un tipo de archivo no permitido sin subir bytes", async () => {
    const res = await POST(
      request({ file: new File(["%PDF"], "corte.pdf", { type: "application/pdf" }) })
    );

    expect(res.status).toBe(400);
    expect(mocks.previewSalesCut).not.toHaveBeenCalled();
    expect(mocks.uploadToR2).not.toHaveBeenCalled();
  });

  it("rechaza un archivo vacío antes de tocar storage", async () => {
    const res = await POST(request({ file: new File([], "corte.csv", { type: "text/csv" }) }));

    expect(res.status).toBe(400);
    expect(mocks.uploadToR2).not.toHaveBeenCalled();
  });

  it("rechaza un turno inválido sin leer el archivo", async () => {
    const res = await POST(request({ shift: "NOCTURNO" }));

    expect(res.status).toBe(400);
    expect(mocks.previewSalesCut).not.toHaveBeenCalled();
  });

  it("no escribe bytes huérfanos cuando el corte no es válido", async () => {
    mocks.previewSalesCut.mockResolvedValue(
      build({ businessDate: null, errors: ["La fecha del corte (2026-12-01) es futura."] })
    );
    mocks.ingestSalesCut.mockRejectedValue(
      new mocks.SalesIngestionError(
        "VALIDATION_FAILED",
        "La fecha del corte (2026-12-01) es futura."
      )
    );

    const res = await POST(request());
    const body = (await res.json()) as { success: boolean; error: { message: string } };

    expect(res.status).toBe(400);
    expect(body.error.message).toContain("es futura");
    expect(mocks.uploadToR2).not.toHaveBeenCalled();
  });

  it("sin R2 deja un marcador local explícito que no afirma durabilidad", async () => {
    mocks.isR2Configured.mockReturnValue(false);

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(mocks.uploadToR2).not.toHaveBeenCalled();
    const ingestArgs = mocks.ingestSalesCut.mock.calls[0][0];
    expect(ingestArgs.rawFileUrl).toBe(
      `local://pos-uploads/${companyId}/${branchId}/2026-11-12-corte.csv`
    );
  });

  it("no persiste el corte si el storage configurado falla", async () => {
    mocks.uploadToR2.mockRejectedValue(new Error("Failed to upload file to storage"));

    const res = await POST(request());

    expect(res.status).toBe(500);
    expect(mocks.ingestSalesCut).not.toHaveBeenCalled();
  });
});
