"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/metric-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/shared";
import {
    DollarSign, TrendingDown, TrendingUp, Package,
    AlertTriangle, RefreshCw
} from "lucide-react";
import { toast } from "sonner";

interface RevenueCoverage {
    status: "NO_DATA" | "PARTIAL" | "COMPLETE";
    totalEntries: number;
    completeEntries: number;
}

interface BranchKPI {
    branchId: string;
    branchName: string;
    foodCostPercent: number | null;
    cogsCents: number;
    reportedRevenueCents: number;
    revenueCents: number | null;
    revenueCoverage: RevenueCoverage;
    inventoryTurnover: number;
    stockDays: number;
    shrinkagePercent: number;
    fillRate: number;
    countAccuracy: number | null;
}

interface ExecutiveReport {
    consolidated: BranchKPI;
    byBranch: BranchKPI[];
    period: { start: string; end: string };
}

const ROLE_VIEWS: Record<string, { title: string; description: string; kpis: string[] }> = {
    OWNER: {
        title: "Visión Ejecutiva",
        description: "Food Cost, COGS, Rentabilidad global",
        kpis: ["foodCost", "cogs", "revenue"],
    },
    ADMIN: {
        title: "Visión de Dirección",
        description: "Food Cost, Rotación, Días de Stock, Merma",
        kpis: ["foodCost", "cogs", "turnover", "stockDays", "shrinkage"],
    },
    GERENTE: {
        title: "Visión de Gerencia",
        description: "Fill Rate, Exactitud de Conteo, Rotación",
        kpis: ["fillRate", "countAccuracy", "turnover", "stockDays"],
    },
};

