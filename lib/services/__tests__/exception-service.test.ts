import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/error";

/**
 * Phase 0 / Task 4 — `exception-service`.
 *
 * Doble de `@/lib/db` en memoria (tablas como arrays) + condiciones de
 * `drizzle-orm` mockeadas a predicados evaluables, de modo que los filtros de
 * tenant/sucursal/estado se comprueban de verdad sin Postgres.
 */

const TAG = Symbol.for("exception-service-test.pred");

const h = vi.hoisted(() => {
  const store = new Map<string, Record<string, unknown>[]>();
  return { store };
});

// ── Condiciones evaluables ────────────────────────────────────────────────
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  const tag = Symbol.for("exception-service-test.pred");

  const colKey = (col: unknown): string | null => {
    const name = (col as { name?: unknown })?.name;
    if (typeof name !== "string") return null;
    return name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  };

  return {
    ...actual,
    eq: (col: unknown, val: unknown) => ({
      [tag]: (row: Record<string, unknown>) => row[colKey(col) as string] === val,
    }),
    and: (...conds: unknown[]) => ({
      [tag]: (row: Record<string, unknown>) =>
        conds.filter(Boolean).every((c) => evaluate(c, row)),
    }),
    inArray: (col: unknown, vals: unknown[]) => ({
      [tag]: (row: Record<string, unknown>) =>
        Array.isArray(vals) && vals.includes(row[colKey(col) as string]),
    }),
    notInArray: (col: unknown, vals: unknown[]) => ({
      [tag]: (row: Record<string, unknown>) =>
        !(Array.isArray(vals) && vals.includes(row[colKey(col) as string])),
    }),
    desc: (col: unknown) => ({ __desc: colKey(col) }),
  };

  function evaluate(cond: unknown, row: Record<string, unknown>): boolean {
    if (!cond || typeof cond !== "object") return true;
    const fn = (cond as Record<symbol, unknown>)[tag];
    if (typeof fn === "function") return (fn as (r: unknown) => boolean)(row);
    return true;
  }
});

