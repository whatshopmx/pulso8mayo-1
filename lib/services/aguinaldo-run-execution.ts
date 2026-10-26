import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { payrollRuns, payrollPayslips, payrollAguinaldoDispersiones } from "@/lib/db/schema";
import { percepcionAguinaldo, timbrarNomina, type NominaTimbradoResult } from "./fiscal-service";
import { resolverFechaPagoAguinaldo } from "./aguinaldo-payment";

type Run = typeof payrollRuns.$inferSelect;
type Recibo = typeof payrollPayslips.$inferSelect;

/** Mismo bloqueo breve para todos los finalizadores; nunca abarca una llamada al PAC. */
async function conCorrida<T>(companyId: string, runId: string, work: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) {
  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(payrollRuns).where(and(eq(payrollRuns.id, runId), eq(payrollRuns.companyId, companyId))).for("update").limit(1);
    if (!run) throw new RangeError("Corrida no encontrada en esta empresa.");
    return work(tx);
  });
}

async function guardarRecibo(companyId: string, runId: string, pendiente: Recibo, timbre: Partial<NominaTimbradoResult>) {
  return conCorrida(companyId, runId, async (tx) => {
    const [actual] = await tx.select().from(payrollPayslips).where(and(eq(payrollPayslips.id, pendiente.id), eq(payrollPayslips.runId, runId))).limit(1);
    if (!actual) throw new RangeError("Recibo autorizado no encontrado.");
    if (actual.cfdiStatus === "TIMBRADO" && actual.cfdiUuid) return actual;
    const [guardado] = await tx.update(payrollPayslips).set({ cfdiStatus: timbre.status ?? "ERROR",
      cfdiUuid: timbre.uuid || null, selloDigital: timbre.selloDigital || null, updatedAt: new Date(),
    }).where(and(eq(payrollPayslips.id, actual.id), eq(payrollPayslips.runId, runId))).returning();
    return guardado;
  });
}

async function asegurarBitacora(companyId: string, run: Run, recibo: Recibo) {
  const auth = run.aguinaldoSnapshot!;
  const row = recibo.aguinaldoSnapshot!;
  if (auth.base !== "EFFECTIVE" || row.diferenciaCents <= 0) return;
  await conCorrida(companyId, run.id, async (tx) => {
    const existentes = await tx.select().from(payrollAguinaldoDispersiones).where(and(
      eq(payrollAguinaldoDispersiones.companyId, companyId), eq(payrollAguinaldoDispersiones.runId, run.id),
      eq(payrollAguinaldoDispersiones.userId, row.userId), eq(payrollAguinaldoDispersiones.source, "RUN")));
    if (existentes.length) {
      if (existentes.length !== 1 || existentes[0].montoCents !== row.diferenciaCents) throw new RangeError("Bitácora existente inconsistente: requiere conciliación.");
      return;
    }
    await tx.insert(payrollAguinaldoDispersiones).values({ companyId, runId: run.id, userId: row.userId,
      source: "RUN", anioFiscal: auth.anioFiscal, montoCents: row.diferenciaCents, performedBy: auth.performedBy,
      motivo: `Excedente autorizado de aguinaldo ${auth.anioFiscal} sobre salario efectivo. Registro fuera del CFDI; esta bitácora no confirma pago ni conciliación bancaria.`,
    });
  });
}

async function actualizarEstado(companyId: string, run: Run) {
  return conCorrida(companyId, run.id, async (tx) => {
    const slips = await tx.select().from(payrollPayslips).where(eq(payrollPayslips.runId, run.id));
    const audit = await tx.select().from(payrollAguinaldoDispersiones).where(and(
      eq(payrollAguinaldoDispersiones.companyId, companyId), eq(payrollAguinaldoDispersiones.runId, run.id), eq(payrollAguinaldoDispersiones.source, "RUN")));
    const completo = slips.length > 0 && slips.every((slip) => {
      const row = slip.aguinaldoSnapshot;
      const entries = audit.filter((entry) => entry.userId === slip.userId);
      return slip.cfdiStatus === "TIMBRADO" && !!slip.cfdiUuid && !!row &&
        (run.aguinaldoSnapshot!.base !== "EFFECTIVE" || row.diferenciaCents === 0 || (entries.length === 1 && entries[0].montoCents === row.diferenciaCents));
    });
    const status = completo ? "COMPLETED" : "COMPLETED_WITH_ERRORS";
    await tx.update(payrollRuns).set({ status, updatedAt: new Date() }).where(and(eq(payrollRuns.id, run.id), eq(payrollRuns.companyId, companyId)));
    return status;
  });
}

