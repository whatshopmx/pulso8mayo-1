import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import * as schema from "../../lib/db/schema";
import { SEED_PHASES } from "../../scripts/seed-plan";
import { verifyPassword } from "better-auth/crypto";
import { inngest } from "@/lib/inngest/client";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFile } from "node:fs/promises";
import { COMPANY_ID } from "../../scripts/seed-constants";
import { timbrarNomina } from "@/lib/services/fiscal-service";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ get db() { return state.db; } }));
vi.mock("@/lib/inngest/client", () => ({ inngest: { send: vi.fn(async () => ({ ids: [] })) } }));
vi.mock("@/lib/services/fiscal-service", async (original) => ({
  ...await original<typeof import("@/lib/services/fiscal-service")>(),
  timbrarNomina: vi.fn(async () => { throw new Error("El seed no puede enviar al PAC"); }),
}));

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
  // Las políticas SQL no se generan a partir del esquema TypeScript.
  await pg.exec("CREATE ROLE pulso_app NOLOGIN NOSUPERUSER NOBYPASSRLS");
  for (const migration of ["0103_tenant_rls_evidence", "0104_rls_receiving", "0105_rls_inventory_monitoring", "0106_rls_stock_counts", "0123_rls_nomina"]) {
    await pg.exec(await readFile(new URL(`../../drizzle/${migration}.sql`, import.meta.url), "utf8"));
  }
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
        const invalidAttendance = await pg.query(`SELECT s.id FROM shift_sessions s
          JOIN planned_shifts p ON p.id = s.planned_shift_id
          WHERE s.status = 'COMPLETED' AND (
            s.late_minutes <> greatest(0, extract(epoch FROM
              (s.check_in_time - (p.shift_date::date + p.start_time::time + interval '6 hours'))) / 60)::int
            OR s.total_break_minutes <> (SELECT coalesce(sum(b.duration_minutes), 0)
              FROM break_logs b WHERE b.session_id = s.id))`);
        expect(invalidAttendance.rows).toEqual([]);
        const invalidApprovals = await pg.query(`SELECT a.id FROM shift_approvals a
          JOIN shift_sessions s ON s.id = a.shift_session_id
          WHERE a.planned_shift_id <> s.planned_shift_id OR a.branch_id <> s.branch_id`);
        expect(invalidApprovals.rows).toEqual([]);
        const falseStamps = await pg.query(`SELECT id FROM cfdi_nomina_timbrados
          WHERE status = 'TIMBRADO' OR uuid IS NOT NULL`);
        expect(falseStamps.rows).toEqual([]);
        const ordinarySlips = await pg.query<{ user_id: string; period_start: string; period_end: string;
          base_salary_cents: number; total_percepciones_cents: number }>(`SELECT p.*, r.period_start::text, r.period_end::text
          FROM payroll_payslips p JOIN payroll_runs r ON r.id = p.run_id
          WHERE r.aguinaldo_fiscal_year IS NULL`);
        const { calculateEmployeePayroll } = await import("../../lib/services/payroll-service");
        for (const slip of ordinarySlips.rows) {
          const expected = await calculateEmployeePayroll(slip.user_id, slip.period_start, slip.period_end);
          expect(slip.base_salary_cents).toBe(expected.baseSalaryCents);
          expect(slip.total_percepciones_cents).toBe(expected.totalPercepcionesCents);
        }
        const { seedDate } = await import("../../scripts/seed-scenarios");
        const today = seedDate().toISOString().slice(0, 10);
        const staleRequests = await pg.query(`SELECT id FROM vacation_requests
          WHERE status IN ('PENDING', 'APPROVED') AND start_date::date < $1::date`, [today]);
        expect(staleRequests.rows).toEqual([]);
        const { previsualizarAguinaldo } = await import("../../lib/services/aguinaldo-payroll-service");
        const preview = await previsualizarAguinaldo(COMPANY_ID, Number(today.slice(0, 4)), undefined, { fechaPago: today });
        const aguinaldo = await pg.query<{ status: string; aguinaldo_snapshot: { deliveryVersion?: number } }>(
          "SELECT * FROM payroll_runs WHERE aguinaldo_fiscal_year IS NOT NULL");
        expect(aguinaldo.rows).toHaveLength(1);
        expect(aguinaldo.rows[0].status).toBe("DRAFT");
        expect(aguinaldo.rows[0].aguinaldo_snapshot.deliveryVersion).toBeUndefined();
        const authorized = await pg.query<{ user_id: string; aguinaldo_cents: number; aguinaldo_snapshot: { diasLaborados: number; fuenteDias: string } }>(
          "SELECT * FROM payroll_payslips WHERE aguinaldo_snapshot IS NOT NULL");
        expect(authorized.rows).toHaveLength(preview.rows.filter((row) => !row.error && row.rfc && row.calculo && row.pago).length);
        for (const row of authorized.rows) {
          const expected = preview.rows.find((p) => p.userId === row.user_id)!;
          expect(row.aguinaldo_cents).toBe(expected.calculo!.brutoCents);
          expect(row.aguinaldo_snapshot.diasLaborados).toBe(expected.diasLaborados);
          expect(row.aguinaldo_snapshot.fuenteDias).toBe("PROPUESTA_AUDITABLE");
        }
        const { kpiCalculator } = await import("../../lib/services/kpi-calculator");
        const measurements = await pg.query<{ formula: string; branch_id: string; value: number; metadata: { source: string } }>(
          "SELECT h.*, d.formula FROM kpi_history h JOIN kpi_definitions d ON d.id = h.kpi_id");
        expect(measurements.rows.length).toBeGreaterThan(0);
        for (const measurement of measurements.rows) {
          expect(measurement.value).toBe(Math.round(await kpiCalculator.calculate(measurement.formula, COMPANY_ID, measurement.branch_id) * 100));
          expect(measurement.metadata.source).toBe("DEMO_CURRENT_SOURCES");
        }
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
      expect(timbrarNomina).not.toHaveBeenCalled();
      const { cleanupAll } = await import("../../scripts/seed-cleanup");
      // Runtime real (sin bypass): rechazo por defecto, lectura con contexto y
      // rechazo del reset ANTES de TRUNCATE; después volvemos al rol dueño.
      await pg.exec("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pulso_app");
      await pg.exec("SET ROLE pulso_app");
      try {
        expect((await pg.query("SELECT id FROM payroll_runs")).rows).toHaveLength(0);
        await expect(cleanupAll()).rejects.toThrow("rol de mantenimiento");
        const { withCompanyContext } = await import("../../lib/db/tenant-context");
        const scoped = await withCompanyContext({ companyId: COMPANY_ID }, (tx) => tx.select().from(schema.payrollRuns));
        expect(scoped.length).toBe(2);
        const other = await withCompanyContext({ companyId: "99999999-0000-4000-8000-000000000001" }, (tx) => tx.select().from(schema.payrollRuns));
        expect(other).toEqual([]);
        expect((await pg.query("SELECT id FROM payroll_runs")).rows).toHaveLength(0);
      } finally { await pg.exec("RESET ROLE"); }
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
