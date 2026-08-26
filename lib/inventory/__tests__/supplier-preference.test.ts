// Proveedor principal vs alterno por insumo (loteprod §4): reordenamiento puro.
import { describe, expect, it } from "vitest";
import {
  preferenceRankLabel,
  ranksAfterPromotion,
  sortByPreference,
} from "../supplier-preference";

describe("sortByPreference", () => {
  it("rangueados por número y sin clasificar al final", () => {
    const orden = sortByPreference([
      { supplierId: "c", preferenceRank: null },
      { supplierId: "b", preferenceRank: 2 },
      { supplierId: "a", preferenceRank: 1 },
    ]).map((r) => r.supplierId);
    expect(orden).toEqual(["a", "b", "c"]);
  });

  it("no muta la lista original", () => {
    const original = [
      { supplierId: "b", preferenceRank: 2 },
      { supplierId: "a", preferenceRank: 1 },
    ];
    sortByPreference(original);
    expect(original[0].supplierId).toBe("b");
  });
});

describe("ranksAfterPromotion", () => {
  it("promueve al alterno y degrada al principal anterior", () => {
    const cambios = ranksAfterPromotion(
      [
        { supplierId: "a", preferenceRank: 1 },
        { supplierId: "b", preferenceRank: 2 },
      ],
      "b"
    );
    expect(cambios).toEqual([
      { supplierId: "b", preferenceRank: 1 },
      { supplierId: "a", preferenceRank: 2 },
    ]);
  });

  it("promover al que ya es principal no cambia nada", () => {
    const cambios = ranksAfterPromotion(
      [
        { supplierId: "a", preferenceRank: 1 },
        { supplierId: "b", preferenceRank: 2 },
      ],
      "a"
    );
    expect(cambios).toEqual([]);
  });

  it("promover a uno sin clasificar lo vuelve principal y recorre a los demás", () => {
    const cambios = ranksAfterPromotion(
      [
        { supplierId: "a", preferenceRank: 1 },
        { supplierId: "b", preferenceRank: 2 },
        { supplierId: "c", preferenceRank: null },
      ],
      "c"
    );
    expect(cambios).toEqual([
      { supplierId: "c", preferenceRank: 1 },
      { supplierId: "a", preferenceRank: 2 },
      { supplierId: "b", preferenceRank: 3 },
    ]);
  });

  it("los sin clasificar siguen sin clasificar", () => {
    const cambios = ranksAfterPromotion(
      [
        { supplierId: "a", preferenceRank: 1 },
        { supplierId: "z", preferenceRank: null },
      ],
      "a"
    );
    expect(cambios).toEqual([]);
  });

  it("densifica huecos de numeración (1, 5, 9 → 1, 2, 3)", () => {
    const cambios = ranksAfterPromotion(
      [
        { supplierId: "a", preferenceRank: 1 },
        { supplierId: "b", preferenceRank: 5 },
        { supplierId: "c", preferenceRank: 9 },
      ],
      "b"
    );
    expect(cambios).toEqual([
      { supplierId: "b", preferenceRank: 1 },
      { supplierId: "a", preferenceRank: 2 },
      { supplierId: "c", preferenceRank: 3 },
    ]);
  });

  it("proveedor que no estaba en la lista entra como principal", () => {
    const cambios = ranksAfterPromotion([{ supplierId: "a", preferenceRank: 1 }], "nuevo");
    expect(cambios).toEqual([
      { supplierId: "nuevo", preferenceRank: 1 },
      { supplierId: "a", preferenceRank: 2 },
    ]);
  });

  it("insumo sin proveedores: el promovido queda solo como principal", () => {
    expect(ranksAfterPromotion([], "a")).toEqual([{ supplierId: "a", preferenceRank: 1 }]);
  });
});

describe("preferenceRankLabel", () => {
  it("traduce rangos a lenguaje de compras", () => {
    expect(preferenceRankLabel(1)).toBe("Principal");
    expect(preferenceRankLabel(2)).toBe("Alterno 1");
    expect(preferenceRankLabel(3)).toBe("Alterno 2");
    expect(preferenceRankLabel(null)).toBe("Sin clasificar");
    expect(preferenceRankLabel(undefined)).toBe("Sin clasificar");
  });
});
