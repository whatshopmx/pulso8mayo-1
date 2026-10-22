import { NextRequest } from "next/server";
import { z } from "zod";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import {
    previsualizarAguinaldo,
    executeAguinaldoRun,
    registrarDispersionExcedente,
    listarDispersionesExcedente,
    AguinaldoRunDuplicadoError,
    AguinaldoDispersionInvalidaError,
    type AguinaldoPreview,
} from "@/lib/services/aguinaldo-payroll-service";
import { ApiError } from "@/lib/api/error";

const anioFiscalSchema = z.object({
    anioFiscal: z
        .number()
        .int()
        .min(1970)
        .max(2200)
        .default(new Date().getFullYear()),
    branchId: z.string().uuid().optional(),
    diasLaboradosPorUsuario: z.record(z.string().uuid(), z.number().int().min(0).max(366)).optional(),
    /** Task 11 (Q5): acción POST "EXECUTE" (default, timbrado) | "DISPERSION" (bitácora sin CFDI). */
    action: z.enum(["EXECUTE", "DISPERSION"]).default("EXECUTE"),
    // Sólo para action = DISPERSION: monto positivo en centavos y motivo obligatorio.
    dispersion: z
        .object({
            userId: z.string().uuid(),
            montoCents: z.number().int().positive().max(2147483647),
            motivo: z.string().trim().min(1).max(1000),
        })
        .optional(),
});

/**
 * GET /api/payroll/aguinaldo — preview del run por empleado.
 * POST /api/payroll/aguinaldo — ejecuta el timbrado extraordinario
 * (c_TipoNomina "E", CFDI 002 por empleado, periodo 1-ene a 31-dic del año).
 *
 * Igual que la nómina ordinaria, es una operación fiscal irreversible y con
 * costo de folios: solo ADMIN/OWNER/SUPER_ADMIN (`reports:manage`,
 * classification FINANCIAL); `companyId` y `userId` salen de la sesión.
 *
 * Ventana de diciembre (límite legal 19-dic, multa Art. 1002 LFT): ejecutar
 * fuera de DIC del año causado NO se bloquea (hay dispersión tardía legítima,
 * e inicios de año se paga el año anterior), pero la respuesta lo señala con
 * `windowWarning` para que el admin lo vea en su caja de confirmación.
 */
export async function GET(req: NextRequest) {
    try {
        const { ctx } = await requirePermissionApi("reports", "manage", {
            classification: "FINANCIAL",
            audit: { action: "READ", req },
        });

        const url = new URL(req.url);
        const parse = anioFiscalSchema.safeParse({
            anioFiscal: url.searchParams.get("anioFiscal")
                ? Number(url.searchParams.get("anioFiscal"))
                : new Date().getFullYear(),
            branchId: url.searchParams.get("branchId") ?? undefined,
        });
        if (!parse.success) {
            return ApiHandler.error(parse.error, 400);
        }

        // Bitácora de dispersiones de excedente en efectivo (Task 11).
        if (url.searchParams.get("dispersiones") === "1") {
            const dispersiones = await listarDispersionesExcedente(ctx.userCompanyId, parse.data.anioFiscal);
            return ApiHandler.success({ dispersiones });
        }

        const preview = await previsualizarAguinaldo(
            ctx.userCompanyId,
            parse.data.anioFiscal,
            parse.data.branchId
        );

        return ApiHandler.success(preview);
    } catch (error) {
        return ApiHandler.error(error);
    }
}

export async function POST(req: NextRequest) {
    try {
        const { ctx } = await requirePermissionApi("reports", "manage", {
            classification: "FINANCIAL",
            audit: { action: "UPDATE", req },
        });

        const body = await req.json();
        const data = anioFiscalSchema.parse(body);

        if (data.action === "DISPERSION") {
            // Task 11 (Q5): dispersión en efectivo del excedente con bitácora,
            // SIN CFDI — nunca se disfraza de percepción timbrada.
            if (!data.dispersion) {
                return ApiHandler.error(
                    ApiError.badRequest("La action DISPERSION requiere dispersion: { userId, montoCents, motivo }"),
                    400
                );
            }
            const row = await registrarDispersionExcedente(ctx.userCompanyId, {
                anioFiscal: data.anioFiscal,
                userId: data.dispersion.userId,
                montoCents: data.dispersion.montoCents,
                motivo: data.dispersion.motivo,
                performedBy: ctx.userId,
            });
            return ApiHandler.success({ dispersion: row });
        }

        const result = await executeAguinaldoRun(
            ctx.userCompanyId,
            data.anioFiscal,
            ctx.userId,
            { diasLaboradosPorUsuario: data.diasLaboradosPorUsuario },
            data.branchId
        );

        return ApiHandler.success({
            ...result,
            windowWarning: advertenciaVentana(data.anioFiscal),
        });
    } catch (error) {
        if (error instanceof AguinaldoRunDuplicadoError) {
            return ApiHandler.error(error, 409);
        }
        if (error instanceof AguinaldoDispersionInvalidaError) {
            return ApiHandler.error(error, 400);
        }
        return ApiHandler.error(error);
    }
}

/** mes de diciembre respecto del año causado */
function esDiciembreDelAnioCausado(anioFiscal: number): boolean {
    const hoy = new Date();
    return hoy.getFullYear() === anioFiscal && hoy.getMonth() === 11; // 0-index: 11 = DIC
}

/** Aviso no bloqueante si la dispersión cae fuera de la ventana de diciembre. */
function advertenciaVentana(anioFiscal: number): string | null {
    if (esDiciembreDelAnioCausado(anioFiscal)) return null;
    return `Estás dispersando el aguinaldo ${anioFiscal} fuera de diciembre del año causado (límite legal: 19-dic, multa Art. 1002 LFT). El CFDI usa el periodo 1-ene a 31-dic ${anioFiscal} igual si es tardío.`;
}
