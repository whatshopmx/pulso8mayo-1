import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

const info = await sql`SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'role'`;
console.log('users.role column:', JSON.stringify(info));

const enumRefs = await sql`SELECT c.table_name, c.column_name, c.data_type, c.udt_name FROM information_schema.columns c JOIN information_schema.tables t ON c.table_name = t.table_name WHERE c.udt_name = 'role' AND t.table_schema = 'public'`;
console.log('tables using role enum:', JSON.stringify(enumRefs));
