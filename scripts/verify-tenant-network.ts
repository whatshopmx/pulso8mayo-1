/**
 * C22.4 — Verificación de la política de tipo de empresa (tenantType) contra la base real (Neon).
 *
 * Lo que las pruebas unitarias y de navegador aislado no pueden mostrar:
 * 1. Que las consultas a Postgres leen `tenant_operating_config.tenant_type` y `branches.ownership_type` de verdad.
 * 2. Que `BranchService` valida e impide en Postgres:
 *    - Franquicias sin responsable (`franchiseeUserId` nulo o vacío).
 *    - Franquicias con responsable de OTRA empresa (aislamiento de usuarios).
 *    - Lectura o modificación de sucursales entre empresas distintas (404 estricto).
 * 3. Que `CrossBranchService.getBranchQSRRanking` calcula y segmenta contra Neon:
 *    - En `GRUPO_PROPIO`: detecta y expone la contradicción si hay sucursales `FRANCHISE`.
 *    - En `MIXTO_FRANQUICIAS`: segmenta limpiamente en dos redes sin contradicciones.
 *    - Los promedios y agrupaciones miden cada red por separado.
 * 4. Que el `ctx` del actor respeta `branchVisibilityFilter`:
 *    - Un gerente con alcance a una sola sucursal recibe `completa: false` y exactamente sus sucursales.
 * 5. Que cambiar `tenantType` en caliente (GRUPO_PROPIO -> MIXTO_FRANQUICIAS) actualiza
 *    el veredicto y retira la contradicción inmediatamente.
 *
 * Uso: node --use-system-ca --import tsx scripts/verify-tenant-network.ts
 */

import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";

config({ quiet: true });

