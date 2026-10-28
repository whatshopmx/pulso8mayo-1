import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { sql } from "drizzle-orm";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { RUNTIME_ROLE, runtimeUrl } from "./helpers/runtime-role";

/**
 * OPS-02.nomina.E — lote 0123 aplicado en un esquema privado de Postgres.
 *
 * Aplica el SQL real de `drizzle/0123_rls_nomina.sql` sobre copias vacías de las
 * cuatro tablas (mismo patrón que la recuperación de OPS-01), con el rol dueño y
 * `search_path` privado. No activa políticas en `public` ni en el operativo.
 *
 * Comprueba:
 *   (1) el SQL habilita RLS y crea una política por tabla con USING/WITH CHECK;
 *   (2) `pulso_app` recibe DML sin superuser ni bypass;
 *   (3) sin contexto no hay filas y las escrituras se rechazan;
 *   (4) cada empresa ve sólo lo suyo, incluidos recibos y dispersiones;
 *   (5) un recibo/dispersión que apunta a una corrida ajena se rechaza, también
 *       al cambiar `run_id` por UPDATE;
 *   (6) la conexión reutilizada (pool max=1) no hereda el contexto anterior.
 *
 * No acredita la aceptación HTTP/job con login real (OPS-02.nomina.F), ni la
 * aplicación del lote al entorno operativo (OPS-03).
 */

neonConfig.webSocketConstructor = ws;

const namespace = `nomina_e_${randomUUID().replaceAll("-", "")}`;
const options = `-c search_path=${namespace},public -c statement_timeout=15000 -c lock_timeout=10000`;
const admin = new Pool({
  connectionString: process.env.TEST_DATABASE_URL,
  max: 1,
  allowExitOnIdle: true,
  connectionTimeoutMillis: 5000,
  options,
});
const runtimePool = new Pool({
  connectionString: runtimeUrl(),
  max: 1,
  allowExitOnIdle: true,
  connectionTimeoutMillis: 5000,
  options,
});
const runtime = drizzle(runtimePool, { schema });

const TABLES = [
  "payroll_runs",
  "payroll_payslips",
  "payroll_aguinaldo_dispersiones",
  "cfdi_nomina_timbrados",
] as const;

const companyA = randomUUID();
const companyB = randomUUID();
const runA = randomUUID();
const runB = randomUUID();
const payslipA = randomUUID();
const payslipB = randomUUID();
let created = false;

async function expectRlsRejection(operation: Promise<unknown>) {
  try {
    await operation;
  } catch (error) {
    // drizzle envuelve el error de Postgres: el código vive en `cause`.
    const failure = error as { code?: string; cause?: { code?: string } };
    expect(failure.code ?? failure.cause?.code).toBe("42501");
    return;
  }
  throw new Error("La operación pasó sin ser rechazada por RLS.");
}

async function countFor(companyId: string, table: string) {
  return withCompanyContext(
    { companyId },
    async (tx) => {
      const result = await tx.execute(
        sql`SELECT count(*)::int AS total FROM ${sql.identifier(table)}`,
      );
      return (result.rows[0] as { total: number }).total;
    },
    runtime,
  );
}

