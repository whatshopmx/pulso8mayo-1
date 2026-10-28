import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync } from "node:fs";

const state = vi.hoisted(() => ({ db: null as unknown, base: "REGISTERED", timbrar: vi.fn(), fiscalReal: false }));
vi.mock("@/lib/db", () => ({ get db() { return state.db; } }));
vi.mock("@/lib/services/labor-rules-resolver", () => ({
  resolveFiscalLaborLawRules: async () => ({ aguinaldoDaysMxn: 15, umaDailyMxn: 117.31, source: "law-table" }),
}));
vi.mock("@/lib/services/tenant-config-service", () => ({
  getTenantOperatingConfig: async () => ({ aguinaldoBase: state.base, payrollPracticeMode: "MIXED" }),
}));
vi.mock("@/lib/services/aguinaldo-days-adapter", () => ({
  cargarFuentesDiasAguinaldo: async () => ({
    anioFiscal: 2026, fechaCorte: "2026-12-31", porUsuario: {},
    advertencias: [], coberturaFuentes: "PARCIAL",
  }),
}));
vi.mock("@/lib/fiscal/sat-test-data", () => ({ loadCsdForTin: () => ({}), resolveTestPerson: () => null,
  SAT_TEST_MORALES: [{ tin: "EKU9003173C9", legalName: "Emisor de prueba", zipCode: "64000", taxRegimeCode: "601" }],
  SAT_TEST_FISICAS: [{ tin: "AAA010101AAA", legalName: "Prueba", zipCode: "64000" }] }));
vi.mock("@/lib/services/fiscal-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/fiscal-service")>();
  return { ...actual, timbrarNomina: (...args: Parameters<typeof actual.timbrarNomina>) => state.fiscalReal ? actual.timbrarNomina(...args) : state.timbrar(...args) };
});
import { executeAguinaldoRun, recuperarAguinaldoRun, AguinaldoRunDuplicadoError } from "@/lib/services/aguinaldo-payroll-service";

const companyA = "00000000-0000-4000-8000-000000000001";
const companyB = "00000000-0000-4000-8000-000000000002";

