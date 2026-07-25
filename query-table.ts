import { config } from 'dotenv';
config({ path: '.env' });
import { Pool } from 'pg';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  const res = await pool.query(
    `SELECT table_name 
     FROM information_schema.tables 
     WHERE table_schema = 'public' 
     ORDER BY table_name`
  );
  console.log("Tables in database:", res.rows.map(r => r.table_name));
  await pool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
