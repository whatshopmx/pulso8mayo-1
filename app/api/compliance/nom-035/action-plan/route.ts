import { NextRequest } from "next/server";
import { ApiHandler } from "@/lib/api/response";
import { requireTenant } from "@/lib/tenant-context";
import { NOM035Service } from "@/lib/services/compliance/nom035-service";
import { z } from "zod";

const createActionPlanSchema = z.object({
  branchId: z.string().uuid().optional(),
  title: z.string().min(1, "El título es obligatorio"),
  description: z.string().optional(),
  riskCategory: z.string().default("GENERAL"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  status: z.enum(["PENDING", "IN_PROGRESS", "RESOLVED", "CANCELLED"]).default("PENDING"),
  assignedTo: z.string().optional(),
  dueDate: z.string().optional().transform(val => val ? new Date(val) : undefined),
  remediationMeasures: z.array(z.any()).default([]),
  evidenceUrl: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      return ApiHandler.error("Tenant ID is required", 400);
    }

    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get("branchId") || undefined;
    const status = searchParams.get("status") || undefined;
    const priority = searchParams.get("priority") || undefined;

    const plans = await NOM035Service.getActionPlans(tenant.id, {
      branchId,
      status,
      priority,
    });

    return ApiHandler.success(plans);
  } catch (error: any) {
    console.error("[NOM-035 Action Plan API] Error in GET:", error);
    return ApiHandler.error(error.message || "Internal Server Error", error.status || 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      return ApiHandler.error("Tenant ID is required", 400);
    }

    const body = await request.json();
    const result = createActionPlanSchema.safeParse(body);

    if (!result.success) {
      return ApiHandler.error(result.error.issues[0]?.message || "Invalid payload", 400);
    }

    const newPlan = await NOM035Service.createActionPlan({
      ...result.data,
      companyId: tenant.id,
      branchId: result.data.branchId || tenant.branchId || undefined,
    });

    return ApiHandler.success(newPlan, 201);
  } catch (error: any) {
    console.error("[NOM-035 Action Plan API] Error in POST:", error);
    return ApiHandler.error(error.message || "Internal Server Error", error.status || 500);
  }
}
