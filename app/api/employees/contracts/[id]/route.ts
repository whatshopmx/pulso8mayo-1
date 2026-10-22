import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/tenant-context";
import { db } from "@/lib/db";
import { employeeContracts } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { hasPermission, type Role } from "@/lib/permissions";
import { getTenantOperatingConfig } from "@/lib/services/tenant-config-service";
import { resolvePayrollPracticeMode } from "@/lib/services/employee-service";
import { AuditService } from "@/lib/services/audit-service";
import { isApiError, ApiError } from "@/lib/api/error";

/**
 * Task 10 plan-aguinaldo — edición de compensación del contrato.
 *
 * Ruta enfocada: sólo campo de compensación (`baseSalaryCents`,
 * `effectiveSalaryCents`), nunca datos de vida/laborales del contrato. Le da a
 * la UI de perfil/contrato un camino de escritura Y verificable mientras el
 * CRUD completo vive en otro lugar, y cumple la regla del sub-registro: la
 * parte en efectivo es DERIVADA — no hay campo suelto para capturarla; el
 * inquilino captura el salario efectivo real y el gap se calcula solo.
 *
 * Capturar `effectiveSalaryCents` exige `payrollPracticeMode = MIXED` a nivel
 * de servicio, no sólo en la UI: la UI lo oculta, el servidor lo rechaza.
 */

const patchSchema = z
    .object({
        baseSalaryCents: z
            .number()
            .int("El salario debe enviarse en centavos enteros, sin decimales.")
            .min(0, "El salario no puede ser negativo.")
            .max(2147483647, "El monto excede el máximo soportado.")
            .optional(),
        effectiveSalaryCents: z
            .number()
            .int("El salario efectivo debe enviarse en centavos enteros, sin decimales.")
            .min(0, "El salario efectivo no puede ser negativo.")
            .max(2147483647)
            .nullable()
            .optional(),
    })
    .refine((data) => data.baseSalaryCents !== undefined || data.effectiveSalaryCents !== undefined, {
        message: "No se enviaron campos de compensación para actualizar.",
    });

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getSession();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Empleados jamás editan su propia compensación; sólo roles con permiso
        // de usuarios (OWNER/SUPER_ADMIN/ADMIN/GERENTE).
        if (!hasPermission(session.user.role as Role, "users", "update")) {
            throw ApiError.forbidden("No puedes editar la compensación de un contrato.");
        }

        const tenant = await getCurrentTenant();
        const companyId = tenant.id;
        if (!companyId) {
            throw ApiError.forbidden("No hay una empresa seleccionada.");
        }

        const contractId = (await params).id;
        const data = patchSchema.parse(await request.json());

        const contract = await db.query.employeeContracts.findFirst({
            where: and(
                eq(employeeContracts.id, contractId),
                eq(employeeContracts.companyId, companyId)
            ),
        });
        if (!contract) {
            throw ApiError.notFound("Contrato no encontrado.");
        }

        if (data.effectiveSalaryCents !== undefined) {
            const config = await getTenantOperatingConfig(companyId);
            const mode = resolvePayrollPracticeMode(config.payrollPracticeMode);
            if (mode !== "MIXED") {
                throw ApiError.badRequest(
                    "La práctica de nómina del grupo es FORMAL: no se puede capturar salario efectivo. Configúrala como MIXED si aplica."
                );
            }
        }

        const updates: Partial<typeof employeeContracts.$inferInsert> = {
            updatedAt: new Date(),
        };
        if (data.baseSalaryCents !== undefined) {
            updates.baseSalary = data.baseSalaryCents;
        }
        if (data.effectiveSalaryCents !== undefined) {
            updates.effectiveSalaryCents = data.effectiveSalaryCents;
        }

        const [updated] = await db
            .update(employeeContracts)
            .set(updates)
            .where(eq(employeeContracts.id, contractId))
            .returning();

        try {
            await AuditService.logEmployeeAction({
                userId: contract.userId,
                performedBy: session.user.id,
                action: "UPDATE",
                entityType: "CONTRACT",
                entityId: contractId,
                fieldName: "COMPENSATION",
                oldValue: {
                    baseSalary: contract.baseSalary,
                    effectiveSalaryCents: contract.effectiveSalaryCents ?? null,
                },
                newValue: {
                    baseSalary: updated.baseSalary,
                    effectiveSalaryCents: updated.effectiveSalaryCents ?? null,
                },
            });
        } catch (auditError) {
            console.error("[contract-compensation] No se pudo auditar el cambio:", auditError);
        }

        return NextResponse.json({ data: updated, success: true });
    } catch (error) {
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: error.issues[0]?.message ?? "Datos inválidos" },
                { status: 400 }
            );
        }
        console.error("Error updating contract compensation:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
