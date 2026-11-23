import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { isApiError } from "@/lib/api/error";
import { withTenantAuth } from "@/lib/api/with-auth";
import {
  cancelLeaveRequest,
  createLeaveRequest,
  decideLeaveRequest,
  listLeaveRequests,
  listLeaveRequestsQuerySchema,
} from "@/lib/services/leave-request-service";

function failure(error: unknown) {
  if (isApiError(error)) return NextResponse.json({ error: error.message }, { status: error.statusCode });
  if (error instanceof ZodError || error instanceof SyntaxError) {
    return NextResponse.json({ error: "Entrada inválida para la solicitud de permiso." }, { status: 400 });
  }
  const pgCode = (error as { code?: string; cause?: { code?: string } })?.cause?.code
    ?? (error as { code?: string })?.code;
  if (pgCode === "42501") return NextResponse.json({ error: "Operación no autorizada." }, { status: 403 });
  if (pgCode === "23514" || pgCode === "23505") {
    return NextResponse.json({ error: "Conflicto de estado en la solicitud de permiso." }, { status: 409 });
  }
  console.error("[leave-requests] No se pudo completar la operación.");
  return NextResponse.json({ error: "No se pudo completar la operación de permisos." }, { status: 500 });
}

export const GET = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const params = new URL(request.url).searchParams;
    if (params.has("companyId") && params.get("companyId") !== auth.tenantId) {
      return NextResponse.json({ error: "Empresa fuera de alcance." }, { status: 403 });
    }
    const query = listLeaveRequestsQuerySchema.parse({
      userId: params.get("userId") ?? undefined,
      leaveTypeId: params.get("leaveTypeId") ?? undefined,
      status: params.get("status") ?? undefined,
      startDate: params.get("startDate") ?? undefined,
      endDate: params.get("endDate") ?? undefined,
      page: params.get("page") ?? undefined,
      limit: params.get("limit") ?? undefined,
    });
    const result = await listLeaveRequests({ userId: auth.user.id, companyId: auth.tenantId }, query);
    return NextResponse.json(result);
  } catch (error) {
    return failure(error);
  }
});

export const POST = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const body = await request.json();
    const created = await createLeaveRequest({ userId: auth.user.id, companyId: auth.tenantId }, body);
    return NextResponse.json(
      { request: created, message: "Solicitud de permiso creada exitosamente" },
      { status: 201 },
    );
  } catch (error) {
    return failure(error);
  }
});

export const PATCH = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const { searchParams } = new URL(request.url);
    const requestId = searchParams.get("id");
    const action = searchParams.get("action");
    if (!requestId || (action !== "approve" && action !== "reject")) {
      return NextResponse.json(
        { error: "Se requiere id y una acción válida (approve o reject)." },
        { status: 400 },
      );
    }
    const rawBody = await request.json().catch(() => ({}));
    const updated = await decideLeaveRequest(
      { userId: auth.user.id, companyId: auth.tenantId },
      requestId,
      action,
      rawBody,
    );
    return NextResponse.json({
      request: updated,
      message: action === "approve" ? "Solicitud de permiso aprobada" : "Solicitud de permiso rechazada",
    });
  } catch (error) {
    return failure(error);
  }
});

export const DELETE = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const { searchParams } = new URL(request.url);
    const requestId = searchParams.get("id");
    if (!requestId) {
      return NextResponse.json({ error: "ID de solicitud requerido." }, { status: 400 });
    }
    const cancelled = await cancelLeaveRequest({ userId: auth.user.id, companyId: auth.tenantId }, requestId);
    return NextResponse.json({
      request: cancelled,
      message: "Solicitud de permiso cancelada exitosamente",
    });
  } catch (error) {
    return failure(error);
  }
});
