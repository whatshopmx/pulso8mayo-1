import { config } from 'dotenv';
config({ path: '.env' });
import { Pool } from 'pg';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  const res = await pool.query(
    `SELECT column_name, data_type, column_default, is_nullable 
     FROM information_schema.columns 
     WHERE table_name = 'event_triggers' 
       AND table_schema = 'public' 
     ORDER BY ordinal_position`
  );
  console.log('event_triggers columns:', JSON.stringify(res.rows, null, 2));
  await pool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
