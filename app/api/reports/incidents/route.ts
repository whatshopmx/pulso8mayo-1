import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { incidents, branches } from "@/lib/db/schema";
import { eq, and, gte, lte, inArray, desc } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { resolveBranchScope } from "@/lib/branch-scope";
import { resueltoATiempo, slaHorasPorSeveridad } from "@/lib/services/incident-sla";

/**
 * GET /api/reports/incidents
 *
 * Reporte CSV de incidentes filtrado por fecha, sucursal y severidad.
 * Query: `start`, `end` (ISO), `branchId`, `severity`.
 */

/**
 * Escapa un campo para CSV.
 *
 * Además de comillas y saltos de línea, antepone un apóstrofo a lo que empiece
 * por `= + - @`: Excel interpreta esas celdas como fórmulas, y los títulos de
 * incidente son texto que escribe un usuario. Un título que empiece con `=`
 * se ejecutaría al abrir el archivo (inyección de fórmulas CSV).
 */
function csvCampo(valor: unknown): string {
    if (valor === null || valor === undefined) return "";
    let texto = String(valor);
    if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
    if (/[",\n\r]/.test(texto)) texto = `"${texto.replace(/"/g, '""')}"`;
    return texto;
}

const ENCABEZADOS = [
    "ID",
    "Título",
    "Severidad",
    "Status",
    "Sucursal",
    "Detectado",
    "Resuelto",
    "Tiempo resolución (h)",
    "SLA (h)",
    "Dentro de SLA",
    "Resolución",
];

function fecha(d: Date | null | undefined): string {
    return d ? d.toISOString() : "";
}

export async function GET(req: Request) {
    try {
        const session = await auth.api.getSession({ headers: await headers() });

        if (!session?.user?.id || !session?.user?.companyId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const companyId = session.user.companyId;
        const { searchParams } = new URL(req.url);
        const start = searchParams.get("start");
        const end = searchParams.get("end");
        const branchId = searchParams.get("branchId");
        const severity = searchParams.get("severity");

        const sucursales = await db
            .select({ id: branches.id, name: branches.name })
            .from(branches)
            .where(eq(branches.companyId, companyId));

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

        const nombrePorId = new Map(visibles.map((b) => [b.id, b.name]));
        const ids = visibles.map((b) => b.id);

        // Sin sucursales alcanzables se devuelve el CSV con sólo encabezados:
        // un archivo válido y vacío se entiende mejor que un 404 en una descarga.
        let filas: (typeof incidents.$inferSelect)[] = [];

        if (ids.length > 0) {
            const condiciones = [inArray(incidents.branchId, ids)];
            if (start) condiciones.push(gte(incidents.createdAt, new Date(start)));
            if (end) condiciones.push(lte(incidents.createdAt, new Date(end)));
            if (severity && severity !== "all") {
                condiciones.push(eq(incidents.severity, severity as any));
            }

            filas = await db
                .select()
                .from(incidents)
                .where(and(...condiciones))
                .orderBy(desc(incidents.createdAt))
                .limit(5000);
        }

        const lineas = [ENCABEZADOS.map(csvCampo).join(",")];

        for (const f of filas) {
            const horas =
                f.resolvedAt && f.createdAt
                    ? ((f.resolvedAt.getTime() - f.createdAt.getTime()) / 3_600_000).toFixed(2)
                    : "";

            lineas.push(
                [
                    f.id,
                    f.title,
                    f.severity,
                    f.status,
                    nombrePorId.get(f.branchId) ?? "",
                    fecha(f.createdAt),
                    fecha(f.resolvedAt),
                    horas,
                    slaHorasPorSeveridad(f.severity),
                    f.resolvedAt
                        ? resueltoATiempo(f.severity, f.createdAt, f.resolvedAt)
                            ? "Sí"
                            : "No"
                        : "",
                    f.resolution ?? "",
                ]
                    .map(csvCampo)
                    .join(",")
            );
        }

        const nombre = `incidentes-${new Date().toISOString().slice(0, 10)}.csv`;

        // BOM UTF-8: sin él Excel en Windows abre los acentos como mojibake, y
        // el reporte es en español para usuarios que lo abren precisamente ahí.
        return new NextResponse("﻿" + lineas.join("\r\n"), {
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="${nombre}"`,
            },
        });
    } catch (error) {
        console.error("[API] Error generando reporte de incidentes:", error);
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500 }
        );
    }
}