/** Único consumidor de autorizaciones persistidas, tanto para ejecución inicial como recuperación. */
export async function recuperarAguinaldoRun(companyId: string, runId: string) {
  const [run] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.id, runId), eq(payrollRuns.companyId, companyId))).limit(1);
  if (!run) throw new RangeError("Corrida no encontrada en esta empresa.");
  const auth = run.aguinaldoSnapshot;
  if (!auth || auth.version !== 1 || auth.companyId !== companyId || auth.anioFiscal !== run.aguinaldoFiscalYear
    || run.periodStart !== `${auth.anioFiscal}-01-01` || run.periodEnd !== `${auth.anioFiscal}-12-31`) throw new RangeError("Falta snapshot de autorización válido: no se reconstruye con datos actuales.");
  resolverFechaPagoAguinaldo(auth.fechaPago);
  const pendientes = await db.select().from(payrollPayslips).where(eq(payrollPayslips.runId, runId));
  if (!pendientes.length) throw new RangeError("La corrida no contiene recibos autorizados.");
  for (const slip of pendientes) {
    const row = slip.aguinaldoSnapshot;
    if (!row || row.version !== 1 || row.userId !== slip.userId || row.calculo.brutoCents !== slip.totalPercepcionesCents
      || row.pago.totalDeduccionesCents !== slip.totalDeduccionesCents || row.calculo.brutoCents !== row.calculo.exentoCents + row.calculo.gravadoCents
      || row.pago.netoCents !== row.calculo.brutoCents - row.pago.totalDeduccionesCents) throw new RangeError("Snapshot del recibo inconsistente: requiere revisión.");
  }
  const results: Array<{ success: boolean; userId: string; employeeName: string; payslip?: Recibo; error?: string }> = [];
  for (const pendiente of pendientes) {
    const row = pendiente.aguinaldoSnapshot!;
    let timbre: Partial<NominaTimbradoResult> | undefined;
    try {
      if (pendiente.cfdiStatus !== "TIMBRADO" || !pendiente.cfdiUuid) {
        if (auth.deliveryVersion !== 1) throw new RangeError("Esta corrida es anterior al protocolo de envío durable. Concilia su comprobante con el proveedor antes de autorizar otro envío.");
        timbre = await timbrarNomina({ companyId, performedBy: auth.performedBy, empleadoRfc: row.rfc,
          empleadoNombre: row.name, empleadoFechaContratacion: row.fechaAntiguedad ?? undefined,
          empleadoSalarioDiarioCents: row.salarioDiarioCents, periodo: `${auth.anioFiscal}-AGU`, payrollTypeCode: "E",
          fechaPagoInicial: run.periodStart, fechaPagoFinal: run.periodEnd, fechaPago: auth.fechaPago,
          desglosePercepciones: [percepcionAguinaldo(row.calculo.brutoCents, row.calculo.exentoCents)],
          totalPercepciones: row.calculo.brutoCents, totalDeducciones: row.pago.totalDeduccionesCents,
          desgloseDeducciones: row.pago.totalDeduccionesCents > 0 ? [{ deductionTypeCode: "002", code: "002",
            concept: `ISR retenido del aguinaldo ${auth.anioFiscal} (Art. 174 RLISR)`, amount: row.pago.totalDeduccionesCents }] : undefined,
        });
      } else timbre = { status: "TIMBRADO", uuid: pendiente.cfdiUuid, selloDigital: pendiente.selloDigital ?? "" };
      const confirmado = timbre.status === "TIMBRADO" && !!timbre.uuid;
      const payslip = await guardarRecibo(companyId, runId, pendiente, confirmado ? timbre : { status: timbre.status === "TIMBRADO" ? "ERROR" : timbre.status });
      if (payslip.cfdiStatus !== "TIMBRADO" || !payslip.cfdiUuid) throw new Error(`Timbre no confirmado: ${payslip.cfdiStatus}. Si el envío es incierto, concilia con el proveedor antes de emitir otro.`);
      await asegurarBitacora(companyId, run, payslip);
      results.push({ success: true, userId: row.userId, employeeName: row.name, payslip });
    } catch (error) {
      // Conservar la emisión confirmada aunque falle el recibo o su bitácora.
      if (!timbre) await guardarRecibo(companyId, runId, pendiente, { status: "ERROR" });
      results.push({ success: false, userId: row.userId, employeeName: row.name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const status = await actualizarEstado(companyId, run);
  return { runId, fechaPago: auth.fechaPago, anioFiscal: auth.anioFiscal, status, results };
}
