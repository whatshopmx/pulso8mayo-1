import { describe, expect, it } from "vitest";
import { prepareSaleRecoveryReview, assertRecoveryReviewMatches } from "../sale-recovery-review";
import { buildSaleRecipeSnapshot } from "../sale-consumption-snapshot";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function fixture() {
  const snapshot = await buildSaleRecipeSnapshot(id(1), id(3), {
    recipe: async () => ({ id: id(3), companyId: id(1), baseYield: "1", unit: "PORTION",
      items: [{ id: id(10), itemId: id(4), quantity: "0.25", unit: "KG", isSubRecipe: false, yieldPercent: 100 }] }),
    ingredient: async () => ({ id: id(4), companyId: id(1), unit: "KG" }), conversions: async () => [],
  });
  return {
    schemaVersion: 2, idempotencyKey: id(8), requestedBy: "requester", reason: "Regularizar consumo histórico con expediente verificado",
    identity: { companyId: id(1), branchId: id(2), source: "pos:legacy", productKey: "SKU-1", saleDay: "2026-11-01" },
    legacy: { id: id(5), companyId: id(1), branchId: id(2), recipeId: id(3), saleDay: "2026-11-01", quantitySold: "2.00", totalRevenueCents: null,
      updatedAt: "2026-11-02T00:00:00Z" },
    observedHeadId: null, consumptionState: "NOT_APPLIED", observedMovementIds: [], recipeSnapshot: snapshot,
    evidence: (["SALE", "RECIPE_VERSION", "NO_PRIOR_CONSUMPTION"] as const).map((purpose, i) => ({
      id: id(20 + i), attestationId: id(30 + i), companyId: id(1), branchId: id(2), legacySaleId: id(5), purpose,
      storageKey: `companies/${id(1)}/branches/${id(2)}/sales-recovery/${id(5)}/${id(20+i)}`, contentSha256: "a".repeat(64), byteLength: 100,
      sourceReference: "Documento original 001", verificationReason: "Revisión de procedencia y finalidad", verifiedRole: "ADMIN",
      verifiedBy: "verifier", evidenceUpdatedAt: "2026-11-02T00:00:00Z", createdAt: "2026-11-02T00:00:00Z", verifiedAt: "2026-11-03T00:00:00Z", deletedAt: null,
    })),
  };
}
function approval(prepared: ReturnType<typeof prepareSaleRecoveryReview>) {
  return { companyId: id(1), branchId: id(2), proposalHash: prepared.proposalHash, stateHash: prepared.stateHash,
    decision: "APPROVED", approvedBy: "reviewer", approverRole: "ADMIN", approvedAt: "2026-11-04T00:00:00Z" };
}
describe("expediente de revisión de recuperación; sin autorización de stock", () => {
  it("distingue un microsegundo de cambio de venta en la huella de estado", async () => {
    const input = await fixture(); input.legacy.updatedAt = "2026-11-02T00:00:00.123456Z";
    const prepared = prepareSaleRecoveryReview(input);
    const changed = { ...input, legacy: { ...input.legacy, updatedAt: "2026-11-02T00:00:00.123457Z" } };
    expect(prepareSaleRecoveryReview(changed).stateHash).not.toBe(prepared.stateHash);
    expect(() => assertRecoveryReviewMatches(prepared, approval(prepared), changed)).toThrow();
  });
  it("rechaza revisión anterior a creación y aprobación anterior a revisión por un microsegundo", async () => {
    const input = await fixture();
    const earlier = { ...input.evidence[0], createdAt: "2026-11-03T00:00:00.123457Z", evidenceUpdatedAt: "2026-11-03T00:00:00.123457Z", verifiedAt: "2026-11-03T00:00:00.123456Z" };
    expect(() => prepareSaleRecoveryReview({ ...input, evidence: [earlier, ...input.evidence.slice(1)] })).toThrow();
    input.evidence[0].verifiedAt = "2026-11-04T00:00:00.123457Z";
    const prepared = prepareSaleRecoveryReview(input);
    expect(() => assertRecoveryReviewMatches(prepared, { ...approval(prepared), approvedAt: "2026-11-04T00:00:00.123456Z" }, input)).toThrow();
  });
  it("normaliza offsets y escala sin perder fracción; no redondea precisión superior a seis", async () => {
    const input = await fixture(); input.legacy.updatedAt = "2026-11-02T00:00:00.123456Z";
    const prepared = prepareSaleRecoveryReview(input);
    const offset = { ...input, legacy: { ...input.legacy, updatedAt: "2026-11-01T18:00:00.123456-06:00" } };
    expect(prepareSaleRecoveryReview(offset)).toEqual(prepared);
    expect(prepared.proposal.legacy.updatedAt).toBe("2026-11-02T00:00:00.123456Z");
    expect(prepared.proposal.evidence[0].createdAt).toBe("2026-11-02T00:00:00.000000Z");
    for (const updatedAt of ["2026-11-02T00:00:00.1234567Z", "2026-11-02 00:00:00.123456", "9999-12-31T23:59:59-01:00"])
      expect(() => prepareSaleRecoveryReview({ ...input, legacy: { ...input.legacy, updatedAt } })).toThrow();
  });
  it("exige versión 2 y atestación/procedencia completas sin completar DTO antiguo por inferencia", async () => {
    const input = await fixture();
    expect(() => prepareSaleRecoveryReview({ ...input, schemaVersion: 1 })).toThrow();
    for (const change of [{ attestationId: undefined }, { evidenceUpdatedAt: undefined }, { byteLength: 0 }, { byteLength: 20971521 },
      { sourceReference: "" }, { verificationReason: " " }, { verifiedRole: "GERENTE" }, { evidenceUpdatedAt: "2026-11-01T00:00:00Z" },
      { evidenceUpdatedAt: "2026-11-03T00:00:00.000001Z" }])
      expect(() => prepareSaleRecoveryReview({ ...input, evidence: [{ ...input.evidence[0], ...change }, ...input.evidence.slice(1)] })).toThrow();
    expect(() => prepareSaleRecoveryReview({ ...input, evidence: [input.evidence[0], { ...input.evidence[1], attestationId: input.evidence[0].attestationId }, input.evidence[2]] })).toThrow();
  });
  it("la huella liga ID de atestación, versión nativa y tamaño además de los bytes", async () => {
    const input = await fixture(), prepared = prepareSaleRecoveryReview(input);
    for (const change of [{ attestationId: id(80) }, { evidenceUpdatedAt: "2026-11-02T00:00:00.000001Z" }, { byteLength: 101 }]) {
      const changed = { ...input, evidence: [{ ...input.evidence[0], ...change }, ...input.evidence.slice(1)] };
      const next = prepareSaleRecoveryReview(changed);
      expect(next.proposalHash).not.toBe(prepared.proposalHash); expect(next.stateHash).not.toBe(prepared.stateHash);
      expect(() => assertRecoveryReviewMatches(prepared, approval(prepared), changed)).toThrow();
    }
  });
  it("congela identidad, ingreso desconocido y demanda exacta para revisión", async () => {
    const input = await fixture(); const prepared = prepareSaleRecoveryReview(input);
    expect(prepared.proposal.legacy.totalRevenueCents).toBeNull();
    expect(prepared.demand).toEqual([{ itemId: id(4), unit: "KG", quantity: "0.5000" }]);
    expect(prepared.proposalHash).toMatch(/^[a-f0-9]{64}$/);
    expect(() => assertRecoveryReviewMatches(prepared, approval(prepared), input)).not.toThrow();
    input.legacy.quantitySold = "3";
    expect(prepared.proposal.legacy.quantitySold).toBe("2.00");
  });
  it("no infiere consumo cero por ausencia de movimientos ni acepta una bandera de cliente", async () => {
    const input = await fixture();
    expect(() => prepareSaleRecoveryReview({ ...input, evidence: input.evidence.slice(0, 2) })).toThrow(/evidencia/i);
    expect(() => prepareSaleRecoveryReview({ ...input, proofVerified: true })).toThrow();
    expect(() => prepareSaleRecoveryReview({ ...input, consumptionState: "UNKNOWN" })).toThrow(/consumo/i);
    expect(() => prepareSaleRecoveryReview({ ...input, consumptionState: "APPLIED" })).toThrow(/consumo/i);
    expect(() => prepareSaleRecoveryReview({ ...input, observedMovementIds: [id(90)] })).toThrow(/consumo/i);
  });
  it("bloquea un head existente y exige precisión/rango sin redondear", async () => {
    const input = await fixture();
    expect(() => prepareSaleRecoveryReview({ ...input, observedHeadId: id(7) })).toThrow(/revisión/i);
    for (const quantitySold of ["1.001", "100000000", "-1"]) expect(() => prepareSaleRecoveryReview({ ...input, legacy: { ...input.legacy, quantitySold } })).toThrow();
    for (const totalRevenueCents of [-1, 0.5, 2147483648]) expect(() => prepareSaleRecoveryReview({ ...input, legacy: { ...input.legacy, totalRevenueCents } })).toThrow();
  });
  it("rechaza empresa, sucursal, día o receta discordantes", async () => {
    const input = await fixture();
    for (const change of [{ companyId: id(90) }, { branchId: id(90) }, { saleDay: "2026-11-02" }, { recipeId: id(90) }])
      expect(() => prepareSaleRecoveryReview({ ...input, legacy: { ...input.legacy, ...change } })).toThrow();
    expect(() => prepareSaleRecoveryReview({ ...input, identity: { ...input.identity, saleDay: "2026-02-30" } })).toThrow();
  });
  it("requiere tres pruebas durables propias y vigentes, con verificador y hash de contenido", async () => {
    const input = await fixture();
    for (const change of [{ companyId: id(90) }, { branchId: id(90) }, { legacySaleId: id(90) }, { storageKey: "local://fake" },
      { storageKey: `companies/${id(1)}/../fake` }, { contentSha256: "fake" }, { verifiedBy: "" },
      { deletedAt: "2026-11-04T00:00:00Z" }, { verifiedAt: "2026-11-01T00:00:00Z" }])
      expect(() => prepareSaleRecoveryReview({ ...input, evidence: [{ ...input.evidence[0], ...change }, ...input.evidence.slice(1)] })).toThrow();
    expect(() => prepareSaleRecoveryReview({ ...input, evidence: [input.evidence[0], input.evidence[0], ...input.evidence.slice(1)] })).toThrow();
  });
  it("rechaza snapshot alterado y no sustituye la receta histórica por otra definición", async () => {
    const input = await fixture(); input.recipeSnapshot.versionKey = "b".repeat(64);
    expect(() => prepareSaleRecoveryReview(input)).toThrow(/snapshot/i);
  });
  it("el hash es estable frente a orden JSONB/evidencia y distingue null de cero", async () => {
    const input = await fixture(); const first = prepareSaleRecoveryReview(input);
    const reversed = { ...input, evidence: [...input.evidence].reverse(),
      recipeSnapshot: { ...input.recipeSnapshot, definition: Object.fromEntries(Object.entries(input.recipeSnapshot.definition).reverse()) } };
    expect(prepareSaleRecoveryReview(reversed).proposalHash).toBe(first.proposalHash);
    expect(prepareSaleRecoveryReview({ ...input, legacy: { ...input.legacy, totalRevenueCents: 0 } }).proposalHash).not.toBe(first.proposalHash);
  });
  it("la aprobación exige otro usuario con capacidad y rol de revisión", async () => {
    const input = await fixture(); const prepared = prepareSaleRecoveryReview(input);
    for (const change of [{ approvedBy: "requester" }, { approverRole: "GERENTE" }, { approverRole: "EMPLEADO" },
      { decision: "REJECTED" }, { companyId: id(90) }, { branchId: id(90) }, { approvedAt: "2026-11-02T00:00:00Z" }])
      expect(() => assertRecoveryReviewMatches(prepared, { ...approval(prepared), ...change }, input)).toThrow();
  });
  it("estado, evidencia, motivo y aprobación quedan ligados al mismo expediente", async () => {
    const input = await fixture(); const prepared = prepareSaleRecoveryReview(input);
    for (const modified of [
      { ...input, legacy: { ...input.legacy, updatedAt: "2026-11-05T00:00:00Z" } },
      { ...input, legacy: { ...input.legacy, quantitySold: "3" } },
      { ...input, reason: "Otro motivo que exige revisar de nuevo" },
      { ...input, evidence: [{ ...input.evidence[0], contentSha256: "b".repeat(64) }, ...input.evidence.slice(1)] },
    ]) expect(() => assertRecoveryReviewMatches(prepared, approval(prepared), modified)).toThrow(/cambió|coincide/i);
    expect(() => assertRecoveryReviewMatches(prepared, { ...approval(prepared), proposalHash: "b".repeat(64) }, input)).toThrow();
    const alteredDemand = prepareSaleRecoveryReview(input);
    alteredDemand.demand[0].quantity = "9.0000";
    expect(() => assertRecoveryReviewMatches(alteredDemand, approval(alteredDemand), input)).toThrow(/cambió/i);
    prepared.proposal.reason = "Alteración de la propuesta después de preparar";
    expect(() => assertRecoveryReviewMatches(prepared, approval(prepared), input)).toThrow();
  });
});
