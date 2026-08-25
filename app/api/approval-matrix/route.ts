import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { approvalMatrixRules } from "@/lib/db/schema";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { roleIsAtLeast } from "@/lib/permissions";
import { isApiError } from "@/lib/api/error";
import {
    replaceMatrixRules,
    validateMatrixRules,
} from "@/lib/services/approval-matrix-service";

const ruleSchema = z.object({
    amountMin: z.number().int().min(0),
    amountMax: z.number().int().min(0).nullable(),
    requiredRole: z.string().min(1),
    minQuotes: z.number().int().min(1),
    sequence: z.number().int().min(1),
    active: z.boolean().optional(),
});

const putSchema = z.object({
    docType: z.enum(["OC", "OS"]),
    rules: z.array(ruleSchema),
});

/** GET /api/approval-matrix?docType=OC|OS — reglas vigentes (ADMIN+). */
export async function GET(req: NextRequest) {
    try {
        const tenant = await requireTenant();
        const { user } = await requireAuth();

        if (!roleIsAtLeast(user.role, "ADMIN")) {
            return NextResponse.json(
                { error: "Solo ADMIN o rol superior puede consultar la matriz de autorización" },
                { status: 403 },
            );
        }

        const docTypeParam = new URL(req.url).searchParams.get("docType");
        const conditions = [eq(approvalMatrixRules.companyId, tenant.id!)];
        if (docTypeParam === "OC" || docTypeParam === "OS") {
            conditions.push(eq(approvalMatrixRules.docType, docTypeParam));
        }

        const rules = await db
            .select()
            .from(approvalMatrixRules)
            .where(and(...conditions))
            .orderBy(asc(approvalMatrixRules.docType), asc(approvalMatrixRules.sequence));

        return NextResponse.json({ rules });
    } catch (error: unknown) {
        console.error("Failed to read approval matrix", error);
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}

/**
 * PUT /api/approval-matrix — reemplaza la matriz completa de un docType (ADMIN+).
 * Valida traslapes (error) y huecos (advertencia no bloqueante) antes de guardar.
 */
export async function PUT(req: NextRequest) {
    try {
        const tenant = await requireTenant();
        const { user } = await requireAuth();

        if (!roleIsAtLeast(user.role, "ADMIN")) {
            return NextResponse.json(
                { error: "Solo ADMIN o rol superior puede editar la matriz de autorización" },
                { status: 403 },
            );
        }

        const { docType, rules } = putSchema.parse(await req.json());

        // Normalización explícita: zod deja amountMax/active como propiedades opcionales.
        const normalized = rules.map((r) => ({
            amountMin: r.amountMin,
            amountMax: r.amountMax ?? null,
            requiredRole: r.requiredRole,
            minQuotes: r.minQuotes,
            sequence: r.sequence,
            active: r.active,
        }));

        const validation = validateMatrixRules(normalized);
        if (validation.ok === false) {
            return NextResponse.json(
                { error: validation.error, warnings: validation.warnings },
                { status: 400 },
            );
        }

        await replaceMatrixRules(tenant.id!, docType, normalized);
        // Devolver las reglas ya persistidas con sus ids.
        const saved = await db
            .select()
            .from(approvalMatrixRules)
            .where(
                and(
                    eq(approvalMatrixRules.companyId, tenant.id!),
                    eq(approvalMatrixRules.docType, docType),
                ),
            )
            .orderBy(asc(approvalMatrixRules.sequence));

        return NextResponse.json({ rules: saved, warnings: validation.warnings });
    } catch (error: unknown) {
        console.error("Failed to update approval matrix", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: "Datos inválidos", details: error.issues },
                { status: 400 },
            );
        }
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}
