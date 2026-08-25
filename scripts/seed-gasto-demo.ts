// Datos demo para probar el BUZÓN con un gasto operativo:
//
//   npx tsx scripts/seed-gasto-demo.ts
//
// Crea (idempotente):
//   - Payee "Luces & Obras Servicios" con RFC de prueba L&O950913MSA
//     (catálogo oficial del SAT — su CSD público permite simular que emite).
//   - Gasto MANTENIMIENTO de $1,160.00 ($1,000 + IVA) ligado a ese payee.
//
// Después: npx tsx scripts/test-fiscalapi-buzon.ts --gasto <id-del-gasto>

import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { branches, companies, operatingExpenses, payees, users } from "@/lib/db/schema";

const PAYEE_RFC = "L&O950913MSA";
const PAYEE_NAME = "Luces & Obras Servicios";
const MONTO_CENTAVOS = 116_000; // $1,160.00 = $1,000 + IVA 16%

async function main() {
  const [company] = await db.select().from(companies).limit(1);
  if (!company) throw new Error("No hay empresas en la BD. Corre los seeds primero.");
  const [branch] = await db.select().from(branches).where(eq(branches.companyId, company.id)).limit(1);
  const [user] = await db.select().from(users).limit(1);
  if (!branch || !user) throw new Error("Faltan branches o users en la BD.");

  // Payee
  let [payee] = await db
    .select()
    .from(payees)
    .where(and(eq(payees.companyId, company.id), eq(payees.taxId, PAYEE_RFC)))
    .limit(1);
  if (!payee) {
    [payee] = await db
      .insert(payees)
      .values({ companyId: company.id, name: PAYEE_NAME, taxId: PAYEE_RFC })
      .returning();
    console.log(`✓ Payee creado: ${PAYEE_NAME} (${PAYEE_RFC})`);
  } else {
    console.log(`• Payee ya existía: ${payee.name} (${payee.taxId})`);
  }

  // Gasto ligado al payee
  const existentes = await db
    .select()
    .from(operatingExpenses)
    .where(and(eq(operatingExpenses.companyId, company.id), eq(operatingExpenses.payeeId, payee.id)))
    .limit(1);
  let gastoId: string;
  if (existentes.length > 0) {
    gastoId = existentes[0].id;
    console.log(`• Gasto ya existía: ${gastoId}`);
  } else {
    const [gasto] = await db
      .insert(operatingExpenses)
      .values({
        companyId: company.id,
        branchId: branch.id,
        payeeId: payee.id,
        category: "MANTENIMIENTO",
        amount: MONTO_CENTAVOS,
        description: "Mantenimiento de luminarias e instalaciones eléctricas",
        status: "PAID",
        requestedBy: user.id,
        approvedBy: user.id,
        paidAt: new Date(),
      })
      .returning();
    gastoId = gasto.id;
    console.log(`✓ Gasto creado: ${gastoId} ($${(MONTO_CENTAVOS / 100).toFixed(2)} MANTENIMIENTO)`);
  }

  console.log(`\nSiguiente paso:`);
  console.log(`  npx tsx scripts/test-fiscalapi-buzon.ts --gasto ${gastoId}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`✗ ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
