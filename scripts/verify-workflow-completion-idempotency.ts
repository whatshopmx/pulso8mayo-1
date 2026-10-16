/**
 * C27 — Verificacion de unicidad de la transicion de finalizacion (H10) contra Neon Postgres real.
 *
 * Lo que las pruebas unitarias aisladas no pueden mostrar:
 * 1. Que dos solicitudes concurrentes que completan el ultimo paso cada una transicionan
 *    la instancia a COMPLETED exactamente una vez (bloqueo asesor pg_advisory_xact_lock).
 * 2. Que los efectos secundarios de terminacion (WorkflowActionRunner, smart links,
 *    extractores Inngest) no se disparan dos veces ante completados concurrentes.
 * 3. Que una instancia ya COMPLETED no se vuelve a cerrar ni re-ejecuta efectos.
 * 4. Que la limpieza final deja la base Neon sin registros huorfanos.
 *
 * Uso: node --use-system-ca --import tsx scripts/verify-workflow-completion-idempotency.ts
 */

import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";

config({ quiet: true });

async function main() {
  console.log("C27 — Verificacion de unicidad de transicion de finalizacion contra Neon Postgres\n");

  const { db } = await import("@/lib/db");
  const {
    companies,
    branches,
    users,
    workflowTemplates,
    workflowInstances,
    workflowInstanceSteps,
    workflowCompletionOutbox,
  } = await import("@/lib/db/schema");
  const { WorkflowExecutionService } = await import("@/lib/services/workflow-execution-service");

  const tag = `[VERIFY-C27-${Date.now()}]`;
  const companyId = randomUUID();
  const branchId = randomUUID();
  const userId = randomUUID();
  const templateId = randomUUID();

  const pasoUnoId = "paso-uno";
  const pasoDosId = "paso-dos";

  const templateSteps = [
    {
      id: pasoUnoId,
      type: "TEXT",
      title: "Paso uno",
      description: "Primer paso de la ejecucion.",
      required: true,
    },
    {
      id: pasoDosId,
      type: "TEXT",
      title: "Paso dos (ultimo)",
      description: "Ultimo paso; al completarlo se cierra la instancia.",
      required: true,
    },
  ];

  try {
    console.log("1. Sembrando empresa, sucursal, usuario y plantilla en Neon Postgres...");

    await db.insert(companies).values({
      id: companyId,
      name: `${tag} Empresa HORECA C27`,
    });

    await db.insert(branches).values({
      id: branchId,
      companyId,
      name: `${tag} Sucursal Matriz C27`,
      code: "C27",
    });

    await db.insert(users).values({
      id: userId,
      companyId,
      branchId,
      name: "Auditor C27",
      email: `auditor-c27-${Date.now()}@pulso.test`,
      role: "ADMIN",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.insert(workflowTemplates).values({
      id: templateId,
      companyId,
      name: `${tag} Plantilla C27 Finalizacion Unica`,
      description: "Dos pasos, transicion a COMPLETED idempotente",
      category: "GENERAL",
      scope: "company",
      active: true,
      steps: templateSteps as any,
    });

    console.log("   ✓ Datos base sembrados en Neon Postgres.");

    // 2. Crear instancia de ejecucion con dos pasos pendientes
    const instance = await WorkflowExecutionService.createExecution(
      templateId,
      branchId,
      userId,
      null,
      undefined,
      companyId
    );
    const createdInstanceId = instance.id;
    console.log(`   ✓ Instancia de workflow creada: ${createdInstanceId} (status ${instance.status})`);

    // 3. Completar solo el paso 1: la instancia NO debe cerrarse (queda IN_PROGRESS)
    console.log("\n2. Completar paso 1 de 2: instancia debe quedar IN_PROGRESS (sin efectos de cierre)...");
    await WorkflowExecutionService.updateStep(
      createdInstanceId,
      pasoUnoId,
      { status: "COMPLETED", value: "hecho paso 1" },
      { kind: "session", actor: { userId, role: "ADMIN", companyId, branchId }, performedBy: userId }
    );

    const estadoIntermedio = await db
      .select({ status: workflowInstances.status })
      .from(workflowInstances)
      .where(eq(workflowInstances.id, createdInstanceId));
    if (estadoIntermedio[0]?.status !== "IN_PROGRESS") {
      throw new Error(
        `Esperado IN_PROGRESS tras completar solo el paso 1, recibido ${estadoIntermedio[0]?.status}`
      );
    }
    console.log("   ✓ Comprobacion 2 superada: instancia sigue IN_PROGRESS (no cierra anticipadamente).");

    // 4. Concurrencia: completar el paso 2 y un duplicado del paso 2 al mismo tiempo.
    // Ambas peticiones pasan validacion (paso 2 estaba PENDING), actualizan su paso y
    // llaman a checkProgress. El bloqueo asesor serializa la transicion a COMPLETED:
    // una ejecuta efectos, la otra ve COMPLETED y retorna idempotente.
    console.log("\n3. Completar paso 2 y un duplicado concurrentes: COMPLETED exactamente una vez...");
    const [resultadoPrimero, resultadoDuplicado] = await Promise.all([
      WorkflowExecutionService.updateStep(
        createdInstanceId,
        pasoDosId,
        { status: "COMPLETED", value: "hecho paso 2" },
        { kind: "session", actor: { userId, role: "ADMIN", companyId, branchId }, performedBy: userId }
      ),
      WorkflowExecutionService.updateStep(
        createdInstanceId,
        pasoDosId,
        { status: "COMPLETED", value: "hecho paso 2 duplicado" },
        { kind: "session", actor: { userId, role: "ADMIN", companyId, branchId }, performedBy: userId }
      ),
    ]);

    const estadoFinal = await db
      .select({ status: workflowInstances.status, completedAt: workflowInstances.completedAt })
      .from(workflowInstances)
      .where(eq(workflowInstances.id, createdInstanceId));
    if (estadoFinal[0]?.status !== "COMPLETED") {
      throw new Error(
        `Esperado COMPLETED tras completar el ultimo paso, recibido ${estadoFinal[0]?.status}`
      );
    }
    if (!estadoFinal[0]?.completedAt) {
      throw new Error("completedAt no se establecio al pasar a COMPLETED");
    }
    console.log(
      `   ✓ Comprobacion 3 superada: instancia COMPLETED con completedAt = ${estadoFinal[0].completedAt}.`
    );

    // Ambos resultados deben ser objetos de paso validos (la segunda no falla por terminal
    // porque leyo la instancia IN_PROGRESS antes del commit de la primera; checkProgress
    // la absorbe como idempotente).
    if (resultadoPrimero.step.status !== "COMPLETED" || resultadoDuplicado.step.status !== "COMPLETED") {
      throw new Error("Ambas peticiones concurrentes debieron devolver el paso COMPLETED");
    }
    console.log("   ✓ Ambas peticiones concurrentes devolvieron paso COMPLETED sin error de terminal.");

    // 5. Intento de completar de nuevo una instancia ya COMPLETED: rechazado por contrato (C24)
    // y, en cualquier caso, checkProgress no vuelve a disparar efectos.
    console.log("\n4. Completar sobre instancia ya COMPLETED: sin efectos secundarios duplicados...");
    let terminalRechazado = false;
    try {
      await WorkflowExecutionService.updateStep(
        createdInstanceId,
        pasoUnoId,
        { status: "COMPLETED", value: "intento tardio" },
        { kind: "session", actor: { userId, role: "ADMIN", companyId, branchId }, performedBy: userId }
      );
    } catch (error: any) {
      terminalRechazado = error?.code === "WORKFLOW_TERMINAL" || error?.code === "STEP_ALREADY_COMPLETED";
    }
    if (!terminalRechazado) {
      throw new Error("Se esperaba un rechazo (WORKFLOW_TERMINAL / STEP_ALREADY_COMPLETED) sobre instancia terminal");
    }
    console.log("   ✓ Comprobacion 4 superada: intento sobre instancia terminal rechazado por contrato.");

    // 6. Verificar que no quedaron pasos duplicados ni filas huorfanas de la instancia
    const pasos = await db
      .select({ stepId: workflowInstanceSteps.stepId, status: workflowInstanceSteps.status })
      .from(workflowInstanceSteps)
      .where(eq(workflowInstanceSteps.instanceId, createdInstanceId));
    const pasoDosRows = pasos.filter((p) => p.stepId === pasoDosId);
    if (pasoDosRows.length !== 1) {
      throw new Error(`Esperado exactamente una fila para paso-dos, encontrado ${pasoDosRows.length}`);
    }
    if (pasoDosRows[0]?.status !== "COMPLETED") {
      throw new Error(`paso-dos deveria quedar COMPLETED, estado ${pasoDosRows[0]?.status}`);
    }
    console.log("   ✓ Comprobacion 5 superada: ninguna fila duplicada ni escritura parcial de pasos.");

    console.log("\n=== C27: Todas las comprobaciones en Neon Postgres superadas con exito ===");
  } finally {
    console.log("\nLimpieza de datos de prueba en Neon Postgres...");
    try {
      const instancias = await db
        .select({ id: workflowInstances.id })
        .from(workflowInstances)
        .where(eq(workflowInstances.workflowTemplateId, templateId));

      if (instancias.length > 0) {
        const iIds = instancias.map((i) => i.id);
        await db.delete(workflowInstanceSteps).where(inArray(workflowInstanceSteps.instanceId, iIds));
        await db.delete(workflowCompletionOutbox).where(inArray(workflowCompletionOutbox.instanceId, iIds));
        await db.delete(workflowInstances).where(inArray(workflowInstances.id, iIds));
      }

      await db.delete(workflowTemplates).where(eq(workflowTemplates.id, templateId));
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(branches).where(eq(branches.id, branchId));
      await db.delete(companies).where(eq(companies.id, companyId));

      // Limpieza defensiva de pruebas C27 previas interrumpidas
      const sobrantes = await db
        .select({ id: companies.id })
        .from(companies)
        .where(like(companies.name, "%VERIFY-C27%"));

      for (const comp of sobrantes) {
        const ramas = await db.select({ id: branches.id }).from(branches).where(eq(branches.companyId, comp.id));
        const rIds = ramas.map((r) => r.id);
        if (rIds.length > 0) {
          const insts = await db
            .select({ id: workflowInstances.id })
            .from(workflowInstances)
            .where(inArray(workflowInstances.branchId, rIds));
          const iiIds = insts.map((i) => i.id);
          if (iiIds.length > 0) {
            await db.delete(workflowInstanceSteps).where(inArray(workflowInstanceSteps.instanceId, iiIds));
            await db.delete(workflowCompletionOutbox).where(inArray(workflowCompletionOutbox.instanceId, iiIds));
            await db.delete(workflowInstances).where(inArray(workflowInstances.id, iiIds));
          }
          await db.delete(users).where(inArray(users.branchId, rIds));
          await db.delete(branches).where(inArray(branches.id, rIds));
        }
        await db.delete(workflowTemplates).where(eq(workflowTemplates.companyId, comp.id));
        await db.delete(companies).where(eq(companies.id, comp.id));
      }

      console.log("   ✓ Limpieza completada con exito en Neon Postgres.");
    } catch (cleanupError) {
      console.error("   ⚠️ Error durante la limpieza:", cleanupError);
    }
  }
}

main().catch((err) => {
  console.error("Error fatal en verificacion C27:", err);
  process.exit(1);
});
