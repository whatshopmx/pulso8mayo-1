import { asc, gt } from "drizzle-orm";
import { z } from "zod";
import { inngest } from "@/lib/inngest/client";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { isAccountingPostingEnabled } from "@/lib/services/accounting/expense-adapter";
import { dueAccountingEvents, processAccountingEvent, recoverMissingAccountingEvents } from "@/lib/services/accounting/event-service";

// One catalog page per durable run; the continuation prevents any tenant from
// being starved and keeps each run well below Inngest's step/state limits.
export const accountingRecoverySweep = inngest.createFunction({
  id: "accounting-recovery-sweep", retries: 4, concurrency: 1,
  triggers: [{ cron: "* * * * *" }, { event: "accounting/recovery.page" }],
}, async ({ event, step }) => {
  if (!isAccountingPostingEnabled()) return { enabled: false };
  const cursor = z.object({ after: z.uuid().optional() }).parse(event.data ?? {}).after;
  const rows = await step.run("company-page", () => db.select({ id: companies.id }).from(companies)
    .where(cursor ? gt(companies.id, cursor) : undefined).orderBy(asc(companies.id)).limit(100));
  if (rows.length) await step.sendEvent("dispatch-companies", rows.map(company => ({
    name: "accounting/recover.company", data: { companyId: company.id },
  })));
  if (rows.length === 100) await step.sendEvent("next-company-page", {
    name: "accounting/recovery.page", data: { after: rows[rows.length - 1].id },
  });
  return { dispatched: rows.length };
});

export const accountingPost = inngest.createFunction({
  id: "accounting-post", retries: 4,
  concurrency: { limit: 1, key: "event.data.companyId" },
  triggers: [{ event: "accounting/recover.company" }],
}, async ({ event, step }) => {
  if (!isAccountingPostingEnabled()) return { enabled: false };
  const { companyId } = z.object({ companyId: z.uuid() }).parse(event.data);
  await step.run("repair-missing-facts", () => recoverMissingAccountingEvents(companyId));
  const facts = await step.run("pending-facts", () => dueAccountingEvents(companyId));
  for (const fact of facts) {
    await step.run(`post-${fact.id}`, () => processAccountingEvent(companyId, fact.id));
  }
  return { attempted: facts.length };
});
