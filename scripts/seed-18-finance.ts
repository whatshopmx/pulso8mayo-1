import "dotenv/config";
import { db } from "@/lib/db";
import {
  companyBankAccounts, bankTransactions, gatewayTransactions, branchTerminals,
  dailySalesCuts, payrollRuns, payrollPayslips, cfdiNominaTimbrados,
  paymentRunItems, paymentRuns, employeeProfiles, users, aggregatorSettlements,
  accountingAccounts, accountingOpenings, accountingRules, costCenters, operatingExpenses,
} from "@/lib/db/schema";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { DekService } from "@/lib/security/dek";
import { encryptColumnWithDek } from "@/lib/security/column-cipher";
import { createHmac } from "node:crypto";
import { ensureRecurringPayables } from "@/lib/services/recurring-payable-service";
import { buildFingerprint } from "@/lib/services/bank-statement-service";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { createAccount, linkGateway, linkSource } from "@/lib/services/accounting/account-service";
import { createRule } from "@/lib/services/accounting/mapping-service";
import { createOpening } from "@/lib/services/accounting/opening-service";
import { recognizeExpense } from "@/lib/services/accounting/expense-adapter";
import { COMPANY_ID, DEMO_BRANCHES, USER_ADMIN, USER_SUPER_ADMIN } from "./seed-constants";

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

const DEMO_ACCOUNTS: {
  code: string;
  name: string;
  kind: "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";
  normalBalance: "DEBIT" | "CREDIT";
}[] = [
  { code: "DEMO-1101", name: "Caja general demo", kind: "ASSET", normalBalance: "DEBIT" },
  { code: "DEMO-1102", name: "Bancos BBVA operativo demo", kind: "ASSET", normalBalance: "DEBIT" },
  { code: "DEMO-1103", name: "Terminales por cobrar demo", kind: "ASSET", normalBalance: "DEBIT" },
  { code: "DEMO-1104", name: "Plataformas por cobrar demo", kind: "ASSET", normalBalance: "DEBIT" },
  { code: "DEMO-1105", name: "Otros cobros por liquidar demo", kind: "ASSET", normalBalance: "DEBIT" },
  { code: "DEMO-1106", name: "Fondos fijos de caja chica demo", kind: "ASSET", normalBalance: "DEBIT" },
  { code: "DEMO-1150", name: "Inventario de insumos demo", kind: "ASSET", normalBalance: "DEBIT" },
  { code: "DEMO-1190", name: "IVA acreditable demo", kind: "ASSET", normalBalance: "DEBIT" },
  { code: "DEMO-2101", name: "Proveedores y gastos por pagar demo", kind: "LIABILITY", normalBalance: "CREDIT" },
  { code: "DEMO-2102", name: "Facturas por recibir demo", kind: "LIABILITY", normalBalance: "CREDIT" },
  { code: "DEMO-2103", name: "Nómina por pagar demo", kind: "LIABILITY", normalBalance: "CREDIT" },
  { code: "DEMO-2104", name: "Retenciones y deducciones de nómina demo", kind: "LIABILITY", normalBalance: "CREDIT" },
  { code: "DEMO-2190", name: "IVA trasladado por pagar demo", kind: "LIABILITY", normalBalance: "CREDIT" },
  { code: "DEMO-3101", name: "Capital y saldos iniciales demo", kind: "EQUITY", normalBalance: "CREDIT" },
  { code: "DEMO-4101", name: "Ventas de alimentos y bebidas demo", kind: "INCOME", normalBalance: "CREDIT" },
  { code: "DEMO-4102", name: "Ajustes positivos de inventario demo", kind: "INCOME", normalBalance: "CREDIT" },
  { code: "DEMO-5010-ALM", name: "Alimentos y materia prima demo", kind: "EXPENSE", normalBalance: "DEBIT" },
  { code: "DEMO-5020-BEB", name: "Bebidas y licores demo", kind: "EXPENSE", normalBalance: "DEBIT" },
  { code: "DEMO-5030-MANT", name: "Mantenimiento y equipamiento demo", kind: "EXPENSE", normalBalance: "DEBIT" },
  { code: "DEMO-5040-LIMP", name: "Limpieza y químicos demo", kind: "EXPENSE", normalBalance: "DEBIT" },
  { code: "DEMO-5050-SERV", name: "Servicios generales y operativos demo", kind: "EXPENSE", normalBalance: "DEBIT" },
  { code: "DEMO-5101", name: "Gastos operativos sin partida demo", kind: "EXPENSE", normalBalance: "DEBIT" },
  { code: "DEMO-5102", name: "Comisiones de terminales y plataformas demo", kind: "EXPENSE", normalBalance: "DEBIT" },
  { code: "DEMO-5103", name: "Sueldos, salarios y aguinaldo demo", kind: "EXPENSE", normalBalance: "DEBIT" },
  { code: "DEMO-5201", name: "Costo de ventas por consumo demo", kind: "EXPENSE", normalBalance: "DEBIT" },
  { code: "DEMO-5202", name: "Mermas de inventario demo", kind: "EXPENSE", normalBalance: "DEBIT" },
  { code: "DEMO-5203", name: "Ajustes negativos de inventario demo", kind: "EXPENSE", normalBalance: "DEBIT" },
];

