import { config } from 'dotenv';
import { neon } from '@neondatabase/serverless';
config({ path: '.env' });
async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const result = await sql`SELECT 1 as ok`;
  console.log('Connected:', JSON.stringify(result[0]));
}
main();
