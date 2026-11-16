import { readFileSync } from "node:fs";
import { PgDialect, getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { SQL } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

export const cfdiTables = [schema.invoices, schema.operatingExpenses, schema.payees, schema.suppliers,
  schema.companies, schema.branches, schema.costCenters, schema.expenseAuthorizationRules,
  schema.branchBudgets, schema.serviceOrders, schema.purchaseOrders, schema.pettyCashFunds, schema.pettyCashTransactions,
  schema.paymentRuns, schema.paymentRunItems, schema.expensePayments, schema.accountingJournals,
  schema.accountingPurchaseFacts, schema.financialPeriods, schema.inventoryAuditLog, schema.users];
/** Tablas descartables; aplica de verdad 0151/0153, sin tocar el esquema público de Neon. */
export async function createCfdiFixture(exec: (sql: string) => Promise<unknown>, namespace = "public") {
  if (!/^(public|ocfdi_[a-f0-9]{32})$/.test(namespace)) throw new Error("Namespace de pruebas inválido");
  const additive = new Set(["payee_id", "destination", "classified_at", "classified_by", "classification_reason", "classification_source"]);
  const dialect = new PgDialect();
  for (const table of cfdiTables) {
    const config = getTableConfig(table as PgTable);
    const columns = config.columns.filter(c => config.name !== "invoices" || !additive.has(c.name)).map(c => {
      const raw = c.getSQLType(), type = /^(uuid|text|integer|bigint|boolean|jsonb|date|timestamp|numeric|varchar|real|double)/.test(raw) ? raw : "text";
      const d = c.default, value = d instanceof SQL ? dialect.sqlToQuery(d).sql : typeof d === "string" ? `'${d.replaceAll("'", "''")}'` : String(d);
      return `"${c.name}" ${type}${d === undefined ? "" : ` default ${value}`}${c.notNull ? " not null" : ""}${c.primary ? " primary key" : ""}`;
    });
    await exec(`create table "${config.name}" (${columns.join(",")})`);
  }
  await exec("create unique index invoices_uuid_unique on invoices(uuid)");
  for (const file of ["0151_invoice_destination", "0153_invoice_uuid_casefold"]) {
    const sql = readFileSync(`drizzle/${file}.sql`, "utf8").replaceAll('"public".', `"${namespace}".`)
      .replaceAll("public.", `"${namespace}".`).replaceAll("pg_catalog, public", `pg_catalog, "${namespace}"`);
    for (const part of sql.split("--> statement-breakpoint")) if (part.trim()) await exec(part);
  }
}
export const fixtureXml = `<c:Comprobante xmlns:c="http://www.sat.gob.mx/cfd/4" xmlns:t="http://www.sat.gob.mx/TimbreFiscalDigital"
 Version="4.0" TipoDeComprobante="I" Fecha="2026-11-16T12:00:00" SubTotal="1000.01" Total="1160.01" Moneda="MXN" Sello="synthetic">
 <c:Emisor Rfc="AAA010101AAA" Nombre="Servicios"/><c:Receptor Rfc="BBB010101BBB" Nombre="Empresa"/>
 <c:Conceptos><c:Concepto ClaveProdServ="81101700" Cantidad="1" ClaveUnidad="E48" Descripcion="Mantenimiento" ValorUnitario="1000.01" Importe="1000.01" ObjetoImp="02">
 <c:Impuestos><c:Traslados><c:Traslado Base="1000.01" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="160.00"/></c:Traslados></c:Impuestos></c:Concepto></c:Conceptos>
 <c:Impuestos TotalImpuestosTrasladados="160.00"><c:Traslados><c:Traslado Base="1000.01" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="160.00"/></c:Traslados></c:Impuestos>
 <c:Complemento><t:TimbreFiscalDigital Version="1.1" UUID="ABCDEF00-0000-4000-8000-000000000001" FechaTimbrado="2026-11-16T12:01:00"
 RfcProvCertif="AAA010101AAA" NoCertificadoSAT="00000000000000000001" SelloCFD="synthetic" SelloSAT="synthetic"/></c:Complemento>
</c:Comprobante>`;
export const cfdiId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
