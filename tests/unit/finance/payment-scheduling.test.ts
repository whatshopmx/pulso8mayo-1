import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/error";
import { db } from "@/lib/db";
import {
  invoices, operatingExpenses, payrollRuns, payrollPayslips,
  paymentRuns, paymentRunItems, suppliers, supplierBankAccounts,
  branches, payees, payeeBankAccounts, pettyCashFunds,
} from "@/lib/db/schema";
import { TreasuryService } from "@/lib/services/treasury-service";
import { claveObligacion, puedeAgendar, retieneObligacion } from "@/lib/treasury/scheduling-policy";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { POST } from "@/app/api/finance/treasury/runs/[id]/items/route";

vi.mock("@/lib/db", () => ({ db: { query: {}, select: vi.fn(), insert: vi.fn(), update: vi.fn(), transaction: vi.fn() } }));
vi.mock("@/lib/security/employee-cipher", () => ({ decryptProfileRecords: vi.fn() }));
vi.mock("@/lib/rbac/abac", () => ({ requirePermissionApi: vi.fn() }));

type Row = Record<string, unknown>;
type Context = Record<string, Row>;
const tables = { invoices, operatingExpenses, payrollRuns, payrollPayslips, paymentRuns, paymentRunItems, suppliers, supplierBankAccounts, branches, payees, payeeBankAccounts, pettyCashFunds };
const dialect = new PgDialect();
const camel = (name: string) => name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

/**
 * Fixture local: el simulador compartido ignora joins y carece de cerrojos.
 * Conservamos tablas y SQL reales; sólo sustituimos el ejecutor de Drizzle.
 * Las transacciones NO se serializan: únicamente .for("update") adquiere el
 * mutex de cada documento, hasta terminar su transacción. Quitar ese bloqueo
 * del servicio permite que ambas altas concurrentes lean la obligación libre.
 */
