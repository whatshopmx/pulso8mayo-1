import "dotenv/config";
import { db } from "@/lib/db";
import {
  companyBankAccounts, bankTransactions, gatewayTransactions, branchTerminals,
  dailySalesCuts, payrollRuns, payrollPayslips, cfdiNominaTimbrados,
  paymentRunItems, paymentRuns, employeeProfiles, users, aggregatorSettlements,
} from "@/lib/db/schema";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { DekService } from "@/lib/security/dek";
import { encryptColumnWithDek } from "@/lib/security/column-cipher";
import { createHmac } from "node:crypto";
import { ensureRecurringPayables } from "@/lib/services/recurring-payable-service";
import { buildFingerprint } from "@/lib/services/bank-statement-service";
import { COMPANY_ID, DEMO_BRANCHES, USER_ADMIN } from "./seed-constants";

// Comisiones demo: mismas tarifas que seed-15 sembró en channelCommissionRates
// (canal tpv: 250 bps de comisión, 1600 bps de IVA). Una sola fuente de verdad
// evita desalinear el ejemplo con la conciliación de commissions.
const TPV_RATE_BPS = 250;
const TPV_VAT_BPS = 1600;

function isoDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function isoDatePlus(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Índice demo (1-based) de la sucursal para descripciones legibles. */
function branchIndex(branchId: string): number {
  const i = DEMO_BRANCHES.findIndex((b) => b.id === branchId);
  return i >= 0 ? i + 1 : 0;
}

interface StatementRow {
  valueDate: string;
  description: string;
  reference: string;
  amountCents: number;
}

export async function main() {
  console.log("=== Phase 18: Banca corporativa, estado de cuenta, TPV y preparación fiscal ===");

  // --------------------------------------------------------------------
  // 1. Catálogo de cuentas propias (el lado pagador). Número cifrado con
  //    el DEK del tenant, mismo patrón que payee_bank_accounts en seed-15.
  // --------------------------------------------------------------------
  let [account] = await db.select().from(companyBankAccounts)
    .where(and(eq(companyBankAccounts.companyId, COMPANY_ID), eq(companyBankAccounts.active, true)))
    .limit(1);
  if (!account) {
    const dek = await DekService.getDek(COMPANY_ID);
    const accountNumber = "00034281917";
    await db.insert(companyBankAccounts).values({
      companyId: COMPANY_ID,
      label: "BBVA · Cuenta operativa demo",
      accountNumber: encryptColumnWithDek(accountNumber, dek),
      accountLastFour: accountNumber.slice(-4),
      accountFingerprint: createHmac("sha256", dek).update(accountNumber).digest("hex"),
      bankCode: "012", bankName: "BBVA México",
      active: true, registeredBy: USER_ADMIN,
      notes: "Cuenta sintética de demostración: no requiere verificación bancaria real.",
    });
    [account] = await db.select().from(companyBankAccounts)
      .where(and(eq(companyBankAccounts.companyId, COMPANY_ID), eq(companyBankAccounts.active, true)))
      .limit(1);
    console.log("Cuenta corporativa demo creada (BBVA).");
  }
  const sourceBankAccountId = account.id;

  // --------------------------------------------------------------------
  // 2. Estado de cuenta bancario. Salidas espejo de partidas de corrida
  //    reales (suggestMatches las cruza en cuanto la partida esté
  //    CONFIRMED) + depósitos de ventas + comisiones bancarias.
  //    Idempotencia por fingerprint, igual que el import real.
  // --------------------------------------------------------------------
  const [statementExists] = await db.select({ id: bankTransactions.id })
    .from(bankTransactions)
    .where(eq(bankTransactions.companyId, COMPANY_ID))
    .limit(1);

  if (!statementExists) {
    const statement: StatementRow[] = [];

    const items = await db.select({
      amountCents: paymentRunItems.amountCents,
      status: paymentRunItems.settlementStatus,
    }).from(paymentRunItems)
      .innerJoin(paymentRuns, eq(paymentRuns.id, paymentRunItems.paymentRunId))
      .where(eq(paymentRuns.companyId, COMPANY_ID))
      .orderBy(desc(paymentRunItems.amountCents))
      .limit(5);
    items.forEach((item, index) => {
      statement.push({
        valueDate: isoDaysAgo(1 + index * 2),
        description: `SPEI DISPERSION CORRIDA ${item.status}`,
        reference: `SP-9${index + 1}`,
        amountCents: -item.amountCents,
      });
    });

    statement.push({
      valueDate: isoDaysAgo(2), description: "COMISION ADMINISTRACION MENSUAL",
      reference: "CB-0001", amountCents: -39900,
    });
    statement.push({
      valueDate: isoDaysAgo(3), description: "IVA COMISIONES BANCARIAS",
      reference: "CB-0002", amountCents: -6384,
    });

    const cuts = await db.select({
      branchId: dailySalesCuts.branchId, businessDate: dailySalesCuts.businessDate,
      tpvDepositCents: dailySalesCuts.tpvDepositCents, depositedCents: dailySalesCuts.depositedCents,
    }).from(dailySalesCuts)
      .where(and(eq(dailySalesCuts.companyId, COMPANY_ID), eq(dailySalesCuts.shift, "COMPLETO")))
      .orderBy(desc(dailySalesCuts.businessDate))
      .limit(6);
    for (const cut of cuts) {
      const deposit = cut.tpvDepositCents ?? cut.depositedCents;
      if (!deposit) continue;
      statement.push({
        valueDate: String(cut.businessDate),
        description: `DEPOSITO VENTAS SUCURSAL ${branchIndex(cut.branchId)}`,
        reference: `DEP-${String(cut.businessDate).replaceAll("-", "")}`,
        amountCents: deposit,
      });
    }

    const settlements = await db.select()
      .from(aggregatorSettlements)
      .where(eq(aggregatorSettlements.companyId, COMPANY_ID))
      .orderBy(desc(aggregatorSettlements.periodEnd))
      .limit(2);
    for (const [index, settlement] of settlements.entries()) {
      if (!settlement.netDepositedCents) continue;
      statement.push({
        valueDate: isoDatePlus(String(settlement.periodEnd), 1 + index),
        description: `LIQUIDACION ${settlement.channel}`,
        reference: `AGG-${index + 1}`,
        amountCents: settlement.netDepositedCents,
      });
    }

    if (statement.length) {
      await db.insert(bankTransactions).values(statement.map((row) => ({
        companyId: COMPANY_ID,
        sourceBankAccountId,
        valueDate: row.valueDate,
        description: row.description,
        reference: row.reference,
        amountCents: row.amountCents,
        fingerprint: buildFingerprint({
          sourceBankAccountId, valueDate: row.valueDate,
          reference: row.reference, amountCents: row.amountCents,
        }),
        importedBy: USER_ADMIN,
      })));
    }
    console.log(`Estado de cuenta demo importado: ${statement.length} movimientos.`);
  }

  // --------------------------------------------------------------------
  // 3. Transacciones de gateway (conciliación TPV). Deriva cortes con
  //    ventas de tarjeta: mismo monto, tarifa del canal tpv.
  // --------------------------------------------------------------------
  const [gatewayExists] = await db.select({ id: gatewayTransactions.id })
    .from(gatewayTransactions)
    .where(eq(gatewayTransactions.companyId, COMPANY_ID))
    .limit(1);

  if (!gatewayExists) {
    const cuts = await db.select({
      branchId: dailySalesCuts.branchId, businessDate: dailySalesCuts.businessDate,
      cardSales: dailySalesCuts.cardSales,
    }).from(dailySalesCuts)
      .where(and(
        eq(dailySalesCuts.companyId, COMPANY_ID),
        eq(dailySalesCuts.shift, "COMPLETO"),
        sql`${dailySalesCuts.cardSales} > 0`,
      ))
      .orderBy(desc(dailySalesCuts.businessDate))
      .limit(7);

    const terminals = await db.select().from(branchTerminals)
      .where(eq(branchTerminals.companyId, COMPANY_ID));

    const rows: (typeof gatewayTransactions.$inferInsert)[] = [];
    for (const cut of cuts) {
      const terminal = terminals.find((t) => t.branchId === cut.branchId);
      if (!terminal) continue;
      // Dos cobros por corte: 60/40 de la venta con tarjeta.
      [0.6, 0.4].forEach((share, index) => {
        const firstGross = Math.round(cut.cardSales! * 0.6);
        const gross = index === 0 ? firstGross : cut.cardSales! - firstGross;
        if (gross <= 0) return;
        const fee = Math.round(gross * TPV_RATE_BPS / 10_000);
        const feeVat = Math.round(fee * TPV_VAT_BPS / 10_000);
        rows.push({
          companyId: COMPANY_ID, branchId: cut.branchId, acquirer: terminal.acquirer,
          externalId: `GW-DEMO-${terminal.serialNumber}-${cut.businessDate}-${index + 1}`,
          authorizationCode: `A${(gross % 900000) + 100000}`,
          transactionDate: new Date(`${cut.businessDate}T20:${index === 0 ? "05" : "35"}:00Z`),
          cardLast4: index === 0 ? "4242" : "5310",
          cardBrand: index === 0 ? "VISA" : "MASTERCARD",
          cardType: index === 0 ? "CREDIT" : "DEBIT",
          grossAmountCents: gross, feeAmountCents: fee, feeVatCents: feeVat,
          netAmountCents: gross - fee - feeVat,
          settlementDate: isoDatePlus(String(cut.businessDate), 1),
          batchNumber: `L-${String(cut.businessDate).replaceAll("-", "")}-${index + 1}`,
          status: "SETTLED", importedBy: USER_ADMIN,
        });
      });
    }
    if (rows.length) {
      await db.insert(gatewayTransactions).values(rows).onConflictDoNothing({
        target: [gatewayTransactions.companyId, gatewayTransactions.acquirer, gatewayTransactions.externalId],
      });
    }
    console.log(`Transacciones de gateway demo: ${rows.length}.`);
  }

  // --------------------------------------------------------------------
  // 4. Payables recurrentes: DERIVADOS de los contratos activos vía el
  //    servicio real (idempotente, ventana ±60 días). No se inventan.
  // --------------------------------------------------------------------
  const payables = await ensureRecurringPayables({ companyId: COMPANY_ID });
  console.log(`Payables recurrentes OPEN: +${payables.created} nuevas sobre ${payables.contractsConsidered} contratos considerados.`);

  // --------------------------------------------------------------------
  // 5. Preparación fiscal de la nómina ordinaria: sin PAC, UUID ni timbrado.
  //    Conserva el mismo período que usa executePayrollRun.
  // --------------------------------------------------------------------
  const [run] = await db.select().from(payrollRuns)
    .where(and(eq(payrollRuns.companyId, COMPANY_ID), isNull(payrollRuns.aguinaldoFiscalYear)))
    .orderBy(desc(payrollRuns.createdAt))
    .limit(1);
  if (!run) {
    console.log("Sin corridas de nómina: corre la fase 15 antes de la demo de CFDI.");
    return;
  }
  const payslips = await db.select({
    userId: payrollPayslips.userId,
    totalPercepcionesCents: payrollPayslips.totalPercepcionesCents,
    totalDeduccionesCents: payrollPayslips.totalDeduccionesCents,
    rfc: employeeProfiles.rfc,
    nombre: users.name,
  }).from(payrollPayslips)
    .leftJoin(employeeProfiles, eq(employeeProfiles.userId, payrollPayslips.userId))
    .leftJoin(users, eq(users.id, payrollPayslips.userId))
    .where(eq(payrollPayslips.runId, run.id));

  const periodo = `${run.periodStart} - ${run.periodEnd}`;
  let preparados = 0;
  for (const [index, payslip] of payslips.entries()) {
    if (!payslip.rfc) continue;
    await db.insert(cfdiNominaTimbrados).values({
      companyId: COMPANY_ID, empleadoRfc: payslip.rfc,
      empleadoNombre: payslip.nombre ?? `Empleado demo ${index + 1}`,
      periodo,
      status: "PENDIENTE",
      totalPercepcionesCents: payslip.totalPercepcionesCents,
      totalDeduccionesCents: payslip.totalDeduccionesCents,
      rawResponse: { source: "DEMO_SEED", note: "Preparación de demostración; no se envió al PAC ni acredita timbrado." },
    }).onConflictDoUpdate({
      target: [cfdiNominaTimbrados.companyId, cfdiNominaTimbrados.empleadoRfc, cfdiNominaTimbrados.periodo],
      set: {
        totalPercepcionesCents: payslip.totalPercepcionesCents,
        totalDeduccionesCents: payslip.totalDeduccionesCents,
      },
    });
    preparados++;
  }
  console.log(`Preparaciones fiscales demo: ${preparados} PENDIENTE, sin timbrar (período ${periodo}).`);
}
