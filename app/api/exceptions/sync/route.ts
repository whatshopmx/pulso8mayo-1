import type { NextRequest } from "next/server";

import { ApiHandler } from "@/lib/api/response";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { inngest } from "@/lib/inngest/client";

/**
 * POST /api/exceptions/sync
 * Dispara el sync on-demand (evento Inngest). Si Inngest está caído, el cron de
 * 10 min recoge igual la proyección.
 */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { ctx } = await requirePermissionApi("exceptions", "update", {
      audit: { action: "UPDATE", req },
    });
    const body = (await req.json().catch(() => ({}))) as {
      branchId?: string | null;
    };

    await inngest.send({
      name: "exceptions/sync.requested",
      data: {
        companyId: ctx.userCompanyId,
        branchId: body?.branchId ?? undefined,
      },
    });

    return ApiHandler.success({ queued: true });
  } catch (error) {
    return ApiHandler.error(error);
  }
}