// ── Doble de base de datos ────────────────────────────────────────────────
vi.mock("@/lib/db", () => {
  const tag = Symbol.for("exception-service-test.pred");

  const tableName = (table: unknown): string => {
    if (!table || typeof table !== "object") return "unknown";
    const sym = Object.getOwnPropertySymbols(table).find(
      (s) => s.toString() === "Symbol(drizzle:Name)",
    );
    return sym ? String((table as Record<symbol, unknown>)[sym]) : "unknown";
  };

  const rowsFor = (table: unknown) => {
    const name = tableName(table);
    if (!h.store.has(name)) h.store.set(name, []);
    return h.store.get(name)!;
  };

  const colKey = (col: unknown): string | null => {
    const name = (col as { name?: unknown })?.name;
    if (typeof name !== "string") return null;
    return name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  };

  const evaluate = (cond: unknown, row: Record<string, unknown>): boolean => {
    if (!cond || typeof cond !== "object") return true;
    for (const s of Object.getOwnPropertySymbols(cond)) {
      const v = (cond as Record<symbol, unknown>)[s];
      if (typeof v === "function") return (v as (r: unknown) => boolean)(row);
    }
    return true;
  };

  const project = (
    row: Record<string, unknown>,
    proj: Record<string, unknown> | undefined,
    isNew = false,
  ): Record<string, unknown> => {
    if (!proj) return { ...row };
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(proj)) {
      if (key === "isNew") {
        out.isNew = isNew;
      } else {
        const k = colKey(proj[key]) ?? key;
        out[key] = row[k];
      }
    }
    return out;
  };

  const uniqueKey = (v: Record<string, unknown>): string =>
    `${v.companyId}|${v.subjectType}|${v.subjectId}`;

  const DEFAULT_EXCEPTION = {
    status: "OPEN",
    severity: "warning",
    branchId: null,
    ownerId: null,
    slaDueAt: null,
    actionMeta: null,
    metadata: null,
    resolution: null,
    resolvedBy: null,
    resolvedAt: null,
    verifiedBy: null,
    verifiedAt: null,
    closedAt: null,
    evidenceId: null,
    reopenedFromId: null,
  };

  const makeSelect = (proj?: Record<string, unknown>) => {
    let table: unknown;
    let cond: unknown;
    let limitN: number | undefined;
    let offsetN = 0;
    const order: { __desc: string }[] = [];

    const run = (): Record<string, unknown>[] => {
      let rows = rowsFor(table).filter((r) => evaluate(cond, r));
      if (order.length) {
        rows = [...rows].sort((a, b) => {
          for (const o of order) {
            const av = a[o.__desc] as number | string | Date | null;
            const bv = b[o.__desc] as number | string | Date | null;
            if (av === bv) continue;
            const an = av instanceof Date ? av.getTime() : av;
            const bn = bv instanceof Date ? bv.getTime() : bv;
            // desc
            return (an as number) < (bn as number) ? 1 : -1;
          }
          return 0;
        });
      }
      if (offsetN) rows = rows.slice(offsetN);
      if (limitN !== undefined) rows = rows.slice(0, limitN);
      return rows.map((r) => project(r, proj));
    };

    const chain: Record<string, unknown> = {
      from(t: unknown) {
        table = t;
        return chain;
      },
      where(c: unknown) {
        cond = c;
        return chain;
      },
      orderBy(...o: { __desc: string }[]) {
        order.push(...o.filter(Boolean));
        return chain;
      },
      limit(n: number) {
        limitN = n;
        return chain;
      },
      offset(n: number) {
        offsetN = n;
        return chain;
      },
      then(
        resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown,
      ) {
        try {
          resolve(run());
        } catch (e) {
          reject(e);
        }
      },
    };
    return chain;
  };

  const makeInsert = (table: unknown) => {
    let values: Record<string, unknown> | Record<string, unknown>[];
    let conflictSet: Record<string, unknown> | undefined;
    const chain: Record<string, unknown> = {
      values(v: Record<string, unknown> | Record<string, unknown>[]) {
        values = v;
        return chain;
      },
      onConflictDoUpdate(cfg: { set: Record<string, unknown> }) {
        conflictSet = cfg.set;
        return chain;
      },
      onConflictDoNothing() {
        return chain;
      },
      returning(proj?: Record<string, unknown>) {
        const arr = rowsFor(table);
        const list = Array.isArray(values) ? values : [values];
        const out: Record<string, unknown>[] = [];
        for (const v of list) {
          const existing = arr.find((r) => uniqueKey(r) === uniqueKey(v));
          if (existing) {
            Object.assign(existing, conflictSet);
            out.push(project(existing, proj, false));
          } else {
            const row: Record<string, unknown> = {
              id: v.id ?? randomUUID(),
              ...DEFAULT_EXCEPTION,
              ...v,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            arr.push(row);
            out.push(project(row, proj, true));
          }
        }
        return Promise.resolve(out);
      },
      then(resolve: (v: unknown) => unknown) {
        resolve(undefined);
      },
    };
    return chain;
  };

  const makeUpdate = (table: unknown) => {
    let set: Record<string, unknown> | undefined;
    let cond: unknown;
    const chain: Record<string, unknown> = {
      set(s: Record<string, unknown>) {
        set = s;
        return chain;
      },
      where(c: unknown) {
        cond = c;
        return chain;
      },
      returning(proj?: Record<string, unknown>) {
        const rows = rowsFor(table).filter((r) => evaluate(cond, r));
        rows.forEach((r) => Object.assign(r, set));
        return Promise.resolve(rows.map((r) => project(r, proj)));
      },
      then(resolve: (v: unknown) => unknown) {
        resolve(undefined);
      },
    };
    return chain;
  };

  return {
    db: {
      select: (proj?: Record<string, unknown>) => makeSelect(proj),
      insert: (table: unknown) => makeInsert(table),
      update: (table: unknown) => makeUpdate(table),
    },
  };
});