function formatCents(cents: number): string {
    return "$" + (cents / 100).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function coverageLabel(cov: RevenueCoverage | undefined): string {
    if (!cov) return "—";
    if (cov.status === "COMPLETE") return "Completa";
    if (cov.status === "PARTIAL") return "Parcial";
    return "Sin datos";
}

export function ExecutiveDashboard() {
    const [report, setReport] = useState<ExecutiveReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [branchOptions, setBranchOptions] = useState<ExecutiveReport['byBranch']>([]);
    const [roleView, setRoleView] = useState<string>("ADMIN");
    const [startDate, setStartDate] = useState(() => {
        const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split("T")[0];
    });
    const [endDate, setEndDate] = useState(() => new Date().toISOString().split("T")[0]);
    const [branchFilter, setBranchFilter] = useState<string>("all");

    const fetchReport = async () => {
        setLoading(true);
        setLoadError(null);
        setReport(null);
        try {
            const params = new URLSearchParams({ startDate, endDate });
            if (branchFilter && branchFilter !== "all") params.set("branchId", branchFilter);
            const res = await fetch(`/api/inventory/reports/executive?${params}`);
            const data = await res.json();
            if (res.ok) {
                setReport(data);
                if (branchFilter === 'all') setBranchOptions(data.byBranch);
            } else {
                const message = typeof data.error === 'string' ? data.error : 'Inténtalo de nuevo';
                setLoadError(message);
                toast.error(message);
            }
        } catch {
            setLoadError('Error de red. Inténtalo de nuevo.');
            toast.error("Error de red");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchReport(); }, []);

    const kpi = report?.consolidated;
    const roleConfig = ROLE_VIEWS[roleView] ?? ROLE_VIEWS.ADMIN;
    const show = (k: string) => roleConfig.kpis.includes(k);

    return (
        <div className="space-y-6">
            <PageHeader
                title="Dashboard Ejecutivo"
                description={roleConfig.description}
                actions={
                    <div className="flex max-w-full flex-wrap items-center gap-2">
                        <Select value={roleView} onValueChange={setRoleView} disabled={loading}>
                            <SelectTrigger aria-label="Vista de indicadores" className="w-44">
                                <SelectValue placeholder="Rol" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="OWNER">CEO / Propietario</SelectItem>
                                <SelectItem value="ADMIN">ADMIN / Dirección</SelectItem>
                                <SelectItem value="GERENTE">Gerente / Compras</SelectItem>
                            </SelectContent>
                        </Select>
                        {!loadError && branchOptions.length > 1 && (
                            <Select value={branchFilter} onValueChange={setBranchFilter} disabled={loading}>
                                <SelectTrigger aria-label="Sucursal del reporte" className="w-44">
                                    <SelectValue placeholder="Sucursal" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todas las sucursales</SelectItem>
                                    {branchOptions.map(b => (
                                        <SelectItem key={b.branchId} value={b.branchId}>{b.branchName}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                        <div className="flex items-center gap-1">
                            <Input aria-label="Fecha de inicio" type="date" disabled={loading} value={startDate} onChange={e => setStartDate(e.target.value)} className="w-36" />
                            <span className="text-muted-foreground text-sm">→</span>
                            <Input aria-label="Fecha de fin" type="date" disabled={loading} value={endDate} onChange={e => setEndDate(e.target.value)} className="w-36" />
                        </div>
                        <Button aria-label="Actualizar reporte" variant="outline" size="icon" onClick={fetchReport} disabled={loading}>
                            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                        </Button>
                    </div>
                }
            />

            {loadError && (
                <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                    No se pudo cargar el reporte. {loadError} Corrige el problema y pulsa Actualizar reporte.
                </div>
            )}

            {/* KPIs Grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {show("foodCost") && (
                    <MetricCard
                        label="Food Cost"
                        value={kpi && kpi.foodCostPercent !== null ? `${kpi.foodCostPercent}%` : "—"}
                        subtitle={`COGS ${kpi ? formatCents(kpi.cogsCents) : "—"} · Cobertura ${kpi ? coverageLabel(kpi.revenueCoverage) : "—"}`}
                        icon={<TrendingDown className="h-4 w-4" />}
                        tone={!kpi || kpi.foodCostPercent === null ? "neutral" : kpi.foodCostPercent > 35 ? "destructive" : kpi.foodCostPercent > 28 ? "warning" : "success"}
                        loading={loading}
                    />
                )}

                {show("cogs") && (
                    <MetricCard
                        label="COGS (Costo de Ventas)"
                        value={kpi ? formatCents(kpi.cogsCents) : "—"}
                        subtitle={report ? `Período: ${report.period.start.slice(0, 10)} → ${report.period.end.slice(0, 10)}` : 'Sin reporte cargado'}
                        icon={<DollarSign className="h-4 w-4" />}
                        tone="info"
                        loading={loading}
                    />
                )}

                {show("revenue") && (
                    <MetricCard
                        label="Ingresos (Ventas)"
                        value={kpi && kpi.revenueCents !== null ? formatCents(kpi.revenueCents) : "—"}
                        subtitle={kpi ? `Cobertura ${coverageLabel(kpi.revenueCoverage)} · reportado ${formatCents(kpi.reportedRevenueCents)}` : "Revenue del período"}
                        icon={<TrendingUp className="h-4 w-4" />}
                        tone={kpi && kpi.revenueCoverage?.status === "COMPLETE" ? "success" : "warning"}
                        loading={loading}
                    />
                )}

                {show("turnover") && (
                    <MetricCard
                        label="Rotación de Inventario"
                        value={kpi ? kpi.inventoryTurnover.toString() : "—"}
                        subtitle={`${kpi?.stockDays ?? "—"} días de stock`}
                        icon={<RefreshCw className="h-4 w-4" />}
                        tone="info"
                        loading={loading}
                    />
                )}

                {show("stockDays") && (
                    <MetricCard
                        label="Días de Stock"
                        value={kpi ? kpi.stockDays.toString() : "—"}
                        subtitle="Cobertura de inventario actual"
                        icon={<Package className="h-4 w-4" />}
                        tone={kpi && kpi.stockDays > 30 ? "warning" : "info"}
                        loading={loading}
                    />
                )}

                {show("shrinkage") && (
                    <MetricCard
                        label="Merma / Shrinkage"
                        value={kpi ? `${kpi.shrinkagePercent}%` : "—"}
                        subtitle="% de pérdida sobre consumo total"
                        icon={<AlertTriangle className="h-4 w-4" />}
                        tone={kpi && kpi.shrinkagePercent > 5 ? "destructive" : "neutral"}
                        loading={loading}
                    />
                )}

                {show("fillRate") && (
                    <MetricCard
                        label="Fill Rate"
                        value={kpi ? `${kpi.fillRate}%` : "—"}
                        subtitle="% de items con stock ≥ mínimo"
                        icon={<Package className="h-4 w-4" />}
                        tone={kpi && kpi.fillRate < 80 ? "destructive" : kpi && kpi.fillRate < 90 ? "warning" : "success"}
                        loading={loading}
                    />
                )}

                {show("countAccuracy") && (
                    <MetricCard
                        label="Exactitud de Conteo"
                        value={kpi?.countAccuracy != null ? `${kpi.countAccuracy}%` : "N/A"}
                        subtitle="Último conteo: items con varianza ≤5%"
                        icon={<TrendingUp className="h-4 w-4" />}
                        tone={kpi && kpi.countAccuracy != null && kpi.countAccuracy < 80 ? "destructive" : "success"}
                        loading={loading}
                    />
                )}
            </div>

            {/* Branch breakdown */}
            {report && report.byBranch.length > 1 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Desglose por Sucursal</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b text-muted-foreground">
                                        <th className="text-left py-2 px-2">Sucursal</th>
                                        <th className="text-right py-2 px-2">Food Cost</th>
                                        <th className="text-right py-2 px-2">COGS</th>
                                        <th className="text-right py-2 px-2">Revenue</th>
                                        <th className="text-right py-2 px-2">Cobertura</th>
                                        <th className="text-right py-2 px-2">Rotación</th>
                                        <th className="text-right py-2 px-2">Días Stock</th>
                                        <th className="text-right py-2 px-2">Merma</th>
                                        <th className="text-right py-2 px-2">Fill Rate</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {report.byBranch.map(b => (
                                        <tr key={b.branchId} className="border-b hover:bg-muted/50">
                                            <td className="py-2 px-2 font-medium">{b.branchName}</td>
                                            <td className={`text-right py-2 px-2 font-mono ${b.foodCostPercent === null ? "text-muted-foreground" : b.foodCostPercent > 35 ? "text-red-500" : b.foodCostPercent > 28 ? "text-amber-500" : "text-green-500"}`}>
                                                {b.foodCostPercent === null ? "N/D" : `${b.foodCostPercent}%`}
                                            </td>
                                            <td className="text-right py-2 px-2 font-mono">{formatCents(b.cogsCents)}</td>
                                            <td className="text-right py-2 px-2 font-mono">{b.revenueCents === null ? (b.revenueCoverage.status === 'NO_DATA' ? 'Sin datos' : 'Parcial') : formatCents(b.revenueCents)}</td>
                                            <td className="text-right py-2 px-2 font-mono">{coverageLabel(b.revenueCoverage)}</td>
                                            <td className="text-right py-2 px-2 font-mono">{b.inventoryTurnover}</td>
                                            <td className="text-right py-2 px-2 font-mono">{b.stockDays}</td>
                                            <td className="text-right py-2 px-2 font-mono">{b.shrinkagePercent}%</td>
                                            <td className="text-right py-2 px-2 font-mono">{b.fillRate}%</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
