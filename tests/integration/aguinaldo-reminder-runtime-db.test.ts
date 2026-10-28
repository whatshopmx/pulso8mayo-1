import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import {
  destinatariosPorEmpresa,
  enumerarEmpresasRecordatorio,
  leerEstadoAguinaldo,
} from "@/lib/services/aguinaldo-reminder-service";
import { RUNTIME_ROLE, runtimeUrl } from "./helpers/runtime-role";

/**
 * OPS-02.nomina.D — recordatorio de aguinaldo con rol runtime y RLS.
 *
 * El lote definitivo de políticas es OPS-02.nomina.E; aquí se usan políticas
 * privadas de contrato sobre una copia de `payroll_runs` en un esquema aislado.
 * Comprueba lo que el cron anterior no podía cumplir:
 *   (1) cada empresa se lee en su propia transacción con contexto;
 *   (2) sin contexto el rol runtime no ve corridas (no hay bypass);
 *   (3) dos empresas con el mismo año no se mezclan y la conexión reutilizada
 *       (pool max=1) no hereda el contexto anterior;
 *   (4) `OWNER` no es destinatario (no existe en `UserRole`/rutas) y la empresa
 *       que sólo tiene OWNER se reporta en `sinDestinatario`.
 *
 * No acredita la aceptación HTTP/job completa de OPS-02.nomina.F ni el lote
 * definitivo de políticas.
 */

neonConfig.webSocketConstructor = ws;

const namespace = `nomina_d_${randomUUID().replaceAll("-", "")}`;
const options = `-c search_path=${namespace},public -c statement_timeout=15000 -c lock_timeout=10000`;
const admin = new Pool({
  connectionString: process.env.TEST_DATABASE_URL,
  max: 1,
  allowExitOnIdle: true,
  connectionTimeoutMillis: 5000,
  options,
});
const owner = drizzle(admin, { schema });
const runtimePool = new Pool({
  connectionString: runtimeUrl(),
  max: 1,
  allowExitOnIdle: true,
  connectionTimeoutMillis: 5000,
  options,
});
const runtime = drizzle(runtimePool, { schema });
const tables = ["payroll_runs", "users"];
const companyA = randomUUID();
const companyB = randomUUID();
let created = false;

async function seedRun(companyId: string, status: string, anioFiscal = 2026) {
  const [run] = await owner
    .insert(schema.payrollRuns)
    .values({
      companyId,
      periodStart: `${anioFiscal}-01-01`,
      periodEnd: `${anioFiscal}-12-31`,
      status,
      aguinaldoFiscalYear: anioFiscal,
    })
    .returning();
  return run.id;
}

