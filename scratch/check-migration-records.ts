import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const result = await sql`
    SELECT * FROM drizzle.__drizzle_migrations ORDER BY id;
  `;
  console.log('Migration records in drizzle.__drizzle_migrations:', JSON.stringify(result, null, 2));
}

main().catch(console.error);
