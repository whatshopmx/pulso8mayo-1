import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { branches } from "@/lib/db/schema";
import { inngest } from "@/lib/inngest/client";

/**
 * Phase 0 / Task 12 — disparo on-demand del sync de excepciones.
 *
 * Los dominios (3-way match, incidentes) no escriben en `exceptions`: emiten
 * `exceptions/sync.requested` y el Inngest durable proyecta. Si Inngest está
 * caído, se degrada al cron de 10 min (no se pierde la excepción).
 *
 * Nunca lanza: un fallo al encolar no debe romper la operación de dominio.
 */
export async function requestExceptionSync(input: {
  companyId?: string | null;
  branchId?: string | null;
}): Promise<void> {
  try {
    let companyId = input.companyId ?? null;
    if (!companyId && input.branchId) {
      const [branch] = await db
        .select({ companyId: branches.companyId })
        .from(branches)
        .where(eq(branches.id, input.branchId))
        .limit(1);
      companyId = branch?.companyId ?? null;
    }
    if (!companyId) return;

    await inngest.send({
      name: "exceptions/sync.requested",
      data: {
        companyId,
        branchId: input.branchId ?? undefined,
      },
    });
  } catch (error) {
    console.warn(
      "[exception-sync] no se pudo encolar el sync; el cron de 10 min lo recogerá",
      error,
    );
  }
}