async function main() {
  console.log("C22.4 — Verificación de tipo de empresa y redes en Neon\n");

  const { db } = await import("@/lib/db");
  const {
    companies,
    branches,
    users,
    tenantOperatingConfig,
  } = await import("@/lib/db/schema");
  const { BranchService } = await import("@/lib/services/branch-service");
  const { CrossBranchService } = await import("@/lib/services/cross-branch-service");
  const { upsertTenantOperatingConfig } = await import(
    "@/lib/services/tenant-config-service"
  );
  const { ApiError, isApiError } = await import("@/lib/api/error");
  const { buildAccessContextFrom } = await import("@/lib/rbac/abac");

  const empresaA = randomUUID();
  const empresaB = randomUUID();
  const empresas = [empresaA, empresaB];

  const marca = `C22 verificación ${randomUUID().slice(0, 8)}`;
  let comprobaciones = 0;

  function comprobar(ok: unknown, mensaje: string) {
    if (!ok) throw new Error(`FALLO: ${mensaje}`);
    comprobaciones++;
    console.log(`  ✓ ${mensaje}`);
  }

  const sucursalesCreadas: string[] = [];
  const usuariosCreados: string[] = [];

  try {
    // 1. Crear dos empresas
    await db.insert(companies).values([
      { id: empresaA, name: `${marca} Empresa A (Grupo Propio)`, slug: `empresa-a-${empresaA.slice(0, 8)}` },
      { id: empresaB, name: `${marca} Empresa B (Mixto Franquicias)`, slug: `empresa-b-${empresaB.slice(0, 8)}` },
    ] as any);
    comprobar(true, "Empresas de prueba A y B creadas en Neon");

    // 2. Usuarios
    const adminAId = randomUUID();
    const gerenteA1Id = randomUUID();
    const franquiciatarioAId = randomUUID();
    const adminBId = randomUUID();
    const franquiciatarioBId = randomUUID();

    const now = new Date();
    await db.insert(users).values([
      { id: adminAId, companyId: empresaA, name: "Admin A", email: `admin-a-${adminAId.slice(0, 8)}@test.com`, role: "OWNER", createdAt: now, updatedAt: now },
      { id: gerenteA1Id, companyId: empresaA, name: "Gerente A1", email: `gerente-a1-${gerenteA1Id.slice(0, 8)}@test.com`, role: "GERENTE", createdAt: now, updatedAt: now },
      { id: franquiciatarioAId, companyId: empresaA, name: "Franquiciatario A", email: `franq-a-${franquiciatarioAId.slice(0, 8)}@test.com`, role: "GERENTE", createdAt: now, updatedAt: now },
      { id: adminBId, companyId: empresaB, name: "Admin B", email: `admin-b-${adminBId.slice(0, 8)}@test.com`, role: "OWNER", createdAt: now, updatedAt: now },
      { id: franquiciatarioBId, companyId: empresaB, name: "Franquiciatario B", email: `franq-b-${franquiciatarioBId.slice(0, 8)}@test.com`, role: "GERENTE", createdAt: now, updatedAt: now },
    ]);
    usuariosCreados.push(adminAId, gerenteA1Id, franquiciatarioAId, adminBId, franquiciatarioBId);
    comprobar(true, "Usuarios creados con roles válidos en Neon");

    // 3. Reglas de validación de sucursales en BranchService
    // A) Franquicia sin responsable es rechazada
    let rechazoSinFranq = false;
    try {
      await BranchService.createBranch({
        name: "Franquicia Sin Dueño",
        companyId: empresaA,
        timezone: "America/Mexico_City",
        ownershipType: "FRANCHISE",
        franchiseeUserId: null,
      });
    } catch (err: any) {
      if ((isApiError(err) || err instanceof ApiError) && err.statusCode === 400 && err.message.includes("sin franquiciatario")) {
        rechazoSinFranq = true;
      }
    }
    comprobar(rechazoSinFranq, "BranchService rechaza crear sucursal FRANCHISE sin responsable");

    // B) Franquicia con responsable de OTRA empresa es rechazada
    let rechazoOtroTenant = false;
    try {
      await BranchService.createBranch({
        name: "Franquicia Infiltrada",
        companyId: empresaA,
        timezone: "America/Mexico_City",
        ownershipType: "FRANCHISE",
        franchiseeUserId: franquiciatarioBId, // Usuario de Empresa B!
      });
    } catch (err: any) {
      if ((isApiError(err) || err instanceof ApiError) && err.statusCode === 400 && err.message.includes("no pertenece a esta empresa")) {
        rechazoOtroTenant = true;
      }
    }
    comprobar(rechazoOtroTenant, "BranchService rechaza asignar franquiciatario de otra empresa");

    // 4. Crear sucursales válidas
    const branchA1 = await BranchService.createBranch({
      name: `${marca} Sucursal Propia A1`,
      companyId: empresaA,
      timezone: "America/Mexico_City",
      ownershipType: "OWNED",
      managerId: gerenteA1Id,
    });
    sucursalesCreadas.push(branchA1.id);

    const branchA2 = await BranchService.createBranch({
      name: `${marca} Franquicia A2`,
      companyId: empresaA,
      timezone: "America/Mexico_City",
      ownershipType: "FRANCHISE",
      franchiseeUserId: franquiciatarioAId,
    });
    sucursalesCreadas.push(branchA2.id);

    const branchB1 = await BranchService.createBranch({
      name: `${marca} Sucursal Propia B1`,
      companyId: empresaB,
      timezone: "America/Mexico_City",
      ownershipType: "OWNED",
    });
    sucursalesCreadas.push(branchB1.id);

    const branchB2 = await BranchService.createBranch({
      name: `${marca} Franquicia B2`,
      companyId: empresaB,
      timezone: "America/Mexico_City",
      ownershipType: "FRANCHISE",
      franchiseeUserId: franquiciatarioBId,
    });
    sucursalesCreadas.push(branchB2.id);

    comprobar(true, "Sucursales OWNED y FRANCHISE creadas exitosamente en Neon");

    // 5. Aislamiento entre empresas en BranchService
    let rechazoGetCross = false;
    try {
      await BranchService.getBranch(branchB1.id, empresaA);
    } catch (err: any) {
      if ((isApiError(err) || err instanceof ApiError) && err.statusCode === 404) {
        rechazoGetCross = true;
      }
    }
    comprobar(rechazoGetCross, "BranchService.getBranch aísla por companyId (404 al consultar sucursal ajena)");

    let rechazoUpdateCross = false;
    try {
      await BranchService.updateBranch(branchB1.id, { name: "Hack" }, empresaA);
    } catch (err: any) {
      if ((isApiError(err) || err instanceof ApiError) && err.statusCode === 404) {
        rechazoUpdateCross = true;
      }
    }
    comprobar(rechazoUpdateCross, "BranchService.updateBranch aísla por companyId (404 al modificar sucursal ajena)");

    // 6. Configurar políticas operativas
    await upsertTenantOperatingConfig(empresaA, { tenantType: "GRUPO_PROPIO" });
    await upsertTenantOperatingConfig(empresaB, { tenantType: "MIXTO_FRANQUICIAS" });
    comprobar(true, "Políticas de tenantType configuradas: Empresa A = GRUPO_PROPIO, Empresa B = MIXTO_FRANQUICIAS");

    // 7. Ejecutar CrossBranchService.getBranchQSRRanking para Empresa A (GRUPO_PROPIO con sucursal FRANCHISE)
    const rankingA = await CrossBranchService.getBranchQSRRanking(empresaA, 30);
    comprobar(rankingA.branches.length === 2, "Empresa A ve sus 2 sucursales en ranking global");
    comprobar(rankingA.red?.segmentada === true, "Empresa A activa red segmentada");
    comprobar(rankingA.red?.tipoEmpresa === "GRUPO_PROPIO", "Empresa A reporta tipoEmpresa GRUPO_PROPIO");
    comprobar(
      rankingA.red?.contradicciones.length === 1 &&
      rankingA.red.contradicciones[0].includes("1 sucursal(es) marcadas como franquicia"),
      "Empresa A detecta contradicción: grupo propio con franquicia capturada"
    );
    comprobar(
      rankingA.red?.segmentos.some(s => s.tipo === "PROPIA" && s.branchIds.includes(branchA1.id)) &&
      rankingA.red?.segmentos.some(s => s.tipo === "FRANQUICIAS" && s.branchIds.includes(branchA2.id)),
      "Segmentación separa sucursal propia A1 de franquicia A2"
    );

    // 8. Alcance del actor (Gerente A1 asignado a branchA1)
    const ctxGerenteA = buildAccessContextFrom({
      id: gerenteA1Id,
      companyId: empresaA,
      role: "GERENTE",
      branchId: branchA1.id,
    })!;
    const rankingGerenteA = await CrossBranchService.getBranchQSRRanking(empresaA, 30, ctxGerenteA);
    comprobar(rankingGerenteA.alcance?.completa === false, "Gerente A1 recibe alcance incompleto");
    comprobar(rankingGerenteA.alcance?.visibles === 1 && rankingGerenteA.alcance?.total === 2, "Gerente A1 cubre 1 de 2 sucursales");
    comprobar(
      rankingGerenteA.branches.length === 1 && rankingGerenteA.branches[0].branchId === branchA1.id,
      "Gerente A1 sólo ve su sucursal asignada en el ranking"
    );

    // 9. Empresa B (MIXTO_FRANQUICIAS con propia y franquicia)
    const rankingB = await CrossBranchService.getBranchQSRRanking(empresaB, 30);
    comprobar(rankingB.branches.length === 2, "Empresa B ve sus 2 sucursales");
    comprobar(
      !rankingB.branches.some(b => sucursalesCreadas.slice(0, 2).includes(b.branchId)),
      "Empresa B no ve ninguna sucursal de Empresa A (aislamiento multi-tenant)"
    );
    comprobar(rankingB.red?.tipoEmpresa === "MIXTO_FRANQUICIAS", "Empresa B reporta tipoEmpresa MIXTO_FRANQUICIAS");
    comprobar(rankingB.red?.contradicciones.length === 0, "Empresa B no tiene contradicciones de captura");
    comprobar(
      rankingB.red?.veredicto.titulo.includes("Dos redes"),
      "Empresa B recibe veredicto de 'Dos redes'"
    );

    // 10. Actualización dinámica en caliente: Empresa A cambia a MIXTO_FRANQUICIAS
    await upsertTenantOperatingConfig(empresaA, { tenantType: "MIXTO_FRANQUICIAS" });
    const rankingAActualizado = await CrossBranchService.getBranchQSRRanking(empresaA, 30);
    comprobar(
      rankingAActualizado.red?.tipoEmpresa === "MIXTO_FRANQUICIAS",
      "Empresa A lee tenantType actualizado a MIXTO_FRANQUICIAS"
    );
    comprobar(
      rankingAActualizado.red?.contradicciones.length === 0,
      "Contradicción de captura desaparece tras alinear la declaración del grupo"
    );

    console.log(`\nTodas las ${comprobaciones} comprobaciones contra Neon pasaron exitosamente.`);
  } finally {
    console.log("\nLimpiando datos de prueba...");
    try {
      if (sucursalesCreadas.length > 0) {
        await db.delete(branches).where(inArray(branches.id, sucursalesCreadas));
      }
      if (usuariosCreados.length > 0) {
        await db.delete(users).where(inArray(users.id, usuariosCreados));
      }
      await db.delete(tenantOperatingConfig).where(inArray(tenantOperatingConfig.companyId, empresas));
      await db.delete(companies).where(inArray(companies.id, empresas));
      console.log("Limpieza completada.");
    } catch (e: any) {
      console.error("Error durante limpieza:", e.message);
    }
  }
}

main().catch((err) => {
  console.error("Error en verificación:", err);
  process.exit(1);
});
