import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "@/lib/db/schema";
import { resolveVacationsForPeriod } from "@/lib/services/payroll-service";

const company = "aaaaaaaa-0000-4000-8000-000000000001";
const branch = "aaaaaaaa-0000-4000-8000-000000000011";
const stream1 = "aaaaaaaa-0000-4000-8000-000000000201";
const stream2 = "aaaaaaaa-0000-4000-8000-000000000202";
const vacReq1 = "aaaaaaaa-0000-4000-8000-000000000301";
const leaveReq1 = "aaaaaaaa-0000-4000-8000-000000000302";
const vacType = "aaaaaaaa-0000-4000-8000-000000000021";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema });
  await pg.exec(`
    CREATE TABLE companies (id uuid PRIMARY KEY, name text);
    CREATE TABLE branches (id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES companies(id));
    CREATE TABLE users (id text PRIMARY KEY, company_id uuid REFERENCES companies(id), branch_id uuid REFERENCES branches(id), role text, deleted_at timestamp);
    CREATE TABLE leave_types (id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES companies(id), name text NOT NULL);
    CREATE TABLE vacation_accruals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL, company_id uuid NOT NULL, year integer NOT NULL, days_balance integer NOT NULL, period_start timestamp NOT NULL);
    CREATE TABLE leave_balances (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL, leave_type_id uuid NOT NULL REFERENCES leave_types(id), year integer NOT NULL, total_entitlement integer NOT NULL, used integer DEFAULT 0, pending integer DEFAULT 0, balance integer NOT NULL);
    CREATE TABLE vacation_requests (id uuid PRIMARY KEY, company_id uuid, user_id text, branch_id uuid, start_date timestamp, end_date timestamp, total_days integer, status text, approved_by text, approved_at timestamp, cancelled_at timestamp);
    CREATE TABLE leave_requests (id uuid PRIMARY KEY, company_id uuid, user_id text, branch_id uuid, leave_type_id uuid REFERENCES leave_types(id), start_date timestamp, end_date timestamp, total_days integer, status text, approved_by text, approved_at timestamp);
  `);
  const sqlText = readFileSync("drizzle/0164_nom02c1_vacation_history.sql", "utf8");
  for (const statement of sqlText.split("--> statement-breakpoint").filter(part => part.trim())) {
    await pg.exec(statement);
  }
});

beforeEach(async () => {
  await pg.exec(`
    ALTER TABLE vacation_history_events DISABLE TRIGGER vacation_history_event_no_truncate;
    ALTER TABLE vacation_history_streams DISABLE TRIGGER vacation_history_stream_no_truncate;
    TRUNCATE vacation_history_events, vacation_history_streams, vacation_requests, leave_requests, vacation_accruals, leave_balances, leave_types, users, branches, companies CASCADE;
    ALTER TABLE vacation_history_events ENABLE TRIGGER vacation_history_event_no_truncate;
    ALTER TABLE vacation_history_streams ENABLE TRIGGER vacation_history_stream_no_truncate;
  `);
  await pg.query("INSERT INTO companies VALUES ($1,'A')", [company]);
  await pg.query("INSERT INTO branches VALUES ($1,$2)", [branch, company]);
  await pg.query("INSERT INTO users VALUES ('admin',$1,$2,'ADMIN',null),('worker',$1,$2,'EMPLEADO',null)", [company, branch]);
  await pg.query("INSERT INTO leave_types VALUES ($1,$2,'VACATION')", [vacType, company]);
  // Saldos mutables generosos: el lector verificado NUNCA debe hacer fallback a ellos
  await pg.query("INSERT INTO vacation_accruals (user_id,company_id,year,days_balance,period_start) VALUES ('worker',$1,2026,25,'2026-01-01T00:00:00Z')", [company]);
  await pg.query("INSERT INTO leave_balances (user_id,leave_type_id,year,total_entitlement,used,pending,balance) VALUES ('worker',$1,2026,25,0,0,25)", [vacType]);
});

afterAll(async () => {
  await pg.close();
});

