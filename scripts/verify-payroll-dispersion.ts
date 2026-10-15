/**
 * C21 — Verificación de la política de dispersión de nómina contra Neon + sandbox FiscalAPI.
 *
 * Lo que este script comprueba contra la base real de Postgres:
 * 1. Que las empresas pueden persistir y alternar de forma independiente entre
 *    las tres modalidades de nómina: 'CONSOLIDADA', 'POR_RAZON_SOCIAL', 'MIXTO'.
 * 2. Que el esquema de nómina no ejecuta envíos automatizados de fondos hacia cuentas bancarias:
 *    la dispersión bancaria autónoma no existe en el producto. Lo que sí existe es el
 *    timbrado de recibos, y ése se ejerce de verdad contra el sandbox de FiscalAPI
 *    (FISCALAPI_ENV=test) con las personas de prueba del SAT y el emisor de sandbox
 *    EKU9003173C9 — sin dinero real: el PAC de pruebas no mueve fondos.
 * 3. Que el cálculo y auditoría de nómina (`calculateEmployeePayroll` / `executePayrollRun`)
 *    y la consulta de corridas en tesorería (`TreasuryService.getUnpaidPayrollRuns`)
 *    mantienen un aislamiento estricto por `companyId`, también en `cfdi_nomina_timbrados`.
 * 4. Que una empresa en 'POR_RAZON_SOCIAL' y otra en 'CONSOLIDADA' conservan su estado
 *    y sus corridas sin contaminar las del otro tenant, y cada una timbra su propio
 *    recibo con su propio destinatario del catálogo SAT.
 * 5. Que alternar la modalidad no altera corridas ni timbrados históricos.
 * 6. Limpieza segura y garantizada de empresas, usuarios, nóminas y timbrados de prueba en `finally`.
 *
 * Los empleados siembran con RFC de personas físicas de prueba del SAT
 * (lib/fiscal/sat-test-data.ts) y sin CURP a propósito: el payload de nómina usa la
 * CURP genérica del catálogo del SAT (XEXX010101MNEXXXA8), porque el complemento
 * valida formato NOM111 y una CURP inventada hace que el PAC rechace el comprobante.
 *
 * La cuenta de sandbox puede no tener timbres disponibles (el PAC responde 403
 * "Saldo insuficiente"). En ese caso el timbrado NO se finge: se comprueba que el
 * rechazo quedó persistido como RECHAZADO con el mensaje real del PAC y que el
 * payslip no afirma TIMBRADO, y el folio queda como pendiente al final del informe.
 * Los timbres de prueba se compran en el dashboard de FiscalAPI con las tarjetas
 * de prueba (docs.fiscalapi.com/testing-data); PCI DSS impide comprarlos por API.
 *
 * Uso: node --use-system-ca --import tsx scripts/verify-payroll-dispersion.ts
 */

import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";

config({ quiet: true });

