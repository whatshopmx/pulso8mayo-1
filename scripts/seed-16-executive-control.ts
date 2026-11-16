import "dotenv/config";
import { db } from "@/lib/db";
import {
  companySubscriptions, subscriptionTiers, workflowTemplates,
  nom035ActionPlans, executiveDecisions,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { main as seedTiers } from "./seed-subscription-tiers";
import { PlaybookService } from "@/lib/services/playbook-service";
import { runExceptionAdapters } from "@/lib/services/exception-adapters";
import { withLocalDomainEvents } from "@/lib/services/domain-event-service";
import { recalculateTwin } from "@/lib/services/operational-twin-engine";
import { ExecutiveTwinEngine } from "@/lib/services/executive-twin-engine";
import { MorningBriefService } from "@/lib/services/morning-brief-service";
import { OperationsEngine } from "@/lib/services/intelligence/operations-engine";
import { BrandEngine } from "@/lib/services/intelligence/brand-engine";
import { ComplianceEngine } from "@/lib/services/intelligence/compliance-engine";
import { FinanceEngine } from "@/lib/services/intelligence/finance-engine";
import { ProcurementEngine } from "@/lib/services/intelligence/procurement-engine";
import { COMPANY_ID, DEMO_BRANCHES, USER_ADMIN, USER_SUPERVISOR } from "./seed-constants";

export async function main() {
  console.log("=== Phase 16: Suscripciones, playbooks, gemelo ejecutivo, brief y excepciones ===");
  await seedTiers();
  const [tier] = await db.select().from(subscriptionTiers).where(eq(subscriptionTiers.slug, "executive"));
  await db.insert(companySubscriptions).values({
    companyId: COMPANY_ID, tierId: tier.id, status: "ACTIVE",
  }).onConflictDoUpdate({ target: companySubscriptions.companyId, set: { tierId: tier.id, status: "ACTIVE" } });
  const templates = await db.select().from(workflowTemplates).where(eq(workflowTemplates.companyId, COMPANY_ID));
  const playbooks = templates.filter((row) => /apertura|temperatura/i.test(row.name ?? ""));
  if (!playbooks.length) throw new Error("Faltan plantillas de apertura/temperatura: ejecuta la fase 5.");
  for (const template of playbooks) {
    await PlaybookService.publish(template.id, COMPANY_ID, DEMO_BRANCHES.map((row) => row.id), {
      userId: USER_ADMIN, changeNote: "Procedimiento corporativo inicial demo",
    });
  }
  const id = "d1600001-0000-4000-8000-000000000001";
  await db.insert(nom035ActionPlans).values({
    id, companyId: COMPANY_ID, branchId: DEMO_BRANCHES[1].id,
    title: "Revisar distribución de cargas del turno", riskCategory: "JORNADA",
    status: "IN_PROGRESS", priority: "HIGH", assignedTo: USER_SUPERVISOR,
    dueDate: new Date(Date.now() + 3 * 86400000),
    remediationMeasures: ["Entrevistar al equipo", "Rebalancear cobertura del turno"],
  }).onConflictDoNothing();
  // Derivar desde las fuentes reales; no inventar excepciones sueltas. El
  // ledger queda procesado localmente, sin publicar eventos en Inngest.
  const outcomes = await withLocalDomainEvents(() => runExceptionAdapters({ companyId: COMPANY_ID }));
  const failed = outcomes.filter((row) => row.error);
  if (failed.length) throw new Error(`Adaptadores incompletos: ${JSON.stringify(failed)}`);
  console.log(`Excepciones proyectadas: ${outcomes.reduce((sum, row) => sum + row.raised, 0)}`);

  // Recalcular gemelos operativos por sucursal, gemelo ejecutivo corporativo,
  // los 5 motores de inteligencia y el Morning Brief del día.
  await withLocalDomainEvents(async () => {
    for (const branch of DEMO_BRANCHES) {
      await recalculateTwin(branch.id);
    }
    await ExecutiveTwinEngine.recalculate(COMPANY_ID);
    for (const engine of [
      OperationsEngine,
      BrandEngine,
      ComplianceEngine,
      FinanceEngine,
      ProcurementEngine,
    ]) {
      await engine.refresh(COMPANY_ID);
    }
    const briefRow = await MorningBriefService.generate(COMPANY_ID);
    const p1 = briefRow?.brief.priorities[0];
    const p2 = briefRow?.brief.priorities[1];
    const key1 = p1 ? `brief-${p1.rank}-${p1.title}` : "brief-1-prioridad-operativa-demo";
    const key2 = p2 ? `brief-${p2.rank}-${p2.title}` : "brief-2-revision-margen-demo";

    await db.insert(executiveDecisions).values([
      {
        companyId: COMPANY_ID,
        decisionKey: key1,
        resolution: "authorized",
        resolvedByName: "Carlos Mendoza (Director General)",
      },
      {
        companyId: COMPANY_ID,
        decisionKey: key2,
        resolution: "deferred",
        resolvedByName: "Ana García (Administración)",
      },
    ]).onConflictDoUpdate({
      target: [executiveDecisions.companyId, executiveDecisions.decisionKey],
      set: { resolvedAt: new Date() },
    });
  });
}