it("no hace fallback a saldos mutables cuando falta apertura verificada o cobertura incompleta", async () => {
  const missing = await resolveVacationsForPeriod({
    userId: "worker",
    companyId: company,
    startDate: "2026-05-01",
    endDate: "2026-05-15",
    dailySalaryCents: 100_000,
    useVerifiedHistory: true,
    historyActorId: "admin",
    dbInstance: db,
  });
  expect(missing.vacationSource).toBe("VERIFIED_HISTORY");
  expect(missing.vacationBalanceStatus).toBe("MISSING");
  expect(missing.historyReason).toBe("NO_COVERAGE");
  expect(missing.vacationPrimeCents).toBe(0);
  expect(missing.vacationAvailableBalance).toBe(0);

  // Abrir cobertura solo hasta abril -> mayo sigue MISSING (INCOMPLETE_COVERAGE)
  await pg.exec(`
    SELECT set_config('app.current_company_id','${company}',true), set_config('app.current_actor_id','admin',true);
    INSERT INTO vacation_history_streams (id,company_id,user_id,coverage_from,coverage_through,source_reference,reason,actor_id,idempotency_key)
    VALUES ('${stream1}','${company}','worker','2026-01-01','2026-04-30','src-open','Apertura parcial','admin','open-partial');
  `);
  const partial = await resolveVacationsForPeriod({
    userId: "worker",
    companyId: company,
    startDate: "2026-05-01",
    endDate: "2026-05-15",
    dailySalaryCents: 100_000,
    useVerifiedHistory: true,
    historyActorId: "admin",
    dbInstance: db,
  });
  expect(partial.vacationBalanceStatus).toBe("MISSING");
  expect(partial.historyReason).toBe("INCOMPLETE_COVERAGE");
  expect(partial.vacationPrimeCents).toBe(0);
});

it("calcula prima desde historia al corte y el replay del manifiesto conserva el resultado tras eventos o sucesores posteriores", async () => {
  await pg.query(
    `INSERT INTO vacation_requests (id,company_id,user_id,branch_id,start_date,end_date,total_days,status,approved_by,approved_at)
     VALUES ($1,$2,'worker',$3,'2026-05-05T00:00:00Z','2026-05-07T00:00:00Z',3,'APPROVED','admin',now())`,
    [vacReq1, company, branch],
  );
  await pg.exec(`
    SELECT set_config('app.current_company_id','${company}',true), set_config('app.current_actor_id','admin',true);
    INSERT INTO vacation_history_streams (id,company_id,user_id,coverage_from,coverage_through,source_reference,reason,actor_id,idempotency_key)
    VALUES ('${stream1}','${company}','worker','2026-01-01','2026-12-31','src-open','Apertura 2026','admin','open-1');
    INSERT INTO vacation_history_events (stream_id,company_id,user_id,kind,valid_from,valid_through,days,source_reference,reason,actor_id,idempotency_key)
    VALUES ('${stream1}','${company}','worker','GRANT','2026-01-01','2026-12-31',2,'src-grant','Crédito 2 días','admin','grant-1');
    INSERT INTO vacation_history_events (stream_id,company_id,user_id,kind,valid_from,valid_through,days,vacation_request_id,source_reference,reason,actor_id,idempotency_key)
    VALUES ('${stream1}','${company}','worker','APPROVE_REQUEST','2026-05-05','2026-05-07',3,'${vacReq1}','vac-1','Aprobado','admin','approve-1');
  `);

  const first = await resolveVacationsForPeriod({
    userId: "worker",
    companyId: company,
    startDate: "2026-05-01",
    endDate: "2026-05-15",
    dailySalaryCents: 100_000,
    useVerifiedHistory: true,
    historyActorId: "admin",
    dbInstance: db,
  });
  expect(first.vacationSource).toBe("VERIFIED_HISTORY");
  expect(first.vacationBalanceStatus).toBe("AVAILABLE");
  expect(first.vacationDaysTaken).toBe(3);
  expect(first.vacationDaysEligible).toBe(2);
  expect(first.vacationDaysExceeded).toBe(1);
  expect(first.vacationBasePayCents).toBe(200_000);
  expect(first.vacationPrimeCents).toBe(50_000);
  expect(first.justification).toBe("EXCEEDED_VACATION_BALANCE");
  expect(first.historyManifest?.streamId).toBe(stream1);

  // Después del corte: se otorga otro crédito y se abre un stream sucesor con 10 días
  await pg.exec(`
    SELECT set_config('app.current_company_id','${company}',true), set_config('app.current_actor_id','admin',true);
    INSERT INTO vacation_history_events (stream_id,company_id,user_id,kind,valid_from,valid_through,days,source_reference,reason,actor_id,idempotency_key)
    VALUES ('${stream1}','${company}','worker','GRANT','2026-01-01','2026-12-31',5,'src-grant-late','Crédito tardío','admin','grant-late');
    INSERT INTO vacation_history_streams (id,company_id,user_id,predecessor_id,coverage_from,coverage_through,source_reference,reason,actor_id,idempotency_key)
    VALUES ('${stream2}','${company}','worker','${stream1}','2026-01-01','2026-12-31','src-succ','Corrección de apertura','admin','open-2');
    INSERT INTO vacation_history_events (stream_id,company_id,user_id,kind,valid_from,valid_through,days,source_reference,reason,actor_id,idempotency_key)
    VALUES ('${stream2}','${company}','worker','GRANT','2026-01-01','2026-12-31',10,'src-grant-2','Crédito sucesor','admin','grant-succ');
  `);

  // Replay del manifiesto anterior devuelve EXACTAMENTE el mismo resultado
  const replayed = await resolveVacationsForPeriod({
    userId: "worker",
    companyId: company,
    startDate: "2026-05-01",
    endDate: "2026-05-15",
    dailySalaryCents: 100_000,
    useVerifiedHistory: true,
    historyActorId: "admin",
    historyCutoff: {
      knownAt: first.historyManifest!.knownAt,
      throughVersion: first.historyManifest!.throughVersion,
    },
    dbInstance: db,
  });
  expect(replayed.vacationDaysEligible).toBe(2);
  expect(replayed.vacationPrimeCents).toBe(50_000);
  expect(replayed.historyManifest?.streamId).toBe(stream1);

  // Nueva consulta al corte actual selecciona stream2
  const current = await resolveVacationsForPeriod({
    userId: "worker",
    companyId: company,
    startDate: "2026-05-01",
    endDate: "2026-05-15",
    dailySalaryCents: 100_000,
    useVerifiedHistory: true,
    historyActorId: "admin",
    dbInstance: db,
  });
  expect(current.historyManifest?.streamId).toBe(stream2);
  expect(current.vacationAvailableBalance).toBe(10);
});

