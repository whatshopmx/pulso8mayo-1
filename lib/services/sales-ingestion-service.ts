// M13 / T27: Sales-cut ingestion service.
// Parses POS export files (XLSX/CSV), detects their shape, maps columns to
// the canonical schema (AD-7/AD-8), validates and persists daily sales cuts.

import ExcelJS from "exceljs";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { dailySalesCuts } from "@/lib/db/schema";
import {
  CANONICAL_FIELDS,
  CanonicalField,
  MatchConfidence,
  isTotalLabel,
  matchAggregatorLabel,
  matchFieldAlias,
  matchPaymentLabel,
  parseBusinessDate,
  parseCount,
  parseMoneyToCents,
} from "./pos-column-aliases";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileShape = "summary" | "payment_summary" | "ticket_detail" | "multi_sheet";

/** Internal layout of a single sheet (drives the row-building strategy). */
export type SheetStructure = "summary_kv" | "summary_table" | "payment_summary" | "ticket_detail" | "unknown";

export interface ParsedSheet {
  sheetName: string;
  /** Dense raw cell matrix (0-indexed rows/cols), trailing empties trimmed. */
  rows: unknown[][];
  /** Index of the detected header row, or -1 for key-value layouts. */
  headerRowIndex: number;
  /** Raw header strings (empty for key-value layouts). */
  headers: string[];
  structure: SheetStructure;
  /** Alias-match score used to pick the primary sheet of a workbook. */
  score: number;
}

export interface ParsedSalesFile {
  fileName: string;
  fileShape: FileShape;
  sheets: ParsedSheet[];
  /** Sheet with the highest alias-match score; the one we ingest. */
  primarySheet: ParsedSheet;
}

export type MappingConfidence = MatchConfidence | "none";

export interface ColumnMapping {
  field: CanonicalField;
  columnIndex: number;
  columnName: string | null;
  confidence: MappingConfidence;
}

/** Error with a legible Spanish reason, safe to surface to users. */
export class SalesIngestionError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SalesIngestionError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// File parsing (XLSX via exceljs, CSV via small built-in parser)
// ---------------------------------------------------------------------------

/**
 * Parses a POS export file into a normalized sheet matrix and detects its
 * shape. Supports .xlsx/.xlsm and .csv (AD-8). Legacy .xls is rejected with
 * a Spanish message (exceljs does not support the binary format).
 */
export async function parseSalesFile(buffer: Buffer, fileName: string): Promise<ParsedSalesFile> {
  const lower = fileName.toLowerCase();
  let sheets: ParsedSheet[];

  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    const rows = parseCsv(buffer.toString("utf8"));
    const sheet: ParsedSheet = {
      sheetName: "csv",
      rows,
      headerRowIndex: -1,
      headers: [],
      structure: "unknown",
      score: 0,
    };
    sheets = [sheet];
  } else if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw new SalesIngestionError(
        "UNREADABLE_FILE",
        "No se pudo leer el archivo. Verifica que sea un Excel (.xlsx) o CSV válido."
      );
    }
    sheets = workbook.worksheets.map((ws) => ({
      sheetName: ws.name,
      rows: extractSheetRows(ws),
      headerRowIndex: -1,
      headers: [],
      structure: "unknown" as SheetStructure,
      score: 0,
    }));
    sheets = sheets.filter((s) => s.rows.length > 0);
  } else if (lower.endsWith(".xls")) {
    throw new SalesIngestionError(
      "UNSUPPORTED_FORMAT",
      "El formato .xls (Excel antiguo) no es compatible. Exporta el corte como .xlsx o .csv."
    );
  } else {
    throw new SalesIngestionError(
      "UNSUPPORTED_FORMAT",
      `Formato no soportado para "${fileName}". Usa un archivo .xlsx o .csv.`
    );
  }

  if (sheets.length === 0) {
    throw new SalesIngestionError(
      "EMPTY_FILE",
      "El archivo está vacío o no contiene datos legibles."
    );
  }

  for (const sheet of sheets) {
    analyzeSheet(sheet);
  }

  const primarySheet = sheets.reduce((best, s) => (s.score > best.score ? s : best), sheets[0]);
  if (primarySheet.structure === "unknown") {
    throw new SalesIngestionError(
      "UNRECOGNIZED_LAYOUT",
      "No se encontraron columnas reconocibles de un corte de ventas (fecha, total, formas de pago). Revisa el formato del archivo."
    );
  }

  const fileShape: FileShape =
    sheets.length > 1
      ? "multi_sheet"
      : primarySheet.structure === "summary_kv" || primarySheet.structure === "summary_table"
        ? "summary"
        : primarySheet.structure;

  return { fileName, fileShape, sheets, primarySheet };
}

