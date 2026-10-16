import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiError } from "@/lib/api/error";
import { hasPermission } from "@/lib/permissions";
import { resetWorkflowCompletion } from "@/lib/services/workflow-completion-delivery";
import { retryWorkflowCompletionEffects } from "@/app/actions/workflow-completion-recovery";
import { adminA, gerenteA1, gerenteA1SinSucursal, readonlyA, empleadoA1, EMPRESA_A,
  SUCURSAL_A_1, SUCURSAL_A_2, SUCURSAL_B_1, type SessionFixture } from "../../fixtures/tenant-isolation";

vi.mock("@/lib/db", () => ({ db: { select: vi.fn(), query: { workflowInstances: { findFirst: vi.fn() } } } }));
vi.mock("@/lib/rbac/abac", () => ({ requirePermissionApi: vi.fn() }));
vi.mock("@/lib/services/workflow-completion-delivery", () => ({ resetWorkflowCompletion: vi.fn() }));

const ID = "00000000-0000-4000-8000-000000000028";
let session: SessionFixture;
let instance: { id: string; branchId: string; assigneeId: string | null } | null;
const dialect = new PgDialect();

describe("C28 — recuperación con permiso y alcance reales", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session = adminA;
    instance = { id: ID, branchId: SUCURSAL_A_1, assigneeId: empleadoA1.id };
    vi.mocked(db.query.workflowInstances.findFirst).mockImplementation(async () => instance as never);
    vi.mocked(resetWorkflowCompletion).mockResolvedValue({ queued: true });
    vi.mocked(requirePermissionApi).mockImplementation(async (resource, action) => {
      if (!hasPermission(session.role, resource as never, action as never)) throw ApiError.forbidden("Sin permiso");
      return { user: session } as never;
    });
    vi.mocked(db.select).mockImplementation(() => ({ from: () => ({ where: (condition: any) => {
      const { params } = dialect.sqlToQuery(condition);
      const exists = params.includes(EMPRESA_A) && (params.includes(SUCURSAL_A_1) || params.includes(SUCURSAL_A_2));
      return { limit: async () => exists ? [{ id: instance?.branchId }] : [] };
    } }) }) as never);
  });

  it("autoriza un administrador y solicita intención durable", async () => {
    await expect(retryWorkflowCompletionEffects({ instanceId: ID })).resolves.toEqual({ queued: true });
    expect(requirePermissionApi).toHaveBeenCalledWith("workflows", "update");
    expect(resetWorkflowCompletion).toHaveBeenCalledWith(ID);
  });

  it.each([
    ["otra empresa", adminA, SUCURSAL_B_1, empleadoA1.id],
    ["otra sucursal", gerenteA1, SUCURSAL_A_2, empleadoA1.id],
    ["sin sucursal", gerenteA1SinSucursal, SUCURSAL_A_1, empleadoA1.id],
    ["otro responsable", empleadoA1, SUCURSAL_A_1, "otro-empleado"],
    ["solo lectura", readonlyA, SUCURSAL_A_1, empleadoA1.id],
  ] as const)("rechaza %s sin reactivar eventos", async (_label, actor, branchId, assigneeId) => {
    session = actor;
    instance = { id: ID, branchId, assigneeId };
    await expect(retryWorkflowCompletionEffects({ instanceId: ID })).rejects.toThrow();
    expect(resetWorkflowCompletion).not.toHaveBeenCalled();
  });

  it("rechaza instancia inexistente", async () => {
    instance = null;
    await expect(retryWorkflowCompletionEffects({ instanceId: ID })).rejects.toThrow("No encontramos");
    expect(resetWorkflowCompletion).not.toHaveBeenCalled();
  });

  it("rechaza identificadores inválidos antes de leer", async () => {
    await expect(retryWorkflowCompletionEffects({ instanceId: "no-es-uuid" })).rejects.toThrow();
    expect(db.query.workflowInstances.findFirst).not.toHaveBeenCalled();
    expect(resetWorkflowCompletion).not.toHaveBeenCalled();
  });
});
