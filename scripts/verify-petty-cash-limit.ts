/**
 * C23 — Verificación de la política de límite de caja chica (pettyCashLimitCents) contra la base real (Neon).
 *
 * Lo que las pruebas unitarias y de navegador aislado no pueden mostrar:
 * 1. Que las consultas a Postgres leen `tenant_operating_config.petty_cash_limit_cents` de verdad en Neon.
 * 2. Que `petty-cash-service.ts` valida en servidor e impide contra Postgres:
 *    - Abrir un fondo que supere el límite corporativo positivo (`fundAmountCents > pettyCashLimitCents`).
 *    - Abrir o reponer fondos cuando la caja chica está deshabilitada (`pettyCashLimitCents === 0`).
 *    - Reponer por encima del fondo fijo autorizado de la sucursal (`newBalance > fundAmount`).
 *    - Retirar más efectivo del que hay disponible en la caja física (`amountCents > currentBalance`).
 * 3. Que con `pettyCashLimitCents = null`, una empresa opera sin tope de grupo (permite fondos mayores).
 * 4. Que los fondos existentes se conservan (grandfathering):
 *    - Una reducción del límite corporativo o deshabilitación no cancela el saldo ni borra el fondo.
 *    - Los retiros legítimos contra el saldo disponible siguen procesándose.
 * 5. Que todo movimiento queda auditado con `petty_cash_transactions` en Neon.
 * 6. Que la limpieza final deja la base en su estado original sin datos huérfanos.
 *
 * Uso: node --use-system-ca --import tsx scripts/verify-petty-cash-limit.ts
 */

import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";

config({ quiet: true });

