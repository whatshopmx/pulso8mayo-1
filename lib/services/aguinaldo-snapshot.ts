import type { AguinaldoPreview, AguinaldoPreviewRow } from "./aguinaldo-payroll-service";
import type { AguinaldoCalculo } from "./aguinaldo-service";
import type { AguinaldoPago } from "./aguinaldo-payment";
import { resolverFechaPagoAguinaldo } from "./aguinaldo-payment";

/** Autorización de esta ejecución. No es constancia de pago ni de timbrado. */
export interface AguinaldoSnapshotCabecera {
  version: 1;
  companyId: string;
  anioFiscal: number;
  fechaPago: string;
  branchId: string | null;
  performedBy: string;
  authorizedAt: string;
  base: AguinaldoPreview["base"];
  practiceMode: AguinaldoPreview["practiceMode"];
  fuenteRegla: AguinaldoPreview["fuenteRegla"];
  aguinaldoDaysMxn: number;
  umaDailyCents: number;
  calculoVersion: "AGU-02C-ART174-v1";
  /** Sólo las corridas creadas con intención fiscal durable pueden iniciar envíos al recuperarse. */
  deliveryVersion?: 1;
}

export type AguinaldoEmpleadoSnapshot = Pick<AguinaldoPreviewRow,
  "userId" | "name" | "branchId" | "salarioDiarioCents" | "salarioEfectivoCents" |
  "fechaAntiguedad" | "diasLaborados" | "fuenteDias" | "diasAutomaticos" | "propuestaDias" |
  "calculoEfectivo" | "diferenciaCents"
> & { version: 1; rfc: string; calculo: AguinaldoCalculo; pago: AguinaldoPago };

function centavos(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 2147483647;
}

/** Copia validada y serializable; no consulta ni recalcula fuentes vivas. */
export function crearSnapshotAguinaldo(preview: AguinaldoPreview, performedBy: string, branchId?: string) {
  resolverFechaPagoAguinaldo(preview.fechaPago);
  if (!performedBy || !preview.companyId || !Number.isInteger(preview.anioFiscal)
    || preview.anioFiscal < 1970 || preview.anioFiscal > 2200 || !preview.rows.length
    || !centavos(preview.umaDailyCents!) || !preview.umaDailyCents) {
    throw new RangeError("Autorización de aguinaldo incompleta.");
  }
  const usuarios = new Set<string>();
  const rfcs = new Set<string>();
  const empleados: AguinaldoEmpleadoSnapshot[] = preview.rows.map((row) => {
    const c = row.calculo;
    const p = row.pago;
    const rfc = row.rfc?.trim().toUpperCase();
    if (row.error || !row.userId || !rfc || !c || !p || usuarios.has(row.userId) || rfcs.has(rfc)
      || (branchId && row.branchId !== branchId)
      || ![row.salarioDiarioCents, row.salarioEfectivoCents, row.diferenciaCents,
        c.brutoCents, c.exentoCents, c.gravadoCents, p.totalDeduccionesCents, p.netoCents].every(centavos)
      || c.brutoCents !== c.exentoCents + c.gravadoCents
      || p.netoCents !== c.brutoCents - p.totalDeduccionesCents
      || p.totalDeduccionesCents !== p.retencion.retencionCents
      || p.retencion.ajusteSubsidioCausadoCents !== 0 || p.retencion.subsidioAplicadoCents !== 0
      || !Number.isInteger(row.diasLaborados) || row.diasLaborados < 0 || row.diasLaborados > 366
      || c.diasLaborados !== row.diasLaborados || c.anioFiscal !== preview.anioFiscal || c.base !== "REGISTERED") {
      throw new RangeError(`Snapshot de aguinaldo inválido para ${row.name}: identidades, ámbito o importes inconsistentes.`);
    }
    usuarios.add(row.userId); rfcs.add(rfc);
    return structuredClone({
      version: 1, userId: row.userId, name: row.name, rfc, branchId: row.branchId,
      salarioDiarioCents: row.salarioDiarioCents, salarioEfectivoCents: row.salarioEfectivoCents,
      fechaAntiguedad: row.fechaAntiguedad, diasLaborados: row.diasLaborados,
      fuenteDias: row.fuenteDias, diasAutomaticos: row.diasAutomaticos, propuestaDias: row.propuestaDias,
      calculo: c, calculoEfectivo: row.calculoEfectivo, pago: p, diferenciaCents: row.diferenciaCents,
    });
  });
  const cabecera: AguinaldoSnapshotCabecera = {
    version: 1, companyId: preview.companyId, anioFiscal: preview.anioFiscal, fechaPago: preview.fechaPago,
    branchId: branchId ?? null, performedBy, authorizedAt: new Date().toISOString(),
    base: preview.base, practiceMode: preview.practiceMode, fuenteRegla: preview.fuenteRegla,
    aguinaldoDaysMxn: preview.aguinaldoDaysMxn, umaDailyCents: preview.umaDailyCents!,
    calculoVersion: "AGU-02C-ART174-v1",
    deliveryVersion: 1,
  };
  return { cabecera, empleados };
}
