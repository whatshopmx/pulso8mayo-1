import { NextRequest } from "next/server";
import { equipmentService } from "@/lib/services/equipment-service";
import { ApiHandler } from "@/lib/api/response";
import { requireTenant, requireAuth } from "@/lib/tenant-context";
import { assertBranchOfCompany } from "@/lib/branch-scope";
import { resolveEquipmentScope } from "@/lib/equipment/scope";
import { z } from "zod";

const createEquipmentSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  equipmentCode: z.string().min(1, "El código es requerido"),
  type: z.string().min(1, "El tipo es requerido"),
  brand: z.string().optional(),
  model: z.string().optional(),
  serialNumber: z.string().optional(),
  assetTag: z.string().optional(),
  location: z.string().optional(),
  area: z.string().optional(),
  specifications: z.record(z.string(), z.unknown()).optional(),
  purchaseDate: z.string().optional(),
  purchasePrice: z.number().optional(),
  vendor: z.string().optional(),
  vendorContact: z.string().optional(),
  invoiceNumber: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'UNDER_MAINTENANCE', 'OUT_OF_ORDER', 'DISPOSED']).optional(),
  maintenanceFrequency: z.string().optional(),
  nextMaintenanceDate: z.string().optional(),
  isCritical: z.boolean().optional(),
  notes: z.string().optional(),
});

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

// POST /api/equipment - Create a new equipment
export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAuth();
    const tenant = await requireTenant();

    if (!tenant.id) {
      return ApiHandler.error(new Error("Unauthorized"), 401);
    }

    const branchId = tenant.branchId;
    if (!branchId) {
      return ApiHandler.error(new Error("Branch ID required"), 400);
    }

    const body = await req.json();
    const validatedData = createEquipmentSchema.parse(body);

    // Parse dates if provided
    const purchaseDate = validatedData.purchaseDate 
      ? new Date(validatedData.purchaseDate) 
      : undefined;
    const nextMaintenanceDate = validatedData.nextMaintenanceDate 
      ? new Date(validatedData.nextMaintenanceDate) 
      : undefined;

    const equipment = await equipmentService.createEquipment({
      companyId: tenant.id,
      branchId: branchId,
      name: validatedData.name,
      equipmentCode: validatedData.equipmentCode,
      type: validatedData.type,
      brand: validatedData.brand,
      model: validatedData.model,
      serialNumber: validatedData.serialNumber,
      assetTag: validatedData.assetTag,
      location: validatedData.location,
      area: validatedData.area,
      specifications: validatedData.specifications,
      purchaseDate: purchaseDate,
      purchasePrice: validatedData.purchasePrice,
      vendor: validatedData.vendor,
      vendorContact: validatedData.vendorContact,
      invoiceNumber: validatedData.invoiceNumber,
      status: validatedData.status || 'ACTIVE',
      maintenanceFrequency: validatedData.maintenanceFrequency,
      nextMaintenanceDate: nextMaintenanceDate,
      isCritical: validatedData.isCritical || false,
      notes: validatedData.notes,
    }, user.id);

    return ApiHandler.success(equipment, 201);
  } catch (error) {
    return ApiHandler.error(error);
  }
}

// GET /api/equipment - Inventario dentro del alcance autorizado
/**
 * Devuelve un arreglo, no un `{ items, scope }` como `/api/expenses`: cambiar la
 * forma rompería a los tres consumidores actuales (`use-equipment.ts`,
 * `maintenance-form.tsx`, la pantalla de equipos). El `scope` aplicado se
 * rotula cuando T10/T30 rehagan la pantalla; aquí el trabajo es que el
 * servidor no entregue filas que no le tocan.
 */
export async function GET(req: NextRequest) {
  try {
    const { user } = await requireAuth();
    const tenant = await requireTenant();

    if (!tenant.id) {
      return ApiHandler.error(new Error("Unauthorized"), 401);
    }

    const url = new URL(req.url);
    const pedidaEnQuery = url.searchParams.get("branchId");

    // La intención de sucursal sale del query y, si no viene, del alcance que ya
    // resolvió `requireTenant()` (cookie de sucursal / "Todas" / sesión), para
    // que la pantalla no anuncie "Todas" mientras esta ruta filtra por una
    // sucursal— o al revés.
    const intencion = pedidaEnQuery ?? tenant.branchId ?? null;

    // El `branchId` del query nunca llega al servicio sin pasar por aquí: un
    // GERENTE recibe su sucursal aunque pida otra, y un rol sin sucursal
    // asignada recibe `NONE` (cero filas), no la empresa entera.
    const scope = resolveEquipmentScope(user.role, user.branchId ?? null, intencion);

    // La sucursal pedida no viene de una parte confiable: se comprueba contra la
    // empresa antes de que llegue al `WHERE`. La de la sesión ya está validada
    // por construcción (misma empresa), y revalidarla convertiría una sucursal
    // borrada en un 400 de toda la pantalla.
    if (scope.kind === "BRANCH" && pedidaEnQuery) {
      await assertBranchOfCompany(tenant.id, scope.branchId);
    }

    const equipment = await equipmentService.getEquipmentByScope({
      companyId: tenant.id,
      scope,
    });

    return ApiHandler.success(equipment);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
