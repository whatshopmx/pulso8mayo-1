import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/error";

const {
  mockRequirePermissionApi,
  mockFindExceptionForTenant,
  mockAssign,
  mockStartAction,
  mockResolve,
  mockVerify,
  mockClose,
  mockReopen,
} = vi.hoisted(() => ({
  mockRequirePermissionApi: vi.fn(),
  mockFindExceptionForTenant: vi.fn(),
  mockAssign: vi.fn(),
  mockStartAction: vi.fn(),
  mockResolve: vi.fn(),
  mockVerify: vi.fn(),
  mockClose: vi.fn(),
  mockReopen: vi.fn(),
}));

vi.mock("@/lib/rbac/abac", () => ({
  requirePermissionApi: mockRequirePermissionApi,
}));

vi.mock("@/lib/api/exception-access", () => ({
  exceptionBranchScope: () => ({ kind: "ALL" }),
  findExceptionForTenant: mockFindExceptionForTenant,
}));

vi.mock("@/lib/services/exception-service", () => ({
  ExceptionService: {
    assign: mockAssign,
    startAction: mockStartAction,
    resolve: mockResolve,
    verify: mockVerify,
    close: mockClose,
    reopen: mockReopen,
  },
}));

vi.mock("@/components/exceptions/exception-evidence-dialog", () => ({
  ExceptionEvidenceDialog: () => null,
}));

import { POST as assignRoute } from "@/app/api/exceptions/[id]/assign/route";
import { POST as startActionRoute } from "@/app/api/exceptions/[id]/start-action/route";
import { POST as resolveRoute } from "@/app/api/exceptions/[id]/resolve/route";
import { POST as verifyRoute } from "@/app/api/exceptions/[id]/verify/route";
import { POST as closeRoute } from "@/app/api/exceptions/[id]/close/route";
import { POST as reopenRoute } from "@/app/api/exceptions/[id]/reopen/route";
import {
  ExceptionLifecycleActions,
  submitExceptionLifecycleAction,
} from "@/components/exceptions/exception-lifecycle-actions";
import {
  canMutateExceptionsRole,
  resolveCanonicalTarget,
  resolveLegacyFeedLinkLabel,
} from "@/lib/services/exception-ui-capabilities";

const EXC_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY_ID = "11111111-1111-4111-8111-111111111111";