vi.mock("@/lib/services/audit-service", () => ({
  AuditService: { logEmployeeAction: vi.fn().mockResolvedValue({ id: "audit-1" }) },
}));

vi.mock("@/lib/services/domain-event-service", () => ({
  emitDomainEvent: vi.fn().mockResolvedValue(undefined),
}));

import { AuditService } from "@/lib/services/audit-service";
import { ExceptionService } from "../exception-service";

const COMPANY = "company-1";
const OTHER_COMPANY = "company-2";

function resetStore() {
  h.store.clear();
  h.store.set("exceptions", []);
  h.store.set("branches", []);
  h.store.set("users", []);
}

function seedException(overrides: Record<string, unknown>) {
  const row = {
    id: randomUUID(),
    companyId: COMPANY,
    branchId: null,
    domain: "operacion",
    qsrCategory: "ABASTO",
    severity: "warning",
    subjectType: "incident",
    subjectId: randomUUID(),
    reason: "fixture",
    status: "OPEN",
    ownerId: null,
    slaDueAt: null,
    actionMeta: null,
    resolution: null,
    resolvedBy: null,
    resolvedAt: null,
    verifiedBy: null,
    verifiedAt: null,
    closedAt: null,
    evidenceId: null,
    reopenedFromId: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  h.store.get("exceptions")!.push(row);
  return row;
}

const baseRaise = {
  companyId: COMPANY,
  branchId: null,
  domain: "finanzas" as const,
  qsrCategory: "DINERO" as const,
  severity: "high" as const,
  subjectType: "invoice_discrepancy",
  subjectId: "inv-1",
  reason: "Factura con diferencia de precio",
  actorId: "user-1",
};

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
});

