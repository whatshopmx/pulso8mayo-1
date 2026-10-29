import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import {
    evidence,
    workflowInstanceSteps,
    workflowInstances,
    workflowTemplates,
    branches,
    users,
} from "@/lib/db/schema";
import { eq, and, gte, lte, isNull, sql, desc, or, type SQL } from "drizzle-orm";
import { resolveBranchScope } from "@/lib/branch-scope";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { resolveEvidenceUrl } from "@/lib/storage/scoped-evidence";
import { businessDayEnd, businessDayStart, parseCivilDate } from "@/lib/business-date";
import { confidencePercent, isAiPassed } from "@/lib/ai/evidence-confidence";

/**
 * Consulta de evidencias de workflow.
 *
 * La versión anterior comprobaba empresa, pero no acotaba a un EMPLEADO a sus
 * propias tareas/evidencias ni imponía la sucursal del rol: el `branchId` salía
 * del query y era opcional, así que un manipulador de parámetros veía la
 * evidencia de otros colaboradores de la misma empresa —y el `url` presignado
 * se derivaba igual, así que ese acceso alcanzaba la descarga.
 *
 * Además leía `workflow_instance_steps.evidence_url`, limitaba a 200 pasos y
 * recién después descartaba los que no tenían adjunto: el total visible era el
 * tamaño de esa muestra, no el del registro. Ahora la fuente es la tabla
 * canónica `evidence` (`entityType = WORKFLOW_STEP`), los filtros se aplican
 * antes de paginar y la respuesta distingue total de página.
 *
 * Límites de servidor, en este orden:
 * 1. EMPRESA: `evidence.company_id` es la empresa del actor (frontera de
 *    tenant, reforzada por RLS mediante `withCompanyContext`).
 * 2. ALCANCE DE SUCURSAL: `resolveBranchScope` — a GERENTE/SUPERVISOR los fija
 *    su sesión y se ignora el `branchId` pedido; un rol acotado sin sucursal
 *    asignada ve cero. Manipular el query no amplía nada.
 * 3. ACTOR: un EMPLEADO sólo ve evidencia de las instancias que tiene asignadas
 *    o de los pasos que él completó. Los mandos y READONLY conservan el alcance
 *    de la empresa/sucursal.
 *
 * La URL firmada se deriva después del filtro y sólo para la página pedida.
 */

const PAGE_SIZE_DEFAULT = 24;
const PAGE_SIZE_MAX = 100;

const KIND_BY_UI_TYPE: Record<string, "PHOTO" | "FILE" | "VOICE" | "VIDEO" | "TEXT"> = {
    PHOTO: "PHOTO",
    VIDEO: "VIDEO",
    AUDIO: "VOICE",
    TEXT: "TEXT",
    FILE: "FILE",
};

function uiTypeForKind(kind: string): "PHOTO" | "VIDEO" | "AUDIO" | "TEXT" {
    switch (kind) {
        case "PHOTO":
            return "PHOTO";
        case "VIDEO":
            return "VIDEO";
        case "VOICE":
            return "AUDIO";
        default:
            return "TEXT";
    }
}

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(max, Math.floor(parsed));
}

