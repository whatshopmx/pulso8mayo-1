import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

const info = await sql`SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'role'`;
console.log('column info:', JSON.stringify(info));

const distinct = await sql`SELECT DISTINCT role FROM users ORDER BY role`;
const vals = distinct.map(r => r.role);
console.log('distinct roles:', JSON.stringify(vals));