describe("raise — upsert idempotente", () => {
  it("rechaza razón vacía", async () => {
    await expect(
      ExceptionService.raise({ ...baseRaise, reason: "   " }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("crea la fila con status OPEN y SLA calculado", async () => {
    const row = await ExceptionService.raise(baseRaise);
    expect(h.store.get("exceptions")).toHaveLength(1);
    expect(row.status).toBe("OPEN");
    expect(row.slaDueAt).toBeInstanceOf(Date);
    expect(AuditService.logEmployeeAction).toHaveBeenCalledTimes(1);
  });

  it("reejecutar con el mismo subject actualiza razón sin duplicar", async () => {
    await ExceptionService.raise(baseRaise);
    const second = await ExceptionService.raise({
      ...baseRaise,
      reason: "Factura con diferencia de cantidad",
    });
    const all = h.store.get("exceptions")!;
    expect(all).toHaveLength(1);
    expect(second.reason).toBe("Factura con diferencia de cantidad");
    expect(second.status).toBe("OPEN");
    // Solo la creación escribe auditoría; el upsert no vuelve a auditar.
    expect(AuditService.logEmployeeAction).toHaveBeenCalledTimes(1);
  });

  it("resuelve owner por defecto desde el gerente de la sucursal", async () => {
    h.store.set("branches", [
      { id: "branch-1", companyId: COMPANY, managerId: "manager-1" },
    ]);
    h.store.set("users", [
      { id: "manager-1", companyId: COMPANY, active: true },
    ]);
    const row = await ExceptionService.raise({ ...baseRaise, branchId: "branch-1" });
    expect(row.ownerId).toBe("manager-1");
  });
});

describe("lifecycle — cadena completa", () => {
  it("OPEN→ASSIGNED→IN_ACTION→RESOLVED→VERIFIED→CLOSED", async () => {
    const created = await ExceptionService.raise(baseRaise);
    const id = created.id as string;

    const assigned = await ExceptionService.assign(id, COMPANY, "owner-1", "actor-1");
    expect(assigned.status).toBe("ASSIGNED");
    expect(assigned.ownerId).toBe("owner-1");

    const started = await ExceptionService.startAction(id, COMPANY, "actor-1");
    expect(started.status).toBe("IN_ACTION");

    const resolved = await ExceptionService.resolve(
      id,
      COMPANY,
      "resolver-1",
      "Se ajustó el precio en el CFDI",
    );
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.resolvedBy).toBe("resolver-1");

    const verified = await ExceptionService.verify(id, COMPANY, "verifier-1");
    expect(verified.status).toBe("VERIFIED");
    expect(verified.verifiedBy).toBe("verifier-1");

    const closed = await ExceptionService.close(id, COMPANY, "actor-1");
    expect(closed.status).toBe("CLOSED");
    expect(closed.closedAt).toBeInstanceOf(Date);
  });

  it("VERIFY rechaza al mismo resolvedor (segregación de funciones)", async () => {
    const created = await ExceptionService.raise(baseRaise);
    const id = created.id as string;
    await ExceptionService.assign(id, COMPANY, "owner-1", "actor-1");
    await ExceptionService.startAction(id, COMPANY, "actor-1");
    await ExceptionService.resolve(id, COMPANY, "same-user", "listo");

    await expect(
      ExceptionService.verify(id, COMPANY, "same-user"),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("CLOSE sin VERIFIED se rechaza", async () => {
    const created = await ExceptionService.raise(baseRaise);
    const id = created.id as string;
    await ExceptionService.assign(id, COMPANY, "owner-1", "actor-1");
    await ExceptionService.startAction(id, COMPANY, "actor-1");
    await ExceptionService.resolve(id, COMPANY, "resolver-1", "listo");

    await expect(
      ExceptionService.close(id, COMPANY, "actor-1"),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("REOPEN exige motivo y desde CLOSED vuelve a REOPENED", async () => {
    const created = await ExceptionService.raise(baseRaise);
    const id = created.id as string;
    await ExceptionService.assign(id, COMPANY, "o", "a");
    await ExceptionService.startAction(id, COMPANY, "a");
    await ExceptionService.resolve(id, COMPANY, "r", "ok");
    await ExceptionService.verify(id, COMPANY, "v");
    await ExceptionService.close(id, COMPANY, "a");

    await expect(
      ExceptionService.reopen(id, COMPANY, "a", "  "),
    ).rejects.toBeInstanceOf(ApiError);

    const reopened = await ExceptionService.reopen(id, COMPANY, "a", "recibió otra factura");
    expect(reopened.status).toBe("REOPENED");
    expect(reopened.reopenedFromId).toBe(id);
  });
});

describe("lectura con scope de tenant", () => {
  it("listOpen excluye CLOSED/CANCELLED y filtra por sucursal", async () => {
    seedException({ subjectId: "a", status: "OPEN", branchId: "branch-1" });
    seedException({ subjectId: "b", status: "CLOSED", branchId: "branch-1" });
    seedException({ subjectId: "c", status: "OPEN", branchId: "branch-2" });
    seedException({ subjectId: "d", status: "CANCELLED", branchId: "branch-2" });

    const all = await ExceptionService.listOpen(COMPANY);
    expect(all.map((r) => r.subjectId).sort()).toEqual(["a", "c"]);

    const branch1 = await ExceptionService.listOpen(COMPANY, { branchId: "branch-1" });
    expect(branch1.map((r) => r.subjectId)).toEqual(["a"]);
  });

  it("getById no cruza empresas (404 indistinto)", async () => {
    const row = seedException({ subjectId: "x" });
    await expect(
      ExceptionService.getById(row.id as string, OTHER_COMPANY),
    ).rejects.toBeInstanceOf(ApiError);
    const found = await ExceptionService.getById(row.id as string, COMPANY);
    expect(found.id).toBe(row.id);
  });

  it("list filtra por dominio y severidad", async () => {
    seedException({ subjectId: "a", domain: "finanzas", severity: "high" });
    seedException({ subjectId: "b", domain: "operacion", severity: "info" });
    const rows = await ExceptionService.list(COMPANY, { domain: "finanzas" });
    expect(rows.map((r) => r.subjectId)).toEqual(["a"]);
    const high = await ExceptionService.list(COMPANY, { severity: "high" });
    expect(high.map((r) => r.subjectId)).toEqual(["a"]);
  });
});
