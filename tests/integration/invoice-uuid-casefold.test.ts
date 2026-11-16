import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let pg: PGlite;
const upper = "ABCDEF00-0000-4000-8000-000000000001", lower = upper.toLowerCase();
const migration = () => readFileSync("drizzle/0153_invoice_uuid_casefold.sql", "utf8");
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec("create table invoices (id uuid primary key default gen_random_uuid(), uuid text not null unique, xml_content text)");
}, 30000);
afterAll(async () => { await pg?.close(); });
async function rollback(work: () => Promise<void>) {
  await pg.exec("begin"); try { await work(); } finally { await pg.exec("rollback"); }
}
describe("T07a: UUID fiscal único sin distinción de mayúsculas", () => {
  it("no actualiza ni borra documentos al añadir el índice", async () => rollback(async () => {
    const sql = migration(); expect(sql).not.toMatch(/\b(DROP|UPDATE|DELETE|TRUNCATE)\b/i);
    await pg.query("insert into invoices(uuid,xml_content) values ($1,'<historico/>')", [lower]);
    await pg.exec(sql);
    expect((await pg.query("select uuid,xml_content from invoices")).rows).toEqual([{ uuid: lower, xml_content: "<historico/>" }]);
  }));
  it("rechaza otra escritura del mismo UUID con distinta capitalización", async () => rollback(async () => {
    await pg.exec(migration());
    await pg.query("insert into invoices(uuid) values ($1)", [lower]);
    await expect(pg.query("insert into invoices(uuid) values ($1)", [upper])).rejects.toMatchObject({ code: "23505" });
  }));
  it("permite UUID diferentes y conserva el índice global anterior", async () => rollback(async () => {
    await pg.exec(migration());
    await pg.query("insert into invoices(uuid) values ($1),($2)", [upper, upper.replace(/1$/, "2")]);
    expect((await pg.query("select uuid from invoices")).rows).toHaveLength(2);
    expect((await pg.query("select indexname from pg_indexes where tablename='invoices'")).rows).toHaveLength(3);
  }));
  it("detiene la migración si hay duplicados históricos sin elegir ni modificar uno", async () => {
    await pg.query("insert into invoices(uuid) values ($1),($2)", [upper, lower]);
    await expect(pg.exec(migration())).rejects.toMatchObject({ code: "23505" });
    expect((await pg.query("select uuid from invoices")).rows).toHaveLength(2);
    expect((await pg.query("select indexname from pg_indexes where indexname='invoices_uuid_casefold_unique'")).rows).toHaveLength(0);
  });
});
