import { beforeEach, expect, it, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({ branchId: "branch-a" as string | null, queries: [] as { table: string; params: unknown[] }[] }));
vi.mock("@/lib/tenant-context", () => ({ getCurrentTenant: async () => ({ id: "company-a", branchId: state.branchId }) }));
vi.mock("@/lib/rbac/require-role", () => ({ requireManagementRole: async () => undefined }));
vi.mock("@/lib/services/employee-service", () => ({ EmployeeService: { listEmployees: async () => ({ meta: { total: 0 }, data: [] }) } }));
vi.mock("@/components/shared", () => ({ PageContainer: () => null, EmptyState: () => null }));
vi.mock("@/components/labor/labor-quick-action-drawer", () => ({ LaborQuickActionDrawer: () => null }));
vi.mock("@/components/labor/emergency-departure-dialog", () => ({ EmergencyDepartureDialog: () => null }));
vi.mock("@/lib/db", () => ({ db: { select: () => {
  let table = "";
  const query = {
    from: (value: Parameters<typeof getTableName>[0]) => { table = getTableName(value); return query; },
    innerJoin: () => query,
    where: (condition: SQL) => {
      state.queries.push({ table, params: new PgDialect().sqlToQuery(condition).params });
      return Promise.resolve(table === "employee_documents" ? [] : [{ count: 0, total: 0, compliant: 0, totalSessions: 0 }]);
    },
  };
  return query;
} } }));

import LaborPage from "@/app/dashboard/labor/page";
beforeEach(() => { state.queries = []; state.branchId = "branch-a"; });

it("aplica el mismo alcance de sucursal a documentos, descansos e incidentes", async () => {
  await LaborPage();
  for (const table of ["employee_documents", "break_logs", "incidents"]) {
    const query = state.queries.find(item => item.table === table);
    expect(query, table).toBeDefined();
    expect(query?.params, table).toContain("company-a");
    expect(query?.params, table).toContain("branch-a");
  }
});

it("conserva la empresa al consultar el alcance de todas las sucursales", async () => {
  state.branchId = null;
  await LaborPage();
  for (const table of ["employee_documents", "break_logs", "incidents"]) {
    const query = state.queries.find(item => item.table === table);
    expect(query?.params, table).toContain("company-a");
    expect(query?.params, table).not.toContain("branch-a");
  }
});
