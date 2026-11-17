import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: {
    user: {
      id: "actor",
      role: "ADMIN",
      companyId: "c1000000-0000-4000-8000-000000000001",
      branchId: null as string | null,
      email: "a@b.c",
    },
    tenantId: "c1000000-0000-4000-8000-000000000001",
    branchId: null as string | null,
  },
  cut: null as
    | { id: string; branchId: string; rawFileUrl: string | null }
    | null,
  scope: { kind: "ALL" } as { kind: "ALL" | "BRANCH" | "NONE"; branchId?: string },
  resolvePosUploadUrl: vi.fn(),
}));

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

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => (mocks.cut ? [mocks.cut] : [])),
        })),
      })),
    })),
  },
}));

vi.mock("@/lib/branch-scope", () => ({
  resolveBranchScope: vi.fn(() => mocks.scope),
}));

vi.mock("@/lib/storage/pos-upload", () => ({
  resolvePosUploadUrl: mocks.resolvePosUploadUrl,
  POS_UPLOAD_URL_TTL_SECONDS: 600,
}));

import { GET } from "@/app/api/sales/cuts/[id]/pos-file/route";

const cutId = "d1000000-0000-4000-8000-000000000001";
const branchId = "b1000000-0000-4000-8000-000000000001";
const otherBranch = "b2000000-0000-4000-8000-000000000002";
const key = `companies/${mocks.auth.tenantId}/branches/${branchId}/pos/2026-11-12/1_a.csv`;

function call(id = cutId) {
  return GET(new NextRequest(`http://localhost/api/sales/cuts/${id}/pos-file`), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.scope = { kind: "ALL" };
  mocks.cut = { id: cutId, branchId, rawFileUrl: key };
  mocks.resolvePosUploadUrl.mockResolvedValue("https://signed.example/x");
});

describe("lectura autorizada del archivo POS", () => {
  it("rechaza id mal formado antes de tocar DB", async () => {
    const res = await call("not-a-uuid");
    expect(res.status).toBe(400);
    expect(mocks.resolvePosUploadUrl).not.toHaveBeenCalled();
  });

  it("404 si el corte no existe o no es de la empresa", async () => {
    mocks.cut = null;
    const res = await call();
    expect(res.status).toBe(404);
  });

  it("403 si el alcance del rol es NONE", async () => {
    mocks.scope = { kind: "NONE" };
    const res = await call();
    expect(res.status).toBe(403);
  });

  it("404 (no 403) si el rol de sucursal pide otra branch", async () => {
    mocks.scope = { kind: "BRANCH", branchId: otherBranch };
    const res = await call();
    expect(res.status).toBe(404);
    expect(mocks.resolvePosUploadUrl).not.toHaveBeenCalled();
  });

  it("404 si el corte no tiene archivo", async () => {
    mocks.cut = { id: cutId, branchId, rawFileUrl: null };
    const res = await call();
    expect(res.status).toBe(404);
  });

  it("devuelve la URL firmada y la key para el corte propio", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { url: string; fileKey: string; expiresInSeconds: number } };
    expect(body.success).toBe(true);
    expect(body.data.url).toBe("https://signed.example/x");
    expect(body.data.fileKey).toBe(key);
    expect(body.data.expiresInSeconds).toBe(600);
    expect(mocks.resolvePosUploadUrl).toHaveBeenCalledWith(key);
  });

  it("404 si la key no resuelve a URL", async () => {
    mocks.resolvePosUploadUrl.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(404);
  });
});
