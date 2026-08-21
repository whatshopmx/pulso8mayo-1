import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { assertBranchOfCompany } from "@/lib/branch-scope";
import {
  getFund,
  openFund,
  registerOutflow,
  replenishFund,
} from "@/lib/services/petty-cash-service";

const registerOutflowSchema = z.object({
  branchId: z.string().uuid("La sucursal es inválida."),
  amountCents: z.number().int().positive("El monto debe ser mayor a cero."),
  concept: z.string().min(1, "El concepto es requerido."),
  category: z
    .enum(["RENTA", "SERVICIOS", "MANTENIMIENTO", "PUBLICIDAD", "SERVICIOS_PROFESIONALES", "OTROS"])
    .optional(),
  evidenceUrl: z.string().optional().nullable(),
  workflowInstanceId: z.string().optional().nullable(),
  approvedBy: z.string().optional().nullable(),
  authorizationNotes: z.string().optional().nullable(),
});

const openFundSchema = z.object({
  branchId: z.string().uuid("La sucursal es inválida."),
  fundAmountCents: z
    .number()
    .int()
    .positive("Indica el efectivo que se entregó a la sucursal."),
  lowThresholdCents: z.number().int().nonnegative().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const replenishSchema = z.object({
  branchId: z.string().uuid("La sucursal es inválida."),
  amountCents: z.number().int().positive("El monto debe ser mayor a cero."),
  notes: z.string().optional().nullable(),
});

export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }

    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId");

    if (!branchId) {
      throw ApiError.badRequest("El parámetro branchId es requerido.");
    }

    // La guarda de sucursal va en la ruta, no en `getFund`: la lectura se queda
    // pura, que es todo el punto de A1. `getFund` ya filtra por `company_id`, así
    // que una sucursal ajena devolvía `null` sin filtrarse nada; se rechaza de
    // todos modos para no responder "sin fondo" a una pregunta que no es tuya.
    await assertBranchOfCompany(tenant.id, branchId);

    // Lectura pura: `null` cuando la sucursal no tiene fondo abierto. Este GET
    // creaba el fondo, así que abrir la pantalla con alcance "todas" escribía
    // una fila por sucursal con $5,000 que nadie entregó.
    const fund = await getFund(tenant.id, branchId);
    return ApiHandler.success(fund);
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

    if (body.type === "OPEN") {
      const data = openFundSchema.parse(body);
      // Un umbral por encima del fondo nace en alerta y pide reposición desde el
      // primer día; es un error de captura, no un estado válido.
      if (
        data.lowThresholdCents != null &&
        data.lowThresholdCents > data.fundAmountCents
      ) {
        throw ApiError.badRequest(
          "El umbral de alerta no puede ser mayor al fondo entregado."
        );
      }
      const fund = await openFund({
        companyId: tenant.id,
        branchId: data.branchId,
        fundAmountCents: data.fundAmountCents,
        lowThresholdCents: data.lowThresholdCents ?? undefined,
        openedBy: user.id,
        notes: data.notes || undefined,
      });
      return ApiHandler.success(fund, 201);
    } else if (body.type === "REPLENISHMENT") {
      const data = replenishSchema.parse(body);
      const result = await replenishFund({
        companyId: tenant.id,
        branchId: data.branchId,
        amountCents: data.amountCents,
        registeredBy: user.id,
        notes: data.notes || undefined,
      });
      return ApiHandler.success(result);
    } else {
      const data = registerOutflowSchema.parse(body);
      const result = await registerOutflow({
        companyId: tenant.id,
        branchId: data.branchId,
        amountCents: data.amountCents,
        concept: data.concept,
        category: data.category,
        evidenceUrl: data.evidenceUrl || undefined,
        workflowInstanceId: data.workflowInstanceId || undefined,
        registeredBy: user.id,
        approvedBy: data.approvedBy || user.id,
        authorizationNotes: data.authorizationNotes || undefined,
      });
      return ApiHandler.success(result);
    }
  } catch (error) {
    return ApiHandler.error(error);
  }
}
