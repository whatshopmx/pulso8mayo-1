import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import {
  createOperatingExpense,
  getOperatingExpenses,
} from "@/lib/services/expense-service";

const createExpenseSchema = z.object({
  branchId: z.string().uuid("La sucursal es inválida."),
  category: z.enum([
    "RENTA",
    "SERVICIOS",
    "MANTENIMIENTO",
    "PUBLICIDAD",
    "SERVICIOS_PROFESIONALES",
    "OTROS",
  ]),
  amountCents: z.number().int().positive("El monto debe ser mayor a cero."),
  description: z.string().min(1, "La descripción es requerida."),
  invoiceId: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  evidenceUrl: z.string().optional().nullable(),
  payeeId: z.string().uuid("La contraparte es inválida.").optional().nullable(),
});

export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }

    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId") || undefined;

    const expenses = await getOperatingExpenses(tenant.id, branchId);
    return ApiHandler.success(expenses);
  } catch (error) {
    return ApiHandler.error(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }
    const { user } = await requireAuth();

    const body = await req.json();
    const data = createExpenseSchema.parse(body);

    const expense = await createOperatingExpense({
      companyId: tenant.id,
      branchId: data.branchId,
      category: data.category,
      amountCents: data.amountCents,
      description: data.description,
      invoiceId: data.invoiceId || undefined,
      dueDate: data.dueDate || undefined,
      evidenceUrl: data.evidenceUrl || undefined,
      payeeId: data.payeeId || undefined,
      requestedBy: user.id,
      userRole: user.role || "GERENTE",
    });

    return ApiHandler.success(expense);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
