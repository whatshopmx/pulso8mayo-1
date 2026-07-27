"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import {
    DollarSign, TrendingDown, TrendingUp, Package,
    AlertTriangle, RefreshCw, Loader2, Building2
} from "lucide-react";
import { toast } from "sonner";

interface BranchKPI {
    branchId: string;
    branchName: string;
    foodCostPercent: number;
    cogsCents: number;
    revenueCents: number;
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

function KPICard({
    title, value, subtitle, icon, color, loading,
}: {
    title: string; value: string; subtitle: string; icon: React.ReactNode; color: string; loading: boolean;
}) {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
                <div className={`h-5 w-5 ${color}`}>{icon}</div>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                ) : (
                    <>
                        <div className="text-2xl font-bold font-mono">{value}</div>
                        <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
                    </>
                )}
            </CardContent>
        </Card>
    );
}

export function ExecutiveDashboard() {
    const [report, setReport] = useState<ExecutiveReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [roleView, setRoleView] = useState<string>("ADMIN");
    const [startDate, setStartDate] = useState(() => {
        const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split("T")[0];
    });
    const [endDate, setEndDate] = useState(() => new Date().toISOString().split("T")[0]);
    const [branchFilter, setBranchFilter] = useState<string>("all");

    const fetchReport = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ startDate, endDate });
            if (branchFilter && branchFilter !== "all") params.set("branchId", branchFilter);
            const res = await fetch(`/api/inventory/reports/executive?${params}`);
            const data = await res.json();
            if (res.ok) setReport(data);
            else toast.error(data.error || "Error al cargar reporte");
        } catch {
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
                    <div className="flex items-center gap-2">
                        <Select value={roleView} onValueChange={setRoleView}>
                            <SelectTrigger className="w-44">
                                <SelectValue placeholder="Rol" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="OWNER">CEO / Propietario</SelectItem>
                                <SelectItem value="ADMIN">ADMIN / Dirección</SelectItem>
                                <SelectItem value="GERENTE">Gerente / Compras</SelectItem>
                            </SelectContent>
                        </Select>
                        {report && report.byBranch.length > 1 && (
                            <Select value={branchFilter} onValueChange={setBranchFilter}>
                                <SelectTrigger className="w-44">
                                    <SelectValue placeholder="Sucursal" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todas las sucursales</SelectItem>
                                    {report.byBranch.map(b => (
                                        <SelectItem key={b.branchId} value={b.branchId}>{b.branchName}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                        <div className="flex items-center gap-1">
                            <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-36" />
                            <span className="text-muted-foreground text-sm">→</span>
                            <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-36" />
                        </div>
                        <Button variant="outline" size="icon" onClick={fetchReport} disabled={loading}>
                            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                        </Button>
                    </div>
                }
            />

            {/* KPIs Grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {show("foodCost") && (
                    <KPICard
                        title="Food Cost"
                        value={kpi ? `${kpi.foodCostPercent}%` : "—"}
                        subtitle={`COGS ${kpi ? formatCents(kpi.cogsCents) : "—"} · Revenue ${kpi ? formatCents(kpi.revenueCents) : "—"}`}
                        icon={<TrendingDown className="h-5 w-5" />}
                        color={kpi && kpi.foodCostPercent > 35 ? "text-red-500" : kpi && kpi.foodCostPercent > 28 ? "text-amber-500" : "text-green-500"}
                        loading={loading}
                    />
                )}

                {show("cogs") && (
                    <KPICard
                        title="COGS (Costo de Ventas)"
                        value={kpi ? formatCents(kpi.cogsCents) : "—"}
                        subtitle={`Período: ${startDate} → ${endDate}`}
                        icon={<DollarSign className="h-5 w-5" />}
                        color="text-blue-500"
                        loading={loading}
                    />
                )}

                {show("revenue") && (
                    <KPICard
                        title="Ingresos (Ventas)"
                        value={kpi ? formatCents(kpi.revenueCents) : "—"}
                        subtitle="Revenue total del período"
                        icon={<TrendingUp className="h-5 w-5" />}
                        color="text-green-500"
                        loading={loading}
                    />
                )}

                {show("turnover") && (
                    <KPICard
                        title="Rotación de Inventario"
                        value={kpi ? kpi.inventoryTurnover.toString() : "—"}
                        subtitle={`${kpi?.stockDays ?? "—"} días de stock`}
                        icon={<RefreshCw className="h-5 w-5" />}
                        color="text-purple-500"
                        loading={loading}
                    />
                )}

                {show("stockDays") && (
                    <KPICard
                        title="Días de Stock"
                        value={kpi ? kpi.stockDays.toString() : "—"}
                        subtitle="Cobertura de inventario actual"
                        icon={<Package className="h-5 w-5" />}
                        color={kpi && kpi.stockDays > 30 ? "text-amber-500" : "text-blue-500"}
                        loading={loading}
                    />
                )}

                {show("shrinkage") && (
                    <KPICard
                        title="Merma / Shrinkage"
                        value={kpi ? `${kpi.shrinkagePercent}%` : "—"}
                        subtitle="% de pérdida sobre consumo total"
                        icon={<AlertTriangle className="h-5 w-5" />}
                        color={kpi && kpi.shrinkagePercent > 5 ? "text-red-500" : "text-muted-foreground"}
                        loading={loading}
                    />
                )}

                {show("fillRate") && (
                    <KPICard
                        title="Fill Rate"
                        value={kpi ? `${kpi.fillRate}%` : "—"}
                        subtitle="% de items con stock ≥ mínimo"
                        icon={<Package className="h-5 w-5" />}
                        color={kpi && kpi.fillRate < 80 ? "text-red-500" : kpi && kpi.fillRate < 90 ? "text-amber-500" : "text-green-500"}
                        loading={loading}
                    />
                )}

                {show("countAccuracy") && (
                    <KPICard
                        title="Exactitud de Conteo"
                        value={kpi?.countAccuracy != null ? `${kpi.countAccuracy}%` : "N/A"}
                        subtitle="Último conteo: items con varianza ≤5%"
                        icon={<TrendingUp className="h-5 w-5" />}
                        color={kpi && kpi.countAccuracy != null && kpi.countAccuracy < 80 ? "text-red-500" : "text-green-500"}
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
                                            <td className={`text-right py-2 px-2 font-mono ${b.foodCostPercent > 35 ? "text-red-500" : b.foodCostPercent > 28 ? "text-amber-500" : "text-green-500"}`}>
                                                {b.foodCostPercent}%
                                            </td>
                                            <td className="text-right py-2 px-2 font-mono">{formatCents(b.cogsCents)}</td>
                                            <td className="text-right py-2 px-2 font-mono">{formatCents(b.revenueCents)}</td>
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