function databaseFixture() {
  const rows: Record<string, Row[]> = Object.fromEntries(Object.values(tables).map(table => [getTableName(table), []]));
  const writes: Array<{ table: string; values: Row }> = [];
  const locks = new Map<string, Promise<void>>();
  const acquired: string[] = [];
  const controls: { beforeTransaction?: () => void; failUpdate?: boolean } = {};
  let sequence = 0;
  const data = (table: unknown) => rows[getTableName(table as never)];
  const valueOf = (context: Context, table: string, column: string) => context[table]?.[camel(column)];
  const acquire = async (key: string, releaseAtEnd?: Array<() => void>) => {
    if (!releaseAtEnd) throw new Error("El bloqueo exige una transacción");
    const previous = locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    locks.set(key, current);
    await previous;
    acquired.push(key);
    releaseAtEnd.push(() => { release(); if (locks.get(key) === current) locks.delete(key); });
  };

  const matches = (context: Context, where?: unknown) => {
    if (!where) return true;
    const { sql, params } = dialect.sqlToQuery(where as never);
    for (const match of sql.matchAll(/"([\w]+)"\."([\w]+)"\s*(=|<>|!=)\s*\$(\d+)/g)) {
      const actual = valueOf(context, match[1], match[2]);
      const expected = params[Number(match[4]) - 1];
      if (match[3] === "=" ? actual !== expected : actual === expected) return false;
    }
    for (const match of sql.matchAll(/"([\w]+)"\."([\w]+)"\s*(=|<>)\s*"([\w]+)"\."([\w]+)"/g)) {
      const equal = valueOf(context, match[1], match[2]) === valueOf(context, match[4], match[5]);
      if (match[3] === "=" ? !equal : equal) return false;
    }
    for (const match of sql.matchAll(/"([\w]+)"\."([\w]+)"\s+(not\s+)?in\s*\(([^)]+)\)/gi)) {
      const values = [...match[4].matchAll(/\$(\d+)/g)].map(parameter => params[Number(parameter[1]) - 1]);
      if (values.length === 0) throw new Error(`Filtro IN no soportado por fixture: ${sql}`);
      const included = values.includes(valueOf(context, match[1], match[2]) as never);
      if (match[3] ? included : !included) return false;
    }
    if (/\b(?:exists|select)\b/i.test(sql)) throw new Error(`Subconsulta no soportada por fixture: ${sql}`);
    return true;
  };

  const project = (context: Context, table: unknown, projection?: Row) => {
    if (!projection) return context[getTableName(table as never)];
    return Object.fromEntries(Object.entries(projection).map(([key, column]) => {
      if (Object.values(tables).includes(column as never)) return [key, context[getTableName(column as never)]];
      const selected = column as { table: unknown; name: string };
      return [key, valueOf(context, getTableName(selected.table as never), selected.name)];
    }));
  };

  const executor = (releaseAtEnd?: Array<() => void>, rollback?: Array<() => void>) => {
    const select = (projection?: Row) => ({ from: (table: unknown) => {
      let where: unknown;
      const joins: Array<{ table: unknown; on: unknown; left: boolean }> = [];
      const contexts = () => {
        let contexts: Context[] = data(table).map(row => ({ [getTableName(table as never)]: row }));
        for (const join of joins) {
          contexts = contexts.flatMap(context => {
            const joined = data(join.table).map(row => ({ ...context, [getTableName(join.table as never)]: row })).filter(context => matches(context, join.on));
            return joined.length || !join.left ? joined : [context];
          });
        }
        return contexts.filter(context => matches(context, where));
      };
      const results = () => contexts().map(context => project(context, table, projection));
      const chain = {
        where: (condition: unknown) => { where = condition; return chain; },
        innerJoin: (other: unknown, on: unknown) => { joins.push({ table: other, on, left: false }); return chain; },
        leftJoin: (other: unknown, on: unknown) => { joins.push({ table: other, on, left: true }); return chain; },
        orderBy: () => chain,
        limit: async (count: number) => results().slice(0, count),
        for: async (strength: string) => {
          if (strength !== "update" || !releaseAtEnd) throw new Error("El bloqueo exige una transacción y FOR UPDATE");
          for (const context of contexts()) {
            const key = `${getTableName(table as never)}:${context[getTableName(table as never)].id}`;
            await acquire(key, releaseAtEnd);
          }
          return results();
        },
        then: (resolve: (value: Row[]) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(results).then(resolve, reject),
      };
      return chain;
    } });
    const query = Object.fromEntries(Object.entries(tables).map(([name, table]) => [name, {
      findMany: async (args: { where?: unknown; columns?: Record<string, boolean> } = {}) => data(table)
        .filter(row => matches({ [getTableName(table)]: row }, args.where))
        .map(row => args.columns ? Object.fromEntries(Object.entries(row).filter(([key]) => args.columns?.[key])) : row),
      findFirst: async (args: { where?: unknown } = {}) => data(table).find(row => matches({ [getTableName(table)]: row }, args.where)),
    }]));
    return {
      query,
      select,
      execute: async (statement: unknown) => {
        const { sql, params } = dialect.sqlToQuery(statement as never);
        // El aislamiento RLS se verifica con PostgreSQL/runtime; este fixture
        // sólo reproduce los bloqueos y el rollback de programación.
        if (/set_config/i.test(sql)) return [];
        if (!/pg_advisory_xact_lock/i.test(sql)) throw new Error(`SQL execute no soportado: ${sql}`);
        await acquire(`advisory:${params.join(":")}`, releaseAtEnd);
        return [];
      },
      insert: (table: unknown) => ({ values: (values: Row) => ({ returning: async () => {
        const row = { id: `new-item-${++sequence}`, ...values };
        data(table).push(row);
        rollback?.push(() => { const index = data(table).indexOf(row); if (index !== -1) data(table).splice(index, 1); });
        writes.push({ table: getTableName(table as never), values });
        return [row];
      } }) }),
      update: (table: unknown) => ({ set: (values: Row) => ({ where: async (condition: unknown) => {
        if (controls.failUpdate) throw new Error("Fallo provocado al actualizar total");
        writes.push({ table: getTableName(table as never), values });
        for (const row of data(table).filter(row => matches({ [getTableName(table as never)]: row }, condition))) {
          const previous = { ...row };
          rollback?.push(() => { Object.keys(row).forEach(key => { delete row[key]; }); Object.assign(row, previous); });
          for (const [key, value] of Object.entries(values)) {
            if (value && typeof value === "object" && "queryChunks" in value) {
              const query = dialect.sqlToQuery(value as never);
              if (/\+\s*\$1/.test(query.sql)) row[key] = Number(row[key] ?? 0) + Number(query.params[0]);
              else throw new Error(`Actualización SQL no soportada: ${query.sql}`);
            } else row[key] = value;
          }
        }
      } }) }),
    };
  };
  Object.assign(db, executor(), { transaction: async (callback: (tx: ReturnType<typeof executor>) => Promise<unknown>) => {
    const releases: Array<() => void> = [];
    const rollback: Array<() => void> = [];
    controls.beforeTransaction?.();
    try { return await callback(executor(releases, rollback)); }
    catch (error) { rollback.reverse().forEach(undo => undo()); throw error; }
    finally { releases.reverse().forEach(release => release()); }
  } });

  data(paymentRuns).push({ id: "target", companyId: "company-a", title: "Nueva corrida", status: "DRAFT", totalAmountCents: 0 });
  data(invoices).push({ id: "invoice-a", companyId: "company-a", paymentStatus: "PENDING", matchStatus: "MATCHED", supplierId: "supplier-a", total: 12500 });
  data(suppliers).push({ id: "supplier-a", companyId: "company-a", name: "Proveedor" });
  data(supplierBankAccounts).push({ id: "bank-a", companyId: "company-a", supplierId: "supplier-a", status: "VERIFIED", active: true, clabeLast4: "1234" });
  return { data, writes, acquired, controls };
}

