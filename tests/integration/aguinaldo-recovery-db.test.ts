import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { payrollRuns, payrollPayslips } from "@/lib/db/schema";
import type { AguinaldoEmpleadoSnapshot, AguinaldoSnapshotCabecera } from "@/lib/services/aguinaldo-snapshot";

type Database = ReturnType<typeof drizzle>;
const state = vi.hoisted(() => ({ context: null as AsyncLocalStorage<Database> | null, db: null as Database | null }));
vi.mock("@/lib/db", () => ({ get db() { return state.context?.getStore() ?? state.db; } }));
vi.mock("@/lib/fiscal/sat-test-data", () => ({
  loadCsdForTin: () => ({}), resolveTestPerson: () => null,
  SAT_TEST_MORALES: [{ tin: "EKU9003173C9", legalName: "Emisor de prueba", zipCode: "64000", taxRegimeCode: "601" }],
  SAT_TEST_FISICAS: [{ tin: "AAA010101AAA", legalName: "Prueba", zipCode: "64000" }],
}));
import { recuperarAguinaldoRun } from "@/lib/services/aguinaldo-run-execution";

neonConfig.webSocketConstructor = ws;
state.context = new AsyncLocalStorage<Database>();

// Un esquema aleatorio sólo en TEST_DATABASE_URL. No aplica migraciones ni
// cambia datos/políticas de public. LIKE conserva tipos/defaults/índices reales,
// pero no copia FK ni RLS: éstos corresponden a AGU-03C.3 / OPS-02.nomina.
const namespace = `agu03c_${randomUUID().replaceAll("-", "")}`;
const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1, allowExitOnIdle: true });
const pools = [0, 1].map(() => new Pool({
  connectionString: process.env.TEST_DATABASE_URL, max: 1, allowExitOnIdle: true,
  options: `-c search_path=${namespace},public -c statement_timeout=15000 -c lock_timeout=10000`,
}));
const actors = pools.map((pool) => drizzle(pool));
const tables = ["payroll_runs", "payroll_payslips", "payroll_aguinaldo_dispersiones", "cfdi_nomina_timbrados"];
const companyA = randomUUID();
const companyB = randomUUID();
let created = false;

function recover(actor: number, companyId: string, runId: string) {
  return state.context!.run(actors[actor], () => recuperarAguinaldoRun(companyId, runId));
}

// Oráculo de AGU-03A: año causado 2025, pago enero 2026, sin recálculo vivo.
async function authorize(companyId = companyA) {
  const header: AguinaldoSnapshotCabecera = {
    version: 1, deliveryVersion: 1, companyId, anioFiscal: 2025, fechaPago: "2026-01-31",
    branchId: null, performedBy: "autoriza", authorizedAt: "2026-01-30T12:00:00Z",
    base: "EFFECTIVE", practiceMode: "MIXED", fuenteRegla: "law-table", aguinaldoDaysMxn: 15,
    umaDailyCents: 11314, calculoVersion: "AGU-02C-ART174-v1",
  };
  const row = {
    version: 1, userId: randomUUID(), name: "Empleado", rfc: "AAA010101AAA", branchId: null,
    salarioDiarioCents: 60000, salarioEfectivoCents: 90000, fechaAntiguedad: "2025-01-01",
    diasLaborados: 365, fuenteDias: "MANUAL", diasAutomaticos: null, diferenciaCents: 450000,
    calculoEfectivo: null,
    calculo: { anioFiscal: 2025, base: "REGISTERED", diasLaborados: 365, brutoCents: 900000,
      exentoCents: 339420, gravadoCents: 560580, diasAguinaldo: 15 },
    pago: { totalDeduccionesCents: 119731, netoCents: 780269,
      retencion: { retencionCents: 119731, ajusteSubsidioCausadoCents: 0, subsidioAplicadoCents: 0 } },
  } as AguinaldoEmpleadoSnapshot;
  const [run] = await actors[0].insert(payrollRuns).values({ companyId, periodStart: "2025-01-01",
    periodEnd: "2025-12-31", status: "PROCESSING", aguinaldoFiscalYear: 2025, aguinaldoSnapshot: header }).returning();
  await actors[0].insert(payrollPayslips).values({ runId: run.id, userId: row.userId, aguinaldoSnapshot: row,
    aguinaldoCents: 900000, totalPercepcionesCents: 900000, totalDeduccionesCents: 119731, cfdiStatus: "PENDIENTE" });
  return run.id;
}

