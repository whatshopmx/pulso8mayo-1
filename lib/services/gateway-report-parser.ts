import ExcelJS from "exceljs";
import { parseCsv } from "./sales-ingestion-service";
import { ApiError } from "@/lib/api/error";

export type AcquirerType =
  | "CLIP"
  | "MERCADO_PAGO"
  | "BBVA"
  | "BANORTE"
  | "SANTANDER"
  | "OTHER";

export interface ParsedGatewayTransaction {
  externalId: string;
  authorizationCode: string | null;
  transactionDate: Date;
  cardLast4: string | null;
  cardBrand: string | null;
  cardType: "CREDIT" | "DEBIT" | "OTHER";
  grossAmountCents: number;
  feeAmountCents: number;
  feeVatCents: number;
  netAmountCents: number;
  settlementDate: string | null;
  batchNumber: string | null;
  status: "SETTLED" | "REFUNDED" | "DISPUTED" | "CANCELLED";
}

export interface ParseGatewayReportResult {
  acquirer: AcquirerType;
  fileName: string;
  totalTransactions: number;
  totalGrossCents: number;
  totalFeeCents: number;
  totalFeeVatCents: number;
  totalNetCents: number;
  transactions: ParsedGatewayTransaction[];
}

/** Sinónimos normalizados para detección automática de columnas */
const COLUMN_SYNONYMS = {
  date: [
    "fecha",
    "date",
    "fecha y hora",
    "date_created",
    "fecha_transaccion",
    "fechatransaccion",
    "timestamp",
    "hora",
    "fecha/hora",
    "fecha_hora",
  ],
  externalId: [
    "id de transaccion",
    "id transaccion",
    "operation_id",
    "referencia",
    "payment_id",
    "transaction_id",
    "folio",
    "id de operacion",
    "id de pago",
    "id pago",
    "id",
  ],
  auth: [
    "autorizacion",
    "autorización",
    "authorization_code",
    "codigo de autorizacion",
    "código de autorización",
    "folio de autorizacion",
    "folio autorizacion",
    "auth",
    "aut",
    "num_aut",
    "codigo autorizacion",
  ],
  cardLast4: [
    "tarjeta",
    "card",
    "last_four_digits",
    "ultimos 4",
    "cuenta",
    "ultimos digitos",
    "pan",
    "terminacion",
    "terminación",
  ],
  cardBrand: [
    "marca",
    "brand",
    "payment_method_id",
    "emisor",
    "tipo de tarjeta",
    "franquicia",
  ],
  gross: [
    "monto",
    "monto bruto",
    "importe",
    "total",
    "transaction_amount",
    "venta",
    "importe bruto",
    "total cobrado",
    "monto cobrado",
    "bruto",
    "consumo",
  ],
  fee: [
    "comision",
    "comisión",
    "fee",
    "mercadopago_fee",
    "descuento",
    "comision clip",
    "tarifa",
    "retencion",
    "comisión base",
  ],
  feeVat: [
    "iva comision",
    "iva comisión",
    "taxes_amount",
    "iva de comision",
    "iva de la comisión",
    "iva",
    "impuesto comision",
  ],
  net: [
    "monto neto",
    "neto",
    "net_received_amount",
    "abono neto",
    "deposito",
    "abono",
    "total a depositar",
    "liquidacion",
    "liquidación",
    "importe neto",
  ],
  batch: [
    "lote",
    "batch",
    "numero de lote",
    "número de lote",
    "folio de lote",
    "batch_number",
  ],
  settlementDate: [
    "fecha de liquidacion",
    "fecha de liquidación",
    "fecha de deposito",
    "fecha de depósito",
    "fecha abono",
    "settlement_date",
    "fecha pago",
    "fecha valor",
  ],
};

/**
 * Parsea un archivo de reporte de pasarela (CSV o XLSX) extrayendo transacciones normalizadas.
 */
