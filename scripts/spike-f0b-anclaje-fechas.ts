import { neon } from '@neondatabase/serverless';
import 'dotenv/config';
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const hoy = new Date().toISOString().slice(0, 10);
  console.log('HOY (server) =', hoy, '\n');

  const rango = async (tabla: string, col: string) => {
    const r = await sql.query(
      `SELECT min(${col})::text AS min, max(${col})::text AS max, count(*)::int AS n FROM ${tabla}`);
    return r[0];
  };
  console.log('[A] planned_shifts.shift_date   :', JSON.stringify(await rango('planned_shifts','shift_date')));
  console.log('[A] shift_sessions.started_at  :', JSON.stringify(await rango('shift_sessions','started_at')));
  console.log('[A] temperature_logs.timestamp :', JSON.stringify(await rango('temperature_logs','timestamp')));
  console.log('[A] daily_sales_cuts.business_date:', JSON.stringify(await rango('daily_sales_cuts','business_date')));
  console.log('[A] workflow_instances.created_at:', JSON.stringify(await rango('workflow_instances','created_at')));
  console.log('[A] incidents.created_at       :', JSON.stringify(await rango('incidents','created_at')));

  console.log('\n[B] QUE DEVUELVE "HOY" CADA QUERY DEL SERVICIO (filtro >= hoy):');
  const q = async (label: string, sqlText: string) => {
    const r = await sql.query(sqlText.replace(/__HOY__/g, `'${hoy}'`));
    console.log(`    ${label}: ${JSON.stringify(r[0])}`);
  };
  await q('shift_sessions  ', `SELECT count(*)::int AS n FROM shift_sessions WHERE started_at >= __HOY__::timestamptz`);
  await q('temperature_logs', `SELECT count(*)::int AS n FROM temperature_logs WHERE timestamp >= __HOY__::timestamptz`);
  await q('daily_sales_cuts', `SELECT count(*)::int AS n FROM daily_sales_cuts WHERE business_date = __HOY__`);
  await q('workflow_instances', `SELECT count(*)::int AS n FROM workflow_instances WHERE created_at >= __HOY__::timestamptz`);
  await q('planned_shifts  ', `SELECT count(*)::int AS n FROM planned_shifts WHERE shift_date = __HOY__`);

  console.log('\n[C] DOTACION: turnos planificados por fecha (top 6):');
  const psd = await sql`SELECT shift_date, count(*)::int AS turnos, count(DISTINCT branch_id)::int AS suc
                        FROM planned_shifts GROUP BY shift_date ORDER BY shift_date DESC LIMIT 6`;
  console.log(JSON.stringify(psd));

  console.log('\n[D] Sesiones por fecha real de inicio (top 6):');
  const ssd = await sql`SELECT started_at::date AS dia, status, count(*)::int AS n
                        FROM shift_sessions GROUP BY 1,2 ORDER BY 1 DESC LIMIT 6`;
  console.log(JSON.stringify(ssd));
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
