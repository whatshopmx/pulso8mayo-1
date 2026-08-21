/**
 * Diagnóstico: fondos de caja chica que el sistema inventó (A1).
 *
 * Hasta esta rama, `GET /api/petty-cash?branchId=…` llamaba a `getOrCreateFund`,
 * así que **abrir la pantalla** de Caja Chica con alcance "todas" escribía una
 * fila por sucursal con `fund_amount = current_balance = $5,000` que nadie
 * entregó, y las sumaba como saldo real de la cadena.
 *
 * Este script **solo reporta**. El saneo vive aparte, para que diagnosticar
 * nunca escriba: `scripts/baja-fondos-fantasma.ts` da de baja (`active = false`)
 * exactamente los que aquí salen marcados FANTASMA.
 *
 *   npx tsx scripts/check-fondos-fantasma.ts
 *
 * Heurística — un fondo es fantasma con alta confianza si cumple las tres:
 *   1. `current_balance === fund_amount === 500000` (el default exacto),
 *   2. cero transacciones en la bitácora,
 *   3. `created_at === updated_at` (nunca se tocó desde que se creó).
 *
 * Se listan aparte los "sospechosos": traen el monto default exacto pero fallan
 * alguna de las otras dos señales. Ahí la lectura ya no es automática.
 *
 * Los que ya están dados de baja (`active = false`) salen en su propia
 * categoría: `getFund` no los devuelve, así que no suman al saldo de la cadena
 * y no hay nada más que decidir sobre ellos.
 */
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env" });

/** El default que el código inventaba, en centavos. */
const DEFAULT_FUND_CENTS = 500000;

const mxn = (cents: number) =>
  `$${(cents / 100).toLocaleString("es-MX", { minimumFractionDigits: 2 })}`;

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const { rows } = await client.query<{
    id: string;
    company_id: string;
    company_name: string | null;
    branch_id: string;
    branch_name: string | null;
    fund_amount: number;
    current_balance: number;
    low_threshold: number;
    tx_count: number;
    created_at: Date;
    untouched: boolean;
    active: boolean;
  }>(`
    SELECT
      f.id,
      f.company_id,
      c.name AS company_name,
      f.branch_id,
      b.name AS branch_name,
      f.fund_amount,
      f.current_balance,
      f.low_threshold,
      f.created_at,
      f.active,
      (f.created_at = f.updated_at) AS untouched,
      (SELECT COUNT(*)::int FROM petty_cash_transactions t WHERE t.fund_id = f.id) AS tx_count
    FROM petty_cash_funds f
    LEFT JOIN companies c ON c.id = f.company_id
    LEFT JOIN branches  b ON b.id = f.branch_id
    ORDER BY c.name NULLS LAST, b.name NULLS LAST
  `);

  const atDefault = (r: (typeof rows)[number]) =>
    r.fund_amount === DEFAULT_FUND_CENTS && r.current_balance === DEFAULT_FUND_CENTS;

  // Un fondo dado de baja ya no lo devuelve `getFund`: no suma al saldo de la
  // cadena y no queda decisión pendiente sobre él. Sale del análisis antes de
  // clasificar, o su `updated_at` movido por la baja lo haría pasar por
  // "sospechoso" — el saneo se delataría a sí mismo como hallazgo.
  const dadosDeBaja = rows.filter((r) => !r.active);
  const activos = rows.filter((r) => r.active);

  const fantasma = activos.filter((r) => atDefault(r) && r.tx_count === 0 && r.untouched);
  // Traen el monto default exacto pero fallan alguna de las otras dos señales:
  // el registro se tocó, o ya tiene movimientos encima. Puede ser un fondo
  // inventado que después se usó, o uno real que coincide con $5,000.
  const sospechosos = activos.filter((r) => !fantasma.includes(r) && atDefault(r));
  const reales = activos.filter((r) => !fantasma.includes(r) && !sospechosos.includes(r));

  console.log(`\nFondos de caja chica en la base: ${rows.length}`);
  console.log(`  fantasma (alta confianza): ${fantasma.length}`);
  console.log(`  sospechosos:               ${sospechosos.length}`);
  console.log(`  con actividad real:        ${reales.length}`);
  console.log(`  ya dados de baja:          ${dadosDeBaja.length}`);

  const print = (titulo: string, lista: typeof rows) => {
    if (lista.length === 0) return;
    console.log(`\n── ${titulo} ─────────────────────────────`);
    for (const r of lista) {
      console.log(
        [
          `  ${r.company_name ?? r.company_id} / ${r.branch_name ?? r.branch_id}`,
          `fondo ${mxn(r.fund_amount)}`,
          `saldo ${mxn(r.current_balance)}`,
          `${r.tx_count} mov.`,
          `creado ${r.created_at.toISOString().slice(0, 10)}`,
          r.untouched ? "sin tocar" : "modificado",
        ].join(" · ")
      );
      console.log(`    fund_id=${r.id}`);
    }
  };

  print("FANTASMA — nunca se entregó este efectivo", fantasma);
  print("SOSPECHOSOS — monto default exacto, pero con actividad o modificados", sospechosos);
  print("YA DADOS DE BAJA — fuera del saldo de la cadena, se conservan como evidencia", dadosDeBaja);

  const inventado = fantasma.reduce((s, r) => s + r.current_balance, 0);
  if (inventado > 0) {
    console.log(
      `\nEfectivo inventado que hoy suma al saldo de la cadena: ${mxn(inventado)} en ${fantasma.length} sucursales.`
    );
  }

  console.log(
    "\nEste script no borra ni modifica nada. Para dar de baja los marcados " +
      "FANTASMA: npx tsx scripts/baja-fondos-fantasma.ts --apply\n"
  );

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