export async function parseGatewayReport(
  buffer: Buffer,
  fileName: string,
  preferredAcquirer?: AcquirerType
): Promise<ParseGatewayReportResult> {
  const lower = fileName.toLowerCase();
  let rawRows: unknown[][] = [];

  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    rawRows = parseCsv(buffer.toString("utf8"));
  } else if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw ApiError.badRequest(
        "No se pudo leer el archivo Excel. Verifica que sea un .xlsx válido."
      );
    }
    const ws = workbook.worksheets[0];
    if (ws) {
      ws.eachRow({ includeEmpty: false }, (row) => {
        const cells: unknown[] = [];
        for (let i = 1; i <= row.cellCount; i++) {
          cells.push(row.getCell(i).value);
        }
        rawRows.push(cells);
      });
    }
  } else {
    throw ApiError.badRequest(
      `Formato de archivo no compatible para "${fileName}". Sube un archivo .csv o .xlsx.`
    );
  }

  if (rawRows.length === 0) {
    throw ApiError.badRequest("El archivo está vacío o no contiene datos.");
  }

  // 1. Encontrar la fila de encabezados
  let headerIndex = -1;
  let headers: string[] = [];

  for (let r = 0; r < Math.min(rawRows.length, 15); r++) {
    const row = rawRows[r];
    const stringCells = row.map((c) =>
      typeof c === "string"
        ? c.toLowerCase().trim()
        : String(c ?? "").toLowerCase().trim()
    );

    // Contar cuántos sinónimos conocidos coinciden en esta fila
    let matchCount = 0;
    for (const cell of stringCells) {
      if (!cell) continue;
      const clean = cell.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (
        COLUMN_SYNONYMS.date.some((s) => clean.includes(s)) ||
        COLUMN_SYNONYMS.gross.some((s) => clean.includes(s)) ||
        COLUMN_SYNONYMS.fee.some((s) => clean.includes(s)) ||
        COLUMN_SYNONYMS.auth.some((s) => clean.includes(s)) ||
        COLUMN_SYNONYMS.externalId.some((s) => clean.includes(s))
      ) {
        matchCount++;
      }
    }

    if (matchCount >= 2) {
      headerIndex = r;
      headers = stringCells;
      break;
    }
  }

  if (headerIndex === -1) {
    throw ApiError.badRequest(
      "No se pudieron identificar las columnas del reporte de pasarela (fecha, monto, comisión). Revisa los encabezados del archivo."
    );
  }

  // 2. Mapear índice de cada columna canónica
  const getColIdx = (synonyms: string[]): number => {
    // 1. Coincidencia exacta
    const exact = headers.findIndex((h) => {
      const clean = h.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return synonyms.some((syn) => clean === syn);
    });
    if (exact !== -1) return exact;

    // 2. Coincidencia por subcadena ordenada de más larga a más corta (mínimo 4 caracteres o coincidencia de palabra completa)
    const sorted = [...synonyms].sort((a, b) => b.length - a.length);
    return headers.findIndex((h) => {
      const clean = h.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return sorted.some((syn) => {
        if (syn.length <= 3) {
          const words = clean.split(/[\s_/,-]+/);
          return words.includes(syn);
        }
        return clean.includes(syn);
      });
    });
  };

  const colDate = getColIdx(COLUMN_SYNONYMS.date);
  const colExternalId = getColIdx(COLUMN_SYNONYMS.externalId);
  const colAuth = getColIdx(COLUMN_SYNONYMS.auth);
  const colCardLast4 = getColIdx(COLUMN_SYNONYMS.cardLast4);
  const colCardBrand = getColIdx(COLUMN_SYNONYMS.cardBrand);
  const colGross = getColIdx(COLUMN_SYNONYMS.gross);
  const colFee = getColIdx(COLUMN_SYNONYMS.fee);
  const colFeeVat = getColIdx(COLUMN_SYNONYMS.feeVat);
  const colNet = getColIdx(COLUMN_SYNONYMS.net);
  const colBatch = getColIdx(COLUMN_SYNONYMS.batch);
  const colSettlement = getColIdx(COLUMN_SYNONYMS.settlementDate);

  if (colGross === -1) {
    throw ApiError.badRequest(
      "El reporte debe incluir una columna con el monto de la transacción (monto, importe, total)."
    );
  }

  // 3. Determinar adquirente si no se especificó
  let detectedAcquirer: AcquirerType = preferredAcquirer || "OTHER";
  if (!preferredAcquirer) {
    const fullHeaderStr = headers.join(" ");
    if (fullHeaderStr.includes("clip")) {
      detectedAcquirer = "CLIP";
    } else if (
      fullHeaderStr.includes("mercadopago") ||
      fullHeaderStr.includes("operation_id")
    ) {
      detectedAcquirer = "MERCADO_PAGO";
    } else if (fullHeaderStr.includes("bbva")) {
      detectedAcquirer = "BBVA";
    } else if (fullHeaderStr.includes("banorte")) {
      detectedAcquirer = "BANORTE";
    } else if (fullHeaderStr.includes("santander")) {
      detectedAcquirer = "SANTANDER";
    }
  }

  // 4. Parsear filas de transacciones
  const transactions: ParsedGatewayTransaction[] = [];
  let totalGrossCents = 0;
  let totalFeeCents = 0;
  let totalFeeVatCents = 0;
  let totalNetCents = 0;

  for (let r = headerIndex + 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!row || row.length === 0) continue;

    // Ignorar filas de pie de página / resúmenes / totales
    const firstCells = row
      .slice(0, 3)
      .map((c) => String(c ?? "").toLowerCase().trim())
      .join(" ");
    if (
      firstCells.includes("total") ||
      firstCells.includes("resumen") ||
      firstCells.includes("suma")
    ) {
      continue;
    }

    // Obtener y parsear monto bruto
    const grossRaw = row[colGross];
    const grossCents = parseMoneyCents(grossRaw);
    if (grossCents === null || grossCents <= 0) {
      // Ignorar filas sin monto o vacías
      continue;
    }

    // Fecha
    const dateRaw = colDate !== -1 ? row[colDate] : null;
    const dateObj = parseTransactionDate(dateRaw);

    // Folio de autorización
    const authCodeRaw = colAuth !== -1 ? row[colAuth] : null;
    const authorizationCode = authCodeRaw ? String(authCodeRaw).trim() : null;

    // ID externo
    let externalId: string;
    const extIdRaw = colExternalId !== -1 ? row[colExternalId] : null;
    if (extIdRaw && String(extIdRaw).trim() !== "") {
      externalId = String(extIdRaw).trim();
    } else {
      // Si no viene ID de pasarela, generamos llave determinística
      const dateStr = dateObj.toISOString().slice(0, 10);
      externalId = `${detectedAcquirer}_${dateStr}_${authorizationCode || "NOAUTH"}_${grossCents}_${r}`;
    }

    // Tarjeta
    const cardRaw = colCardLast4 !== -1 ? row[colCardLast4] : null;
    let cardLast4: string | null = null;
    if (cardRaw) {
      const digits = String(cardRaw).replace(/\D/g, "");
      if (digits.length >= 4) {
        cardLast4 = digits.slice(-4);
      }
    }

    // Marca
    const brandRaw = colCardBrand !== -1 ? row[colCardBrand] : null;
    const cardBrand = brandRaw ? normalizeCardBrand(String(brandRaw)) : null;
    const cardType = inferCardType(brandRaw);

    // Comisión e IVA
    const feeRaw = colFee !== -1 ? row[colFee] : null;
    let feeCents = parseMoneyCents(feeRaw) ?? 0;
    // La comisión en algunos reportes viene en negativo (ej. -$3.50); la normalizamos a positivo
    feeCents = Math.abs(feeCents);

    const feeVatRaw = colFeeVat !== -1 ? row[colFeeVat] : null;
    let feeVatCents: number;
    if (feeVatRaw !== null && feeVatRaw !== undefined) {
      feeVatCents = Math.abs(parseMoneyCents(feeVatRaw) ?? 0);
    } else {
      // Si el reporte no desglosa el IVA por separado, se calcula el 16% sobre la comisión retenida
      feeVatCents = Math.round(feeCents * 0.16);
    }

    // Monto neto
    const netRaw = colNet !== -1 ? row[colNet] : null;
    let netCents: number;
    if (netRaw !== null && netRaw !== undefined) {
      const parsedNet = parseMoneyCents(netRaw);
      netCents = parsedNet !== null ? Math.abs(parsedNet) : grossCents - feeCents - feeVatCents;
    } else {
      netCents = grossCents - feeCents - feeVatCents;
    }

    // Lote y fecha de liquidación
    const batchRaw = colBatch !== -1 ? row[colBatch] : null;
    const batchNumber = batchRaw ? String(batchRaw).trim() : null;

    const settlementRaw = colSettlement !== -1 ? row[colSettlement] : null;
    let settlementDate: string | null = null;
    if (settlementRaw) {
      const sDate = parseTransactionDate(settlementRaw);
      settlementDate = sDate.toISOString().slice(0, 10);
    }

    const tx: ParsedGatewayTransaction = {
      externalId,
      authorizationCode,
      transactionDate: dateObj,
      cardLast4,
      cardBrand,
      cardType,
      grossAmountCents: grossCents,
      feeAmountCents: feeCents,
      feeVatCents,
      netAmountCents: netCents,
      settlementDate,
      batchNumber,
      status: "SETTLED",
    };

    transactions.push(tx);
    totalGrossCents += grossCents;
    totalFeeCents += feeCents;
    totalFeeVatCents += feeVatCents;
    totalNetCents += netCents;
  }

  return {
    acquirer: detectedAcquirer,
    fileName,
    totalTransactions: transactions.length,
    totalGrossCents,
    totalFeeCents,
    totalFeeVatCents,
    totalNetCents,
    transactions,
  };
}

