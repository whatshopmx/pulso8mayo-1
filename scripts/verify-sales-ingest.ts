// scripts/verify-sales-ingest.ts
//
// T6: verificación del servicio de ingesta de ventas (parte pura).
// El repo no tiene runner de unit tests; el patrón establecido es un script
// `verify-*` que corre con `npx tsx` y falla con exit != 0.
//
//   npx tsx scripts/verify-sales-ingest.ts

import {
  splitCsv,
  detectDelimiter,
  normalizeNumber,
  normalizeDay,
  SalesIngestService,
} from "../lib/services/sales-ingest-service";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.error(`FAIL  ${name}\n      esperado ${e}\n      obtenido ${a}`);
  }
}

// ── splitCsv ────────────────────────────────────────────────────────────────
check("splitCsv simple", splitCsv("a,b,c\n1,2,3", ","), [["a", "b", "c"], ["1", "2", "3"]]);
check("splitCsv comillas con coma", splitCsv('"Taco, Pastor",2', ","), [["Taco, Pastor", "2"]]);
check("splitCsv comilla escapada", splitCsv('"Plato ""Especial""",1', ","), [['Plato "Especial"', "1"]]);
check("splitCsv salto dentro de comillas", splitCsv('"linea\nuno",5', ","), [["linea\nuno", "5"]]);
check("splitCsv CRLF", splitCsv("a,b\r\n1,2\r\n", ","), [["a", "b"], ["1", "2"]]);
check("splitCsv descarta línea vacía final", splitCsv("a,b\n1,2\n\n", ","), [["a", "b"], ["1", "2"]]);

// ── detectDelimiter ────────────────────────────────────────────────────────
check("detectDelimiter coma", detectDelimiter("a,b,c"), ",");
check("detectDelimiter punto y coma", detectDelimiter("a;b;c"), ";");
check("detectDelimiter tab", detectDelimiter("a\tb\tc"), "\t");

// ── normalizeNumber ────────────────────────────────────────────────────────
check("normalizeNumber US", normalizeNumber("1,234.56"), 1234.56);
check("normalizeNumber MX", normalizeNumber("1.234,56"), 1234.56);
check("normalizeNumber con $", normalizeNumber("$1,234.56"), 1234.56);
check("normalizeNumber entero", normalizeNumber("3"), 3);
check("normalizeNumber decimal simple", normalizeNumber("2.5"), 2.5);
check("normalizeNumber inválido", normalizeNumber("abc"), null);
check("normalizeNumber vacío", normalizeNumber(""), null);

// ── normalizeDay ───────────────────────────────────────────────────────────
check("normalizeDay ISO", normalizeDay("2026-08-20"), "2026-08-20");
check("normalizeDay ISO datetime", normalizeDay("2026-08-20T14:30:00"), "2026-08-20");
check("normalizeDay MX dd/mm/yyyy", normalizeDay("20/08/2026"), "2026-08-20");
check("normalizeDay invertido delatado", normalizeDay("08/20/2026"), "2026-08-20");
check("normalizeDay con fallback", normalizeDay("", "2026-08-21"), "2026-08-21");
check("normalizeDay sin fallback", normalizeDay(""), null);
check("normalizeDay basura", normalizeDay("ayer"), null);

// ── buildRows: CSV válido ──────────────────────────────────────────────────
const csvOk = [
  "Producto,Cantidad,Fecha,Importe",
  '"Taco de Pastor",10,20/08/2026,"$1,250.50"',
  "Cerveza Modelo,24.5,2026-08-20,1890",
].join("\n");

const mapping = { recipeRef: "Producto", quantitySold: "Cantidad", saleDate: "Fecha", totalRevenue: "Importe" };
const ok = SalesIngestService.buildRows(csvOk, mapping);

check("buildRows: 2 filas válidas", ok.rows.length, 2);
check("buildRows: sin errores", ok.errors.length, 0);
check(
  "buildRows: fila 1 normalizada",
  ok.rows[0],
  { rowNumber: 2, recipeRef: "Taco de Pastor", quantitySold: 10, saleDay: "2026-08-20", totalRevenueCents: 125050 }
);
check(
  "buildRows: fila 2 (ISO + revenue sin decimales)",
  ok.rows[1],
  { rowNumber: 3, recipeRef: "Cerveza Modelo", quantitySold: 24.5, saleDay: "2026-08-20", totalRevenueCents: 189000 }
);

// ── buildRows: errores mixtos no abortan el lote ───────────────────────────
const csvMixed = [
  "Producto,Cantidad,Fecha",
  ",5,20/08/2026",
  "Taco,0,20/08/2026",
  "Taco,abc,20/08/2026",
  "Taco,3,fecha mala",
  "Taco,7",
].join("\n");

const mixed = SalesIngestService.buildRows(csvMixed, {
  recipeRef: "Producto",
  quantitySold: "Cantidad",
  saleDate: "Fecha",
}, { defaultDay: "2026-08-21" });

check("mixto: 1 fila válida (default day)", mixed.rows.length, 1);
check("mixto: la fila válida usa defaultDay", mixed.rows[0]?.saleDay, "2026-08-21");
check("mixto: 4 errores accionables", mixed.errors.length, 4);
check(
  "mixto: primer error menciona la fila 2",
  mixed.errors[0]?.rowNumber,
  2
);

// ── buildRows: archivo vacío / encabezados malos ───────────────────────────
const empty = SalesIngestService.buildRows("", mapping);
check("vacío: error de archivo sin datos", empty.errors.length, 1);

const badHeaders = SalesIngestService.buildRows("Nombre,Cant\nX,1", mapping);
check("encabezados malos: 1 error", badHeaders.errors.length, 1);
if (!badHeaders.errors[0]?.message.includes("Producto")) {
  failures++;
  console.error("FAIL  encabezados malos: el mensaje nombra la columna faltante");
} else {
  console.log("  ok  encabezados malos: el mensaje nombra la columna faltante");
}

// ── Resultado ───────────────────────────────────────────────────────────────
if (failures > 0) {
  console.error(`\n${failures} verificación(es) fallaron`);
  process.exit(1);
}
console.log("\nTodas las verificaciones de sales-ingest pasaron");