describe("OPS-02.nomina.E — lote 0123 de RLS de nómina sobre base real", () => {
  beforeAll(async () => {
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
      await admin.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=$1`, [
        RUNTIME_ROLE,
      ])
    ).rows;
    expect(role).toEqual([{ rolsuper: false, rolbypassrls: false }]);

    await admin.query(`CREATE SCHEMA "${namespace}"`);
    created = true;
    // El lote real no conoce este esquema privado: el USAGE se otorga aparte
    // para que el rol runtime pueda resolver las copias por search_path.
    await admin.query(`GRANT USAGE ON SCHEMA "${namespace}" TO "${RUNTIME_ROLE}"`);
    for (const table of TABLES) {
      await admin.query(
        `CREATE TABLE "${namespace}".${table} (LIKE public.${table} INCLUDING ALL)`,
      );
    }

    // El SQL real se aplica en una transacción con search_path privado: las
    // tablas sin calificar resuelven a las copias, nunca a `public`.
    const client = await admin.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL search_path TO "${namespace}", public`);
      for (const statement of readFileSync("drizzle/0123_rls_nomina.sql", "utf8").split(
        "--> statement-breakpoint",
      )) {
        if (statement.trim()) await client.query(statement);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

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
      `TRUNCATE ${TABLES.map((table) => `"${namespace}".${table}`).join(",")}`,
    );
    await admin.query(
      `INSERT INTO "${namespace}".payroll_runs
        (id,company_id,period_start,period_end,status) VALUES
        ($1,$2,'2026-01-01','2026-12-31','COMPLETED'),
        ($3,$4,'2026-01-01','2026-12-31','COMPLETED')`,
      [runA, companyA, runB, companyB],
    );
    await admin.query(
      `INSERT INTO "${namespace}".payroll_payslips
        (id,run_id,user_id,aguinaldo_cents,total_percepciones_cents,total_deducciones_cents) VALUES
        ($1,$2,'user-a',900000,900000,119731),
        ($3,$4,'user-b',450000,450000,20000)`,
      [payslipA, runA, payslipB, runB],
    );
    await admin.query(
      `INSERT INTO "${namespace}".payroll_aguinaldo_dispersiones
        (id,company_id,run_id,source,user_id,anio_fiscal,monto_cents,motivo,performed_by) VALUES
        ($1,$2,$3,'RUN','user-a',2026,900000,'Excedente en efectivo','admin-a'),
        ($4,$2,NULL,'MANUAL','user-a',2026,100000,'Ajuste manual','admin-a'),
        ($5,$6,$7,'RUN','user-b',2026,450000,'Excedente en efectivo','admin-b'),
        ($8,$2,$7,'RUN','user-a',2026,50000,'Cruce declarado','admin-a')`,
      [randomUUID(), companyA, runA, randomUUID(), randomUUID(), companyB, runB, randomUUID()],
    );
    await admin.query(
      `INSERT INTO "${namespace}".cfdi_nomina_timbrados
        (id,company_id,empleado_rfc,empleado_nombre,periodo,status,total_percepciones_cents,total_deducciones_cents) VALUES
        ($1,$2,'XAXX010101000','Empleado A','2026-12','TIMBRADO',900000,119731),
        ($3,$4,'XBXX010101000','Empleado B','2026-12','TIMBRADO',450000,20000)`,
      [randomUUID(), companyA, randomUUID(), companyB],
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

  it("el SQL habilita RLS y crea USING/WITH CHECK en las cuatro tablas", async () => {
    const enabled = (
      await admin.query(
        `SELECT c.relname, c.relrowsecurity FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relname = ANY($2)`,
        [namespace, [...TABLES]],
      )
    ).rows as Array<{ relname: string; relrowsecurity: boolean }>;
    expect(enabled).toHaveLength(TABLES.length);
    expect(enabled.every((row) => row.relrowsecurity)).toBe(true);

    const policies = (
      await admin.query(
        `SELECT tablename, policyname, cmd, qual IS NOT NULL AS has_using,
                with_check IS NOT NULL AS has_check
           FROM pg_policies WHERE schemaname = $1 ORDER BY tablename`,
        [namespace],
      )
    ).rows as Array<{
      tablename: string;
      policyname: string;
      cmd: string;
      has_using: boolean;
      has_check: boolean;
    }>;
    expect(policies.map((row) => row.tablename).sort()).toEqual([...TABLES].sort());
    for (const policy of policies) {
      expect(policy).toMatchObject({
        policyname: `${policy.tablename}_tenant_isolation`,
        cmd: "ALL",
        has_using: true,
        has_check: true,
      });
    }

    for (const table of TABLES) {
      const granted = (
        await admin.query(
          `SELECT has_table_privilege($1, format('%I.%I', $2::text, $3::text), 'SELECT,INSERT,UPDATE,DELETE') AS ok`,
          [RUNTIME_ROLE, namespace, table],
        )
      ).rows[0].ok;
      expect(granted).toBe(true);
    }
  });

  it("sin contexto el rol runtime no ve filas ni puede escribir", async () => {
    for (const table of TABLES) {
      const result = await runtimePool.query(`SELECT * FROM "${table}"`);
      expect(result.rows).toHaveLength(0);
    }

    await expectRlsRejection(
      runtimePool.query(
        `INSERT INTO payroll_runs (company_id,period_start,period_end,status)
         VALUES ($1,'2027-01-01','2027-12-31','DRAFT')`,
        [companyA],
      ),
    );
  });

  it("cada empresa ve sólo sus corridas, recibos, dispersiones y CFDI", async () => {
    const runsA = await withCompanyContext(
      { companyId: companyA },
      async (tx) => (await tx.execute(sql`SELECT id FROM payroll_runs`)).rows.map((row) => row.id),
      runtime,
    );
    const runsB = await withCompanyContext(
      { companyId: companyB },
      async (tx) => (await tx.execute(sql`SELECT id FROM payroll_runs`)).rows.map((row) => row.id),
      runtime,
    );
    expect(runsA).toEqual([runA]);
    expect(runsB).toEqual([runB]);

    expect(await countFor(companyA, "payroll_payslips")).toBe(1);
    expect(await countFor(companyB, "payroll_payslips")).toBe(1);
    expect(await countFor(companyA, "cfdi_nomina_timbrados")).toBe(1);
    expect(await countFor(companyB, "cfdi_nomina_timbrados")).toBe(1);

    // Dispersiones de A: la propia y la manual sin corrida. La fila de A colgada
    // de la corrida de B queda oculta porque su padre no pertenece al contexto.
    expect(await countFor(companyA, "payroll_aguinaldo_dispersiones")).toBe(2);
    expect(await countFor(companyB, "payroll_aguinaldo_dispersiones")).toBe(1);

    const cross = await withCompanyContext(
      { companyId: companyA },
      async (tx) =>
        (await tx.execute(sql`SELECT id FROM payroll_runs WHERE company_id = ${companyB}`)).rows,
      runtime,
    );
    expect(cross).toHaveLength(0);
  });

  it("las escrituras legítimas pasan y los cruces se rechazan", async () => {
    const nuevoRecibo = randomUUID();
    await withCompanyContext(
      { companyId: companyA },
      async (tx) => {
        await tx.execute(sql`INSERT INTO payroll_payslips
          (id,run_id,user_id,total_percepciones_cents,total_deducciones_cents)
          VALUES (${nuevoRecibo},${runA},'user-nuevo',1000,0)`);
      },
      runtime,
    );
    expect(await countFor(companyA, "payroll_payslips")).toBe(2);

    // Recibo apuntando a la corrida ajena: WITH CHECK lo rechaza.
    await expectRlsRejection(
      withCompanyContext(
        { companyId: companyA },
        async (tx) => {
          await tx.execute(sql`INSERT INTO payroll_payslips
            (id,run_id,user_id,total_percepciones_cents,total_deducciones_cents)
            VALUES (${randomUUID()},${runB},'user-a',1000,0)`);
        },
        runtime,
      ),
    );

    // Cambiar el run_id de un recibo propio a una corrida ajena también se rechaza.
    await expectRlsRejection(
      withCompanyContext(
        { companyId: companyA },
        async (tx) => {
          await tx.execute(
            sql`UPDATE payroll_payslips SET run_id = ${runB} WHERE id = ${nuevoRecibo}`,
          );
        },
        runtime,
      ),
    );

    // Dispersión declarada en A pero colgada de la corrida de B: rechazada.
    await expectRlsRejection(
      withCompanyContext(
        { companyId: companyA },
        async (tx) => {
          await tx.execute(sql`INSERT INTO payroll_aguinaldo_dispersiones
            (id,company_id,run_id,source,user_id,anio_fiscal,monto_cents,motivo,performed_by)
            VALUES (${randomUUID()},${companyA},${runB},'RUN','user-a',2026,1000,'Cruce','admin-a')`);
        },
        runtime,
      ),
    );

    // CFDI de otra empresa: rechazado.
    await expectRlsRejection(
      withCompanyContext(
        { companyId: companyA },
        async (tx) => {
          await tx.execute(sql`INSERT INTO cfdi_nomina_timbrados
            (id,company_id,empleado_rfc,empleado_nombre,periodo,status,
             total_percepciones_cents,total_deducciones_cents)
            VALUES (${randomUUID()},${companyB},'XCXX010101000','Ajeno','2026-12','TIMBRADO',1000,0)`);
        },
        runtime,
      ),
    );

    // La dispersión manual (run_id NULL) y el CFDI propio siguen permitidos.
    await withCompanyContext(
      { companyId: companyA },
      async (tx) => {
        await tx.execute(sql`INSERT INTO payroll_aguinaldo_dispersiones
          (id,company_id,run_id,source,user_id,anio_fiscal,monto_cents,motivo,performed_by)
          VALUES (${randomUUID()},${companyA},NULL,'MANUAL','user-a',2026,2500,'Ajuste','admin-a')`);
        await tx.execute(sql`INSERT INTO cfdi_nomina_timbrados
          (id,company_id,empleado_rfc,empleado_nombre,periodo,status,
           total_percepciones_cents,total_deducciones_cents)
          VALUES (${randomUUID()},${companyA},'XDXX010101000','Propio','2026-12','TIMBRADO',1000,0)`);
      },
      runtime,
    );
    expect(await countFor(companyA, "payroll_aguinaldo_dispersiones")).toBe(3);
    expect(await countFor(companyA, "cfdi_nomina_timbrados")).toBe(2);
  });

  it("la conexión reutilizada con pool max=1 no hereda el contexto", async () => {
    expect(await countFor(companyA, "payroll_runs")).toBe(1);

    const after = await runtimePool.query(`SELECT * FROM payroll_runs`);
    expect(after.rows).toHaveLength(0);
  });
});
