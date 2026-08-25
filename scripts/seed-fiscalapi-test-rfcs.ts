// Asigna RFCs válidos del catálogo oficial de pruebas del SAT a los proveedores
// y contrapartes (payees) del demo, para que cada OC/gasto pueda timbrar con su
// emisor real de pruebas y su propio CSD.
//
//   npx tsx scripts/seed-fiscalapi-test-rfcs.ts
//
// Reglas:
//   - Un taxId que ya es persona de prueba válida no se toca.
//   - Proveedores (empresas) reciben personas morales; payees alternan moral /
//     física (un taxi o hielo suele ser persona física con negocio).
//   - Cada RFC se usa una sola vez por tipo mientras alcance el catálogo.
//   - Idempotente: correrlo dos veces no cambia nada.

import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { companies, payees, suppliers } from "@/lib/db/schema";
import {
  resolveTestPerson,
  SAT_TEST_FISICAS,
  SAT_TEST_MORALES,
} from "@/lib/fiscal/sat-test-data";

function pad(s: string, n: number) {
  return s.padEnd(n);
}

async function main() {
  const [company] = await db.select().from(companies).limit(1);
  if (!company) {
    console.error("✗ No hay empresas en la BD. Corre scripts/seed-demo-data.ts primero.");
    process.exit(1);
  }

  // --- Proveedores ---------------------------------------------------------
  const proveedores = await db
    .select({ id: suppliers.id, name: suppliers.name, taxId: suppliers.taxId })
    .from(suppliers)
    .where(eq(suppliers.companyId, company.id));

  const usados = new Set<string>();
  for (const p of proveedores) {
    const match = resolveTestPerson(p.taxId);
    if (match) usados.add(match.tin);
  }
  const moralesLibres = SAT_TEST_MORALES.filter((p) => !usados.has(p.tin));

  console.log(`\nEmpresa: ${company.name}`);
  console.log("\n── Proveedores ──────────────────────────────────────────────────────────");
  console.log(`${pad("Proveedor", 34)}${pad("RFC anterior", 18)}${pad("RFC de prueba", 15)}Nombre oficial`);
  let asignados = 0;
  for (const prov of proveedores) {
    const yaValido = resolveTestPerson(prov.taxId);
    if (yaValido) {
      console.log(
        `${pad(prov.name.slice(0, 32), 34)}${pad("(ya válido)", 18)}${pad(yaValido.tin, 15)}${yaValido.legalName}`
      );
      continue;
    }
    const rfc = moralesLibres.shift();
    if (!rfc) {
      console.log(
        `${pad(prov.name.slice(0, 32), 34)}${pad(prov.taxId ?? "(vacío)", 18)}${pad("—", 15)}(catálogo agotado)`
      );
      continue;
    }
    await db.update(suppliers).set({ taxId: rfc.tin, updatedAt: new Date() }).where(eq(suppliers.id, prov.id));
    asignados++;
    console.log(
      `${pad(prov.name.slice(0, 32), 34)}${pad(prov.taxId ?? "(vacío)", 18)}${pad(rfc.tin, 15)}${rfc.legalName}`
    );
  }

  // --- Contrapartes de gastos ---------------------------------------------
  const contrapartes = await db
    .select({ id: payees.id, name: payees.name, taxId: payees.taxId })
    .from(payees)
    .where(eq(payees.companyId, company.id));

  for (const p of contrapartes) {
    const match = resolveTestPerson(p.taxId);
    if (match) usados.add(match.tin);
  }
  // Alternamos moral/física para que haya de todo en las pruebas.
  const libresMixtas: typeof SAT_TEST_MORALES = [];
  const maxLen = Math.max(SAT_TEST_MORALES.length, SAT_TEST_FISICAS.length);
  for (let i = 0; i < maxLen; i++) {
    if (SAT_TEST_FISICAS[i] && !usados.has(SAT_TEST_FISICAS[i].tin)) libresMixtas.push(SAT_TEST_FISICAS[i]);
    if (SAT_TEST_MORALES[i] && !usados.has(SAT_TEST_MORALES[i].tin)) libresMixtas.push(SAT_TEST_MORALES[i]);
  }

  console.log("\n── Contrapartes de gastos ───────────────────────────────────────────────");
  console.log(`${pad("Contraparte", 34)}${pad("RFC anterior", 18)}${pad("RFC de prueba", 15)}Nombre oficial`);
  let payeesAsignados = 0;
  for (const payee of contrapartes) {
    const yaValido = resolveTestPerson(payee.taxId);
    if (yaValido) {
      console.log(
        `${pad(payee.name.slice(0, 32), 34)}${pad("(ya válido)", 18)}${pad(yaValido.tin, 15)}${yaValido.legalName}`
      );
      continue;
    }
    const rfc = libresMixtas.shift();
    if (!rfc) {
      console.log(
        `${pad(payee.name.slice(0, 32), 34)}${pad(payee.taxId ?? "(sin RFC)", 18)}${pad("—", 15)}(catálogo agotado)`
      );
      continue;
    }
    await db.update(payees).set({ taxId: rfc.tin, updatedAt: new Date() }).where(eq(payees.id, payee.id));
    payeesAsignados++;
    console.log(
      `${pad(payee.name.slice(0, 32), 34)}${pad(payee.taxId ?? "(sin RFC)", 18)}${pad(rfc.tin, 15)}${rfc.legalName}`
    );
  }

  console.log(
    `\n✓ ${asignados} proveedor(es) y ${payeesAsignados} contraparte(s) actualizados ` +
      `con RFCs de prueba del SAT.\n  Re-corre el script para verificar que ya no hay cambios pendientes.\n`
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(`✗ Error fatal: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
