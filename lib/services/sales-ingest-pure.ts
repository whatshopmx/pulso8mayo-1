// lib/services/sales-ingest-pure.ts
//
// T6 (`tasks/plan-inventario-desconexion.md`, Phase 2): AD-3 — las ventas son
// un *ingest*, no un form. Parte PURA del ingest: split de CSV, mapeo
// configurable de columnas, normalización de números/fechas y construcción de
// filas normalizadas. Vive separada de `sales-ingest-service.ts` para poder
// importarse desde componentes cliente (preview de la pantalla corporativa) y
// scripts `verify-*` sin arrastrar conexión a base de datos.
//
// Formato: genérico con mapeo manual de columnas (OQ1 resuelta 2026-08-23 —
// sin presets por POS). Delimitador se detecta entre `,` `;` y tab.

/** Mapeo columna-del-archivo → campo normalizado. Los valores son el texto
 *  exacto del encabezado tal como viene en el CSV (trim incluido). */
export interface SalesColumnMapping {
  /** SKU, código o nombre de la receta/vendido. Resolución: UUID → nombre exacto. */
  recipeRef: string;
  /** Cantidad vendida. Acepta formatos MX ("1.234,56") y US ("1,234.56"). */
  quantitySold: string;
  /** Fecha de venta. Si se omite, todas las filas usan `defaultDay`. */
  saleDate?: string;
  /** Ingreso total en unidades de moneda ("$1,234.50"); se guarda en centavos. */
  totalRevenue?: string;
}

export interface NormalizedSaleRow {
  /** Número de fila en el archivo (1-based, el encuentro de encabezados es 1). */
  rowNumber: number;
  recipeRef: string;
  quantitySold: number;
  /** Día local de la sucursal, `YYYY-MM-DD`. */
  saleDay: string;
  totalRevenueCents: number | null;
}

export interface SalesRowError {
  rowNumber: number;
  message: string;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}/;

/**
 * Divide un CSV (RFC4180 simplificado: comillas dobles, `""` escapada,
 * saltos CRLF/LF dentro de comillas respetados). Devuelve celdas crudas,
 * sin trim — el trim lo hace quien mapea, porque los encabezados pueden
 * venir con espacios significativos… o no; aquí se recorta siempre porque
 * ningún POS conocido exporta encabezados con espacios finales intencionales.
 */
export function splitCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  const pushCell = () => {
    row.push(cell.trim());
    cell = "";
  };
  const pushRow = () => {
    // Descarta filas totalmente vacías (línea en blanco al final, etc.)
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      pushCell();
    } else if (ch === "\r") {
      pushCell();
      if (text[i + 1] === "\n") i++;
      pushRow();
    } else if (ch === "\n") {
      pushCell();
      pushRow();
    } else {
      cell += ch;
    }
  }
  // Última celda/fila sin salto final
  if (cell !== "" || row.length > 0) {
    pushCell();
    pushRow();
  }

  return rows;
}

/** Detecta el delimitador contando ocurrencias fuera de la primera línea. */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const candidates = [",", ";", "\t"];
  let best = ",";
  let bestCount = -1;
  for (const d of candidates) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Número tolerante: acepta `1234.56`, `1,234.56`, `$1,234.56`,
 * `1.234,56` (formato MX/es). Devuelve null si no parsea.
 */
