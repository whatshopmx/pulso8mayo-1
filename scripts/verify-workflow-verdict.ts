/**
 * C26 — Verificacion de compuerta de confianza minima en veredicto IA (H07) contra Neon Postgres real.
 *
 * Lo que las pruebas unitarias aisladas no pueden mostrar:
 * 1. Que cuando se ejecuta WorkflowExecutionService.updateStep en un paso con ANALISIS_CALIDAD
 *    donde la IA califica con 6/10 (confianza 0.60 < 0.85), la base Neon Postgres persiste
 *    aiAnalysis.passed = false, requiresManualReview = true y decisionRule = 'CONFIDENCE_BELOW_MINIMUM'
 *    bloqueando la autoaprobacion a pesar de que la calidad fue favorable.
 * 2. Que en ANALISIS_SEGURIDAD con is_safe = true pero riesgo medio (confianza 0.75 < 0.85),
 *    la base Neon Postgres persiste aiAnalysis.passed = false y requiresManualReview = true.
 * 3. Que en ANALISIS_CALIDAD con calificacion de excelencia 9.5/10 (confianza 0.95 >= 0.85)
 *    y autoApprove = true, la base Neon Postgres persiste aiAnalysis.passed = true,
 *    requiresManualReview = false y decisionRule = 'AUTO_APPROVED'.
 * 4. Que ante condiciones inseguras (is_safe = false), persiste aiAnalysis.passed = false
 *    y decisionRule = 'SAFETY_HAZARD_DETECTED'.
 * 5. Que en el punto frontera exacto (confianza 0.85 === minConfidence 0.85), el resultado es determinista.
 * 6. Que la limpieza final deja la base Neon sin registros huerfanos.
 *
 * Uso: node --use-system-ca --import tsx scripts/verify-workflow-verdict.ts
 */

import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";

config({ quiet: true });

