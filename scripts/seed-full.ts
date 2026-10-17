import "dotenv/config";
import { assertSeedReset, SEED_PHASES } from "./seed-plan";

export async function main() {
  assertSeedReset(process.argv.slice(2), process.env.NODE_ENV);
  console.log("PULSO HORECA — Seed demo (" + SEED_PHASES.length + " fases)");
  const start = Date.now();
  const { cleanupAll } = await import("./seed-cleanup");
  await cleanupAll();
  for (const phase of SEED_PHASES) {
    const { main: run } = await import("./" + phase);
    await run();
  }
  const { main: seedPasswords } = await import("./seed-passwords");
  await seedPasswords();
  console.log("Seed completo en " + ((Date.now() - start) / 1000).toFixed(1) + "s.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Seed incompleto:", error);
    process.exitCode = 1;
  });
}