/** Extracts a dense matrix of primitive cell values from a worksheet. */
function extractSheetRows(ws: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: unknown[] = [];
    for (let i = 1; i <= row.cellCount; i++) {
      cells.push(cellToPrimitive(row.getCell(i).value));
    }
    rows.push(cells);
  });
  // Trim fully-empty trailing rows
  while (rows.length > 0 && rows[rows.length - 1].every(isEmptyCell)) {
    rows.pop();
  }
  return rows;
}

/** Converts exceljs cell values (formulas, rich text, dates) to primitives. */
function cellToPrimitive(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    if ("result" in value) return cellToPrimitive(value.result as ExcelJS.CellValue);
    if ("richText" in value) {
      return (value as ExcelJS.CellRichTextValue).richText.map((rt) => rt.text).join("");
    }
    if ("text" in value) return String((value as { text: unknown }).text ?? "");
    if ("error" in value) return null;
    return String(value);
  }
  return value;
}

/** Minimal CSV parser: quoted fields, escaped quotes, CRLF. */
export function parseCsv(text: string): unknown[][] {
  const rows: unknown[][] = [];
  let field = "";
  let row: unknown[] = [];
  let inQuotes = false;

  const pushField = () => {
    const trimmed = field.trim();
    row.push(trimmed === "" ? null : trimmed);
    field = "";
  };
  const pushRow = () => {
    pushField();
    if (row.some((c) => c !== null)) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\n") {
      pushRow();
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) pushRow();
  return rows;
}

// ---------------------------------------------------------------------------
// Shape detection
// ---------------------------------------------------------------------------

const MAX_HEADER_SCAN_ROWS = 10;
/** payment_summary files list a handful of methods; detail files list tickets. */
const MAX_PAYMENT_SUMMARY_ROWS = 15;

function isEmptyCell(v: unknown): boolean {
  return v === null || v === undefined || String(v).trim() === "";
}

function rowLabel(row: unknown[]): string {
  const first = row.find((c) => !isEmptyCell(c));
  return first === undefined || first === null ? "" : String(first);
}

/**
 * Analyzes a raw sheet in place: finds the header row (or key-value layout),
 * classifies the structure and computes the alias-match score.
 */
function analyzeSheet(sheet: ParsedSheet): void {
  const { rows } = sheet;

  // 1) Header row: first row with ≥2 cells matching canonical aliases.
  for (let i = 0; i < Math.min(rows.length, MAX_HEADER_SCAN_ROWS); i++) {
    const matches = rows[i].filter(
      (c) => !isEmptyCell(c) && matchFieldAlias(String(c)) !== null
    ).length;
    if (matches >= 2) {
      sheet.headerRowIndex = i;
      sheet.headers = rows[i].map((c) => (isEmptyCell(c) ? "" : String(c)));
      break;
    }
  }

  if (sheet.headerRowIndex >= 0) {
    const mapping = detectMapping(sheet.headers);
    sheet.score = mapping.filter((m) => m.confidence === "high").length * 2 +
      mapping.filter((m) => m.confidence === "medium").length;

    const paymentCol = mapping.find((m) => m.field === "paymentMethod");
    const dataRows = rows.slice(sheet.headerRowIndex + 1).filter(
      (r) => r.filter((c) => !isEmptyCell(c)).length >= 2
    );

    if (paymentCol && paymentCol.columnIndex >= 0 && dataRows.length > 0) {
      // payment_summary: few rows whose label column values are payment
      // methods (or grand totals); ticket_detail: many rows / folio labels.
      const labelHits = dataRows.filter((r) => {
        const label = String(r[paymentCol.columnIndex] ?? "");
        return matchPaymentLabel(label) !== null || isTotalLabel(label);
      }).length;
      sheet.structure =
        dataRows.length <= MAX_PAYMENT_SUMMARY_ROWS && labelHits >= dataRows.length / 2
          ? "payment_summary"
          : "ticket_detail";
    } else {
      sheet.structure = "summary_table";
    }
    return;
  }

  // 2) Key-value layout: rows like [label, value] with recognizable labels.
  const kvRows = rows.filter((r) => {
    if (r.length < 2) return false;
    const label = rowLabel(r);
    if (!label) return false;
    return (
      matchFieldAlias(label) !== null ||
      matchPaymentLabel(label) !== null ||
      isTotalLabel(label)
    );
  });
  if (kvRows.length >= 2) {
    sheet.structure = "summary_kv";
    sheet.score = kvRows.length;
  }
}

