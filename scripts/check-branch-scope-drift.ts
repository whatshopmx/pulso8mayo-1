/**
 * Detecta usuarios en un estado de alcance incoherente: un rol acotado a
 * sucursal (`GERENTE`, `SUPERVISOR`) sin `branch_id` asignado.
 *
 * Ese usuario no puede ver nada —todos los consumidores fail-closed le
 * devuelven vacío— y, antes del trabajo de alcance fail-closed, veía el grupo
 * entero. `users.branch_id` seguirá siendo nullable porque ADMIN y SUPER_ADMIN
 * legítimamente no tienen sucursal, así que la coherencia se comprueba aquí.
 *
 * Corre antes de considerar la constraint `CHECK` en la base: si esto sale
 * limpio de forma sostenida, la constraint se puede aplicar sin que la
 * migración falle contra filas históricas.
 *
 *   npx tsx scripts/check-branch-scope-drift.ts
 *
 * Sale con código 1 si encuentra alguna fila, para poder usarlo como gate.
 */

import 'dotenv/config';
import { db } from '../lib/db';
import { sql } from 'drizzle-orm';

const ROLES_ACOTADOS = ['GERENTE', 'SUPERVISOR'];

async function main() {
  const invalidos: any = await db.execute(sql`
    SELECT id, email, role, company_id
    FROM users
    WHERE role IN ('GERENTE', 'SUPERVISOR')
      AND branch_id IS NULL
      AND deleted_at IS NULL
    ORDER BY role, email
  `);

  const filas = invalidos.rows ?? invalidos;

  const resumen: any = await db.execute(sql`
    SELECT role,
           count(*) FILTER (WHERE branch_id IS NULL) AS sin_sucursal,
           count(*) AS total
    FROM users
    WHERE deleted_at IS NULL
    GROUP BY role
    ORDER BY role
  `);

  console.log('--- Usuarios por rol (activos) ---');
  console.table(resumen.rows ?? resumen);

  if (filas.length === 0) {
    console.log(
      `\n✅ Sin deriva: ningún usuario ${ROLES_ACOTADOS.join('/')} está sin sucursal asignada.`
    );
    return 0;
  }

  console.error(`\n❌ ${filas.length} usuario(s) con rol acotado y sin sucursal:`);
  console.table(filas);
  console.error(
    '\nAsigna una sucursal a cada uno, o cámbiales el rol a uno no acotado ' +
      '(ADMIN/SUPER_ADMIN), antes de aplicar la constraint en la base.'
  );
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('Error ejecutando el diagnóstico:', err);
    process.exit(2);
  });
