"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ZAxis, Cell, LabelList } from "recharts";

interface MenuItem {
    recipeId: string;
    recipeName: string;
    totalSold: number;
    revenueCents: number;
    costCents: number;
    foodCostPercent: number;
    marginPercent: number;
    quadrant: "STAR" | "CASH_COW" | "QUESTION_MARK" | "DOG";
}

interface MatrixData {
    items: MenuItem[];
    medianPopularity: number;
    medianMargin: number;
    period: { start: string; end: string };
}

const QUAD_META: Record<string, { label: string; desc: string; color: string; bg: string }> = {
    STAR: { label: "Estrella", desc: "Alta rentabilidad · Alta popularidad", color: "#16a34a", bg: "#dcfce7" },
    CASH_COW: { label: "Vaca", desc: "Alta rentabilidad · Baja popularidad", color: "#2563eb", bg: "#dbeafe" },
    QUESTION_MARK: { label: "Incógnita", desc: "Baja rentabilidad · Alta popularidad", color: "#d97706", bg: "#fef3c7" },
    DOG: { label: "Peso", desc: "Baja rentabilidad · Baja popularidad", color: "#dc2626", bg: "#fee2e2" },
};

function formatCents(cents: number): string {
    return "$" + (cents / 100).toLocaleString("es-MX", { minimumFractionDigits: 2 });
}

const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload as MenuItem;
    const meta = QUAD_META[d.quadrant];
    return (
        <div className="bg-white border rounded-lg shadow-lg p-3 text-sm space-y-1">
            <p className="font-bold">{d.recipeName}</p>
            <p className="text-xs text-muted-foreground">{meta.label} · {meta.desc}</p>
            <div className="pt-1 space-y-0.5">
                <p>Food Cost: <span className="font-mono">{d.foodCostPercent}%</span></p>
                <p>Margen: <span className="font-mono">{d.marginPercent}%</span></p>
                <p>Vendido: <span className="font-mono">{d.totalSold} uds</span></p>
                <p>Revenue: <span className="font-mono">{formatCents(d.revenueCents)}</span></p>
            </div>
        </div>
    );
};

export function MenuEngineeringMatrix() {
    const [data, setData] = useState<MatrixData | null>(null);
    const [loading, setLoading] = useState(true);
    const [startDate, setStartDate] = useState(() => {
        const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split("T")[0];
    });
    const [endDate, setEndDate] = useState(() => new Date().toISOString().split("T")[0]);

    const fetchMatrix = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/inventory/menu-engineering?startDate=${startDate}&endDate=${endDate}`);
            const json = await res.json();
            if (res.ok) setData(json);
            else toast.error(json.error || "Error al cargar matriz");
        } catch {
            toast.error("Error de red");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchMatrix(); }, []);

    const items = data?.items ?? [];
    const chartData = items.map(i => ({
        ...i,
        x: i.totalSold,
        y: i.marginPercent,
        z: Math.max(20, Math.min(80, i.totalSold)),
    }));

    const quadrants = ["STAR", "CASH_COW", "QUESTION_MARK", "DOG"] as const;

    return (
        <div className="space-y-6">
            <PageHeader
                title="Matriz de Ingeniería de Menú"
                description="Estrella · Vaca · Incógnita · Peso — Rentabilidad vs Popularidad"
                actions={
                    <div className="flex items-center gap-2">
                        <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-36" />
                        <span className="text-muted-foreground text-sm">→</span>
                        <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-36" />
                        <Button variant="outline" size="icon" onClick={fetchMatrix} disabled={loading}>
                            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                        </Button>
                    </div>
                }
            />

            {/* Quadrant legend */}
            <div className="flex flex-wrap gap-3">
                {quadrants.map(q => {
                    const m = QUAD_META[q];
                    return (
                        <Badge key={q} variant="outline" className="gap-1.5 px-3 py-1" style={{ borderColor: m.color, color: m.color }}>
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: m.color }} />
                            {m.label}
                        </Badge>
                    );
                })}
            </div>

            {/* Matrix chart */}
            <Card>
                <CardContent className="pt-6">
                    {loading ? (
                        <div className="flex items-center justify-center h-96">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : chartData.length === 0 ? (
                        <div className="flex items-center justify-center h-96 text-muted-foreground">
                            No hay datos de ventas en el período seleccionado
                        </div>
                    ) : (
                        <div className="h-[500px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <ScatterChart margin={{ top: 20, right: 20, bottom: 40, left: 60 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                    <XAxis
                                        type="number"
                                        dataKey="x"
                                        name="Popularidad"
                                        label={{ value: "Popularidad (uds vendidas)", position: "bottom", offset: 10 }}
                                        tick={{ fontSize: 12 }}
                                    />
                                    <YAxis
                                        type="number"
                                        dataKey="y"
                                        name="Rentabilidad"
                                        domain={[0, 100]}
                                        label={{ value: "Margen (%)", angle: -90, position: "insideLeft", offset: -5 }}
                                        tick={{ fontSize: 12 }}
                                    />
                                    <ZAxis type="number" dataKey="z" range={[60, 400]} />
                                    <Tooltip content={<CustomTooltip />} />
                                    {data && (
                                        <>
                                            {/* Median lines */}
                                            <CartesianGrid
                                                horizontalPoints={[data.medianMargin]}
                                                verticalPoints={[data.medianPopularity]}
                                                stroke="#94a3b8"
                                                strokeDasharray="8 4"
                                            />
                                        </>
                                    )}
                                    {quadrants.map(q => (
                                        <Scatter
                                            key={q}
                                            data={chartData.filter(i => i.quadrant === q)}
                                            fill={QUAD_META[q].color}
                                            name={QUAD_META[q].label}
                                        >
                                            {chartData.filter(i => i.quadrant === q).map((entry, idx) => (
                                                <Cell key={entry.recipeId} fill={QUAD_META[q].color} />
                                            ))}
                                        </Scatter>
                                    ))}
                                </ScatterChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Table */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Desglose por Platillo</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b text-muted-foreground">
                                    <th className="text-left py-2 px-2">Platillo</th>
                                    <th className="text-center py-2 px-2">Cuadrante</th>
                                    <th className="text-right py-2 px-2">Vendido</th>
                                    <th className="text-right py-2 px-2">Food Cost</th>
                                    <th className="text-right py-2 px-2">Margen</th>
                                    <th className="text-right py-2 px-2">Revenue</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.map(i => {
                                    const meta = QUAD_META[i.quadrant];
                                    return (
                                        <tr key={i.recipeId} className="border-b hover:bg-muted/50">
                                            <td className="py-2 px-2 font-medium">{i.recipeName}</td>
                                            <td className="text-center py-2 px-2">
                                                <Badge variant="outline" style={{ borderColor: meta.color, color: meta.color }}>
                                                    {meta.label}
                                                </Badge>
                                            </td>
                                            <td className="text-right py-2 px-2 font-mono">{i.totalSold}</td>
                                            <td className="text-right py-2 px-2 font-mono">{i.foodCostPercent}%</td>
                                            <td className="text-right py-2 px-2 font-mono">{i.marginPercent}%</td>
                                            <td className="text-right py-2 px-2 font-mono">{formatCents(i.revenueCents)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
