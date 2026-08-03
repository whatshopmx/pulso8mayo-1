import { NextRequest } from "next/server";
import { ApiHandler } from "@/lib/api/response";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { z } from "zod";
import { ExternalReportService, ExternalReportType } from "@/lib/services/external-report-service";

const generateTokenSchema = z.object({
    reportType: z.enum(["NOM-251", "NOM-035", "LABOR_LAW"]),
    branchId: z.string().uuid(),
    startDate: z.string().refine((v) => !isNaN(Date.parse(v)), "startDate inválida"),
    endDate: z.string().refine((v) => !isNaN(Date.parse(v)), "endDate inválida"),
    recipientName: z.string().min(1, "recipientName requerido"),
    recipientRole: z.string().min(1, "recipientRole requerido"),
    expiresInDays: z.number().int().min(1).max(7).optional(),
});

/**
 * POST /api/external-reports/generate
 * Minta un token JWT de corta duración (máx. 7 días, AD-4) para que un
 * externo (auditor, contador, proveedor) acceda de solo lectura a un reporte.
 * Solo ADMIN/SUPERVISOR/GERENTE.
 */
export async function POST(req: NextRequest) {
    try {
        const { user } = await requireAuth();
        const tenant = await requireTenant();

        if (!tenant.id) {
            return ApiHandler.error(new Error("Unauthorized: Company ID required"), 401);
        }

        if (user.role !== "ADMIN" && user.role !== "SUPERVISOR" && user.role !== "GERENTE" && user.role !== "SUPER_ADMIN") {
            return ApiHandler.error(new Error("Forbidden: Insufficient permissions"), 403);
        }

        const body = await req.json();
        const parsed = generateTokenSchema.parse(body);

        const result = await ExternalReportService.generateExternalToken({
            reportType: parsed.reportType as ExternalReportType,
            companyId: tenant.id,
            branchId: parsed.branchId,
            startDate: new Date(parsed.startDate),
            endDate: new Date(parsed.endDate),
            recipientName: parsed.recipientName,
            recipientRole: parsed.recipientRole,
            expiresInDays: parsed.expiresInDays,
        });

        return ApiHandler.success(result, 201);
    } catch (error) {
        console.error("Error generating external report token:", error);
        if (error instanceof z.ZodError) {
            return ApiHandler.error(
                new Error(`Validación: ${error.issues.map((e) => e.message).join(", ")}`),
                400
            );
        }
        return ApiHandler.error(error);
    }
}