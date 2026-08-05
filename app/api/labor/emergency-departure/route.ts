import { NextRequest } from "next/server";
import { ApiHandler } from "@/lib/api/response";
import { requireTenant } from "@/lib/tenant-context";
import { getSession } from "@/lib/auth";
import { z } from "zod";
import { ShiftService } from "@/lib/services/shift-service";

const emergencyDepartureSchema = z.object({
  userId: z.string().min(1, "ID de empleado requerido"),
  branchId: z.string().uuid("ID de sucursal inválido"),
  reason: z.string().min(5, "El motivo debe tener al menos 5 caracteres"),
  targetUserId: z.string().optional(),
  notes: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      return ApiHandler.error(new Error("Sin empresa asignada"), { status: 403 });
    }

    const session = await getSession();
    const currentUserId = session?.user?.id;

    const body = await req.json();
    const validatedData = emergencyDepartureSchema.parse(body);

    const result = await ShiftService.registerEmergencyDeparture({
      userId: validatedData.userId,
      branchId: validatedData.branchId,
      companyId: tenant.id,
      reason: validatedData.reason,
      requestedBy: currentUserId || validatedData.userId,
      targetUserId: validatedData.targetUserId,
      notes: validatedData.notes,
    });

    return ApiHandler.success(result, {
      message: "Salida de emergencia registrada exitosamente. Tareas reasignadas."
    });
  } catch (error) {
    return ApiHandler.error(error);
  }
}
