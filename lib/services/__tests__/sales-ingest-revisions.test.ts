import { describe, expect, it } from "vitest";
import { buildRows } from "../sales-ingest-pure";
import { planSalesImport } from "../sales-ingest-plan";

const mapping = { recipeRef: "Producto", quantitySold: "Cantidad", saleDate: "Fecha", totalRevenue: "Importe" };
const header = "Producto,Cantidad,Fecha,Importe\n";

describe("INV-01.b4a: entrada exacta de revisiones de venta", () => {
  it("acepta cantidad cero e importe cero explícitos para anular", () => {
    expect(buildRows(header + "Taco,0,2026-11-12,0", mapping)).toEqual({ rows: [{ rowNumber: 2, recipeRef: "Taco", quantitySold: 0, saleDay: "2026-11-12", totalRevenueCents: 0 }], errors: [] });
  });
  it("no redondea una cantidad con precisión superior a la venta", () => {
    const result = buildRows(header + "Taco,1.005,2026-11-12,10", mapping);
    expect(result.rows).toEqual([]); expect(result.errors).toHaveLength(1);
  });
  it("rechaza días civiles imposibles y distingue un bisiesto válido", () => {
    expect(buildRows(header + "Taco,1,2026-02-30,10", mapping).rows).toEqual([]);
    expect(buildRows(header + "Taco,1,2024-02-29,10", mapping).rows[0].saleDay).toBe("2024-02-29");
  });
  it("rechaza importe malformado, negativo, fuera de rango o con fracción de centavo", () => {
    for (const amount of ["garbage", "-1", "0.001", "21474836.48"]) {
      const result = buildRows(header + `Taco,1,2026-11-12,${amount}`, mapping);
      expect(result.rows, amount).toEqual([]); expect(result.errors, amount).toHaveLength(1);
    }
  });
  it("conserva null cuando el importe no se reportó y no lo confunde con cero", () => {
    const result = buildRows("Producto,Cantidad\nTaco,1", { recipeRef: "Producto", quantitySold: "Cantidad" }, { defaultDay: "2026-11-12" });
    expect(result.rows[0]).toMatchObject({ quantitySold: 1, totalRevenueCents: null });
    expect(result.errors).toEqual([]);
  });
  it("si una línea es inválida no importa un total parcial del mismo producto/día", () => {
    const result = buildRows(header + "Taco,3,2026-11-12,30\nTaco,bad,2026-11-12,20\nOther,2,2026-11-12,20", mapping);
    expect(result.rows.map(row => row.recipeRef)).toEqual(["Other"]);
    expect(result.errors.map(row => row.rowNumber).sort()).toEqual([2, 3]);
  });
  it("un encabezado de importe seleccionado pero ausente no se trata como no reportado", () => {
    const result = buildRows("Producto,Cantidad,Fecha\nTaco,1,2026-11-12", mapping);
    expect(result.rows).toEqual([]); expect(result.errors).toHaveLength(1);
  });
  it("no pierde decimales significativos al convertir texto a Number", () => {
    for (const quantity of ["1.00000000000000001", "1e1", "1.2.3", "1,2,3"]) {
      expect(buildRows(header + `Taco,\"${quantity}\",2026-11-12,10`, mapping).rows, quantity).toEqual([]);
    }
  });
  it("una fecha mapeada ausente o malformada no permite un total parcial", () => {
    expect(buildRows("Producto,Cantidad\nTaco,1", mapping, { defaultDay: "2026-11-12" }).rows).toEqual([]);
    const result = buildRows(header + "Taco,1,2026-11-12,10\nTaco,1,2026-02-30,10", mapping);
    expect(result.rows).toEqual([]);
    expect(buildRows(header + "Taco,1,2026-11-12junk,10", mapping).rows).toEqual([]);
  });
  it("acepta números locales con agrupación válida", () => {
    const result = buildRows('Producto;Cantidad;Fecha;Importe\nTaco;1.234,50;12/11/2026;$1,234.50', mapping);
    expect(result.rows[0]).toMatchObject({ quantitySold: 1234.5, totalRevenueCents: 123450 });
  });
  it("mapea claves de producto opacas sin fusionar mayúsculas", () => {
    const result = buildRows('Producto,Cantidad,SKU\nTaco,1,A\nTaco,bad,a', { recipeRef: "Producto", quantitySold: "Cantidad", productKey: "SKU" }, { defaultDay: "2026-11-12" });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].productKey).toBe("A");
  });
  it("una línea identificada por SKU sin receta ni cantidad invalida su grupo", () => {
    const result = buildRows('Producto,Cantidad,SKU\nTaco,1,A\n,,A', { recipeRef: "Producto", quantitySold: "Cantidad", productKey: "SKU" }, { defaultDay: "2026-11-12" });
    expect(result.rows).toEqual([]);
    expect(result.errors.map(error => error.rowNumber).sort()).toEqual([2, 3]);
  });
  it("exige la columna de fecha seleccionada y precisión monetaria textual", () => {
    expect(buildRows('Producto,Cantidad\nTaco,1', { recipeRef: "Producto", quantitySold: "Cantidad", saleDate: "Fecha" }, { defaultDay: "2026-11-12" }).rows).toEqual([]);
    expect(buildRows(header + 'Taco,1,2026-11-12,1.00000000000000001', mapping).rows).toEqual([]);
  });
});

describe("INV-01.b4a: plan de importación sin escrituras", () => {
  const row = (rowNumber: number, quantitySold: number, totalRevenueCents: number | null = 10) => ({ rowNumber, recipeRef: "Taco", productKey: "SKU-1", quantitySold, totalRevenueCents, saleDay: "2026-11-12" });
  it("agrupa exactamente 0.1 + 0.2 y conserva todas las filas de origen", () => {
    expect(planSalesImport([row(2, 0.1), row(3, 0.2)])).toEqual({ groups: [{ productKey: "SKU-1", recipeRef: "Taco", saleDay: "2026-11-12", quantitySold: "0.30", totalRevenueCents: 20, rowNumbers: [2, 3] }], errors: [] });
  });
  it("no inventa cobertura monetaria al mezclar importe conocido y ausente", () => {
    expect(planSalesImport([row(2, 1), row(3, 1, null)]).groups[0].totalRevenueCents).toBeNull();
    expect(planSalesImport([row(2, 0, 0)]).groups[0]).toMatchObject({ quantitySold: "0.00", totalRevenueCents: 0 });
  });
  it("mantiene claves opacas diferentes aun con la misma receta", () => {
    expect(planSalesImport([row(2, 1), { ...row(3, 1), productKey: "sku-1" }]).groups).toHaveLength(2);
  });
  it("rechaza todo el grupo si contiene cantidades inválidas, overflow o recetas incompatibles", () => {
    for (const bad of [{ ...row(3, 1), quantitySold: 0.001 }, row(3, 99999999.99), { ...row(3, 1), recipeRef: "Other" }, row(3, 1, 2147483647)]) {
      const result = planSalesImport([row(2, 1), bad, { ...row(4, 2), productKey: "other" }]);
      expect(result.groups.map(group => group.productKey)).toEqual(["other"]);
      expect(result.errors.map(error => error.rowNumber).sort()).toEqual([2, 3]);
    }
  });
  it("valida entradas directas y vacías sin depender del CSV", () => {
    expect(planSalesImport([])).toEqual({ groups: [], errors: [] });
    expect(planSalesImport([{ ...row(2, 1), saleDay: "2026-02-30" }]).groups).toEqual([]);
    expect(planSalesImport([{ ...row(2, 1), totalRevenueCents: 1.1 }]).groups).toEqual([]);
  });
});
