import { z } from "zod";
import { withRoleAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { assertBranchOfCompany } from "@/lib/branch-scope";
import { db } from "@/lib/db";
import { dailySalesCuts, branches, users } from "@/lib/db/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { checkCashVarianceAndAlertSafe } from "@/lib/services/cash-variance-alert-service";

/**
 * Ventas se lee y se captura con los mismos roles que Finanzas: aquí están el
 * corte del día, el arqueo de caja y las plantillas con que se ingesta el POS.
 * `EMPLEADO` y `READONLY` quedan fuera — el primero no responde por el dinero,
 * el segundo existe para consultar operación, no tesorería.
 *
 * Misma lista que `ROLES_FINANZAS` en `app/api/expenses/route.ts` y que la
 * entrada `/dashboard/sales` de `ROUTE_PERMISSIONS`. Cerrar sólo la ruta del
 * dashboard no basta: un `fetch` a la API no pasa por el mismo camino que el
 * navegador.
 */
const ROLES_VENTAS = ["SUPER_ADMIN", "ADMIN", "GERENTE", "SUPERVISOR"] as const;

const createCutSchema = z.object({
  branchId: z.string().uuid("La sucursal es inválida."),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido (YYYY-MM-DD)."),
  shift: z.enum(["MATUTINO", "VESPERTINO", "COMPLETO"]),
  channel: z.enum(["SALON", "DELIVERY", "EVENTOS", "TOTAL"]).default("TOTAL"),
  totalSales: z.number().int().positive("La venta total debe ser mayor a cero."), // in cents
  cashSales: z.number().int().nonnegative().nullable().optional(), // in cents
  cardSales: z.number().int().nonnegative().nullable().optional(), // in cents
  otherPayments: z.number().int().nonnegative().nullable().optional(), // in cents
  ticketCount: z.number().int().positive().nullable().optional(),
  cashCountedCents: z.number().int().nonnegative().nullable().optional(), // Fase 2
  depositedCents: z.number().int().nonnegative().nullable().optional(), // Fase 2
  aggregatorSales: z.record(z.string(), z.number().int().nonnegative()).nullable().optional(), // Fase 3
});

export const GET = withRoleAuth([...ROLES_VENTAS], async (req, { auth }) => {
  // El `try/catch` se conserva dentro del wrapper: `withRoleAuth` traduce
  // `ApiError`, pero un `ZodError` caería a 500 y aquí ya devolvía 400.
  try {
    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    const conditions = [eq(dailySalesCuts.companyId, auth.tenantId)];

    if (branchId) {
      conditions.push(eq(dailySalesCuts.branchId, branchId));
    }
    if (startDate) {
      conditions.push(gte(dailySalesCuts.businessDate, startDate));
    }
    if (endDate) {
      conditions.push(lte(dailySalesCuts.businessDate, endDate));
    }

    const results = await db
      .select({
        id: dailySalesCuts.id,
        branchId: dailySalesCuts.branchId,
        branchName: branches.name,
        businessDate: dailySalesCuts.businessDate,
        shift: dailySalesCuts.shift,
        channel: dailySalesCuts.channel,
        totalSales: dailySalesCuts.totalSales,
        cashSales: dailySalesCuts.cashSales,
        cardSales: dailySalesCuts.cardSales,
        otherPayments: dailySalesCuts.otherPayments,
        cashCountedCents: dailySalesCuts.cashCountedCents,
        depositedCents: dailySalesCuts.depositedCents,
        aggregatorSales: dailySalesCuts.aggregatorSales,
        ticketCount: dailySalesCuts.ticketCount,
        avgTicket: dailySalesCuts.avgTicket,
        source: dailySalesCuts.source,
        rawFileUrl: dailySalesCuts.rawFileUrl,
        status: dailySalesCuts.status,
        validationNotes: dailySalesCuts.validationNotes,
        receivedByName: users.name,
        receivedAt: dailySalesCuts.receivedAt,
        createdAt: dailySalesCuts.createdAt,
      })
      .from(dailySalesCuts)
      .leftJoin(branches, eq(dailySalesCuts.branchId, branches.id))
      .leftJoin(users, eq(dailySalesCuts.receivedBy, users.id))
      .where(and(...conditions))
      .orderBy(desc(dailySalesCuts.businessDate), desc(dailySalesCuts.shift));

    return ApiHandler.success(results);
  } catch (error) {
    return ApiHandler.error(error);
  }
});

export const POST = withRoleAuth([...ROLES_VENTAS], async (req, { auth }) => {
  try {
    const body = await req.json();
    const data = createCutSchema.parse(body);

    // Ventas no tiene servicio: el corte se arma y se inserta aquí, así que la
    // frontera de tenant se comprueba aquí. Va antes del chequeo de duplicados
    // para no responder "ya existe un corte" sobre la sucursal de otra empresa.
    await assertBranchOfCompany(auth.tenantId, data.branchId);

    // Duplicate check
    const existing = await db
      .select()
      .from(dailySalesCuts)
      .where(
        and(
          eq(dailySalesCuts.companyId, auth.tenantId),
          eq(dailySalesCuts.branchId, data.branchId),
          eq(dailySalesCuts.businessDate, data.businessDate),
          eq(dailySalesCuts.shift, data.shift),
          eq(dailySalesCuts.channel, data.channel)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      throw new ApiError(
        `Ya existe un corte (${data.channel}) para esta sucursal el ${data.businessDate} en turno ${data.shift}.`,
        409
      );
    }

    // Mathematical consistency check (payment methods sum ≈ totalSales, ±2%)
    const cash = data.cashSales ?? 0;
    const card = data.cardSales ?? 0;
    const other = data.otherPayments ?? 0;
    const sum = cash + card + other;

    let status: "VALIDATED" | "PENDING_REVIEW" = "VALIDATED";
    let validationNotes: string | null = null;

    if (
      (data.cashSales !== undefined && data.cashSales !== null) ||
      (data.cardSales !== undefined && data.cardSales !== null) ||
      (data.otherPayments !== undefined && data.otherPayments !== null)
    ) {
      if (sum !== data.totalSales) {
        const diff = Math.abs(sum - data.totalSales);
        const pct = ((diff / data.totalSales) * 100).toFixed(1);
        if (diff > Math.round(data.totalSales * 0.02)) {
          status = "PENDING_REVIEW";
          validationNotes = `La suma de formas de pago (${formatMXN(sum)}) no cuadra con el total (${formatMXN(data.totalSales)}): diferencia del ${pct}%.`;
        }
      }
    }

    // Fase 2: si el formulario trae arqueo, exigir que coexista con efectivo para
    // evitar un registro incoherente.
    if (data.cashSales && data.cashSales > 0 && data.cashCountedCents == null) {
      throw new ApiError(
        "Captura el arqueo de caja (efectivo contado) cuando declaras ventas en efectivo.",
        400
      );
    }

    const [inserted] = await db
      .insert(dailySalesCuts)
      .values({
        companyId: auth.tenantId,
        branchId: data.branchId,
        businessDate: data.businessDate,
        shift: data.shift,
        channel: data.channel,
        totalSales: data.totalSales,
        cashSales: data.cashSales || null,
        cardSales: data.cardSales || null,
        otherPayments: data.otherPayments || null,
        cashCountedCents: data.cashCountedCents || null,
        depositedCents: data.depositedCents || null,
        aggregatorSales: data.aggregatorSales || null,
        ticketCount: data.ticketCount || null,
        avgTicket:
          data.ticketCount && data.ticketCount > 0
            ? Math.round(data.totalSales / data.ticketCount)
            : null,
        source: "MANUAL_FORM",
        status,
        validationNotes,
        receivedBy: auth.user.id,
      })
      .returning();

    // El arqueo con diferencia deja de morir en una celda roja: emite evento y
    // avisa a dirección y gerencia. Fire-and-forget — el corte ya está guardado
    // y es el dato primario.
    checkCashVarianceAndAlertSafe({
      id: inserted.id,
      companyId: inserted.companyId,
      branchId: inserted.branchId,
      businessDate: inserted.businessDate,
      shift: inserted.shift,
      cashSales: inserted.cashSales,
      cashCountedCents: inserted.cashCountedCents,
    });

    return ApiHandler.success(inserted);
  } catch (error) {
    return ApiHandler.error(error);
  }
});

function formatMXN(cents: number): string {
  return (cents / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}
