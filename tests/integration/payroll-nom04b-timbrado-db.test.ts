import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { beforeAll, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { branches, cfdiNominaTimbrados, companies, payrollPayslips, users } from "@/lib/db/schema";
import { setTenantContext } from "@/lib/db/tenant-context";
import { provisionRuntimeRole } from "./helpers/runtime-role";
import {
  approvePayrollSnapshot,
  createPayrollDraftSnapshot,
  stampApprovedPayrollSnapshot,
  type OrdinaryPayrollPayslipSnapshot,
} from "@/lib/services/payroll-snapshot-service";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Fixtures = { company: [string, string]; branch: [string, string]; user: [string, string] };

beforeAll(async () => {
  await provisionRuntimeRole([
    "companies",
    "branches",
    "users",
    "payroll_runs",
    "payroll_payslips",
    "cfdi_nomina_timbrados",
  ]);
});

function loadMigration0166(): string[] {
  return readFileSync("drizzle/0166_nom03_payroll_snapshot.sql", "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function runIsolated(check: (tx: Tx, f: Fixtures) => Promise<void>) {
  const host = (url: string) => new URL(url).hostname.replace(/-pooler(?=\.)/, "");
  expect(host(process.env.TEST_DATABASE_URL!)).not.toBe(
    host(parse(readFileSync(".env")).DATABASE_URL)
  );

  const f: Fixtures = {
    company: [randomUUID(), randomUUID()],
    branch: [randomUUID(), randomUUID()],
    user: [`u-${randomUUID()}`, `u-${randomUUID()}`],
  };
  const rollback = new Error("NOM-04.b timbrado rollback");
  const stmts = loadMigration0166();

  try {
    await db.transaction(async (tx) => {
      for (const stmt of stmts) {
        await tx.execute(sql.raw(stmt));
      }
      await tx.insert(companies).values(f.company.map((id) => ({ id, name: "Synthetic NOM-04b" })));
      await tx.insert(branches).values(
        f.branch.map((id, i) => ({ id, companyId: f.company[i], name: "Synthetic branch" }))
      );
      await tx.insert(users).values(
        f.user.map((id, i) => ({
          id,
          name: `Emp ${i}`,
          email: `${id}@nom04b.test`,
          createdAt: new Date(),
          updatedAt: new Date(),
          companyId: f.company[i],
        }))
      );

      await setTenantContext(tx, { companyId: f.company[0], branchId: f.branch[0] });
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      const role = (
        await tx.execute(sql`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`)
      ).rows[0];
      expect(role).toMatchObject({ rolbypassrls: false, rolsuper: false });

      await check(tx, f);
      throw rollback;
    });
  } catch (err) {
    if (err !== rollback) throw err;
  }

  for (const id of f.company) {
    expect(await db.select({ id: companies.id }).from(companies).where(eq(companies.id, id))).toEqual([]);
  }
}

function samplePayslip(userId: string): OrdinaryPayrollPayslipSnapshot {
  return {
    userId,
    employeeNumber: "EMP-401",
    employeeName: "Karina Fuentes",
    rfc: "FUNK671228PH6",
    curp: "FUNK671228MDFRRL01",
    nss: "12345678901",
    dailySalaryCents: 50_000,
    payableDays: 15,
    baseSalaryCents: 750_000,
    propinasCents: 0,
    holidayPayCents: 0,
    overtimePayCents: 0,
    vacationPrimeCents: 0,
    bonusesAndIncidencesCents: 0,
    isrRetenidoCents: 71_000,
    imssObreroCents: 20_500,
    loanDeductionsCents: 0,
    incidenceDeductionsCents: 0,
    totalPercepcionesCents: 750_000,
    totalDeduccionesCents: 91_500,
    netPayCents: 658_500,
    employerSocialSecurityCents: 215_000,
    desglosePercepciones: [
      {
        earningTypeCode: "001",
        code: "001",
        concept: "Sueldos, salarios, rayas y jornales",
        taxedAmount: 750_000,
        exemptAmount: 0,
      },
    ],
    desgloseDeducciones: [
      { deductionTypeCode: "002", code: "002", concept: "ISR retenido", amount: 71_000 },
      { deductionTypeCode: "001", code: "001", concept: "Seguridad social IMSS", amount: 20_500 },
    ],
    completeness: { canApprove: true, canStamp: true, blockingIssues: [], zeroJustifications: [] },
  };
}

it("NOM-04.b V2: rechazo, reintento exitoso, idempotencia sin doble folio y aislamiento RLS desde snapshot aprobado", async () => {
  const prevApiKey = process.env.FISCALAPI_API_KEY;
  process.env.FISCALAPI_API_KEY = prevApiKey || "test-sandbox-key";

  try {
    await runIsolated(async (tx, f) => {
      const ruleVersions = {
        isrTableVersion: "RMF_2026_ANEXO_8_ART_96",
        imssRuleVersion: "LSS_2026_OBRERO_V1",
        umaDailyCents: 11_731,
      };

      const draft = await createPayrollDraftSnapshot(
        {
          companyId: f.company[0],
          periodStart: "2026-06-01",
          periodEnd: "2026-06-15",
          ruleVersions,
          payslips: [samplePayslip(f.user[0])],
        },
        tx
      );

      // No se puede timbrar un borrador sin aprobar (409)
      await expect(
        stampApprovedPayrollSnapshot(
          { companyId: f.company[0], runId: draft.runId, performedBy: f.user[0] },
          { dbInstance: tx }
        )
      ).rejects.toMatchObject({ statusCode: 409 });

      await approvePayrollSnapshot(
        {
          companyId: f.company[0],
          runId: draft.runId,
          approvedBy: f.user[0],
          expectedVersion: draft.snapshotVersion,
          currentFingerprint: draft.inputFingerprint,
        },
        tx
      );

      // 1. Rechazo controlado del PAC (succeeded=false) -> guarda RECHAZADO sin UUID
      let pacCalls = 0;
      const rejectFetch = (async () => {
        pacCalls++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            succeeded: false,
            message: "NOM108: Error de validación de prueba en sandbox",
            details: { code: "NOM108" },
          }),
          text: async () => "NOM108",
        } as unknown as Response;
      }) as typeof fetch;

      const rejected = await stampApprovedPayrollSnapshot(
        { companyId: f.company[0], runId: draft.runId, performedBy: f.user[0] },
        { dbInstance: tx, fetchImpl: rejectFetch }
      );
      expect(pacCalls).toBe(1);
      expect(rejected.results[0].status).toBe("RECHAZADO");
      expect(rejected.results[0].uuid).toBe("");

      const [payslipAfterReject] = await tx
        .select({ cfdiUuid: payrollPayslips.cfdiUuid, cfdiStatus: payrollPayslips.cfdiStatus })
        .from(payrollPayslips)
        .where(and(eq(payrollPayslips.runId, draft.runId), eq(payrollPayslips.userId, f.user[0])));
      expect(payslipAfterReject).toEqual({ cfdiUuid: null, cfdiStatus: "RECHAZADO" });

      // 2. Reintento tras rechazo -> PAC responde TIMBRADO con UUID y sello
      const expectedUuid = "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE";
      const okFetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
        pacCalls++;
        const sent = JSON.parse(String(init?.body ?? "{}"));
        // Verifica que el payload enviado al PAC trae exactamente el desglose del snapshot
        expect(sent.complement.payroll.earnings.earnings[0].taxedAmount).toBe(7500);
        expect(sent.complement.payroll.deductions).toHaveLength(2);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            succeeded: true,
            data: {
              id: "inv-nom04b-1",
              uuid: expectedUuid,
              total: 6585,
              seal: "SELLO-NOM04B-OK",
              fechaTimbrado: "2026-06-16T12:00:00.000Z",
            },
          }),
          text: async () => "",
        } as unknown as Response;
      }) as typeof fetch;

      const stamped = await stampApprovedPayrollSnapshot(
        { companyId: f.company[0], runId: draft.runId, performedBy: f.user[0] },
        { dbInstance: tx, fetchImpl: okFetch }
      );
      expect(pacCalls).toBe(2);
      expect(stamped.results[0].status).toBe("TIMBRADO");
      expect(stamped.results[0].uuid).toBe(expectedUuid);
      expect(stamped.results[0].selloDigital).toBe("SELLO-NOM04B-OK");

      const [payslipAfterStamp] = await tx
        .select({
          cfdiUuid: payrollPayslips.cfdiUuid,
          cfdiStatus: payrollPayslips.cfdiStatus,
          selloDigital: payrollPayslips.selloDigital,
        })
        .from(payrollPayslips)
        .where(and(eq(payrollPayslips.runId, draft.runId), eq(payrollPayslips.userId, f.user[0])));
      expect(payslipAfterStamp).toEqual({
        cfdiUuid: expectedUuid,
        cfdiStatus: "TIMBRADO",
        selloDigital: "SELLO-NOM04B-OK",
      });

      // 3. Reintento idempotente sobre TIMBRADO -> 0 llamadas nuevas al PAC, mismo UUID
      const neverCallPac = (async () => {
        pacCalls++;
        throw new Error("No debió contactar al PAC en reintento idempotente");
      }) as unknown as typeof fetch;

      const retried = await stampApprovedPayrollSnapshot(
        { companyId: f.company[0], runId: draft.runId, performedBy: f.user[0] },
        { dbInstance: tx, fetchImpl: neverCallPac }
      );
      expect(pacCalls).toBe(2);
      expect(retried.results[0].status).toBe("TIMBRADO");
      expect(retried.results[0].uuid).toBe(expectedUuid);

      const timbrados = await tx
        .select({ uuid: cfdiNominaTimbrados.uuid, status: cfdiNominaTimbrados.status })
        .from(cfdiNominaTimbrados)
        .where(
          and(
            eq(cfdiNominaTimbrados.companyId, f.company[0]),
            eq(cfdiNominaTimbrados.empleadoRfc, "FUNK671228PH6")
          )
        );
      expect(timbrados).toEqual([{ uuid: expectedUuid, status: "TIMBRADO" }]);

      // 4. Aislamiento RLS: empresa 1 no puede timbrar corrida de empresa 0
      await expect(
        stampApprovedPayrollSnapshot(
          { companyId: f.company[1], runId: draft.runId, performedBy: f.user[1] },
          { dbInstance: tx, fetchImpl: neverCallPac }
        )
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  } finally {
    if (prevApiKey === undefined) {
      delete process.env.FISCALAPI_API_KEY;
    } else {
      process.env.FISCALAPI_API_KEY = prevApiKey;
    }
  }
});