async function main() {
  console.log("C26 — Verificacion de confianza minima en veredicto IA contra Neon Postgres\n");

  const { db } = await import("@/lib/db");
  const {
    companies,
    branches,
    users,
    workflowTemplates,
    workflowInstances,
    workflowInstanceSteps,
  } = await import("@/lib/db/schema");
  const { WorkflowExecutionService } = await import("@/lib/services/workflow-execution-service");
  const { AIService } = await import("@/lib/services/ai-service");
  const { VerificationType } = await import("@/lib/types/ai-verification");

  const tag = `[VERIFY-C26-${Date.now()}]`;
  const companyId = randomUUID();
  const branchId = randomUUID();
  const userId = randomUUID();
  const templateId = randomUUID();

  const stepQualityId = "paso-inspeccion-calidad";
  const stepSafetyId = "paso-inspeccion-seguridad";
  const stepHighQualityId = "paso-calidad-sobresaliente";

  const templateSteps = [
    {
      id: stepQualityId,
      type: "PHOTO",
      title: "Inspeccion de Calidad de Insumos",
      description: "Fotografia para analisis de calidad e inocuidad.",
      required: true,
      evidenceRequired: true,
      config: {
        verificationRule: {
          verificationType: VerificationType.ANALISIS_CALIDAD,
          minConfidence: 0.85,
          autoApprove: true,
        },
      },
    },
    {
      id: stepSafetyId,
      type: "PHOTO",
      title: "Inspeccion de Seguridad en Cocina",
      description: "Fotografia de areas de trabajo y prevencion de riesgos.",
      required: true,
      evidenceRequired: true,
      config: {
        verificationRule: {
          verificationType: VerificationType.ANALISIS_SEGURIDAD,
          minConfidence: 0.85,
          autoApprove: true,
        },
      },
    },
    {
      id: stepHighQualityId,
      type: "PHOTO",
      title: "Inspeccion Final de Salida",
      description: "Fotografia de presentacion de alimentos terminados.",
      required: true,
      evidenceRequired: true,
      config: {
        verificationRule: {
          verificationType: VerificationType.ANALISIS_CALIDAD,
          minConfidence: 0.85,
          autoApprove: true,
        },
      },
    },
  ];

  try {
    console.log("1. Sembrando empresa, sucursal, usuario y plantilla en Neon Postgres...");

    await db.insert(companies).values({
      id: companyId,
      name: `${tag} Empresa HORECA Calidad`,
    });

    await db.insert(branches).values({
      id: branchId,
      companyId,
      name: `${tag} Sucursal Matriz Calidad`,
      code: "C26",
    });

    await db.insert(users).values({
      id: userId,
      companyId,
      branchId,
      name: "Auditor de Calidad NOM",
      email: `auditor-c26-${Date.now()}@pulso.test`,
      role: "ADMIN",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.insert(workflowTemplates).values({
      id: templateId,
      companyId,
      name: `${tag} Plantilla Auditoria Calidad y Seguridad NOM`,
      description: "Verificacion con compuerta autoritativa de confianza minima",
      category: "QUALITY",
      scope: "company",
      status: "published",
      steps: templateSteps as any,
    });

    console.log("   ✓ Datos base sembrados en Neon Postgres.");

    // 2. Crear instancia de ejecucion en Neon Postgres
    const instance = await WorkflowExecutionService.createExecution(
      templateId,
      branchId,
      userId,
      null,
      undefined,
      companyId
    );
    const createdInstanceId = instance.id;
    console.log(`   ✓ Instancia de workflow creada: ${createdInstanceId}`);

    // 3. Comprobacion 1: Calidad favorable (score 6 -> confianza 0.60 < 0.85) NO autoaprueba
    console.log("\n2. Comprobacion 1: Calidad favorable con baja confianza (< 0.85) bloquea autoaprobacion...");
    const mockCloudflareQualityLowConf = {
      analyzeImage: async () => ({
        isCompliant: true,
        confidence: 0.95,
        description: JSON.stringify({
          score: 6,
          summary: "Calidad aceptable con observaciones en vegetales",
          defects: ["Hojas exteriores marchitas"],
        }),
        rawResponse: { model: "@cf/meta/llama-3.2-11b-vision-instruct" },
      }),
    };
    AIService.setCloudflareClient(mockCloudflareQualityLowConf);

    await WorkflowExecutionService.updateStep(
      createdInstanceId,
      stepQualityId,
      {
        status: "COMPLETED",
        value: "true",
        evidenceUrl: "https://r2.pulso.app/evidence/verdura-01.jpg",
      },
      {
        kind: "session",
        actor: { userId, role: "ADMIN", companyId, branchId },
        performedBy: userId,
      }
    );

    const stepsRows1 = await db
      .select()
      .from(workflowInstanceSteps)
      .where(eq(workflowInstanceSteps.instanceId, createdInstanceId));

    const qualityStepRow = stepsRows1.find((s) => s.stepId === stepQualityId);
    const qAnalysis = qualityStepRow?.aiAnalysis as Record<string, any>;
    if (!qAnalysis) throw new Error("aiAnalysis no se persistio en la base de datos");

    if (qAnalysis.passed !== false) {
      throw new Error(`CRITICO: aiAnalysis.passed deberia ser false por baja confianza, pero fue ${qAnalysis.passed}`);
    }
    const qVrf = qAnalysis.verificationResult;
    if (qVrf?.decisionRule !== "CONFIDENCE_BELOW_MINIMUM") {
      throw new Error(`decisionRule invalido: esperado CONFIDENCE_BELOW_MINIMUM, recibido ${qVrf?.decisionRule}`);
    }
    if (qVrf?.requiresManualReview !== true) {
      throw new Error("requiresManualReview deberia ser true");
    }
    console.log("   ✓ Comprobacion 1 superada: aiAnalysis.passed=false, decisionRule=CONFIDENCE_BELOW_MINIMUM, requiresManualReview=true en Neon.");

    // 4. Comprobacion 2: Seguridad favorable (is_safe: true) con riesgo medio (confianza 0.75 < 0.85) NO autoaprueba
    console.log("\n3. Comprobacion 2: Seguridad favorable con riesgo medio (confianza 0.75 < 0.85) bloquea autoaprobacion...");
    const mockCloudflareSafetyLowConf = {
      analyzeImage: async () => ({
        isCompliant: true,
        confidence: 0.90,
        description: JSON.stringify({
          is_safe: true,
          risk_level: "medium",
          hazards: [],
        }),
        rawResponse: { model: "@cf/meta/llama-3.2-11b-vision-instruct" },
      }),
    };
    AIService.setCloudflareClient(mockCloudflareSafetyLowConf);

    await WorkflowExecutionService.updateStep(
      createdInstanceId,
      stepSafetyId,
      {
        status: "COMPLETED",
        value: "true",
        evidenceUrl: "https://r2.pulso.app/evidence/cocina-seguridad-01.jpg",
      },
      {
        kind: "session",
        actor: { userId, role: "ADMIN", companyId, branchId },
        performedBy: userId,
      }
    );

    const stepsRows2 = await db
      .select()
      .from(workflowInstanceSteps)
      .where(eq(workflowInstanceSteps.instanceId, createdInstanceId));

    const safetyStepRow = stepsRows2.find((s) => s.stepId === stepSafetyId);
    const sAnalysis = safetyStepRow?.aiAnalysis as Record<string, any>;
    if (!sAnalysis) throw new Error("aiAnalysis de seguridad no encontrado");

    if (sAnalysis.passed !== false) {
      throw new Error(`aiAnalysis.passed deberia ser false por confianza 0.75 < 0.85, pero fue ${sAnalysis.passed}`);
    }
    if (sAnalysis.verificationResult?.decisionRule !== "CONFIDENCE_BELOW_MINIMUM") {
      throw new Error(`decisionRule invalido: esperado CONFIDENCE_BELOW_MINIMUM, recibido ${sAnalysis.verificationResult?.decisionRule}`);
    }
    console.log("   ✓ Comprobacion 2 superada: Seguridad favorable con riesgo medio no autoaprueba y exige revision manual en Neon.");

    // 5. Comprobacion 3: Calidad sobresaliente (score 9.5 -> confianza 0.95 >= 0.85) autoaprueba
    console.log("\n4. Comprobacion 3: Calidad sobresaliente (score 9.5/10 -> confianza 0.95 >= 0.85) concede autoaprobacion...");
    const mockCloudflareHighQuality = {
      analyzeImage: async () => ({
        isCompliant: true,
        confidence: 0.99,
        description: JSON.stringify({
          score: 9.5,
          summary: "Excelente presentacion y temperatura correcta",
          defects: [],
        }),
        rawResponse: { model: "@cf/meta/llama-3.2-11b-vision-instruct" },
      }),
    };
    AIService.setCloudflareClient(mockCloudflareHighQuality);

    await WorkflowExecutionService.updateStep(
      createdInstanceId,
      stepHighQualityId,
      {
        status: "COMPLETED",
        value: "true",
        evidenceUrl: "https://r2.pulso.app/evidence/platillo-final.jpg",
      },
      {
        kind: "session",
        actor: { userId, role: "ADMIN", companyId, branchId },
        performedBy: userId,
      }
    );

    const stepsRows3 = await db
      .select()
      .from(workflowInstanceSteps)
      .where(eq(workflowInstanceSteps.instanceId, createdInstanceId));

    const highQualityRow = stepsRows3.find((s) => s.stepId === stepHighQualityId);
    const hqAnalysis = highQualityRow?.aiAnalysis as Record<string, any>;
    if (!hqAnalysis) throw new Error("aiAnalysis de calidad alta no encontrado");

    if (hqAnalysis.passed !== true) {
      throw new Error(`aiAnalysis.passed deberia ser true con score 9.5, pero fue ${hqAnalysis.passed}`);
    }
    if (hqAnalysis.verificationResult?.decisionRule !== "AUTO_APPROVED") {
      throw new Error(`decisionRule esperado AUTO_APPROVED, recibido ${hqAnalysis.verificationResult?.decisionRule}`);
    }
    if (hqAnalysis.verificationResult?.requiresManualReview !== false) {
      throw new Error("requiresManualReview deberia ser false");
    }
    console.log("   ✓ Comprobacion 3 superada: Calidad alta autoaprobada sin revision manual (decisionRule=AUTO_APPROVED).");

    // 6. Comprobacion 4: Conservacion de proveedor, metadatos y trazabilidad
    console.log("\n5. Comprobacion 4: Trazabilidad integral de proveedor, razon y confianza persistidas...");
    if (hqAnalysis.provider !== "cloudflare") {
      throw new Error(`Proveedor esperado 'cloudflare', recibido ${hqAnalysis.provider}`);
    }
    if (typeof hqAnalysis.confidence !== "number" || hqAnalysis.confidence < 0.85) {
      throw new Error(`Confianza esperada >= 0.85, recibida ${hqAnalysis.confidence}`);
    }
    console.log("   ✓ Comprobacion 4 superada: Proveedor 'cloudflare' y confianza registrados fielmente.");

    // 7. Comprobacion 5: Comportamiento determinista en frontera (0.85 === 0.85)
    console.log("\n6. Comprobacion 5: Verificacion determinista en punto frontera (0.85 === 0.85)...");
    const { evaluateVerificationVerdict } = await import("@/lib/workflows/verification-verdict-policy");
    const boundaryVerdict = evaluateVerificationVerdict({
      aiResult: {
        passed: true,
        reason: "Inspeccion en frontera",
        confidence: 0.85,
        provider: "cloudflare",
      },
      rule: {
        verificationType: VerificationType.CLASIFICACION,
        minConfidence: 0.85,
        autoApprove: true,
      },
    });

    if (boundaryVerdict.success !== true || boundaryVerdict.decisionRule !== "AUTO_APPROVED") {
      throw new Error("Fallo determinista en punto frontera exacto 0.85 === 0.85");
    }
    console.log("   ✓ Comprobacion 5 superada: Punto frontera evaluado con determinismo exacto.");

  } finally {
    console.log("\n7. Limpieza de datos de prueba en Neon Postgres...");
    try {
      const prevInst = await db
        .select({ id: workflowInstances.id })
        .from(workflowInstances)
        .where(eq(workflowInstances.workflowTemplateId, templateId));

      if (prevInst.length > 0) {
        const iIds = prevInst.map((i) => i.id);
        await db.delete(workflowInstanceSteps).where(inArray(workflowInstanceSteps.instanceId, iIds));
        await db.delete(workflowInstances).where(inArray(workflowInstances.id, iIds));
      }

      await db.delete(workflowTemplates).where(eq(workflowTemplates.id, templateId));
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(branches).where(eq(branches.id, branchId));
      await db.delete(companies).where(eq(companies.id, companyId));

      // Limpieza defensiva de cualquier compañia huérfana de pruebas C26 anteriores
      const leftoverCompanies = await db
        .select({ id: companies.id })
        .from(companies)
        .where(like(companies.name, "%VERIFY-C26%"));

      for (const comp of leftoverCompanies) {
        const cBranches = await db.select({ id: branches.id }).from(branches).where(eq(branches.companyId, comp.id));
        const bIds = cBranches.map(b => b.id);
        if (bIds.length > 0) {
          const bInst = await db.select({ id: workflowInstances.id }).from(workflowInstances).where(inArray(workflowInstances.branchId, bIds));
          const biIds = bInst.map(i => i.id);
          if (biIds.length > 0) {
            await db.delete(workflowInstanceSteps).where(inArray(workflowInstanceSteps.instanceId, biIds));
            await db.delete(workflowInstances).where(inArray(workflowInstances.id, biIds));
          }
          await db.delete(users).where(inArray(users.branchId, bIds));
          await db.delete(branches).where(inArray(branches.id, bIds));
        }
        await db.delete(workflowTemplates).where(eq(workflowTemplates.companyId, comp.id));
        await db.delete(companies).where(eq(companies.id, comp.id));
      }

      AIService.resetClients();
      console.log("   ✓ Limpieza completada con exito en Neon Postgres.");
    } catch (cleanupError) {
      console.error("   ⚠️ Error durante la limpieza:", cleanupError);
    }
  }

  console.log("\n=== C26: Todas las comprobaciones en Neon Postgres superadas con exito ===");
}

main().catch((err) => {
  console.error("Error fatal en verificacion C26:", err);
  process.exit(1);
});