export function normalizeNumber(raw: string): number | null {
  if (raw == null) return null;
  let s = String(raw).replace(/[$\s]/g, "");
  if (s === "") return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) {
    // Estilo es/MX: coma decimal, punto miles
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fecha → día `YYYY-MM-DD`.
 *
 * Criterio del snapshot (`inventory-snapshot-service.ts`): el día es el LOCAL
 * de la sucursal. Aquí la entrada ya viene escrita en hora local de la
 * sucursal (es un corte de su POS), así que "normalizar" significa extraer el
 * día calendario SIN pasar por husos: acepta `YYYY-MM-DD[THH:mm...]`,
 * `DD/MM/YYYY` (formato MX; el caso `MM/DD` ambiguo se resuelve como México
 * salvo que el primer componente sea > 12, que lo delata invertido).
 */
export function normalizeDay(raw: string, fallbackDay?: string): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === "") return fallbackDay ?? null;

  if (DAY_RE.test(s)) return s.slice(0, 10);

  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    // Por defecto MX: primer componente = día, segundo = mes. Si el segundo
    // componente excede 12 no puede ser mes → el archivo venía en MM/DD.
    let dd = Number(m[1]);
    let mm = Number(m[2]);
    if (mm > 12 && dd <= 12) {
      [dd, mm] = [mm, dd];
    }
    return `${m[3]}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }

  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}

/**
 * Intenta adivinar el mapeo de columnas por sinónimos comunes de encabezados
 * de POS mexicanos (OQ1: sin presets por POS, pero sí un default tolerante).
 * Devuelve null si no puede resolver producto y cantidad.
 */
export function guessMapping(headers: string[]): SalesColumnMapping | null {
  const synonyms = {
    recipeRef: ["producto", "productos", "descripcion", "articulo", "item", "nombre", "platillo"],
    quantitySold: ["cantidad", "cant", "qty", "ventas", "vendidos", "unidades"],
    saleDate: ["fecha", "dia", "date", "businessdate"],
    totalRevenue: ["importe", "total", "monto", "ingreso", "revenue", "venta"],
  };

  const find = (keys: string[]): string | undefined => {
    for (const key of keys) {
      const hit = headers.find((h) => h.trim().toLowerCase() === key);
      if (hit) return hit.trim();
    }
    // Segunda pasada: contains (p. ej. "Cantidad Vendida")
    for (const key of keys) {
      const hit = headers.find((h) => h.trim().toLowerCase().includes(key));
      if (hit) return hit.trim();
    }
    return undefined;
  };

  const mapping: SalesColumnMapping = {
    recipeRef: find(synonyms.recipeRef) ?? "",
    quantitySold: find(synonyms.quantitySold) ?? "",
    saleDate: find(synonyms.saleDate),
    totalRevenue: find(synonyms.totalRevenue),
  };

  if (!mapping.recipeRef || !mapping.quantitySold) return null;
  return mapping;
}

export function buildRows(
  csvText: string,
  mapping: SalesColumnMapping,
  options?: { defaultDay?: string; delimiter?: string }
): { rows: NormalizedSaleRow[]; errors: SalesRowError[] } {
  const rows: NormalizedSaleRow[] = [];
  const errors: SalesRowError[] = [];

  const delimiter = options?.delimiter ?? detectDelimiter(csvText);
  const table = splitCsv(csvText, delimiter);
  if (table.length < 2) {
    return { rows, errors: [{ rowNumber: 1, message: "El archivo no tiene datos además del encabezado" }] };
  }

  const headers = table[0];
  const indexOf = (name: string | undefined): number => {
    if (!name) return -1;
    const target = name.trim().toLowerCase();
    return headers.findIndex((h) => h.toLowerCase() === target);
  };

  const idxRecipe = indexOf(mapping.recipeRef);
  const idxQty = indexOf(mapping.quantitySold);
  const idxDate = indexOf(mapping.saleDate);
  const idxRevenue = indexOf(mapping.totalRevenue);

  if (idxRecipe === -1 || idxQty === -1) {
    const missing = [
      idxRecipe === -1 ? `"${mapping.recipeRef}"` : undefined,
      idxQty === -1 ? `"${mapping.quantitySold}"` : undefined,
    ].filter(Boolean);
    return {
      rows,
      errors: [{
        rowNumber: 1,
        message: `Encabezados requeridos no encontrados: ${missing.join(", ")}`,
      }],
    };
  }

  for (let i = 1; i < table.length; i++) {
    const cells = table[i];
    const rowNumber = i + 1;
    const recipeRef = cells[idxRecipe] ?? "";
    const qtyRaw = cells[idxQty] ?? "";
    const dayRaw = idxDate >= 0 ? cells[idxDate] ?? "" : "";
    const revenueRaw = idxRevenue >= 0 ? cells[idxRevenue] ?? "" : "";

    if (recipeRef === "" && qtyRaw === "") continue; // fila basura

    const quantitySold = normalizeNumber(qtyRaw);
    if (recipeRef === "") {
      errors.push({ rowNumber, message: "Producto/receta vacía" });
      continue;
    }
    if (quantitySold === null || quantitySold <= 0) {
      errors.push({ rowNumber, message: `Cantidad inválida: "${qtyRaw}"` });
      continue;
    }

    const saleDay = normalizeDay(dayRaw, options?.defaultDay);
    if (!saleDay) {
      errors.push({ rowNumber, message: `Fecha inválida: "${dayRaw}"` });
      continue;
    }

    const revenue = idxRevenue >= 0 ? normalizeNumber(revenueRaw) : null;

    rows.push({
      rowNumber,
      recipeRef,
      quantitySold,
      saleDay,
      totalRevenueCents: revenue != null ? Math.round(revenue * 100) : null,
    });
  }

  return { rows, errors };
}
