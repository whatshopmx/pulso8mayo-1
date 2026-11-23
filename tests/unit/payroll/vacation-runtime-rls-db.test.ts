import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

const pg = new PGlite();
const company = "aaaaaaaa-0000-4000-8000-000000000001";
const foreign = "bbbbbbbb-0000-4000-8000-000000000002";
const branch = "aaaaaaaa-0000-4000-8000-000000000011";
const sibling = "aaaaaaaa-0000-4000-8000-000000000012";
const foreignBranch = "bbbbbbbb-0000-4000-8000-000000000013";
const migration = "drizzle/0163_nom02c1_vacation_runtime.sql";

beforeAll(async () => {
  await pg.exec(`
    CREATE ROLE pulso_vacations_app NOBYPASSRLS NOSUPERUSER NOCREATEROLE NOCREATEDB;
    CREATE ROLE pulso_app NOBYPASSRLS NOSUPERUSER;
    CREATE TABLE users (id text PRIMARY KEY, company_id uuid, branch_id uuid, role text, deleted_at timestamp);
    CREATE TABLE branches (id uuid PRIMARY KEY, company_id uuid);
    CREATE TABLE vacation_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL, company_id uuid NOT NULL, branch_id uuid,
      start_date timestamp DEFAULT '2026-05-01', end_date timestamp DEFAULT '2026-05-02', total_days integer DEFAULT 2,
      status text DEFAULT 'PENDING', requested_at timestamp DEFAULT now(), created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now(),
      approved_by text, approved_at timestamp, rejected_by text, rejected_at timestamp, cancelled_at timestamp,
      reason text, manager_comments text, rejection_reason text
    );
  `);
  for (const statement of readFileSync(migration, "utf8").split("--> statement-breakpoint").filter(value => value.trim())) await pg.exec(statement);
});
beforeEach(async () => {
  await pg.exec("TRUNCATE vacation_requests, users, branches");
  await pg.query("INSERT INTO branches VALUES ($1,$2),($3,$2),($4,$5)", [branch, company, sibling, foreignBranch, foreign]);
  await pg.query(`INSERT INTO users VALUES
    ('admin',$1,NULL,'ADMIN',NULL), ('manager',$1,$2,'GERENTE',NULL),
    ('worker',$1,$2,'EMPLEADO',NULL), ('peer',$1,$2,'EMPLEADO',NULL),
    ('sibling',$1,$3,'EMPLEADO',NULL), ('foreign',$4,$5,'EMPLEADO',NULL),
    ('readonly',$1,$2,'READONLY',NULL), ('supervisor',$1,$2,'SUPERVISOR',NULL)`, [company, branch, sibling, foreign, foreignBranch]);
  await pg.query(`INSERT INTO vacation_requests (user_id,company_id,branch_id) VALUES
    ('worker',$1,$2),('peer',$1,$2),('sibling',$1,$3),('foreign',$4,$5)`, [company, branch, sibling, foreign, foreignBranch]);
});
afterAll(async () => { await pg.close(); });

async function asActor(actor: string | null, run: () => Promise<void>, role = "pulso_vacations_app", companyId = company) {
  await pg.exec("BEGIN");
  try {
    await pg.query("SELECT set_config('app.current_company_id',$1,true), set_config('app.current_actor_id',$2,true)", [companyId, actor ?? ""]);
    await pg.exec(`SET LOCAL ROLE ${role}`);
    await run();
  } finally { await pg.exec("ROLLBACK"); }
}
async function people() { return (await pg.query<{ user_id: string }>("SELECT user_id FROM vacation_requests ORDER BY user_id")).rows.map(row => row.user_id); }

