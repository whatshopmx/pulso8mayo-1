import { neon } from '@neondatabase/serverless';
import 'dotenv/config';
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  console.log('HOY =', today, '\n');

  // 1. ¿plannedShifts está poblado? ¿Qué status tiene?
  const ps = await sql`
    SELECT status, count(*)::int AS n, count(shift_date)::int AS con_fecha
    FROM planned_shifts GROUP BY status ORDER BY n DESC`;
  console.log('[1] planned_shifts por status:', JSON.stringify(ps));

  // 2. ¿Hay turnos planificados para HOY?
  const psHoy = await sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE status='PUBLISHED')::int AS published,
           count(DISTINCT branch_id)::int AS sucursales
    FROM planned_shifts WHERE shift_date = ${today}`;
  console.log('[2] planned_shifts para HOY:', JSON.stringify(psHoy));

  // 3. LA PREGUNTA CLAVE (F0.4): ¿shiftSessions.planned_shift_id está poblado?
  const ss = await sql`
    SELECT status,
           count(*)::int AS n,
           count(planned_shift_id)::int AS con_planned_id,
           count(*) FILTER (WHERE late_minutes > 0)::int AS tardanzas
    FROM shift_sessions GROUP BY status ORDER BY n DESC`;
  console.log('[3] shift_sessions por status (con_planned_id = poblado):', JSON.stringify(ss));

  // 4. El fallo que sospeché: ¿sesiones excluidas por el filtro startedAt >= hoy?
  const mismatch = await sql`
    SELECT count(*)::int AS sesiones_con_turno_de_hoy_pero_started_antes
    FROM shift_sessions ss
    JOIN planned_shifts ps ON ps.id = ss.planned_shift_id
    WHERE ps.shift_date = ${today}
      AND ss.started_at < ${today + 'T00:00:00Z'}::timestamptz`;
  console.log('[4] Sesiones de turno HOY con started_at ANTERIOR a hoy (excluidas por la query actual):', JSON.stringify(mismatch));

  // 5. Muestra real de una sucursal
  const muestra = await sql`
    SELECT ss.branch_id, ss.status, ss.late_minutes, ss.scheduled_start_time,
           (ss.planned_shift_id IS NOT NULL) AS tiene_planned_id, ss.started_at::date AS started
    FROM shift_sessions ss ORDER BY ss.started_at DESC LIMIT 8`;
  console.log('[5] muestra shift_sessions:', JSON.stringify(muestra, null, 1));
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
