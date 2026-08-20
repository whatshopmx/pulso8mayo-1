/**
 * A7 (`tasks/plan-auditoria-conteo-produccion-merma.md`) — daño histórico de O-5.
 *
 * `production_ingredients.expected_quantity` y `actual_quantity` son `integer`,
 * mientras el descuento del lote (`inventory_batches.current_quantity`, ya
 * `numeric(12,4)` desde la migración 0051) y `total_cost` usan el valor exacto.
 * Todo insumo por debajo de 0.5 unidades queda registrado como `0` con un
 * costo mayor que cero: la fila dice "consumió 0 kg, costó $12".
 *
 * Esta firma —`actual_quantity = 0` con `total_cost > 0`— es la que se cuenta
 * aquí, por compañía. También se mide si esas filas son reconstruibles a
 * partir de `total_cost / unit_cost`, que es lo que decidiría un backfill.
 *
 * SOLO LECTURA. Ningún INSERT/UPDATE/DELETE.
 *
 *   npx tsx scripts/audit-redondeo-ingredientes.ts
 */
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env" });

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const show = async (label: string, sql: string) => {
    const { rows } = await client.query(sql);
    console.log(`\n### ${label}`);
    if (rows.length === 0) console.log("(sin filas)");
    else console.table(rows);
  };

  // El tipo actual de las columnas: si esto ya dice `numeric`, la migración
  // A7b se aplicó y el resto del reporte pierde sentido.
  await show(
    "TIPO DE COLUMNA",
    `SELECT column_name, data_type, numeric_precision, numeric_scale
       FROM information_schema.columns
      WHERE table_name = 'production_ingredients'
        AND column_name IN ('expected_quantity','actual_quantity','unit_cost','total_cost')
      ORDER BY column_name`
  );

  await show(
    "VOLUMEN TOTAL",
    `SELECT COUNT(*) AS filas,
            COUNT(DISTINCT pi.result_id) AS producciones,
            MIN(pr.production_date) AS desde,
            MAX(pr.production_date) AS hasta
       FROM production_ingredients pi
       JOIN production_results pr ON pr.id = pi.result_id`
  );

  // La firma del defecto, por compañía.
  await show(
    "FILAS CORRUPTAS POR COMPAÑÍA (actual_quantity = 0 con total_cost > 0)",
    `SELECT c.name AS compania,
            COUNT(*) AS filas_corruptas,
            SUM(pi.total_cost) AS centavos_sin_cantidad,
            COUNT(*) FILTER (WHERE pi.unit_cost IS NOT NULL AND pi.unit_cost > 0) AS reconstruibles
       FROM production_ingredients pi
       JOIN production_results pr ON pr.id = pi.result_id
       JOIN companies c ON c.id = pr.company_id
      WHERE pi.actual_quantity = 0 AND COALESCE(pi.total_cost, 0) > 0
      GROUP BY c.name
      ORDER BY filas_corruptas DESC`
  );

  // Variante más laxa: cantidad en 0 sin exigir costo. Sin `unit_cost` no hay
  // forma de reconstruir la cantidad, así que se cuentan aparte.
  await show(
    "FILAS EN CERO SIN COSTO (no reconstruibles)",
    `SELECT COUNT(*) AS filas
       FROM production_ingredients pi
      WHERE pi.actual_quantity = 0 AND COALESCE(pi.total_cost, 0) = 0`
  );

  await show(
    "EXPECTED EN CERO CON ACTUAL > 0 (redondeo del esperado)",
    `SELECT COUNT(*) AS filas
       FROM production_ingredients pi
      WHERE pi.expected_quantity = 0 AND pi.actual_quantity > 0`
  );

  // Reconstrucción: total_cost / unit_cost devuelve la cantidad exacta sólo si
  // el costo se calculó con ella. Se muestran hasta 20 casos para inspección.
  await show(
    "MUESTRA DE RECONSTRUCCIÓN (total_cost / unit_cost)",
    `SELECT pi.id, pi.unit, pi.expected_quantity, pi.actual_quantity,
            pi.unit_cost, pi.total_cost,
            ROUND(pi.total_cost::numeric / NULLIF(pi.unit_cost, 0), 4) AS cantidad_reconstruida
       FROM production_ingredients pi
      WHERE pi.actual_quantity = 0 AND COALESCE(pi.total_cost, 0) > 0
      LIMIT 20`
  );

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
