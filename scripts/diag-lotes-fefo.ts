import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from 'dotenv';
import pg from 'pg';

// No determina elegibilidad operativa: compara el timestamp almacenado con un
// corte explícito UTC. La semántica de fecha/etiqueta queda para FEFO-02.
export const BATCH_DIAGNOSTIC_SQL = `
WITH scoped AS (
  SELECT b.*, i.company_id IS DISTINCT FROM s.company_id AS item_company_mismatch
  FROM inventory_batches b
  JOIN branches s ON s.id = b.branch_id
  LEFT JOIN inventory_items i ON i.id = b.item_id
  WHERE s.company_id = $1 AND ($2::text IS NULL OR b.branch_id::text = $2)
), history AS (
  SELECT m.batch_id, count(*) AS movement_count,
    sum(m.quantity_change) AS ledger,
    count(*) FILTER (WHERE m.type = 'RECEIVING') AS receiving_count,
    min(m.timestamp) AS first_movement,
    max(m.timestamp) AS last_movement,
    count(*) FILTER (WHERE m.item_id IS DISTINCT FROM b.item_id
      OR m.branch_id IS DISTINCT FROM b.branch_id) AS mismatched_movements
  FROM inventory_movements m JOIN scoped b ON b.id = m.batch_id
  GROUP BY m.batch_id
)
SELECT b.id AS batch_id, b.branch_id, b.item_id, b.status, b.origin,
  b.initial_quantity::text, b.current_quantity::text, b.expiration_date,
  b.item_company_mismatch,
  b.current_quantity < 0 AS negative,
  b.expiration_date IS NULL AS missing_expiration,
  (b.status = 'AVAILABLE' AND b.current_quantity > 0
    AND b.expiration_date < ($3::timestamptz AT TIME ZONE 'UTC')) IS TRUE AS expired_available,
  coalesce(h.movement_count, 0)::text AS movement_count,
  coalesce(h.receiving_count, 0)::text AS receiving_count,
  coalesce(h.mismatched_movements, 0)::text AS mismatched_movements,
  h.first_movement, h.last_movement,
  coalesce(h.ledger, 0)::text AS ledger,
  (b.current_quantity - coalesce(h.ledger, 0))::text AS delta_from_ledger,
  (b.current_quantity - b.initial_quantity - coalesce(h.ledger, 0))::text AS delta_from_initial_plus_ledger,
  CASE WHEN h.mismatched_movements > 0 THEN 'REVIEW_DELTA'
    WHEN h.movement_count IS NULL THEN 'NO_MOVEMENTS'
    WHEN b.current_quantity = h.ledger THEN 'MATCHES_LEDGER'
    WHEN b.current_quantity = b.initial_quantity + h.ledger THEN 'MATCHES_INITIAL_PLUS_LEDGER'
    ELSE 'REVIEW_DELTA' END AS history_class
FROM scoped b LEFT JOIN history h ON h.batch_id = b.id
ORDER BY b.branch_id, b.item_id, b.id
`;

export function parseDiagnosticArgs(args: string[]) {
  const options = new Map<string, string>();
  for (const arg of args) {
    const match = /^--(company|branch|as-of)=(.+)$/.exec(arg);
    if (!match || options.has(match[1])) throw new Error('Opciones inválidas o duplicadas');
    options.set(match[1], match[2]);
  }
  const companyId = options.get('company');
  const branchId = options.get('branch') ?? null;
  const asOf = options.get('as-of');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!companyId || !uuid.test(companyId) || (branchId && !uuid.test(branchId))) {
    throw new Error('Se requiere --company=<uuid>; --branch=<uuid> es opcional');
  }
  if (!asOf || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(asOf)
    || !Number.isFinite(Date.parse(asOf))
    || new Date(asOf).toISOString() !== (asOf.includes('.') ? asOf : asOf.replace('Z', '.000Z'))) {
    throw new Error('Se requiere --as-of=<instante ISO UTC válido con Z>');
  }
  return { companyId, branchId, asOf };
}

async function main() {
  const scope = parseDiagnosticArgs(process.argv.slice(2));
  config({ path: '.env.local', quiet: true });
  config({ path: '.env', quiet: true });
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '60s'");
    const { rows } = await client.query(BATCH_DIAGNOSTIC_SQL, [scope.companyId, scope.branchId, scope.asOf]);
    console.log(JSON.stringify({ scope, readOnly: true, batches: rows }, null, 2));
  } finally {
    // Siempre termina la instantánea sin cambios, incluso si falla la consulta.
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    // No imprimir errores del driver: pueden incluir conexión o parámetros.
    console.error('No se pudo generar el diagnóstico. Verifica opciones, conexión y esquema.');
    process.exitCode = 1;
  });
}
