import { NextRequest } from "next/server";
import { ApiHandler } from "@/lib/api/response";
import { requireTenant } from "@/lib/tenant-context";
import { NOM035Service } from "@/lib/services/compliance/nom035-service";
import { z } from "zod";

const updateActionPlanSchema = z.object({
  branchId: z.string().uuid().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  riskCategory: z.string().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  status: z.enum(["PENDING", "IN_PROGRESS", "RESOLVED", "CANCELLED"]).optional(),
  assignedTo: z.string().optional(),
  dueDate: z.string().optional().transform(val => val ? new Date(val) : undefined),
  remediationMeasures: z.array(z.any()).optional(),
  evidenceUrl: z.string().optional(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const tenant = await requireTenant();
    const { id } = await params;
    const plan = await NOM035Service.getActionPlanById(id);

    if (!plan) {
      return ApiHandler.error("Action plan not found", 404);
    }

    if (plan.companyId !== tenant.id) {
      return ApiHandler.error("Forbidden", 403);
    }

    return ApiHandler.success(plan);
  } catch (error: any) {
    console.error("[NOM-035 Action Plan ID API] Error in GET:", error);
    return ApiHandler.error(error.message || "Internal Server Error", error.status || 500);
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const tenant = await requireTenant();
    const { id } = await params;
    const plan = await NOM035Service.getActionPlanById(id);

    if (!plan) {
      return ApiHandler.error("Action plan not found", 404);
    }

    if (plan.companyId !== tenant.id) {
      return ApiHandler.error("Forbidden", 403);
    }

    const body = await request.json();
    const result = updateActionPlanSchema.safeParse(body);

    if (!result.success) {
      return ApiHandler.error(result.error.issues[0]?.message || "Invalid payload", 400);
    }

    const updatedPlan = await NOM035Service.updateActionPlan(id, result.data);
    return ApiHandler.success(updatedPlan);
  } catch (error: any) {
    console.error("[NOM-035 Action Plan ID API] Error in PUT:", error);
    return ApiHandler.error(error.message || "Internal Server Error", error.status || 500);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const tenant = await requireTenant();
    const { id } = await params;
    const plan = await NOM035Service.getActionPlanById(id);

    if (!plan) {
      return ApiHandler.error("Action plan not found", 404);
    }

    if (plan.companyId !== tenant.id) {
      return ApiHandler.error("Forbidden", 403);
    }

    await NOM035Service.deleteActionPlan(id);
    return ApiHandler.success({ deleted: true });
  } catch (error: any) {
    console.error("[NOM-035 Action Plan ID API] Error in DELETE:", error);
    return ApiHandler.error(error.message || "Internal Server Error", error.status || 500);
  }
}
