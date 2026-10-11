import { describe, expect, it } from "vitest";
import { buildShiftCsv } from "@/hooks/use-shift-export";
import { shiftCompleto } from "../../fixtures/tenant-isolation";

describe("CSV de turnos (C10.1)", () => {
  it("conserva sucursal, acentos, comas, comillas y saltos de línea", () => {
    const csv = buildShiftCsv([shiftCompleto({
      userName: 'María, "López"',
      branchName: "Café Centro",
      notes: "Primera línea\nSegunda línea",
    })]);
    expect(csv).toBe(
      '\uFEFFEmpleado,Sucursal,Rol,Fecha,Hora Inicio,Hora Fin,Estado,Notas\r\n' +
      '"María, ""López""","Café Centro","CAJERO","2026-03-16","07:00","15:00","DRAFT","Primera línea\nSegunda línea"'
    );
  });

  it.each(["=1+1", "+SUM(A1)", "-1+2", "@SUM(A1)", "\t=1", " \r=1"])(
    "exporta %j como texto para evitar fórmulas al abrirlo en una hoja",
    (notes) => {
      expect(buildShiftCsv([shiftCompleto({ notes })])).toContain(`"'${notes}"`);
    }
  );

  it("no añade filas y permite omitir los encabezados", () => {
    const csv = buildShiftCsv([shiftCompleto({ userName: "Ana" })], false);
    expect(csv).not.toContain("Empleado");
    expect(csv.split("\r\n")).toHaveLength(1);
    expect(csv).toContain('"Ana"');
  });

  it("rechaza un resultado vacío para que la pantalla pueda explicar la ausencia", () => {
    expect(() => buildShiftCsv([])).toThrow("No hay turnos para exportar");
  });
});
