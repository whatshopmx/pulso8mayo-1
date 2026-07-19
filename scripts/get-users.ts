import { neon } from '@neondatabase/serverless';
import 'dotenv/config';

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const usersList = await sql`SELECT id, name, email, role FROM users LIMIT 10`;
  console.log('USERS:', JSON.stringify(usersList, null, 2));
}

main().catch(console.error);
