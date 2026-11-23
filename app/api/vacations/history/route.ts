import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { withTenantAuth } from "@/lib/api/with-auth";
import { isApiError } from "@/lib/api/error";
import {
  extendVacationHistoryCoverage,
  getVacationHistory,
  grantVacationHistoryDays,
  openVacationHistoryStream,
  revokeVacationHistoryGrant,
  vacationHistoryMutationSchema,
  vacationHistoryQuerySchema,
} from "@/lib/services/vacation-history-grants-service";

function failure(error: unknown) {
  if (isApiError(error)) return NextResponse.json({ error: error.message }, { status: error.statusCode });
  if (error instanceof ZodError || error instanceof SyntaxError) {
    return NextResponse.json({ error: "Entrada inválida para el historial de vacaciones." }, { status: 400 });
  }
  console.error("[vacation-history] No se pudo completar la operación.");
  return NextResponse.json({ error: "No se pudo completar la operación del historial de vacaciones." }, { status: 500 });
}

export const GET = withTenantAuth(async (request, { auth }) => {
  try {
    const params = new URL(request.url).searchParams;
    if (params.has("companyId") && params.get("companyId") !== auth.tenantId) {
      return NextResponse.json({ error: "Empresa fuera de alcance." }, { status: 403 });
    }
    const query = vacationHistoryQuerySchema.parse({
      userId: params.get("userId") ?? undefined,
    });
    const history = await getVacationHistory({ userId: auth.user.id, companyId: auth.tenantId }, query);
    return NextResponse.json(history);
  } catch (error) {
    return failure(error);
  }
});

export const POST = withTenantAuth(async (request, { auth }) => {
  try {
    const raw = await request.json();
    const input = vacationHistoryMutationSchema.parse(raw);
    const actor = { userId: auth.user.id, companyId: auth.tenantId };
    if (input.operation === "OPEN_STREAM") {
      const result = await openVacationHistoryStream(actor, input);
      return NextResponse.json(result, { status: result.created ? 201 : 200 });
    }
    if (input.operation === "EXTEND_COVERAGE") {
      const result = await extendVacationHistoryCoverage(actor, input);
      return NextResponse.json(result, { status: result.created ? 201 : 200 });
    }
    if (input.operation === "GRANT") {
      const result = await grantVacationHistoryDays(actor, input);
      return NextResponse.json(result, { status: result.created ? 201 : 200 });
    }
    const result = await revokeVacationHistoryGrant(actor, input);
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return failure(error);
  }
});