export async function main() {
  console.log("=== Phase 18: Banca corporativa, estado de cuenta, TPV, preparación fiscal y contabilidad ===");

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

  // --------------------------------------------------------------------
  // 6. Contabilidad integrada demo (Catálogo, vínculos, reglas, apertura
  //    y reconocimiento de gastos aprobados).
  // --------------------------------------------------------------------
  const acctCtx = { companyId: COMPANY_ID, actorId: USER_SUPER_ADMIN, role: "SUPER_ADMIN" as const };
  const existingAccounts = await withCompanyContext(
    { companyId: COMPANY_ID, actorId: USER_SUPER_ADMIN },
    (tx) => tx.select().from(accountingAccounts).where(eq(accountingAccounts.companyId, COMPANY_ID)),
  );
  const accountByCode = new Map<string, string>(existingAccounts.map((a) => [a.code, a.id]));

  for (const acc of DEMO_ACCOUNTS) {
    if (!accountByCode.has(acc.code)) {
      const created = await createAccount(acctCtx, {
        ...acc,
        postable: true,
        active: true,
        validFrom: "2026-01-01",
      });
      accountByCode.set(acc.code, created.id);
    }
  }

  const allCCs = await db.select().from(costCenters).where(eq(costCenters.companyId, COMPANY_ID));
  const ccToAccountCode: Record<string, string> = {
    "CC-ALM": "DEMO-5010-ALM",
    "CC-BEB": "DEMO-5020-BEB",
    "CC-MANT": "DEMO-5030-MANT",
    "CC-LIMP": "DEMO-5040-LIMP",
    "CC-SERV": "DEMO-5050-SERV",
  };
  for (const cc of allCCs) {
    const targetCode = ccToAccountCode[cc.code];
    const targetAccId = targetCode ? accountByCode.get(targetCode) : undefined;
    if (targetAccId) {
      await linkSource(acctCtx, { accountId: targetAccId, costCenterId: cc.id });
    }
  }
  await linkSource(acctCtx, {
    accountId: accountByCode.get("DEMO-1102")!,
    bankAccountId: sourceBankAccountId,
  });

  for (const acquirer of ["CLIP", "BBVA", "SANTANDER", "MERCADO_PAGO"] as const) {
    await linkGateway(acctCtx, {
      accountId: accountByCode.get("DEMO-1103")!,
      gatewayAcquirer: acquirer,
      salesDestination: "CARD",
    });
  }

  const existingRules = await withCompanyContext(
    { companyId: COMPANY_ID, actorId: USER_SUPER_ADMIN },
    (tx) => tx.select({ code: accountingRules.code }).from(accountingRules).where(eq(accountingRules.companyId, COMPANY_ID)),
  );
  const existingRuleCodes = new Set(existingRules.map((r) => r.code));

  const DEMO_RULES: {
    code: string;
    name: string;
    eventType: string;
    entries: { role: string; accountCode: string; required?: boolean }[];
  }[] = [
    {
      code: "DEMO_EXPENSE_RECOGNIZED",
      name: "Reconocimiento de gasto operativo demo",
      eventType: "EXPENSE_RECOGNIZED",
      entries: [
        { role: "EXPENSE", accountCode: "DEMO-5101", required: true },
        { role: "PAYABLE", accountCode: "DEMO-2101", required: true },
        { role: "RECOVERABLE_TAX", accountCode: "DEMO-1190", required: true },
      ],
    },
    {
      code: "DEMO_EXPENSE_PAYMENT",
      name: "Pago de gasto operativo demo",
      eventType: "EXPENSE_PAYMENT",
      entries: [
        { role: "PAYABLE", accountCode: "DEMO-2101", required: true },
        { role: "PAYMENT_SOURCE", accountCode: "DEMO-1102", required: true },
      ],
    },
    {
      code: "DEMO_DAILY_SALES_CUT",
      name: "Reconocimiento de corte diario de ventas demo",
      eventType: "SALE_RECOGNIZED",
      entries: [
        { role: "CASH_ASSET", accountCode: "DEMO-1101", required: false },
        { role: "CARD_CLEARING", accountCode: "DEMO-1103", required: false },
        { role: "PLATFORM_CLEARING", accountCode: "DEMO-1104", required: false },
        { role: "OTHER_CLEARING", accountCode: "DEMO-1105", required: false },
        { role: "SALES_REVENUE", accountCode: "DEMO-4101", required: true },
        { role: "OUTPUT_VAT", accountCode: "DEMO-2190", required: false },
      ],
    },
    {
      code: "DEMO_GATEWAY_SETTLEMENT",
      name: "Liquidación de terminal y plataforma demo",
      eventType: "GATEWAY_SETTLED",
      entries: [
        { role: "BANK", accountCode: "DEMO-1102", required: true },
        { role: "CLEARING", accountCode: "DEMO-1103", required: true },
        { role: "FEE_EXPENSE", accountCode: "DEMO-5102", required: false },
        { role: "RECOVERABLE_TAX", accountCode: "DEMO-1190", required: false },
      ],
    },
    {
      code: "DEMO_RECEIVING_ACCRUED",
      name: "Recepción de mercancía por facturar demo",
      eventType: "RECEIVING_ACCRUED",
      entries: [
        { role: "INVENTORY_OR_EXPENSE", accountCode: "DEMO-1150", required: true },
        { role: "UNBILLED_RECEIPT_LIABILITY", accountCode: "DEMO-2102", required: true },
      ],
    },
    {
      code: "DEMO_SUPPLIER_INVOICE_MATCHED",
      name: "Factura de proveedor conciliada contra recepción demo",
      eventType: "SUPPLIER_INVOICE_MATCHED",
      entries: [
        { role: "UNBILLED_RECEIPT_LIABILITY", accountCode: "DEMO-2102", required: true },
        { role: "PAYABLE", accountCode: "DEMO-2101", required: true },
        { role: "RECOVERABLE_TAX", accountCode: "DEMO-1190", required: false },
      ],
    },
    {
      code: "DEMO_PETTY_CASH_EXPENSE",
      name: "Salida de caja chica demo",
      eventType: "PETTY_CASH_EXPENSE",
      entries: [
        { role: "EXPENSE", accountCode: "DEMO-5101", required: true },
        { role: "PETTY_CASH_ASSET", accountCode: "DEMO-1106", required: true },
        { role: "RECOVERABLE_TAX", accountCode: "DEMO-1190", required: false },
      ],
    },
    {
      code: "DEMO_PAYROLL_APPROVED",
      name: "Devengo de nómina aprobada demo",
      eventType: "PAYROLL_APPROVED",
      entries: [
        { role: "PAYROLL_EXPENSE", accountCode: "DEMO-5103", required: true },
        { role: "PAYROLL_PAYABLE", accountCode: "DEMO-2103", required: true },
        { role: "PAYROLL_DEDUCTIONS_LIABILITY", accountCode: "DEMO-2104", required: false },
      ],
    },
  ];

  for (const ruleDef of DEMO_RULES) {
    if (!existingRuleCodes.has(ruleDef.code)) {
      await createRule(acctCtx, {
        code: ruleDef.code,
        name: ruleDef.name,
        eventType: ruleDef.eventType,
        effectiveFrom: "2026-01-01",
        active: true,
        entries: ruleDef.entries.map((e) => ({
          role: e.role,
          accountId: accountByCode.get(e.accountCode)!,
          required: e.required ?? true,
        })),
      });
    }
  }

  const existingOpenings = await withCompanyContext(
    { companyId: COMPANY_ID, actorId: USER_SUPER_ADMIN },
    (tx) => tx.select({ id: accountingOpenings.id }).from(accountingOpenings).where(eq(accountingOpenings.companyId, COMPANY_ID)),
  );
  if (existingOpenings.length === 0) {
    await createOpening(acctCtx, {
      openingDate: "2026-01-01",
      memo: "Apertura contable demo para validar contabilidad integrada.",
      reason: "Publicación inicial de saldos de apertura del entorno demo.",
      lines: [
        {
          accountId: accountByCode.get("DEMO-1101")!,
          debitCents: 2500000,
          creditCents: 0,
          memo: "Efectivo inicial en caja general",
        },
        {
          accountId: accountByCode.get("DEMO-1102")!,
          debitCents: 15000000,
          creditCents: 0,
          memo: "Saldo inicial banco operativo BBVA",
        },
        {
          accountId: accountByCode.get("DEMO-1106")!,
          debitCents: 1500000,
          creditCents: 0,
          memo: "Fondos fijos de caja chica 3 sucursales",
        },
        {
          accountId: accountByCode.get("DEMO-1150")!,
          debitCents: 8500000,
          creditCents: 0,
          memo: "Inventario inicial valorizado",
        },
        {
          accountId: accountByCode.get("DEMO-3101")!,
          debitCents: 0,
          creditCents: 27500000,
          memo: "Capital contable y saldos iniciales",
        },
      ],
      documents: [
        {
          label: "Estado de cuenta BBVA apertura",
          reference: "DEMO-OPEN-BBVA-2026-01",
          amountCents: 15000000,
        },
        {
          label: "Arqueo inicial de cajas y fondos fijos",
          reference: "DEMO-OPEN-CASH-2026-01",
          amountCents: 4000000,
        },
        {
          label: "Inventario físico inicial valorizado",
          reference: "DEMO-OPEN-INV-2026-01",
          amountCents: 8500000,
        },
      ],
    });
  }

  const eligibleExpenses = await db.select({ id: operatingExpenses.id })
    .from(operatingExpenses)
    .where(and(
      eq(operatingExpenses.companyId, COMPANY_ID),
      inArray(operatingExpenses.status, ["APPROVED", "PAID"]),
    ));
  for (const exp of eligibleExpenses) {
    await recognizeExpense({ companyId: COMPANY_ID, actorId: USER_SUPER_ADMIN }, exp.id).catch(() => {});
  }
  console.log(`Contabilidad demo configurada: ${accountByCode.size} cuentas, apertura y pólizas publicadas.`);
}