// ---------------------------------------------------------------------------
// Column mapping detection (acceptance d)
// ---------------------------------------------------------------------------

/**
 * Proposes a column→canonical-field mapping for a header row, without
 * persisting anything. Confidence: high = exact alias, medium = fuzzy,
 * none = no column found for the field. When several columns match the same
 * field, the highest-confidence (then leftmost) column wins.
 */
export function detectMapping(headers: string[]): ColumnMapping[] {
  const best = new Map<CanonicalField, ColumnMapping>();

  headers.forEach((header, columnIndex) => {
    if (!header || !header.trim()) return;
    const match = matchFieldAlias(header);
    if (!match) return;

    const candidate: ColumnMapping = {
      field: match.field,
      columnIndex,
      columnName: header,
      confidence: match.confidence,
    };
    const current = best.get(match.field);
    if (!current || confidenceRank(candidate.confidence) > confidenceRank(current.confidence)) {
      best.set(match.field, candidate);
    }
  });

  return CANONICAL_FIELDS.map((field) => {
    const found = best.get(field);
    return found ?? { field, columnIndex: -1, columnName: null, confidence: "none" };
  });
}

function confidenceRank(c: MappingConfidence): number {
  return c === "high" ? 2 : c === "medium" ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Canonical row building + validation (acceptance a, e)
// ---------------------------------------------------------------------------

export type SalesChannel = "SALON" | "DELIVERY" | "EVENTOS" | "TOTAL";
export type SalesCutStatus = "VALIDATED" | "PENDING_REVIEW";
type PaymentBucketName = "CASH" | "CARD" | "DELIVERY" | "OTHER";

/** Canonical sales-cut data (acceptance a). Money in integer cents (AD-5). */
export interface CanonicalSalesData {
  businessDate: string | null; // YYYY-MM-DD
  totalSales: number | null;
  cashSales: number | null;
  cardSales: number | null;
  otherPayments: number | null;
  ticketCount: number | null;
  taxAmount: number | null;
  discounts: number | null;
  cancellations: number | null;
  /** Fase 3: per-aggregator sales (rappi/uber/didi/…), cents. */
  aggregatorSales: Record<string, number> | null;
}

export interface ComputedCut {
  channel: SalesChannel;
  data: CanonicalSalesData;
}

export interface BuildResult {
  fileShape: FileShape;
  businessDate: string | null;
  cuts: ComputedCut[];
  /** Soft problems — the cut is stored as PENDING_REVIEW with these notes. */
  issues: string[];
  /** Hard problems — ingestion is rejected; preview returns them as-is. */
  errors: string[];
  mapping: ColumnMapping[];
  /** Up to N rows mapped to canonical fields, for the confirmation UI. */
  previewRows: Array<Record<string, unknown>>;
}

export interface PreviewResult extends BuildResult {
  fileName: string;
  status: SalesCutStatus;
}

const MONEY_FIELDS: CanonicalField[] = [
  "totalSales",
  "cashSales",
  "cardSales",
  "otherPayments",
  "taxAmount",
  "discounts",
  "cancellations",
];

const SQUARE_TOLERANCE = 0.02; // ±2% between payment sum and declared total

/** Intermediate aggregation shared by all four structure builders. */
interface Aggregation {
  fileDate: string | null;
  distinctDates: number;
  /** Declared grand total (column value or "Total" row), if the file has one. */
  declaredTotal: number | null;
  declaredTickets: number | null;
  /** Sum of per-row/per-ticket amounts (payment structures). */
  computedTotal: number | null;
  buckets: Partial<Record<PaymentBucketName, number>>;
  bucketTickets: Partial<Record<PaymentBucketName, number>>;
  /** Fase 3: cents per aggregator key (rappi/uber/didi/…). */
  aggregatorSales: Record<string, number>;
  ticketCount: number | null;
  taxAmount: number | null;
  discounts: number | null;
  cancellations: number | null;
  unrecognizedLabels: string[];
  rowsWithoutAmount: number;
}

function emptyAggregation(): Aggregation {
  return {
    fileDate: null,
    distinctDates: 0,
    declaredTotal: null,
    declaredTickets: null,
    computedTotal: null,
    buckets: {},
    bucketTickets: {},
    aggregatorSales: {},
    ticketCount: null,
    taxAmount: null,
    discounts: null,
    cancellations: null,
    unrecognizedLabels: [],
    rowsWithoutAmount: 0,
  };
}

function cellAt(row: unknown[], mapping: ColumnMapping[], field: CanonicalField): unknown {
  const col = mapping.find((m) => m.field === field);
  if (!col || col.columnIndex < 0) return null;
  return row[col.columnIndex] ?? null;
}

/** Most frequent date wins; returns it plus how many distinct dates exist. */
function modalDate(dates: string[]): { date: string | null; distinct: number } {
  const counts = new Map<string, number>();
  for (const d of dates) counts.set(d, (counts.get(d) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [date, count] of counts) {
    if (count > bestCount) {
      best = date;
      bestCount = count;
    }
  }
  return { date: best, distinct: counts.size };
}

function addBucket(agg: Aggregation, bucket: PaymentBucketName, cents: number, tickets: number | null) {
  agg.buckets[bucket] = (agg.buckets[bucket] ?? 0) + cents;
  if (tickets !== null && tickets > 0) {
    agg.bucketTickets[bucket] = (agg.bucketTickets[bucket] ?? 0) + tickets;
  }
}

/** Fase 3: accumulates cents under the aggregator key when the label matches. */
function addAggregator(agg: Aggregation, label: string, cents: number) {
  const key = matchAggregatorLabel(label);
  if (!key) return;
  agg.aggregatorSales[key] = (agg.aggregatorSales[key] ?? 0) + cents;
}

function dataRows(sheet: ParsedSheet): unknown[][] {
  return sheet.rows
    .slice(sheet.headerRowIndex + 1)
    .filter((r) => r.filter((c) => !isEmptyCell(c)).length >= 2);
}

/** summary_kv: rows of [label, value] with field-alias or payment labels. */
function buildFromKeyValue(sheet: ParsedSheet, agg: Aggregation, previewRows: Array<Record<string, unknown>>, maxRows: number): void {
  for (const row of sheet.rows) {
    const labelIdx = row.findIndex((c) => !isEmptyCell(c));
    if (labelIdx < 0) continue;
    const label = String(row[labelIdx]);
    const value = row.slice(labelIdx + 1).find((c) => !isEmptyCell(c));

    const fieldMatch = matchFieldAlias(label);
    const bucket = matchPaymentLabel(label);
    if (!fieldMatch && !bucket) continue; // titles, blank separators…
    if (value === undefined || value === null) continue;

    if (previewRows.length < maxRows) {
      previewRows.push({ campo: label, valor: value instanceof Date ? value.toISOString().slice(0, 10) : value });
    }

    if (fieldMatch && fieldMatch.field !== "paymentMethod" && fieldMatch.field !== "category") {
      assignCanonicalValue(agg, fieldMatch.field, value);
    } else if (bucket) {
      const cents = parseMoneyToCents(value);
      if (cents !== null) addBucket(agg, bucket, cents, null);
    }
  }
}

/** summary_table: header + data rows; money fields summed across rows. */
function buildFromSummaryTable(sheet: ParsedSheet, mapping: ColumnMapping[], agg: Aggregation, previewRows: Array<Record<string, unknown>>, maxRows: number): void {
  const dates: string[] = [];
  for (const row of dataRows(sheet)) {
    for (const field of MONEY_FIELDS) {
      const cents = parseMoneyToCents(cellAt(row, mapping, field));
      if (cents === null) continue;
      if (field === "totalSales") agg.declaredTotal = (agg.declaredTotal ?? 0) + cents;
      else if (field === "cashSales") addBucket(agg, "CASH", cents, null);
      else if (field === "cardSales") addBucket(agg, "CARD", cents, null);
      else if (field === "otherPayments") addBucket(agg, "OTHER", cents, null);
      else if (field === "taxAmount") agg.taxAmount = (agg.taxAmount ?? 0) + cents;
      else if (field === "discounts") agg.discounts = (agg.discounts ?? 0) + cents;
      else if (field === "cancellations") agg.cancellations = (agg.cancellations ?? 0) + cents;
    }
    const tickets = parseCount(cellAt(row, mapping, "ticketCount"));
    if (tickets !== null) agg.ticketCount = (agg.ticketCount ?? 0) + tickets;

    const date = parseBusinessDate(cellAt(row, mapping, "businessDate"));
    if (date) dates.push(date);

    if (previewRows.length < maxRows) previewRows.push(tabularPreviewRow(row, mapping));
  }
  const modal = modalDate(dates);
  agg.fileDate = modal.date;
  agg.distinctDates = modal.distinct;
}

/** payment_summary: one row per payment method (+ optional grand-total row). */
function buildFromPaymentSummary(sheet: ParsedSheet, mapping: ColumnMapping[], agg: Aggregation, previewRows: Array<Record<string, unknown>>, maxRows: number): void {
  let computed = 0;
  let hasComputed = false;

  for (const row of dataRows(sheet)) {
    const label = String(cellAt(row, mapping, "paymentMethod") ?? "").trim();
    if (!label) continue;
    const cents = parseMoneyToCents(cellAt(row, mapping, "totalSales"));
    const tickets = parseCount(cellAt(row, mapping, "ticketCount"));

    if (isTotalLabel(label)) {
      agg.declaredTotal = cents;
      agg.declaredTickets = tickets;
      continue;
    }
    if (cents === null) {
      agg.rowsWithoutAmount++;
      continue;
    }

    const bucket = matchPaymentLabel(label);
    if (!bucket) {
      if (!agg.unrecognizedLabels.includes(label)) agg.unrecognizedLabels.push(label);
      addBucket(agg, "OTHER", cents, tickets);
    } else {
      addBucket(agg, bucket, cents, tickets);
    }
    addAggregator(agg, label, cents);
    computed += cents;
    hasComputed = true;

    if (previewRows.length < maxRows) {
      previewRows.push({ paymentMethod: label, bucket: bucket ?? "OTHER", totalSales: cents, ticketCount: tickets });
    }
  }
  agg.computedTotal = hasComputed ? computed : null;
}

/** ticket_detail: one row per ticket; aggregate by payment bucket + count. */
function buildFromTicketDetail(sheet: ParsedSheet, mapping: ColumnMapping[], agg: Aggregation, previewRows: Array<Record<string, unknown>>, maxRows: number): void {
  let computed = 0;
  let tickets = 0;
  const dates: string[] = [];

  for (const row of dataRows(sheet)) {
    const cents = parseMoneyToCents(cellAt(row, mapping, "totalSales"));
    if (cents === null) {
      agg.rowsWithoutAmount++;
      continue;
    }
    const label = String(cellAt(row, mapping, "paymentMethod") ?? "").trim();
    const bucket = matchPaymentLabel(label);
    if (label && !bucket && !agg.unrecognizedLabels.includes(label)) {
      agg.unrecognizedLabels.push(label);
    }
    addBucket(agg, bucket ?? "OTHER", cents, 1);
    addAggregator(agg, label, cents);
    computed += cents;
    tickets++;

    const date = parseBusinessDate(cellAt(row, mapping, "businessDate"));
    if (date) dates.push(date);

    const tax = parseMoneyToCents(cellAt(row, mapping, "taxAmount"));
    if (tax !== null) agg.taxAmount = (agg.taxAmount ?? 0) + tax;
    const discount = parseMoneyToCents(cellAt(row, mapping, "discounts"));
    if (discount !== null) agg.discounts = (agg.discounts ?? 0) + discount;
    const cancelled = parseMoneyToCents(cellAt(row, mapping, "cancellations"));
    if (cancelled !== null) agg.cancellations = (agg.cancellations ?? 0) + cancelled;

    if (previewRows.length < maxRows) {
      previewRows.push({ ...tabularPreviewRow(row, mapping), bucket: bucket ?? "OTHER" });
    }
  }

  agg.computedTotal = tickets > 0 ? computed : null;
  agg.ticketCount = tickets > 0 ? tickets : null;
  const modal = modalDate(dates);
  agg.fileDate = modal.date;
  agg.distinctDates = modal.distinct;
}

function tabularPreviewRow(row: unknown[], mapping: ColumnMapping[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const m of mapping) {
    if (m.columnIndex < 0) continue;
    const raw = row[m.columnIndex];
    if (raw === null || raw === undefined) continue;
    if (MONEY_FIELDS.includes(m.field)) {
      const cents = parseMoneyToCents(raw);
      if (cents !== null) out[m.field] = cents;
    } else if (m.field === "businessDate") {
      const date = parseBusinessDate(raw);
      if (date) out[m.field] = date;
    } else if (m.field === "ticketCount") {
      const count = parseCount(raw);
      if (count !== null) out[m.field] = count;
    } else {
      out[m.field] = raw instanceof Date ? raw.toISOString().slice(0, 10) : raw;
    }
  }
  return out;
}

function assignCanonicalValue(agg: Aggregation, field: CanonicalField, value: unknown): void {
  if (MONEY_FIELDS.includes(field)) {
    const cents = parseMoneyToCents(value);
    if (cents === null) return;
    if (field === "totalSales") agg.declaredTotal = cents;
    else if (field === "cashSales") addBucket(agg, "CASH", cents, null);
    else if (field === "cardSales") addBucket(agg, "CARD", cents, null);
    else if (field === "otherPayments") addBucket(agg, "OTHER", cents, null);
    else if (field === "taxAmount") agg.taxAmount = cents;
    else if (field === "discounts") agg.discounts = cents;
    else if (field === "cancellations") agg.cancellations = cents;
  } else if (field === "ticketCount") {
    const count = parseCount(value);
    if (count !== null) agg.ticketCount = count;
  } else if (field === "businessDate") {
    const date = parseBusinessDate(value);
    if (date) {
      agg.fileDate = date;
      agg.distinctDates = 1;
    }
  }
}

/**
 * Builds and validates canonical cuts from a parsed file — the full
 * ingestion pipeline minus persistence. `opts.businessDate` is the manual
 * fallback from the upload form when the file carries no date.
 */
export function buildSalesCut(
  parsed: ParsedSalesFile,
  opts: { businessDate?: string; maxPreviewRows?: number } = {}
): BuildResult {
  const sheet = parsed.primarySheet;
  const maxRows = opts.maxPreviewRows ?? 10;
  const mapping = sheet.headers.length > 0 ? detectMapping(sheet.headers) : [];
  const agg = emptyAggregation();
  const previewRows: Array<Record<string, unknown>> = [];

  switch (sheet.structure) {
    case "summary_kv":
      buildFromKeyValue(sheet, agg, previewRows, maxRows);
      break;
    case "summary_table":
      buildFromSummaryTable(sheet, mapping, agg, previewRows, maxRows);
      break;
    case "payment_summary":
      buildFromPaymentSummary(sheet, mapping, agg, previewRows, maxRows);
      break;
    case "ticket_detail":
      buildFromTicketDetail(sheet, mapping, agg, previewRows, maxRows);
      break;
    default:
      return {
        fileShape: parsed.fileShape,
        businessDate: null,
        cuts: [],
        issues: [],
        errors: ["No se pudo identificar la estructura del archivo."],
        mapping,
        previewRows,
      };
  }

  const issues: string[] = [];
  const errors: string[] = [];

  // -- businessDate: file wins, manual fallback, never future --------------
  const businessDate = agg.fileDate ?? (opts.businessDate ? parseBusinessDate(opts.businessDate) : null);
  if (!businessDate) {
    errors.push("No se pudo determinar la fecha del corte: el archivo no la incluye y no se proporcionó una fecha manual.");
  } else {
    const mxToday = new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
    if (businessDate > mxToday) {
      errors.push(`La fecha del corte (${businessDate}) es futura.`);
    }
  }
  if (agg.distinctDates > 1) {
    issues.push(`El archivo contiene datos de ${agg.distinctDates} fechas distintas; se usó la más frecuente (${agg.fileDate}).`);
  }

  // -- totalSales: required, > 0 --------------------------------------------
  const totalSales = agg.declaredTotal ?? agg.computedTotal;
  if (totalSales === null) {
    errors.push("No se encontró el total de ventas del corte.");
  } else if (totalSales <= 0) {
    errors.push("El total de ventas debe ser mayor a cero.");
  }

  // -- ticketCount: > 0 when present ----------------------------------------
  const bucketTicketSum = Object.values(agg.bucketTickets).reduce((a, b) => (a ?? 0) + (b ?? 0), 0) ?? 0;
  const ticketCount = bucketTicketSum > 0 ? bucketTicketSum : agg.ticketCount;
  if (ticketCount !== null && ticketCount <= 0) {
    errors.push("El número de tickets debe ser mayor a cero.");
  } else if (ticketCount === null) {
    issues.push("El archivo no incluye el número de tickets.");
  }

  if (agg.rowsWithoutAmount > 0) {
    issues.push(`Se ignoraron ${agg.rowsWithoutAmount} filas sin monto válido.`);
  }
  if (agg.unrecognizedLabels.length > 0) {
    issues.push(`Formas de pago no reconocidas (sumadas a Otros): ${agg.unrecognizedLabels.join(", ")}.`);
  }

  // -- square check: components ≈ total (±2%) --------------------------------
  const cash = agg.buckets.CASH ?? null;
  const card = agg.buckets.CARD ?? null;
  const other = agg.buckets.OTHER ?? null;
  const delivery = agg.buckets.DELIVERY ?? null;
  const components = [cash, card, other, delivery].filter((v): v is number => v !== null);

  if (totalSales !== null && totalSales > 0 && components.length >= 2) {
    const sum = components.reduce((a, b) => a + b, 0);
    const diff = Math.abs(sum - totalSales);
    if (diff > Math.round(totalSales * SQUARE_TOLERANCE)) {
      const pct = ((diff / totalSales) * 100).toFixed(1);
      issues.push(
        `La suma de formas de pago (${formatMXN(sum)}) no cuadra con el total (${formatMXN(totalSales)}): diferencia del ${pct}%.`
      );
    }
  }

  // -- channel split: DELIVERY bucket breaks out of the TOTAL ---------------
  const cuts: ComputedCut[] = [];
  if (!errors.length && totalSales !== null && businessDate) {
    const base: CanonicalSalesData = {
      businessDate,
      totalSales,
      cashSales: cash,
      cardSales: card,
      otherPayments: other,
      ticketCount,
      taxAmount: agg.taxAmount,
      discounts: agg.discounts,
      cancellations: agg.cancellations,
      aggregatorSales:
        Object.keys(agg.aggregatorSales).length > 0 ? { ...agg.aggregatorSales } : null,
    };

    if (delivery !== null && delivery > 0 && totalSales - delivery > 0) {
      const salonTotal = totalSales - delivery;
      let salonTickets: number | null = ticketCount;
      let deliveryTickets: number | null = null;
      if (bucketTicketSum > 0) {
        salonTickets = (agg.bucketTickets.CASH ?? 0) + (agg.bucketTickets.CARD ?? 0) + (agg.bucketTickets.OTHER ?? 0);
        deliveryTickets = agg.bucketTickets.DELIVERY ?? null;
      } else if (ticketCount !== null && ticketCount > 0) {
        // Only a global count exists → split proportionally by amount.
        salonTickets = Math.round((ticketCount * salonTotal) / totalSales);
        deliveryTickets = ticketCount - salonTickets;
      }
      cuts.push({
        channel: "SALON",
        data: {
          ...base,
          totalSales: salonTotal,
          otherPayments: other,
          ticketCount: salonTickets,
          // Fase 3: el desglose por agregador pertenece al canal DELIVERY.
          aggregatorSales: null,
        },
      });
      cuts.push({
        channel: "DELIVERY",
        data: {
          ...base,
          totalSales: delivery,
          cashSales: null,
          cardSales: null,
          otherPayments: delivery,
          ticketCount: deliveryTickets,
        },
      });
    } else if (delivery !== null && delivery > 0 && totalSales - delivery === 0) {
      cuts.push({
        channel: "DELIVERY",
        data: {
          ...base,
          cashSales: null,
          cardSales: null,
          otherPayments: delivery,
        },
      });
    } else {
      cuts.push({ channel: "TOTAL", data: base });
    }
  }

  return { fileShape: parsed.fileShape, businessDate, cuts, issues, errors, mapping, previewRows };
}

function formatMXN(cents: number): string {
  return (cents / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

/**
 * Runs the full pipeline without persisting — powers the upload
 * confirmation UI (T28) and the mapping-template preview (T29).
 */
export async function previewSalesCut(params: {
  buffer: Buffer;
  fileName: string;
  businessDate?: string;
  maxPreviewRows?: number;
}): Promise<PreviewResult> {
  const parsed = await parseSalesFile(params.buffer, params.fileName);
  const built = buildSalesCut(parsed, {
    businessDate: params.businessDate,
    maxPreviewRows: params.maxPreviewRows,
  });
  return {
    ...built,
    fileName: params.fileName,
    status: built.issues.length === 0 ? "VALIDATED" : "PENDING_REVIEW",
  };
}

// ---------------------------------------------------------------------------
// Persistence (acceptance e): ingestSalesCut
// ---------------------------------------------------------------------------

export type SalesCutShift = "MATUTINO" | "VESPERTINO" | "COMPLETO";
export type SalesCutSource = "UPLOAD" | "WHATSAPP" | "MANUAL_FORM";

export interface IngestedRow {
  id: string;
  channel: SalesChannel;
  status: SalesCutStatus;
  totalSales: number;
}

export interface IngestResult extends PreviewResult {
  rows: IngestedRow[];
}

/**
 * Full ingestion: parse → map → validate → reject duplicates → persist.
 * Throws SalesIngestionError with a legible Spanish reason on hard failures
 * (missing data, future date, duplicate). Soft issues persist the cut as
 * PENDING_REVIEW with validationNotes. All channel rows are inserted in a
 * single statement so a partial ingest can't leave orphan channels.
 */
export async function ingestSalesCut(params: {
  companyId: string;
  branchId: string;
  buffer: Buffer;
  fileName: string;
  shift: SalesCutShift;
  source: SalesCutSource;
  businessDate?: string;
  receivedBy?: string;
  rawFileUrl?: string;
}): Promise<IngestResult> {
  const parsed = await parseSalesFile(params.buffer, params.fileName);
  const built = buildSalesCut(parsed, { businessDate: params.businessDate });

  if (built.errors.length > 0) {
    throw new SalesIngestionError("VALIDATION_FAILED", built.errors.join(" "));
  }
  if (built.cuts.length === 0 || !built.businessDate) {
    throw new SalesIngestionError(
      "VALIDATION_FAILED",
      "No se pudo construir el corte de ventas a partir del archivo."
    );
  }

  // Duplicate rejection: one cut per (branch, date, shift, channel).
  const channels = built.cuts.map((c) => c.channel);
  const existing = await db
    .select({ channel: dailySalesCuts.channel })
    .from(dailySalesCuts)
    .where(
      and(
        eq(dailySalesCuts.companyId, params.companyId),
        eq(dailySalesCuts.branchId, params.branchId),
        eq(dailySalesCuts.businessDate, built.businessDate),
        eq(dailySalesCuts.shift, params.shift),
        inArray(dailySalesCuts.channel, channels)
      )
    );
  if (existing.length > 0) {
    throw new SalesIngestionError(
      "DUPLICATE_CUT",
      `Ya existe un corte (${existing.map((e) => e.channel).join(", ")}) para esta sucursal el ${built.businessDate} en turno ${params.shift}. Si necesitas corregirlo, elimina el corte existente primero.`
    );
  }

  const status: SalesCutStatus = built.issues.length === 0 ? "VALIDATED" : "PENDING_REVIEW";
  const validationNotes = built.issues.length > 0 ? built.issues.join("\n") : null;

  const inserted = await db
    .insert(dailySalesCuts)
    .values(
      built.cuts.map((cut) => ({
        companyId: params.companyId,
        branchId: params.branchId,
        businessDate: built.businessDate!,
        shift: params.shift,
        channel: cut.channel,
        totalSales: cut.data.totalSales!,
        cashSales: cut.data.cashSales,
        cardSales: cut.data.cardSales,
        otherPayments: cut.data.otherPayments,
        aggregatorSales: cut.data.aggregatorSales ?? null,
        ticketCount: cut.data.ticketCount,
        avgTicket:
          cut.data.ticketCount && cut.data.ticketCount > 0
            ? Math.round(cut.data.totalSales! / cut.data.ticketCount)
            : null,
        source: params.source,
        rawFileUrl: params.rawFileUrl ?? null,
        status,
        validationNotes,
        receivedBy: params.receivedBy ?? null,
      }))
    )
    .returning({
      id: dailySalesCuts.id,
      channel: dailySalesCuts.channel,
      status: dailySalesCuts.status,
      totalSales: dailySalesCuts.totalSales,
    });

  return {
    ...built,
    fileName: params.fileName,
    status,
    rows: inserted as IngestedRow[],
  };
}

// Re-exported so the API/UI layers (T28/T29) and tests use one entry point.
export { parseBusinessDate, parseCount, parseMoneyToCents, matchPaymentLabel, matchAggregatorLabel };
