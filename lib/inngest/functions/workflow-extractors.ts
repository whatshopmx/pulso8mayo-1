// lib/inngest/functions/workflow-extractors.ts
//
// A2 / AD-A2 (`tasks/plan-auditoria-conteo-produccion-merma.md`): los cuatro
// extractores que corren al completar una instancia dejan de ser
// `void extract*(instanceId)` disparados después de responder al cliente.
//
// Por qué: el deploy es Netlify (`netlify.toml`; el `vercel.json` del repo está
// vacío), que sirve Next sobre Lambda. Al devolver la respuesta el contenedor
// se **congela**: una promesa pendiente no se cancela, queda suspendida y sólo
// termina si ese mismo contenedor recibe otra invocación. El defecto (O-1) no
// era "no corren nunca" sino que corrían de forma **no determinística**.
//
// `waitUntil` no era la salida (AD-A2): sólo alarga la vida del proceso, sigue
// sin cola, sin reintentos y sin trazas. Inngest cierra O-1 y de paso R-5 —los
// fallos que morían en un `console.error`— porque cada extractor es su propio
// `step.run`: reintentos independientes, y el que falla no impide los otros.

import { NonRetriableError } from "inngest";
import { inngest } from "@/lib/inngest/client";
import { createChildLogger } from "@/lib/logger";
import { extractReceivingFromInstance } from "@/lib/services/receiving-from-workflow";
import { extractStockCountFromInstance } from "@/lib/services/stock-count-from-workflow";
import { extractMermaFromInstance } from "@/lib/services/merma-from-workflow";
import { extractProductionFromInstance } from "@/lib/services/production-from-workflow";

const logger = createChildLogger("inngest:workflow-extractors");

/**
 * Orden fijo y estable: los `step.run` se memoizan por id, así que renombrar o
 * reordenar esta lista invalida la memoización de las corridas en vuelo.
 *
 * Cada extractor se auto-descarta si la instancia no le corresponde (recepción
 * exige su template; los otros tres, que existan sus pasos), así que se llaman
 * los cuatro siempre y no hay que resolver la plantilla aquí.
 */
const EXTRACTORS: ReadonlyArray<readonly [string, (instanceId: string) => Promise<void>]> = [
  ["receiving", extractReceivingFromInstance],
  ["stock-count", extractStockCountFromInstance],
  ["merma", extractMermaFromInstance],
  ["production", extractProductionFromInstance],
] as const;

export const workflowExtractorsFn = inngest.createFunction(
  {
    id: "workflow-extractors",
    triggers: [{ event: "workflow/instance.completed" }],
    // Por paso, no por función: un extractor con la BD caída reintenta solo.
    retries: 3,
  },
  async ({ event, step }) => {
    const { instanceId } = (event.data ?? {}) as { instanceId?: string };
    if (!instanceId) {
      // Reintentar no va a inventar el id que el emisor no mandó.
      throw new NonRetriableError("workflow/instance.completed sin instanceId");
    }

    // Aislamiento (criterio de aceptación de A2): el `catch` deja seguir a los
    // demás extractores aunque uno agote sus reintentos.
    const failed: string[] = [];
    for (const [name, extract] of EXTRACTORS) {
      try {
        await step.run(`extract-${name}`, () => extract(instanceId));
      } catch (error) {
        failed.push(name);
        logger.error({ instanceId, extractor: name, err: String(error) }, "Extractor agotó sus reintentos");
      }
    }

    if (failed.length > 0) {
      // Que la corrida quede FALLIDA y no verde con un error escondido (R-5).
      // No retriable: cada paso ya gastó sus reintentos, repetir la función
      // sólo volvería a correr los que sí funcionaron.
      throw new NonRetriableError(
        `Extractores fallidos para la instancia ${instanceId}: ${failed.join(", ")}`
      );
    }

    return { instanceId, extractors: EXTRACTORS.length };
  }
);
