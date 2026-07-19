import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const result = await sql`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'branches'
    ORDER BY column_name;
  `;
  console.log('Columns of branches table:', JSON.stringify(result, null, 2));
}

main().catch(console.error);