/** Limpia y convierte texto o número a centavos (ej: "$1,250.50" -> 125050) */
export function parseMoneyCents(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "number") {
    if (isNaN(val)) return null;
    return Math.round(val * 100);
  }

  const str = String(val).trim().replace(/[$,\s]/g, "");
  if (!str) return null;
  const num = parseFloat(str);
  if (isNaN(num)) return null;
  return Math.round(num * 100);
}

/** Parsea fechas en distintos formatos comunes de reportes bancarios y de pasarela */
export function parseTransactionDate(val: unknown): Date {
  if (!val) return new Date();
  if (val instanceof Date && !isNaN(val.getTime())) {
    return val;
  }

  const str = String(val).trim();
  if (!str) return new Date();

  // Caso DD/MM/YYYY o DD-MM-YYYY con hora opcional
  const ddmmyyyy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
  const match = str.match(ddmmyyyy);
  if (match) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const year = parseInt(match[3], 10);
    const hour = match[4] ? parseInt(match[4], 10) : 12;
    const minute = match[5] ? parseInt(match[5], 10) : 0;
    const second = match[6] ? parseInt(match[6], 10) : 0;
    return new Date(Date.UTC(year, month, day, hour, minute, second));
  }

  // Intento estándar ISO / Date.parse
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  return new Date();
}

function normalizeCardBrand(brandStr: string): string {
  const upper = brandStr.toUpperCase().trim();
  if (upper.includes("VISA")) return "VISA";
  if (upper.includes("MASTER") || upper.includes("MC")) return "MASTERCARD";
  if (upper.includes("AMEX") || upper.includes("AMERICAN")) return "AMEX";
  if (upper.includes("CARNET")) return "CARNET";
  return upper;
}

function inferCardType(brandOrTypeStr: unknown): "CREDIT" | "DEBIT" | "OTHER" {
  if (!brandOrTypeStr) return "OTHER";
  const str = String(brandOrTypeStr).toUpperCase();
  if (str.includes("CREDIT") || str.includes("CRÉDITO") || str.includes("CREDITO")) {
    return "CREDIT";
  }
  if (str.includes("DEBIT") || str.includes("DÉBITO") || str.includes("DEBITO")) {
    return "DEBIT";
  }
  return "OTHER";
}
