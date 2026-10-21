import "dotenv/config";
import { assertSeedReset, SEED_PHASES } from "./seed-plan";

async function main() {
  assertSeedReset(process.argv.slice(2), process.env.NODE_ENV);
  const phaseNumber = Number(process.argv[2]);
  const phase = process.argv[2] === "passwords" ? "seed-passwords" : SEED_PHASES[phaseNumber - 1];
  if (!phase) throw new Error(`Fase inválida (1–${SEED_PHASES.length} o passwords).`);
  const { assertDemoDatabase } = await import("./seed-cleanup");
  await assertDemoDatabase();
  const { main: run } = await import(`./${phase}`);
  await run();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
