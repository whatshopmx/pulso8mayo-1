import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

// First check column type
const info = await sql`SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'role'`;
console.log('users.role column:', JSON.stringify(info));

// Map invalid roles to valid ones: waiter -> EMPLEADO, manager -> GERENTE
const update1 = await sql`UPDATE users SET role = 'EMPLEADO' WHERE role = 'waiter'`;
console.log('waiter->EMPLEADO:', JSON.stringify(update1));

const update2 = await sql`UPDATE users SET role = 'GERENTE' WHERE role = 'manager'`;
console.log('manager->GERENTE:', JSON.stringify(update2));

// Verify
const distinct = await sql`SELECT DISTINCT role FROM users ORDER BY role`;
console.log('distinct roles after fix:', JSON.stringify(distinct.map(r => r.role)));
