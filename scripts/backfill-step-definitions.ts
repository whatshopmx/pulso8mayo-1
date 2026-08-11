/**
 * Backfill de la definición de paso congelada (migración 0050).
 *
 * `workflow_instance_steps` sólo guardaba la *respuesta* del operador; la
 * *pregunta* vivía en `workflow_templates.steps`. La migración 0050 añade
 * `step_order`, `title`, `type` y `definition` a la instancia para que una
 * revisión sea un acta autocontenida. Este script rellena esas columnas en las
 * ejecuciones que ya existían.
 *
 * Propiedades que el script garantiza:
 *  - **Idempotente**: sólo escribe donde las cuatro columnas están NULL.
 *  - **No destructivo**: jamás toca `value`, `comment`, `evidence_url` ni
 *    `ai_analysis`.
 *  - **Honesto**: los pasos dinámicos históricos (conteo de inventario,
 *    `metadata.dynamicSource`) se resolvían en memoria y nunca se persistieron,
 *    así que su definición es irrecuperable. Se dejan NULL y se reportan; la
 *    revisión los degrada explícitamente en vez de inventarles un título.
 *
 * Uso:
 *   npx tsx scripts/backfill-step-definitions.ts            # simulación
 *   npx tsx scripts/backfill-step-definitions.ts --apply    # escribe
 */
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env" });

interface TemplateStep {
  id?: string;
  title?: string;
  type?: string;
  [key: string]: unknown;
}

const APPLY = process.argv.includes("--apply");

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Sólo instancias con al menos un paso sin congelar: relanzar el script no
  // vuelve a mirar lo ya hecho.
  const { rows: instances } = await client.query<{
    instance_id: string;
    workflow_template_id: string;
    steps: TemplateStep[] | null;
  }>(`
    SELECT DISTINCT i.id AS instance_id, i.workflow_template_id, t.steps
    FROM workflow_instances i
    JOIN workflow_instance_steps s ON s.instance_id = i.id
    LEFT JOIN workflow_templates t ON t.id = i.workflow_template_id
    WHERE s.step_order IS NULL AND s.title IS NULL
      AND s.type IS NULL AND s.definition IS NULL
  `);

  let filled = 0;
  let unrecoverable = 0;
  let instancesTouched = 0;
  let instancesWithoutTemplate = 0;

  for (const instance of instances) {
    const definitions = Array.isArray(instance.steps) ? instance.steps : [];
    if (definitions.length === 0) {
      instancesWithoutTemplate++;
    }

    // Índice por `id` de plantilla. El primero gana: un template con ids
    // repetidos es dato sucio, y duplicar la definición es preferible a fallar.
    const byId = new Map<string, { definition: TemplateStep; order: number }>();
    definitions.forEach((definition, order) => {
      const id = definition?.id;
      if (typeof id === "string" && !byId.has(id)) byId.set(id, { definition, order });
    });

    const { rows: steps } = await client.query<{ id: string; step_id: string }>(
      `SELECT id, step_id FROM workflow_instance_steps
       WHERE instance_id = $1
         AND step_order IS NULL AND title IS NULL
         AND type IS NULL AND definition IS NULL`,
      [instance.instance_id]
    );

    let touchedHere = false;

    for (const step of steps) {
      const match = byId.get(step.step_id);
      if (!match) {
        // Paso dinámico o plantilla editada: irrecuperable por diseño.
        unrecoverable++;
        continue;
      }

      if (APPLY) {
        await client.query(
          `UPDATE workflow_instance_steps
           SET step_order = $2, title = $3, type = $4, definition = $5::jsonb
           WHERE id = $1
             AND step_order IS NULL AND title IS NULL
             AND type IS NULL AND definition IS NULL`,
          [
            step.id,
            match.order,
            typeof match.definition.title === "string" ? match.definition.title : null,
            typeof match.definition.type === "string" ? match.definition.type : null,
            JSON.stringify(match.definition),
          ]
        );
      }

      filled++;
      touchedHere = true;
    }

    if (touchedHere) instancesTouched++;
  }

  console.log("");
  console.log(APPLY ? "== Backfill aplicado ==" : "== Simulación (sin escribir) ==");
  console.log(`Instancias con pasos sin congelar : ${instances.length}`);
  console.log(`Instancias modificadas            : ${instancesTouched}`);
  console.log(`Pasos rellenados                  : ${filled}`);
  console.log(`Pasos irrecuperables (quedan NULL): ${unrecoverable}`);
  console.log(`Instancias sin plantilla legible  : ${instancesWithoutTemplate}`);
  if (!APPLY) {
    console.log("");
    console.log("Nada se escribió. Repite con --apply para aplicar.");
  }

  await client.end();
}

main().catch((error) => {
  console.error("Backfill falló:", error);
  process.exit(1);
});
