/**
 * C24 — Verificación de contrato de paso en servidor (H08) contra Neon Postgres real.
 *
 * Lo que las pruebas unitarias y de navegador aislado no pueden mostrar:
 * 1. Que las restricciones se ejecutan de verdad antes de cualquier persistencia en Postgres.
 * 2. Que un payload inválido (falta de valor, falta de evidencia requerida, valor fuera de límites)
 *    deja la base de datos intacta (el estado del paso en Postgres permanece PENDING y no se altera).
 * 3. Que un usuario con rol EMPLEADO no puede omitir (SKIPPED) un paso obligatorio en la base real (403).
 * 4. Que un SUPERVISOR sí puede omitir un paso obligatorio proporcionando justificación válida,
 *    quedando asentado en Postgres con status 'SKIPPED' y comment registrado.
 * 5. Que una vez completado el flujo completo (estado terminal COMPLETED), Postgres rechaza
 *    modificaciones posteriores con error WORKFLOW_TERMINAL (409).
 * 6. Que la limpieza final deja la base Neon en su estado original sin datos huérfanos.
 *
 * Uso: node --use-system-ca --import tsx scripts/verify-workflow-step-contract.ts
 */

import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { eq, inArray, like, and } from "drizzle-orm";

config({ quiet: true });

async function main() {
  console.log("C24 — Verificación de contrato de paso en servidor contra Neon Postgres\n");

  const { db } = await import("@/lib/db");
  const {
    companies,
    branches,
    users,
    workflowTemplates,
    workflowInstances,
    workflowInstanceSteps,
  } = await import("@/lib/db/schema");
  const {
    WorkflowExecutionService,
    WorkflowStepContractError,
  } = await import("@/lib/services/workflow-execution-service");

  const tag = `[VERIFY-C24-${Date.now()}]`;
  const companyId = randomUUID();
  const branchId = randomUUID();
  const empleadoId = randomUUID();
  const supervisorId = randomUUID();
  const templateId = randomUUID();
  const instanceId = randomUUID();

  const step1Id = "paso-1-temperatura";
  const step2Id = "paso-2-observaciones";

  const templateSteps = [
    {
      id: step1Id,
      type: "NUMBER",
      title: "Temperatura de Cámara Fría",
      description: "Límite NOM-251: entre 2°C y 8°C. Requiere foto del termómetro.",
      required: true,
      evidenceRequired: true,
      validation: { min: 2, max: 8 },
    },
    {
      id: step2Id,
      type: "TEXT",
      title: "Observaciones del Operador",
      description: "Comentarios sobre el estado general.",
      required: false,
    },
  ];

  try {
    // 0. Limpieza preventiva de datos previos con prefijo [VERIFY-C24
    const prevCompanies = await db.select({ id: companies.id }).from(companies).where(like(companies.name, "[VERIFY-C24%"));
    if (prevCompanies.length > 0) {
      const pIds = prevCompanies.map((c) => c.id);
      const prevBranches = await db.select({ id: branches.id }).from(branches).where(inArray(branches.companyId, pIds));
      if (prevBranches.length > 0) {
        const bIds = prevBranches.map((b) => b.id);
        const prevInst = await db.select({ id: workflowInstances.id }).from(workflowInstances).where(inArray(workflowInstances.branchId, bIds));
        if (prevInst.length > 0) {
          const iIds = prevInst.map((i) => i.id);
          await db.delete(workflowInstanceSteps).where(inArray(workflowInstanceSteps.instanceId, iIds));
          await db.delete(workflowInstances).where(inArray(workflowInstances.id, iIds));
        }
        await db.delete(branches).where(inArray(branches.id, bIds));
      }
      await db.delete(workflowTemplates).where(inArray(workflowTemplates.companyId, pIds));
      await db.delete(users).where(inArray(users.companyId, pIds));
      await db.delete(companies).where(inArray(companies.id, pIds));
    }

    // 1. Crear empresa y sucursal de prueba
    await db.insert(companies).values([
      { id: companyId, name: `${tag} Empresa HORECA C24` },
    ]);
    await db.insert(branches).values([
      { id: branchId, companyId, name: `${tag} Sucursal Matriz`, code: `C24` },
    ]);

    // 2. Crear usuarios: Empleado y Supervisor
    await db.insert(users).values([
      {
        id: empleadoId,
        companyId,
        branchId,
        name: "Operador C24",
        email: `empleado-${Date.now()}@pulso.mx`,
        role: "EMPLEADO",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: supervisorId,
        companyId,
        branchId,
        name: "Supervisor C24",
        email: `supervisor-${Date.now()}@pulso.mx`,
        role: "SUPERVISOR",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    // 3. Crear plantilla de workflow
    await db.insert(workflowTemplates).values([
      {
        id: templateId,
        companyId,
        name: `${tag} Checklist Cámaras Frías`,
        description: "Plantilla para verificar cumplimiento de contrato de paso",
        steps: templateSteps as any,
        category: "OPERATIONS",
      },
    ]);

    // 4. Iniciar ejecución de workflow
    const instance = await WorkflowExecutionService.createExecution(
      templateId,
      branchId,
      empleadoId,
      null,
      undefined,
      companyId
    );
    const createdInstanceId = instance.id;

    console.log("  ✓ Empresa, sucursal, usuarios, plantilla e instancia creados en Neon");

    const actorEmpleado = {
      userId: empleadoId,
      role: "EMPLEADO" as const,
      companyId,
      branchId,
    };

    const actorSupervisor = {
      userId: supervisorId,
      role: "SUPERVISOR" as const,
      companyId,
      branchId,
    };

    // 5. Test 1: Rechazo si falta evidencia obligatoria (evidenceRequired: true)
    let errorEvidencia: any = null;
    try {
      await WorkflowExecutionService.updateStep(
        createdInstanceId,
        step1Id,
        {
          status: "COMPLETED",
          value: 4.5,
          evidenceUrl: null,
        },
        { kind: "session", actor: actorEmpleado, performedBy: empleadoId }
      );
    } catch (err) {
      errorEvidencia = err;
    }

    if (!(errorEvidencia instanceof WorkflowStepContractError) || errorEvidencia.code !== "EVIDENCE_REQUIRED") {
      throw new Error(`Se esperaba error EVIDENCE_REQUIRED pero se obtuvo: ${errorEvidencia}`);
    }

    // Verificar en Postgres que el paso NO fue modificado
    const paso1Postgres1 = await db.query.workflowInstanceSteps.findFirst({
      where: and(
        eq(workflowInstanceSteps.instanceId, createdInstanceId),
        eq(workflowInstanceSteps.stepId, step1Id)
      ),
    });
    if (paso1Postgres1?.status !== "PENDING" || paso1Postgres1?.value !== null) {
      throw new Error("Postgres fue modificado indebidamente tras error de evidencia");
    }
    console.log("  ✓ Servidor rechazó falta de evidencia requerida (EVIDENCE_REQUIRED 400) sin alterar Postgres");

    // 6. Test 2: Rechazo si el valor excede límites definidos (min: 2, max: 8)
    let errorLimites: any = null;
    try {
      await WorkflowExecutionService.updateStep(
        createdInstanceId,
        step1Id,
        {
          status: "COMPLETED",
          value: 14.2,
          evidenceUrl: "https://r2.pulso.mx/termometro.jpg",
        },
        { kind: "session", actor: actorEmpleado, performedBy: empleadoId }
      );
    } catch (err) {
      errorLimites = err;
    }

    if (!(errorLimites instanceof WorkflowStepContractError) || errorLimites.code !== "VALUE_OUT_OF_BOUNDS") {
      throw new Error(`Se esperaba error VALUE_OUT_OF_BOUNDS pero se obtuvo: ${errorLimites}`);
    }

    const paso1Postgres2 = await db.query.workflowInstanceSteps.findFirst({
      where: and(
        eq(workflowInstanceSteps.instanceId, createdInstanceId),
        eq(workflowInstanceSteps.stepId, step1Id)
      ),
    });
    if (paso1Postgres2?.status !== "PENDING") {
      throw new Error("Postgres fue modificado indebidamente tras error de límites");
    }
    console.log("  ✓ Servidor rechazó valor fuera de rango numérico (VALUE_OUT_OF_BOUNDS 400) sin alterar Postgres");

    // 7. Test 3: Rechazo de omisión por parte de un EMPLEADO en paso obligatorio (403)
    let errorOmisionEmpleado: any = null;
    try {
      await WorkflowExecutionService.updateStep(
        createdInstanceId,
        step1Id,
        {
          status: "SKIPPED",
          comment: "No tuve tiempo",
        },
        { kind: "session", actor: actorEmpleado, performedBy: empleadoId }
      );
    } catch (err) {
      errorOmisionEmpleado = err;
    }

    if (!(errorOmisionEmpleado instanceof WorkflowStepContractError) || errorOmisionEmpleado.code !== "UNAUTHORIZED_SKIP") {
      throw new Error(`Se esperaba error UNAUTHORIZED_SKIP 403 pero se obtuvo: ${errorOmisionEmpleado}`);
    }
    console.log("  ✓ Servidor impidió a EMPLEADO omitir paso obligatorio (UNAUTHORIZED_SKIP 403)");

    // 8. Test 4: Rechazo a SUPERVISOR si omite paso obligatorio sin justificación (400)
    let errorOmisionSinMotivo: any = null;
    try {
      await WorkflowExecutionService.updateStep(
        createdInstanceId,
        step1Id,
        {
          status: "SKIPPED",
          comment: "   ",
        },
        { kind: "session", actor: actorSupervisor, performedBy: supervisorId }
      );
    } catch (err) {
      errorOmisionSinMotivo = err;
    }

    if (!(errorOmisionSinMotivo instanceof WorkflowStepContractError) || errorOmisionSinMotivo.code !== "SKIP_JUSTIFICATION_REQUIRED") {
      throw new Error(`Se esperaba error SKIP_JUSTIFICATION_REQUIRED 400 pero se obtuvo: ${errorOmisionSinMotivo}`);
    }
    console.log("  ✓ Servidor impidió omisión de supervisor sin justificación (SKIP_JUSTIFICATION_REQUIRED 400)");

    // 9. Test 5: SUPERVISOR puede omitir paso obligatorio con justificación válida
    const justificacionOficial = "Cámara fría en descongelamiento programado y mantenimiento técnico NOM-251";
    await WorkflowExecutionService.updateStep(
      createdInstanceId,
      step1Id,
      {
        status: "SKIPPED",
        comment: justificacionOficial,
      },
      { kind: "session", actor: actorSupervisor, performedBy: supervisorId }
    );

    const paso1PostgresSkipped = await db.query.workflowInstanceSteps.findFirst({
      where: and(
        eq(workflowInstanceSteps.instanceId, createdInstanceId),
        eq(workflowInstanceSteps.stepId, step1Id)
      ),
    });
    if (paso1PostgresSkipped?.status !== "SKIPPED" || paso1PostgresSkipped?.comment !== justificacionOficial) {
      throw new Error(`Paso omitido no se guardó correctamente en Postgres: ${JSON.stringify(paso1PostgresSkipped)}`);
    }
    console.log("  ✓ SUPERVISOR omitió paso obligatorio con justificación, asentado exitosamente en Postgres");

    // 10. Completar el paso 2 para cerrar la ejecución
    await WorkflowExecutionService.updateStep(
      createdInstanceId,
      step2Id,
      {
        status: "COMPLETED",
        value: "Inspección completada con éxito.",
      },
      { kind: "session", actor: actorEmpleado, performedBy: empleadoId }
    );

    // Verificar que la instancia esté COMPLETED
    const instanciaFinal = await db.query.workflowInstances.findFirst({
      where: eq(workflowInstances.id, createdInstanceId),
    });
    if (instanciaFinal?.status !== "COMPLETED") {
      throw new Error(`Se esperaba instancia COMPLETED pero está en ${instanciaFinal?.status}`);
    }
    console.log("  ✓ Todos los pasos completados; instancia cerrada en Postgres (status = COMPLETED)");

    // 11. Test 6: Rechazo de cualquier modificación una vez la instancia es terminal (409)
    let errorTerminal: any = null;
    try {
      await WorkflowExecutionService.updateStep(
        createdInstanceId,
        step2Id,
        {
          status: "COMPLETED",
          value: "Intento de modificar flujo ya cerrado",
        },
        { kind: "session", actor: actorSupervisor, performedBy: supervisorId }
      );
    } catch (err) {
      errorTerminal = err;
    }

    if (!(errorTerminal instanceof WorkflowStepContractError) || errorTerminal.code !== "WORKFLOW_TERMINAL") {
      throw new Error(`Se esperaba error WORKFLOW_TERMINAL 409 pero se obtuvo: ${errorTerminal}`);
    }
    console.log("  ✓ Flujo cerrado bloquea cualquier edición posterior en Postgres (WORKFLOW_TERMINAL 409)");

    console.log("\nTodas las comprobaciones de contrato de paso contra Neon pasaron exitosamente.");
  } finally {
    console.log("\nLimpiando datos de prueba en Neon...");
    // 1. Borrar pasos de instancias
    const instancias = await db
      .select({ id: workflowInstances.id })
      .from(workflowInstances)
      .where(eq(workflowInstances.branchId, branchId));

    if (instancias.length > 0) {
      const instIds = instancias.map((i) => i.id);
      await db.delete(workflowInstanceSteps).where(inArray(workflowInstanceSteps.instanceId, instIds));
      await db.delete(workflowInstances).where(inArray(workflowInstances.id, instIds));
    }

    // 2. Borrar plantillas
    await db.delete(workflowTemplates).where(eq(workflowTemplates.companyId, companyId));

    // 3. Borrar usuarios
    await db.delete(users).where(eq(users.companyId, companyId));

    // 4. Borrar sucursales
    await db.delete(branches).where(eq(branches.companyId, companyId));

    // 5. Borrar empresa
    await db.delete(companies).where(eq(companies.id, companyId));

    console.log("Limpieza completada.");
  }
}

main().catch((err) => {
  console.error("Falló la verificación de contrato de paso:", err);
  process.exit(1);
});
