import { NextRequest } from "next/server";
import { requireTenantAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { getCivilProtectionKpis } from "@/lib/services/civil-protection-service";

export async function GET(request: NextRequest) {
    try {
        const { tenantId, branchId } = await requireTenantAuth();
        const { searchParams } = new URL(request.url);
        // branchId opcional; si no se pasa, usa el de sesion (cookie) o agrega todas.
        const requestedBranch = searchParams.get("branchId") ?? branchId ?? undefined;

        const kpis = await getCivilProtectionKpis(tenantId, requestedBranch);
        return ApiHandler.success(kpis);
    } catch (error) {
        return ApiHandler.error(error);
    }
}
