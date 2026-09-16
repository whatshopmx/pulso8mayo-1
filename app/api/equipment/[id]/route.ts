import { NextRequest } from "next/server";
import { equipmentService } from "@/lib/services/equipment-service";
import { ApiHandler } from "@/lib/api/response";
import { requireTenant, requireAuth } from "@/lib/tenant-context";
import { resolveEquipmentScope } from "@/lib/equipment/scope";
import { z } from "zod";

const updateEquipmentSchema = z.object({
  name: z.string().min(1).optional(),
  equipmentCode: z.string().min(1).optional(),
  brand: z.string().optional(),
  model: z.string().optional(),
  serialNumber: z.string().optional(),
  assetTag: z.string().optional(),
  location: z.string().optional(),
  area: z.string().optional(),
  specifications: z.record(z.string(), z.unknown()).optional(),
  purchaseDate: z.string().datetime().optional(),
  purchasePrice: z.number().optional(),
  vendor: z.string().optional(),
  vendorContact: z.string().optional(),
  invoiceNumber: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'UNDER_MAINTENANCE', 'OUT_OF_ORDER', 'DISPOSED']).optional(),
  statusReason: z.string().optional(),
  maintenanceFrequency: z.string().optional(),
  nextMaintenanceDate: z.string().datetime().optional(),
  lastMaintenanceDate: z.string().datetime().optional(),
  isCritical: z.boolean().optional(),
  notes: z.string().optional(),
});

/**
 * Expediente de un equipo: leerlo, editarlo y darlo de baja.
 *
 * Las tres rutas pasan por `getEquipmentInScope`, que resuelve dos fronteras de
 * una vez: la empresa (el `id` de otra empresa responde 404, igual que un id
 * inexistente, para no confirmar qué equipos existen fuera) y la sucursal
 * (403 si el equipo es de la empresa pero está fuera del alcance del usuario).
 *
 * El alcance se resuelve con la **sesión** —rol y sucursal asignada— y la
 * sucursal activa de la aplicación; nunca con la URL, que el llamador controla.
 * Antes de T03 estas rutas tomaban el `id` del path y lo pasaban al servicio
 * tal cual: quien tenía el id de un equipo ajeno lo leía y lo editaba.
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

    const detalle = await equipmentService.getEquipmentWithDetails(equipment);
    
    return ApiHandler.success(detalle);
  } catch (error) {
    return ApiHandler.error(error);
  }
}

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

    // La guarda va antes de leer el cuerpo: de un equipo fuera de tu alcance no
    // se responde ni siquiera con un 400 de validación, que confirmaría que el
    // id existe.
    const equipment = await equipmentService.getEquipmentInScope({
      equipmentId: id,
      companyId: tenant.id,
      scope,
    });

    const body = await req.json();
    const data = updateEquipmentSchema.parse(body);

    const actualizado = await equipmentService.updateEquipment(
      equipment.id,
      tenant.id,
      {
        ...data,
        purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : undefined,
        nextMaintenanceDate: data.nextMaintenanceDate ? new Date(data.nextMaintenanceDate) : undefined,
        lastMaintenanceDate: data.lastMaintenanceDate ? new Date(data.lastMaintenanceDate) : undefined,
      },
      tenant.userId
    );
    
    return ApiHandler.success(actualizado);
  } catch (error) {
    return ApiHandler.error(error);
  }
}

export async function DELETE(
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

    const baja = await equipmentService.deleteEquipment(equipment.id, tenant.id, tenant.userId);
    
    return ApiHandler.success(baja);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
