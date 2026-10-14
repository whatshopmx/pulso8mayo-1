/**
 * C20.4 — Verificación de la política de autonomía del gerente contra la base real (Neon).
 *
 * Lo que las pruebas unitarias y de navegador aislado no pueden mostrar:
 * 1. Que las consultas a Postgres leen `tenant_operating_config.manager_autonomy` de verdad.
 * 2. Que la escalera de autorización autoritativa en `ExpenseService.approveOperatingExpense`
 *    y `rejectOperatingExpense` rechaza con 403 y el mensaje descriptivo exacto:
 *    - En BAJA: un gerente no puede aprobar ni rechazar gastos ordinarios (< $1,000 MXN),
 *      exigiendo rol ADMIN.
 *    - En ALTA: un gerente puede aprobar gastos de hasta el umbral de dueño ($5,000 MXN
 *      con límite monetario en $1,000 MXN).
 *    - En ALTA: gastos que alcanzan o superan el umbral de doble aprobación ($15,000 MXN >= $10,000 MXN)
 *      escalan mandatoriamente a OWNER y ni el gerente ni el admin pueden autorizarlos.
 * 3. Que la segregación de funciones (A16) prohíbe la auto-aprobación en cualquier nivel de autonomía.
 * 4. Que el cambio de política en caliente (BAJA -> MEDIA -> BAJA) surte efecto de inmediato
 *    sin estado residual en la base.
 * 5. Que existe aislamiento estricto multi-tenant (404 al intentar resolver un gasto de otra empresa).
 *
 * Uso: node --use-system-ca --import tsx scripts/verify-manager-autonomy.ts
 */

import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";

config({ quiet: true });

