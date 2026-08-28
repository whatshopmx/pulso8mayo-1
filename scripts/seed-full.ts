async function main() {
  console.log("========================================");
  console.log("  PULSO HORECA - Full Seed (10 Phases)");
  console.log("========================================\n");

  const start = Date.now();

  // Comprehensive FK-safe cleanup before any phase
  const { cleanupAll } = await import("./seed-cleanup");
  await cleanupAll();
  console.log();

  const { main: phase1 } = await import("./seed-01-foundation");
  await phase1();
  console.log();

  const { main: phase2 } = await import("./seed-02-hr-profiles");
  await phase2();
  console.log();

  const { main: phase3 } = await import("./seed-03-equipment");
  await phase3();
  console.log();

  const { main: phase4 } = await import("./seed-04-inventory");
  await phase4();
  console.log();

  const { main: phase5 } = await import("./seed-05-workflows");
  await phase5();
  console.log();

  const { main: phase6 } = await import("./seed-06-labor");
  await phase6();
  console.log();

  const { main: phase7 } = await import("./seed-07-compliance-kpi");
  await phase7();
  console.log();

  const { main: phase8 } = await import("./seed-08-hr-advanced");
  await phase8();
  console.log();

  const { main: phase9 } = await import("./seed-09-whatsapp");
  await phase9();
  console.log();

  const { main: phase10 } = await import("./seed-10-final");
  await phase10();
  console.log();

  const { main: phase11 } = await import("./seed-11-control-orders");
  await phase11();
  console.log();

  const { main: phase12 } = await import("./seed-12-sales-pos");
  await phase12();
  console.log();

  const { main: phase13 } = await import("./seed-13-receiving-matching");
  await phase13();
  console.log();

  const { main: seedPasswords } = await import("./seed-passwords");
  await seedPasswords();
  console.log();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`========================================`);
  console.log(`  All 13 phases completed in ${elapsed}s`);
  console.log(`========================================`);
}

main().catch((err) => {
  console.error("Seed orchestrator failed:", err);
  process.exit(1);
});