it("sin actor no se leen filas aunque exista contexto de empresa", async () => {
  await asActor(null, async () => { expect(await people()).toEqual([]); });
});
it("ADMIN queda en su empresa y GERENTE en su sucursal", async () => {
  await asActor("admin", async () => { expect(await people()).toEqual(["peer", "sibling", "worker"]); });
  await asActor("manager", async () => { expect(await people()).toEqual(["peer", "worker"]); });
});
it("EMPLEADO solo ve lo propio y no aprueba ni lo propio", async () => {
  await asActor("worker", async () => {
    expect(await people()).toEqual(["worker"]);
    await expect(pg.exec("UPDATE vacation_requests SET status='APPROVED', approved_by='worker', approved_at=now() WHERE user_id='worker'")).rejects.toMatchObject({ code: "42501" });
  });
});
it("el runtime no tiene lectura directa del catálogo personal", async () => {
  await asActor("manager", async () => { await expect(pg.exec("SELECT * FROM users")).rejects.toMatchObject({ code: "42501" }); });
});
it("rechaza insertar una solicitud de otra empresa o de otro empleado sin permiso", async () => {
  await asActor("worker", async () => {
    await expect(pg.query("INSERT INTO vacation_requests(user_id,company_id,branch_id) VALUES ('peer',$1,$2)", [company, branch])).rejects.toMatchObject({ code: "42501" });
  });
  await asActor("manager", async () => {
    await expect(pg.query("INSERT INTO vacation_requests(user_id,company_id,branch_id) VALUES ('foreign',$1,$2)", [foreign, foreignBranch])).rejects.toMatchObject({ code: "42501" });
  });
});
it("permite decisión con actor correcto y deniega reescribir un hecho publicado", async () => {
  await asActor("manager", async () => {
    await pg.exec("UPDATE vacation_requests SET status='APPROVED', approved_by='manager', approved_at=now() WHERE user_id='worker'");
    await expect(pg.exec("UPDATE vacation_requests SET status='REJECTED', rejected_by='manager', rejected_at=now() WHERE user_id='worker'")).rejects.toMatchObject({ code: "23514" });
  });
});
it("no permite alterar actor de aprobación al cancelar lo propio", async () => {
  await pg.exec("BEGIN; SELECT set_config('app.current_actor_id','manager',true); UPDATE vacation_requests SET status='APPROVED', approved_by='manager', approved_at=now() WHERE user_id='worker'; COMMIT");
  await asActor("worker", async () => {
    await expect(pg.exec("UPDATE vacation_requests SET status='CANCELLED', cancelled_at=now(), approved_by='worker' WHERE user_id='worker'")).rejects.toMatchObject({ code: "23514" });
  });
});
it("READONLY no escribe y SUPERVISOR solo puede cancelar lo propio", async () => {
  await asActor("readonly", async () => {
    expect(await people()).toEqual(["peer", "worker"]);
    expect((await pg.query("UPDATE vacation_requests SET status='CANCELLED',cancelled_at=now() RETURNING id")).rows).toEqual([]);
  });
  await asActor("supervisor", async () => {
    expect((await pg.query("UPDATE vacation_requests SET status='CANCELLED',cancelled_at=now() WHERE user_id='worker' RETURNING id")).rows).toEqual([]);
  });
  await pg.query("INSERT INTO vacation_requests(user_id,company_id,branch_id) VALUES ('supervisor',$1,$2)", [company, branch]);
  await asActor("supervisor", async () => {
    expect((await pg.query("UPDATE vacation_requests SET status='CANCELLED',cancelled_at=now() WHERE user_id='supervisor' RETURNING status")).rows).toEqual([{ status: "CANCELLED" }]);
  });
});
it("el lector de nómina conserva su contexto de empresa sin adoptar el rol HTTP", async () => {
  await asActor(null, async () => { expect(await people()).toEqual(["peer", "sibling", "worker"]); }, "pulso_app");
});
it("ni un administrador inserta referencias cruzadas bajo empresa propia", async () => {
  await asActor("admin", async () => {
    await expect(pg.query("INSERT INTO vacation_requests(user_id,company_id,branch_id) VALUES ('foreign',$1,$2)", [company, branch])).rejects.toMatchObject({ code: "42501" });
  });
  await asActor("admin", async () => {
    await expect(pg.query("INSERT INTO vacation_requests(user_id,company_id,branch_id) VALUES ('worker',$1,$2)", [company, foreignBranch])).rejects.toMatchObject({ code: "42501" });
  });
});
it("cambiar solo el contexto de empresa no amplía al actor", async () => {
  await asActor("admin", async () => { expect(await people()).toEqual([]); }, "pulso_vacations_app", foreign);
});
it.each(["OWNER", "SUPER_ADMIN"])("%s conserva alcance corporativo dentro de su empresa", async role => {
  await pg.query("UPDATE users SET role=$1 WHERE id='admin'", [role]);
  await asActor("admin", async () => {
    expect(await people()).toEqual(["peer", "sibling", "worker"]);
    const result = await pg.query("UPDATE vacation_requests SET status='APPROVED',approved_by='admin',approved_at=now() WHERE user_id='sibling' RETURNING status");
    expect(result.rows).toEqual([{ status: "APPROVED" }]);
  });
});
it("un actor dado de baja no conserva acceso por su rol anterior", async () => {
  await pg.exec("UPDATE users SET deleted_at=now() WHERE id='admin'");
  await asActor("admin", async () => { expect(await people()).toEqual([]); });
});