describe("OPS-02.nomina.D — recordatorio por empresa con RLS", () => {
  beforeAll(async () => {
    // Misma salvaguarda que el resto de pruebas de runtime: nunca la operativa.
    const target = new URL(process.env.TEST_DATABASE_URL!);
    for (const file of [".env", ".env.local"]) {
      if (!existsSync(file)) continue;
      const configured = parse(readFileSync(file)).DATABASE_URL;
      if (!configured) continue;
      const operative = new URL(configured);
      if (
        target.hostname.replace("-pooler", "") === operative.hostname.replace("-pooler", "") &&
        target.pathname === operative.pathname
      ) {
        throw new Error("La base de pruebas coincide con la operativa.");
      }
    }

    const role = (
      await admin.query(
        `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=$1`,
        [RUNTIME_ROLE],
      )
    ).rows;
    expect(role).toEqual([{ rolsuper: false, rolbypassrls: false }]);

    await admin.query(`CREATE SCHEMA "${namespace}"`);
    created = true;
    for (const table of tables) {
      await admin.query(
        `CREATE TABLE "${namespace}".${table} (LIKE public.${table} INCLUDING ALL)`,
      );
    }
    // 0122 aún no está aplicada en esta base (OPS-01): la copia necesita la
    // columna que el esquema ya declara para poder insertar corridas.
    await admin.query(
      `ALTER TABLE "${namespace}".payroll_runs ADD COLUMN IF NOT EXISTS aguinaldo_snapshot jsonb`,
    );

    await admin.query(`GRANT USAGE ON SCHEMA "${namespace}" TO "${RUNTIME_ROLE}"`);
    for (const table of tables) {
      await admin.query(
        `GRANT SELECT,INSERT,UPDATE,DELETE ON "${namespace}".${table} TO "${RUNTIME_ROLE}"`,
      );
    }

    const contexto = "NULLIF(current_setting('app.current_company_id',true),'')::uuid";
    await admin.query(`ALTER TABLE "${namespace}".payroll_runs ENABLE ROW LEVEL SECURITY`);
    await admin.query(
      `CREATE POLICY tenant_scope ON "${namespace}".payroll_runs
        USING (company_id=${contexto}) WITH CHECK (company_id=${contexto})`,
    );

    const connection = (
      await runtimePool.query(
        "SELECT current_user role, current_schema() namespace, pg_backend_pid() pid",
      )
    ).rows[0];
    expect(connection.role).toBe(RUNTIME_ROLE);
    expect(connection.namespace).toBe(namespace);
  });

  beforeEach(async () => {
    await admin.query(
      `TRUNCATE ${tables.map((table) => `"${namespace}".${table}`).join(",")}`,
    );
    await admin.query(`INSERT INTO "${namespace}".users
      (id,name,email,company_id,role,active,created_at,updated_at) VALUES
      ($1,'Admin A',$2,$3,'ADMIN',true,now(),now()),
      ($4,'Super A',$5,$3,'SUPER_ADMIN',true,now(),now()),
      ($6,'Dueño B',$7,$8,'OWNER',true,now(),now()),
      ($9,'Gerente A',$10,$3,'GERENTE',true,now(),now())`,
      [
        randomUUID(), `${randomUUID()}@nomina-d.test`, companyA,
        randomUUID(), `${randomUUID()}@nomina-d.test`,
        randomUUID(), `${randomUUID()}@nomina-d.test`, companyB,
        randomUUID(), `${randomUUID()}@nomina-d.test`,
      ],
    );
  });

  afterAll(async () => {
    try {
      await runtimePool.end();
      if (created) await admin.query(`DROP SCHEMA "${namespace}" CASCADE`);
    } finally {
      await admin.end();
    }
  });

  it("sin contexto el rol runtime no ve corridas; con contexto ve sólo la propia", async () => {
    await seedRun(companyA, "COMPLETED");
    await seedRun(companyB, "PROCESSING");

    expect((await runtimePool.query("SELECT * FROM payroll_runs")).rows).toHaveLength(0);

    const a = await leerEstadoAguinaldo(companyA, 2026, runtime);
    const b = await leerEstadoAguinaldo(companyB, 2026, runtime);

    expect(a).toMatchObject({
      companyId: companyA,
      estado: "TIMBRADO",
      estadoCorrida: "COMPLETED",
      timbradoCompleto: true,
    });
    expect(b).toMatchObject({
      companyId: companyB,
      estado: "EN_PROCESO",
      estadoCorrida: "PROCESSING",
      timbradoCompleto: false,
    });

    // La conexión reutilizada no hereda el contexto de la lectura anterior.
    expect((await runtimePool.query("SELECT * FROM payroll_runs")).rows).toHaveLength(0);
  });

  it("una empresa sin corrida del año no ve la corrida ajena", async () => {
    await seedRun(companyA, "COMPLETED", 2026);

    const vacia = await leerEstadoAguinaldo(companyB, 2026, runtime);
    expect(vacia).toMatchObject({
      companyId: companyB,
      estado: "SIN_CORRIDA",
      estadoCorrida: null,
      timbradoCompleto: false,
    });

    // Otro año tampoco aparece.
    const otroAnio = await leerEstadoAguinaldo(companyA, 2025, runtime);
    expect(otroAnio.estado).toBe("SIN_CORRIDA");
  });

  it("COMPLETED_WITH_ERRORS no se confunde con timbrado completo", async () => {
    await seedRun(companyA, "COMPLETED_WITH_ERRORS");
    const estado = await leerEstadoAguinaldo(companyA, 2026, runtime);
    expect(estado.estado).toBe("EN_PROCESO");
    expect(estado.timbradoCompleto).toBe(false);
  });

  it("los destinatarios excluyen OWNER y la empresa sin rol reconocido se reporta", async () => {
    const empresas = await enumerarEmpresasRecordatorio(owner);
    expect(empresas.conDestinatario).toEqual([companyA]);
    expect(empresas.sinDestinatario).toEqual([companyB]);

    const destinatarios = await destinatariosPorEmpresa([companyA, companyB], owner);
    // ADMIN y SUPER_ADMIN de A; el GERENTE no ejecuta nómina y OWNER no es rol de rutas.
    expect(destinatarios[companyA]).toHaveLength(2);
    expect(destinatarios[companyB]).toBeUndefined();
  });

  it("dos conexiones runtime con pool max=1 conservan el aislamiento", async () => {
    await seedRun(companyA, "COMPLETED");
    const secondPool = new Pool({
      connectionString: runtimeUrl(),
      max: 1,
      allowExitOnIdle: true,
      connectionTimeoutMillis: 5000,
      options,
    });
    const second = drizzle(secondPool, { schema });
    try {
      const [a, b] = await Promise.all([
        leerEstadoAguinaldo(companyA, 2026, runtime),
        leerEstadoAguinaldo(companyB, 2026, second),
      ]);
      expect(a.estado).toBe("TIMBRADO");
      expect(b.estado).toBe("SIN_CORRIDA");
    } finally {
      await secondPool.end();
    }
  });
});
