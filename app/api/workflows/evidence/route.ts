import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { workflowInstanceSteps, workflowInstances, workflowTemplates, branches, users } from "@/lib/db/schema";
import { eq, and, gte, lte, sql, desc, or } from "drizzle-orm";
import { resolveBranchScope } from "@/lib/branch-scope";
import { resolveEvidenceUrl } from "@/lib/storage/scoped-evidence";
import { startOfDay, endOfDay } from "date-fns";

/**
 * Consulta de evidencias de workflow.
 *
 * La versión anterior comprobaba empresa, pero no acotaba a un EMPLEADO a sus
 * propias tareas/evidencias ni imponía la sucursal del rol: el `branchId` salía
 * del query y era opcional, así que un manipulador de parámetros veía la
 * evidencia de otros colaboradores de la misma empresa —y el `url` presignado
 * se derivaba igual, así que ese acceso alcanzaba la descarga.
 *
 * Ahora se aplican tres límites en el servidor, en este orden:
 * 1. EMPRESA: las plantillas de la empresa del actor (frontera de tenant).
 * 2. ALCANCE DE SUCURSAL: `resolveBranchScope` — a GERENTE/SUPERVISOR los fija
 *    su sesión y se ignora el `branchId` pedido; un rol acotado sin sucursal
 *    asignada ve cero. Manipular el query no amplía nada.
 * 3. ACTOR: un EMPLEADO sólo ve evidencia de las instancias que tiene asignadas
 *    o de los pasos que él completó. Los mandos y READONLY conservan el alcance
 *    de la empresa/sucursal.
 *
 * La URL firmada se deriva después del filtro, así que respeta el mismo alcance
 * que el listado: no hay una puerta lateral de descarga.
 */
export async function GET(request: NextRequest) {
    try {
        const session = await auth.api.getSession({
            headers: await headers()
        });

        if (!session?.user?.companyId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const user = session.user as {
            id: string;
            role?: string;
            branchId?: string | null;
            companyId: string;
        };

        const searchParams = request.nextUrl.searchParams;
        const branchId = searchParams.get("branchId");
        const dateFrom = searchParams.get("dateFrom");
        const dateTo = searchParams.get("dateTo");
        const search = searchParams.get("search");

        // Build base conditions
        const conditions = [
            eq(workflowTemplates.companyId, user.companyId),
            eq(workflowInstances.workflowTemplateId, sql`cast(${workflowTemplates.id} as text)`),
            eq(workflowInstanceSteps.instanceId, workflowInstances.id),
        ];

        // Alcance de sucursal resuelto en el servidor. Para un rol acotado, el
        // `branchId` pedido se descarta: sólo cuenta su sucursal de sesión.
        const scope = resolveBranchScope(
            (user.role as never) ?? "EMPLEADO",
            user.branchId ?? null,
            branchId && branchId !== "all" ? branchId : null
        );

        // Un rol de sucursal sin sucursal asignada no ve nada; nunca cae en
        // "sin filtro" (= empresa entera).
        if (scope.kind === "NONE") {
            return NextResponse.json({ success: true, data: [] });
        }

        if (scope.kind === "BRANCH") {
            conditions.push(eq(workflowInstances.branchId, scope.branchId));
        }

        // Un colaborador sólo ve sus tareas: instancias asignadas a él o pasos
        // que él mismo completó. Otro `assigneeId` no se puede pedir por query.
        if (user.role === "EMPLEADO") {
            const propio = or(
                eq(workflowInstances.assigneeId, user.id),
                eq(workflowInstanceSteps.completedBy, user.id)
            );
            if (propio) conditions.push(propio);
        }

        if (dateFrom) {
            conditions.push(gte(workflowInstances.createdAt, startOfDay(new Date(dateFrom))));
        }

        if (dateTo) {
            conditions.push(lte(workflowInstances.createdAt, endOfDay(new Date(dateTo))));
        }

        if (search) {
            conditions.push(
                sql`(${workflowTemplates.name} ILIKE ${`%${search}%`} OR ${workflowInstanceSteps.stepId} ILIKE ${`%${search}%`} OR ${branches.name} ILIKE ${`%${search}%`} OR ${users.name} ILIKE ${`%${search}%`})`
            );
        }

        // Filter out null/undefined conditions
        const validConditions = conditions.filter(c => c != null);

        // Fetch evidence with related data
        const steps = await db.select({
            id: workflowInstanceSteps.id,
            evidenceUrl: workflowInstanceSteps.evidenceUrl,
            workflowName: workflowTemplates.name,
            stepId: workflowInstanceSteps.stepId,
            assigneeName: users.name,
            assigneeId: workflowInstances.assigneeId,
            branchName: branches.name,
            branchId: workflowInstances.branchId,
            createdAt: workflowInstances.createdAt,
            workflowInstanceId: workflowInstances.id,
            aiAnalysis: workflowInstanceSteps.aiAnalysis,
        })
            .from(workflowInstanceSteps)
            .leftJoin(workflowInstances, eq(workflowInstanceSteps.instanceId, workflowInstances.id))
            .leftJoin(workflowTemplates, eq(workflowInstances.workflowTemplateId, sql`cast(${workflowTemplates.id} as text)`))
            .leftJoin(users, eq(workflowInstances.assigneeId, users.id))
            .leftJoin(branches, eq(workflowInstances.branchId, branches.id))
            .where(and(...validConditions))
            .orderBy(desc(workflowInstances.createdAt))
            .limit(200);

        // Filter out steps without evidence
        const evidences = steps.filter(s => s.evidenceUrl !== null && s.evidenceUrl !== "");

        // Format evidences with AI verification status.
        // Las evidencias nuevas se guardan como KEY de R2 (modelo privado):
        // aquí se derivan a URL presignada de corta vida; las legacy (http)
        // pasan tal cual sin costo.
        const evidencesWithVerification = await Promise.all(evidences.map(async (evidence) => {
            const aiAnalysis = evidence.aiAnalysis as any;
            const aiVerified = aiAnalysis?.passed === true;
            const url = await resolveEvidenceUrl(evidence.evidenceUrl) || "";

            return {
                id: evidence.id,
                type: "PHOTO" as "PHOTO" | "VIDEO" | "AUDIO" | "TEXT",
                url,
                workflowName: evidence.workflowName,
                stepName: evidence.stepId,
                assigneeName: evidence.assigneeName || "Sin asignar",
                branchName: evidence.branchName || "Sin sucursal",
                branchId: evidence.branchId || undefined,
                createdAt: evidence.createdAt,
                aiVerified: aiVerified,
                aiScore: aiAnalysis?.confidence ? Math.round(aiAnalysis.confidence * 100) : undefined,
                aiReason: aiAnalysis?.reason,
                workflowInstanceId: evidence.workflowInstanceId,
                stepId: evidence.stepId,
            };
        }));

        return NextResponse.json({
            success: true,
            data: evidencesWithVerification,
        });
    } catch (error) {
        console.error("Failed to fetch evidence:", error);
        return NextResponse.json(
            { error: "Failed to fetch evidence" },
            { status: 500 }
        );
    }
}
