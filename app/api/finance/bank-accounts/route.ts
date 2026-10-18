import { NextRequest } from "next/server";
import { z } from "zod";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import {
    createCompanyBankAccount,
    deactivateCompanyBankAccount,
    listCompanyBankAccounts,
} from "@/lib/services/company-bank-account-service";

/**
 * Cuentas bancarias propias de la empresa — el lado pagador.
 *
 * El perfil de riesgo es opuesto al de payees/proveedores y por eso el
 * permiso es distinto: aquí la cuenta pertenece a la empresa, la capturan
 * ADMIN, y el fraude no es "cambiarle la cuenta a un tercero" sino registrar
 * una cuenta que no es del grupo. Lo que protege el catálogo es la
 * trazabilidad: cada cuenta queda firmada por quien la registró, se baja con
 * lógica (nunca se borra) y el selector de corridas del layout solo ofrece
 * cuentas activas.
 *
 * El "settings:update" exigido en POST/PATCH es la misma regla de
 * `payee-bank-accounts`: configuración financiera no se abre a GERENTE.
 */

const createSchema = z.object({
    label: z.string().min(1, "La etiqueta es obligatoria.").max(80),
    accountNumber: z.string().min(4, "El número de cuenta es obligatorio."),
    bankCode: z.string().regex(/^\d{3}$/, "Código Banxico inválido.").optional(),
    clabe: z.string().max(18).optional().nullable(),
    currency: z.string().max(3).optional(),
    notes: z.string().max(1000).optional(),
});

const deactivateSchema = z.object({
    accountId: z.string().uuid("La cuenta es inválida."),
});

/**
 * GET /api/finance/bank-accounts — catálogo seguro.
 *
 * Devuelve `accountLastFour`, nunca el número completo: es todo lo que la UI
 * muestra jamás.
 */
export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const activeOnly = searchParams.get("activeOnly") === "true";

        const { ctx } = await requirePermissionApi("reports", "read", {
            classification: "FINANCIAL",
            audit: { action: "READ", req },
        });

        const accounts = await listCompanyBankAccounts(ctx.userCompanyId, {
            activeOnly,
        });

        return ApiHandler.success(accounts);
    } catch (error) {
        return ApiHandler.error(error);
    }
}

/**
 * POST /api/finance/bank-accounts — registra una cuenta de origen.
 *
 * Valida el número (4-20 dígitos) y la CLABE opcional contra el dígito
 * verificador de Banxico; dedupe por fingerprint.
 */
export async function POST(req: NextRequest) {
    try {
        const { ctx } = await requirePermissionApi("settings", "update", {
            classification: "FINANCIAL",
            audit: { action: "UPDATE", req },
        });

        const body = createSchema.parse(await req.json());

        const account = await createCompanyBankAccount({
            companyId: ctx.userCompanyId,
            label: body.label,
            accountNumber: body.accountNumber,
            bankCode: body.bankCode,
            clabe: body.clabe || null,
            currency: body.currency,
            notes: body.notes,
            registeredBy: ctx.userId,
        });

        return ApiHandler.success(account);
    } catch (error) {
        return ApiHandler.error(error);
    }
}

/**
 * PATCH /api/finance/bank-accounts — baja lógica de una cuenta.
 *
 * `active=false` conserva la fila: el histórico de origen de pagos es
 * evidencia y no se borra.
 */
export async function PATCH(req: NextRequest) {
    try {
        const { ctx } = await requirePermissionApi("settings", "update", {
            classification: "FINANCIAL",
            audit: { action: "UPDATE", req },
        });

        const body = deactivateSchema.parse(await req.json());

        await deactivateCompanyBankAccount(body.accountId, ctx.userCompanyId);

        return ApiHandler.success({ ok: true });
    } catch (error) {
        return ApiHandler.error(error);
    }
}
