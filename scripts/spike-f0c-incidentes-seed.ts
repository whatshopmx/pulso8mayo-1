import { neon } from '@neondatabase/serverless';
import 'dotenv/config';
const sql = neon(process.env.DATABASE_URL!);
async function main() {
  console.log('[E] INCIDENTES: que veria el banner (filtro status abierto, sin filtro de fecha)');
  const inc = await sql`SELECT severity, status, count(*)::int AS n FROM incidents GROUP BY 1,2 ORDER BY n DESC`;
  console.log(JSON.stringify(inc));
  const abiertos = await sql`SELECT severity, count(*)::int AS n FROM incidents
    WHERE status IN ('DETECTED','IN_REMEDIATION','CONFIRMED') GROUP BY 1`;
  console.log('    abiertos (lo que cuenta el banner):', JSON.stringify(abiertos));
  const criticos = await sql`SELECT count(*)::int AS n FROM incidents
    WHERE status IN ('DETECTED','IN_REMEDIATION','CONFIRMED') AND severity IN ('CRITICAL','FATAL')`;
  console.log('    => criticalAlertsCount =', criticos[0].n, criticos[0].n === 0 ? '→ BANNER VERDE' : '→ banner rojo');
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
