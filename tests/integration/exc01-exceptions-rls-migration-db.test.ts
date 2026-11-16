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
 * EXC-01.rls — lote 0152 aplicado sobre un esquema privado de Postgres.
 *
 * Aplica el SQL real de `drizzle/0152_exc01_exceptions_rls.sql` sobre una copia
 * vacía de `exceptions` (mismo patrón que OPS-02.nomina.E), con el rol dueño y
 * `search_path` privado. No activa políticas en `public` ni en el operativo.
 *
 * Comprueba:
 *   (1) el SQL habilita RLS, crea USING/WITH CHECK y otorga DML a `pulso_app`;
 *   (2) el archivo es reaplicable sin DDL improvisado ni error de política duplicada;
 *   (3) sin contexto no hay filas y las escrituras se rechazan;
 *   (4) cada empresa ve sólo lo suyo y los cruces se rechazan al insertar y actualizar;
 *   (5) la conexión reutilizada (pool max=1) no hereda el contexto anterior.
 *
 * No acredita la aceptación HTTP/sesión real de EXC-01 ni la aplicación del lote
 * al entorno operativo (OPS-03).
 */

neonConfig.webSocketConstructor = ws;

const namespace = `exc01_rls_${randomUUID().replaceAll("-", "")}`;
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

const MIGRATION = "drizzle/0152_exc01_exceptions_rls.sql";
const companyA = randomUUID();
const companyB = randomUUID();
let created = false;

async function applyMigration(target: Pool) {
  const client = await target.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL search_path TO "${namespace}", public`);
    for (const statement of readFileSync(MIGRATION, "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.query(statement);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

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

async function countFor(companyId: string) {
  return withCompanyContext(
    { companyId },
    async (tx) => {
      const result = await tx.execute(sql`SELECT count(*)::int AS total FROM exceptions`);
      return (result.rows[0] as { total: number }).total;
    },
    runtime,
  );
}

describe("EXC-01.rls — lote 0152 de aislamiento de excepciones sobre base real", () => {
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
    // para que el rol runtime pueda resolver la copia por search_path.
    await admin.query(`GRANT USAGE ON SCHEMA "${namespace}" TO "${RUNTIME_ROLE}"`);
    await admin.query(
      `CREATE TABLE "${namespace}".exceptions (LIKE public.exceptions INCLUDING ALL)`,
    );

    // El SQL real se aplica en una transacción con search_path privado: las
    // tablas sin calificar resuelven a la copia, nunca a `public`.
    await applyMigration(admin);

    const connection = (
      await runtimePool.query(
        "SELECT current_user role, current_schema() namespace, pg_backend_pid() pid",
      )
    ).rows[0];
    expect(connection.role).toBe(RUNTIME_ROLE);
    expect(connection.namespace).toBe(namespace);
  });

  beforeEach(async () => {
    await admin.query(`TRUNCATE "${namespace}".exceptions`);
    await admin.query(
      `INSERT INTO "${namespace}".exceptions
        (id,company_id,domain,qsr_category,severity,subject_type,subject_id,reason,status)
       VALUES
        ($1,$2,'operacion','INOCUIDAD','warning','TEMPERATURE_CHECK','probe-a','Cámara fría fuera de rango','OPEN'),
        ($3,$4,'inventario','ABASTO','high','STOCK_OUT','stock-b','Desabasto de insumo','OPEN')`,
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

  it("el SQL habilita RLS, crea USING/WITH CHECK y otorga DML, y es reaplicable", async () => {
    const enabled = (
      await admin.query(
        `SELECT c.relrowsecurity FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relname = 'exceptions'`,
        [namespace],
      )
    ).rows as Array<{ relrowsecurity: boolean }>;
    expect(enabled).toEqual([{ relrowsecurity: true }]);

    const policies = (
      await admin.query(
        `SELECT policyname, cmd, qual IS NOT NULL AS has_using,
                with_check IS NOT NULL AS has_check
           FROM pg_policies WHERE schemaname = $1 AND tablename = 'exceptions'`,
        [namespace],
      )
    ).rows;
    expect(policies).toEqual([
      {
        policyname: "exceptions_tenant_isolation",
        cmd: "ALL",
        has_using: true,
        has_check: true,
      },
    ]);

    const granted = (
      await admin.query(
        `SELECT has_table_privilege($1, format('%I.%I', $2::text, $3::text), 'SELECT,INSERT,UPDATE,DELETE') AS ok`,
        [RUNTIME_ROLE, namespace, "exceptions"],
      )
    ).rows[0].ok;
    expect(granted).toBe(true);

    // Reaplicar el archivo no duplica políticas ni rompe privilegios.
    await applyMigration(admin);
    const after = (
      await admin.query(
        `SELECT count(*)::int AS total FROM pg_policies WHERE schemaname = $1 AND tablename = 'exceptions'`,
        [namespace],
      )
    ).rows[0].total;
    expect(after).toBe(1);
  });

  it("sin contexto el rol runtime no ve filas ni puede escribir", async () => {
    const visible = await runtimePool.query(`SELECT * FROM "${namespace}".exceptions`);
    expect(visible.rows).toHaveLength(0);

    await expectRlsRejection(
      runtimePool.query(
        `INSERT INTO "${namespace}".exceptions
          (company_id,domain,qsr_category,subject_type,subject_id,reason)
         VALUES ($1,'operacion','DINERO','CROSS_TENANT','sin-contexto','Intento sin contexto')`,
        [companyA],
      ),
    );
  });

  it("cada empresa ve sólo lo suyo y los cruces se rechazan", async () => {
    expect(await countFor(companyA)).toBe(1);
    expect(await countFor(companyB)).toBe(1);

    await expectRlsRejection(
      withCompanyContext(
        { companyId: companyA },
        async (tx) => {
          await tx.execute(sql`INSERT INTO exceptions
            (company_id,domain,qsr_category,subject_type,subject_id,reason)
            VALUES (${companyB},'finanzas','DINERO','CROSS_TENANT','hack-01','Cruce de empresa')`);
        },
        runtime,
      ),
    );

    await expectRlsRejection(
      withCompanyContext(
        { companyId: companyA },
        async (tx) => {
          await tx.execute(sql`UPDATE exceptions SET company_id = ${companyB}
            WHERE subject_id = 'probe-a'`);
        },
        runtime,
      ),
    );

    const nuevo = randomUUID();
    await withCompanyContext(
      { companyId: companyA },
      async (tx) => {
        await tx.execute(sql`INSERT INTO exceptions
          (id,company_id,domain,qsr_category,subject_type,subject_id,reason)
          VALUES (${nuevo},${companyA},'equipos','DINERO','EQUIPMENT_FAULT','freidora-1','Falla de termostato')`);
      },
      runtime,
    );
    expect(await countFor(companyA)).toBe(2);
  });

  it("la conexión reutilizada con pool max=1 no hereda el contexto", async () => {
    expect(await countFor(companyA)).toBe(1);

    const after = await runtimePool.query(`SELECT * FROM "${namespace}".exceptions`);
    expect(after.rows).toHaveLength(0);
  });
});
