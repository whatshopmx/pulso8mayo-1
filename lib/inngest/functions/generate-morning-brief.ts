/**
 * Inngest — Morning Brief diario del grupo.
 *
 * Fuente: docs/pulso-executive-os-v2.md §8.5. Patrón de referencia:
 * `weekly-insights.ts` (cron + agregación + entrega).
 *
 * Triggers:
 *   - cron diario a las 07:00 **hora de Ciudad de México**. El prefijo `TZ=` es
 *     obligatorio: un `0 7 * * *` pelado se interpreta en UTC y el brief
 *     llegaría a la 1:00 AM local (riesgo §13.6 del documento fuente).
 *   - evento `executive/brief.generate` para regenerar una compañía a mano.
 *
 * Cada compañía corre en sus propios `step.run` memoizados: el fallo de un
 * tenant no bloquea al resto y un retry no repite el trabajo ya hecho.
 *
 * Gate por tier: solo se genera para compañías con la feature `morning_brief`.
 */
import { inngest } from "@/lib/inngest/client";
import { db } from "@/lib/db";
import { companies, users } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { MorningBriefService } from "@/lib/services/morning-brief-service";
import { ExecutiveTwinEngine } from "@/lib/services/executive-twin-engine";
import { TierService } from "@/lib/services/tier-service";
import { NotificationDispatcher } from "@/lib/services/notification-dispatcher";

/** Roles que reciben el brief: es la rutina del dueño, no del turno. */
const BRIEF_RECIPIENT_ROLES = ["OWNER", "ADMIN"] as const;

export const generateMorningBrief = inngest.createFunction(
  {
    id: "generate-morning-brief",
    triggers: [
      { cron: "TZ=America/Mexico_City 0 7 * * *" },
      { event: "executive/brief.generate" },
    ],
    retries: 2,
  },
  async ({ event, step }) => {
    const eventCompanyId = (event?.data as { companyId?: string } | undefined)
      ?.companyId;

    const companyIds: string[] = eventCompanyId
      ? [eventCompanyId]
      : (await db.select({ id: companies.id }).from(companies)).map((c) => c.id);

    const results: {
      companyId: string;
      ok: boolean;
      briefId?: string;
      skipped?: string;
      error?: string;
    }[] = [];

    for (const companyId of companyIds) {
      // El tipo del step viene "jsonificado" por Inngest (todo opcional), así
      // que se reafirma la forma al leerlo.
      const outcome = (await step.run(
        `brief-${companyId}`,
        async (): Promise<{ ok: boolean; briefId?: string; skipped?: string; error?: string }> => {
          try {
            if (!(await TierService.hasFeature(companyId, "morning_brief"))) {
              return { ok: true, skipped: "feature_not_in_tier" };
            }

            // Twin fresco antes de resumirlo: el cron de recálculo corre cada
            // 15 min, pero el brief no debe depender de dónde cayó ese ciclo.
            await ExecutiveTwinEngine.recalculate(companyId);

            const row = await MorningBriefService.generate(companyId);
            if (!row) return { ok: true, skipped: "no_twin" };

            return { ok: true, briefId: row.id };
          } catch (err) {
            // Se registra explícitamente: el `ok:false` viaja dentro del output
            // del step y no aparece como error del run.
            console.error(
              `[generate-morning-brief] failed for company ${companyId}:`,
              err,
            );
            return {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        },
      )) as { ok: boolean; briefId?: string; skipped?: string; error?: string };

      results.push({ companyId, ...outcome });

      if (!outcome.ok || !outcome.briefId) continue;

      await step.run(`deliver-${companyId}`, async () => {
        const row = await MorningBriefService.getLatest(companyId);
        if (!row) return { delivered: 0 };

        const recipients = await db
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.companyId, companyId),
              inArray(users.role, [...BRIEF_RECIPIENT_ROLES]),
            ),
          );

        const prioritiesText = row.brief.priorities
          .map((p) => `${p.rank}. ${p.title} — ${p.recommendedAction}`)
          .join("\n");

        for (const recipient of recipients) {
          await NotificationDispatcher.sendNotification({
            userId: recipient.id,
            title: "☀️ Morning Brief del grupo",
            message: `${row.brief.headline}\n\n${prioritiesText}`,
            type: "info",
            eventType: "morning_brief",
            actionUrl: "/dashboard/executive",
            metadata: {
              briefId: row.id,
              briefDate: row.briefDate,
              headline: row.brief.headline,
              prioritiesText,
              companyId,
            },
          });
        }

        await MorningBriefService.markDelivered(row.id);

        try {
          await inngest.send({
            name: "executive/brief.generated",
            data: { companyId, briefId: row.id, briefDate: row.briefDate },
          });
        } catch (err) {
          // Inngest offline en dev — no fatal, el brief ya está persistido.
          console.warn(
            "[generate-morning-brief] executive/brief.generated dispatch failed:",
            err instanceof Error ? err.message : err,
          );
        }

        return { delivered: recipients.length };
      });
    }

    const okCount = results.filter((r) => r.ok).length;
    return { success: true, total: results.length, ok: okCount, results };
  },
);
