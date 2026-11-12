import { describe, expect, it } from "vitest";
import { normalizeSaleConsumptionIdentity, saleConsumptionIdentityKey, soldQuantity, nextSaleConsumptionRevision } from "../sale-consumption-contract";

const identity = { companyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", branchId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", source: " POS:MAIN ", productKey: " SKU-42 ", saleDay: "2026-11-11" };

describe("INV-01.a1: identidad y revisión de venta consumida", () => {
  it("normaliza empresa/sucursal/fuente pero conserva mayúsculas del identificador externo", () => {
    expect(normalizeSaleConsumptionIdentity({ ...identity, companyId: identity.companyId.toUpperCase() })).toEqual({ ...identity, source: "pos:main", productKey: "SKU-42" });
  });
  it("la identidad distingue empresa, sucursal, fuente, producto y fecha", () => {
    const original = saleConsumptionIdentityKey(identity);
    for (const changes of [{ companyId: identity.branchId }, { branchId: identity.companyId }, { source: "pos:other" }, { productKey: "sku-42" }, { saleDay: "2026-11-12" }]) {
      expect(saleConsumptionIdentityKey({ ...identity, ...changes })).not.toBe(original);
    }
    expect(saleConsumptionIdentityKey({ ...identity, source: "pos:main", productKey: "SKU-42" })).toBe(original);
  });
  it("no usa la receta como identidad del producto ni admite colisiones por separadores", () => {
    expect(JSON.parse(saleConsumptionIdentityKey({ ...identity, productKey: 'A|B:"C"' }))).toEqual([identity.companyId, identity.branchId, "pos:main", 'A|B:"C"', identity.saleDay]);
  });
  it.each([{ companyId: "" }, { branchId: "not-uuid" }, { source: "" }, { source: "POS MAIN" }, { productKey: " " }, { productKey: "A\u0000B" }, { productKey: "x".repeat(257) }, { saleDay: "2026-02-29" }, { saleDay: "2026-11-11T00:00:00Z" }, { saleDay: "0000-01-01" }])("rechaza identidad inválida %j", changes => {
    expect(() => normalizeSaleConsumptionIdentity({ ...identity, ...changes })).toThrow();
  });
  it("conserva el día civil, incluido bisiesto, sin conversión de zona horaria", () => {
    expect(normalizeSaleConsumptionIdentity({ ...identity, saleDay: "2024-02-29" }).saleDay).toBe("2024-02-29");
  });
  it.each([["0", "0.00"], ["00010.5", "10.50"], ["99999999.99", "99999999.99"]])("normaliza %s a precisión de venta sin redondear", (input, expected) => {
    expect(soldQuantity(input)).toBe(expected);
  });
  it.each(["", "-1", "NaN", "Infinity", "1e2", "1.001", "100000000.00"])("rechaza cantidad incompleta/inexacta %s", input => {
    expect(() => soldQuantity(input)).toThrow();
  });
  it("conserva cantidad previa y secuencia exacta para 10→12→8→0", () => {
    const initial = nextSaleConsumptionRevision(null, "10");
    expect(initial).toEqual({ revision: 1, previousRevision: null, previousQuantitySold: "0.00", quantitySold: "10.00" });
    const increase = nextSaleConsumptionRevision(initial, "12");
    expect(increase).toEqual({ revision: 2, previousRevision: 1, previousQuantitySold: "10.00", quantitySold: "12.00" });
    const decrease = nextSaleConsumptionRevision(increase, "8");
    expect(decrease.previousQuantitySold).toBe("12.00");
    expect(nextSaleConsumptionRevision(decrease, "0")).toEqual({ revision: 4, previousRevision: 3, previousQuantitySold: "8.00", quantitySold: "0.00" });
  });
  it("rechaza un head inválido o que excede integer PostgreSQL", () => {
    for (const revision of [0, -1, 1.5, 2147483647]) expect(() => nextSaleConsumptionRevision({ revision, quantitySold: "10.00" }, "12")).toThrow();
    expect(() => nextSaleConsumptionRevision({ revision: 1, quantitySold: "unknown" }, "12")).toThrow();
  });
  it("un estado previo desconocido o incompleto no se convierte en consumo cero", () => {
    expect(() => nextSaleConsumptionRevision(undefined as never, "12")).toThrow();
    expect(() => nextSaleConsumptionRevision({ revision: 1 } as never, "12")).toThrow();
    expect(() => nextSaleConsumptionRevision({ revision: 1, quantitySold: null } as never, "12")).toThrow();
  });
});
