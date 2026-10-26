import { describe, expect, it } from "vitest";
import { crearSnapshotAguinaldo } from "@/lib/services/aguinaldo-snapshot";
import type { AguinaldoPreview } from "@/lib/services/aguinaldo-payroll-service";

// Importes fijados por el oráculo de AGU-03A; no usar el calculador para esperarlos.
export function previewAutorizable(): AguinaldoPreview {
  return {
    companyId: "company", anioFiscal: 2025, fechaPago: "2026-01-31",
    fuenteRegla: "law-table", aguinaldoDaysMxn: 15, umaDailyCents: 11314,
    base: "REGISTERED", practiceMode: "FORMAL",
    rows: [{
      userId: "employee", name: "Empleado", rfc: "TEST010101AAA", branchId: "branch",
      salarioDiarioCents: 60000, salarioEfectivoCents: 60000, gapSalarioCents: 0, esFormal: true,
      diasCalendario: 365, diasLaborados: 365, fuenteDias: "MANUAL", diasAutomaticos: null,
      fechaAntiguedad: "2025-01-01", diferenciaCents: 0, calculoEfectivo: null,
      calculo: { anioFiscal: 2025, base: "REGISTERED", diasCalendario: 365, diasLaborados: 365,
        fuenteDias: "MANUAL", diasAguinaldo: 15, brutoCents: 900000, exentoCents: 339420,
        gravadoCents: 560580, exencionCapCents: 339420, aguinaldoDaysMxn: 15,
        estatusLegal: { fuente: "LEY_VIGENTE", basis: "Art. 87", diasLegalesVigente: 15 } },
      pago: { totalDeduccionesCents: 119731, netoCents: 780269,
        retencion: { retencionCents: 119731, ajusteSubsidioCausadoCents: 0, subsidioAplicadoCents: 0 } as AguinaldoPreview["rows"][number]["pago"]["retencion"] },
    }],
  } as AguinaldoPreview;
}

describe("AGU-03B.1 — snapshot autorizado", () => {
  it("conserva fecha civil, actor, ámbito y pago separado del año causado; sobrevive JSON", () => {
    const snapshot = crearSnapshotAguinaldo(previewAutorizable(), "actor", "branch");
    expect(JSON.parse(JSON.stringify(snapshot))).toMatchObject({
      cabecera: { version: 1, companyId: "company", anioFiscal: 2025, fechaPago: "2026-01-31", performedBy: "actor", branchId: "branch", base: "REGISTERED", umaDailyCents: 11314 },
      empleados: [{ userId: "employee", calculo: { brutoCents: 900000, exentoCents: 339420, gravadoCents: 560580 }, pago: { totalDeduccionesCents: 119731, netoCents: 780269 } }],
    });
  });

  it("desacopla la autorización de cambios posteriores en la preview", () => {
    const preview = previewAutorizable();
    const snapshot = crearSnapshotAguinaldo(preview, "actor");
    preview.rows[0].calculo!.brutoCents = 1;
    preview.rows[0].pago!.retencion.retencionCents = 1;
    expect(snapshot.empleados[0].calculo.brutoCents).toBe(900000);
    expect(snapshot.empleados[0].pago.retencion.retencionCents).toBe(119731);
  });

  it.each(["bruto", "neto", "retencion", "subsidio", "fraccion", "overflow", "rfc", "bloqueo", "fecha", "vacio", "duplicado", "rfcRepetido", "sucursal"])("rechaza autorización inválida: %s", (caso) => {
    const preview = previewAutorizable();
    const row = preview.rows[0];
    if (caso === "bruto") row.calculo!.gravadoCents++;
    if (caso === "neto") row.pago!.netoCents++;
    if (caso === "retencion") row.pago!.retencion.retencionCents++;
    if (caso === "subsidio") row.pago!.retencion.ajusteSubsidioCausadoCents = 1;
    if (caso === "fraccion") row.pago!.totalDeduccionesCents = 1.5;
    if (caso === "overflow") row.salarioDiarioCents = 2147483648;
    if (caso === "rfc") row.rfc = null;
    if (caso === "bloqueo") row.error = "Fuente fiscal no disponible";
    if (caso === "fecha") preview.fechaPago = "2026-02-29";
    if (caso === "vacio") preview.rows = [];
    if (caso === "duplicado") preview.rows.push(structuredClone(row));
    if (caso === "rfcRepetido") preview.rows.push({ ...structuredClone(row), userId: "employee2" });
    if (caso === "sucursal") row.branchId = "otra";
    expect(() => crearSnapshotAguinaldo(preview, "actor", "branch")).toThrow(RangeError);
  });

  it("conserva cero manual sin deducciones ficticias", () => {
    const preview = previewAutorizable();
    Object.assign(preview.rows[0].calculo!, { brutoCents: 0, exentoCents: 0, gravadoCents: 0, diasLaborados: 0, diasAguinaldo: 0 });
    Object.assign(preview.rows[0], { diasLaborados: 0 });
    Object.assign(preview.rows[0].pago!, { totalDeduccionesCents: 0, netoCents: 0 });
    preview.rows[0].pago!.retencion.retencionCents = 0;
    expect(crearSnapshotAguinaldo(preview, "actor").empleados[0]).toMatchObject({ diasLaborados: 0, fuenteDias: "MANUAL", pago: { netoCents: 0 } });
  });
});
