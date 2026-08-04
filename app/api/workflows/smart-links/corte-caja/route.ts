import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { dailySalesCuts, branches } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";

const corteSchema = z.object({
  workflowInstanceId: z.string().optional(),
  stepId: z.string().optional(),
  branchId: z.string().uuid("Sucursal inválida."),
  efectivo: z.number().int().min(0),
  tarjeta: z.number().int().min(0),
  cupones: z.number().int().min(0).default(0),
  rappi: z.number().int().min(0).default(0),
  uber: z.number().int().min(0).default(0),
  didi: z.number().int().min(0).default(0),
  tickets: z.number().int().min(0).default(0),
});

/**
 * POST /api/workflows/smart-links/corte-caja
 * Receives cashier's sales cut data from the smart link form.
 * Creates a dailySalesCuts record for the branch and date.
 */
export async function POST(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }
    const { user } = await requireAuth();

    const body = await req.json();
    const data = corteSchema.parse(body);

    // Convert dollar amounts from the form (which are in MXN dollars) to cents
    const efectivoCents = data.efectivo;
    const tarjetaCents = data.tarjeta;
    const cuponesCents = data.cupones;
    const rappiCents = data.rappi;
    const uberCents = data.uber;
    const didiCents = data.didi;
    const otherPayments = cuponesCents + rappiCents + uberCents + didiCents;
    const totalSales = efectivoCents + tarjetaCents + otherPayments;

    if (totalSales <= 0) {
      throw ApiError.badRequest("El total de ventas debe ser mayor a cero.");
    }

    const today = new Date().toISOString().slice(0, 10);

    // Determine shift based on current time
    const hour = new Date().getHours();
    const shift = hour < 16 ? "MATUTINO" : "VESPERTINO";

    const [cut] = await db
      .insert(dailySalesCuts)
      .values({
        companyId: tenant.id,
        branchId: data.branchId,
        businessDate: today,
        shift,
        channel: "TOTAL",
        totalSales,
        cashSales: efectivoCents,
        cardSales: tarjetaCents,
        otherPayments,
        ticketCount: data.tickets || null,
        source: "MANUAL",
        status: "PENDING_REVIEW",
        receivedBy: user.id,
        receivedAt: new Date(),
      })
      .returning();

    return ApiHandler.success({
      cut,
      message: "Corte de caja registrado exitosamente.",
      workflowInstanceId: data.workflowInstanceId,
    });
  } catch (error) {
    return ApiHandler.error(error);
  }
}
