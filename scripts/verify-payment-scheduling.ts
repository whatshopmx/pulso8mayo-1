/** C19: datos propios de prueba, sin envíos ni pagos; limpieza incluso si falla la siembra. */
import { config } from "dotenv";
import { createHmac, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";

config({ quiet: true });

async function main() {
  const { db } = await import("@/lib/db");
  const { companies, branches, users, suppliers, supplierBankAccounts, invoices, paymentRuns, paymentRunItems, tenantKeys } = await import("@/lib/db/schema");
  const { TreasuryService } = await import("@/lib/services/treasury-service");
  const { DekService } = await import("@/lib/security/dek");
  const { encryptColumnWithDek } = await import("@/lib/security/column-cipher");
  const { computeClabeCheckDigit } = await import("@/lib/banking/clabe");
  const empresaA = randomUUID(), empresaB = randomUUID();
  const empresas = [empresaA, empresaB];
  const actor = randomUUID(), firmante = randomUUID();
  const marca = `C19 verificación ${randomUUID().slice(0, 8)}`;
  let comprobaciones = 0;
  function comprobar(ok: unknown, mensaje: string) {
    if (!ok) throw new Error(mensaje);
    comprobaciones++;
    console.log(`✓ ${mensaje}`);
  }
  async function rechaza(fn: () => Promise<unknown>, statusCode: number, motivo?: RegExp) {
    let error: unknown;
    try { await fn(); } catch (caught) { error = caught; }
    const fallo = error as { statusCode?: number; message?: string } | undefined;
    comprobar(fallo?.statusCode === statusCode && (!motivo || motivo.test(fallo.message ?? "")), `rechazo ${statusCode}${motivo ? ` ${motivo}` : ""}`);
  }
  try {
    await db.insert(companies).values(empresas.map((id, i) => ({ id, name: `${marca} ${i}` })));
    const [rama] = await db.insert(branches).values({ companyId: empresaA, name: marca, code: marca }).returning();
    await db.insert(users).values([actor, firmante].map((id, i) => ({ id, companyId: empresaA, name: `${marca} ${i}`, email: `${id}@pulso.test`, role: "ADMIN" as const, createdAt: new Date(), updatedAt: new Date() })));
    const [proveedor] = await db.insert(suppliers).values({ companyId: empresaA, name: marca }).returning();
    await DekService.ensureDek(empresaA);
    const dek = await DekService.getDek(empresaA);
    const base = "01218000000000001";
    const clabe = `${base}${computeClabeCheckDigit(base)}`;
    await db.insert(supplierBankAccounts).values({
      companyId: empresaA, supplierId: proveedor.id, clabe: encryptColumnWithDek(clabe, dek),
      clabeLast4: clabe.slice(-4), clabeFingerprint: createHmac("sha256", dek).update(clabe).digest("hex"),
      bankCode: "012", bankName: "Banco de prueba", accountHolderName: marca,
      registeredBy: actor, verifiedBy: firmante, verifiedAt: new Date(), status: "VERIFIED", active: true,
      verificationMethod: "TEST_FIXTURE", verificationEvidenceUrl: "local://c19/fixture",
    });
    const nuevaFactura = async (paymentStatus: "PENDING" | "PAID" | "CANCELLED" = "PENDING") => {
      const [factura] = await db.insert(invoices).values({
        companyId: empresaA, branchId: rama.id, supplierId: proveedor.id, uuid: randomUUID(), folio: "C19",
        fecha: "2026-10-14", subtotal: 10000, total: 11600, taxAmount: 1600,
        rfcEmisor: "AAA010101AAA", rfcReceptor: "BBB010101BBB", matchStatus: "MATCHED", paymentStatus,
      }).returning();
      return factura;
    };
    const nuevaCorrida = (title: string, companyId = empresaA) => TreasuryService.createPaymentRun(companyId, `${marca} ${title}`, new Date("2026-10-14"), actor);
    const agregar = (runId: string, facturaId: string, companyId = empresaA) => TreasuryService.addItemToRun({ paymentRunId: runId, companyId, itemType: "INVOICE", referenceId: facturaId, amountCents: 1 });
    const factura = await nuevaFactura();
    const a = await nuevaCorrida("A"), b = await nuevaCorrida("B"), ajena = await nuevaCorrida("ajena", empresaB);
    const item = await agregar(a.id, factura.id);
    comprobar(item.amountCents === factura.total, "monto autoritativo, no el enviado por cliente");
    await rechaza(() => agregar(a.id, factura.id), 400, /esta corrida/i);
    await rechaza(() => agregar(b.id, factura.id), 400, /programada/i);
    await rechaza(() => agregar(ajena.id, factura.id, empresaB), 404);
    await rechaza(() => agregar(a.id, factura.id, empresaB), 404);
    comprobar(!(await TreasuryService.getUnpaidMatchedInvoices(empresaA)).some(f => f.id === factura.id), "listado excluye factura programada");
    comprobar((await TreasuryService.getUnpaidMatchedInvoices(empresaB)).length === 0, "B no ve facturas de A");
    const [total] = await db.select({ total: paymentRuns.totalAmountCents }).from(paymentRuns).where(eq(paymentRuns.id, a.id));
    comprobar(total.total === factura.total, "rechazos no duplican el total");
    await TreasuryService.updatePaymentRunStatus(a.id, empresaA, "CANCELLED", actor, "ADMIN");
    comprobar((await TreasuryService.getUnpaidMatchedInvoices(empresaA)).some(f => f.id === factura.id), "cancelar libera factura en listado");
    const reprogramada = await agregar(b.id, factura.id);
    comprobar(!!reprogramada.id, "factura liberada entra en corrida nueva");
    for (const estado of ["PAID", "CANCELLED"] as const) {
      const noPagable = await nuevaFactura(estado);
      await rechaza(() => agregar(b.id, noPagable.id), 400, estado === "PAID" ? /pagada/i : /cancelada/i);
    }
    const competencia = await nuevaFactura();
    const c = await nuevaCorrida("concurrente C"), d = await nuevaCorrida("concurrente D");
    const resultados = await Promise.allSettled([agregar(c.id, competencia.id), agregar(d.id, competencia.id)]);
    comprobar(resultados.filter(r => r.status === "fulfilled").length === 1, "dos altas concurrentes: una sola aceptada");
    const fallo = resultados.find(r => r.status === "rejected");
    comprobar(fallo?.status === "rejected" && fallo.reason.statusCode === 400, "la otra alta recibe rechazo de política");
    const partidas = await db.select().from(paymentRunItems).where(and(eq(paymentRunItems.referenceId, competencia.id), inArray(paymentRunItems.paymentRunId, [c.id, d.id])));
    comprobar(partidas.length === 1, "PostgreSQL conserva una única partida concurrente");
    const totales = await db.select({ total: paymentRuns.totalAmountCents }).from(paymentRuns).where(inArray(paymentRuns.id, [c.id, d.id]));
    comprobar(totales.reduce((sum, r) => sum + r.total, 0) === competencia.total, "total concurrente coincide con una factura");
    await TreasuryService.updatePaymentRunStatus(b.id, empresaA, "PENDING_APPROVAL", actor, "ADMIN");
    await TreasuryService.updatePaymentRunStatus(b.id, empresaA, "APPROVED", firmante, "ADMIN");
    const layout = await TreasuryService.generateBankDisbursementLayout(b.id, empresaA, "ADMIN");
    comprobar(layout.recordCount === 1 && layout.content.split("\n").length === 2, "layout contiene exactamente una transferencia");
    comprobar(layout.totalPesos === "116.00", "layout conserva el monto de la factura");
    await TreasuryService.updatePaymentRunStatus(b.id, empresaA, "PROCESSING", firmante, "ADMIN");
    await TreasuryService.settlePaymentRunItem({ paymentRunId: b.id, itemId: reprogramada.id, companyId: empresaA, settlementStatus: "CONFIRMED", userId: firmante, actorRole: "ADMIN", reference: "C19-SIMULADO" });
    const pagada = await db.query.invoices.findFirst({ where: eq(invoices.id, factura.id) });
    comprobar(pagada?.paymentStatus === "PAID", "confirmación registrada refleja factura pagada");
    await TreasuryService.updatePaymentRunStatus(b.id, empresaA, "COMPLETED", firmante, "ADMIN");
    const e = await nuevaCorrida("después de liquidar");
    await rechaza(() => agregar(e.id, factura.id), 400, /pagada/i);
  } finally {
    const corridas = await db.select({ id: paymentRuns.id }).from(paymentRuns).where(inArray(paymentRuns.companyId, empresas));
    if (corridas.length) await db.delete(paymentRunItems).where(inArray(paymentRunItems.paymentRunId, corridas.map(r => r.id)));
    await db.delete(paymentRuns).where(inArray(paymentRuns.companyId, empresas));
    await db.delete(invoices).where(inArray(invoices.companyId, empresas));
    await db.delete(supplierBankAccounts).where(inArray(supplierBankAccounts.companyId, empresas));
    await db.delete(suppliers).where(inArray(suppliers.companyId, empresas));
    await db.delete(tenantKeys).where(inArray(tenantKeys.companyId, empresas));
    await db.delete(branches).where(inArray(branches.companyId, empresas));
    await db.delete(users).where(inArray(users.companyId, empresas));
    await db.delete(companies).where(inArray(companies.id, empresas));
    comprobar((await db.select({ id: companies.id }).from(companies).where(inArray(companies.id, empresas))).length === 0, "limpieza de ambas empresas confirmada");
  }
  console.log(`${comprobaciones} comprobaciones correctas.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
