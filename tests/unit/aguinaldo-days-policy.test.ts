import { describe, expect, it } from "vitest";
import { proponerDiasAguinaldo } from "@/lib/services/aguinaldo-days-policy";

const annual = { anioFiscal: 2026, fechaAntiguedad: "2025-01-01", fechaCorte: "2026-10-26", zona: "America/Mexico_City" };
describe("DIA-01: contrato de calendario y ausencias aprobadas", () => {
  it("un turno aislado no convierte el resto del año en faltas", () => {
    expect(proponerDiasAguinaldo({ ...annual, diasConTurno: ["2026-02-01"] })).toMatchObject({
      diasCalendario: 365, diasPropuestos: 365, diasUsados: 365, diasConTurno: 1, contieneProyeccion: true,
    });
  });
  it("vacaciones, descanso, festivo y licencia protegida no reducen el calendario", () => {
    expect(proponerDiasAguinaldo({ ...annual, ausencias: [
      { id: "vacaciones", desde: "2026-01-10", hasta: "2026-01-20", aprobada: true, tratamiento: "COMPUTABLE" },
      { id: "maternidad", desde: "2026-04-01", hasta: "2026-06-30", aprobada: true, tratamiento: "COMPUTABLE" },
    ] })).toMatchObject({ diasPropuestos: 365, diasNoComputables: 0, requiereRevision: false });
  });
  it("ausencias no computables se unen, se acotan a vigencia y sólo cuentan aprobadas", () => {
    expect(proponerDiasAguinaldo({ ...annual, fechaAntiguedad: "2026-07-01", ausencias: [
      { id: "sin-goce", desde: "2026-06-29", hasta: "2026-07-03", aprobada: true, tratamiento: "NO_COMPUTABLE" },
      { id: "otra", desde: "2026-07-02", hasta: "2026-07-04", aprobada: true, tratamiento: "NO_COMPUTABLE" },
      { id: "pendiente", desde: "2026-08-01", hasta: "2026-08-31", aprobada: false, tratamiento: "NO_COMPUTABLE" },
    ] })).toMatchObject({ diasCalendario: 184, diasNoComputables: 4, diasPropuestos: 180 });
  });
  it.each([0, 200])("el ajuste manual %s prevalece incluso con una clasificación pendiente", (manual) => {
    expect(proponerDiasAguinaldo({ ...annual, manual, ausencias: [
      { id: "incapacidad-sin-clasificar", desde: "2026-03-01", hasta: "2026-03-10", aprobada: true, tratamiento: "REVISAR" },
    ] })).toMatchObject({ diasUsados: manual, fuente: "MANUAL", requiereRevision: false,
      pendientes: ["incapacidad-sin-clasificar"] });
  });
  it("una clasificación pendiente no autoriza descontar ni presentar un conteo definitivo", () => {
    const ausencia = { id: "permiso:123", desde: "2026-03-01", hasta: "2026-03-10", aprobada: true, tratamiento: "REVISAR" as const };
    expect(proponerDiasAguinaldo({ ...annual, ausencias: [ausencia] })).toMatchObject({ diasUsados: 365,
      requiereRevision: true, pendientes: [ausencia.id], ausencias: [ausencia], fechasNoComputables: [] });
  });
  it("el conflicto entre permiso protegido y exclusión requiere revisión sin descontar ese día", () => {
    expect(proponerDiasAguinaldo({ ...annual, ausencias: [
      { id: "riesgo-trabajo", desde: "2026-05-01", hasta: "2026-05-01", aprobada: true, tratamiento: "COMPUTABLE" },
      { id: "falta", desde: "2026-05-01", hasta: "2026-05-01", aprobada: true, tratamiento: "NO_COMPUTABLE" },
    ] })).toMatchObject({ diasPropuestos: 365, requiereRevision: true, conflictos: ["2026-05-01"] });
  });
  it("recorta por baja y distingue un año bisiesto sin depender de la zona del proceso", () => {
    expect(proponerDiasAguinaldo({ ...annual, anioFiscal: 2024, fechaAntiguedad: "2024-01-01",
      fechaBaja: "2024-12-31", fechaCorte: "2026-10-26" })).toMatchObject({ diasCalendario: 366, contieneProyeccion: false });
    expect(proponerDiasAguinaldo({ ...annual, fechaBaja: "2026-06-30" }).diasCalendario).toBe(181);
  });
  it.each([{ fechaCorte: "2026-02-30" }, { zona: "desconocida" }, { manual: -1 }, { manual: 0.5 }])("rechaza metadatos inválidos %j", (input) => {
    expect(() => proponerDiasAguinaldo({ ...annual, ...input })).toThrow();
  });
});