describe("AGU-03B.3 — ejecución real de snapshots en PGlite, proveedor simulado", () => {
  const pg = new PGlite();
  beforeAll(async () => {
    state.db = drizzle(pg);
    await pg.exec(`
      CREATE TABLE users (id text PRIMARY KEY, name text, company_id uuid, branch_id uuid);
      CREATE TABLE employee_profiles (user_id text, rfc text, hire_date timestamp, seniority_date date, is_active boolean);
      CREATE TABLE employee_contracts (user_id text, company_id uuid, base_salary integer, effective_salary_cents integer, status text);
      CREATE TABLE payroll_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL,
        period_start date NOT NULL, period_end date NOT NULL, status text NOT NULL DEFAULT 'DRAFT',
        aguinaldo_fiscal_year integer, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
      CREATE UNIQUE INDEX payroll_runs_company_aguinaldo_year_unique ON payroll_runs(company_id, aguinaldo_fiscal_year)
        WHERE aguinaldo_fiscal_year IS NOT NULL;
      CREATE TABLE payroll_payslips (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES payroll_runs(id),
        user_id text NOT NULL REFERENCES users(id), base_salary_cents integer NOT NULL DEFAULT 0, propinas_cents integer NOT NULL DEFAULT 0,
        holiday_pay_cents integer NOT NULL DEFAULT 0, overtime_pay_cents integer NOT NULL DEFAULT 0,
        aguinaldo_cents integer NOT NULL DEFAULT 0, total_percepciones_cents integer NOT NULL DEFAULT 0,
        total_deducciones_cents integer NOT NULL DEFAULT 0, cfdi_uuid text, cfdi_status text, sello_digital text,
        created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
      CREATE TABLE payroll_aguinaldo_dispersiones (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid,
        run_id uuid, source text, user_id text, anio_fiscal integer, monto_cents integer, motivo text,
        performed_by text, fecha_dispersion timestamp DEFAULT now(), created_at timestamp DEFAULT now());
      CREATE TABLE cfdi_nomina_timbrados (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL,
        empleado_rfc text NOT NULL, empleado_nombre text NOT NULL, periodo text NOT NULL, uuid text, status text NOT NULL,
        cadena_original text, sello_digital text, total_percepciones_cents integer NOT NULL, total_deducciones_cents integer NOT NULL,
        raw_response jsonb, timbrado_por text, fecha_timbrado timestamp, created_at timestamp DEFAULT now() NOT NULL,
        updated_at timestamp DEFAULT now() NOT NULL, UNIQUE(company_id, empleado_rfc, periodo));
      CREATE FUNCTION reject_test_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo DB simulado'; END $$;
    `);
    await pg.exec(readFileSync("drizzle/0122_aguinaldo_snapshot.sql", "utf8"));
  }, 60000);
  afterAll(async () => pg.close());
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  beforeEach(async () => {
    await pg.exec(`
      DROP TRIGGER IF EXISTS reject_snapshot ON payroll_payslips;
      DROP TRIGGER IF EXISTS reject_audit ON payroll_aguinaldo_dispersiones;
      DROP TRIGGER IF EXISTS reject_run_close ON payroll_runs;
      DROP TRIGGER IF EXISTS reject_receipt_confirmation ON payroll_payslips;
      TRUNCATE cfdi_nomina_timbrados, payroll_aguinaldo_dispersiones, payroll_payslips, payroll_runs, employee_contracts, employee_profiles, users;
      INSERT INTO users VALUES ('a1', 'Uno', '${companyA}', NULL), ('a2', 'Dos', '${companyA}', NULL), ('b1', 'Otra empresa', '${companyB}', NULL);
      INSERT INTO employee_profiles VALUES ('a1', 'AAA010101AAA', '2026-01-01', NULL, true),
        ('a2', 'BBB010101AAA', '2026-01-01', NULL, true), ('b1', 'AAA010101AAA', '2026-01-01', NULL, true);
      INSERT INTO employee_contracts VALUES ('a1', '${companyA}', 60000, 90000, 'ACTIVE'), ('a2', '${companyA}', 60000, 90000, 'ACTIVE'), ('b1', '${companyB}', 60000, NULL, 'ACTIVE');
    `);
    state.base = "REGISTERED";
    state.fiscalReal = false;
    state.timbrar.mockReset();
    state.timbrar.mockImplementation(async (input) => ({ status: "TIMBRADO", uuid: `cfdi-${input.companyId}-${input.empleadoRfc}` }));
  });

  it("el proveedor ve todos los pendientes confirmados; cambiar salario/config después no altera la autorización", async () => {
    state.timbrar.mockImplementationOnce(async (input) => {
      const stored = await pg.query<{ total: number }>("SELECT count(*)::int total FROM payroll_payslips WHERE cfdi_status = 'PENDIENTE' AND aguinaldo_snapshot IS NOT NULL");
      expect(stored.rows[0].total).toBe(2);
      await pg.exec("UPDATE employee_contracts SET base_salary = 100; UPDATE employee_profiles SET rfc = 'CAMBIADO'");
      state.base = "EFFECTIVE";
      return { status: "TIMBRADO", uuid: `cfdi-${input.empleadoRfc}` };
    });
    const result = await executeAguinaldoRun(companyA, 2026, "actor", { fechaPago: "2026-12-15" });
    expect(result.results.map((r) => r.success)).toEqual([true, true]);
    expect(state.timbrar).toHaveBeenCalledTimes(2);
    for (const [input] of state.timbrar.mock.calls) expect(input).toMatchObject({
      companyId: companyA, totalPercepciones: 900000, totalDeducciones: 117065, fechaPago: "2026-12-15", performedBy: "actor",
    });
    const persisted = await pg.query<{ gross: number; tax: number; snapshot: { pago: { netoCents: number } }; status: string }>(
      "SELECT total_percepciones_cents gross, total_deducciones_cents tax, aguinaldo_snapshot snapshot, cfdi_status status FROM payroll_payslips");
    expect(persisted.rows).toHaveLength(2);
    for (const row of persisted.rows) expect(row).toMatchObject({ gross: 900000, tax: 117065, snapshot: { pago: { netoCents: 782935 } }, status: "TIMBRADO" });
    expect((await pg.query("SELECT * FROM payroll_aguinaldo_dispersiones")).rows).toHaveLength(0);
  });

  it("un fallo al insertar snapshots revierte también la corrida y no solicita folios", async () => {
    await pg.exec("CREATE TRIGGER reject_snapshot BEFORE INSERT ON payroll_payslips FOR EACH ROW WHEN (NEW.user_id = 'a2') EXECUTE FUNCTION reject_test_write()");
    await expect(executeAguinaldoRun(companyA, 2026, "actor", { fechaPago: "2026-12-15" })).rejects.toThrow();
    expect((await pg.query("SELECT * FROM payroll_runs")).rows).toHaveLength(0);
    expect((await pg.query("SELECT * FROM payroll_payslips")).rows).toHaveLength(0);
    expect(state.timbrar).not.toHaveBeenCalled();
  });

  it("fallo de bitácora conserva un solo recibo TIMBRADO por empleado y resultado de error único", async () => {
    state.base = "EFFECTIVE";
    await pg.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON payroll_aguinaldo_dispersiones FOR EACH ROW EXECUTE FUNCTION reject_test_write()");
    const result = await executeAguinaldoRun(companyA, 2026, "actor", { fechaPago: "2026-12-15" });
    expect(result.results.map((r) => r.success)).toEqual([false, false]);
    const slips = await pg.query<{ cfdi_status: string }>("SELECT cfdi_status FROM payroll_payslips");
    expect(slips.rows).toEqual([{ cfdi_status: "TIMBRADO" }, { cfdi_status: "TIMBRADO" }]);
    expect((await pg.query<{ status: string }>("SELECT status FROM payroll_runs")).rows[0].status).toBe("COMPLETED_WITH_ERRORS");
  });

  it("empresa/año únicos: repetir conserva recibos y otra empresa puede ejecutar el mismo año", async () => {
    await executeAguinaldoRun(companyA, 2026, "actor-a", { fechaPago: "2026-12-15" });
    await expect(executeAguinaldoRun(companyA, 2026, "otro-actor", { fechaPago: "2026-12-16" })).rejects.toBeInstanceOf(AguinaldoRunDuplicadoError);
    await executeAguinaldoRun(companyB, 2026, "actor-b", { fechaPago: "2026-12-15" });
    expect(state.timbrar).toHaveBeenCalledTimes(3);
    const runs = await pg.query<{ company_id: string; actor: string; fecha: string }>(
      "SELECT company_id, aguinaldo_snapshot->>'performedBy' actor, aguinaldo_snapshot->>'fechaPago' fecha FROM payroll_runs ORDER BY company_id");
    expect(runs.rows).toEqual([
      { company_id: companyA, actor: "actor-a", fecha: "2026-12-15" },
      { company_id: companyB, actor: "actor-b", fecha: "2026-12-15" },
    ]);
    expect((await pg.query("SELECT * FROM payroll_payslips")).rows).toHaveLength(3);
  });

  it("sólo autoriza el contrato de la empresa del empleado, incluso con contratos ajenos activos", async () => {
    await pg.exec(`INSERT INTO employee_contracts VALUES ('a1', '${companyB}', 999999, NULL, 'ACTIVE')`);
    const result = await executeAguinaldoRun(companyA, 2026, "actor", { fechaPago: "2026-12-15" });
    expect(result.results.map((r) => r.success)).toEqual([true, true]);
    expect(state.timbrar).toHaveBeenCalledTimes(2);
    for (const [input] of state.timbrar.mock.calls) expect(input.totalPercepciones).toBe(900000);
  });

  it("recupera bitácora después del timbre con dos actores: cero nuevos folios y una entrada por empleado", async () => {
    state.base = "EFFECTIVE";
    await pg.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON payroll_aguinaldo_dispersiones FOR EACH ROW EXECUTE FUNCTION reject_test_write()");
    const inicial = await executeAguinaldoRun(companyA, 2026, "autoriza", { fechaPago: "2026-12-15" });
    await pg.exec("DROP TRIGGER reject_audit ON payroll_aguinaldo_dispersiones; UPDATE employee_contracts SET base_salary = 100");
    state.base = "REGISTERED";
    await Promise.all([recuperarAguinaldoRun(companyA, inicial.runId), recuperarAguinaldoRun(companyA, inicial.runId)]);
    expect(state.timbrar).toHaveBeenCalledTimes(2);
    const audit = await pg.query<{ user_id: string; performed_by: string; monto_cents: number }>(
      "SELECT user_id, performed_by, monto_cents FROM payroll_aguinaldo_dispersiones ORDER BY user_id");
    expect(audit.rows).toEqual([
      { user_id: "a1", performed_by: "autoriza", monto_cents: 450000 },
      { user_id: "a2", performed_by: "autoriza", monto_cents: 450000 },
    ]);
    expect((await pg.query<{ status: string }>("SELECT status FROM payroll_runs")).rows[0].status).toBe("COMPLETED");
  });

  it("caída al cerrar corrida después de persistir recibos: reintento conserva IDs y no llama al PAC", async () => {
    await pg.exec("CREATE TRIGGER reject_run_close BEFORE UPDATE ON payroll_runs FOR EACH ROW WHEN (NEW.status = 'COMPLETED') EXECUTE FUNCTION reject_test_write()");
    await expect(executeAguinaldoRun(companyA, 2026, "actor", { fechaPago: "2026-12-15" })).rejects.toThrow();
    const runs = await pg.query<{ id: string }>("SELECT id FROM payroll_runs");
    const before = (await pg.query("SELECT id, cfdi_uuid FROM payroll_payslips ORDER BY user_id")).rows;
    await pg.exec("DROP TRIGGER reject_run_close ON payroll_runs");
    const result = await recuperarAguinaldoRun(companyA, runs.rows[0].id);
    expect(result.results.map((r) => r.success)).toEqual([true, true]);
    expect((await pg.query("SELECT id, cfdi_uuid FROM payroll_payslips ORDER BY user_id")).rows).toEqual(before);
    expect(state.timbrar).toHaveBeenCalledTimes(2);
  });

  it("recuperar no acepta otra empresa ni una autorización legacy sin snapshot", async () => {
    const inicial = await executeAguinaldoRun(companyA, 2026, "actor", { fechaPago: "2026-12-15" });
    await expect(recuperarAguinaldoRun(companyB, inicial.runId)).rejects.toThrow(/encontr|empresa/i);
    await pg.exec("UPDATE payroll_runs SET aguinaldo_snapshot = NULL");
    await expect(recuperarAguinaldoRun(companyA, inicial.runId)).rejects.toThrow(/snapshot|autorización/i);
    expect(state.timbrar).toHaveBeenCalledTimes(2);
  });

  it("una corrida anterior al protocolo con recibo ERROR no autoriza otro folio", async () => {
    state.timbrar.mockRejectedValueOnce(new Error("resultado desconocido"));
    const initial = await executeAguinaldoRun(companyA, 2026, "actor", { fechaPago: "2026-12-15" });
    await pg.exec("UPDATE payroll_runs SET aguinaldo_snapshot = aguinaldo_snapshot - 'deliveryVersion'");
    const retry = await recuperarAguinaldoRun(companyA, initial.runId);
    expect(retry.results[0]).toMatchObject({ success: false, error: expect.stringMatching(/anterior al protocolo/) });
    expect(state.timbrar).toHaveBeenCalledTimes(2);
  });

  it("recorrido real servicio→fiscal→DB: caída tras timbre durable y dos recuperadores no duplican PAC/recibo/bitácora", async () => {
    state.fiscalReal = true; state.base = "EFFECTIVE";
    vi.stubEnv("FISCALAPI_API_KEY", "simulada-sin-red");
    const fetcher = vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      return Response.json({ succeeded: true, data: { uuid: `folio-${body.recipient.tin}-${fetcher.mock.calls.length}`, total: 7829.35, seal: "sello" } });
    });
    vi.stubGlobal("fetch", fetcher);
    await pg.exec("CREATE TRIGGER reject_receipt_confirmation BEFORE UPDATE ON payroll_payslips FOR EACH ROW WHEN (NEW.cfdi_status = 'TIMBRADO') EXECUTE FUNCTION reject_test_write()");
    const initial = await executeAguinaldoRun(companyA, 2026, "autoriza", { fechaPago: "2026-12-15" });
    expect(initial.results.map((r) => r.success)).toEqual([false, false]);
    expect((await pg.query("SELECT * FROM cfdi_nomina_timbrados WHERE status = 'TIMBRADO'")).rows).toHaveLength(2);
    await pg.exec("DROP TRIGGER reject_receipt_confirmation ON payroll_payslips; UPDATE employee_contracts SET base_salary = 100");
    vi.stubEnv("FISCALAPI_API_KEY", ""); state.base = "REGISTERED";
    await Promise.all([recuperarAguinaldoRun(companyA, initial.runId), recuperarAguinaldoRun(companyA, initial.runId)]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const slips = await pg.query<{ gross: number; tax: number; status: string }>(
      "SELECT total_percepciones_cents gross, total_deducciones_cents tax, cfdi_status status FROM payroll_payslips");
    expect(slips.rows).toEqual([{ gross: 900000, tax: 117065, status: "TIMBRADO" }, { gross: 900000, tax: 117065, status: "TIMBRADO" }]);
    expect((await pg.query("SELECT * FROM payroll_aguinaldo_dispersiones")).rows).toHaveLength(2);
    expect((await pg.query<{ status: string }>("SELECT status FROM payroll_runs")).rows[0].status).toBe("COMPLETED");
  });

  it("timeout del PAC conserva el bloqueo al recuperar; no repite ni borra el recibo ya confirmado del otro empleado", async () => {
    state.fiscalReal = true; vi.stubEnv("FISCALAPI_API_KEY", "simulada-sin-red");
    const fetcher = vi.fn(async () => Response.json({ succeeded: true, data: { uuid: "folio-2", total: 7829.35 } }));
    fetcher.mockRejectedValueOnce(new Error("timeout tras posible emisión"));
    vi.stubGlobal("fetch", fetcher);
    const initial = await executeAguinaldoRun(companyA, 2026, "actor", { fechaPago: "2026-12-15" });
    const retry = await recuperarAguinaldoRun(companyA, initial.runId);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(retry.results.filter((r) => r.success)).toHaveLength(1);
    expect(retry.results.find((r) => !r.success)?.error).toMatch(/incierto|concilia/);
    expect((await pg.query("SELECT * FROM payroll_payslips")).rows).toHaveLength(2);
    expect(retry.status).toBe("COMPLETED_WITH_ERRORS");
  });
});
