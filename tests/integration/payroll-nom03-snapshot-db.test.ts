import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { beforeAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { branches, companies, users } from "@/lib/db/schema";
import { setTenantContext } from "@/lib/db/tenant-context";
import { provisionRuntimeRole } from "./helpers/runtime-role";
import {
  approvePayrollSnapshot,
  buildPayrollSnapshotCsv,
  createPayrollDraftSnapshot,
  invalidatePayrollDraft,
  readApprovedPayrollSnapshot,
  type OrdinaryPayrollPayslipSnapshot,
} from "@/lib/services/payroll-snapshot-service";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Fixtures = { company: [string, string]; branch: [string, string]; user: [string, string] };

beforeAll(async () => {
  await provisionRuntimeRole(["companies", "branches", "users", "payroll_runs", "payroll_payslips"]);
});

function loadMigration0166(): string[] {
  return readFileSync("drizzle/0166_nom03_payroll_snapshot.sql", "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function runWith0166(
  check: (tx: Tx, f: Fixtures) => Promise<void>
) {
  const host = (url: string) => new URL(url).hostname.replace(/-pooler(?=\.)/, "");
  expect(host(process.env.TEST_DATABASE_URL!)).not.toBe(
    host(parse(readFileSync(".env")).DATABASE_URL)
  );

  const f: Fixtures = {
    company: [randomUUID(), randomUUID()],
    branch: [randomUUID(), randomUUID()],
    user: [`u-${randomUUID()}`, `u-${randomUUID()}`],
  };
  const rollback = new Error("NOM-03 snapshot rollback");
  const stmts = loadMigration0166();

  try {
    await db.transaction(async (tx) => {
      for (const stmt of stmts) {
        await tx.execute(sql.raw(stmt));
      }
      await tx.insert(companies).values(f.company.map((id) => ({ id, name: "Synthetic NOM-03" })));
      await tx.insert(branches).values(
        f.branch.map((id, i) => ({ id, companyId: f.company[i], name: "Synthetic branch" }))
      );
      await tx.insert(users).values(
        f.user.map((id, i) => ({
          id,
          name: `Emp ${i}`,
          email: `${id}@nom03.test`,
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
    employeeNumber: "EMP-100",
    employeeName: "Emp 0",
    rfc: "EMP0900101XXX",
    curp: "EMP0900101MDFRRL01",
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
    desglosePercepciones: [],
    desgloseDeducciones: [],
    completeness: { canApprove: true, canStamp: true, blockingIssues: [], zeroJustifications: [] },
  };
}

it("NOM-03 V2: aprobación congela snapshot, edición invalida borrador y carrera de versión falla con 409", async () => {
  await runWith0166(async (tx, f) => {
    const ruleVersions = {
      isrTableVersion: "RMF_2026_ANEXO_8_ART_96",
      imssRuleVersion: "LSS_2026_OBRERO_V1",
      umaDailyCents: 11_731,
    };

    // 1. Crear borrador v1 y simular edición concurrente que lo invalida (STALE, v2)
    const draft1 = await createPayrollDraftSnapshot(
      {
        companyId: f.company[0],
        periodStart: "2026-05-01",
        periodEnd: "2026-05-15",
        ruleVersions,
        payslips: [samplePayslip(f.user[0])],
      },
      tx
    );
    const inv = await invalidatePayrollDraft({ companyId: f.company[0], runId: draft1.runId }, tx);
    expect(inv).toEqual({ invalidated: true, newVersion: 2 });

    // Intentar aprobar versión obsoleta v1 falla con 409 Conflict
    await expect(
      approvePayrollSnapshot(
        {
          companyId: f.company[0],
          runId: draft1.runId,
          approvedBy: f.user[0],
          expectedVersion: 1,
          currentFingerprint: draft1.inputFingerprint,
        },
        tx
      )
    ).rejects.toMatchObject({ statusCode: 409 });

    // 2. Nuevo borrador limpio -> aprobar congela actor, fecha y versión
    const draft2 = await createPayrollDraftSnapshot(
      {
        companyId: f.company[0],
        periodStart: "2026-05-16",
        periodEnd: "2026-05-31",
        ruleVersions,
        payslips: [samplePayslip(f.user[0])],
      },
      tx
    );
    const approved = await approvePayrollSnapshot(
      {
        companyId: f.company[0],
        runId: draft2.runId,
        approvedBy: f.user[0],
        expectedVersion: draft2.snapshotVersion,
        currentFingerprint: draft2.inputFingerprint,
      },
      tx
    );
    expect(approved.status).toBe("APPROVED");
    expect(approved.snapshotVersion).toBe(2);
    expect(approved.approvedBy).toBe(f.user[0]);

    // Segunda aprobación concurrente sobre el mismo runId falla con 409
    await expect(
      approvePayrollSnapshot(
        {
          companyId: f.company[0],
          runId: draft2.runId,
          approvedBy: f.user[0],
          expectedVersion: 1,
          currentFingerprint: draft2.inputFingerprint,
        },
        tx
      )
    ).rejects.toMatchObject({ statusCode: 409 });

    // 3. NOM-04.a: lectura de recibo y exportación CSV coinciden y son idénticos al reexportar
    const bundle = await readApprovedPayrollSnapshot(f.company[0], draft2.runId, tx);
    expect(bundle.header.totals.totalNetoCents).toBe(658_500);
    const csv1 = buildPayrollSnapshotCsv(bundle);
    const csv2 = buildPayrollSnapshotCsv(await readApprovedPayrollSnapshot(f.company[0], draft2.runId, tx));
    expect(csv1).toBe(csv2);
    expect(csv1).toContain("6585.00");

    // 4. Aislamiento RLS: empresa 1 no puede leer snapshot de empresa 0
    await expect(readApprovedPayrollSnapshot(f.company[1], draft2.runId, tx)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