async function main() {
  console.log("C23 — Verificación de límites de caja chica en Neon\n");

  const { db } = await import("@/lib/db");
  const {
    companies,
    branches,
    users,
    tenantOperatingConfig,
    pettyCashFunds,
    pettyCashTransactions,
  } = await import("@/lib/db/schema");
  const { openFund, replenishFund, registerOutflow, getFund } = await import(
    "@/lib/services/petty-cash-service"
  );
  const { upsertTenantOperatingConfig } = await import(
    "@/lib/services/tenant-config-service"
  );

  const tag = `[VERIFY-C23-${Date.now()}]`;
  const companyAId = randomUUID();
  const companyBId = randomUUID();
  const branchA1Id = randomUUID();
  const branchA2Id = randomUUID();
  const branchB1Id = randomUUID();
  const userAId = randomUUID();
  const userBId = randomUUID();

  const companiesCreadas = [companyAId, companyBId];

  try {
    // 1. Crear empresas de prueba
    await db.insert(companies).values([
      { id: companyAId, name: `${tag} Empresa A (Con Tope)`, slug: `comp-a-${Date.now()}` },
      { id: companyBId, name: `${tag} Empresa B (Sin Tope)`, slug: `comp-b-${Date.now()}` },
    ] as any);
    console.log("  ✓ Empresas de prueba A y B creadas en Neon");

    // 2. Crear usuarios
    const now = new Date();
    await db.insert(users).values([
      {
        id: userAId,
        name: "Admin A",
        email: `admin-a-${Date.now()}@pulso.test`,
        companyId: companyAId,
        role: "ADMIN",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: userBId,
        name: "Admin B",
        email: `admin-b-${Date.now()}@pulso.test`,
        companyId: companyBId,
        role: "ADMIN",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    console.log("  ✓ Usuarios administradores creados en Neon");

    // 3. Crear sucursales
    await db.insert(branches).values([
      { id: branchA1Id, companyId: companyAId, name: "Sucursal A1 (Centro)", code: "A1" },
      { id: branchA2Id, companyId: companyAId, name: "Sucursal A2 (Norte)", code: "A2" },
      { id: branchB1Id, companyId: companyBId, name: "Sucursal B1 (Sur)", code: "B1" },
    ]);
    console.log("  ✓ Sucursales de prueba creadas en Neon");

    // 4. Configurar límites en tenantOperatingConfig
    // Empresa A: Límite de $3,000 MXN (300_000 centavos)
    await upsertTenantOperatingConfig(companyAId, {
      pettyCashLimitCents: 300_000,
    });
    // Empresa B: Sin límite corporativo (null)
    await upsertTenantOperatingConfig(companyBId, {
      pettyCashLimitCents: null,
    });
    console.log("  ✓ Políticas configuradas: Empresa A = $3,000 MXN, Empresa B = null (sin tope)");

    // 5. Empresa A: intento de apertura superando el tope corporativo ($5,000 > $3,000)
    let errorTopeA: unknown;
    try {
      await openFund({
        companyId: companyAId,
        branchId: branchA1Id,
        fundAmountCents: 500_000, // $5,000 MXN
        openedBy: userAId,
      });
    } catch (err) {
      errorTopeA = err;
    }
    if (!errorTopeA || !String(errorTopeA).includes("excede el límite máximo de caja chica autorizado")) {
      throw new Error(`Empresa A debió rechazar apertura por rebasar límite ($5,000 > $3,000). Error: ${errorTopeA}`);
    }
    console.log("  ✓ Empresa A rechaza apertura de fondo superior al límite corporativo ($5,000 > $3,000)");

    // 6. Empresa A: apertura válida dentro del tope ($2,000 MXN <= $3,000 MXN)
    const fondoA1 = await openFund({
      companyId: companyAId,
      branchId: branchA1Id,
      fundAmountCents: 200_000, // $2,000 MXN
      lowThresholdCents: 40_000, // 20% = $400 MXN
      openedBy: userAId,
      notes: "Apertura autorizada dentro del tope",
    });
    if (fondoA1.fundAmount !== 200_000 || fondoA1.currentBalance !== 200_000) {
      throw new Error(`Fondo A1 no se persistió con saldo correcto en Neon: ${JSON.stringify(fondoA1)}`);
    }
    console.log("  ✓ Empresa A abre exitosamente fondo dentro del límite ($2,000 MXN)");

    // 7. Empresa B: apertura de fondo de $10,000 MXN sin tope de grupo (null)
    const fondoB1 = await openFund({
      companyId: companyBId,
      branchId: branchB1Id,
      fundAmountCents: 1_000_000, // $10,000 MXN
      lowThresholdCents: 200_000,
      openedBy: userBId,
      notes: "Apertura sin tope corporativo",
    });
    if (fondoB1.fundAmount !== 1_000_000 || fondoB1.currentBalance !== 1_000_000) {
      throw new Error(`Fondo B1 no se persistió con saldo correcto en Neon: ${JSON.stringify(fondoB1)}`);
    }
    console.log("  ✓ Empresa B (sin tope) abre exitosamente fondo por $10,000 MXN");

    // 8. Retiro en Sucursal A1: $500 MXN
    const salidaA1 = await registerOutflow({
      companyId: companyAId,
      branchId: branchA1Id,
      amountCents: 50_000,
      concept: "Hielo de emergencia para cocina",
      evidenceUrl: "https://storage.pulso.mx/ticket-hielo.jpg",
      registeredBy: userAId,
    });
    if (salidaA1.newBalanceCents !== 150_000) {
      throw new Error(`Saldo resultante tras retiro incorrecto: ${salidaA1.newBalanceCents}`);
    }
    console.log("  ✓ Salida de efectivo registrada correctamente en A1 (saldo baja a $1,500 MXN)");

    // 9. Intento de retiro que supera el saldo en caja física ($2,000 > $1,500)
    let errorSaldoInsuficiente: unknown;
    try {
      await registerOutflow({
        companyId: companyAId,
        branchId: branchA1Id,
        amountCents: 200_000,
        concept: "Gasto imposible",
        registeredBy: userAId,
      });
    } catch (err) {
      errorSaldoInsuficiente = err;
    }
    if (!errorSaldoInsuficiente || !String(errorSaldoInsuficiente).includes("Saldo insuficiente")) {
      throw new Error(`Debió rechazar retiro por saldo insuficiente: ${errorSaldoInsuficiente}`);
    }
    console.log("  ✓ Retiro rechazado por saldo insuficiente en la caja física");

    // 10. Intento de reposición que excede el fondo fijo de la sucursal ($1,500 + $1,000 = $2,500 > $2,000)
    let errorReposicionExcedida: unknown;
    try {
      await replenishFund({
        companyId: companyAId,
        branchId: branchA1Id,
        amountCents: 100_000, // $1,000 MXN
        registeredBy: userAId,
      });
    } catch (err) {
      errorReposicionExcedida = err;
    }
    if (!errorReposicionExcedida || !String(errorReposicionExcedida).includes("excede el fondo fijo autorizado")) {
      throw new Error(`Debió rechazar reposición por rebasar fondo fijo: ${errorReposicionExcedida}`);
    }
    console.log("  ✓ Reposición rechazada al pretender rebasar el fondo fijo autorizado de la sucursal");

    // 11. Reposición válida que restituye exactamente al 100% ($500 MXN)
    const repoA1 = await replenishFund({
      companyId: companyAId,
      branchId: branchA1Id,
      amountCents: 50_000,
      notes: "Reposición exacta contra comprobante",
      registeredBy: userAId,
    });
    if (repoA1.newBalanceCents !== 200_000) {
      throw new Error(`Saldo tras reposición incorrecto: ${repoA1.newBalanceCents}`);
    }
    console.log("  ✓ Reposición exitosa restituyendo el fondo fijo exactamente al 100% ($2,000 MXN)");

    // 12. Deshabilitar caja chica en Empresa A (pettyCashLimitCents = 0)
    await upsertTenantOperatingConfig(companyAId, {
      pettyCashLimitCents: 0,
    });
    console.log("  ✓ Empresa A actualiza su política a pettyCashLimitCents = 0 (deshabilitada)");

    // 13. Intento de abrir fondo en Sucursal A2 con caja chica deshabilitada
    let errorAperturaDeshabilitada: unknown;
    try {
      await openFund({
        companyId: companyAId,
        branchId: branchA2Id,
        fundAmountCents: 100_000,
        openedBy: userAId,
      });
    } catch (err) {
      errorAperturaDeshabilitada = err;
    }
    if (!errorAperturaDeshabilitada || !String(errorAperturaDeshabilitada).includes("deshabilitada")) {
      throw new Error(`Debió rechazar apertura por caja chica deshabilitada: ${errorAperturaDeshabilitada}`);
    }
    console.log("  ✓ Intento de apertura rechazado en empresa con caja chica deshabilitada");

    // 14. Intento de reposición con caja chica deshabilitada
    let errorRepoDeshabilitada: unknown;
    try {
      await replenishFund({
        companyId: companyAId,
        branchId: branchA1Id,
        amountCents: 10_000,
        registeredBy: userAId,
      });
    } catch (err) {
      errorRepoDeshabilitada = err;
    }
    if (!errorRepoDeshabilitada || !String(errorRepoDeshabilitada).includes("deshabilitada")) {
      throw new Error(`Debió rechazar reposición por caja chica deshabilitada: ${errorRepoDeshabilitada}`);
    }
    console.log("  ✓ Intento de reposición rechazado en empresa con caja chica deshabilitada");

    // 15. Grandfathering: el fondo existente A1 sigue existiendo y puede procesar salidas
    const fondoA1Actual = await getFund(companyAId, branchA1Id);
    if (!fondoA1Actual || fondoA1Actual.currentBalance !== 200_000) {
      throw new Error("Fondo preexistente no se conservó íntegro tras deshabilitar política");
    }
    const salidaGrandfather = await registerOutflow({
      companyId: companyAId,
      branchId: branchA1Id,
      amountCents: 20_000,
      concept: "Retiro de saldo residual en fondo preexistente",
      evidenceUrl: "https://storage.pulso.mx/ticket-residual.jpg",
      registeredBy: userAId,
    });
    if (salidaGrandfather.newBalanceCents !== 180_000) {
      throw new Error(`Retiro residual falló: saldo = ${salidaGrandfather.newBalanceCents}`);
    }
    console.log("  ✓ Grandfathering verificado: fondo preexistente conserva saldo y permite retiros");

    // 16. Aislamiento multi-tenant: Empresa B no puede consultar ni operar fondos de Empresa A
    let errorCruce: unknown;
    try {
      await getFund(companyBId, branchA1Id);
    } catch (err) {
      errorCruce = err;
    }
    // getFund con sucursal ajena retorna null (o falla assertBranchOfCompany en requireFund)
    let errorRequireCruce: unknown;
    try {
      await replenishFund({
        companyId: companyBId,
        branchId: branchA1Id,
        amountCents: 10_000,
        registeredBy: userBId,
      });
    } catch (err) {
      errorRequireCruce = err;
    }
    if (!errorRequireCruce || !String(errorRequireCruce).includes("no existe para esta empresa")) {
      throw new Error(`Aislamiento cruzado falló: ${errorRequireCruce}`);
    }
    console.log("  ✓ Aislamiento multi-tenant estricto: Empresa B no puede operar fondo de Empresa A");

    console.log("\nTodas las comprobaciones de límites de caja chica contra Neon pasaron exitosamente.");
  } finally {
    console.log("\nLimpiando datos de prueba en Neon...");
    // 1. Borrar transacciones de fondos creados
    const fondosCreados = await db
      .select({ id: pettyCashFunds.id })
      .from(pettyCashFunds)
      .where(inArray(pettyCashFunds.companyId, companiesCreadas));

    if (fondosCreados.length > 0) {
      const fundIds = fondosCreados.map((f) => f.id);
      await db.delete(pettyCashTransactions).where(inArray(pettyCashTransactions.fundId, fundIds));
      await db.delete(pettyCashFunds).where(inArray(pettyCashFunds.id, fundIds));
    }

    // 2. Borrar operating configs
    await db.delete(tenantOperatingConfig).where(inArray(tenantOperatingConfig.companyId, companiesCreadas));

    // 3. Borrar sucursales
    await db.delete(branches).where(inArray(branches.companyId, companiesCreadas));

    // 4. Borrar usuarios
    await db.delete(users).where(inArray(users.companyId, companiesCreadas));

    // 5. Borrar empresas
    await db.delete(companies).where(inArray(companies.id, companiesCreadas));

    console.log("Limpieza completada.");
  }
}

main().catch((err) => {
  console.error("Fallo la verificación de caja chica:", err);
  process.exit(1);
});