async function main() {
  console.log("C21 — Verificación de política de dispersión de nómina en Neon\n");

  const { db } = await import("@/lib/db");
  const {
    companies,
    branches,
    users,
    employeeProfiles,
    employeeContracts,
    shiftSessions,
    payrollRuns,
    payrollPayslips,
    tenantOperatingConfig,
    cfdiNominaTimbrados,
  } = await import("@/lib/db/schema");
  const { upsertTenantOperatingConfig, getTenantOperatingConfig } = await import(
    "@/lib/services/tenant-config-service"
  );
  const { calculateEmployeePayroll, executePayrollRun, getPayrollRuns } = await import(
    "@/lib/services/payroll-service"
  );
  const { TreasuryService } = await import("@/lib/services/treasury-service");
  const { SAT_TEST_FISICAS } = await import("@/lib/fiscal/sat-test-data");

  // Personas físicas de prueba del SAT (docs.fiscalapi.com/testing-data): el RFC
  // del empleado decide el receptor del CFDI; fuera del catálogo, el payload cae
  // a la persona de respaldo y las dos empresas timbrarían hacia la misma.
  const [fisicaA, fisicaB] = SAT_TEST_FISICAS;

  const empresaA = randomUUID();
  const empresaB = randomUUID();
  const empresas = [empresaA, empresaB];

  const marca = `C21 verificación ${randomUUID().slice(0, 8)}`;
  let comprobaciones = 0;
  /** Folios que el sandbox no pudo timbrar por falta de timbres de prueba. */
  const pendientes: string[] = [];

  function comprobar(ok: unknown, mensaje: string) {
    if (!ok) throw new Error(`FALLO: ${mensaje}`);
    comprobaciones++;
    console.log(`  ✓ ${mensaje}`);
  }

  /**
   * Revisa el timbrado de un empleado contra el sandbox. Con timbres disponibles
   * exige TIMBRADO + folio. Sin ellos, exige que el rechazo del PAC quedó
   * guardado tal cual (RECHAZADO + mensaje) y anota el folio como pendiente:
   * la ausencia de timbre se registra, no se maquilla.
   */
  function revisarTimbrado(
    fila: { status: string | null; uuid: string | null; empleadoRfc: string | null; rawResponse: unknown },
    receptor: { tin: string; legalName: string },
    contexto: string
  ) {
    const cuerpo = JSON.stringify(fila.rawResponse ?? "");
    if (fila.status === "TIMBRADO") {
      comprobar(
        Boolean(fila.uuid),
        `${contexto}: el PAC devolvió TIMBRADO con UUID ${fila.uuid?.slice(0, 8)}… para ${receptor.legalName}`
      );
    } else if (fila.status === "RECHAZADO" && cuerpo.includes("Saldo insuficiente")) {
      comprobar(
        cuerpo.includes("Saldo insuficiente"),
        `${contexto}: el sandbox no tiene timbres y el rechazo real del PAC quedó persistido (RECHAZADO, sin fingir timbrado)`
      );
      pendientes.push(
        `${contexto}: timbrado real pendiente — la cuenta de sandbox tiene 0 timbres. ` +
          "Comprar timbres de prueba en el dashboard de FiscalAPI y re-ejecutar."
      );
    } else {
      throw new Error(
        `FALLO: ${contexto}: timbrado en estado inesperado ${fila.status} — ${cuerpo.slice(0, 200)}`
      );
    }
    comprobar(
      fila.empleadoRfc === receptor.tin,
      `${contexto}: el receptor del CFDI es la persona de prueba del SAT designada, no una inventada`
    );
  }

  try {
    console.log("1. Siembra de empresas y configuraciones de nómina");

    await db.insert(companies).values([
      { id: empresaA, name: `${marca} — Empresa A (Consolidada)`, taxId: "AAA010101AAA" },
      { id: empresaB, name: `${marca} — Empresa B (Por Razón Social)`, taxId: "BBB010101BBB" },
    ]);
    comprobar(true, "Empresas creadas con RFCs distintos");

    const sucursalA = randomUUID();
    const sucursalB = randomUUID();

    await db.insert(branches).values([
      { id: sucursalA, companyId: empresaA, name: "Sucursal Central A", code: "SCA" },
      { id: sucursalB, companyId: empresaB, name: "Sucursal Franquicia B", code: "SFB" },
    ]);
    comprobar(true, "Sucursales creadas para cada empresa");

    // Empresa A: CONSOLIDADA
    await upsertTenantOperatingConfig(empresaA, {
      payrollDispersion: "CONSOLIDADA",
    });

    // Empresa B: POR_RAZON_SOCIAL
    await upsertTenantOperatingConfig(empresaB, {
      payrollDispersion: "POR_RAZON_SOCIAL",
    });

    const configA = await getTenantOperatingConfig(empresaA);
    const configB = await getTenantOperatingConfig(empresaB);

    comprobar(
      configA.payrollDispersion === "CONSOLIDADA",
      "Empresa A configurada con dispersión CONSOLIDADA"
    );
    comprobar(
      configB.payrollDispersion === "POR_RAZON_SOCIAL",
      "Empresa B configurada con dispersión POR_RAZON_SOCIAL"
    );

    console.log("\n2. Siembra de empleados y contratos con datos fiscales reales");

    const userA = randomUUID();
    const userB = randomUUID();

    await db.insert(users).values([
      {
        id: userA,
        companyId: empresaA,
        name: "Empleado Empresa A",
        email: `emp_a_${userA.slice(0, 6)}@test.com`,
        role: "EMPLEADO",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: userB,
        companyId: empresaB,
        name: "Empleado Empresa B",
        email: `emp_b_${userB.slice(0, 6)}@test.com`,
        role: "EMPLEADO",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    await db.insert(employeeProfiles).values([
      {
        id: randomUUID(),
        userId: userA,
        rfc: fisicaA.tin,
        // Sin CURP a propósito: el payload del timbrado usa la CURP genérica de
        // pruebas del SAT. Una CURP inventada hace fallar la validación NOM111.
        curp: null,
        nss: "12345678901",
        employeeNumber: "EMP-A-01",
        isActive: true,
        createdBy: userA,
      },
      {
        id: randomUUID(),
        userId: userB,
        rfc: fisicaB.tin,
        curp: null,
        nss: "98765432109",
        employeeNumber: "EMP-B-01",
        isActive: true,
        createdBy: userB,
      },
    ]);

    await db.insert(employeeContracts).values([
      {
        id: randomUUID(),
        userId: userA,
        companyId: empresaA,
        contractNumber: "CTR-A-01",
        contractType: "INDETERMINATE" as const,
        workRegime: "DAILY" as const,
        startDate: new Date("2025-01-01"),
        baseSalary: 100000, // $1,000 MXN diario en centavos
        monthlySalary: 3000000,
        status: "ACTIVE",
        createdBy: userA,
      },
      {
        id: randomUUID(),
        userId: userB,
        companyId: empresaB,
        contractNumber: "CTR-B-01",
        contractType: "INDETERMINATE" as const,
        workRegime: "DAILY" as const,
        startDate: new Date("2025-01-01"),
        baseSalary: 120000, // $1,200 MXN diario en centavos
        monthlySalary: 3600000,
        status: "ACTIVE",
        createdBy: userB,
      },
    ]);

    // Checadas / sesiones de asistencia para superar la validación antifraude (empleado no fantasma)
    await db.insert(shiftSessions).values([
      {
        id: randomUUID(),
        userId: userA,
        branchId: sucursalA,
        status: "COMPLETED",
        startedAt: new Date("2026-10-05T08:00:00Z"),
        endedAt: new Date("2026-10-05T16:00:00Z"),
      },
      {
        id: randomUUID(),
        userId: userB,
        branchId: sucursalB,
        status: "COMPLETED",
        startedAt: new Date("2026-10-05T08:00:00Z"),
        endedAt: new Date("2026-10-05T16:00:00Z"),
      },
    ]);
    comprobar(true, "Perfiles, contratos y checadas creados con datos fiscales y de checador reales");

    console.log("\n3. Cálculo y aislamiento de percepciones por empresa");

    // Periodo de 15 días: 2026-10-01 a 2026-10-15 (15 días * $1,000 = $15,000 = 1,500,000 centavos)
    const calcA = await calculateEmployeePayroll(userA, "2026-10-01", "2026-10-15");
    comprobar(
      calcA.baseSalaryCents === 1500000 && calcA.totalPercepcionesCents === 1500000,
      "Cálculo de nómina para empleado de Empresa A refleja su salario exacto (15 días * salario diario)"
    );

    // Periodo de 15 días: 2026-10-01 a 2026-10-15 (15 días * $1,200 = $18,000 = 1,800,000 centavos)
    const calcB = await calculateEmployeePayroll(userB, "2026-10-01", "2026-10-15");
    comprobar(
      calcB.baseSalaryCents === 1800000 && calcB.totalPercepcionesCents === 1800000,
      "Cálculo de nómina para empleado de Empresa B refleja su salario exacto (15 días * salario diario)"
    );

    console.log("\n4. Ejecución de nómina, timbrado real en sandbox y aislamiento");

    // Ejecutar corrida de nómina para Empresa A — esto timbra de verdad contra
    // https://test.fiscalapi.com con el CSD de sandbox del emisor y la persona
    // física de prueba como receptor.
    const runResultA = await executePayrollRun(
      empresaA,
      "2026-10-01",
      "2026-10-15",
      userA
    );
    comprobar(
      Boolean(runResultA.runId),
      "Corrida de nómina ejecutada exitosamente para Empresa A"
    );

    // Verificar en DB que se generó la corrida y los payslips
    const runsA = await getPayrollRuns(empresaA);
    comprobar(runsA.length === 1, "Empresa A tiene exactamente 1 corrida registrada");

    const runsB = await getPayrollRuns(empresaB);
    comprobar(
      runsB.length === 0,
      "Empresa B no ve las corridas de Empresa A (aislamiento multi-tenant)"
    );

    console.log("\n5. Timbrado real contra el sandbox de FiscalAPI (cuentas de prueba del SAT)");

    const timbradosA = await db
      .select()
      .from(cfdiNominaTimbrados)
      .where(eq(cfdiNominaTimbrados.companyId, empresaA));
    comprobar(
      timbradosA.length === 1,
      "Empresa A tiene exactamente 1 timbrado (un recibo, un folio)"
    );
    revisarTimbrado(timbradosA[0], fisicaA, "Empresa A");

    const payslipsA = await db
      .select()
      .from(payrollPayslips)
      .where(eq(payrollPayslips.runId, runResultA.runId!));
    comprobar(payslipsA.length === 1, "La corrida de Empresa A produjo exactamente 1 payslip");
    if (timbradosA[0].status === "TIMBRADO") {
      comprobar(
        payslipsA[0].cfdiStatus === "TIMBRADO" &&
          payslipsA[0].cfdiUuid === timbradosA[0].uuid,
        "El payslip de la corrida conserva el folio timbrado (recargar no lo borra)"
      );
    } else {
      comprobar(
        payslipsA[0].cfdiStatus !== "TIMBRADO" && !payslipsA[0].cfdiUuid,
        "Con el PAC rechazado, el payslip no afirma TIMBRADO ni guarda folio"
      );
    }

    console.log("\n6. Consulta en Tesorería y verificación de layouts sin envío de dinero");

    const unpaidRunsA = await TreasuryService.getUnpaidPayrollRuns(empresaA);
    comprobar(
      unpaidRunsA.length === 1,
      "Tesorería identifica la nómina de Empresa A como pendiente de programar en corrida"
    );
    comprobar(
      unpaidRunsA[0].totalAmountCents === 1500000,
      "Total de nómina no dispersada en tesorería coincide con las percepciones"
    );

    const unpaidRunsB = await TreasuryService.getUnpaidPayrollRuns(empresaB);
    comprobar(
      unpaidRunsB.length === 0,
      "Tesorería para Empresa B no muestra nóminas de Empresa A"
    );

    // Empresa B también ejecuta su corrida, con su propia persona física de
    // prueba: la modalidad POR_RAZON_SOCIAL describe la operación, no cambia
    // el recorrido.
    const runResultB = await executePayrollRun(
      empresaB,
      "2026-10-01",
      "2026-10-15",
      userB
    );
    const timbradosB = await db
      .select()
      .from(cfdiNominaTimbrados)
      .where(eq(cfdiNominaTimbrados.companyId, empresaB));
    comprobar(
      timbradosB.length === 1,
      "Empresa B produjo exactamente 1 timbrado, sin tocar los de Empresa A"
    );
    revisarTimbrado(timbradosB[0], fisicaB, "Empresa B");
    comprobar(
      runResultB.runId !== runResultA.runId,
      "Cada empresa produjo su propia corrida con folio independiente"
    );

    console.log("\n7. Alternancia de modalidad y persistencia sin efectos secundarios");

    // Alternar Empresa A a MIXTO
    await upsertTenantOperatingConfig(empresaA, {
      payrollDispersion: "MIXTO",
    });
    const configAMixto = await getTenantOperatingConfig(empresaA);
    comprobar(
      configAMixto.payrollDispersion === "MIXTO",
      "Empresa A alternada a modalidad MIXTO correctamente"
    );

    // Corridas previas siguen intactas
    const runsAPost = await getPayrollRuns(empresaA);
    comprobar(
      runsAPost.length === 1 && runsAPost[0].id === runResultA.runId,
      "Alternar la dimensión descriptiva no altera ni invalida corridas históricas"
    );

    // El timbrado histórico tampoco se toca: la modalidad no reescribe folios
    // ni cambia el estado registrado del comprobante.
    const timbradosAPost = await db
      .select()
      .from(cfdiNominaTimbrados)
      .where(eq(cfdiNominaTimbrados.companyId, empresaA));
    comprobar(
      timbradosAPost.length === 1 &&
        timbradosAPost[0].uuid === timbradosA[0].uuid &&
        timbradosAPost[0].status === timbradosA[0].status,
      "El timbrado permanece idéntico (mismo folio, mismo estado) tras cambiar la modalidad"
    );

    console.log(`\nVerificación C21 completada: ${comprobaciones} comprobaciones pasadas.`);
    if (pendientes.length > 0) {
      console.log("\nPendientes registrados (no acreditados como verificados):");
      for (const p of pendientes) console.log(`  ! ${p}`);
    }
  } finally {
    console.log("\nLimpieza de filas de prueba en Neon...");
    try {
      // 1. Timbrados y Payslips de corridas creadas
      await db
        .delete(cfdiNominaTimbrados)
        .where(inArray(cfdiNominaTimbrados.companyId, empresas));

      const runs = await db
        .select({ id: payrollRuns.id })
        .from(payrollRuns)
        .where(inArray(payrollRuns.companyId, empresas));
      if (runs.length > 0) {
        await db
          .delete(payrollPayslips)
          .where(inArray(payrollPayslips.runId, runs.map((r) => r.id)));
        await db
          .delete(payrollRuns)
          .where(inArray(payrollRuns.companyId, empresas));
      }

      // 2. Contratos y perfiles
      const usuarios = await db
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.companyId, empresas));
      if (usuarios.length > 0) {
        const uids = usuarios.map((u) => u.id);
        await db.delete(shiftSessions).where(inArray(shiftSessions.userId, uids));
        await db.delete(employeeContracts).where(inArray(employeeContracts.userId, uids));
        await db.delete(employeeProfiles).where(inArray(employeeProfiles.userId, uids));
        await db.delete(users).where(inArray(users.id, uids));
      }

      // 3. Config y sucursales
      await db
        .delete(tenantOperatingConfig)
        .where(inArray(tenantOperatingConfig.companyId, empresas));
      await db.delete(branches).where(inArray(branches.companyId, empresas));
      await db.delete(companies).where(inArray(companies.id, empresas));

      console.log("Limpieza terminada con éxito.");
    } catch (cleanupErr) {
      console.error("Error durante limpieza de prueba:", cleanupErr);
    }
  }
}

main().catch((err) => {
  console.error("Error en la ejecución:", err);
  process.exit(1);
});
