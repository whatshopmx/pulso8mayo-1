import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Role } from "@/lib/permissions";
import { previewCompanyOpening } from "@/lib/services/accounting/activation-service";
import { createOpening } from "@/lib/services/accounting/opening-service";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const companyId = arg("company-id");
  const actorId = arg("actor-id");
  const role = (arg("role") ?? "ADMIN") as Role;
  const file = arg("file");
  const publish = process.argv.includes("--publish");

  if (!companyId || !actorId || !file) {
    console.error(
      "Uso: npx tsx scripts/accounting-opening-preview.ts --company-id <uuid> --actor-id <id> --file <apertura.json> [--role ADMIN] [--publish]",
    );
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(resolve(file), "utf8"));
  const ctx = { companyId, actorId, role };
  const preview = await previewCompanyOpening(ctx, raw);

  console.log(JSON.stringify({ mode: publish ? "PUBLISH" : "PREVIEW", preview }, null, 2));

  if (!preview.ready) {
    console.error("Bloqueos detectados en la vista previa; no se publicó la apertura.");
    process.exit(2);
  }

  if (!publish) {
    console.log("Vista previa aprobada. Ejecuta con --publish después de revisión contable para confirmar.");
    return;
  }

  const created = await createOpening(ctx, raw);
  console.log(JSON.stringify({ published: true, openingId: created.opening.id, journalId: created.journal.id }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