async function main() {
  console.log("C20.4 — Verificación de autonomía del gerente en Neon\n");

  const { db } = await import("@/lib/db");
  const {
    companies,
    branches,
    users,
    operatingExpenses,
    tenantOperatingConfig,
  } = await import("@/lib/db/schema");
  const {
    createOperatingExpense,
    approveOperatingExpense,
    rejectOperatingExpense,
  } = await import("@/lib/services/expense-service");
  const { upsertTenantOperatingConfig } = await import(
    "@/lib/services/tenant-config-service"
  );

  const empresaA = randomUUID();
  const empresaB = randomUUID();
  const empresas = [empresaA, empresaB];

  const marca = `C20 verificación ${randomUUID().slice(0, 8)}`;
  let comprobaciones = 0;

  function comprobar(ok: unknown, mensaje: string) {
    if (!ok) throw new Error(`FALLO: ${mensaje}`);
    comprobaciones++;
    console.log(`  ✓ ${mensaje}`);
  }

  async function rechaza(
    fn: () => Promise<unknown>,
    statusCode: number,
    motivo?: RegExp
  ) {
    let error: unknown;
    try {
      await fn();
    } catch (caught) {
      error = caught;
    }
    const fallo = error as { statusCode?: number; message?: string } | undefined;
    const okStatus = fallo?.statusCode === statusCode;
    const okMotivo = !motivo || motivo.test(fallo?.message ?? "");
    if (!okStatus || !okMotivo) {
      throw new Error(
        `Esperaba status ${statusCode}${motivo ? ` matching ${motivo}` : ""}, pero obtuve: status=${fallo?.statusCode}, message="${fallo?.message}"`
      );
    }
    comprobaciones++;
    console.log(
      `  ✓ Rechazo esperado ${statusCode}${motivo ? ` («${fallo?.message}»)` : ""}`
    );
  }

  try {
    // ── Siembra ─────────────────────────────────────────────────────────────
    console.log("1. Sembrando empresas, sucursales, usuarios y configuraciones...");

    await db.insert(companies).values([
      { id: empresaA, name: `${marca} (Empresa A - BAJA)` },
      { id: empresaB, name: `${marca} (Empresa B - ALTA)` },
    ]);

    const [ramaA] = await db
      .insert(branches)
      .values({ companyId: empresaA, name: `${marca} Rama A`, code: `BAJA-${marca.slice(-4)}` })
      .returning();

    const [ramaB] = await db
      .insert(branches)
      .values({ companyId: empresaB, name: `${marca} Rama B`, code: `ALTA-${marca.slice(-4)}` })
      .returning();

    // Usuarios Empresa A:
    const creatorAId = randomUUID();
    const gerenteAId = randomUUID();
    const adminAId = randomUUID();

    await db.insert(users).values([
      {
        id: creatorAId,
        companyId: empresaA,
        branchId: ramaA.id,
        name: `${marca} Creador A`,
        email: `creator-a-${creatorAId.slice(0, 6)}@pulso.test`,
        role: "GERENTE",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: gerenteAId,
        companyId: empresaA,
        branchId: ramaA.id,
        name: `${marca} Gerente A`,
        email: `gerente-a-${gerenteAId.slice(0, 6)}@pulso.test`,
        role: "GERENTE",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: adminAId,
        companyId: empresaA,
        branchId: null,
        name: `${marca} Admin A`,
        email: `admin-a-${adminAId.slice(0, 6)}@pulso.test`,
        role: "ADMIN",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    // Usuarios Empresa B:
    const creatorBId = randomUUID();
    const gerenteBId = randomUUID();
    const adminBId = randomUUID();
    const ownerBId = randomUUID();

    await db.insert(users).values([
      {
        id: creatorBId,
        companyId: empresaB,
        branchId: ramaB.id,
        name: `${marca} Creador B`,
        email: `creator-b-${creatorBId.slice(0, 6)}@pulso.test`,
        role: "GERENTE",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: gerenteBId,
        companyId: empresaB,
        branchId: ramaB.id,
        name: `${marca} Gerente B`,
        email: `gerente-b-${gerenteBId.slice(0, 6)}@pulso.test`,
        role: "GERENTE",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: adminBId,
        companyId: empresaB,
        branchId: null,
        name: `${marca} Admin B`,
        email: `admin-b-${adminBId.slice(0, 6)}@pulso.test`,
        role: "ADMIN",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: ownerBId,
        companyId: empresaB,
        branchId: null,
        name: `${marca} Dueño B`,
        email: `owner-b-${ownerBId.slice(0, 6)}@pulso.test`,
        role: "OWNER",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    // Configuración operativa en Postgres:
    // Empresa A: BAJA, límite gerente $1,000 MXN (100,000 cents), doble aprobación $10,000 MXN (1,000,000 cents)
    await upsertTenantOperatingConfig(empresaA, {
      managerAutonomy: "BAJA",
      managerAuthLimitCents: 100000,
      doubleApprovalThresholdCents: 1000000,
    });

    // Empresa B: ALTA, límite gerente $1,000 MXN (100,000 cents), doble aprobación $10,000 MXN (1,000,000 cents)
    await upsertTenantOperatingConfig(empresaB, {
      managerAutonomy: "ALTA",
      managerAuthLimitCents: 100000,
      doubleApprovalThresholdCents: 1000000,
    });

    comprobar(true, "Siembra de empresas, sucursales, usuarios y configuraciones completada");

    // ── Escenario 1: Empresa A con autonomía BAJA ───────────────────────────
    console.log("\n2. Evaluando Empresa A (Autonomía BAJA)...");
    // En BAJA, el gerente tiene 0 autoridad: todo gasto ordinario requiere ADMIN.
    const gastoA1 = await createOperatingExpense({
      companyId: empresaA,
      branchId: ramaA.id,
      category: "OTROS",
      amountCents: 50000, // $500 MXN (< $1,000)
      description: "Gasto ordinario en BAJA",
      requestedBy: creatorAId,
    });
    comprobar(gastoA1.status === "PENDING_APPROVAL", "Gasto A1 creado en PENDING_APPROVAL");

    // Intento de aprobación por Gerente A -> 403 Forbidden exigiendo ADMIN
    await rechaza(
      () =>
        approveOperatingExpense(
          gastoA1.id,
          empresaA,
          { kind: "BRANCH", branchId: ramaA.id },
          gerenteAId,
          "GERENTE",
          "Intento gerente en BAJA"
        ),
      403,
      /requiere aprobación de ADMIN \(tu rol: GERENTE\)/
    );

    // Intento de rechazo por Gerente A -> 403 Forbidden exigiendo ADMIN
    await rechaza(
      () =>
        rejectOperatingExpense(
          gastoA1.id,
          empresaA,
          { kind: "BRANCH", branchId: ramaA.id },
          gerenteAId,
          "GERENTE",
          "Rechazo intento gerente en BAJA"
        ),
      403,
      /requiere resolución de ADMIN \(tu rol: GERENTE\)/
    );

    // Aprobación por Admin A -> Exito
    const gastoA1Aprobado = await approveOperatingExpense(
      gastoA1.id,
      empresaA,
      { kind: "ALL" },
      adminAId,
      "ADMIN",
      "Aprobado por corporativo"
    );
    comprobar(
      gastoA1Aprobado.status === "APPROVED" && gastoA1Aprobado.approvedBy === adminAId,
      "Gasto A1 aprobado exitosamente por ADMIN en BAJA"
    );

    // Intento de re-aprobación -> 400 Bad Request
    await rechaza(
      () =>
        approveOperatingExpense(
          gastoA1.id,
          empresaA,
          { kind: "ALL" },
          adminAId,
          "ADMIN"
        ),
      400,
      /No se puede aprobar un gasto en estado "APPROVED"/
    );

    // ── Escenario 2: Empresa B con autonomía ALTA ───────────────────────────
    console.log("\n3. Evaluando Empresa B (Autonomía ALTA)...");
    // Subcaso 2.1: Gasto ordinario de $5,000 MXN (500,000 cents > $1,000 pero < $10,000)
    // En MEDIA requeriría ADMIN, pero en ALTA el gerente está facultado.
    const gastoB1 = await createOperatingExpense({
      companyId: empresaB,
      branchId: ramaB.id,
      category: "OTROS",
      amountCents: 500000, // $5,000 MXN
      description: "Gasto de $5,000 MXN facultado en ALTA",
      requestedBy: creatorBId,
    });

    const gastoB1Aprobado = await approveOperatingExpense(
      gastoB1.id,
      empresaB,
      { kind: "BRANCH", branchId: ramaB.id },
      gerenteBId,
      "GERENTE",
      "Aprobado por gerente de sucursal en ALTA"
    );
    comprobar(
      gastoB1Aprobado.status === "APPROVED" && gastoB1Aprobado.approvedBy === gerenteBId,
      "Gasto B1 de $5,000 MXN aprobado por GERENTE gracias a autonomía ALTA"
    );

    // Subcaso 2.2: Gasto mayor de $15,000 MXN (1,500,000 cents >= $10,000 doble aprobación)
    // El umbral de dueño escala obligatoriamente a OWNER aún con autonomía ALTA.
    const gastoB2 = await createOperatingExpense({
      companyId: empresaB,
      branchId: ramaB.id,
      category: "OTROS",
      amountCents: 1500000, // $15,000 MXN
      description: "Gasto mayor que supera umbral de dueño",
      requestedBy: creatorBId,
    });

    // Intento por GERENTE -> 403 Forbidden (requiere OWNER)
    await rechaza(
      () =>
        approveOperatingExpense(
          gastoB2.id,
          empresaB,
          { kind: "BRANCH", branchId: ramaB.id },
          gerenteBId,
          "GERENTE"
        ),
      403,
      /requiere aprobación de OWNER \(tu rol: GERENTE\)/
    );

    // Intento por ADMIN -> 403 Forbidden (requiere OWNER)
    await rechaza(
      () =>
        approveOperatingExpense(
          gastoB2.id,
          empresaB,
          { kind: "ALL" },
          adminBId,
          "ADMIN"
        ),
      403,
      /requiere aprobación de OWNER \(tu rol: ADMIN\)/
    );

    // Aprobación por OWNER -> Éxito
    const gastoB2Aprobado = await approveOperatingExpense(
      gastoB2.id,
      empresaB,
      { kind: "ALL" },
      ownerBId,
      "OWNER",
      "Aprobado por el dueño"
    );
    comprobar(
      gastoB2Aprobado.status === "APPROVED" && gastoB2Aprobado.approvedBy === ownerBId,
      "Gasto B2 de $15,000 MXN escalado obligatoriamente a OWNER y aprobado"
    );

    // ── Escenario 3: Segregación de funciones (A16) en ALTA ─────────────────
    console.log("\n4. Evaluando segregación de funciones (A16)...");
    // Gerente B crea su propio gasto
    const gastoB3 = await createOperatingExpense({
      companyId: empresaB,
      branchId: ramaB.id,
      category: "OTROS",
      amountCents: 50000, // $500 MXN
      description: "Gasto creado por el mismo gerente",
      requestedBy: gerenteBId,
    });

    // Gerente B intenta auto-aprobarse -> 403 Segregación de funciones
    await rechaza(
      () =>
        approveOperatingExpense(
          gastoB3.id,
          empresaB,
          { kind: "BRANCH", branchId: ramaB.id },
          gerenteBId,
          "GERENTE"
        ),
      403,
      /Segregación de funciones: quien registra un gasto no puede aprobarlo/
    );

    // Otro gerente (Creator B) de la misma sucursal lo aprueba -> Éxito
    const gastoB3Aprobado = await approveOperatingExpense(
      gastoB3.id,
      empresaB,
      { kind: "BRANCH", branchId: ramaB.id },
      creatorBId,
      "GERENTE",
      "Aprobado por colega gerente"
    );
    comprobar(
      gastoB3Aprobado.status === "APPROVED" && gastoB3Aprobado.approvedBy === creatorBId,
      "Segregación confirmada: el colega aprueba, el creador queda bloqueado"
    );

    // ── Escenario 4: Aislamiento multi-tenant y de sucursal ─────────────────
    console.log("\n5. Evaluando aislamiento multi-tenant y de sucursal...");
    // Gasto pendiente en Empresa B
    const gastoB4 = await createOperatingExpense({
      companyId: empresaB,
      branchId: ramaB.id,
      category: "OTROS",
      amountCents: 20000,
      description: "Gasto para prueba de aislamiento",
      requestedBy: creatorBId,
    });

    // Admin de Empresa A intenta aprobar gasto de Empresa B -> 404 Not Found
    await rechaza(
      () =>
        approveOperatingExpense(
          gastoB4.id,
          empresaA, // Empresa equivocada
          { kind: "ALL" },
          adminAId,
          "ADMIN"
        ),
      404,
      /El gasto especificado no fue encontrado/
    );

    // Gerente con alcance acotado a otra sucursal intenta aprobar -> 403 Forbidden
    await rechaza(
      () =>
        approveOperatingExpense(
          gastoB4.id,
          empresaB,
          { kind: "BRANCH", branchId: ramaA.id }, // Sucursal ajena
          gerenteBId,
          "GERENTE"
        ),
      403,
      /No puedes resolver un gasto de otra sucursal/
    );

    // ── Escenario 5: Dinamismo de política en caliente (BAJA -> MEDIA) ───────
    console.log("\n6. Evaluando cambio dinámico de política en caliente...");
    // Cambiamos Empresa A a MEDIA
    await upsertTenantOperatingConfig(empresaA, {
      managerAutonomy: "MEDIA",
    });

    const gastoA2 = await createOperatingExpense({
      companyId: empresaA,
      branchId: ramaA.id,
      category: "OTROS",
      amountCents: 50000, // $500 MXN (< $1,000)
      description: "Gasto ordinario tras cambio a MEDIA",
      requestedBy: creatorAId,
    });

    // En MEDIA, $500 MXN < $1,000 sí lo puede aprobar el gerente
    const gastoA2Aprobado = await approveOperatingExpense(
      gastoA2.id,
      empresaA,
      { kind: "BRANCH", branchId: ramaA.id },
      gerenteAId,
      "GERENTE",
      "Aprobado por gerente bajo política MEDIA"
    );
    comprobar(
      gastoA2Aprobado.status === "APPROVED" && gastoA2Aprobado.approvedBy === gerenteAId,
      "Cambio a MEDIA surtió efecto en caliente: gerente ahora puede aprobar < $1,000"
    );

    // Revertimos Empresa A a BAJA
    await upsertTenantOperatingConfig(empresaA, {
      managerAutonomy: "BAJA",
    });

    const gastoA3 = await createOperatingExpense({
      companyId: empresaA,
      branchId: ramaA.id,
      category: "OTROS",
      amountCents: 50000, // $500 MXN
      description: "Gasto ordinario tras revertir a BAJA",
      requestedBy: creatorAId,
    });

    // Al volver a BAJA, el gerente vuelve a estar bloqueado
    await rechaza(
      () =>
        approveOperatingExpense(
          gastoA3.id,
          empresaA,
          { kind: "BRANCH", branchId: ramaA.id },
          gerenteAId,
          "GERENTE"
        ),
      403,
      /requiere aprobación de ADMIN \(tu rol: GERENTE\)/
    );

  } finally {
    // ── Limpieza completa ───────────────────────────────────────────────────
    console.log("\n7. Limpiando datos de prueba...");
    const { db } = await import("@/lib/db");
    const {
      companies,
      branches,
      users,
      operatingExpenses,
      tenantOperatingConfig,
    } = await import("@/lib/db/schema");

    await db
      .delete(operatingExpenses)
      .where(inArray(operatingExpenses.companyId, empresas));
    await db
      .delete(tenantOperatingConfig)
      .where(inArray(tenantOperatingConfig.companyId, empresas));
    await db.delete(users).where(inArray(users.companyId, empresas));
    await db.delete(branches).where(inArray(branches.companyId, empresas));
    await db.delete(companies).where(inArray(companies.id, empresas));

    const restos = await db
      .select({ id: companies.id })
      .from(companies)
      .where(inArray(companies.id, empresas));
    comprobar(restos.length === 0, "Limpieza de ambas empresas confirmada en Neon");
  }

  console.log(`\n========================================`);
  console.log(`✓ Verificación exitosa: ${comprobaciones} comprobaciones.`);
  console.log(`========================================\n`);
}

main().catch((error) => {
  console.error("Error durante la verificación en Neon:", error);
  process.exitCode = 1;
});
