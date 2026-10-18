import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { branches, companies, receivingReportItems, receivingReports, users } from "@/lib/db/schema";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { RUNTIME_ROLE, provisionRuntimeRole, runtimeUrl } from "./helpers/runtime-role";

/**
 * SEC-05.recepcion (Fase 2) — RLS por lote sobre el dominio de recepción contra
 * base Postgres real.
 *
 * Cubre una raíz con `company_id` (`receiving_reports`) y su hija SIN
 * `company_id` (`receiving_report_items`), aislada vía el reporte padre:
 * (1) dos empresas no ven reportes ni líneas ajenas, incluso filtrando por el
 *     id de la otra;
 * (2) sin contexto el rol runtime no ve ni escribe (rechazo por defecto);
 * (3) con contexto, el dominio sigue operando (alta de reporte + línea) y una
 *     línea que apunta a un reporte ajeno se rechaza.
 *
 * El servicio `processReceiving` fija el contexto con `withCompanyContext`; su
 * ejecución contra el rol runtime en un entorno desplegado es un paso operativo
 * (igual que la provisión de `pulso_app`).
 */

neonConfig.webSocketConstructor = ws;

const BATCH_TABLES = ["receiving_reports", "receiving_report_items"];

type Tenant = { companyId: string; branchId: string; userId: string };

async function seedTenant(label: string): Promise<Tenant> {
  const companyId = randomUUID();
  const branchId = randomUUID();
  const userId = randomUUID();

  await db.insert(companies).values({ id: companyId, name: `RCV-RLS ${label} ${companyId.slice(0, 8)}` });
  await db.insert(branches).values({ id: branchId, companyId, name: `Sucursal ${label}` });
  await db.insert(users).values({
    id: userId,
    name: `Usuario ${label}`,
    email: `${userId}@rcvrls.test`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    companyId,
    branchId,
    role: "ADMIN",
  });

  return { companyId, branchId, userId };
}

async function insertReport(t: Tenant, notes: string) {
  const [report] = await db
    .insert(receivingReports)
    .values({ companyId: t.companyId, branchId: t.branchId, receivedBy: t.userId, notes })
    .returning();
  return report;
}

async function insertItem(reportId: string, quantity: number) {
  const [item] = await db
    .insert(receivingReportItems)
    .values({ receivingReportId: reportId, itemId: randomUUID(), receivedQuantity: quantity })
    .returning();
  return item;
}

const runtimePool = new Pool({ connectionString: runtimeUrl(), max: 1, allowExitOnIdle: true });
const runtime = drizzle(runtimePool, { schema });

describe("SEC-05.recepcion sobre base real: RLS de recepción y su tabla hija", () => {
  let a: Tenant;
  let b: Tenant;
  let reportA: Awaited<ReturnType<typeof insertReport>>;
  let reportB: Awaited<ReturnType<typeof insertReport>>;

  beforeEach(async () => {
    await provisionRuntimeRole(BATCH_TABLES);
    a = await seedTenant("A");
    b = await seedTenant("B");
    reportA = await insertReport(a, "recepción A");
    reportB = await insertReport(b, "recepción B");
    await insertItem(reportA.id, 10);
    await insertItem(reportB.id, 20);
  }, 60_000);

  afterAll(async () => {
    await runtimePool.end();
  });

  it("la política está activa en raíz e hija y el rol runtime no tiene bypass", async () => {
    const [{ relrowsecurity }] = (
      await db.execute(
        sql`SELECT bool_and(relrowsecurity) AS relrowsecurity FROM pg_class WHERE relname IN ('receiving_reports','receiving_report_items')`,
      )
    ).rows as Array<{ relrowsecurity: boolean }>;
    expect(relrowsecurity).toBe(true);

    const [{ rolbypassrls, rolsuper }] = (
      await db.execute(
        sql`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = ${RUNTIME_ROLE}`,
      )
    ).rows as Array<{ rolbypassrls: boolean; rolsuper: boolean }>;
    expect(rolbypassrls).toBe(false);
    expect(rolsuper).toBe(false);
  }, 60_000);

  it("cada empresa ve sólo su reporte y sus líneas; filtrar por el id ajeno no filtra nada", async () => {
    const seenA = await withCompanyContext(
      { companyId: a.companyId },
      (tx) => tx.select({ id: receivingReports.id }).from(receivingReports),
      runtime,
    );
    const seenB = await withCompanyContext(
      { companyId: b.companyId },
      (tx) => tx.select({ id: receivingReports.id }).from(receivingReports),
      runtime,
    );
    expect(seenA.map((r) => r.id)).toEqual([reportA.id]);
    expect(seenB.map((r) => r.id)).toEqual([reportB.id]);

    // La hija sin `company_id` se acota por el padre: el filtro explícito por el
    // reporte ajeno devuelve 0.
    const crossItems = await withCompanyContext(
      { companyId: a.companyId },
      (tx) =>
        tx
          .select({ id: receivingReportItems.id })
          .from(receivingReportItems)
          .where(eq(receivingReportItems.receivingReportId, reportB.id)),
      runtime,
    );
    expect(crossItems).toHaveLength(0);

    const ownItems = await withCompanyContext(
      { companyId: a.companyId },
      (tx) =>
        tx
          .select({ id: receivingReportItems.id })
          .from(receivingReportItems)
          .where(eq(receivingReportItems.receivingReportId, reportA.id)),
      runtime,
    );
    expect(ownItems).toHaveLength(1);
  }, 60_000);

  it("sin contexto, el rol runtime no ve ni escribe en raíz ni en hija", async () => {
    const visibleReports = await runtime.select({ id: receivingReports.id }).from(receivingReports);
    expect(visibleReports).toHaveLength(0);
    const visibleItems = await runtime
      .select({ id: receivingReportItems.id })
      .from(receivingReportItems);
    expect(visibleItems).toHaveLength(0);

    await expect(
      runtime.insert(receivingReports).values({
        companyId: a.companyId,
        branchId: a.branchId,
        receivedBy: a.userId,
      }),
    ).rejects.toBeTruthy();

    await expect(
      runtime.insert(receivingReportItems).values({
        receivingReportId: reportA.id,
        itemId: randomUUID(),
        receivedQuantity: 1,
      }),
    ).rejects.toBeTruthy();
  }, 60_000);

  it("con contexto, el dominio opera y una línea que apunta a un reporte ajeno se rechaza", async () => {
    const newReport = await withCompanyContext(
      { companyId: a.companyId, branchId: a.branchId, actorId: a.userId },
      async (tx) => {
        const [report] = await tx
          .insert(receivingReports)
          .values({ companyId: a.companyId, branchId: a.branchId, receivedBy: a.userId })
          .returning();
        await tx
          .insert(receivingReportItems)
          .values({ receivingReportId: report.id, itemId: randomUUID(), receivedQuantity: 5 });
        return report;
      },
      runtime,
    );

    const created = await withCompanyContext(
      { companyId: a.companyId },
      (tx) =>
        tx
          .select({ id: receivingReportItems.id })
          .from(receivingReportItems)
          .where(eq(receivingReportItems.receivingReportId, newReport.id)),
      runtime,
    );
    expect(created).toHaveLength(1);

    // Línea apuntando al reporte de la OTRA empresa: WITH CHECK la rechaza.
    await expect(
      withCompanyContext(
        { companyId: a.companyId, branchId: a.branchId },
        (tx) =>
          tx.insert(receivingReportItems).values({
            receivingReportId: reportB.id,
            itemId: randomUUID(),
            receivedQuantity: 1,
          }),
        runtime,
      ),
    ).rejects.toBeTruthy();
  }, 60_000);
});
