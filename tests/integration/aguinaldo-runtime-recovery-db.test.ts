import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { payrollRuns, payrollPayslips } from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";
import type { AguinaldoEmpleadoSnapshot, AguinaldoSnapshotCabecera } from "@/lib/services/aguinaldo-snapshot";
import { RUNTIME_ROLE, runtimeUrl } from "./helpers/runtime-role";

type Database = ReturnType<typeof drizzle>;
const state = vi.hoisted(() => ({ context: null as AsyncLocalStorage<Database> | null }));
vi.mock("@/lib/db", () => ({ get db() { return state.context?.getStore(); } }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn() }));
vi.mock("@/lib/fiscal/sat-test-data", () => ({
  loadCsdForTin: () => ({}), resolveTestPerson: () => null,
  SAT_TEST_MORALES: [{ tin: "EKU9003173C9", legalName: "Emisor de prueba", zipCode: "64000", taxRegimeCode: "601" }],
  SAT_TEST_FISICAS: [{ tin: "AAA010101AAA", legalName: "Prueba", zipCode: "64000" }],
}));
import { recuperarAguinaldoRun } from "@/lib/services/aguinaldo-run-execution";
import { executeAguinaldoRun, getAguinaldoRuns, registrarDispersionExcedente, listarDispersionesExcedente } from "@/lib/services/aguinaldo-payroll-service";

neonConfig.webSocketConstructor = ws;
state.context = new AsyncLocalStorage<Database>();
const namespace = `nomina_a_${randomUUID().replaceAll("-", "")}`;
const options = `-c search_path=${namespace},public -c statement_timeout=15000 -c lock_timeout=10000`;
const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1, allowExitOnIdle: true, connectionTimeoutMillis: 5000, options });
const owner = drizzle(admin, { schema });
const pools = [0, 1].map(() => new Pool({ connectionString: runtimeUrl(), max: 1, allowExitOnIdle: true, connectionTimeoutMillis: 5000, options }));
const actors = pools.map((pool) => drizzle(pool, { schema }));
const tables = ["payroll_runs", "payroll_payslips", "payroll_aguinaldo_dispersiones", "cfdi_nomina_timbrados"];
const sources = ["users", "employee_profiles", "employee_contracts", "shift_sessions", "leave_requests", "leave_types",
  "labor_law_calendar_rules", "tenant_operating_config"];
const companyA = randomUUID(); const companyB = randomUUID();
let created = false;

function recover(actor: number, companyId: string, runId: string) {
  return state.context!.run(actors[actor], () => recuperarAguinaldoRun(companyId, runId));
}
async function authorize(companyId = companyA) {
  const header: AguinaldoSnapshotCabecera = { version: 1, deliveryVersion: 1, companyId, anioFiscal: 2025,
    fechaPago: "2026-01-31", branchId: null, performedBy: "autoriza", authorizedAt: "2026-01-30T12:00:00Z",
    base: "EFFECTIVE", practiceMode: "MIXED", fuenteRegla: "law-table", aguinaldoDaysMxn: 15,
    umaDailyCents: 11314, calculoVersion: "AGU-02C-ART174-v1" };
  const row = { version: 1, userId: randomUUID(), name: "Empleado", rfc: "AAA010101AAA", branchId: null,
    salarioDiarioCents: 60000, salarioEfectivoCents: 90000, fechaAntiguedad: "2025-01-01", diasLaborados: 365,
    fuenteDias: "MANUAL", diasAutomaticos: null, diferenciaCents: 450000, calculoEfectivo: null,
    calculo: { anioFiscal: 2025, base: "REGISTERED", diasLaborados: 365, brutoCents: 900000, exentoCents: 339420,
      gravadoCents: 560580, diasAguinaldo: 15 },
    pago: { totalDeduccionesCents: 119731, netoCents: 780269,
      retencion: { retencionCents: 119731, ajusteSubsidioCausadoCents: 0, subsidioAplicadoCents: 0 } },
  } as AguinaldoEmpleadoSnapshot;
  const [run] = await owner.insert(payrollRuns).values({ companyId, periodStart: "2025-01-01", periodEnd: "2025-12-31",
    status: "PROCESSING", aguinaldoFiscalYear: 2025, aguinaldoSnapshot: header }).returning();
  await owner.insert(payrollPayslips).values({ runId: run.id, userId: row.userId, aguinaldoSnapshot: row,
    aguinaldoCents: 900000, totalPercepcionesCents: 900000, totalDeduccionesCents: 119731, cfdiStatus: "PENDIENTE" });
  return run.id;
}
function pac() {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ succeeded: true,
    data: { uuid: randomUUID(), total: 7802.69 } }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
