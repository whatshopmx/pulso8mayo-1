import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { incidents, branches } from "@/lib/db/schema";
import { eq, and, gte, lt, inArray, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { resolveBranchScope } from "@/lib/branch-scope";
import { slaHorasPorSeveridad, resueltoATiempo } from "@/lib/services/incident-sla";

/**
 * GET /api/analytics/incidents/compliance
 *
 * Score de cumplimiento por incidentes: de los detectados en el período,
 * qué porcentaje se resolvió dentro de su ventana de SLA (ver
 * `lib/services/incident-sla.ts`). Devuelve el global y el desglose por
 * sucursal, cada uno con su tendencia contra el período anterior.
 *
 * Vive bajo `/analytics/incidents/` y no en `/analytics/compliance` —el path
 * que pedía el plan— porque ese ya existe desde julio con otra forma
 * (`complianceRate` sobre scores de workflows) y lo consumen tres dashboards.
 * Reescribirlo habría cambiado el significado de "cumplimiento" bajo los pies
 * de pantallas que ya funcionan.
 */

const DIA_MS = 24 * 60 * 60 * 1000;

function rangoDias(period: string): number {
    if (period === "7d") return 7;
    if (period === "90d") return 90;
    return 30;
}

interface Fila {
    branchId: string;
    severity: string;
    createdAt: Date | null;
    resolvedAt: Date | null;
}

/** Porcentaje entero de filas resueltas dentro de su ventana. */
function score(filas: Fila[]): number {
    if (filas.length === 0) return 0;
    const aTiempo = filas.filter((f) =>
        resueltoATiempo(f.severity, f.createdAt, f.resolvedAt)
    ).length;
    return Math.round((aTiempo / filas.length) * 100);
}

export async function GET(req: Request) {
    try {
        const session = await auth.api.getSession({ headers: await headers() });

        if (!session?.user?.id || !session?.user?.companyId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const companyId = session.user.companyId;
        const { searchParams } = new URL(req.url);
        const period = searchParams.get("period") || "30d";
        const branchId = searchParams.get("branchId");

        const dias = rangoDias(period);
        const ahora = new Date();
        const inicio = new Date(ahora.getTime() - dias * DIA_MS);
        const inicioPrevio = new Date(ahora.getTime() - 2 * dias * DIA_MS);

        const sucursales = await db
            .select({ id: branches.id, name: branches.name })
            .from(branches)
            .where(eq(branches.companyId, companyId));

        // Mismo criterio que `/api/analytics/incidents`: el branchId del query
        // se filtra por el alcance del rol, no sólo por pertenencia a la empresa.
        const alcance = resolveBranchScope(
            (session.user as any).role,
            (session.user as any).branchId ?? null,
            branchId && branchId !== "all" ? branchId : null
        );

        const visibles =
            alcance.kind === "NONE"
                ? []
                : alcance.kind === "BRANCH"
                    ? sucursales.filter((b) => b.id === alcance.branchId)
                    : sucursales;

        const ids = visibles.map((b) => b.id);

        if (ids.length === 0) {
            return NextResponse.json({
                overall: 0,
                overallTrend: 0,
                slaHoras: {
                    FATAL: slaHorasPorSeveridad("FATAL"),
                    CRITICAL: slaHorasPorSeveridad("CRITICAL"),
                    HIGH: slaHorasPorSeveridad("HIGH"),
                    WARNING: slaHorasPorSeveridad("WARNING"),
                },
                byBranch: [],
            });
        }

        // Una sola lectura para los dos períodos: el score se calcula en JS
        // porque la ventana depende de la severidad y partir el CASE entre SQL
        // y TypeScript deja dos definiciones de "a tiempo" que se desincronizan.
        const filas = await db
            .select({
                branchId: incidents.branchId,
                severity: sql<string>`${incidents.severity}`,
                createdAt: incidents.createdAt,
                resolvedAt: incidents.resolvedAt,
            })
            .from(incidents)
            .where(
                and(
                    inArray(incidents.branchId, ids),
                    gte(incidents.createdAt, inicioPrevio),
                    lt(incidents.createdAt, ahora)
                )
            );

        const actuales = filas.filter((f) => f.createdAt && f.createdAt >= inicio);
        const previas = filas.filter((f) => f.createdAt && f.createdAt < inicio);

        const overall = score(actuales);
        const overallTrend = overall - score(previas);

        const byBranch = visibles
            .map((b) => {
                const propias = actuales.filter((f) => f.branchId === b.id);
                const propiasPrevias = previas.filter((f) => f.branchId === b.id);
                const actual = score(propias);
                return {
                    branchId: b.id,
                    name: b.name,
                    score: actual,
                    trend: actual - score(propiasPrevias),
                    total: propias.length,
                    resolved: propias.filter((f) => f.resolvedAt).length,
                };
            })
            .sort((a, b) => a.score - b.score);

        return NextResponse.json({
            overall,
            overallTrend,
            slaHoras: {
                FATAL: slaHorasPorSeveridad("FATAL"),
                CRITICAL: slaHorasPorSeveridad("CRITICAL"),
                HIGH: slaHorasPorSeveridad("HIGH"),
                WARNING: slaHorasPorSeveridad("WARNING"),
            },
            byBranch,
        });
    } catch (error) {
        console.error("[API] Error calculando compliance de incidentes:", error);
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500 }
        );
    }
}
