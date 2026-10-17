import "dotenv/config";
import { db } from "@/lib/db";
import { companySubscriptions, subscriptionTiers, workflowTemplates, nom035ActionPlans } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { main as seedTiers } from "./seed-subscription-tiers";
import { PlaybookService } from "@/lib/services/playbook-service";
import { runExceptionAdapters } from "@/lib/services/exception-adapters";
import { withLocalDomainEvents } from "@/lib/services/domain-event-service";
import { COMPANY_ID, DEMO_BRANCHES, USER_ADMIN, USER_SUPERVISOR } from "./seed-constants";

export async function main() {
  console.log("=== Phase 16: Suscripciones, playbooks y excepciones canónicas ===");
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
}
