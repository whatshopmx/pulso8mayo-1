import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { payrollRuns, payrollPayslips } from "@/lib/db/schema";
import type { AguinaldoEmpleadoSnapshot, AguinaldoSnapshotCabecera } from "@/lib/services/aguinaldo-snapshot";
import { RUNTIME_ROLE, runtimeUrl } from "./helpers/runtime-role";

type Database = ReturnType<typeof drizzle>;
const state = vi.hoisted(() => ({ context: null as AsyncLocalStorage<Database> | null }));
vi.mock("@/lib/db", () => ({ get db() { return state.context?.getStore(); } }));
vi.mock("@/lib/fiscal/sat-test-data", () => ({
  loadCsdForTin: () => ({}), resolveTestPerson: () => null,
  SAT_TEST_MORALES: [{ tin: "EKU9003173C9", legalName: "Emisor de prueba", zipCode: "64000", taxRegimeCode: "601" }],
  SAT_TEST_FISICAS: [{ tin: "AAA010101AAA", legalName: "Prueba", zipCode: "64000" }],
}));
import { recuperarAguinaldoRun } from "@/lib/services/aguinaldo-run-execution";

neonConfig.webSocketConstructor = ws;
state.context = new AsyncLocalStorage<Database>();
const namespace = `nomina_a_${randomUUID().replaceAll("-", "")}`;
const options = `-c search_path=${namespace},public -c statement_timeout=15000 -c lock_timeout=10000`;
const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1, allowExitOnIdle: true, connectionTimeoutMillis: 5000, options });
const owner = drizzle(admin);
const pools = [0, 1].map(() => new Pool({ connectionString: runtimeUrl(), max: 1, allowExitOnIdle: true, connectionTimeoutMillis: 5000, options }));
const actors = pools.map((pool) => drizzle(pool));
const tables = ["payroll_runs", "payroll_payslips", "payroll_aguinaldo_dispersiones", "cfdi_nomina_timbrados"];
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
    for (const table of tables) await admin.query(`CREATE TABLE "${namespace}".${table} (LIKE public.${table} INCLUDING ALL)`);
    for (const table of tables.slice(0, 2)) await admin.query(`ALTER TABLE "${namespace}".${table} ADD COLUMN IF NOT EXISTS aguinaldo_snapshot jsonb`);
    await admin.query(`GRANT USAGE ON SCHEMA "${namespace}" TO "${RUNTIME_ROLE}"`);
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
    await admin.query(`TRUNCATE ${tables.map((table) => `"${namespace}".${table}`).join(",")}`);
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
});