function postReq(path: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost:3000/api/exceptions/${EXC_ID}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("EXC-05 — Acciones canónicas en API y UI (V3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermissionApi.mockResolvedValue({
      ctx: {
        userId: "user-admin",
        userRole: "ADMIN",
        userCompanyId: COMPANY_ID,
        userBranchId: null,
      },
    });
    mockFindExceptionForTenant.mockResolvedValue({
      id: EXC_ID,
      companyId: COMPANY_ID,
      status: "OPEN",
    });
  });

  it("las 6 rutas canónicas (assign/start-action/resolve/verify/close/reopen) exigen autorización, propagan expectedStatus y devuelven 409 en conflicto", async () => {
    const routeCtx = { params: Promise.resolve({ id: EXC_ID }) };

    mockAssign.mockResolvedValueOnce({ id: EXC_ID, status: "ASSIGNED", ownerId: "user-gerente" });
    const rAssign = await assignRoute(
      postReq("assign", { ownerId: "user-gerente", expectedStatus: "OPEN" }),
      routeCtx,
    );
    expect(rAssign.status).toBe(200);
    expect(mockAssign).toHaveBeenCalledWith(
      EXC_ID,
      COMPANY_ID,
      "user-gerente",
      "user-admin",
      undefined,
      { expectedStatus: "OPEN" },
    );

    mockStartAction.mockResolvedValueOnce({ id: EXC_ID, status: "IN_ACTION" });
    const rStart = await startActionRoute(
      postReq("start-action", { expectedStatus: "ASSIGNED" }),
      routeCtx,
    );
    expect(rStart.status).toBe(200);
    expect(mockStartAction).toHaveBeenCalledWith(
      EXC_ID,
      COMPANY_ID,
      "user-admin",
      undefined,
      { expectedStatus: "ASSIGNED" },
    );

    mockResolve.mockResolvedValueOnce({ id: EXC_ID, status: "RESOLVED" });
    const rResolve = await resolveRoute(
      postReq("resolve", { resolution: "Ajustado con evidencia", expectedStatus: "IN_ACTION" }),
      routeCtx,
    );
    expect(rResolve.status).toBe(200);
    expect(mockResolve).toHaveBeenCalledWith(
      EXC_ID,
      COMPANY_ID,
      "user-admin",
      "Ajustado con evidencia",
      undefined,
      { expectedStatus: "IN_ACTION" },
    );

    mockVerify.mockResolvedValueOnce({ id: EXC_ID, status: "VERIFIED" });
    const rVerify = await verifyRoute(
      postReq("verify", { expectedStatus: "RESOLVED" }),
      routeCtx,
    );
    expect(rVerify.status).toBe(200);
    expect(mockVerify).toHaveBeenCalledWith(
      EXC_ID,
      COMPANY_ID,
      "user-admin",
      undefined,
      { expectedStatus: "RESOLVED" },
    );

    mockClose.mockResolvedValueOnce({ id: EXC_ID, status: "CLOSED" });
    const rClose = await closeRoute(
      postReq("close", { expectedStatus: "VERIFIED" }),
      routeCtx,
    );
    expect(rClose.status).toBe(200);
    expect(mockClose).toHaveBeenCalledWith(
      EXC_ID,
      COMPANY_ID,
      "user-admin",
      undefined,
      { expectedStatus: "VERIFIED" },
    );

    mockReopen.mockResolvedValueOnce({ id: EXC_ID, status: "REOPENED" });
    const rReopen = await reopenRoute(
      postReq("reopen", { reason: "Reincidencia detectada", expectedStatus: "CLOSED" }),
      routeCtx,
    );
    expect(rReopen.status).toBe(200);
    expect(mockReopen).toHaveBeenCalledWith(
      EXC_ID,
      COMPANY_ID,
      "user-admin",
      "Reincidencia detectada",
      undefined,
      { expectedStatus: "CLOSED" },
    );

    // Conflicto concurrente (409)
    mockResolve.mockRejectedValueOnce(
      ApiError.conflict("Conflicto concurrente: la excepción estaba en CANCELLED, no en IN_ACTION."),
    );
    const rConflict = await resolveRoute(
      postReq("resolve", { resolution: "Intento tardío", expectedStatus: "IN_ACTION" }),
      routeCtx,
    );
    expect(rConflict.status).toBe(409);

    // Usuario sin permiso `exceptions:update` -> 403 Forbidden
    mockRequirePermissionApi.mockRejectedValueOnce(ApiError.forbidden("Sin permiso."));
    const rForbidden = await verifyRoute(postReq("verify", { expectedStatus: "RESOLVED" }), routeCtx);
    expect(rForbidden.status).toBe(403);
  });

  it("UI refleja capacidades de rol, segregación de funciones, conflicto concurrente 409 y el feed no acredita acciones inexistentes", async () => {
    // 1. Capacidades RBAC: ADMIN/GERENTE mutan; EMPLEADO/READONLY son solo lectura
    expect(canMutateExceptionsRole("ADMIN")).toBe(true);
    expect(canMutateExceptionsRole("GERENTE")).toBe(true);
    expect(canMutateExceptionsRole("EMPLEADO")).toBe(false);
    expect(canMutateExceptionsRole("READONLY")).toBe(false);

    // 2. Renderizado para usuario de solo lectura: NO muestra botones de mutación
    const readOnlyHtml = renderToStaticMarkup(
      React.createElement(ExceptionLifecycleActions, {
        exceptionId: EXC_ID,
        lifecycle: { status: "OPEN", ownerId: null, slaDueAt: null },
        canMutate: false,
        currentUserId: "user-emp",
        onDone: () => {},
      }),
    );
    expect(readOnlyHtml).toContain("Solo lectura");
    expect(readOnlyHtml).not.toContain(">Asignar<");
    expect(readOnlyHtml).not.toContain(">Cancelar<");

    // 3. Segregación de funciones: resolvedor en RESOLVED NO ve botón Verificar habilitado
    const sameUserHtml = renderToStaticMarkup(
      React.createElement(ExceptionLifecycleActions, {
        exceptionId: EXC_ID,
        lifecycle: { status: "RESOLVED", ownerId: "u-res", slaDueAt: null, resolvedBy: "u-res" },
        canMutate: true,
        currentUserId: "u-res",
        onDone: () => {},
      }),
    );
    expect(sameUserHtml).toContain("Requiere otro verificador");
    expect(sameUserHtml).not.toContain(">Verificar<");

    // Otro verificador SÍ ve botón Verificar
    const verifierHtml = renderToStaticMarkup(
      React.createElement(ExceptionLifecycleActions, {
        exceptionId: EXC_ID,
        lifecycle: { status: "RESOLVED", ownerId: "u-res", slaDueAt: null, resolvedBy: "u-res" },
        canMutate: true,
        currentUserId: "u-ver",
        onDone: () => {},
      }),
    );
    expect(verifierHtml).toContain(">Verificar<");

    // 4. Envío desde cliente con `expectedStatus` y detección explícita de conflicto 409
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          error: { message: "Conflicto concurrente: la excepción cambió a CANCELLED." },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );
    const submitOutcome = await submitExceptionLifecycleAction({
      exceptionId: EXC_ID,
      event: "RESOLVE",
      expectedStatus: "IN_ACTION",
      value: "Intento de resolución",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(submitOutcome.ok).toBe(false);
    expect(submitOutcome.conflict).toBe(true);
    expect(submitOutcome.status).toBe(409);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      expectedStatus: "IN_ACTION",
      resolution: "Intento de resolución",
    });

    const conflictHtml = renderToStaticMarkup(
      React.createElement(ExceptionLifecycleActions, {
        exceptionId: EXC_ID,
        lifecycle: { status: "IN_ACTION", ownerId: "u-res", slaDueAt: null },
        canMutate: true,
        initialConflictMessage: "Conflicto concurrente: la excepción cambió en otra sesión.",
        onDone: () => {},
      }),
    );
    expect(conflictHtml).toContain('role="alert"');
    expect(conflictHtml).toContain("Conflicto concurrente");

    // 5. Feed honesto: fila legacy con proyección canónica usa id canónico; sin proyección NO acredita "Resolver"
    const withCanonical = resolveCanonicalTarget({
      id: "legacy-1",
      canonical: {
        id: EXC_ID,
        status: "ASSIGNED",
        ownerId: "u-1",
        slaDueAt: null,
      },
    });
    expect(withCanonical?.exceptionId).toBe(EXC_ID);
    expect(withCanonical?.source).toBe("LEGACY_WITH_CANONICAL");

    const withoutCanonical = resolveCanonicalTarget({ id: "legacy-only" });
    expect(withoutCanonical).toBeNull();
    expect(resolveLegacyFeedLinkLabel("Resolver")).toBe("Ver en módulo");
    expect(resolveLegacyFeedLinkLabel(undefined)).toBe("Ver en módulo");
    expect(resolveLegacyFeedLinkLabel("Revisar incidente")).toBe("Revisar incidente");
  });
});
