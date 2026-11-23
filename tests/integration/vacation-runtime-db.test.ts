import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { Pool } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createSalesRuntimeDatabase } from "./helpers/sales-runtime-database";
import { companies, branches, users, vacationRequests } from "@/lib/db/schema";

type VacationTx = Parameters<Parameters<typeof import("@/lib/db").db.transaction>[0]>[0];
type VacationActor = import("@/lib/services/vacation-access").VacationActor;
const authState = vi.hoisted(() => ({
  user: { id: "", role: "GERENTE", companyId: "", branchId: null as string | null }, notify: vi.fn(),
  gate: null as null | { requestId: string; waiting: number; pids: number[]; promise: Promise<void>; release: () => void },
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => ({ user: authState.user }) } } }));
vi.mock("@/lib/services/notification-dispatcher", () => ({ NotificationDispatcher: { sendNotification: authState.notify } }));
vi.mock("@/lib/db/vacation-runtime", async importOriginal => {
  const real = await importOriginal<typeof import("@/lib/db/vacation-runtime")>();
  return { ...real, withVacationTransaction: <T>(user: VacationActor, callback: (tx: VacationTx, runtime: boolean) => Promise<T>) =>
    real.withVacationTransaction(user, async (tx, runtime) => {
      if (!authState.gate) return callback(tx, runtime);
      // Scheduling only: queries and writes remain the real handler/driver.
      // Both open transactions must read PENDING before either can update.
      const scheduled = new Proxy(tx, { get(target, key) {
        if (key === "query") return { ...target.query, vacationRequests: new Proxy(target.query.vacationRequests, {
          get(table, method) {
            if (method === "findFirst") return async (...args: Parameters<typeof table.findFirst>) => {
              const row = await table.findFirst(...args);
              const gate = authState.gate;
              if (gate && row?.id === gate.requestId) {
                expect(row.status).toBe("PENDING");
                gate.pids.push(Number((await tx.execute(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid));
                if (++gate.waiting === 2) gate.release();
                let timer: ReturnType<typeof setTimeout> | undefined;
                try { await Promise.race([gate.promise, new Promise((_, reject) => {
                  timer = setTimeout(() => reject(new Error("Vacation race barrier timed out")), 15_000);
                })]); } finally { clearTimeout(timer); }
              }
              return row;
            };
            const value = Reflect.get(table, method, table);
            return typeof value === "function" ? value.bind(table) : value;
          },
        }) };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      } });
      return callback(scheduled, runtime);
    }),
  };
});

const previous = { database: process.env.DATABASE_URL, runtime: process.env.VACATIONS_RUNTIME_DATABASE_URL };
let fixture: Awaited<ReturnType<typeof createSalesRuntimeDatabase>> | undefined;
let run: typeof import("@/lib/db/vacation-runtime").withVacationTransaction;
let routes: typeof import("@/app/api/vacations/route");
let decision: typeof import("@/app/api/vacations/approve/route").POST;

beforeAll(async () => {
  fixture = await createSalesRuntimeDatabase({ baseline: "0158", grants: "none" });
  await fixture.owner.transaction(async tx => {
    for (const statement of readFileSync("drizzle/0163_nom02c1_vacation_runtime.sql", "utf8")
      .split("--> statement-breakpoint").filter(value => value.trim())) {
      await tx.execute(sql.raw(statement.replaceAll("pulso_vacations_app", fixture!.roleName)));
    }
  });
  process.env.DATABASE_URL = fixture.ownerUrl;
  process.env.VACATIONS_RUNTIME_DATABASE_URL = fixture.runtimeUrl;
  const version = (await fixture.owner.execute(sql`SELECT current_setting('server_version_num')::int AS version`)).rows[0].version;
  console.info("Synthetic vacation PostgreSQL version", Number(version));
  run = (await import("@/lib/db/vacation-runtime")).withVacationTransaction;
  routes = await import("@/app/api/vacations/route");
  decision = (await import("@/app/api/vacations/approve/route")).POST;
}, 180_000);
afterAll(async () => {
  try {
    // Close this test worker's host pool before dropping its own disposable DB.
    // This avoids idle-client error events with driver objects during cleanup.
    const host = globalThis as typeof globalThis & { __pulsoPool?: Pool };
    try { await host.__pulsoPool?.end(); }
    finally { delete host.__pulsoPool; await fixture?.close(); }
  }
  finally {
    for (const [key, value] of [["DATABASE_URL", previous.database], ["VACATIONS_RUNTIME_DATABASE_URL", previous.runtime]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  }
}, 90_000);

async function seed() {
  const company = randomUUID(), foreignCompany = randomUUID();
  const branch = randomUUID(), siblingBranch = randomUUID(), foreignBranch = randomUUID();
  const ids = Object.fromEntries(["admin", "manager", "worker", "peer", "sibling", "foreign"].map(key => [key, `vac-${key}-${randomUUID()}`]));
  await fixture!.owner.insert(companies).values([{ id: company, name: "Synthetic vacation A" }, { id: foreignCompany, name: "Synthetic vacation B" }]);
  await fixture!.owner.insert(branches).values([
    { id: branch, companyId: company, name: "A" }, { id: siblingBranch, companyId: company, name: "A sibling" },
    { id: foreignBranch, companyId: foreignCompany, name: "B" },
  ]);
  await fixture!.owner.insert(users).values([
    { id: ids.admin, role: "ADMIN" as const, companyId: company, branchId: null },
    { id: ids.manager, role: "GERENTE" as const, companyId: company, branchId: branch },
    { id: ids.worker, role: "EMPLEADO" as const, companyId: company, branchId: branch },
    { id: ids.peer, role: "EMPLEADO" as const, companyId: company, branchId: branch },
    { id: ids.sibling, role: "EMPLEADO" as const, companyId: company, branchId: siblingBranch },
    { id: ids.foreign, role: "EMPLEADO" as const, companyId: foreignCompany, branchId: foreignBranch },
  ].map(user => ({ ...user, name: user.id, email: `${user.id}@vacation.test`, createdAt: new Date(), updatedAt: new Date() })));
  const requests = await fixture!.owner.insert(vacationRequests).values([
    { userId: ids.worker, companyId: company, branchId: branch },
    { userId: ids.peer, companyId: company, branchId: branch },
    { userId: ids.sibling, companyId: company, branchId: siblingBranch },
    { userId: ids.foreign, companyId: foreignCompany, branchId: foreignBranch },
  ].map(row => ({ ...row, startDate: new Date("2026-12-01T12:00:00Z"), endDate: new Date("2026-12-03T12:00:00Z"), totalDays: 3 }))).returning();
  const actor = (key: keyof typeof ids, role: string) => ({ id: ids[key], role, companyId: company, branchId: branch });
  return { company, foreignCompany, branch, ids, requests, actor };
}
const req = (path = "", method = "GET", body?: unknown) => new NextRequest(`http://localhost/api/vacations${path}`, {
  method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
});

it("runtime LOGIN independiente: alcance real, permisos mínimos, contexto local y denegación de configuración insegura", async () => {
  const s = await seed();
  const people = (actor: ReturnType<typeof s.actor>) => run(actor, async (tx, runtime) => {
    expect(runtime).toBe(true);
    const role = (await tx.execute(sql`SELECT current_user, session_user, (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) AS bypass`)).rows[0];
    expect(role).toEqual({ current_user: fixture!.roleName, session_user: fixture!.roleName, bypass: false });
    return (await tx.execute<{ user_id: string }>(sql`SELECT user_id FROM vacation_requests ORDER BY user_id`)).rows.map(row => row.user_id);
  });
  expect(await people(s.actor("worker", "EMPLEADO"))).toEqual([s.ids.worker]);
  expect(await people(s.actor("manager", "GERENTE"))).toEqual([s.ids.peer, s.ids.worker].sort());
  expect(await people(s.actor("admin", "ADMIN"))).toEqual([s.ids.peer, s.ids.sibling, s.ids.worker].sort());
  // Existing payroll reader: no actor is needed, but company context remains
  // mandatory. SET LOCAL changes only this fixture transaction, no role grants.
  await fixture!.owner.transaction(async tx => {
    await tx.execute(sql`SELECT set_config('app.current_company_id',${s.company},true),
      set_config('app.current_actor_id','',true), set_config('app.current_branch_id','',true)`);
    await tx.execute(sql`SET LOCAL ROLE pulso_app`);
    const legacy = (await tx.execute<{ user_id: string }>(sql`SELECT user_id FROM vacation_requests ORDER BY user_id`)).rows;
    expect(legacy.map(row => row.user_id)).toEqual([s.ids.peer, s.ids.sibling, s.ids.worker].sort());
  });
  await run(s.actor("worker", "EMPLEADO"), async tx => {
    await tx.execute(sql`SELECT set_config('app.current_actor_id','',true)`);
    expect((await tx.execute(sql`SELECT id FROM vacation_requests`)).rows).toEqual([]);
  });
  await expect(run(s.actor("manager", "GERENTE"), tx => tx.execute(sql`SELECT name FROM users`))).rejects.toMatchObject({ statusCode: 403 });
  await expect(run(s.actor("worker", "EMPLEADO"), tx => tx.execute(sql`UPDATE vacation_requests SET status='APPROVED', approved_by=${s.ids.worker}, approved_at=now() WHERE user_id=${s.ids.worker}`))).rejects.toMatchObject({ statusCode: 403 });

  const callback = vi.fn();
  process.env.VACATIONS_RUNTIME_DATABASE_URL = fixture!.ownerUrl;
  try { await expect(run(s.actor("manager", "GERENTE"), callback)).rejects.toMatchObject({ statusCode: 503 }); }
  finally { process.env.VACATIONS_RUNTIME_DATABASE_URL = fixture!.runtimeUrl; }
  await fixture!.owner.execute(sql`ALTER TABLE vacation_requests DISABLE ROW LEVEL SECURITY`);
  try { await expect(run(s.actor("manager", "GERENTE"), callback)).rejects.toMatchObject({ statusCode: 503 }); }
  finally { await fixture!.owner.execute(sql`ALTER TABLE vacation_requests ENABLE ROW LEVEL SECURITY`); }
  await fixture!.owner.execute(sql.raw(`GRANT UPDATE (start_date) ON vacation_requests TO "${fixture!.roleName}"`));
  try { await expect(run(s.actor("manager", "GERENTE"), callback)).rejects.toMatchObject({ statusCode: 503 }); }
  finally { await fixture!.owner.execute(sql.raw(`REVOKE UPDATE (start_date) ON vacation_requests FROM "${fixture!.roleName}"`)); }
  expect(callback).not.toHaveBeenCalled();
}, 150_000);

it("handlers con runtime: creación/lectura, rechazo ajeno y decisiones concurrentes entre conexiones independientes", async () => {
  const s = await seed();
  authState.user = s.actor("worker", "EMPLEADO");
  const created = await routes.POST(req("", "POST", { userId: s.ids.worker, companyId: s.company, startDate: "2026-12-10", endDate: "2026-12-12" }));
  expect(created.status).toBe(200);
  const createdRow = (await created.json()).data;
  expect(createdRow).toMatchObject({ userId: s.ids.worker, companyId: s.company, branchId: s.branch, status: "PENDING" });
  const list = await routes.GET(req());
  expect(list.status).toBe(200);
  expect((await list.json()).data).toHaveLength(2);
  expect((await decision(req("/approve", "POST", { id: createdRow.id, action: "APPROVED" }))).status).toBe(403);

  authState.user = s.actor("manager", "GERENTE");
  const foreignId = s.requests.find(row => row.userId === s.ids.foreign)!.id;
  expect((await decision(req("/approve", "POST", { id: foreignId, action: "APPROVED" }))).status).toBe(404);
  authState.notify.mockClear();
  const decide = () => decision(req("/approve", "POST", { id: createdRow.id, action: "APPROVED" }));
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  const gate = { requestId: createdRow.id, waiting: 0, pids: [] as number[], promise, release };
  authState.gate = gate;
  let results: Response[];
  try { results = await Promise.all([decide(), decide()]); }
  finally { authState.gate = null; }
  expect(new Set(gate.pids).size).toBe(2);
  expect(gate.waiting).toBe(2);
  expect(results.map(response => response.status).sort()).toEqual([200, 409]);
  expect(authState.notify).toHaveBeenCalledTimes(1);
  const stored = (await fixture!.owner.execute(sql`SELECT status,approved_by FROM vacation_requests WHERE id=${createdRow.id}`)).rows[0];
  expect(stored).toEqual({ status: "APPROVED", approved_by: s.ids.manager });
  authState.user = s.actor("worker", "EMPLEADO");
  expect((await routes.DELETE(req(`?id=${createdRow.id}`, "DELETE"))).status).toBe(200);
  expect((await routes.DELETE(req(`?id=${createdRow.id}`, "DELETE"))).status).toBe(409);
}, 180_000);
