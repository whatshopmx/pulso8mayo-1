import { complianceReportService } from "@/lib/services/ComplianceReportService";
import { ExternalReportService } from "@/lib/services/external-report-service";
import { db } from "@/lib/db";
import { branches } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ShieldCheck, ShieldAlert, Clock, FileText, Lock } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export const dynamic = "force-dynamic";

interface PageProps {
    params: { token: string };
}

export default async function ExternalReportPage({ params }: PageProps) {
    const payload = ExternalReportService.validateExternalToken(params.token);

    if (!payload) {
        return <InvalidTokenView />;
    }

    if (payload.reportType !== "NOM-251") {
        return <UnsupportedView reportType={payload.reportType} />;
    }

    try {
        const report = await complianceReportService.generateNOM251Report({
            companyId: payload.companyId,
            branchId: payload.branchId,
            startDate: new Date(payload.startDate),
            endDate: new Date(payload.endDate),
        });

        const [branch] = await db.select().from(branches).where(eq(branches.id, payload.branchId)).limit(1);
        const branchName = report.companyInfo.branchName || branch?.name || "Sucursal";

        const rate = report.summary.complianceRate;
        const rateColor = rate >= 85 ? "text-emerald-600" : rate >= 60 ? "text-amber-600" : "text-rose-600";

        return (
            <div className="min-h-screen bg-muted/30 p-4 sm:p-8">
                <div className="mx-auto max-w-5xl space-y-6">
                    {/* Header */}
                    <div className="rounded-lg border bg-card p-6 shadow-sm">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                            <div className="space-y-1">
                                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                    <FileText className="h-3.5 w-3.5" />
                                    Reporte de Cumplimiento NOM-251 · Solo lectura
                                </div>
                                <h1 className="text-2xl font-bold tracking-tight">
                                    {report.companyInfo.name} — {branchName}
                                </h1>
                                <p className="text-sm text-muted-foreground">
                                    Período: {format(new Date(payload.startDate), "d 'de' MMMM, yyyy", { locale: es })} — {" "}
                                    {format(new Date(payload.endDate), "d 'de' MMMM, yyyy", { locale: es })}
                                </p>
                            </div>
                            <div className="flex flex-col items-start gap-1 rounded-md border bg-muted/40 p-3 text-xs sm:items-end">
                                <span className="font-medium">{payload.recipientName}</span>
                                <span className="text-muted-foreground">{payload.recipientRole}</span>
                                <span className="flex items-center gap-1 text-muted-foreground">
                                    <Clock className="h-3 w-3" />
                                    Expira: {format(new Date(payload.exp * 1000), "d 'de' MMM, yyyy", { locale: es })}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Summary KPIs */}
                    <div className="grid gap-4 sm:grid-cols-3">
                        <KpiCard label="Inspecciones totales" value={String(report.summary.totalInspections)} />
                        <KpiCard label="Inspecciones completadas" value={String(report.summary.completedInspections)} />
                        <KpiCard label="% Cumplimiento" value={`${rate}%`} valueClass={rateColor} />
                    </div>

                    {/* By category */}
                    <div className="rounded-lg border bg-card p-6 shadow-sm">
                        <h2 className="mb-4 text-lg font-semibold">Cumplimiento por Categoría</h2>
                        <div className="space-y-3">
                            {Object.entries(report.summary.byCategory).map(([cat, data]) => {
                                const pct = data.rate;
                                const barColor = pct >= 85 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-rose-500";
                                return (
                                    <div key={cat} className="space-y-1">
                                        <div className="flex items-center justify-between text-sm">
                                            <span className="font-medium">{cat}</span>
                                            <span className="text-muted-foreground">
                                                {data.completed}/{data.total} · {pct}%
                                            </span>
                                        </div>
                                        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                                            <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
                                        </div>
                                    </div>
                                );
                            })}
                            {Object.keys(report.summary.byCategory).length === 0 && (
                                <p className="text-sm text-muted-foreground">Sin inspecciones en el período.</p>
                            )}
                        </div>
                    </div>

                    {/* Inspections list */}
                    <div className="rounded-lg border bg-card p-6 shadow-sm">
                        <h2 className="mb-4 text-lg font-semibold">Detalle de Inspecciones</h2>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                                        <th className="py-2 pr-4 font-medium">Inspección</th>
                                        <th className="py-2 pr-4 font-medium">Categoría</th>
                                        <th className="py-2 pr-4 font-medium">Estado</th>
                                        <th className="py-2 pr-4 font-medium">Responsable</th>
                                        <th className="py-2 pr-4 font-medium">Score</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {report.inspections.map((insp) => (
                                        <tr key={insp.id} className="border-b last:border-0">
                                            <td className="py-2 pr-4 font-medium">{insp.workflowName}</td>
                                            <td className="py-2 pr-4 text-muted-foreground">{insp.category}</td>
                                            <td className="py-2 pr-4">
                                                <StatusPill status={insp.status} />
                                            </td>
                                            <td className="py-2 pr-4 text-muted-foreground">{insp.assigneeName || "—"}</td>
                                            <td className="py-2 pr-4">
                                                {insp.score != null ? `${Math.round(Number(insp.score))}%` : "—"}
                                            </td>
                                        </tr>
                                    ))}
                                    {report.inspections.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="py-6 text-center text-muted-foreground">
                                                Sin inspecciones en el período.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Digital signature footer */}
                    <div className="rounded-lg border bg-muted/40 p-4 text-xs text-muted-foreground">
                        <div className="flex items-center gap-2 font-medium text-foreground">
                            <ShieldCheck className="h-4 w-4" />
                            Documento generado por Pulso HORECA
                        </div>
                        <p className="mt-1">
                            Generado por {report.digitalSignatures.generatedBy} el{" "}
                            {format(new Date(report.digitalSignatures.generatedAt), "d 'de' MMMM, yyyy 'a las' HH:mm", { locale: es })}.
                        </p>
                        <p className="mt-1 font-mono break-all">
                            Huella digital: {report.digitalSignatures.digitalFingerprint}
                        </p>
                        <p className="mt-2 flex items-center gap-1">
                            <Lock className="h-3 w-3" />
                            Enlace de solo lectura · válido hasta {format(new Date(payload.exp * 1000), "d 'de' MMMM, yyyy", { locale: es })}.
                        </p>
                    </div>
                </div>
            </div>
        );
    } catch (error) {
        console.error("[ExternalReport] Error generating report:", error);
        return <ErrorView />;
    }
}

