import "dotenv/config";
import { payrollRuns, payrollPayslips } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { previsualizarAguinaldo } from "@/lib/services/aguinaldo-payroll-service";
import { crearSnapshotAguinaldo } from "@/lib/services/aguinaldo-snapshot";
import { seedDate } from "./seed-scenarios";
import { refreshSeedKpis } from "./seed-07-compliance-kpi";
import { COMPANY_ID, USER_ADMIN } from "./seed-constants";

export async function main() {
  console.log("=== Phase 20: Aguinaldo auditable pendiente y mediciones actuales ===");
  const anioFiscal = seedDate().getUTCFullYear();
  const exists = await withCompanyContext({ companyId: COMPANY_ID }, (tx) => tx.select({ id: payrollRuns.id })
    .from(payrollRuns).where(and(eq(payrollRuns.companyId, COMPANY_ID), eq(payrollRuns.aguinaldoFiscalYear, anioFiscal))).limit(1));
  if (!exists.length) {
    const preview = await previsualizarAguinaldo(COMPANY_ID, anioFiscal, undefined, {
      fechaPago: seedDate().toISOString().slice(0, 10),
    });
    const ready = preview.rows.filter((row) => !row.error && row.rfc && row.calculo && row.pago);
    for (const row of preview.rows.filter((row) => !ready.includes(row))) {
      console.log(`Aguinaldo demo por revisar (${row.name}): ${row.error ?? "Falta identidad o cálculo de pago"}`);
    }
    if (!ready.length) throw new Error("No hay cálculos de aguinaldo listos; revisa los bloqueos del servicio antes de sembrar snapshots.");
    const snapshot = crearSnapshotAguinaldo({ ...preview, rows: ready }, USER_ADMIN);
    // Ejemplo de cálculo conservado, NO autorización de envío fiscal. Sin
    // deliveryVersion el recuperador rechaza iniciar solicitudes al PAC.
    delete snapshot.cabecera.deliveryVersion;
    await withCompanyContext({ companyId: COMPANY_ID, actorId: USER_ADMIN }, async (tx) => {
      const [run] = await tx.insert(payrollRuns).values({ companyId: COMPANY_ID,
        periodStart: `${anioFiscal}-01-01`, periodEnd: `${anioFiscal}-12-31`, status: "DRAFT",
        aguinaldoFiscalYear: anioFiscal, aguinaldoSnapshot: snapshot.cabecera,
      }).onConflictDoNothing().returning();
      if (!run) return;
      await tx.insert(payrollPayslips).values(snapshot.empleados.map((row) => ({
        runId: run.id, userId: row.userId, aguinaldoSnapshot: row,
        aguinaldoCents: row.calculo.brutoCents, totalPercepcionesCents: row.calculo.brutoCents,
        totalDeduccionesCents: row.pago.totalDeduccionesCents, cfdiStatus: "PENDIENTE",
      })));
    });
  }
  await refreshSeedKpis();
}
