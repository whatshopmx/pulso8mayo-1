import { NextRequest } from "next/server";
import { z } from "zod";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import {
    confirmMatch,
    ignoreTransaction,
    importBankStatement,
    listBankTransactions,
    suggestMatches,
    unmatchTransaction,
} from "@/lib/services/bank-statement-service";

/**
 * Movimientos bancarios y su conciliación contra corridas liquidadas.
 *
 * Perfiles de permiso espejo de `reconciliation/upload` (direccion de dinero
 * ya concretada): leer es `reports:read`, importar estado de cuenta y cruzar
 * es `reports:update`, todo con clasificación FINANCIAL y auditoría. Importar
 * es escribir dinero que el banco dice haber movido — no es lectura.
 *
 * El CSV viaja como texto en `csvText` (el cliente leer el File): el
 * fingerprint hace que reimportar el mismo estado sea un no-op, así que el
 * mando natural del usuario termina en "descargado del banco, pegado, listo".
 */

const importSchema = z.object({
    csvText: z.string().min(1, "El contenido del estado de cuenta es obligatorio."),
    sourceBankAccountId: z.string().uuid("La cuenta de origen es inválida.").optional().nullable(),
});

const patchSchema = z.discriminatedUnion("action", [
    z.object({
        action: z.literal("CONFIRM_MATCH"),
        transactionId: z.string().uuid(),
        paymentRunItemId: z.string().uuid(),
        notes: z.string().max(500).optional(),
    }),
    z.object({
        action: z.literal("UNMATCH"),
        transactionId: z.string().uuid(),
    }),
    z.object({
        action: z.literal("IGNORE"),
        transactionId: z.string().uuid(),
        notes: z.string().max(500).optional(),
    }),
]);

/**
 * GET /api/finance/bank-transactions — movimientos + resumen.
 *
 * Filtros: cuenta de origen, estado de match y rango de fechas (valor).
 */
export async function GET(req: NextRequest) {
    try {
        const { ctx } = await requirePermissionApi("reports", "read", {
            classification: "FINANCIAL",
            audit: { action: "READ", req },
        });

        const sp = req.nextUrl.searchParams;
        const page = await listBankTransactions({
            companyId: ctx.userCompanyId,
            matchStatus: (sp.get("matchStatus") as "UNMATCHED" | "MATCHED" | "IGNORED") || undefined,
            sourceBankAccountId: sp.get("sourceBankAccountId") || undefined,
            startDate: sp.get("startDate") || undefined,
            endDate: sp.get("endDate") || undefined,
            limit: sp.get("limit") ? parseInt(sp.get("limit")!, 10) : undefined,
            offset: sp.get("offset") ? parseInt(sp.get("offset")!, 10) : undefined,
        });

        // Las sugerencias viajan en la misma respuesta: la bandeja pregunta
        // "qué puedo cruzar hoy" y la sugerencia es la mitad de la respuesta.
        const suggestions = await suggestMatches({ companyId: ctx.userCompanyId });

        return ApiHandler.success({ ...page, suggestions });
    } catch (error) {
        return ApiHandler.error(error);
    }
}

/**
 * POST /api/finance/bank-transactions — importa un estado de cuenta CSV.
 *
 * Idempotente por fingerprint: reimportar el mismo archivo no mueve filas.
 */
export async function POST(req: NextRequest) {
    try {
        const { ctx } = await requirePermissionApi("reports", "update", {
            classification: "FINANCIAL",
            audit: { action: "UPDATE", req },
        });

        const body = importSchema.parse(await req.json());

        const result = await importBankStatement({
            companyId: ctx.userCompanyId,
            csvText: body.csvText,
            sourceBankAccountId: body.sourceBankAccountId ?? null,
            importedBy: ctx.userId,
        });

        return ApiHandler.success(result);
    } catch (error) {
        return ApiHandler.error(error);
    }
}

/**
 * PATCH /api/finance/bank-transactions — confirmar match, deshacer o ignorar.
 *
 * CONFIRM_MATCH valida monto espejo en servidor: la sugerencia de la UI es
 * un atajo, no la fuente de verdad.
 */
export async function PATCH(req: NextRequest) {
    try {
        const { ctx } = await requirePermissionApi("reports", "update", {
            classification: "FINANCIAL",
            audit: { action: "UPDATE", req },
        });

        const body = patchSchema.parse(await req.json());

        if (body.action === "CONFIRM_MATCH") {
            await confirmMatch({
                companyId: ctx.userCompanyId,
                transactionId: body.transactionId,
                paymentRunItemId: body.paymentRunItemId,
                userId: ctx.userId,
                notes: body.notes,
            });
            return ApiHandler.success({ ok: true });
        }

        if (body.action === "UNMATCH") {
            await unmatchTransaction({
                companyId: ctx.userCompanyId,
                transactionId: body.transactionId,
            });
            return ApiHandler.success({ ok: true });
        }

        await ignoreTransaction({
            companyId: ctx.userCompanyId,
            transactionId: body.transactionId,
            userId: ctx.userId,
            notes: body.notes,
        });
        return ApiHandler.success({ ok: true });
    } catch (error) {
        return ApiHandler.error(error);
    }
}
