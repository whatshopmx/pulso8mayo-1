"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
    BarChart3,
    Calendar,
    DollarSign,
    Layers,
    Loader2,
    PackageSearch,
    RefreshCw,
    Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
    ResponsiveContainer,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
} from "recharts";
import { REASON_LABELS as WASTE_REASON_LABELS } from "@/lib/inventory/waste-labels";

interface Props {
    branchId: string;
}

type TabKey = "usage" | "cogs" | "par" | "valuation" | "waste";

const TABS: Array<{ key: TabKey; label: string; icon: typeof BarChart3 }> = [
    { key: "usage", label: "Uso", icon: BarChart3 },
    { key: "cogs", label: "COGS", icon: DollarSign },
    { key: "par", label: "Nivel Par", icon: Layers },
    { key: "valuation", label: "Valorización", icon: PackageSearch },
    { key: "waste", label: "Mermas", icon: Trash2 },
];

const formatMXN = (cents: number) =>
    `$${(cents / 100).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Tipos mínimos que consume la UI (subconjunto de lo que devuelve el API).
interface UsageRow {
    itemId: string; itemName: string; sku?: string; unit: string;
    beginningQty: number; receivedQty: number; endingQty: number;
    usageQty: number; usageCostCents: number;
}
interface UsageReport { rows: UsageRow[]; totalUsageCostCents: number }

interface CogsReport {
    cogsCents: number; revenueCents: number; foodCostPercent: number;
    byRecipe: Array<{ recipeName: string; costCents: number }>;
}

interface ParRow {
    itemId: string; itemName: string; unit: string; currentStock: number;
    parLevel: number; suggestedOrderQty: number; status: string;
}
interface ParReport { belowParCount: number; rows: ParRow[] }

interface ValuationRow {
    itemId: string; itemName: string; category: string | null; unit: string;
    quantityOnHand: number; totalValueCents: number;
}
interface ValuationReport {
    totalValueCents: number;
    byCategory: Array<{ category: string; totalValueCents: number }>;
    rows: ValuationRow[];
}

interface WasteReason { reason: string; entries: number; lossCents: number }
interface WasteItem { itemId: string; itemName: string; unit: string; entries: number; quantity: number; lossCents: number }
interface WasteReport {
    totalLossCents: number; trueWasteLossCents: number;
    byReason: WasteReason[]; byItem: WasteItem[];
}

// Vocabulario único con el formulario, el historial y el detalle: el mapa local
// que vivía aquí se quedaba atrás cada vez que el enum crecía (Tasks 4 y 11
// suman retención, preparación y devolución de cliente — los 7 tipos del §8.1).
const REASON_LABELS: Record<string, string> = Object.fromEntries(
    Object.entries(WASTE_REASON_LABELS).map(([value, { label }]) => [value, label])
);

const PAR_STATUS_BADGES: Record<string, { label: string; className: string }> = {
    BELOW_MIN: { label: "Bajo mínimo", className: "bg-destructive/10 text-destructive" },
    BELOW_PAR: { label: "Bajo par", className: "bg-warning/10 text-warning" },
    ABOVE_MAX: { label: "Sobre máximo", className: "bg-blue-500/10 text-blue-600" },
    OK: { label: "OK", className: "bg-success/10 text-success" },
};

export function OperationalReportsClient({ branchId }: Props) {
    const [activeTab, setActiveTab] = useState<TabKey>("usage");
    const [loading, setLoading] = useState(false);
    const [startDate, setStartDate] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        return d.toISOString().split("T")[0];
    });
    const [endDate, setEndDate] = useState(() => new Date().toISOString().split("T")[0]);

    const [usage, setUsage] = useState<UsageReport | null>(null);
    const [cogs, setCogs] = useState<CogsReport | null>(null);
    const [par, setPar] = useState<ParReport | null>(null);
    const [valuation, setValuation] = useState<ValuationReport | null>(null);
    const [waste, setWaste] = useState<WasteReport | null>(null);

    const fetchData = useCallback(async (tab: TabKey) => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ branchId });
            if (tab === "usage" || tab === "cogs" || tab === "waste") {
                params.set("startDate", startDate);
                params.set("endDate", endDate);
            }
            const res = await fetch(`/api/inventory/reports/${tab === "par" ? "par-level" : tab}?${params}`);
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || "Error al cargar el reporte");
            }
            if (tab === "usage") setUsage(data.report);
            else if (tab === "cogs") setCogs(data.report);
            else if (tab === "par") setPar(data.report);
            else if (tab === "valuation") setValuation(data.report);
            else setWaste(data.report);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Error al cargar el reporte");
        } finally {
            setLoading(false);
        }
    }, [branchId, startDate, endDate]);

    useEffect(() => {
        fetchData(activeTab);
    }, [activeTab, fetchData]);

    return (
        <div className="space-y-6">
            {/* Filtros compartidos */}
            <Card>
                <CardContent className="flex flex-wrap items-end gap-4 pt-6">
                    <div className="space-y-2">
                        <Label htmlFor="op-start">Fecha Inicio</Label>
                        <Input id="op-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="op-end">Fecha Fin</Label>
                        <Input id="op-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                    </div>
                    <Button variant="outline" className="gap-2" onClick={() => fetchData(activeTab)} disabled={loading}>
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                        Actualizar
                    </Button>
                    <span className="text-xs text-muted-foreground flex items-center gap-1 ml-auto">
                        <Calendar className="w-3 h-3" /> Valorización y nivel par siempre reflejan el stock actual
                    </span>
                </CardContent>
            </Card>

            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
                <TabsList className="flex-wrap h-auto">
                    {TABS.map(t => (
                        <TabsTrigger key={t.key} value={t.key} className="gap-1.5">
                            <t.icon className="w-4 h-4" /> {t.label}
                        </TabsTrigger>
                    ))}
                </TabsList>

                {/* USO */}
                <TabsContent value="usage" className="space-y-6">
                    <SummaryCards
                        cards={[{ label: "Costo de uso del periodo", value: usage ? formatMXN(usage.totalUsageCostCents) : "—", tone: "default" }]}
                        loading={loading}
                    />
                    <Card>
                        <CardHeader>
                            <CardTitle>Uso por Insumo</CardTitle>
                            <CardDescription>Inicial + Compras − Final = Uso, con extensión a costo</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ReportTable
                                loading={loading}
                                empty={!usage || usage.rows.length === 0}
                                headers={["Insumo", "Inicial", "Compras", "Final", "Uso", "Costo de uso"]}
                                renderRows={() => usage?.rows.map(row => (
                                    <TableRow key={row.itemId}>
                                        <TableCell>
                                            <p className="font-medium">{row.itemName}</p>
                                            {row.sku && <p className="text-xs text-muted-foreground font-mono">{row.sku}</p>}
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-muted-foreground">{row.beginningQty.toFixed(2)}</TableCell>
                                        <TableCell className="text-right font-mono text-muted-foreground">{row.receivedQty.toFixed(2)}</TableCell>
                                        <TableCell className="text-right font-mono text-muted-foreground">{row.endingQty.toFixed(2)}</TableCell>
                                        <TableCell className="text-right font-mono font-semibold">{row.usageQty.toFixed(2)} {row.unit}</TableCell>
                                        <TableCell className="text-right font-mono">{formatMXN(row.usageCostCents)}</TableCell>
                                    </TableRow>
                                ))}
                            />
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* COGS */}
                <TabsContent value="cogs" className="space-y-6">
                    <SummaryCards
                        loading={loading}
                        cards={[
                            { label: "COGS del periodo", value: cogs ? formatMXN(cogs.cogsCents) : "—" },
                            { label: "Ventas del periodo", value: cogs ? formatMXN(cogs.revenueCents) : "—" },
                            {
                                label: "Food Cost %",
                                value: cogs ? `${cogs.foodCostPercent}%` : "—",
                                tone: cogs && cogs.foodCostPercent > 35 ? "alert" : cogs ? "ok" : "default",
                            },
                        ]}
                    />
                    <Card>
                        <CardHeader>
                            <CardTitle>Costo por Receta</CardTitle>
                            <CardDescription>Dónde se fue el costo de ventas en el periodo</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {!loading && cogs && cogs.byRecipe.length > 0 && (
                                <div className="h-64">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={cogs.byRecipe.slice(0, 8).map(r => ({ name: r.recipeName, Costo: r.costCents / 100 }))}>
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
                                            <YAxis tickFormatter={(v) => `$${v}`} />
                                            <Tooltip formatter={(v) => [`$${Number(v).toLocaleString("es-MX", { minimumFractionDigits: 2 })}`, "Costo"]} />
                                            <Bar dataKey="Costo" fill="var(--destructive)" radius={[4, 4, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                            <ReportTable
                                loading={loading}
                                empty={!cogs || cogs.byRecipe.length === 0}
                                headers={["Receta", "Costo"]}
                                renderRows={() => cogs?.byRecipe.map(r => (
                                    <TableRow key={r.recipeName}>
                                        <TableCell className="font-medium">{r.recipeName}</TableCell>
                                        <TableCell className="text-right font-mono">{formatMXN(r.costCents)}</TableCell>
                                    </TableRow>
                                ))}
                            />
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* NIVEL PAR */}
                <TabsContent value="par" className="space-y-6">
                    <SummaryCards
                        loading={loading}
                        cards={[{
                            label: "Insumos bajo par",
                            value: par ? String(par.belowParCount) : "—",
                            tone: par && par.belowParCount > 0 ? "alert" : "ok",
                        }]}
                    />
                    <Card>
                        <CardHeader>
                            <CardTitle>Sugerido a Pedir</CardTitle>
                            <CardDescription>
                                Par = max(mínimo configurado, uso semanal × lead time). Ordenado por criticidad.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ReportTable
                                loading={loading}
                                empty={!par || par.rows.length === 0}
                                headers={["Insumo", "Stock actual", "Nivel par", "Sugerido a pedir", "Estado"]}
                                renderRows={() => par?.rows.map(row => {
                                    const badge = PAR_STATUS_BADGES[row.status] ?? PAR_STATUS_BADGES.OK;
                                    return (
                                        <TableRow key={row.itemId}>
                                            <TableCell className="font-medium">{row.itemName}</TableCell>
                                            <TableCell className="text-right font-mono text-muted-foreground">{row.currentStock.toFixed(2)} {row.unit}</TableCell>
                                            <TableCell className="text-right font-mono text-muted-foreground">{row.parLevel.toFixed(0)} {row.unit}</TableCell>
                                            <TableCell className={cn(
                                                "text-right font-mono font-semibold",
                                                row.suggestedOrderQty > 0 ? "text-warning" : "text-muted-foreground"
                                            )}>
                                                {row.suggestedOrderQty > 0 ? `${row.suggestedOrderQty.toFixed(2)} ${row.unit}` : "—"}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Badge variant="secondary" className={badge.className}>{badge.label}</Badge>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            />
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* VALORIZACIÓN */}
                <TabsContent value="valuation" className="space-y-6">
                    <SummaryCards
                        loading={loading}
                        cards={[
                            { label: "Valor total del inventario", value: valuation ? formatMXN(valuation.totalValueCents) : "—" },
                        ]}
                    />
                    {valuation && valuation.byCategory.length > 0 && !loading && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Valor por Categoría</CardTitle>
                            </CardHeader>
                            <CardContent className="h-56">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={valuation.byCategory.slice(0, 8).map(c => ({ name: c.category, Valor: c.totalValueCents / 100 }))}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
                                        <YAxis tickFormatter={(v) => `$${v}`} />
                                        <Tooltip formatter={(v) => [`$${Number(v).toLocaleString("es-MX", { minimumFractionDigits: 2 })}`, "Valor"]} />
                                        <Bar dataKey="Valor" fill="var(--muted-foreground)" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                    )}
                    <Card>
                        <CardHeader>
                            <CardTitle>Detalle por Insumo</CardTitle>
                            <CardDescription>Cantidad en mano × costo efectivo por lote</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ReportTable
                                loading={loading}
                                empty={!valuation || valuation.rows.length === 0}
                                headers={["Insumo", "Categoría", "Cantidad", "Valor"]}
                                renderRows={() => valuation?.rows.map(row => (
                                    <TableRow key={row.itemId}>
                                        <TableCell className="font-medium">{row.itemName}</TableCell>
                                        <TableCell className="text-muted-foreground">{row.category ?? "Sin categoría"}</TableCell>
                                        <TableCell className="text-right font-mono text-muted-foreground">{row.quantityOnHand.toFixed(2)} {row.unit}</TableCell>
                                        <TableCell className="text-right font-mono font-semibold">{formatMXN(row.totalValueCents)}</TableCell>
                                    </TableRow>
                                ))}
                            />
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* MERMAS */}
                <TabsContent value="waste" className="space-y-6">
                    <SummaryCards
                        loading={loading}
                        cards={[
                            { label: "Pérdida real del periodo", value: waste ? formatMXN(waste.trueWasteLossCents) : "—", tone: "alert" },
                            { label: "Total registrado (incluye consumo interno)", value: waste ? formatMXN(waste.totalLossCents) : "—" },
                        ]}
                    />
                    <div className="grid gap-6 lg:grid-cols-2">
                        <Card>
                            <CardHeader>
                                <CardTitle>Por Razón</CardTitle>
                                <CardDescription>STAFF y COURTESY son consumo autorizado, no merma</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <ReportTable
                                    loading={loading}
                                    empty={!waste || waste.byReason.length === 0}
                                    headers={["Razón", "Registros", "Pérdida"]}
                                    renderRows={() => waste?.byReason.map(r => (
                                        <TableRow key={r.reason}>
                                            <TableCell className="font-medium">{REASON_LABELS[r.reason] ?? r.reason}</TableCell>
                                            <TableCell className="text-right font-mono text-muted-foreground">{r.entries}</TableCell>
                                            <TableCell className="text-right font-mono">{formatMXN(r.lossCents)}</TableCell>
                                        </TableRow>
                                    ))}
                                />
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader>
                                <CardTitle>Por Insumo</CardTitle>
                                <CardDescription>Los que más dinero están tirando a la basura</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <ReportTable
                                    loading={loading}
                                    empty={!waste || waste.byItem.length === 0}
                                    headers={["Insumo", "Cantidad", "Pérdida"]}
                                    renderRows={() => waste?.byItem.map(r => (
                                        <TableRow key={r.itemId}>
                                            <TableCell className="font-medium">{r.itemName}</TableCell>
                                            <TableCell className="text-right font-mono text-muted-foreground">{r.quantity.toFixed(2)} {r.unit}</TableCell>
                                            <TableCell className="text-right font-mono">{formatMXN(r.lossCents)}</TableCell>
                                        </TableRow>
                                    ))}
                                />
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
}

function SummaryCards({ cards, loading }: {
    loading: boolean;
    cards: Array<{ label: string; value: string; tone?: "default" | "ok" | "alert" }>;
}) {
    const tones = {
        default: "",
        ok: "text-success",
        alert: "text-destructive",
    };
    return (
        <div className={cn("grid gap-4", cards.length > 1 ? "md:grid-cols-3" : "md:grid-cols-1")}>
            {cards.map(c => (
                <Card key={c.label}>
                    <CardContent className="pt-6">
                        <p className="text-sm text-muted-foreground">{c.label}</p>
                        {loading ? (
                            <Loader2 className="w-5 h-5 animate-spin mt-2" />
                        ) : (
                            <p className={cn("text-2xl font-semibold tracking-tight", c.tone && tones[c.tone])}>{c.value}</p>
                        )}
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}

function ReportTable({ loading, empty, headers, renderRows }: {
    loading: boolean;
    empty: boolean;
    headers: string[];
    renderRows: () => ReactNode;
}) {
    if (loading) {
        return (
            <div className="flex justify-center items-center py-12">
                <Loader2 className="w-8 h-8 animate-spin" />
            </div>
        );
    }
    if (empty) {
        return (
            <div className="text-center py-12 text-muted-foreground">
                <PackageSearch className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No hay datos para este reporte en el rango seleccionado.</p>
                <p className="text-xs text-muted-foreground">Registra movimientos y ventas para poblarlo.</p>
            </div>
        );
    }
    return (
        <div className="border rounded-lg overflow-x-auto">
            <Table>
                <TableHeader className="bg-muted">
                    <TableRow>
                        {headers.map((h, i) => (
                            <TableHead key={h} className={i > 0 ? "text-right" : ""}>{h}</TableHead>
                        ))}
                    </TableRow>
                </TableHeader>
                <TableBody>{renderRows()}</TableBody>
            </Table>
        </div>
    );
}