function execute(actor: number, companyId = companyA) {
  return state.context!.run(actors[actor], () => executeAguinaldoRun(companyId, 2025, `autoriza-${actor}`, { fechaPago: "2026-01-31" }));
}
async function sourceEmployee(companyId = companyA, rfc = "AAA010101AAA") {
  const userId = randomUUID();
  await owner.insert(schema.users).values({ id: userId, name: "Empleado SQL", email: `${userId}@example.test`,
    companyId, createdAt: new Date(), updatedAt: new Date() });
  await owner.insert(schema.employeeProfiles).values({ userId, rfc, isActive: true,
    hireDate: new Date("2025-01-01T12:00:00Z"), createdBy: "fixture" });
  await owner.insert(schema.employeeContracts).values({ userId, companyId, contractNumber: userId,
    startDate: new Date("2025-01-01T12:00:00Z"), baseSalary: 60000, effectiveSalaryCents: 90000, createdBy: "fixture" });
  await owner.insert(schema.tenantOperatingConfig).values({ companyId, payrollPracticeMode: "MIXED", aguinaldoBase: "EFFECTIVE" }).onConflictDoNothing();
  return userId;
}
async function fiscalSource() {
  await owner.insert(schema.laborLawCalendarRules).values({ effectiveFrom: "2026-01-01", effectiveTo: "2026-01-31",
    maxWeeklyHours: 48, maxDoubleOvertimeHours: 9, maxTripleOvertimeHours: 0, maxDailySumHours: 12,
    maxExtraHoursPerDay: 3, maxExtraDaysPerWeek: 3, umaDailyMxn: "113.14", minimumWageMxn: "315.04",
    sourceDofUrl: "https://www.inegi.org.mx/temas/uma/", sourcePublishedOn: "2025-01-10" });
}