let fixture: ReturnType<typeof databaseFixture>;
const addInvoice = (paymentRunId = "target") => TreasuryService.addItemToRun({ companyId: "company-a", paymentRunId, itemType: "INVOICE", referenceId: "invoice-a", amountCents: 1 });
function retain(itemType = "INVOICE", referenceId = "invoice-a", status = "DRAFT", companyId = "company-a", id = "existing") {
  fixture.data(paymentRuns).push({ id, companyId, title: "Corrida anterior", status, totalAmountCents: 12500 });
  fixture.data(paymentRunItems).push({ id: "old-item", paymentRunId: id, itemType, referenceId, amountCents: 12500 });
}
async function rejected(action: Promise<unknown>, message: RegExp) {
  await expect(action).rejects.toMatchObject({ statusCode: 400, message });
  expect(fixture.writes).toEqual([]);
}
beforeEach(() => {
  vi.clearAllMocks();
  fixture = databaseFixture();
  vi.mocked(requirePermissionApi).mockReset();
  vi.mocked(requirePermissionApi).mockResolvedValue({ ctx: { userCompanyId: "company-a", userId: "actor-a" } } as never);
});

describe("C19: una obligación sólo se programa una vez", () => {
  it("acepta la factura pendiente y congela monto y cuenta autoritativos", async () => {
    const item = await addInvoice();
    expect(item).toMatchObject({ referenceId: "invoice-a", amountCents: 12500, bankAccountId: "bank-a", clabeLast4Snapshot: "1234" });
    expect(fixture.data(paymentRuns)[0].totalAmountCents).toBe(12500);
  });
  it.each(["PAID", "CANCELLED"])("rechaza una factura %s antes de escribir", async status => {
    fixture.data(invoices)[0].paymentStatus = status;
    await rejected(addInvoice(), status === "PAID" ? /pagada/i : /cancelada/i);
  });
  it("rechaza el duplicado dentro de la misma corrida", async () => {
    fixture.data(paymentRunItems).push({ id: "old-item", paymentRunId: "target", itemType: "INVOICE", referenceId: "invoice-a" });
    await rejected(addInvoice(), /esta corrida/i);
  });
  it.each(["DRAFT", "PENDING_APPROVAL", "APPROVED", "PROCESSING", "COMPLETED"])("rechaza una factura retenida por otra corrida %s", async status => {
    retain("INVOICE", "invoice-a", status);
    await rejected(addInvoice(), /Corrida anterior/i);
  });
  it("una corrida cancelada libera la factura", async () => {
    retain("INVOICE", "invoice-a", "CANCELLED");
    await expect(addInvoice()).resolves.toMatchObject({ referenceId: "invoice-a" });
  });
  it("una partida de otra empresa no bloquea el alta", async () => {
    retain("INVOICE", "invoice-a", "DRAFT", "company-b");
    await expect(addInvoice()).resolves.toMatchObject({ referenceId: "invoice-a" });
  });
  it("una factura propia no puede programarse contra un proveedor de otra empresa", async () => {
    fixture.data(suppliers)[0].companyId = "company-b";
    fixture.data(supplierBankAccounts)[0].companyId = "company-b";
    await expect(addInvoice()).rejects.toMatchObject({ statusCode: 404 });
    expect(fixture.writes).toEqual([]);
  });
  it("una cuenta verificada de otra empresa no habilita al proveedor propio", async () => {
    fixture.data(supplierBankAccounts)[0].companyId = "company-b";
    await rejected(addInvoice(), /cuenta bancaria CLABE verificada/i);
  });
  it("dos altas concurrentes en corridas diferentes sólo insertan una obligación", async () => {
    fixture.data(paymentRuns).push({ id: "target-two", companyId: "company-a", title: "Segunda corrida", status: "DRAFT", totalAmountCents: 0 });
    const results = await Promise.allSettled([addInvoice(), addInvoice("target-two")]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const failure = results.find(result => result.status === "rejected") as PromiseRejectedResult;
    expect(failure.reason).toBeInstanceOf(ApiError);
    expect(failure.reason.statusCode).toBe(400);
    expect(fixture.data(paymentRunItems)).toHaveLength(1);
    expect(fixture.data(paymentRuns).reduce((total, run) => total + Number(run.totalAmountCents), 0)).toBe(12500);
    expect(fixture.acquired.filter(key => key.startsWith("invoices:"))).toEqual(["invoices:invoice-a", "invoices:invoice-a"]);
  });
  it("rechaza si la corrida deja DRAFT antes de abrir la transacción", async () => {
    fixture.controls.beforeTransaction = () => { fixture.data(paymentRuns)[0].status = "CANCELLED"; };
    await rejected(addInvoice(), /DRAFT/i);
  });
  it("revierte la inserción si falla la actualización del total y libera los cerrojos", async () => {
    fixture.controls.failUpdate = true;
    await expect(addInvoice()).rejects.toThrow("Fallo provocado al actualizar total");
    expect(fixture.data(paymentRunItems)).toEqual([]);
    expect(fixture.data(paymentRuns)[0].totalAmountCents).toBe(0);
    fixture.controls.failUpdate = false;
    await expect(addInvoice()).resolves.toMatchObject({ referenceId: "invoice-a" });
    expect(fixture.data(paymentRunItems)).toHaveLength(1);
  });
  it("dos altas concurrentes de la misma nómina sólo insertan una partida", async () => {
    fixture.data(paymentRuns).push({ id: "target-two", companyId: "company-a", title: "Segunda corrida", status: "DRAFT", totalAmountCents: 0 });
    fixture.data(payrollRuns).push({ id: "payroll-a", companyId: "company-a", status: "CALCULATED" });
    fixture.data(payrollPayslips).push({ runId: "payroll-a", totalPercepcionesCents: 9300 });
    const add = (paymentRunId: string) => TreasuryService.addItemToRun({ companyId: "company-a", paymentRunId, itemType: "PAYROLL", referenceId: "payroll-a" });
    const results = await Promise.allSettled([add("target"), add("target-two")]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect((results.find(result => result.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(ApiError);
    expect(fixture.data(paymentRunItems)).toHaveLength(1);
    expect(fixture.data(paymentRunItems)[0].amountCents).toBe(9300);
    expect(fixture.acquired.filter(key => key.startsWith(`${getTableName(payrollRuns)}:`))).toHaveLength(2);
  });
  it("dos pagos de impuestos concurrentes con la misma referencia se serializan", async () => {
    fixture.data(paymentRuns).push({ id: "target-two", companyId: "company-a", title: "Segunda corrida", status: "DRAFT", totalAmountCents: 0 });
    const add = (paymentRunId: string) => TreasuryService.addItemToRun({ companyId: "company-a", paymentRunId, itemType: "TAXES", referenceId: "capture-line", amountCents: 5700, notes: "SAT línea de captura" });
    const results = await Promise.allSettled([add("target"), add("target-two")]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect((results.find(result => result.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(ApiError);
    expect(fixture.data(paymentRunItems)).toHaveLength(1);
    expect(fixture.acquired.filter(key => key.startsWith("advisory:"))).toEqual(["advisory:company-a:TAXES:capture-line", "advisory:company-a:TAXES:capture-line"]);
  });
  it.each(["DRAFT", "PENDING_APPROVAL", "APPROVED", "PROCESSING"])("una reposición de caja chica %s retiene el fondo", async status => {
    fixture.data(pettyCashFunds).push({ id: "fund-a", companyId: "company-a", active: true, fundAmount: 10000, currentBalance: 3000 });
    retain("PETTY_CASH_REIMBURSEMENT", "fund-a", status);
    await rejected(TreasuryService.addItemToRun({ companyId: "company-a", paymentRunId: "target", itemType: "PETTY_CASH_REIMBURSEMENT", referenceId: "fund-a" }), /Corrida anterior/i);
  });
  it.each(["COMPLETED", "CANCELLED"])("una reposición %s permite volver a reponer el fondo", async status => {
    fixture.data(pettyCashFunds).push({ id: "fund-a", companyId: "company-a", active: true, fundAmount: 10000, currentBalance: 3000 });
    retain("PETTY_CASH_REIMBURSEMENT", "fund-a", status);
    await expect(TreasuryService.addItemToRun({ companyId: "company-a", paymentRunId: "target", itemType: "PETTY_CASH_REIMBURSEMENT", referenceId: "fund-a" })).resolves.toMatchObject({ amountCents: 7000 });
  });
});

describe("C19: contraparte del gasto dentro de la empresa", () => {
  const addExpense = () => TreasuryService.addItemToRun({ companyId: "company-a", paymentRunId: "target", itemType: "OPERATING_EXPENSE", referenceId: "expense-a" });
  beforeEach(() => {
    fixture.data(operatingExpenses).push({ id: "expense-a", companyId: "company-a", status: "APPROVED", payeeId: "payee-a", amount: 4800 });
    fixture.data(payees).push({ id: "payee-a", companyId: "company-a", name: "Contraparte propia" });
    fixture.data(payeeBankAccounts).push({ id: "payee-bank-a", companyId: "company-a", payeeId: "payee-a", status: "VERIFIED", active: true, clabeLast4: "4321" });
  });
  it("conserva el monto y la cuenta verificada de la contraparte propia", async () => {
    await expect(addExpense()).resolves.toMatchObject({ amountCents: 4800, payeeBankAccountId: "payee-bank-a", clabeLast4Snapshot: "4321" });
    expect(fixture.data(paymentRuns)[0].totalAmountCents).toBe(4800);
  });
  it("rechaza una contraparte ajena aunque su cuenta declare la empresa propia", async () => {
    fixture.data(payees)[0].companyId = "company-b";
    await expect(addExpense()).rejects.toMatchObject({ statusCode: 404 });
    expect(fixture.writes).toEqual([]);
    expect(fixture.data(paymentRunItems)).toEqual([]);
    expect(fixture.data(paymentRuns)[0].totalAmountCents).toBe(0);
  });
  it("rechaza la cuenta ajena de una contraparte propia sin escribir partidas", async () => {
    fixture.data(payeeBankAccounts)[0].companyId = "company-b";
    await rejected(addExpense(), /cuenta bancaria CLABE verificada/i);
    expect(fixture.data(paymentRunItems)).toEqual([]);
    expect(fixture.data(paymentRuns)[0].totalAmountCents).toBe(0);
  });
});

describe("C19: política compartida de programación", () => {
  const retained = (status: string) => ({ id: "old", title: "Corrida anterior", status });
  it.each(["PAID", "CANCELLED"])("la factura %s prevalece sobre la existencia de otra corrida", status => {
    const verdict = puedeAgendar("INVOICE", { estadoDocumento: status, retenidasPor: [retained("DRAFT")] });
    expect(verdict.permitido).toBe(false);
    expect(verdict.motivo).toMatch(status === "PAID" ? /pagada/i : /cancelada/i);
  });
  it("rechaza un gasto pagado", () => {
    expect(puedeAgendar("OPERATING_EXPENSE", { estadoDocumento: "PAID" })).toMatchObject({ permitido: false, motivo: expect.stringMatching(/pagada/i) });
  });
  it("no vuelve a programar la misma obligación dentro de una corrida", () => {
    expect(puedeAgendar("INVOICE", { yaEnEstaCorrida: true })).toMatchObject({ permitido: false, motivo: expect.stringMatching(/esta corrida/i) });
  });
  it("cancelar libera una obligación pendiente y finalizar retiene las obligaciones únicas", () => {
    expect(puedeAgendar("INVOICE", { estadoDocumento: "PENDING", retenidasPor: [retained("CANCELLED")] })).toEqual({ permitido: true });
    expect(retieneObligacion(retained("COMPLETED"), "INVOICE")).toBe(true);
    expect(retieneObligacion(retained("COMPLETED"), "PETTY_CASH_REIMBURSEMENT")).toBe(false);
  });
  it("la clave incluye tipo y referencia y separa documentos de catálogos distintos", () => {
    expect(claveObligacion("INVOICE", "same-id")).not.toBe(claveObligacion("OPERATING_EXPENSE", "same-id"));
    expect(claveObligacion("INVOICE", "first")).not.toBe(claveObligacion("INVOICE", "second"));
  });
});

describe("C19: contrato HTTP de agregar partidas", () => {
  const referenceId = "b62dcf82-dcce-4de8-8a39-5eaad81a0553";
  const request = () => new NextRequest("http://localhost/api/finance/treasury/runs/target/items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemType: "INVOICE", referenceId, amountCents: 1, companyId: "company-b" }),
  });
  const invoke = () => POST(request(), { params: Promise.resolve({ id: "target" }) });
  beforeEach(() => { fixture.data(invoices)[0].id = referenceId; });

  it("usa la empresa de sesión aunque el body declare una ajena", async () => {
    const response = await invoke();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { paymentRunId: "target", referenceId, amountCents: 12500, bankAccountId: "bank-a" } });
    expect(requirePermissionApi).toHaveBeenCalledWith("reports", "update", expect.objectContaining({ classification: "FINANCIAL" }));
    expect(fixture.data(paymentRunItems)).toHaveLength(1);
  });
  it("la segunda petición devuelve 400 con el motivo de duplicado sin alterar el total", async () => {
    expect((await invoke()).status).toBe(200);
    const response = await invoke();
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toMatch(/esta corrida/i);
    expect(fixture.data(paymentRunItems)).toHaveLength(1);
    expect(fixture.data(paymentRuns)[0].totalAmountCents).toBe(12500);
  });
  it("devuelve 403 sin escrituras cuando falta el permiso financiero", async () => {
    vi.mocked(requirePermissionApi).mockRejectedValue(ApiError.forbidden("Sin permiso financiero"));
    const response = await invoke();
    expect(response.status).toBe(403);
    expect(fixture.writes).toEqual([]);
    expect(fixture.data(paymentRunItems)).toEqual([]);
  });
});

describe("C19: listados de obligaciones disponibles", () => {
  const cases = [
    { label: "facturas", type: "INVOICE", table: invoices, list: () => TreasuryService.getUnpaidMatchedInvoices("company-a") },
    { label: "gastos", type: "OPERATING_EXPENSE", table: operatingExpenses, list: () => TreasuryService.getUnpaidApprovedExpenses("company-a") },
    { label: "nómina", type: "PAYROLL", table: payrollRuns, list: () => TreasuryService.getUnpaidPayrollRuns("company-a") },
  ];
  for (const candidate of cases) {
    it(`${candidate.label}: excluye corridas vivas propias y permite canceladas/ajenas`, async () => {
      fixture.data(candidate.table).splice(0);
      for (const id of ["live", "cancelled", "foreign", "free"]) {
        fixture.data(candidate.table).push({ id, companyId: "company-a", paymentStatus: "PENDING", matchStatus: "MATCHED", status: "APPROVED", amount: 100, total: 100 });
        if (candidate.type === "PAYROLL") fixture.data(payrollPayslips).push({ runId: id, totalPercepcionesCents: 100 });
      }
      retain(candidate.type, "live", "DRAFT", "company-a", "live-run");
      retain(candidate.type, "cancelled", "CANCELLED", "company-a", "cancelled-run");
      retain(candidate.type, "foreign", "APPROVED", "company-b", "foreign-run");
      const listed = await candidate.list();
      expect(listed.map(row => row.id).sort()).toEqual(["cancelled", "foreign", "free"]);
    });
  }
});
