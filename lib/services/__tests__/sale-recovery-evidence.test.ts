import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { verifySaleRecoveryEvidence } from "../sale-recovery-evidence";

const companyId = "10000000-0000-4000-8000-000000000001";
const proof = (content = Buffer.from("original sale")) => ({
  id: "10000000-0000-4000-8000-000000000002",
  storageKey: `companies/${companyId}/evidence/original`,
  contentSha256: createHash("sha256").update(content).digest("hex"),
});
describe("contenido de evidencia histórica", () => {
  it("descarga la clave privada exacta y calcula el hash de contenido", async () => {
    const read = vi.fn().mockResolvedValue(Buffer.from("original sale"));
    expect(await verifySaleRecoveryEvidence(companyId, [proof()], read)).toEqual([
      { ...proof(), byteLength: 13 },
    ]);
    expect(read).toHaveBeenCalledWith(proof().storageKey, { maxBytes: 20 * 1024 * 1024, timeoutMs: 15000 });
  });
  it("valida todo el lote antes de descargar y no accede a otra empresa", async () => {
    const read = vi.fn();
    for (const storageKey of ["https://example.test", "local://fake", "companies/other/file",
      `companies/${companyId}/../file`, `companies/${companyId}/./file`, `companies/${companyId}//file`]) {
      await expect(verifySaleRecoveryEvidence(companyId, [proof(), { ...proof(), id: "other", storageKey }], read)).rejects.toThrow();
    }
    await expect(verifySaleRecoveryEvidence(companyId, [proof(), proof()], read)).rejects.toThrow();
    await expect(verifySaleRecoveryEvidence(companyId, [], read)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });
  it("bloquea objeto ausente, vacío, alterado, demasiado grande o error del proveedor", async () => {
    for (const content of [null, Buffer.alloc(0), Buffer.from("altered"), Buffer.alloc(20 * 1024 * 1024 + 1)]) {
      await expect(verifySaleRecoveryEvidence(companyId, [proof()], async () => content)).rejects.toThrow();
    }
    await expect(verifySaleRecoveryEvidence(companyId, [proof()], async () => { throw new Error("private provider data"); }))
      .rejects.toThrow("No se pudo verificar el contenido de la evidencia");
  });
  it("clona las referencias antes de esperar I/O y no devuelve un resultado parcial", async () => {
    const records = [proof()];
    const read = vi.fn(async () => { records[0].contentSha256 = "b".repeat(64); return Buffer.from("original sale"); });
    const result = await verifySaleRecoveryEvidence(companyId, records, read);
    expect(result[0].contentSha256).toBe(proof().contentSha256);
    await expect(verifySaleRecoveryEvidence(companyId, [proof(), { ...proof(), id: "10000000-0000-4000-8000-000000000003" }],
      vi.fn().mockResolvedValueOnce(Buffer.from("original sale")).mockResolvedValueOnce(null))).rejects.toThrow();
  });
});
