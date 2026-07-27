"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, RefreshCw, Building2 } from "lucide-react";

interface BranchConfig {
    branchId: string;
    branchName: string;
    costingMethod: 'LAST_COST' | 'AVERAGE_COST';
    effectiveFrom: 'BRANCH' | 'COMPANY';
}

export default function CostingSettingsPage() {
    const [configs, setConfigs] = useState<BranchConfig[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);

    const fetchConfigs = async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/inventory/costing/config");
            const data = await res.json();
            if (res.ok) setConfigs(data.configs || []);
            else toast.error(data.error || "Error al cargar configuración");
        } catch {
            toast.error("Error de red");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchConfigs(); }, []);

    const updateMethod = async (branchId: string, method: string) => {
        setSaving(branchId);
        try {
            const res = await fetch("/api/inventory/costing/config", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ branchId, method }),
            });
            if (res.ok) {
                toast.success("Método de costeo actualizado");
                fetchConfigs();
            } else {
                const data = await res.json();
                toast.error(data.error || "Error al actualizar");
            }
        } catch {
            toast.error("Error de red");
        } finally {
            setSaving(null);
        }
    };

    const resetMethod = async (branchId: string) => {
        setSaving(branchId);
        try {
            const res = await fetch("/api/inventory/costing/config", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ branchId, reset: true }),
            });
            if (res.ok) {
                toast.success("Método restablecido al valor de la compañía");
                fetchConfigs();
            } else {
                const data = await res.json();
                toast.error(data.error || "Error al restablecer");
            }
        } catch {
            toast.error("Error de red");
        } finally {
            setSaving(null);
        }
    };

    return (
        <div className="space-y-6">
            <PageHeader
                title="Configuración de Costeo"
                description="Elige el método de costeo por sucursal — Último Costo (LAST_COST) o Costo Promedio (AVERAGE_COST)"
                actions={
                    <Button variant="outline" size="icon" onClick={fetchConfigs} disabled={loading}>
                        <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                    </Button>
                }
            />

            <Card>
                <CardHeader>
                    <CardTitle>Métodos por Sucursal</CardTitle>
                    <CardDescription>
                        Cada sucursal puede usar un método distinto. Si no se configura, usa el método de la compañía.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b text-muted-foreground">
                                        <th className="text-left py-2 px-2">Sucursal</th>
                                        <th className="text-left py-2 px-2">Método Actual</th>
                                        <th className="text-left py-2 px-2">Origen</th>
                                        <th className="text-right py-2 px-2">Acción</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {configs.map(c => (
                                        <tr key={c.branchId} className="border-b hover:bg-muted/50">
                                            <td className="py-2 px-2 font-medium">
                                                <div className="flex items-center gap-2">
                                                    <Building2 className="h-4 w-4 text-muted-foreground" />
                                                    {c.branchName}
                                                </div>
                                            </td>
                                            <td className="py-2 px-2">
                                                <Badge variant={c.costingMethod === 'AVERAGE_COST' ? "secondary" : "outline"}>
                                                    {c.costingMethod === 'AVERAGE_COST' ? "Costo Promedio" : "Último Costo"}
                                                </Badge>
                                            </td>
                                            <td className="py-2 px-2 text-muted-foreground">
                                                {c.effectiveFrom === 'BRANCH' ? "Sucursal" : "Compañía"}
                                            </td>
                                            <td className="text-right py-2 px-2">
                                                <div className="flex items-center justify-end gap-2">
                                                    <Select
                                                        value={c.costingMethod}
                                                        onValueChange={(val) => updateMethod(c.branchId, val)}
                                                        disabled={saving === c.branchId}
                                                    >
                                                        <SelectTrigger className="w-44 h-8">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="LAST_COST">Último Costo</SelectItem>
                                                            <SelectItem value="AVERAGE_COST">Costo Promedio</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                    {c.effectiveFrom === 'BRANCH' && (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => resetMethod(c.branchId)}
                                                            disabled={saving === c.branchId}
                                                            className="text-xs text-muted-foreground"
                                                        >
                                                            Restablecer
                                                        </Button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
