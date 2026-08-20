/**
 * A1 (`tasks/plan-auditoria-conteo-produccion-merma.md`) — evidencia de O-1
 * en los datos, no en logs.
 *
 * El deploy real es Netlify (`netlify.toml`; el `vercel.json` del repo está
 * vacío). Netlify sirve Next sobre Lambda: al devolver la respuesta el
 * contenedor se congela, así que un `void promise` pendiente queda suspendido
 * y sólo termina si ese mismo contenedor recibe otra invocación. Si O-1 es
 * real, deben existir instancias COMPLETED con pasos capturados y SIN las
 * filas que el extractor debía escribir.
 *
 * Un preview deploy podría confirmar O-1 pero nunca descartarla (un
 * contenedor caliente la enmascara). Los datos históricos sí deciden.
 *
 * SOLO LECTURA. Ningún INSERT/UPDATE/DELETE.
 *
 *   npx tsx scripts/audit-extractores-perdidos.ts
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
    console.table(rows);
  };

  // PRODUCCIÓN — candidata: paso `prod-qty-*` con valor numérico > 0, que es
  // exactamente la condición bajo la que el extractor escribe.
  await show(
    "PRODUCCION",
    `WITH cand AS (
       SELECT DISTINCT i.id, i.completed_at
       FROM workflow_instances i
       JOIN workflow_instance_steps s ON s.instance_id = i.id
       WHERE i.status = 'COMPLETED'
         AND s.step_id LIKE 'prod-qty-%'
         AND btrim(s.value::text, '"') ~ '^[0-9]+(\.[0-9]+)?$'
         AND (btrim(s.value::text, '"'))::numeric > 0
     )
     SELECT count(*)::int AS candidatas,
            count(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM production_results pr WHERE pr.notes LIKE '%instance:' || cand.id || '%'))::int AS extraidas,
            count(*) FILTER (WHERE NOT EXISTS (
              SELECT 1 FROM production_results pr WHERE pr.notes LIKE '%instance:' || cand.id || '%'))::int AS perdidas,
            min(completed_at) AS primera, max(completed_at) AS ultima
     FROM cand`
  );

  // MERMA MANUAL — candidata: `merma-qty-*` > 0 con su `merma-reason-*` hermano.
  await show(
    "MERMA MANUAL",
    `WITH cand AS (
       SELECT DISTINCT i.id, i.completed_at
       FROM workflow_instances i
       JOIN workflow_instance_steps s ON s.instance_id = i.id
       WHERE i.status = 'COMPLETED'
         AND s.step_id LIKE 'merma-qty-%'
         AND btrim(s.value::text, '"') ~ '^[0-9]+(\.[0-9]+)?$'
         AND (btrim(s.value::text, '"'))::numeric > 0
         AND EXISTS (
           SELECT 1 FROM workflow_instance_steps r
           WHERE r.instance_id = i.id
             AND r.step_id = 'merma-reason-' || right(s.step_id, 36)
             AND r.value IS NOT NULL
             AND btrim(r.value::text, '"') <> '')
     )
     SELECT count(*)::int AS candidatas,
            count(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM inventory_waste w WHERE w.notes LIKE '%instance:' || cand.id || '%origen=workflow_merma%'))::int AS extraidas,
            count(*) FILTER (WHERE NOT EXISTS (
              SELECT 1 FROM inventory_waste w WHERE w.notes LIKE '%instance:' || cand.id || '%origen=workflow_merma%'))::int AS perdidas,
            min(completed_at) AS primera, max(completed_at) AS ultima
     FROM cand`
  );

  // CONTEO — separa la ruta protegida (`completeStockCount` hace await y deja
  // `data->'results'`) de la expuesta (template dinámico genérico, `void`).
  await show(
    "CONTEO por ruta",
    `WITH cand AS (
       SELECT DISTINCT i.id, i.completed_at, (i.data ? 'results') AS protegida
       FROM workflow_instances i
       JOIN workflow_instance_steps s ON s.instance_id = i.id
       WHERE i.status = 'COMPLETED' AND s.step_id LIKE 'count-%'
     )
     SELECT CASE WHEN protegida THEN 'protegida (await)' ELSE 'expuesta (void)' END AS ruta,
            count(*)::int AS candidatas,
            count(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM stock_counts sc WHERE sc.workflow_instance_id = cand.id))::int AS extraidas,
            count(*) FILTER (WHERE NOT EXISTS (
              SELECT 1 FROM stock_counts sc WHERE sc.workflow_instance_id = cand.id))::int AS perdidas,
            min(completed_at) AS primera, max(completed_at) AS ultima
     FROM cand GROUP BY protegida ORDER BY protegida DESC`
  );

  // RECEPCIÓN
  await show(
    "RECEPCION",
    `WITH cand AS (
       SELECT i.id, i.completed_at FROM workflow_instances i
       WHERE i.status = 'COMPLETED' AND i.workflow_template_id = 'tpl-recepcion-mercancia-v2'
     )
     SELECT count(*)::int AS candidatas,
            count(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM receiving_reports rr WHERE rr.notes ILIKE '%instance:' || cand.id || '%'))::int AS extraidas,
            count(*) FILTER (WHERE NOT EXISTS (
              SELECT 1 FROM receiving_reports rr WHERE rr.notes ILIKE '%instance:' || cand.id || '%'))::int AS perdidas,
            min(completed_at) AS primera, max(completed_at) AS ultima
     FROM cand`
  );

  await show(
    "CONTEXTO (volumen)",
    `SELECT 'production_results' AS tabla, count(*)::int AS filas FROM production_results
     UNION ALL SELECT 'inventory_waste', count(*)::int FROM inventory_waste
     UNION ALL SELECT 'stock_counts', count(*)::int FROM stock_counts
     UNION ALL SELECT 'receiving_reports', count(*)::int FROM receiving_reports
     UNION ALL SELECT 'wf_instances COMPLETED', count(*)::int FROM workflow_instances WHERE status='COMPLETED'`
  );

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
