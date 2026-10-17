import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import * as schema from "../../lib/db/schema";
import { SEED_PHASES } from "../../scripts/seed-plan";
import { verifyPassword } from "better-auth/crypto";
import { inngest } from "@/lib/inngest/client";
import { AsyncLocalStorage } from "node:async_hooks";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ get db() { return state.db; } }));
vi.mock("@/lib/inngest/client", () => ({ inngest: { send: vi.fn(async () => ({ ids: [] })) } }));

let pg: PGlite;
beforeAll(async () => {
  pg = new PGlite();
  const real = drizzle(pg, { schema });
  // PGlite sólo tiene una conexión. Los servicios de producción consultan
  // catálogos por el db global dentro de una transacción; Neon usa otra
  // conexión del pool. Aquí esas lecturas deben compartir el ejecutor activo
  // para no esperar a la misma transacción que las está esperando a ellas.
  const active = new AsyncLocalStorage<object>();
  state.db = new Proxy(real, {
    get(target, property) {
      if (property === "transaction") {
        return (run: (tx: object) => Promise<unknown>) => real.transaction((tx) => active.run(tx, () => run(tx)));
      }
      return Reflect.get(active.getStore() ?? target, property);
    },
  });
  const ddl = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema));
  for (const statement of ddl) await pg.exec(statement);
}, 60_000);
afterAll(async () => { await pg?.close(); });

describe("seed sobre el esquema actual en Postgres aislado", () => {
  it("completa todas las fases y permite reiniciar sin duplicados", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      for (let run = 0; run < 2; run++) {
        const { cleanupAll } = await import("../../scripts/seed-cleanup");
        await cleanupAll();
        for (const phase of SEED_PHASES) {
          try {
            const { main } = await import(`../../scripts/${phase}.ts`);
            await main();
            process.stdout.write(`seed run ${run + 1}: ${phase} OK\n`);
          } catch (cause) {
            let root = cause as Error & { cause?: Error };
            while (root.cause) root = root.cause;
            throw new Error(`Falló ${phase}: ${root.message}`);
          }
        }
        const { main: passwords } = await import("../../scripts/seed-passwords");
        await passwords();
        const users = await pg.query<{ count: number }>("SELECT count(*)::int AS count FROM users");
        expect(users.rows[0].count).toBe(8);
        const accounts = await pg.query<{ count: number }>("SELECT count(*)::int AS count FROM account");
        expect(accounts.rows[0].count).toBe(8);
        const invalidWorkflows = await pg.query(`SELECT i.id FROM workflow_instances i
          WHERE (i.status = 'COMPLETED' AND EXISTS (
            SELECT 1 FROM workflow_instance_steps s WHERE s.instance_id = i.id AND s.status <> 'COMPLETED'))
          OR i.assignment_id IS NULL`);
        expect(invalidWorkflows.rows).toEqual([]);
        const invalidGoals = await pg.query(`SELECT g.id FROM performance_goals g
          JOIN users u ON u.id = g.user_id WHERE g.branch_id <> u.branch_id`);
        expect(invalidGoals.rows).toEqual([]);
        const invalidCuts = await pg.query(`SELECT id FROM daily_sales_cuts
          WHERE total_sales <> cash_sales + card_sales + other_payments OR tax_amount IS NULL`);
        expect(invalidCuts.rows).toEqual([]);
        const invalidPOs = await pg.query(`SELECT p.id FROM purchase_orders p
          WHERE p.total_amount <> (SELECT coalesce(sum(line_total + tax_amount + ieps_amount), 0)
            FROM purchase_order_items l WHERE l.po_id = p.id)`);
        expect(invalidPOs.rows).toEqual([]);
        const { InvoiceMatchingService } = await import("../../lib/services/invoice-matching-service");
        const linked = await pg.query<{ id: string; purchase_order_id: string; receiving_report_id: string; match_status: string }>(
          "SELECT * FROM invoices WHERE receiving_report_id IS NOT NULL",
        );
        expect(linked.rows).toHaveLength(2);
        for (const invoice of linked.rows) {
          const lines = await pg.query<{ item_id: string; cantidad: string; valor_unitario: number }>(
            "SELECT * FROM invoice_lines WHERE invoice_id = $1", [invoice.id],
          );
          const match = await InvoiceMatchingService.perform3WayMatch(invoice.purchase_order_id, invoice.receiving_report_id,
            lines.rows.map((line) => ({ itemId: line.item_id, quantity: Number(line.cantidad), unitCostCents: line.valor_unitario })));
          expect(match.isPerfectMatch).toBe(invoice.match_status === "MATCHED");
        }
        const counts = await pg.query<{ counts: number; snapshots: number; production: number; pnl: number; exceptions: number }>(`SELECT
          (SELECT count(*)::int FROM stock_counts) AS counts,
          (SELECT count(*)::int FROM inventory_snapshots) AS snapshots,
          (SELECT count(*)::int FROM production_results) AS production,
          (SELECT count(*)::int FROM pnl_snapshots) AS pnl,
          (SELECT count(*)::int FROM exceptions) AS exceptions`);
        expect(counts.rows[0].counts).toBeGreaterThan(0);
        expect(counts.rows[0].snapshots).toBe(counts.rows[0].counts);
        expect(counts.rows[0].production).toBe(3);
        expect(counts.rows[0].pnl).toBe(3);
        expect(counts.rows[0].exceptions).toBeGreaterThan(0);
        const { main: sync } = await import("../../scripts/seed-16-executive-control");
        await sync();
        const repeated = await pg.query<{ count: number }>("SELECT count(*)::int AS count FROM exceptions");
        expect(repeated.rows[0].count).toBe(counts.rows[0].exceptions);
        const credential = await pg.query<{ password: string; account_id: string; user_id: string }>("SELECT * FROM account LIMIT 1");
        expect(credential.rows[0].account_id).toBe(credential.rows[0].user_id);
        expect(await verifyPassword({ hash: credential.rows[0].password, password: "123456" })).toBe(true);
      }
      expect(inngest.send).not.toHaveBeenCalled();
      const { cleanupAll } = await import("../../scripts/seed-cleanup");
      await pg.exec("ALTER TABLE recipes RENAME COLUMN hold_time_minutes TO missing_demo_column");
      await expect(cleanupAll()).rejects.toThrow("migraciones");
      await pg.exec("ALTER TABLE recipes RENAME COLUMN missing_demo_column TO hold_time_minutes");
      await pg.exec("INSERT INTO companies (id, name) VALUES ('99999999-0000-4000-8000-000000000001', 'Empresa ajena')");
      await expect(cleanupAll()).rejects.toThrow("ajenos al demo");
      const preserved = await pg.query<{ count: number }>("SELECT count(*)::int AS count FROM users");
      expect(preserved.rows[0].count).toBe(8);
    } finally { log.mockRestore(); }
  }, 120_000);
});
