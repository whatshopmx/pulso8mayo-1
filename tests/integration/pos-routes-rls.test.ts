import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { beforeAll, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";

// Solo sesión y R2 son dobles. Cada consulta usa Postgres real como pulso_app.
const fixture = vi.hoisted(() => ({ tx: null as unknown,
  auth: { tenantId: "", user: { id: "synthetic-pos-actor", companyId: "", branchId: "", role: "GERENTE" } },
  sign: vi.fn(async () => "https://signed.example/pos.csv"),
}));
vi.mock("@/lib/db", async original => {
  const actual = await original<typeof import("@/lib/db")>();
  return { db: new Proxy(actual.db, { get(target, key) {
    const source = fixture.tx ?? target, value = Reflect.get(source as object, key);
    return typeof value === "function" ? value.bind(source) : value;
  } }) };
});
vi.mock("@/lib/api/with-auth", async () => {
  const { ApiHandler } = await import("@/lib/api/response");
  return { withRoleAuth: (_roles: unknown, handler: (req: unknown, ctx: unknown) => Promise<Response>) =>
    async (req: unknown, ctx: object) => {
      try { return await handler(req, { ...ctx, auth: fixture.auth }); }
      catch (error) { return ApiHandler.error(error); }
    } };
});
vi.mock("@/lib/tenant-context", () => ({
  requireTenant: async () => ({ id: fixture.auth.tenantId }),
  requireAuth: async () => ({ user: fixture.auth.user }),
}));
vi.mock("@/lib/storage/r2-client", () => ({ generatePresignedUrl: fixture.sign, isR2Configured: () => false, uploadToR2: vi.fn() }));

import { db } from "@/lib/db";
import { companies, branches, dailySalesCuts } from "@/lib/db/schema";
import { GET } from "@/app/api/sales/cuts/[id]/pos-file/route";
import { POST } from "@/app/api/workflows/smart-links/upload-pos/route";

beforeAll(() => {
  const host = (value: string) => new URL(value).hostname.replace(/-pooler(?=\.)/, "");
  expect(host(process.env.TEST_DATABASE_URL!)).not.toBe(host(parse(readFileSync(".env")).DATABASE_URL));
});
async function probe(check: (ids: { cut: string; company: string; branch: string; key: string }) => Promise<void>) {
  const company = randomUUID(), branch = randomUUID(), cut = randomUUID();
  const key = `companies/${company}/branches/${branch}/pos/2026-11-17/1_evidence.csv`;
  const rollback = new Error("POS route RLS rollback");
  try {
    await db.transaction(async tx => {
      fixture.tx = tx;
      await tx.insert(companies).values({ id: company, name: "Synthetic POS route RLS company" });
      await tx.insert(branches).values({ id: branch, companyId: company, name: "Synthetic POS route RLS branch" });
      await tx.insert(dailySalesCuts).values({ id: cut, companyId: company, branchId: branch,
        businessDate: "2026-11-17", shift: "COMPLETO", channel: "TOTAL", source: "MANUAL_FORM", totalSales: 10000, rawFileUrl: key });
      await tx.execute(sql.raw(readFileSync("drizzle/0155_pos_storage_rls.sql", "utf8")));
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      await tx.execute(sql`select set_config('app.current_company_id','',true),set_config('app.current_branch_id','',true)`);
      const role = await tx.execute(sql`select current_user as name,rolbypassrls,rolsuper from pg_roles where rolname=current_user`);
      expect(role.rows).toEqual([{ name: "pulso_app", rolbypassrls: false, rolsuper: false }]);
      fixture.auth.tenantId = company;
      fixture.auth.user = { ...fixture.auth.user, companyId: company, branchId: branch };
      fixture.sign.mockClear();
      await check({ company, branch, cut, key });
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  finally {
    fixture.tx = null;
    expect(await db.select({ id: companies.id }).from(companies).where(eq(companies.id, company))).toEqual([]);
  }
}

it("lectura POS establece contexto antes de buscar y firmar bajo RLS", async () => {
  await probe(async ({ cut, key }) => {
    const response = await GET(new NextRequest(`http://localhost/api/sales/cuts/${cut}/pos-file`), { params: Promise.resolve({ id: cut }) });
    expect(response.status).toBe(200);
    expect(fixture.sign).toHaveBeenCalledWith(key, 600);
  });
});
it("vínculo POS establece contexto y devuelve solo columnas permitidas", async () => {
  await probe(async ({ branch, key }) => {
    const response = await POST(new NextRequest("http://localhost/api/workflows/smart-links/upload-pos", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ branchId: branch, businessDate: "2026-11-17", fileUrl: key }),
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).data.matchedCount).toBe(1);
  });
});

it("lectura POS no firma un corte fuera de la sucursal de la sesión", async () => {
  await probe(async ({ cut }) => {
    fixture.auth.user.branchId = randomUUID();
    const response = await GET(new NextRequest(`http://localhost/api/sales/cuts/${cut}/pos-file`), { params: Promise.resolve({ id: cut }) });
    expect(response.status).toBe(404);
    expect(fixture.sign).not.toHaveBeenCalled();
  });
});

it("lectura POS no firma un corte fuera de la empresa de la sesión", async () => {
  await probe(async ({ cut }) => {
    fixture.auth.tenantId = randomUUID();
    fixture.auth.user.companyId = fixture.auth.tenantId;
    const response = await GET(new NextRequest(`http://localhost/api/sales/cuts/${cut}/pos-file`), { params: Promise.resolve({ id: cut }) });
    expect(response.status).toBe(404);
    expect(fixture.sign).not.toHaveBeenCalled();
  });
});
