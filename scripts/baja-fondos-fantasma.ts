/**
 * Saneo: da de baja los fondos de caja chica que el sistema inventó (A1).
 *
 * Usa la misma heurística que `scripts/check-fondos-fantasma.ts` —monto default
 * exacto, cero movimientos, `created_at = updated_at`— y pone `active = false`
 * en los que la cumplen. **No borra nada**: la fila queda como evidencia de que
 * el `GET` la escribió, y `getFund` ya no la devuelve, así que el efectivo
 * inventado sale del saldo de la cadena y la sucursal vuelve a leerse como
 * "sin fondo abierto" hasta que alguien capture el efectivo real.
 *
 * Es reversible (`active = true`) y reabrible desde la pantalla: `openFund`
 * detecta la fila dada de baja y la reabre con el monto capturado.
 *
 *   npx tsx scripts/baja-fondos-fantasma.ts            # simulacro, no escribe
 *   npx tsx scripts/baja-fondos-fantasma.ts --apply    # aplica la baja
 *
 * Corre el diagnóstico antes: este script confía en la heurística, y en una
 * base de cliente conviene mirar la lista de "sospechosos" a mano primero.
 */
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env" });

/** El default que el código inventaba, en centavos. */
const DEFAULT_FUND_CENTS = 500000;

const mxn = (cents: number) =>
  `$${(cents / 100).toLocaleString("es-MX", { minimumFractionDigits: 2 })}`;

async function main() {
  const apply = process.argv.includes("--apply");

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Misma firma que el diagnóstico. `active = true` acota a los que todavía
  // suman: correr el script dos veces no vuelve a tocar los ya dados de baja.
  const { rows } = await client.query<{
    id: string;
    company_name: string | null;
    branch_name: string | null;
    current_balance: number;
  }>(
    `
    SELECT f.id, c.name AS company_name, b.name AS branch_name, f.current_balance
    FROM petty_cash_funds f
    LEFT JOIN companies c ON c.id = f.company_id
    LEFT JOIN branches  b ON b.id = f.branch_id
    WHERE f.active = true
      AND f.fund_amount = $1
      AND f.current_balance = $1
      AND f.created_at = f.updated_at
      AND NOT EXISTS (
        SELECT 1 FROM petty_cash_transactions t WHERE t.fund_id = f.id
      )
    ORDER BY c.name NULLS LAST, b.name NULLS LAST
  `,
    [DEFAULT_FUND_CENTS]
  );

  if (rows.length === 0) {
    console.log("\nNo hay fondos fantasma activos. Nada que hacer.\n");
    await client.end();
    return;
  }

  console.log(`\n${apply ? "Dando de baja" : "SIMULACRO — se daría de baja"} ${rows.length} fondo(s):\n`);
  for (const r of rows) {
    console.log(
      `  ${r.company_name ?? "?"} / ${r.branch_name ?? "?"} · ${mxn(r.current_balance)} · fund_id=${r.id}`
    );
  }
  const total = rows.reduce((s, r) => s + r.current_balance, 0);
  console.log(`\nEfectivo inventado que sale del saldo de la cadena: ${mxn(total)}`);

  if (!apply) {
    console.log("\nNo se escribió nada. Repite con --apply para aplicarlo.\n");
    await client.end();
    return;
  }

  const ids = rows.map((r) => r.id);
  const res = await client.query(
    `UPDATE petty_cash_funds SET active = false, updated_at = now() WHERE id = ANY($1)`,
    [ids]
  );
  console.log(`\n${res.rowCount} fondo(s) dados de baja (active = false).`);
  console.log(
    "Las sucursales vuelven a leerse como 'sin fondo abierto'. Abrir uno desde la " +
      "pantalla reabre la misma fila con el monto que se capture.\n"
  );

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