it("reporta CONFLICT ante solicitudes solapadas entre vacation_requests y leave_requests sin emitir prima", async () => {
  await pg.query(
    `INSERT INTO vacation_requests (id,company_id,user_id,branch_id,start_date,end_date,total_days,status,approved_by,approved_at)
     VALUES ($1,$2,'worker',$3,'2026-05-05T00:00:00Z','2026-05-06T00:00:00Z',2,'APPROVED','admin',now())`,
    [vacReq1, company, branch],
  );
  await pg.query(
    `INSERT INTO leave_requests (id,company_id,user_id,branch_id,leave_type_id,start_date,end_date,total_days,status,approved_by,approved_at)
     VALUES ($1,$2,'worker',$3,$4,'2026-05-06T00:00:00Z','2026-05-07T00:00:00Z',2,'APPROVED','admin',now())`,
    [leaveReq1, company, branch, vacType],
  );
  await pg.exec(`
    SELECT set_config('app.current_company_id','${company}',true), set_config('app.current_actor_id','admin',true);
    INSERT INTO vacation_history_streams (id,company_id,user_id,coverage_from,coverage_through,source_reference,reason,actor_id,idempotency_key)
    VALUES ('${stream1}','${company}','worker','2026-01-01','2026-12-31','src-open','Apertura','admin','open-conflict');
    INSERT INTO vacation_history_events (stream_id,company_id,user_id,kind,valid_from,valid_through,days,source_reference,reason,actor_id,idempotency_key)
    VALUES ('${stream1}','${company}','worker','GRANT','2026-01-01','2026-12-31',12,'src-grant','Crédito','admin','grant-c');
    INSERT INTO vacation_history_events (stream_id,company_id,user_id,kind,valid_from,valid_through,days,vacation_request_id,source_reference,reason,actor_id,idempotency_key)
    VALUES ('${stream1}','${company}','worker','APPROVE_REQUEST','2026-05-05','2026-05-06',2,'${vacReq1}','vac-c','Aprobado vac','admin','app-vac');
    INSERT INTO vacation_history_events (stream_id,company_id,user_id,kind,valid_from,valid_through,days,leave_request_id,source_reference,reason,actor_id,idempotency_key)
    VALUES ('${stream1}','${company}','worker','APPROVE_REQUEST','2026-05-06','2026-05-07',2,'${leaveReq1}','leave-c','Aprobado leave','admin','app-leave');
  `);

  const conflict = await resolveVacationsForPeriod({
    userId: "worker",
    companyId: company,
    startDate: "2026-05-01",
    endDate: "2026-05-15",
    dailySalaryCents: 100_000,
    useVerifiedHistory: true,
    historyActorId: "admin",
    dbInstance: db,
  });
  expect(conflict.vacationBalanceStatus).toBe("CONFLICT");
  expect(conflict.justification).toBe("VACATION_HISTORY_CONFLICT");
  expect(conflict.historyReason).toBe("OVERLAPPING_REQUESTS");
  expect(conflict.vacationPrimeCents).toBe(0);
});

it("reporta QUERY_ERROR cuando falla la lectura de historia sin colapsar a cero verificado", async () => {
  const brokenDb = {
    transaction: async () => {
      throw new Error("synthetic db failure");
    },
  };
  const err = await resolveVacationsForPeriod({
    userId: "worker",
    companyId: company,
    startDate: "2026-05-01",
    endDate: "2026-05-15",
    dailySalaryCents: 100_000,
    useVerifiedHistory: true,
    historyActorId: "admin",
    dbInstance: brokenDb,
  });
  expect(err.vacationBalanceStatus).toBe("QUERY_ERROR");
  expect(err.vacationRequestsStatus).toBe("QUERY_ERROR");
  expect(err.vacationPrimeCents).toBe(0);
});
