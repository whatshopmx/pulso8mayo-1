import { test, expect } from "@playwright/test";
import { execSync } from "child_process";
import path from "path";
import { BRANCH_POLANCO, COMPANY_ID, USER_SUPER_ADMIN } from "./support/constants";
import {
  cleanupMerma,
  createTestSkus,
  deleteTestSkus,
  deleteWasteForItems,
  findWasteForInstance,
  seedCompletedMermaInstance,
  seedMermaTemplate,
  setWasteEvidenceUrl,
} from "./support/db";
import { extractMermaFromInstance } from "../lib/services/merma-from-workflow";

/**
 * Task 4 (tasks/plan-mermas-historial.md) — evidencia fotográfica de merma.
 *
 * El template exige foto por SKU (`merma-evidence-{itemId}`), pero el extractor
 * descartaba la URL al construir las filas: la evidencia NOM-251 se perdía.
 *
 * Se fija:
 *  1. `extractMermaFromInstance` persiste `evidence_url` cuando el paso la trae.
 *  2. El backfill (`scripts/backfill-waste-evidence.ts`) recupera las filas
 *     pre-fix re-parseando los pasos — y corre DOS veces sin duplicar ni
 *     pisar valores no-null (idempotencia por diseño).
 *
 * El backfill se invoca como proceso real (`npx tsx … --apply`) a propósito:
 * lo que hay que probar es el script completo, no una copia de su lógica.
 */

const TAG = "e2e-merma-evidencia";

let templateId = "";
let instanceId = "";
let itemIds: string[] = [];

function runBackfill(): string {
  return execSync("npx tsx scripts/backfill-waste-evidence.ts --apply", {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    env: process.env as NodeJS.ProcessEnv,
  });
}

test.describe("Task 4 · evidencia fotográfica de merma", () => {
  test.afterEach(async () => {
    if (instanceId) await cleanupMerma(instanceId, templateId);
    await deleteWasteForItems(itemIds);
    await deleteTestSkus();
    instanceId = "";
    templateId = "";
    itemIds = [];
  });

  test("el extractor guarda la URL del paso merma-evidence-{itemId}", async () => {
    itemIds = await createTestSkus(COMPANY_ID, 1, {
      isHighValue: true,
      unit: "KG",
      tags: [TAG],
    });

    templateId = await seedMermaTemplate(COMPANY_ID, TAG);
    instanceId = await seedCompletedMermaInstance({
      templateId,
      branchId: BRANCH_POLANCO,
      assigneeId: USER_SUPER_ADMIN,
      items: [
        {
          itemId: itemIds[0],
          quantity: 1.5,
          reason: "caducidad",
          evidenceUrl: "https://example.test/evidencia-nom251.jpg",
        },
      ],
    });

    await extractMermaFromInstance(instanceId);

    const mermas = await findWasteForInstance(instanceId);
    expect(mermas).toHaveLength(1);
    expect(mermas[0].evidence_url).toBe("https://example.test/evidencia-nom251.jpg");
  });

  test("el backfill recupera filas pre-fix y corre dos veces sin pisar nada", async () => {
    itemIds = await createTestSkus(COMPANY_ID, 2, {
      isHighValue: true,
      unit: "KG",
      tags: [TAG],
    });
    const [itemConEvidencia, itemPreservado] = itemIds;

    templateId = await seedMermaTemplate(COMPANY_ID, TAG);
    instanceId = await seedCompletedMermaInstance({
      templateId,
      branchId: BRANCH_POLANCO,
      assigneeId: USER_SUPER_ADMIN,
      items: [
        // La foto que el extractor pre-fix descartaba (helper le pone una URL
        // default si no se declara).
        { itemId: itemConEvidencia, quantity: 1, reason: "caducidad" },
        // Fila que ya tiene evidencia: el backfill NO debe tocarla.
        { itemId: itemPreservado, quantity: 2, reason: "caida" },
      ],
    });

    // Filas "pre-fix": el extractor actual SÍ escribe la URL, así que se
    // simula la época anterior limpiándola; la segunda fila conserva OTRA url
    // distinta para verificar que no se sobreescribe.
    await extractMermaFromInstance(instanceId);

    let mermas = await findWasteForInstance(instanceId);
    expect(mermas).toHaveLength(2);
    const filaPreFix = mermas.find((m) => m.item_id === itemConEvidencia)!;
    const filaPreservada = mermas.find((m) => m.item_id === itemPreservado)!;
    const URL_RECUPERADA = `https://example.test/e2e-merma-${itemConEvidencia}.jpg`;
    const URL_PRESERVADA = "https://example.test/ya-existe.jpg";
    await setWasteEvidenceUrl(filaPreFix.id, null);
    await setWasteEvidenceUrl(filaPreservada.id, URL_PRESERVADA);

    // ── Corrida 1 ────────────────────────────────────────────────────────
    const out1 = runBackfill();
    expect(out1).toContain("Filas candidatas: 1");

    mermas = await findWasteForInstance(instanceId);
    expect(
      mermas.find((m) => m.id === filaPreFix.id)!.evidence_url,
      "la fila pre-fix recuperó su foto"
    ).toBe(URL_RECUPERADA);
    expect(
      mermas.find((m) => m.id === filaPreservada.id)!.evidence_url,
      "la fila con evidencia propia quedó intacta"
    ).toBe(URL_PRESERVADA);

    // ── Corrida 2 (idempotencia) ─────────────────────────────────────────
    const out2 = runBackfill();
    expect(out2).toContain("Nada que hacer");

    mermas = await findWasteForInstance(instanceId);
    expect(mermas.find((m) => m.id === filaPreFix.id)!.evidence_url).toBe(URL_RECUPERADA);
    expect(mermas.find((m) => m.id === filaPreservada.id)!.evidence_url).toBe(URL_PRESERVADA);
  });
});
