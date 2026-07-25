import { NextRequest } from "next/server";
import { equipmentService } from "@/lib/services/equipment-service";
import { ApiHandler } from "@/lib/api/response";
import { requireTenant, requireAuth } from "@/lib/tenant-context";
import { z } from "zod";

const createComplianceServiceSchema = z.object({
  branchId: z.string().optional(),
  serviceType: z.string().min(1, "El tipo de servicio es requerido"),
  serviceName: z.string().min(1, "El nombre del servicio es requerido"),
  regulationReference: z.string().optional(),
  isMandatory: z.boolean().optional(),
  frequency: z.string().min(1, "La frecuencia es requerida"),
  customDays: z.number().optional(),
  providerId: z.string().optional(),
  providerName: z.string().optional(),
  providerContact: z.string().optional(),
  nextServiceDate: z.string().optional(),
  serviceAreas: z.array(z.string()).optional(),
  specialInstructions: z.string().optional(),
  workflowTemplateId: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      return ApiHandler.error(new Error("Unauthorized"), 401);
    }

    const { searchParams } = new URL(request.url);
    const branchIdParam = searchParams.get("branchId");
    const targetBranchId = branchIdParam || tenant.branchId || undefined;

    const services = await equipmentService.getComplianceServicesByBranch(targetBranchId, tenant.id);

    return ApiHandler.success(services);
  } catch (error) {
    return ApiHandler.error(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth();
    const tenant = await requireTenant();

    if (!tenant.id) {
      return ApiHandler.error(new Error("Unauthorized"), 401);
    }

    const body = await request.json();
    const validatedData = createComplianceServiceSchema.parse(body);

    const targetBranchId = validatedData.branchId || tenant.branchId;
    if (!targetBranchId) {
      return ApiHandler.error(new Error("Sucursal requerida"), 400);
    }

    const service = await equipmentService.createComplianceService({
      companyId: tenant.id,
      branchId: targetBranchId,
      serviceType: validatedData.serviceType,
      serviceName: validatedData.serviceName,
      regulationReference: validatedData.regulationReference,
      isMandatory: validatedData.isMandatory ?? true,
      frequency: validatedData.frequency,
      customDays: validatedData.customDays,
      providerId: validatedData.providerId || undefined,
      providerName: validatedData.providerName,
      providerContact: validatedData.providerContact,
      nextServiceDate: validatedData.nextServiceDate ? new Date(validatedData.nextServiceDate) : undefined,
      serviceAreas: validatedData.serviceAreas || [],
      specialInstructions: validatedData.specialInstructions,
      workflowTemplateId: validatedData.workflowTemplateId || undefined,
    }, user.id);

    return ApiHandler.success(service, 201);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