function pac() {
  const fetcher = vi.fn(async () => Response.json({ succeeded: true,
    data: { uuid: randomUUID(), total: 7802.69, seal: "sello-simulado" } }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

async function persisted() {
  return (await pools[0].query(`SELECT id, cfdi_uuid, cfdi_status, aguinaldo_snapshot,
    total_percepciones_cents, total_deducciones_cents FROM payroll_payslips ORDER BY id`)).rows;
}

describe("AGU-03C.1 — recuperación en Postgres independiente, PAC HTTP simulado", () => {
  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA "${namespace}"`);
    created = true;
    for (const table of tables) {
      await admin.query(`CREATE TABLE "${namespace}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    // 0122 puede estar pendiente en el entorno: sólo completar la COPIA privada.
    for (const table of ["payroll_runs", "payroll_payslips"]) {
      await admin.query(`ALTER TABLE "${namespace}"."${table}" ADD COLUMN IF NOT EXISTS aguinaldo_snapshot jsonb`);
    }
    await admin.query(`CREATE UNIQUE INDEX IF NOT EXISTS payroll_payslips_aguinaldo_snapshot_employee_unique
      ON "${namespace}".payroll_payslips(run_id, user_id) WHERE aguinaldo_snapshot IS NOT NULL`);
    await admin.query(`CREATE FUNCTION "${namespace}".reject_test_write() RETURNS trigger LANGUAGE plpgsql
      AS $$ BEGIN RAISE EXCEPTION 'fallo AGU-03C simulado'; END $$`);
    state.db = actors[0];
    const connections = await Promise.all(pools.map(async (pool) => (await pool.query(
      "SELECT pg_backend_pid() pid, current_schema() namespace")).rows[0]));
    expect(connections[0].pid).not.toBe(connections[1].pid);
    expect(connections.map((c) => c.namespace)).toEqual([namespace, namespace]);
  });

  beforeEach(async () => {
    await pools[0].query(`DROP TRIGGER IF EXISTS reject_confirmation ON payroll_payslips`);
    await pools[0].query(`DROP TRIGGER IF EXISTS reject_audit ON payroll_aguinaldo_dispersiones`);
    await pools[0].query(`DROP TRIGGER IF EXISTS reject_close ON payroll_runs`);
    await pools[0].query(`TRUNCATE ${tables.join(", ")}`);
    vi.stubEnv("FISCALAPI_API_KEY", "simulada-sin-red");
    vi.stubEnv("FISCALAPI_ENV", "test");
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  afterAll(async () => {
    await Promise.all(pools.map((pool) => pool.end()));
    // Identificador generado por este archivo; nunca deriva de un dato externo.
    if (created) await admin.query(`DROP SCHEMA "${namespace}" CASCADE`);
    await admin.end();
  });

  it("dos conexiones recuperan un timbre durable tras caída sin duplicar recibo ni bitácora", async () => {
    const fetcher = pac();
    const runId = await authorize();
    await pools[0].query(`CREATE TRIGGER reject_confirmation BEFORE UPDATE ON payroll_payslips
      FOR EACH ROW WHEN (NEW.cfdi_status = 'TIMBRADO') EXECUTE FUNCTION reject_test_write()`);
    expect((await recover(0, companyA, runId)).results[0].success).toBe(false);
    const before = await persisted();
    expect((await pools[0].query("SELECT status FROM cfdi_nomina_timbrados")).rows).toEqual([{ status: "TIMBRADO" }]);
    await pools[0].query("DROP TRIGGER reject_confirmation ON payroll_payslips");
    const results = await Promise.all([recover(0, companyA, runId), recover(1, companyA, runId)]);
    expect(results.map((r) => r.status)).toEqual(["COMPLETED", "COMPLETED"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [receipt] = await persisted();
    expect(receipt.id).toBe(before[0].id);
    expect(receipt.aguinaldo_snapshot).toEqual(before[0].aguinaldo_snapshot);
    expect(receipt.total_percepciones_cents).toBe(900000);
    expect(receipt.total_deducciones_cents).toBe(119731);
    const { calculo, pago } = receipt.aguinaldo_snapshot;
    expect(calculo.brutoCents).toBe(calculo.exentoCents + calculo.gravadoCents);
    expect(pago.netoCents).toBe(calculo.brutoCents - pago.totalDeduccionesCents);
    expect((await pools[0].query("SELECT performed_by, monto_cents FROM payroll_aguinaldo_dispersiones")).rows)
      .toEqual([{ performed_by: "autoriza", monto_cents: 450000 }]);
  });

  it("con pool max=1 el PAC no retiene conexión y otro actor no puede emitir mientras está en vuelo", async () => {
    const runId = await authorize();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const fetcher = vi.fn(async () => {
      entered(); await gate;
      return Response.json({ succeeded: true, data: { uuid: randomUUID(), total: 7802.69 } });
    });
    vi.stubGlobal("fetch", fetcher);
    const first = recover(0, companyA, runId);
    try {
      await Promise.race([started, first.then(() => { throw new Error("La recuperación terminó antes de enviar al PAC"); })]);
      // Usa la MISMA conexión del pool que el actor esperando al PAC.
      expect((await pools[0].query("SELECT status FROM cfdi_nomina_timbrados")).rows).toEqual([{ status: "PENDIENTE" }]);
      expect((await recover(1, companyA, runId)).status).toBe("COMPLETED_WITH_ERRORS");
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { release(); await first; }
    expect((await recover(1, companyA, runId)).status).toBe("COMPLETED");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("respuesta perdida queda incierta tras reintento en otra conexión", async () => {
    const runId = await authorize();
    const fetcher = vi.fn(async () => { throw new Error("respuesta perdida tras posible emisión"); });
    vi.stubGlobal("fetch", fetcher);
    expect((await recover(0, companyA, runId)).status).toBe("COMPLETED_WITH_ERRORS");
    const result = await recover(1, companyA, runId);
    expect(result.results[0]).toMatchObject({ success: false, error: expect.stringMatching(/incierto|concilia/) });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await persisted()).toHaveLength(1);
    expect((await pools[0].query("SELECT * FROM payroll_aguinaldo_dispersiones")).rows).toHaveLength(0);
  });

  it("fallo local anterior al envío permite reintentar desde otra conexión", async () => {
    const fetcher = pac();
    const runId = await authorize();
    vi.stubEnv("FISCALAPI_API_KEY", "");
    expect((await recover(0, companyA, runId)).status).toBe("COMPLETED_WITH_ERRORS");
    expect(fetcher).not.toHaveBeenCalled();
    vi.stubEnv("FISCALAPI_API_KEY", "simulada-sin-red");
    expect((await recover(1, companyA, runId)).status).toBe("COMPLETED");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(["gravadoCents", "netoCents"])("snapshot con %s inconsistente se rechaza antes de crear intención fiscal", async (field) => {
    const fetcher = pac();
    const runId = await authorize();
    const path = field === "gravadoCents" ? "{calculo,gravadoCents}" : "{pago,netoCents}";
    await pools[0].query("UPDATE payroll_payslips SET aguinaldo_snapshot = jsonb_set(aguinaldo_snapshot, $1, '1'::jsonb)", [path]);
    await expect(recover(1, companyA, runId)).rejects.toThrow(/inconsistente/);
    expect(fetcher).not.toHaveBeenCalled();
    expect((await pools[0].query("SELECT * FROM cfdi_nomina_timbrados")).rows).toHaveLength(0);
  });

  it.each(["audit", "close"])("caída en %s tras persistir el recibo se recupera sin pedir otro folio", async (failure) => {
    const fetcher = pac();
    const runId = await authorize();
    if (failure === "audit") await pools[0].query(`CREATE TRIGGER reject_audit BEFORE INSERT ON payroll_aguinaldo_dispersiones
      FOR EACH ROW EXECUTE FUNCTION reject_test_write()`);
    else await pools[0].query(`CREATE TRIGGER reject_close BEFORE UPDATE ON payroll_runs
      FOR EACH ROW WHEN (NEW.status = 'COMPLETED') EXECUTE FUNCTION reject_test_write()`);
    if (failure === "close") await expect(recover(0, companyA, runId)).rejects.toThrow();
    else expect((await recover(0, companyA, runId)).status).toBe("COMPLETED_WITH_ERRORS");
    const before = await persisted();
    expect(before[0].cfdi_status).toBe("TIMBRADO");
    await pools[0].query(failure === "audit" ? "DROP TRIGGER reject_audit ON payroll_aguinaldo_dispersiones"
      : "DROP TRIGGER reject_close ON payroll_runs");
    expect((await recover(1, companyA, runId)).status).toBe("COMPLETED");
    expect(await persisted()).toEqual(before);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await pools[0].query("SELECT * FROM payroll_aguinaldo_dispersiones")).rows).toHaveLength(1);
  });

  it("dos empresas con el mismo RFC/período conservan folios separados y rechazan recuperar corrida ajena", async () => {
    const fetcher = pac();
    const a = await authorize(companyA);
    const b = await authorize(companyB);
    await expect(recover(1, companyB, a)).rejects.toThrow(/empresa/);
    await Promise.all([recover(0, companyA, a), recover(1, companyB, b)]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const rows = (await pools[0].query("SELECT company_id, uuid FROM cfdi_nomina_timbrados")).rows;
    expect(new Set(rows.map((row) => row.company_id))).toEqual(new Set([companyA, companyB]));
    expect(new Set(rows.map((row) => row.uuid)).size).toBe(2);
    expect((await persisted()).every((row) => row.cfdi_status === "TIMBRADO")).toBe(true);
  });
});
