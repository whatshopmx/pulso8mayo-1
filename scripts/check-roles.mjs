import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
try {
  const roles = await sql`SELECT DISTINCT role FROM users ORDER BY role`;
  console.log('roles:', JSON.stringify(roles));
} catch(e) {
  const roles2 = await sql`SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'role'`;
  console.log('role column info:', JSON.stringify(roles2));
}
try {
  const enums = await sql`SELECT pg_type.typname, pg_enum.enumlabel FROM pg_type JOIN pg_enum ON pg_enum.enumtypid = pg_type.oid WHERE pg_type.typname = 'role'`;
  console.log('enum values:', JSON.stringify(enums));
} catch(e2) {}
