"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, PageContainer } from "@/components/shared";
import { TrendingUp, Plus, Calendar, AlertCircle, ShoppingCart, RefreshCw, Loader2, ArrowRight, Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

interface VarianceRow {
    itemId: string;
    itemName: string;
    sku?: string;
    unit: string;
    theoreticalQty: number;
    actualQty: number;
    varianceQty: number;
    variancePercent: number;
}

interface Recipe {
    id: string;
    name: string;
}

export default function InventoryReportsPage() {
    const [reportRows, setReportRows] = useState<VarianceRow[]>([]);
    const [recipes, setRecipes] = useState<Recipe[]>([]);
    const [loadingReport, setLoadingReport] = useState(false);

    // Filter Dates
    const [startDate, setStartDate] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        return d.toISOString().split('T')[0];
    });
    const [endDate, setEndDate] = useState(() => {
        return new Date().toISOString().split('T')[0];
    });

    // POS Sales Entry state
    const [selectedRecipeId, setSelectedRecipeId] = useState("");
    const [saleQty, setSaleQty] = useState(1);
    const [saleRevenue, setSaleRevenue] = useState(0);
    const [isSavingSale, setIsSavingSale] = useState(false);

    useEffect(() => {
        // Load recipes
        fetch("/api/inventory/recipes")
            .then(res => res.ok && res.json())
            .then(data => setRecipes(data || []))
            .catch(err => console.error(err));

        fetchReport();
    }, []);

    const fetchReport = async () => {
        setLoadingReport(true);
        try {
            const res = await fetch(`/api/inventory/reports/variance?startDate=${startDate}&endDate=${endDate}`);
            const data = await res.json();
            if (res.ok) {
                setReportRows(data.report || []);
            } else {
                toast.error(data.error || "Error al cargar reporte de mermas");
            }
        } catch (error) {
            toast.error("Error al cargar reporte");
        } finally {
            setLoadingReport(false);
        }
    };

    const handleSaveSale = async () => {
        if (!selectedRecipeId) {
            toast.error("Selecciona una receta/platillo");
            return;
        }

        setIsSavingSale(true);
        try {
            const res = await fetch("/api/inventory/sales-entry", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sales: [{
                        recipeId: selectedRecipeId,
                        quantitySold: saleQty,
                        totalRevenue: saleRevenue || undefined,
                    }],
                    saleDate: new Date().toISOString(),
                }),
            });

            const result = await res.json();
            if (res.ok) {
                toast.success("Venta registrada y deconsolidación de ingredientes completada");
                // Reset form
                setSelectedRecipeId("");
                setSaleQty(1);
                setSaleRevenue(0);
                // Refresh report
                fetchReport();
            } else {
                toast.error(result.error || "Error al registrar la venta");
            }
        } catch (error) {
            toast.error("Error de servidor");
        } finally {
            setIsSavingSale(false);
        }
    };

    // Prepare chart data (top 5 items with highest mermas/variance)
    const chartData = [...reportRows]
        .filter(r => r.varianceQty > 0)
        .sort((a, b) => b.varianceQty - a.varianceQty)
        .slice(0, 5)
        .map(r => ({
            name: r.itemName,
            Teorico: r.theoreticalQty,
            Real: r.actualQty,
            Merma: r.varianceQty,
        }));

    return (
        <PageContainer>
            <PageHeader
                title="Reporte de Mermas y Variaciones"
                description="Cruza tus recetas contra ventas y existencias físicas de inventario para encontrar mermas ocultas"
                icon={TrendingUp}
            />

            <div className="grid gap-6 lg:grid-cols-3 mt-6">
                {/* Filters and POS simulator */}
                <div className="lg:col-span-1 space-y-6">
                    {/* Date Filters Card */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                                <Calendar className="w-4 h-4" /> Rango de Fechas
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="start-date">Fecha Inicio</Label>
                                <Input
                                    id="start-date"
                                    type="date"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="end-date">Fecha Fin</Label>
                                <Input
                                    id="end-date"
                                    type="date"
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                />
                            </div>
                        </CardContent>
                        <CardFooter>
                            <Button className="w-full gap-2" onClick={fetchReport} disabled={loadingReport}>
                                {loadingReport ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                                Actualizar Reporte
                            </Button>
                        </CardFooter>
                    </Card>

                    {/* POS Sales Entry simulation Card */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                                <ShoppingCart className="w-4 h-4" /> Simular Ventas (POS)
                            </CardTitle>
                            <CardDescription>
                                Registra la venta de platillos para descontar automáticamente sus ingredientes del inventario.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label>Receta / Platillo</Label>
                                <Select value={selectedRecipeId} onValueChange={setSelectedRecipeId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Seleccionar platillo..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {recipes.map(r => (
                                            <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <Label>Cantidad</Label>
                                    <Input
                                        type="number"
                                        min="1"
                                        value={saleQty}
                                        onChange={(e) => setSaleQty(Number(e.target.value))}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Ingreso Venta ($)</Label>
                                    <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={saleRevenue || ""}
                                        onChange={(e) => setSaleRevenue(Number(e.target.value))}
                                        placeholder="0.00"
                                    />
                                </div>
                            </div>
                        </CardContent>
                        <CardFooter>
                            <Button className="w-full gap-2" onClick={handleSaveSale} disabled={isSavingSale}>
                                {isSavingSale ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                                Registrar Venta
                            </Button>
                        </CardFooter>
                    </Card>
                </div>

                {/* Report results & Recharts */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Visual Chart Card */}
                    {chartData.length > 0 && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Top 5 Desviaciones / Mermas de Insumos</CardTitle>
                                <CardDescription>
                                    Insumos con mayor consumo real excedente frente al teórico
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="h-64">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={chartData}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="name" />
                                        <YAxis />
                                        <Tooltip />
                                        <Legend />
                                        <Bar dataKey="Teorico" fill="#94a3b8" name="Teórico" />
                                        <Bar dataKey="Real" fill="#f43f5e" name="Real" />
                                        <Bar dataKey="Merma" fill="#f97316" name="Diferencia/Merma" />
                                    </BarChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                    )}

                    {/* Variance Table Card */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Consumo Teórico vs Real</CardTitle>
                            <CardDescription>
                                Listado completo de insumos de inventario y su variación calculada en el rango seleccionado.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {loadingReport ? (
                                <div className="flex justify-center items-center py-12">
                                    <Loader2 className="w-8 h-8 animate-spin" />
                                </div>
                            ) : reportRows.length === 0 ? (
                                <div className="text-center py-12 text-muted-foreground">
                                    <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                                    <p>No se encontraron datos de variación para este rango.</p>
                                    <p className="text-xs text-slate-500">Registra ventas y movimientos de inventario para poblar el reporte.</p>
                                </div>
                            ) : (
                                <div className="border rounded-lg overflow-x-auto">
                                    <table className="min-w-full divide-y divide-border text-sm">
                                        <thead className="bg-slate-50">
                                            <tr>
                                                <th className="px-4 py-3 text-left font-semibold text-slate-700">Insumo</th>
                                                <th className="px-4 py-3 text-right font-semibold text-slate-700">Teórico (Recetas)</th>
                                                <th className="px-4 py-3 text-right font-semibold text-slate-700">Real (Movimientos)</th>
                                                <th className="px-4 py-3 text-right font-semibold text-slate-700">Variación</th>
                                                <th className="px-4 py-3 text-right font-semibold text-slate-700">Estado</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border">
                                            {reportRows.map(row => {
                                                const varianceVal = row.varianceQty;
                                                const isAlert = varianceVal > 0;

                                                return (
                                                    <tr key={row.itemId} className="hover:bg-slate-50/50">
                                                        <td className="px-4 py-3">
                                                            <p className="font-medium text-slate-800">{row.itemName}</p>
                                                            {row.sku && <p className="text-xs text-slate-400 font-mono">{row.sku}</p>}
                                                        </td>
                                                        <td className="px-4 py-3 text-right font-mono text-slate-600">
                                                            {row.theoreticalQty.toFixed(2)} {row.unit}
                                                        </td>
                                                        <td className="px-4 py-3 text-right font-mono text-slate-600">
                                                            {row.actualQty.toFixed(2)} {row.unit}
                                                        </td>
                                                        <td className={cn(
                                                            "px-4 py-3 text-right font-mono font-semibold",
                                                            varianceVal > 0 ? "text-destructive" : (varianceVal < 0 ? "text-emerald-600" : "text-slate-600")
                                                        )}>
                                                            {varianceVal > 0 ? `+${varianceVal.toFixed(2)}` : varianceVal.toFixed(2)} {row.unit}
                                                        </td>
                                                        <td className="px-4 py-3 text-right">
                                                            {isAlert ? (
                                                                <Badge variant="destructive" className="gap-1">
                                                                    <AlertCircle className="w-3 h-3" /> Merma: {row.variancePercent.toFixed(0)}%
                                                                </Badge>
                                                            ) : (
                                                                <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                                                                    <Check className="w-3 h-3" /> Conforme
                                                                </Badge>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </PageContainer>
    );
}
