import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { dailySalesCuts, branches } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { checkCashVarianceAndAlertSafe } from "@/lib/services/cash-variance-alert-service";
import { buildAggregatorSalesMap } from "@/lib/sales/aggregator-sales-map";

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
  /**
   * Plataformas activas capturadas por el paso dinámico `paso-plataformas-<canal>`:
   * un mapa canal→centavos. Reemplaza la lista fija rappi/uber/didi, que se
   * conserva por compatibilidad. La llave se normaliza a la canónica.
   */
  plataformas: z.record(z.string(), z.number().int().min(0)).optional(),
  tickets: z.number().int().min(0).default(0),
  // Fase 2: arqueo físico (efectivo contado) y depósito del turno.
  // Opcionales en el schema; la validación de negocio exige arqueo si hay efectivo.
  arqueo: z.number().int().min(0).optional(),
  deposito: z.number().int().min(0).optional(),
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

    // Fase 2: el arqueo es obligatorio cuando hay efectivo declarado — sin él
    // el corte no es fiable (cashSales sería solo lo que el cajero declara).
    if (data.efectivo > 0 && data.arqueo === undefined) {
      throw ApiError.badRequest(
        "Captura el arqueo de caja (efectivo contado físicamente) para poder registrar el corte."
      );
    }

    // Convert dollar amounts from the form (which are in MXN dollars) to cents
    const efectivoCents = data.efectivo;
    const tarjetaCents = data.tarjeta;
    const cuponesCents = data.cupones;
    const aggregatorSales = buildAggregatorSalesMap({
      rappi: data.rappi,
      uber: data.uber,
      didi: data.didi,
      plataformas: data.plataformas,
    });
    const aggregatorsCents = Object.values(aggregatorSales ?? {}).reduce((a, b) => a + b, 0);
    const otherPayments = cuponesCents + aggregatorsCents;
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
        cashCountedCents: data.arqueo ?? null,
        depositedCents: data.deposito ?? null,
        aggregatorSales,
        ticketCount: data.tickets || null,
        source: "MANUAL_FORM",
        status: "PENDING_REVIEW",
        receivedBy: user.id,
        receivedAt: new Date(),
      })
      .returning();

    // El cajero acaba de declarar efectivo y contarlo. Si no cuadra, es el
    // momento en que alguien todavía puede recontar la caja.
    checkCashVarianceAndAlertSafe({
      id: cut.id,
      companyId: cut.companyId,
      branchId: cut.branchId,
      businessDate: cut.businessDate,
      shift: cut.shift,
      cashSales: cut.cashSales,
      cashCountedCents: cut.cashCountedCents,
    });

    return ApiHandler.success({
      cut,
      message: "Corte de caja registrado exitosamente.",
      workflowInstanceId: data.workflowInstanceId,
    });
  } catch (error) {
    return ApiHandler.error(error);
  }
}
