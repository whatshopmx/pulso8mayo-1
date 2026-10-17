// Sin imports de DB: consultar el plan y validar argumentos nunca conecta a Neon.
export const SEED_PHASES = [
  "seed-01-foundation", "seed-02-hr-profiles", "seed-03-equipment",
  "seed-04-inventory", "seed-05-workflows", "seed-06-labor",
  "seed-07-compliance-kpi", "seed-08-hr-advanced", "seed-09-whatsapp",
  "seed-10-final", "seed-11-control-orders", "seed-12-sales-pos",
  "seed-13-receiving-matching", "seed-14-current-operations",
  "seed-15-financial-close", "seed-16-executive-control",
] as const;

export function assertSeedReset(args: string[], environment?: string): void {
  if (environment === "production") {
    throw new Error("El seed demo no puede ejecutarse con NODE_ENV=production.");
  }
  if (!args.includes("--reset")) {
    throw new Error("El seed borra los datos de la base demo. Usa pnpm seed --reset en una base dedicada.");
  }
}
