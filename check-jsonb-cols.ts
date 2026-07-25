import { config } from 'dotenv';
config({ path: '.env' });
import { Pool } from 'pg';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const r = await pool.query(`
    SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type IN ('ARRAY', 'text', 'character varying')
      AND column_name IN (
        'target_ids', 'target_roles', 'variables', 'conditions',
        'actions', 'data', 'tags', 'ai_config', 'compliance_config',
        'completion_actions', 'operating_hours'
      )
    ORDER BY table_name, column_name
  `);
  console.log(JSON.stringify(r.rows, null, 2));
  await pool.end();
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
