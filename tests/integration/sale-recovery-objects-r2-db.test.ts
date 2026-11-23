import { createHash, randomUUID } from "node:crypto";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// V2 real R2 private object verification for INV-01.c.recovery.objects.
// Uploads only synthetic bytes under a random synthetic company prefix and
// deletes + verifies absence in afterAll. Does not touch any database.
const companyA = randomUUID();
const companyB = randomUUID();
const uploadedKeys: string[] = [];
let r2: typeof import("@/lib/storage/r2-client");
let verifySaleRecoveryEvidence: typeof import("@/lib/services/sale-recovery-evidence").verifySaleRecoveryEvidence;

describe("INV-01.c.recovery.objects: verificación real contra objetos privados en R2", () => {
  beforeAll(async () => {
    config({ path: ".env", quiet: true });
    r2 = await import("@/lib/storage/r2-client");
    ({ verifySaleRecoveryEvidence } = await import("@/lib/services/sale-recovery-evidence"));
    expect(r2.isR2Configured(), "INV-01.c.recovery.objects V2 requiere R2 configurado").toBe(true);
  });

  afterAll(async () => {
    for (const key of uploadedKeys) {
      await r2.deleteFromR2(key);
      expect(await r2.getFromR2(key)).toBeNull();
    }
  });

  it("descarga objeto privado real de R2, comprueba SHA-256 y tamaño, y rechaza alteración/ausencia/alcance ajeno", async () => {
    const payload = Buffer.from(JSON.stringify({ kind: "synthetic-recovery-v2", company: companyA, nonce: randomUUID() }), "utf8");
    const sha256 = createHash("sha256").update(payload).digest("hex");
    const keyA = `companies/${companyA}/recovery-v2/${randomUUID()}.json`;
    const keyB = `companies/${companyB}/recovery-v2/${randomUUID()}.json`;
    const idA = randomUUID();
    const idB = randomUUID();

    await r2.uploadToR2(payload, keyA, "application/json");
    uploadedKeys.push(keyA);
    await r2.uploadToR2(payload, keyB, "application/json");
    uploadedKeys.push(keyB);

    // 1. Happy path against real R2 private object
    const verified = await verifySaleRecoveryEvidence(companyA, [
      { id: idA, storageKey: keyA, contentSha256: sha256 },
    ]);
    expect(verified).toEqual([
      { id: idA, storageKey: keyA, contentSha256: sha256, byteLength: payload.byteLength },
    ]);

    // 2. Tampered hash rejected against real bytes
    await expect(
      verifySaleRecoveryEvidence(companyA, [
        { id: idA, storageKey: keyA, contentSha256: "0".repeat(64) },
      ]),
    ).rejects.toMatchObject({ code: "MISSING_EVIDENCE" });

    // 3. Missing R2 object rejected
    await expect(
      verifySaleRecoveryEvidence(companyA, [
        { id: randomUUID(), storageKey: `companies/${companyA}/recovery-v2/missing-${randomUUID()}.json`, contentSha256: sha256 },
      ]),
    ).rejects.toMatchObject({ code: "MISSING_EVIDENCE" });

    // 4. Foreign company key rejected before touching R2
    await expect(
      verifySaleRecoveryEvidence(companyA, [
        { id: idB, storageKey: keyB, contentSha256: sha256 },
      ]),
    ).rejects.toMatchObject({ code: "INVALID_SCOPE" });
  }, 60_000);
});
