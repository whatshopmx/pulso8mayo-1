"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PageHeader, PageContainer } from "@/components/shared";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingUp, Calendar, AlertCircle, RefreshCw, Loader2, Check, Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { ManualSalesEntry } from "@/components/inventory/manual-sales-entry";
import { useBranch } from "@/lib/branch-context";
import type { VarianceReportRow } from "@/lib/services/reports-service";

interface Recipe {
    id: string;
    name: string;
}

export default function InventoryReportsPage() {
    const { selectedBranchId } = useBranch();
    const [reportRows, setReportRows] = useState<VarianceReportRow[]>([]);
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

    useEffect(() => {
        // Load recipes
        fetch("/api/inventory/recipes")
            .then(res => res.ok && res.json())
            .then(data => setRecipes(data || []))
            .catch(err => console.error(err));
    }, []);

    const fetchReport = useCallback(async () => {
        if (!selectedBranchId) {
            setReportRows([]);
            return;
        }
        setLoadingReport(true);
        try {
            const res = await fetch(`/api/inventory/reports/variance?startDate=${startDate}&endDate=${endDate}&branchId=${selectedBranchId}`);
            const data = await res.json();
            if (res.ok) {
                setReportRows(data.report || []);
            } else {
                toast.error(data.error || "Error al cargar reporte de mermas");
            }
        } catch {
            toast.error("Error al cargar reporte");
        } finally {
            setLoadingReport(false);
        }
    }, [selectedBranchId, startDate, endDate]);

    useEffect(() => {
        fetchReport();
    }, [fetchReport]);

    // Prepare chart data (top 5 items with highest mermas/variance)
    const chartData = [...reportRows]
        .filter(r => r.varianceQty !== null && r.actualQty !== null && r.varianceQty > 0)
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
                description="Cruza tus recetas contra ventas y existencias físicas de inventario para encontrar mermas de ingredientes"
                icon={TrendingUp}
            />

            <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-3 mt-6">
                {/* Filters, POS simulator, and CSV import */}
                <div className="min-w-0 lg:col-span-1 space-y-6">
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

                    <ManualSalesEntry key={selectedBranchId ?? 'all'} branchId={selectedBranchId} recipes={recipes} onSaved={fetchReport} />
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2"><Upload className="h-4 w-4" />Ventas desde archivo</CardTitle>
                            <CardDescription>Importa archivos nuevos con mapeo de columnas y vista previa en la pantalla de carga de ventas. Si ya registraste esas ventas aquí, corrige el total manual para ese día.</CardDescription>
                        </CardHeader>
                        <CardFooter>
                            <Button asChild variant="outline" className="w-full"><Link href="/dashboard/inventory/sales-entry">Importar CSV de ventas</Link></Button>
                        </CardFooter>
                    </Card>
                </div>

                {/* Report results & Recharts */}
                <div className="min-w-0 lg:col-span-2 space-y-6">
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
                                        <Bar dataKey="Teorico" fill="var(--muted-foreground)" name="Teórico" />
                                        <Bar dataKey="Real" fill="var(--destructive)" name="Real" />
                                        <Bar dataKey="Merma" fill="var(--warning)" name="Diferencia/Merma" />
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
                            ) : !selectedBranchId ? (
                                <div className="text-center py-12 text-muted-foreground">
                                    <AlertCircle className="w-12 h-12 mx-auto mb-4 text-amber-500 opacity-75" />
                                    <p className="font-medium text-foreground">Selecciona una sucursal específica</p>
                                    <p className="text-xs text-muted-foreground mt-1">El cálculo de mermas y variaciones requiere una sucursal en el selector superior.</p>
                                </div>
                            ) : reportRows.length === 0 ? (
                                <div className="text-center py-12 text-muted-foreground">
                                    <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                                    <p>No se encontraron datos de variación para este rango.</p>
                                    <p className="text-xs text-muted-foreground">Registra ventas y movimientos de inventario para poblar el reporte.</p>
                                </div>
                            ) : (
                                <div className="border rounded-lg overflow-x-auto">
                                    <Table aria-label="Variaciones de insumos" tabIndex={0} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                        <TableHeader className="bg-muted">
                                            <TableRow>
                                                <TableHead>Insumo</TableHead>
                                                <TableHead className="text-right">Teórico (Recetas)</TableHead>
                                                <TableHead className="text-right">Real (Movimientos)</TableHead>
                                                <TableHead className="text-right">Variación</TableHead>
                                                <TableHead className="text-right">Estado</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {reportRows.map(row => {
                                                const varianceVal = row.varianceQty;
                                                const missingCounts = row.actualQty === null || varianceVal === null || row.variancePercent === null;
                                                const isAlert = varianceVal > 0;

                                                return (
                                                    <TableRow key={row.itemId}>
                                                        <TableCell>
                                                            <p className="font-medium text-foreground">{row.itemName}</p>
                                                            {row.sku && <p className="text-xs text-muted-foreground font-mono">{row.sku}</p>}
                                                            {missingCounts && <p className="mt-1 text-xs text-muted-foreground">{row.actionableNote ?? 'Falta conteo físico inicial o final en este periodo.'}</p>}
                                                        </TableCell>
                                                        <TableCell className="text-right font-mono text-muted-foreground">
                                                            {row.theoreticalQty.toFixed(2)} {row.unit}
                                                        </TableCell>
                                                        <TableCell className="text-right font-mono text-muted-foreground">
                                                            {row.actualQty === null ? '—' : `${row.actualQty.toFixed(2)} ${row.unit}`}
                                                        </TableCell>
                                                        <TableCell className={cn(
                                                            "text-right font-mono font-semibold",
                                                            varianceVal === null ? "text-muted-foreground" : varianceVal > 0 ? "text-destructive" : (varianceVal < 0 ? "text-success" : "text-muted-foreground")
                                                        )}>
                                                            {varianceVal === null ? '—' : `${varianceVal > 0 ? '+' : ''}${varianceVal.toFixed(2)} ${row.unit}`}
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            {missingCounts ? <Badge variant="secondary">Falta conteo</Badge> : isAlert ? (
                                                                <Badge variant="destructive" className="gap-1">
                                                                    <AlertCircle className="w-3 h-3" /> Merma: {row.variancePercent.toFixed(0)}%
                                                                </Badge>
                                                            ) : (
                                                                <Badge variant="secondary" className="bg-success/10 text-success">
                                                                    <Check className="w-3 h-3" /> Conforme
                                                                </Badge>
                                                            )}
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>

        </PageContainer>
    );
}
