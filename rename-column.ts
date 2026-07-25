import { config } from 'dotenv';
config({ path: '.env' });
import { Pool } from 'pg';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  console.log('Renaming message_id to communication_id...');
  await pool.query(`ALTER TABLE communication_read_receipts RENAME COLUMN "message_id" TO "communication_id"`);
  console.log('Done! Column renamed.');

  await pool.end();
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
