import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const result = await sql`
    SELECT table_schema, table_name 
    FROM information_schema.tables 
    WHERE table_name LIKE '%drizzle%'
    ORDER BY table_schema, table_name;
  `;
  console.log('Tables matching drizzle:', JSON.stringify(result, null, 2));
}

main().catch(console.error);
