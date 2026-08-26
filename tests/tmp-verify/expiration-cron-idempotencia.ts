/**
 * Verificación del checkpoint de Phase 1 (loteprod): dos corridas seguidas del
 * paso `process-expiration-cutoffs` del cron no deben duplicar alertas ni
 * re-notificar. Siembra dos lotes [VERIFY] en las ventanas H48 y H24 (que son
 * las que dependen del único (batch_id, window), porque el lote sigue
 * AVAILABLE y el cron lo vuelve a encontrar) y los borra al terminar.
 *
 *   npx tsx tests/tmp-verify/expiration-cron-idempotencia.ts
 */
import { config } from "dotenv";
config({ path: ".env" });

const HOUR = 60 * 60 * 1000;

async function main() {
  const { db } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");
  const { ExpirationAlertService } = await import(
    "@/lib/services/expiration-alert-service"
  );

  const rows = async (q: any) => {
    const r: any = await db.execute(q);
    return Array.isArray(r) ? r : r.rows;
  };

  // Un ítem/sucursal reales de dev sobre los que sembrar.
  const [seed] = await rows(sql`
    select b.item_id, b.branch_id from inventory_batches b limit 1
  `);
  if (!seed) throw new Error("dev sin lotes: corre pnpm seed:4 antes");

  const mk = async (hours: number, tag: string) => {
    const [r] = await rows(sql`
      insert into inventory_batches
        (item_id, branch_id, lot_number, expiration_date, initial_quantity, current_quantity, status)
      values (${seed.item_id}, ${seed.branch_id}, ${"[VERIFY] " + tag},
              now() + (${hours} || ' hours')::interval, '10.0000', '10.0000', 'AVAILABLE')
      returning id
    `);
    return r.id as string;
  };

  const h48 = await mk(40, "H48");
  const h24 = await mk(20, "H24");
  console.log("lotes sembrados:", { h48, h24 });

  const alertsFor = async () =>
    await rows(sql`
      select batch_id, "window", count(*)::int as n
      from inventory_expiration_alerts
      where batch_id in (${h48}::uuid, ${h24}::uuid)
      group by batch_id, "window"
    `);

  try {
    const run1 = await ExpirationAlertService.processExpirationCutoffs();
    const a1 = await alertsFor();
    console.log("corrida 1:", run1);
    console.log("alertas de los lotes sembrados:", a1);

    const run2 = await ExpirationAlertService.processExpirationCutoffs();
    const a2 = await alertsFor();
    console.log("corrida 2:", run2);
    console.log("alertas de los lotes sembrados:", a2);

    const windows = new Set(a2.map((r: any) => `${r.batch_id}:${r.window}`));
    const sinDuplicados = a2.every((r: any) => r.n === 1);
    const dosVentanas = windows.size === 2;
    const noRenotifica = run2.notificationsSent === 0 && run2.alreadyNotified >= 2;

    console.log("\n— resultado —");
    console.log("una fila por (lote, ventana):", sinDuplicados);
    console.log("se clasificaron H48 y H24:", dosVentanas);
    console.log("2a corrida no re-notifica y cuenta alreadyNotified:", noRenotifica);
    const ok = sinDuplicados && dosVentanas && noRenotifica;
    console.log(ok ? "OK" : "FALLA");
    process.exitCode = ok ? 0 : 1;
  } finally {
    await db.execute(
      sql`delete from inventory_expiration_alerts where batch_id in (${h48}::uuid, ${h24}::uuid)`
    );
    await db.execute(
      sql`delete from inventory_batches where id in (${h48}::uuid, ${h24}::uuid)`
    );
    console.log("limpieza: lotes y alertas [VERIFY] borrados");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
