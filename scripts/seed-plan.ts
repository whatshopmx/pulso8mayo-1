// Sin imports de DB: consultar el plan y validar argumentos nunca conecta a Neon.
export const SEED_PHASES = [
  "seed-01-foundation", "seed-02-hr-profiles", "seed-03-equipment",
  "seed-04-inventory", "seed-05-workflows", "seed-06-labor",
  "seed-07-compliance-kpi", "seed-08-hr-advanced", "seed-09-whatsapp",
  "seed-10-final", "seed-11-control-orders", "seed-12-sales-pos",
  "seed-13-receiving-matching", "seed-14-current-operations",
  "seed-15-financial-close", "seed-16-executive-control",
  // Referencia legal global (no tenant-scoped): idempotente, clean-up la trunca
  // y hay que re-sembrarla en cada run del seed maestro. Ver
  // lib/services/labor-rules-resolver.ts: sin esta tabla cae al mapa estático.
  "seed-labor-law-rules",
  // Banca/finance post-seed-15: cuentas propias, estado de cuenta, gateway
  // TPV, payables recurrentes (derivados del servicio) y CFDI de nómina.
  "seed-18-finance",
  // Evidencia canónica (EVI-01, espejo de pasos reales) + protección civil.
  "seed-19-evidence-civil",
] as const;

export function assertSeedReset(args: string[], environment?: string): void {
  if (environment === "production") {
    throw new Error("El seed demo no puede ejecutarse con NODE_ENV=production.");
  }
  if (!args.includes("--reset")) {
    throw new Error("El seed borra los datos de la base demo. Usa pnpm seed --reset en una base dedicada.");
  }
}