function KpiCard({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
    return (
        <div className="rounded-lg border bg-card p-5 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className={`mt-1 text-3xl font-bold tracking-tight ${valueClass ?? ""}`}>{value}</div>
        </div>
    );
}

function StatusPill({ status }: { status: string }) {
    const map: Record<string, { label: string; cls: string }> = {
        COMPLETED: { label: "Completado", cls: "bg-emerald-100 text-emerald-700" },
        PENDING: { label: "Pendiente", cls: "bg-amber-100 text-amber-700" },
        IN_PROGRESS: { label: "En progreso", cls: "bg-blue-100 text-blue-700" },
        FAILED: { label: "Fallido", cls: "bg-rose-100 text-rose-700" },
    };
    const s = map[status] || { label: status, cls: "bg-muted text-muted-foreground" };
    return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

function InvalidTokenView() {
    return (
        <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
            <div className="w-full max-w-md rounded-lg border bg-card p-8 text-center shadow-sm">
                <ShieldAlert className="mx-auto h-10 w-10 text-rose-500" />
                <h1 className="mt-4 text-xl font-bold">Enlace inválido o expirado</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    Este enlace de reporte ya no es válido. Solicita uno nuevo a tu contacto en Pulso HORECA.
                </p>
            </div>
        </div>
    );
}

function UnsupportedView({ reportType }: { reportType: string }) {
    return (
        <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
            <div className="w-full max-w-md rounded-lg border bg-card p-8 text-center shadow-sm">
                <FileText className="mx-auto h-10 w-10 text-muted-foreground" />
                <h1 className="mt-4 text-xl font-bold">Tipo de reporte no soportado</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    El tipo &quot;{reportType}&quot; aún no está disponible en el portal de externos.
                </p>
            </div>
        </div>
    );
}

function ErrorView() {
    return (
        <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
            <div className="w-full max-w-md rounded-lg border bg-card p-8 text-center shadow-sm">
                <ShieldAlert className="mx-auto h-10 w-10 text-amber-500" />
                <h1 className="mt-4 text-xl font-bold">No se pudo generar el reporte</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    Ocurrió un error al generar el reporte. Intenta de nuevo más tarde.
                </p>
            </div>
        </div>
    );
}