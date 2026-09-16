import { NextRequest } from "next/server";
import { equipmentService } from "@/lib/services/equipment-service";
import { ApiHandler } from "@/lib/api/response";
import { requireTenant, requireAuth } from "@/lib/tenant-context";
import { resolveEquipmentScope } from "@/lib/equipment/scope";
import { z } from "zod";

const createMaintenanceSchema = z.object({
  maintenanceType: z.enum(['PREVENTIVE', 'CORRECTIVE', 'INSPECTION', 'CLEANING', 'CALIBRATION', 'EMERGENCY']),
  scheduledDate: z.string().datetime(),
  description: z.string().min(1),
  providerType: z.enum(['INTERNAL', 'EXTERNAL', 'CERTIFIED']).optional(),
  providerName: z.string().optional(),
  providerContact: z.string().optional(),
  technicianName: z.string().optional(),
  technicianLicense: z.string().optional(),
  workflowInstanceId: z.string().uuid().optional(),
});

const completeMaintenanceSchema = z.object({
  workPerformed: z.string().min(1),
  tasksCompleted: z.array(z.object({
    task: z.string(),
    completed: z.boolean(),
    notes: z.string().optional(),
  })).optional(),
  partsUsed: z.array(z.object({
    name: z.string(),
    quantity: z.number(),
    cost: z.number().optional(),
    partNumber: z.string().optional(),
  })).optional(),
  partsCost: z.number().optional(),
  laborCost: z.number().optional(),
  totalCost: z.number().optional(),
  findings: z.string().optional(),
  recommendations: z.string().optional(),
  nextMaintenanceDate: z.string().datetime().optional(),
  beforePhotos: z.array(z.string()).optional(),
  afterPhotos: z.array(z.string()).optional(),
  documents: z.array(z.string()).optional(),
  signatureUrl: z.string().optional(),
  approvedBy: z.string().optional(),
});

/**
 * Mantenimiento de un equipo: historial, programación y cierre.
 *
 * Las tres rutas comparten la guarda del expediente (`getEquipmentInScope`): el
 * equipo del URL tiene que ser de esta empresa y estar dentro del alcance del
 * usuario. El cierre añade una segunda guarda, `getMaintenanceInScope`, porque
 * hasta T03 cerraba por el `maintenanceId` que llegaba en el **cuerpo** sin
 * mirar de quién era: con ese id en la mano se completaba mantenimiento de otra
 * empresa, y el cierre arrastraba además la fecha de último mantenimiento del
 * equipo ajeno.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user } = await requireAuth();
    const tenant = await requireTenant();
    const { id } = await params;
    
    if (!tenant.id) {
      return ApiHandler.error(new Error("Unauthorized"), 401);
    }

    const scope = resolveEquipmentScope(user.role, user.branchId ?? null, tenant.branchId ?? null);

    const equipment = await equipmentService.getEquipmentInScope({
      equipmentId: id,
      companyId: tenant.id,
      scope,
    });

    const url = new URL(req.url);
    const limit = url.searchParams.get("limit") 
      ? parseInt(url.searchParams.get("limit")!) 
      : undefined;

    const history = await equipmentService.getMaintenanceHistory(equipment.id, tenant.id, limit);
    
    return ApiHandler.success(history);
  } catch (error) {
    return ApiHandler.error(error);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user } = await requireAuth();
    const tenant = await requireTenant();
    const { id } = await params;
    
    if (!tenant.id) {
      return ApiHandler.error(new Error("Unauthorized"), 401);
    }

    const scope = resolveEquipmentScope(user.role, user.branchId ?? null, tenant.branchId ?? null);

    // El equipo del URL, ya validado contra empresa y sucursal: de ahí salen el
    // `equipmentId`, la empresa y la sucursal del registro nuevo, no del cuerpo
    // de la petición.
    const equipment = await equipmentService.getEquipmentInScope({
      equipmentId: id,
      companyId: tenant.id,
      scope,
    });

    const body = await req.json();
    const data = createMaintenanceSchema.parse(body);

    const maintenance = await equipmentService.createMaintenance(
      {
        equipmentId: equipment.id,
        companyId: tenant.id,
        branchId: equipment.branchId,
        ...data,
        scheduledDate: new Date(data.scheduledDate),
      },
      tenant.userId
    );
    
    return ApiHandler.success(maintenance, 201);
  } catch (error) {
    return ApiHandler.error(error);
  }
}

// PUT /api/equipment/[id]/maintenance - Complete maintenance
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user } = await requireAuth();
    const tenant = await requireTenant();
    const { id } = await params;
    
    if (!tenant.id) {
      return ApiHandler.error(new Error("Unauthorized"), 401);
    }

    const scope = resolveEquipmentScope(user.role, user.branchId ?? null, tenant.branchId ?? null);

    const body = await req.json();
    const { maintenanceId, ...data } = body;
    
    if (!maintenanceId) {
      return ApiHandler.error(new Error("maintenanceId is required"), 400);
    }

    // El `maintenanceId` viene del cuerpo y el equipo del URL: se exige que el
    // registro sea de *ese* equipo, de esta empresa y de una sucursal del
    // alcance antes de cerrarlo. Un id de otra empresa responde 404; uno de otra
    // sucursal, 403.
    await equipmentService.getMaintenanceInScope({
      maintenanceId,
      equipmentId: id,
      companyId: tenant.id,
      scope,
    });

    const validatedData = completeMaintenanceSchema.parse(data);

    const maintenance = await equipmentService.completeMaintenance(
      maintenanceId,
      tenant.id,
      {
        ...validatedData,
        nextMaintenanceDate: validatedData.nextMaintenanceDate 
          ? new Date(validatedData.nextMaintenanceDate) 
          : undefined,
      },
      tenant.userId
    );
    
    return ApiHandler.success(maintenance);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
