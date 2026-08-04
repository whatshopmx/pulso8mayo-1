import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { approveOperatingExpense } from "@/lib/services/expense-service";

const approveSchema = z.object({
  expenseId: z.string().uuid("El ID de gasto es inválido."),
  notes: z.string().optional().nullable(),
});

export async function POST(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }
    const { user } = await requireAuth();

    const body = await req.json();
    const data = approveSchema.parse(body);

    const updated = await approveOperatingExpense(
      data.expenseId,
      tenant.id,
      user.id,
      user.role || "EMPLEADO",
      data.notes || undefined
    );

    return ApiHandler.success(updated);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
