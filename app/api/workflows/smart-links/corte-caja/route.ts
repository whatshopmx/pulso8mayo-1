import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { dailySalesCuts, branches } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { checkCashVarianceAndAlertSafe } from "@/lib/services/cash-variance-alert-service";

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
  // Fase 2: arqueo físico (efectivo contado) y depósito del turno.
  // Opcionales en el schema; la validación de negocio exige arqueo si hay efectivo.
  arqueo: z.number().int().min(0).optional(),
  deposito: z.number().int().min(0).optional(),
});

// Fase 3: etiquetas conocidas de agregadores (rappi/uber/didi + genéricos).
function buildAggregatorSales(data: z.infer<typeof corteSchema>): Record<string, number> | null {
  const entries = [
    ["rappi", data.rappi],
    ["uber", data.uber],
    ["didi", data.didi],
  ] as const;
  const hasAny = entries.some(([, v]) => (v ?? 0) > 0);
  if (!hasAny) return null;
  const out: Record<string, number> = {};
  for (const [key, value] of entries) {
    out[key] = value ?? 0;
  }
  return out;
}

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
        cashCountedCents: data.arqueo ?? null,
        depositedCents: data.deposito ?? null,
        aggregatorSales: buildAggregatorSales(data),
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
