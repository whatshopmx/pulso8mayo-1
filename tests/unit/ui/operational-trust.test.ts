import { describe, expect, it } from "vitest";
import { observedPercent } from "@/lib/ui/observed-percent";
import { isSidebarSectionVisible } from "@/lib/ui/sidebar-visibility";

describe("indicadores basados en evidencia", () => {
  it("no convierte muestras vacías o inválidas en cumplimiento", () => {
    expect(observedPercent(0, 0)).toBeNull();
    expect(observedPercent(0, "0")).toBeNull();
    expect(observedPercent(null, null)).toBeNull();
    expect(observedPercent(1, NaN)).toBeNull();
  });
  it("distingue cero observado de ausencia de muestra", () => {
    expect(observedPercent(0, 4)).toBe(0);
    expect(observedPercent("3", "4")).toBe(75);
    expect(observedPercent(4, 4)).toBe(100);
  });
});

describe("visibilidad de secciones por rutas estables", () => {
  it("mantiene Comando disponible para lectura aunque cambie su título", () => {
    expect(isSidebarSectionVisible("READONLY", "/dashboard")).toBe(true);
    expect(isSidebarSectionVisible("READONLY", "/dashboard/compliance")).toBe(true);
    expect(isSidebarSectionVisible("READONLY", "/dashboard/performance")).toBe(true);
    expect(isSidebarSectionVisible("READONLY", "/dashboard/company")).toBe(false);
  });
  it("preserva las restricciones de empleados y responsables de sucursal", () => {
    expect(isSidebarSectionVisible("EMPLEADO", "/dashboard/workflows")).toBe(true);
    expect(isSidebarSectionVisible("EMPLEADO", "/dashboard")).toBe(false);
    expect(isSidebarSectionVisible("GERENTE", "/dashboard/company")).toBe(false);
    expect(isSidebarSectionVisible("SUPERVISOR", "/dashboard/company")).toBe(false);
    expect(isSidebarSectionVisible("ADMIN", "/dashboard/company")).toBe(true);
  });
});
