import { NextRequest } from "next/server";
import { z } from "zod";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import { validateInvoice } from "@/lib/services/fiscal-service";

const validateSchema = z.object({
  emisorRfc: z.string().min(12, "RFC del emisor inválido (12-13 caracteres).").max(13),
  receptorRfc: z.string().min(12, "RFC del receptor inválido.").max(13),
  uuid: z.string().min(36, "UUID inválido.").max(36),
  totalCents: z.number().int().positive("El monto debe ser positivo."),
  fechaEmision: z.string().min(1, "La fecha de emisión es requerida."),
});

/**
 * POST /api/finance/fiscal/validate-invoice
 * Validates a CFDI invoice against the SAT via FiscalAPI.
 *
 * Migrated to `requirePermissionApi('reports','read', { classification:
 * 'FINANCIAL' })` (Sprint 2 Track B). The redundant `requireAuth()` call is
 * dropped — `requirePermissionApi` authenticates via `requireRoleApi` (throws
 * 401 unauthenticated), so authentication is preserved. Read action: this
 * route validates a CFDI without persisting anything.
 */
export async function POST(req: NextRequest) {
  try {
    await requirePermissionApi("reports", "read", {
      classification: "FINANCIAL",
      audit: { action: "READ", req },
    });

    const body = await req.json();
    const data = validateSchema.parse(body);

    const result = await validateInvoice(data);
    return ApiHandler.success(result);
  } catch (error) {
    return ApiHandler.error(error);
  }
}