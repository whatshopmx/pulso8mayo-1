import { beforeEach, describe, expect, it, vi } from "vitest";

const r2 = vi.hoisted(() => ({
  uploadToR2: vi.fn(),
  generatePresignedUrl: vi.fn(),
}));

vi.mock("@/lib/storage/r2-client", () => ({
  uploadToR2: r2.uploadToR2,
  generatePresignedUrl: r2.generatePresignedUrl,
}));

// `isR2ObjectKey` se reproduce fiel para no arrastrar el grafo de `lib/db`
// (scoped-evidence importa branch-scope → db). La lógica real es idéntica.
vi.mock("@/lib/storage/scoped-evidence", () => ({
  isR2ObjectKey: (v: unknown): v is string =>
    typeof v === "string" &&
    v.length > 0 &&
    !/^https?:\/\//i.test(v) &&
    !v.startsWith("local://") &&
    !v.startsWith("/"),
}));

import {
  buildPosUploadKey,
  sanitizePosFileName,
  assertPosUploadValid,
  storePosUpload,
  resolvePosUploadUrl,
  POS_UPLOAD_MAX_BYTES,
} from "@/lib/storage/pos-upload";

const companyId = "c1000000-0000-4000-8000-000000000001";
const branchId = "b1000000-0000-4000-8000-000000000001";
const scope = { companyId, branchId, businessDate: "2026-11-12" };
const key = `companies/${companyId}/branches/${branchId}/pos/2026-11-12/1_a.csv`;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildPosUploadKey", () => {
  it("lleva jerarquía de tenancy y normaliza el nombre", () => {
    expect(sanitizePosFileName("reporte POS!.csv")).toBe("reporte_POS_.csv");
    const key = buildPosUploadKey(companyId, branchId, "2026-11-12", "reporte POS!.csv");
    expect(key).toMatch(
      new RegExp(
        `^companies/${companyId}/branches/${branchId}/pos/2026-11-12/\\d+_reporte_POS_\\.csv$`
      )
    );
  });

  it("no deja nombre vacío", () => {
    expect(sanitizePosFileName("///")).toBe("pos.csv");
    const key = buildPosUploadKey(companyId, branchId, "2026-11-12", "///");
    expect(key).toContain("_pos.csv");
  });
});

describe("assertPosUploadValid", () => {
  it("acepta un CSV razonable", () => {
    expect(() =>
      assertPosUploadValid({ byteLength: 100, mimeType: "text/csv" })
    ).not.toThrow();
  });

  it("rechaza vacío, exceso de tamaño y tipo no permitido", () => {
    expect(() =>
      assertPosUploadValid({ byteLength: 0, mimeType: "text/csv" })
    ).toThrow(/vacío/);
    expect(() =>
      assertPosUploadValid({
        byteLength: POS_UPLOAD_MAX_BYTES + 1,
        mimeType: "text/csv",
      })
    ).toThrow(/excede/);
    expect(() =>
      assertPosUploadValid({ byteLength: 10, mimeType: "application/pdf" })
    ).toThrow(/no permitido/);
  });
});

describe("storePosUpload", () => {
  it("sube bytes y devuelve la key durable", async () => {
    r2.uploadToR2.mockResolvedValue("companies/c/b/pos/2026-11-12/1_a.csv");
    const key = await storePosUpload({
      companyId,
      branchId,
      businessDate: "2026-11-12",
      fileName: "a.csv",
      buffer: Buffer.from("SKU,Qty\nA,2\n"),
      mimeType: "text/csv",
    });
    expect(key).toBe("companies/c/b/pos/2026-11-12/1_a.csv");
    expect(r2.uploadToR2).toHaveBeenCalledOnce();
    const [buffer, savedKey, mimeType] = r2.uploadToR2.mock.calls[0];
    expect(buffer).toBeInstanceOf(Buffer);
    expect(savedKey).toContain(`companies/${companyId}/branches/${branchId}/pos/2026-11-12/`);
    expect(mimeType).toBe("text/csv");
  });

  it("valida antes de tocar storage", async () => {
    await expect(
      storePosUpload({
        companyId,
        branchId,
        businessDate: "2026-11-12",
        fileName: "a.csv",
        buffer: Buffer.alloc(0),
        mimeType: "text/csv",
      })
    ).rejects.toThrow(/vacío/);
    expect(r2.uploadToR2).not.toHaveBeenCalled();
  });
});

describe("resolvePosUploadUrl", () => {
  it("devuelve null sin valor", async () => {
    await expect(resolvePosUploadUrl(null, scope)).resolves.toBeNull();
    await expect(resolvePosUploadUrl(undefined, scope)).resolves.toBeNull();
    await expect(resolvePosUploadUrl("", scope)).resolves.toBeNull();
  });

  it("rechaza referencias legacy sin ámbito verificable", async () => {
    for (const value of ["https://cdn.example/a.csv", "local://pos-uploads/x.csv", "/demo/a.csv"]) {
      await expect(resolvePosUploadUrl(value, scope)).resolves.toBeNull();
    }
    expect(r2.generatePresignedUrl).not.toHaveBeenCalled();
  });

  it("presigna la key de R2 con TTL corto", async () => {
    r2.generatePresignedUrl.mockResolvedValue("https://signed.example/x");
    await expect(
      resolvePosUploadUrl(key, scope)
    ).resolves.toBe("https://signed.example/x");
    expect(r2.generatePresignedUrl).toHaveBeenCalledWith(
      key,
      600
    );
  });

  it("devuelve null si el presignado falla", async () => {
    r2.generatePresignedUrl.mockRejectedValue(new Error("boom"));
    await expect(
      resolvePosUploadUrl(key, scope)
    ).resolves.toBeNull();
  });
});