function parseCivilDateInput(value: string | null): Date | null {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const parsed = parseCivilDate(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function GET(request: NextRequest) {
    try {
        const session = await auth.api.getSession({
            headers: await headers(),
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
        const search = searchParams.get("search")?.trim();
        const verified = searchParams.get("verified");
        const type = searchParams.get("type");
        const page = parsePositiveInt(searchParams.get("page"), 1, Number.MAX_SAFE_INTEGER);
        const limit = parsePositiveInt(searchParams.get("limit"), PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX);
        const offset = (page - 1) * limit;

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
            return NextResponse.json({
                success: true,
                data: [],
                total: 0,
                page,
                limit,
                summary: { total: 0, todayCount: 0, verifiedCount: 0, needsReviewCount: 0, uniqueBranches: 0 },
            });
        }

        // La fecha operativa del adjunto es la del paso completado; la de alta
        // en `evidence` sólo respalda a los registros sin paso (no aplica aquí,
        // pero mantiene la consulta robusta ante datos migrados).
        const occurredAt = sql`coalesce(${workflowInstanceSteps.completedAt}, ${evidence.createdAt})`;
        const passedExpr = sql<boolean>`coalesce(
            (${workflowInstanceSteps.aiAnalysis} ->> 'passed') = 'true',
            (${evidence.aiMetadata} #>> '{verificationResult,passed}') = 'true',
            false
        )`;
        const rawConfidence = sql`coalesce(
            ${workflowInstanceSteps.aiAnalysis} ->> 'confidence',
            ${evidence.aiMetadata} #>> '{verificationResult,confidence}'
        )`;
        const confidenceExpr = sql<number>`case
            when ${rawConfidence} ~ '^[0-9]+(\\.[0-9]+)?$' then
                least(100, greatest(0,
                    case
                        when ${rawConfidence}::numeric <= 1 then ${rawConfidence}::numeric * 100
                        else ${rawConfidence}::numeric
                    end
                ))
            else null
        end`;

        const conditions: SQL[] = [
            eq(evidence.companyId, user.companyId),
            eq(evidence.entityType, "WORKFLOW_STEP"),
            isNull(evidence.deletedAt),
        ];

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

        const from = parseCivilDateInput(dateFrom);
        if (from) {
            conditions.push(gte(occurredAt, businessDayStart(from)));
        }

        const to = parseCivilDateInput(dateTo);
        if (to) {
            conditions.push(lte(occurredAt, businessDayEnd(to)));
        }

        if (search) {
            const pattern = `%${search}%`;
            const searchCondition = or(
                sql`${workflowTemplates.name} ILIKE ${pattern}`,
                sql`${workflowInstanceSteps.title} ILIKE ${pattern}`,
                sql`${workflowInstanceSteps.stepId} ILIKE ${pattern}`,
                sql`${branches.name} ILIKE ${pattern}`,
                sql`${users.name} ILIKE ${pattern}`
            );
            if (searchCondition) conditions.push(searchCondition);
        }

        if (verified === "true") {
            conditions.push(sql`${passedExpr}`);
        } else if (verified === "false") {
            conditions.push(sql`not ${passedExpr}`);
        }

        const kind = type ? KIND_BY_UI_TYPE[type.toUpperCase()] : undefined;
        if (kind) {
            conditions.push(eq(evidence.kind, kind));
        }

        const where = and(...conditions);
        const today = new Date();
        const todayStart = businessDayStart(today);
        const todayEnd = businessDayEnd(today);

        const result = await withCompanyContext(
            { companyId: user.companyId, branchId: scope.kind === "BRANCH" ? scope.branchId : null, actorId: user.id },
            async (tx) => {
                const [summaryRow] = await tx
                    .select({
                        total: sql<number>`cast(count(*) as int)`,
                        todayCount: sql<number>`cast(count(*) filter (
                            where ${occurredAt} >= ${todayStart} and ${occurredAt} <= ${todayEnd}
                        ) as int)`,
                        verifiedCount: sql<number>`cast(count(*) filter (where ${passedExpr}) as int)`,
                        needsReviewCount: sql<number>`cast(count(*) filter (
                            where not ${passedExpr}
                               or (${confidenceExpr} is not null and ${confidenceExpr} < 70)
                        ) as int)`,
                        uniqueBranches: sql<number>`cast(count(distinct ${workflowInstances.branchId}) as int)`,
                    })
                    .from(evidence)
                    .innerJoin(
                        workflowInstanceSteps,
                        eq(evidence.entityId, sql`cast(${workflowInstanceSteps.id} as text)`)
                    )
                    .innerJoin(
                        workflowInstances,
                        eq(workflowInstanceSteps.instanceId, workflowInstances.id)
                    )
                    .leftJoin(
                        workflowTemplates,
                        eq(workflowInstances.workflowTemplateId, workflowTemplates.id)
                    )
                    .leftJoin(branches, eq(workflowInstances.branchId, branches.id))
                    .leftJoin(users, eq(workflowInstances.assigneeId, users.id))
                    .where(where);

                const rows = await tx
                    .select({
                        id: evidence.id,
                        kind: evidence.kind,
                        url: evidence.url,
                        aiMetadata: evidence.aiMetadata,
                        stepTitle: workflowInstanceSteps.title,
                        stepId: workflowInstanceSteps.stepId,
                        aiAnalysis: workflowInstanceSteps.aiAnalysis,
                        completedAt: workflowInstanceSteps.completedAt,
                        registeredAt: evidence.createdAt,
                        workflowName: workflowTemplates.name,
                        assigneeName: users.name,
                        branchName: branches.name,
                        branchId: workflowInstances.branchId,
                        workflowInstanceId: workflowInstances.id,
                    })
                    .from(evidence)
                    .innerJoin(
                        workflowInstanceSteps,
                        eq(evidence.entityId, sql`cast(${workflowInstanceSteps.id} as text)`)
                    )
                    .innerJoin(
                        workflowInstances,
                        eq(workflowInstanceSteps.instanceId, workflowInstances.id)
                    )
                    .leftJoin(
                        workflowTemplates,
                        eq(workflowInstances.workflowTemplateId, workflowTemplates.id)
                    )
                    .leftJoin(branches, eq(workflowInstances.branchId, branches.id))
                    .leftJoin(users, eq(workflowInstances.assigneeId, users.id))
                    .where(where)
                    .orderBy(desc(occurredAt), desc(evidence.id))
                    .limit(limit)
                    .offset(offset);

                return { summaryRow, rows };
            }
        );

        const summary = result.summaryRow ?? {
            total: 0,
            todayCount: 0,
            verifiedCount: 0,
            needsReviewCount: 0,
            uniqueBranches: 0,
        };

        const evidences = await Promise.all(
            result.rows.filter((row) => Boolean(row.url)).map(async (row) => {
                const aiAnalysis = row.aiAnalysis as
                    | { passed?: unknown; confidence?: unknown; reason?: unknown; notes?: unknown }
                    | null;
                const metadata = row.aiMetadata as
                    | { verificationResult?: { passed?: unknown; confidence?: unknown; notes?: unknown } }
                    | null;

                // El dictamen vive en el paso; la metadata canónica es el
                // respaldo. No se mezclan `passed` de fuentes distintas.
                const passed = aiAnalysis && "passed" in aiAnalysis
                    ? isAiPassed(aiAnalysis.passed)
                    : isAiPassed(metadata?.verificationResult?.passed);
                const confidence =
                    aiAnalysis?.confidence ?? metadata?.verificationResult?.confidence;
                const reason =
                    (typeof aiAnalysis?.reason === "string" && aiAnalysis.reason) ||
                    (typeof aiAnalysis?.notes === "string" && aiAnalysis.notes) ||
                    (typeof metadata?.verificationResult?.notes === "string" && metadata.verificationResult.notes) ||
                    undefined;

                return {
                    id: row.id,
                    type: uiTypeForKind(row.kind),
                    url: (await resolveEvidenceUrl(row.url)) ?? "",
                    workflowName: row.workflowName ?? "Sin plantilla",
                    stepName: row.stepTitle ?? row.stepId,
                    assigneeName: row.assigneeName || "Sin asignar",
                    branchName: row.branchName || "Sin sucursal",
                    branchId: row.branchId || undefined,
                    createdAt: row.completedAt ?? row.registeredAt,
                    aiVerified: passed,
                    aiScore: confidencePercent(confidence) ?? undefined,
                    aiReason: reason,
                    workflowInstanceId: row.workflowInstanceId,
                    stepId: row.stepId,
                };
            })
        );

        return NextResponse.json({
            success: true,
            data: evidences.filter((row) => row.url !== ""),
            total: summary.total,
            page,
            limit,
            summary,
        });
    } catch (error) {
        console.error("Failed to fetch evidence:", error);
        return NextResponse.json({ error: "Failed to fetch evidence" }, { status: 500 });
    }
}
