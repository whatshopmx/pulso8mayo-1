import { config } from 'dotenv';
config({ path: '.env' });
import { Pool } from 'pg';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const enumRes = await pool.query(`SELECT EXISTS(SELECT 1 FROM pg_type WHERE typname = 'notification_type')`);
  const enumExists = enumRes.rows[0].exists;
  console.log('notification_type enum exists:', enumExists);

  if (!enumExists) {
    await pool.query(`CREATE TYPE notification_type AS ENUM ('info', 'warning', 'error', 'success')`);
    console.log('Created notification_type enum');
  }

  await pool.query(`ALTER TABLE notifications ALTER COLUMN "type" DROP DEFAULT`);
  console.log('Dropped default on notifications.type');

  await pool.query(`UPDATE notifications SET "type" = 'info' WHERE "type" NOT IN ('info', 'warning', 'error', 'success')`);
  console.log('Updated invalid values');

  await pool.query(`ALTER TABLE notifications ALTER COLUMN "type" SET NOT NULL`);
  console.log('Set NOT NULL');

  await pool.query(`ALTER TABLE notifications ALTER COLUMN "type" TYPE notification_type USING "type"::text::notification_type`);
  console.log('Changed column type to notification_type');

  await pool.query(`ALTER TABLE notifications ALTER COLUMN "type" SET DEFAULT 'info'::notification_type`);
  console.log('Restored default');

  await pool.end();
  console.log('Done! Now run pnpm db:push');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
