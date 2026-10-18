import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, getTableColumns } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { equipmentMaintenanceHistory, branchEquipments } from "@/lib/db/schema";
import { ApiError } from "@/lib/api/error";
import { ApiHandler } from "@/lib/api/response";
import { requireTenant, requireAuth } from "@/lib/tenant-context";
import type { Role } from "@/lib/permissions";
import { resolveEquipmentScope } from "@/lib/equipment/scope";
import { equipmentService } from "@/lib/services/equipment-service";

/**
 * Alta general de mantenimiento (sin equipo en la URL).
 *
 * La versión anterior aceptaba `equipmentId` del cuerpo y escribía sin mirar de
 * quién era el equipo: insertaba el registro y actualizaba
 * `branchEquipments.lastMaintenanceDate` filtrando sólo por `id`. Con el id en
 * la mano se programaba mantenimiento sobre equipos de otra empresa y se
 * adelantaba su último mantenimiento. Tampoco exigía rol: un `EMPLEADO` podía
 * crear el registro.
 *
 * Ahora la ruta usa la misma guarda que el expediente por ID
 * (`equipmentService.getEquipmentInScope`): el equipo tiene que ser de esta
 * empresa y estar dentro del alcance del usuario. Empresa, sucursal y autor
 * salen del servidor, nunca del cuerpo. Programar un mantenimiento **no** toca
 * `lastMaintenanceDate`: esa fecha sólo la fija el cierre real
 * (`completeMaintenance`), no una cita futura.
 */

/** Sólo mandos programan mantenimiento. Mismo criterio que el resto de Equipos. */
const ROLES_PROGRAMAR: Role[] = [
  "SUPER_ADMIN",
  "ADMIN",
  "GERENTE",
  "SUPERVISOR",
];

const createMaintenanceSchema = z.object({
  equipmentId: z.string().uuid("El equipo es inválido."),
  maintenanceType: z.enum([
    "PREVENTIVE",
    "CORRECTIVE",
    "INSPECTION",
    "CLEANING",
    "CALIBRATION",
    "EMERGENCY",
  ]),
  scheduledDate: z.string().min(1, "La fecha programada es requerida."),
  description: z.string().min(1, "La descripción es requerida."),
  providerType: z.enum(["INTERNAL", "EXTERNAL", "CERTIFIED"]).optional(),
  providerId: z.string().uuid().optional().nullable(),
  providerName: z.string().optional().nullable(),
  providerContact: z.string().optional().nullable(),
  technicianName: z.string().optional().nullable(),
  technicianLicense: z.string().optional().nullable(),
  estimatedDuration: z.number().optional().nullable(),
  isScheduled: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth();
    const tenant = await requireTenant();

    if (!tenant.id) {
      return ApiHandler.error(new Error("Unauthorized"), 401);
    }

    const { searchParams } = new URL(request.url);
    const equipmentId = searchParams.get("equipmentId");
    const status = searchParams.get("status");

    const scope = resolveEquipmentScope(
      user.role,
      user.branchId ?? null,
      tenant.branchId ?? null
    );

    // Un rol de sucursal sin sucursal asignada ve cero, nunca el grupo entero.
    if (scope.kind === "NONE") {
      return NextResponse.json([]);
    }

    const conditions = [eq(equipmentMaintenanceHistory.companyId, tenant.id)];
    if (scope.kind === "BRANCH") {
      conditions.push(eq(equipmentMaintenanceHistory.branchId, scope.branchId));
    }
    if (equipmentId) {
      conditions.push(eq(equipmentMaintenanceHistory.equipmentId, equipmentId));
    }
    if (status) {
      conditions.push(eq(equipmentMaintenanceHistory.status, status as never));
    }

    const rows = await db
      .select({
        ...getTableColumns(equipmentMaintenanceHistory),
        equipmentName: branchEquipments.name,
      })
      .from(equipmentMaintenanceHistory)
      .leftJoin(
        branchEquipments,
        eq(equipmentMaintenanceHistory.equipmentId, branchEquipments.id)
      )
      .where(and(...conditions))
      .orderBy(desc(equipmentMaintenanceHistory.scheduledDate));

    return NextResponse.json(
      rows.map((row) => ({ ...row, equipmentName: row.equipmentName || "Unknown" }))
    );
  } catch (error) {
    console.error("Error fetching maintenance history:", error);
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

    if (!ROLES_PROGRAMAR.includes(user.role)) {
      throw ApiError.forbidden(
        "Tu rol no puede programar mantenimiento. Pide a un gerente o administrador que lo registre."
      );
    }

    // El cuerpo se valida antes de tocar la base: los campos de tenant/actor que
    // envíe el cliente se descartan aquí (zod sólo conserva las claves del
    // esquema), así que no pueden colarse en el INSERT.
    const body = await request.json();
    const data = createMaintenanceSchema.parse(body);

    const scope = resolveEquipmentScope(
      user.role,
      user.branchId ?? null,
      tenant.branchId ?? null
    );

    // El equipo del cuerpo, validado contra empresa y alcance: de ahí salen
    // `equipmentId`, empresa y sucursal del registro nuevo.
    const equipment = await equipmentService.getEquipmentInScope({
      equipmentId: data.equipmentId,
      companyId: tenant.id,
      scope,
    });

    const [created] = await db
      .insert(equipmentMaintenanceHistory)
      .values({
        ...data,
        equipmentId: equipment.id,
        companyId: tenant.id,
        branchId: equipment.branchId,
        status: "SCHEDULED",
        scheduledDate: new Date(data.scheduledDate),
        createdBy: user.id,
      })
      .returning();

    // Programar no es haber mantenido: `lastMaintenanceDate` sólo lo fija el
    // cierre real. Actualizarlo aquí marcaba como mantenido un equipo por una
    // cita que podía cancelarse.
    return ApiHandler.success(created, 201);
  } catch (error) {
    console.error("Error creating maintenance record:", error);
    return ApiHandler.error(error);
  }
}