describe("OPS-02.nomina.A — recuperación con login runtime y políticas privadas", () => {
  beforeAll(async () => {
    const target = new URL(process.env.TEST_DATABASE_URL!);
    for (const file of [".env", ".env.local"]) {
      if (!existsSync(file)) continue;
      const configured = parse(readFileSync(file)).DATABASE_URL;
      if (!configured) continue;
      const operative = new URL(configured);
      if (target.hostname.replace("-pooler", "") === operative.hostname.replace("-pooler", "")
        && target.pathname === operative.pathname) throw new Error("La base de pruebas coincide con la operativa.");
    }
    const role = (await admin.query(`SELECT rolsuper, rolbypassrls, pg_has_role(oid,current_user,'MEMBER') owner_member
      FROM pg_roles WHERE rolname=$1`, [RUNTIME_ROLE])).rows;
    expect(role).toEqual([{ rolsuper: false, rolbypassrls: false, owner_member: false }]);
    await admin.query(`CREATE SCHEMA "${namespace}"`); created = true;
    for (const table of [...tables, ...sources]) await admin.query(`CREATE TABLE "${namespace}".${table} (LIKE public.${table} INCLUDING ALL)`);
    for (const table of tables.slice(0, 2)) await admin.query(`ALTER TABLE "${namespace}".${table} ADD COLUMN IF NOT EXISTS aguinaldo_snapshot jsonb`);
    await admin.query(`CREATE UNIQUE INDEX IF NOT EXISTS payroll_payslips_aguinaldo_snapshot_employee_unique
      ON "${namespace}".payroll_payslips(run_id,user_id) WHERE aguinaldo_snapshot IS NOT NULL`);
    await admin.query(`GRANT USAGE ON SCHEMA "${namespace}" TO "${RUNTIME_ROLE}"`);
    for (const table of sources) await admin.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON "${namespace}".${table} TO "${RUNTIME_ROLE}"`);
    const context = "NULLIF(current_setting('app.current_company_id',true),'')::uuid";
    for (const table of tables) {
      await admin.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON "${namespace}".${table} TO "${RUNTIME_ROLE}"`);
      await admin.query(`ALTER TABLE "${namespace}".${table} ENABLE ROW LEVEL SECURITY`);
      const parent = `EXISTS (SELECT 1 FROM "${namespace}".payroll_runs r WHERE r.id=run_id AND r.company_id=${context})`;
      const condition = table === "payroll_payslips" ? parent : table === "payroll_aguinaldo_dispersiones"
        ? `company_id=${context} AND (run_id IS NULL OR ${parent})` : `company_id=${context}`;
      await admin.query(`CREATE POLICY tenant_scope ON "${namespace}".${table} USING (${condition}) WITH CHECK (${condition})`);
    }
    const connections = await Promise.all(pools.map(async (pool) => (await pool.query(
      "SELECT current_user role, current_schema() namespace, pg_backend_pid() pid")).rows[0]));
    expect(connections.map((c) => [c.role, c.namespace])).toEqual([[RUNTIME_ROLE, namespace], [RUNTIME_ROLE, namespace]]);
    expect(connections[0].pid).not.toBe(connections[1].pid);
  });
  beforeEach(async () => {
    await admin.query(`DROP TRIGGER IF EXISTS reject_confirmation ON "${namespace}".payroll_payslips`);
    await admin.query(`DROP TRIGGER IF EXISTS reject_authorization ON "${namespace}".payroll_payslips`);
    await admin.query(`TRUNCATE ${[...tables, ...sources].map((table) => `"${namespace}".${table}`).join(",")}`);
    vi.stubEnv("FISCALAPI_API_KEY", "simulada-sin-red"); vi.stubEnv("FISCALAPI_ENV", "test");
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  afterAll(async () => {
    try { await Promise.all(pools.map((pool) => pool.end())); if (created) await admin.query(`DROP SCHEMA "${namespace}" CASCADE`); }
    finally { await admin.end(); }
  });

  it("recupera y finaliza bajo RLS sin heredar contexto al reutilizar el pool", async () => {
    const runId = await authorize(); const fetcher = pac();
    expect((await pools[0].query("SELECT * FROM payroll_runs")).rows).toHaveLength(0);
    expect(await recover(0, companyA, runId)).toMatchObject({ status: "COMPLETED" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    for (const table of tables) expect((await pools[0].query(`SELECT * FROM ${table}`)).rows).toHaveLength(0);
    expect((await admin.query("SELECT total_percepciones_cents,total_deducciones_cents,cfdi_status FROM payroll_payslips")).rows)
      .toEqual([{ total_percepciones_cents: 900000, total_deducciones_cents: 119731, cfdi_status: "TIMBRADO" }]);
  });

  it("dos empresas con el mismo RFC/año conservan recibos/folios propios y rechazan la corrida ajena", async () => {
    const a = await authorize(companyA); const b = await authorize(companyB); const fetcher = pac();
    await expect(recover(0, companyB, a)).rejects.toThrow(/empresa/);
    expect(fetcher).not.toHaveBeenCalled();
    const results = await Promise.all([recover(0, companyA, a), recover(1, companyB, b)]);
    expect(results.map((row) => row.status)).toEqual(["COMPLETED", "COMPLETED"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const folios = (await admin.query("SELECT company_id,uuid FROM cfdi_nomina_timbrados")).rows;
    expect(new Set(folios.map((row) => row.company_id))).toEqual(new Set([companyA, companyB]));
    expect(new Set(folios.map((row) => row.uuid)).size).toBe(2);
    expect((await admin.query("SELECT company_id,performed_by,monto_cents FROM payroll_aguinaldo_dispersiones ORDER BY company_id")).rows)
      .toEqual([companyA, companyB].sort().map((company_id) => ({ company_id, performed_by: "autoriza", monto_cents: 450000 })));
    for (const pool of pools) expect((await pool.query("SELECT * FROM payroll_payslips")).rows).toHaveLength(0);
  });

  it("el PAC espera sin retener pool ni contexto y el segundo actor no repite el envío", async () => {
    const runId = await authorize();
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const fetcher = vi.fn(async () => {
      entered();
      // Mismo pool max=1 del actor que espera al PAC; una transacción retenida
      // agota el timeout de adquisición. La conexión libre no hereda ajustes.
      const [scope] = (await pools[0].query(`SELECT current_setting('app.current_company_id',true) company,
        current_setting('app.current_actor_id',true) actor`)).rows;
      expect(scope.company).toBeFalsy(); expect(scope.actor).toBeFalsy();
      expect((await pools[0].query("SELECT * FROM cfdi_nomina_timbrados")).rows).toHaveLength(0);
      await gate;
      return Response.json({ succeeded: true, data: { uuid: randomUUID(), total: 7802.69 } });
    });
    vi.stubGlobal("fetch", fetcher);
    const first = recover(0, companyA, runId);
    try {
      await Promise.race([started, first.then(() => { throw new Error("Recuperación terminada antes del PAC"); })]);
      expect((await recover(1, companyA, runId)).status).toBe("COMPLETED_WITH_ERRORS");
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { release(); await first; }
    expect((await recover(1, companyA, runId)).status).toBe("COMPLETED");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await admin.query("SELECT * FROM payroll_aguinaldo_dispersiones")).rows).toHaveLength(1);
  });

  it("respuesta incierta conserva intención y no autoriza otro folio en otra conexión", async () => {
    const runId = await authorize();
    const fetcher = vi.fn(async () => { throw new Error("Respuesta perdida después de posible emisión"); });
    vi.stubGlobal("fetch", fetcher);
    expect((await recover(0, companyA, runId)).status).toBe("COMPLETED_WITH_ERRORS");
    expect((await recover(1, companyA, runId)).status).toBe("COMPLETED_WITH_ERRORS");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await admin.query("SELECT status FROM cfdi_nomina_timbrados")).rows).toEqual([{ status: "PENDIENTE" }]);
    expect((await admin.query("SELECT * FROM payroll_aguinaldo_dispersiones")).rows).toHaveLength(0);
  });

  it("fallo de recibo revierte la transacción local y otra conexión reutiliza el timbre confirmado", async () => {
    const runId = await authorize(); const fetcher = pac();
    const before = (await admin.query("SELECT id,aguinaldo_snapshot FROM payroll_payslips")).rows;
    await admin.query(`CREATE FUNCTION "${namespace}".reject_receipt() RETURNS trigger LANGUAGE plpgsql
      AS $$ BEGIN RAISE EXCEPTION 'fallo local de recibo'; END $$`);
    await admin.query(`CREATE TRIGGER reject_confirmation BEFORE UPDATE ON "${namespace}".payroll_payslips
      FOR EACH ROW WHEN (NEW.cfdi_status='TIMBRADO') EXECUTE FUNCTION "${namespace}".reject_receipt()`);
    expect((await recover(0, companyA, runId)).status).toBe("COMPLETED_WITH_ERRORS");
    expect((await admin.query("SELECT status FROM cfdi_nomina_timbrados")).rows).toEqual([{ status: "TIMBRADO" }]);
    expect((await pools[0].query("SELECT * FROM payroll_runs")).rows).toHaveLength(0);
    await admin.query(`DROP TRIGGER reject_confirmation ON "${namespace}".payroll_payslips`);
    const results = await Promise.all([recover(0, companyA, runId), recover(1, companyA, runId)]);
    expect(results.map((row) => row.status)).toEqual(["COMPLETED", "COMPLETED"]);
    expect((await admin.query("SELECT id,aguinaldo_snapshot FROM payroll_payslips")).rows).toEqual(before);
    expect((await admin.query("SELECT performed_by,monto_cents FROM payroll_aguinaldo_dispersiones")).rows)
      .toEqual([{ performed_by: "autoriza", monto_cents: 450000 }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("sin contexto no permite escribir y sin empresa no inicia recuperación fiscal", async () => {
    const runId = await authorize(); const fetcher = pac();
    await expect(pools[0].query(`INSERT INTO cfdi_nomina_timbrados
      (company_id,empleado_rfc,empleado_nombre,periodo,status,total_percepciones_cents,total_deducciones_cents)
      VALUES ($1,'AAA010101AAA','Sin contexto','2025-AGU','PENDIENTE',900000,119731)`, [companyA]))
      .rejects.toMatchObject({ code: "42501" });
    await expect(recover(0, "", runId)).rejects.toThrow(/companyId/);
    expect(fetcher).not.toHaveBeenCalled();
    expect((await admin.query("SELECT * FROM cfdi_nomina_timbrados")).rows).toHaveLength(0);
    expect((await pools[0].query("SELECT * FROM payroll_runs")).rows).toHaveLength(0);
  });

  it("B.1: autoriza desde fuentes SQL y lista historial/bitácora sólo de su empresa", async () => {
    await fiscalSource(); await sourceEmployee(); await sourceEmployee(companyB); const fetcher = pac();
    const [a, b] = await Promise.all([execute(0), execute(1, companyB)]);
    expect(a.results[0].success).toBe(true); expect(b.results[0].success).toBe(true);
    const history = await state.context!.run(actors[0], () => getAguinaldoRuns(companyA));
    expect(history.map((row) => row.id)).toEqual([a.runId]);
    const audit = await state.context!.run(actors[0], () => listarDispersionesExcedente(companyA, 2025));
    expect(audit).toMatchObject([{ montoCents: 450000, performedBy: "autoriza-0", source: "RUN" }]);
    await expect(execute(0)).rejects.toThrow(/2025/);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("B.1: registra bitácora manual para su empleado y rechaza el de otra empresa", async () => {
    const a = await sourceEmployee(); const b = await sourceEmployee(companyB);
    const input = { anioFiscal: 2025, userId: a, montoCents: 12345, motivo: "Registro manual de revisión", performedBy: "manual" };
    const row = await state.context!.run(actors[0], () => registrarDispersionExcedente(companyA, input));
    expect(row).toMatchObject({ companyId: companyA, userId: a, montoCents: 12345, source: "MANUAL", runId: null });
    await expect(state.context!.run(actors[0], () => registrarDispersionExcedente(companyA, { ...input, userId: b })))
      .rejects.toThrow(/Empleado no encontrado/);
    expect(await state.context!.run(actors[0], () => listarDispersionesExcedente(companyB, 2025))).toEqual([]);
    expect(await state.context!.run(actors[0], () => listarDispersionesExcedente(companyA, 2025)))
      .toMatchObject([{ id: row.id, userId: a, performedBy: "manual" }]);
    expect((await admin.query("SELECT * FROM payroll_aguinaldo_dispersiones")).rows).toHaveLength(1);
    expect((await pools[0].query("SELECT * FROM payroll_aguinaldo_dispersiones")).rows).toHaveLength(0);
  });

  it("B.1: fallo de autorización revierte corrida y recibo antes del PAC y permite otro autorizador", async () => {
    await fiscalSource(); await sourceEmployee(); const fetcher = pac();
    await sourceEmployee(companyA, "BBB010101BBB");
    await admin.query(`CREATE FUNCTION "${namespace}".reject_authorization() RETURNS trigger LANGUAGE plpgsql
      AS $$ BEGIN RAISE EXCEPTION 'fallo de autorización'; END $$`);
    await admin.query(`CREATE TRIGGER reject_authorization BEFORE INSERT ON "${namespace}".payroll_payslips
      FOR EACH ROW WHEN (NEW.aguinaldo_snapshot->>'rfc'='BBB010101BBB') EXECUTE FUNCTION "${namespace}".reject_authorization()`);
    await expect(execute(0)).rejects.toThrow();
    for (const table of tables) expect((await admin.query(`SELECT * FROM ${table}`)).rows).toHaveLength(0);
    expect(fetcher).not.toHaveBeenCalled();
    expect((await pools[0].query("SELECT * FROM payroll_runs")).rows).toHaveLength(0);
    await admin.query(`DROP TRIGGER reject_authorization ON "${namespace}".payroll_payslips`);
    expect((await execute(1)).results.map((result) => result.success)).toEqual([true, true]);
    expect((await admin.query("SELECT * FROM payroll_payslips")).rows).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("B.1: dos autorizadores con runtime compiten al guardar y sólo uno solicita folio", async () => {
    await fiscalSource(); await sourceEmployee(); const fetcher = pac();
    let entered = 0; let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const spies = actors.map((actor) => {
      const transaction = actor.transaction.bind(actor);
      return vi.spyOn(actor, "transaction")
        .mockImplementationOnce((fn, config) => transaction(fn, config))
        .mockImplementationOnce(async (fn, config) => {
          if (++entered === 2) release(); await gate;
          return transaction(fn, config);
        });
    });
    let results;
    try { results = await Promise.allSettled([execute(0), execute(1)]); }
    finally { spies.forEach((spy) => spy.mockRestore()); }
    expect(entered).toBe(2);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const runs = (await admin.query("SELECT aguinaldo_snapshot FROM payroll_runs")).rows;
    expect(runs).toHaveLength(1);
    expect((await admin.query("SELECT * FROM payroll_payslips")).rows).toHaveLength(1);
    expect((await admin.query("SELECT performed_by FROM payroll_aguinaldo_dispersiones")).rows)
      .toEqual([{ performed_by: runs[0].aguinaldo_snapshot.performedBy }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
