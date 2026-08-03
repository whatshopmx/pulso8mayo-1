// T27 verification: sales-cut ingestion service.
// Grows with each slice; final run proves the tracker acceptance criteria:
//  - 3 file shapes (summary key-value, payment summary, ticket detail)
//    produce VALIDATED cuts with identical totals
//  - totals that don't square → PENDING_REVIEW
//  - duplicate upload → rejected (409 semantics)
//  - English headers without accents → alias detection still works
//
// Run: npx tsx scripts/verify-sales-ingestion.ts
import "dotenv/config";
import ExcelJS from "exceljs";

import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { branches, dailySalesCuts } from "@/lib/db/schema";
import {
  parseSalesFile,
  detectMapping,
  previewSalesCut,
  ingestSalesCut,
  SalesIngestionError,
} from "@/lib/services/sales-ingestion-service";
import { COMPANY_ID, BRANCH_CONDESA } from "./seed-constants";
import {
  matchFieldAlias,
  matchPaymentLabel,
  isTotalLabel,
  normalizeHeader,
  parseBusinessDate,
  parseCount,
  parseMoneyToCents,
} from "@/lib/services/pos-column-aliases";

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`);
  }
}

function slice1AliasAndParserChecks() {
  console.log("\n[Slice 1] Alias dictionary + value parsers");

  // Header normalization
  check("normalize accents", normalizeHeader("Método de Pago"), "metodo de pago");
  check("normalize punctuation", normalizeHeader("No. Tickets"), "no tickets");

  // Exact alias matches (high confidence)
  check("alias: Venta Total", matchFieldAlias("Venta Total"), { field: "totalSales", confidence: "high" });
  check("alias: Efectivo", matchFieldAlias("Efectivo"), { field: "cashSales", confidence: "high" });
  check("alias: TDC", matchFieldAlias("TDC"), { field: "cardSales", confidence: "high" });
  check("alias: Forma de Pago", matchFieldAlias("Forma de Pago"), { field: "paymentMethod", confidence: "high" });
  check("alias: Fecha", matchFieldAlias("Fecha"), { field: "businessDate", confidence: "high" });
  check("alias: IVA", matchFieldAlias("IVA"), { field: "taxAmount", confidence: "high" });

  // English headers without accents (tracker verify requirement)
  check("alias: Net Sales", matchFieldAlias("Net Sales"), { field: "totalSales", confidence: "high" });
  check("alias: Cash", matchFieldAlias("Cash"), { field: "cashSales", confidence: "high" });
  check("alias: Tickets", matchFieldAlias("Tickets"), { field: "ticketCount", confidence: "high" });
  check("alias: Date", matchFieldAlias("Date"), { field: "businessDate", confidence: "high" });
  check("alias: Payment Method", matchFieldAlias("Payment Method"), { field: "paymentMethod", confidence: "high" });

  // Fuzzy matches (medium confidence)
  check("fuzzy: Total Ventas MX", matchFieldAlias("Total Ventas MX")?.field, "totalSales");
  check("fuzzy confidence", matchFieldAlias("Total Ventas MX")?.confidence, "medium");
  check("fuzzy: Fecha de Corte de Caja", matchFieldAlias("Fecha de Corte de Caja")?.field, "businessDate");

  // No match
  check("no match: Mesero", matchFieldAlias("Mesero"), null);

  // Payment labels → buckets
  check("payment: Efectivo", matchPaymentLabel("Efectivo"), "CASH");
  check("payment: Tarjeta de Crédito", matchPaymentLabel("Tarjeta de Crédito"), "CARD");
  check("payment: VISA", matchPaymentLabel("VISA"), "CARD");
  check("payment: Rappi", matchPaymentLabel("Rappi"), "DELIVERY");
  check("payment: Uber Eats", matchPaymentLabel("Uber Eats"), "DELIVERY");
  check("payment: DiDi Food", matchPaymentLabel("DiDi Food"), "DELIVERY");
  check("payment: Vales de Despensa", matchPaymentLabel("Vales de Despensa"), "OTHER");
  check("payment: unknown", matchPaymentLabel("Bitcoin"), null);

  // Total labels (cross-check rows, never payments)
  check("isTotal: Total", isTotalLabel("Total"), true);
  check("isTotal: Gran Total", isTotalLabel("Gran Total"), true);
  check("isTotal: Efectivo", isTotalLabel("Efectivo"), false);

  // Money parsing → cents
  check("money: $10,000.00", parseMoneyToCents("$10,000.00"), 1_000_000);
  check("money: plain number", parseMoneyToCents(2500.5), 250_050);
  check("money: 6000", parseMoneyToCents("6000"), 600_000);
  check("money: decimal comma", parseMoneyToCents("1234,56"), 123_456);
  check("money: thousands only", parseMoneyToCents("1,234"), 123_400);
  check("money: parentheses negative", parseMoneyToCents("(1,234.56)"), -123_456);
  check("money: garbage", parseMoneyToCents("abc"), null);
  check("money: empty", parseMoneyToCents(""), null);

  // Count parsing
  check("count: 80", parseCount("80"), 80);
  check("count: number", parseCount(45), 45);
  check("count: decimal string rejected", parseCount("80.5"), null);
  check("count: garbage", parseCount("n/a"), null);

  // Date parsing
  check("date: DD/MM/YYYY", parseBusinessDate("15/01/2020"), "2020-01-15");
  check("date: DD-MM-YYYY", parseBusinessDate("15-01-2020"), "2020-01-15");
  check("date: ISO", parseBusinessDate("2020-01-15"), "2020-01-15");
  check("date: Date object (UTC)", parseBusinessDate(new Date(Date.UTC(2020, 0, 15))), "2020-01-15");
  check("date: excel serial", parseBusinessDate(43845), "2020-01-15");
  check("date: invalid day", parseBusinessDate("32/01/2020"), null);
  check("date: invalid month", parseBusinessDate("15/13/2020"), null);
  check("date: garbage", parseBusinessDate("ayer"), null);
}

// ---------------------------------------------------------------------------
// Shared fixture business data (2020 dates avoid colliding with real data)
// ---------------------------------------------------------------------------
const FIX_DATE = "2020-01-15";
const FIX_TOTAL = 1_000_000; // $10,000.00 in cents
const FIX_CASH = 600_000;
const FIX_CARD = 250_000;
const FIX_DELIVERY = 150_000;
const FIX_TICKETS = 80;

async function xlsxBuffer(rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Corte");
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// A) Summary key-value layout
async function fixtureSummaryKV(dateDMY = "15/01/2020"): Promise<Buffer> {
  return xlsxBuffer([
    ["Corte de Caja - Sucursal Condesa"],
    ["Fecha", dateDMY],
    ["Venta Total", "$10,000.00"],
    ["Efectivo", "$6,000.00"],
    ["Tarjeta", "$2,500.00"],
    ["Rappi", "$1,500.00"],
    ["No. Tickets", "80"],
  ]);
}

// Totals that don't square: components $9,500 vs declared $10,000 (5% > 2%)
async function fixtureMismatch(dateDMY = "15/01/2020"): Promise<Buffer> {
  return xlsxBuffer([
    ["Corte"], ["Fecha", dateDMY], ["Venta Total", "$10,000.00"],
    ["Efectivo", "$6,000.00"], ["Tarjeta", "$2,500.00"], ["Rappi", "$1,000.00"], ["No. Tickets", "80"],
  ]);
}

// B) Payment-method summary table
async function fixturePaymentSummary(): Promise<Buffer> {
  return xlsxBuffer([
    ["Forma de Pago", "Importe", "Tickets"],
    ["Efectivo", "$6,000.00", "45"],
    ["Tarjeta", "$2,500.00", "25"],
    ["Rappi", "$1,500.00", "10"],
    ["Total", "$10,000.00", "80"],
  ]);
}

// C) Ticket-level detail (80 rows)
async function fixtureTicketDetail(dateDMY = "15/01/2020"): Promise<Buffer> {
  const rows: unknown[][] = [["Folio", "Fecha", "Forma de Pago", "Total"]];
  let n = 0;
  const add = (count: number, method: string, amount: string) => {
    for (let i = 0; i < count; i++) {
      n++;
      rows.push([`T-${String(n).padStart(3, "0")}`, dateDMY, method, amount]);
    }
  };
  add(40, "Efectivo", "$150.00"); // 40 × 150 = 6,000
  add(25, "Tarjeta", "$100.00"); // 25 × 100 = 2,500
  add(15, "Rappi", "$100.00"); // 15 × 100 = 1,500
  return xlsxBuffer(rows);
}

// D) English headers, no accents (tabular summary)
async function fixtureEnglishSummary(isoDate = "2020-01-15"): Promise<Buffer> {
  return xlsxBuffer([
    ["Date", "Net Sales", "Cash", "Credit Card", "Other Payments", "Tickets"],
    [isoDate, "10,000.00", "6,000.00", "2,500.00", "1,500.00", "80"],
  ]);
}

// E) CSV variant of the payment summary (quoted commas in money)
function fixtureCsv(): Buffer {
  return Buffer.from(
    [
      "Forma de Pago,Importe,Tickets",
      'Efectivo,"$6,000.00",45',
      'Tarjeta,"$2,500.00",25',
      'Rappi,"$1,500.00",10',
      'Total,"$10,000.00",80',
    ].join("\r\n"),
    "utf8"
  );
}

async function slice2ParsingAndShapeChecks() {
  console.log("\n[Slice 2] Parsing + shape detection + detectMapping");

  const a = await parseSalesFile(await fixtureSummaryKV(), "corte-a.xlsx");
  check("A: shape summary", a.fileShape, "summary");
  check("A: structure kv", a.primarySheet.structure, "summary_kv");

  const b = await parseSalesFile(await fixturePaymentSummary(), "corte-b.xlsx");
  check("B: shape payment_summary", b.fileShape, "payment_summary");
  const bMap = detectMapping(b.primarySheet.headers);
  check("B: paymentMethod col 0 high", bMap.find((m) => m.field === "paymentMethod"), {
    field: "paymentMethod", columnIndex: 0, columnName: "Forma de Pago", confidence: "high",
  });
  check("B: ticketCount col 2 high", bMap.find((m) => m.field === "ticketCount")?.columnIndex, 2);

  const c = await parseSalesFile(await fixtureTicketDetail(), "corte-c.xlsx");
  check("C: shape ticket_detail", c.fileShape, "ticket_detail");
  const cMap = detectMapping(c.primarySheet.headers);
  check("C: businessDate col 1", cMap.find((m) => m.field === "businessDate")?.columnIndex, 1);
  check("C: paymentMethod col 2", cMap.find((m) => m.field === "paymentMethod")?.columnIndex, 2);
  check("C: totalSales col 3 high", cMap.find((m) => m.field === "totalSales")?.confidence, "high");

  const d = await parseSalesFile(await fixtureEnglishSummary(), "corte-d.xlsx");
  check("D: shape summary", d.fileShape, "summary");
  check("D: structure summary_table", d.primarySheet.structure, "summary_table");
  const dMap = detectMapping(d.primarySheet.headers);
  check("D: Date→businessDate high", dMap.find((m) => m.field === "businessDate")?.confidence, "high");
  check("D: Net Sales→totalSales high", dMap.find((m) => m.field === "totalSales")?.confidence, "high");
  check("D: Cash→cashSales high", dMap.find((m) => m.field === "cashSales")?.confidence, "high");
  check("D: Credit Card→cardSales high", dMap.find((m) => m.field === "cardSales")?.confidence, "high");
  check("D: Tickets→ticketCount high", dMap.find((m) => m.field === "ticketCount")?.confidence, "high");

  const e = await parseSalesFile(fixtureCsv(), "corte-e.csv");
  check("E: csv shape payment_summary", e.fileShape, "payment_summary");
  check("E: csv row count (header + 4)", e.primarySheet.rows.length, 5);

  // Unreadable / unsupported files produce Spanish errors
  try {
    await parseSalesFile(Buffer.from("not a real xlsx"), "corte.xlsx");
    check("error: corrupt xlsx throws", "no throw", "UNREADABLE_FILE");
  } catch (err) {
    const e = err as SalesIngestionError;
    check("error: corrupt xlsx code", e.code, "UNREADABLE_FILE");
  }
  try {
    await parseSalesFile(Buffer.from("x"), "corte.xls");
    check("error: .xls throws", "no throw", "UNSUPPORTED_FORMAT");
  } catch (err) {
    const e = err as SalesIngestionError;
    check("error: .xls code", e.code, "UNSUPPORTED_FORMAT");
  }
}

async function slice3BuildAndValidationChecks() {
  console.log("\n[Slice 3] Canonical building + validation + previewSalesCut");

  // A) summary key-value → SALON + DELIVERY split (proportional tickets)
  const a = await previewSalesCut({ buffer: await fixtureSummaryKV(), fileName: "a.xlsx" });
  check("A: status VALIDATED", a.status, "VALIDATED");
  check("A: date from file", a.businessDate, FIX_DATE);
  check("A: 2 cuts (SALON+DELIVERY)", a.cuts.map((c) => c.channel), ["SALON", "DELIVERY"]);
  check("A: SALON total", a.cuts[0].data.totalSales, FIX_CASH + FIX_CARD);
  check("A: DELIVERY total", a.cuts[1].data.totalSales, FIX_DELIVERY);
  check("A: tickets add up", (a.cuts[0].data.ticketCount ?? 0) + (a.cuts[1].data.ticketCount ?? 0), FIX_TICKETS);

  // B) payment summary, date via manual fallback
  const b = await previewSalesCut({ buffer: await fixturePaymentSummary(), fileName: "b.xlsx", businessDate: FIX_DATE });
  check("B: status VALIDATED", b.status, "VALIDATED");
  check("B: 2 cuts", b.cuts.map((c) => c.channel), ["SALON", "DELIVERY"]);
  check("B: SALON tickets 70", b.cuts[0].data.ticketCount, 70);
  check("B: DELIVERY tickets 10", b.cuts[1].data.ticketCount, 10);

  // C) ticket detail → aggregates by payment method, counts tickets
  const c = await previewSalesCut({ buffer: await fixtureTicketDetail(), fileName: "c.xlsx" });
  check("C: status VALIDATED", c.status, "VALIDATED");
  check("C: date modal", c.businessDate, FIX_DATE);
  check("C: SALON total", c.cuts[0].data.totalSales, FIX_CASH + FIX_CARD);
  check("C: SALON tickets 65", c.cuts[0].data.ticketCount, 65);
  check("C: DELIVERY tickets 15", c.cuts[1].data.ticketCount, 15);

  // D) English headers → single TOTAL cut, VALIDATED
  const d = await previewSalesCut({ buffer: await fixtureEnglishSummary(), fileName: "d.xlsx" });
  check("D: status VALIDATED", d.status, "VALIDATED");
  check("D: 1 cut TOTAL", d.cuts.map((c2) => c2.channel), ["TOTAL"]);
  check("D: total", d.cuts[0].data.totalSales, FIX_TOTAL);
  check("D: cash", d.cuts[0].data.cashSales, FIX_CASH);
  check("D: other", d.cuts[0].data.otherPayments, FIX_DELIVERY);
  check("D: tickets", d.cuts[0].data.ticketCount, FIX_TICKETS);

  // E) CSV payment summary behaves like B
  const e = await previewSalesCut({ buffer: fixtureCsv(), fileName: "e.csv", businessDate: FIX_DATE });
  check("E: status VALIDATED", e.status, "VALIDATED");
  check("E: SALON total", e.cuts[0].data.totalSales, FIX_CASH + FIX_CARD);

  // All four business fixtures agree on totals
  const totals = [a, b, c, d].map((r) => r.cuts.reduce((s, cut) => s + (cut.data.totalSales ?? 0), 0));
  check("A-D all total $10,000.00", totals, [FIX_TOTAL, FIX_TOTAL, FIX_TOTAL, FIX_TOTAL]);

  // Totals that don't square → PENDING_REVIEW with legible note
  const m = await previewSalesCut({ buffer: await fixtureMismatch(), fileName: "m.xlsx" });
  check("M: status PENDING_REVIEW", m.status, "PENDING_REVIEW");
  check("M: square issue mentions 'no cuadra'", m.issues.some((i) => i.includes("no cuadra")), true);

  // Missing date (file + no fallback) → hard error
  const noDate = await previewSalesCut({ buffer: await fixturePaymentSummary(), fileName: "b.xlsx" });
  check("no date → error", noDate.errors.some((e2) => e2.includes("fecha")), true);
  check("no date → no cuts", noDate.cuts.length, 0);

  // Future date → hard error
  const future = await previewSalesCut({ buffer: await fixturePaymentSummary(), fileName: "b.xlsx", businessDate: "2999-01-01" });
  check("future date → error", future.errors.some((e2) => e2.includes("futura")), true);

  // Missing total → hard error
  const noTotalBuf = await xlsxBuffer([["Fecha", "15/01/2020"], ["No. Tickets", "80"]]);
  const noTotal = await previewSalesCut({ buffer: noTotalBuf, fileName: "nt.xlsx" });
  check("no total → error", noTotal.errors.some((e2) => e2.includes("total de ventas")), true);

  // Preview rows capped and mapped to canonical fields
  check("C: preview rows capped at 10", c.previewRows.length, 10);
  check("C: preview row has canonical cents", c.previewRows[0].totalSales, 15000);
}

// ---------------------------------------------------------------------------
// Slices 4+5: DB persistence, duplicate rejection, end-to-end acceptance
// ---------------------------------------------------------------------------

const DB_DATES = {
  a: "2020-01-15",
  b: "2020-01-16",
  c: "2020-01-17",
  d: "2020-01-18",
  mismatch: "2020-01-19",
};

async function cleanupTestCuts() {
  await db
    .delete(dailySalesCuts)
    .where(
      and(
        eq(dailySalesCuts.companyId, COMPANY_ID),
        eq(dailySalesCuts.branchId, BRANCH_CONDESA),
        gte(dailySalesCuts.businessDate, "2020-01-15"),
        lte(dailySalesCuts.businessDate, "2020-01-19")
      )
    );
}

async function slice4PersistenceChecks() {
  console.log("\n[Slice 4] ingestSalesCut → DB persistence + duplicate rejection");

  const [branch] = await db.select({ id: branches.id }).from(branches).where(eq(branches.id, BRANCH_CONDESA));
  if (!branch) {
    console.log("  ⚠ Seed branch not found — run seed-01-foundation first. Skipping DB checks.");
    failed++;
    return;
  }
  await cleanupTestCuts(); // idempotent re-runs

  const base = { companyId: COMPANY_ID, branchId: BRANCH_CONDESA, shift: "COMPLETO" as const, source: "UPLOAD" as const };

  // A) kv summary → SALON + DELIVERY rows, VALIDATED, avgTicket computed
  const a = await ingestSalesCut({ ...base, buffer: await fixtureSummaryKV(), fileName: "a.xlsx" });
  check("A: 2 rows persisted", a.rows.length, 2);
  check("A: status VALIDATED", a.status, "VALIDATED");
  const aRows = await db.select().from(dailySalesCuts).where(
    and(eq(dailySalesCuts.branchId, BRANCH_CONDESA), eq(dailySalesCuts.businessDate, DB_DATES.a))
  );
  const aSalon = aRows.find((r) => r.channel === "SALON");
  const aDelivery = aRows.find((r) => r.channel === "DELIVERY");
  check("A: SALON row in DB", aSalon?.totalSales, FIX_CASH + FIX_CARD);
  check("A: DELIVERY row in DB", aDelivery?.totalSales, FIX_DELIVERY);
  check("A: avgTicket computed", aSalon?.avgTicket, Math.round((FIX_CASH + FIX_CARD) / 68));
  check("A: source UPLOAD", aSalon?.source, "UPLOAD");
  check("A: status in DB", aSalon?.status, "VALIDATED");

  // B) payment summary with manual date → same totals persisted
  const b = await ingestSalesCut({ ...base, buffer: await fixturePaymentSummary(), fileName: "b.xlsx", businessDate: DB_DATES.b });
  check("B: VALIDATED", b.status, "VALIDATED");
  check("B: totals match A", b.rows.reduce((s, r) => s + r.totalSales, 0), FIX_TOTAL);

  // C) ticket detail → same totals persisted
  const c = await ingestSalesCut({ ...base, buffer: await fixtureTicketDetail("17/01/2020"), fileName: "c.xlsx" });
  check("C: VALIDATED", c.status, "VALIDATED");
  check("C: totals match A", c.rows.reduce((s, r) => s + r.totalSales, 0), FIX_TOTAL);

  // D) English headers → single TOTAL row
  const d = await ingestSalesCut({ ...base, buffer: await fixtureEnglishSummary(DB_DATES.d), fileName: "d.xlsx" });
  check("D: VALIDATED", d.status, "VALIDATED");
  check("D: 1 TOTAL row", d.rows.map((r) => r.channel), ["TOTAL"]);
  check("D: total", d.rows[0].totalSales, FIX_TOTAL);

  // Duplicate re-upload → 409-style rejection, nothing new persisted
  try {
    await ingestSalesCut({ ...base, buffer: await fixtureSummaryKV(), fileName: "a2.xlsx" });
    check("duplicate → throws", "no throw", "DUPLICATE_CUT");
  } catch (err) {
    const e = err as SalesIngestionError;
    check("duplicate → code DUPLICATE_CUT", e.code, "DUPLICATE_CUT");
    check("duplicate → Spanish message", e.message.includes("Ya existe un corte"), true);
  }

  // Totals that don't square → persisted as PENDING_REVIEW with notes
  const m = await ingestSalesCut({ ...base, buffer: await fixtureMismatch("19/01/2020"), fileName: "m.xlsx" });
  check("M: status PENDING_REVIEW", m.status, "PENDING_REVIEW");
  const mRows = await db.select().from(dailySalesCuts).where(
    and(eq(dailySalesCuts.branchId, BRANCH_CONDESA), eq(dailySalesCuts.businessDate, DB_DATES.mismatch))
  );
  check("M: notes mention 'no cuadra'", mRows[0]?.validationNotes?.includes("no cuadra"), true);

  // Cleanup: leave the table as we found it
  await cleanupTestCuts();
  const remaining = await db.select({ id: dailySalesCuts.id }).from(dailySalesCuts).where(
    and(
      eq(dailySalesCuts.branchId, BRANCH_CONDESA),
      gte(dailySalesCuts.businessDate, "2020-01-15"),
      lte(dailySalesCuts.businessDate, "2020-01-19")
    )
  );
  check("cleanup: 0 test rows remain", remaining.length, 0);
}

async function main() {
  slice1AliasAndParserChecks();
  await slice2ParsingAndShapeChecks();
  await slice3BuildAndValidationChecks();
  await slice4PersistenceChecks();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
