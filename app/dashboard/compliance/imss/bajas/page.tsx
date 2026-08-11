"use client";

import { PageHeader } from "@/components/shared";
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricGrid, MetricCard } from "@/components/ui/metric-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, UserMinus, FileDown, AlertTriangle, Clock, ArrowRight } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { ImssSubNav } from "@/components/compliance/imss-sub-nav";
import Link from "next/link";
import { toast } from "sonner";

interface IMSSBaja {
    userId: string;
    name: string;
    email: string;
    nss: string | null;
    employeeNumber: string | null;
    terminationDate: string | null;
    terminationReason: string;
    status: "PENDING" | "READY" | "DEREGISTERED" | "OVERDUE";
    daysSinceTermination: number;
}

export default function IMSSBajasPage() {
    const [bajas, setBajas] = useState<IMSSBaja[]>([]);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [selectedEmployees, setSelectedEmployees] = useState<Set<string>>(new Set());

    useEffect(() => {
        const fetchBajas = async () => {
            try {
                const res = await fetch("/api/imss/bajas");
                if (res.ok) {
                    const data = await res.json();
                    setBajas(data.bajas || []);
                }
            } catch (e) {
                toast.error("Error al cargar datos");
            } finally {
                setLoading(false);
            }
        };
        fetchBajas();
    }, []);

    const toggleEmployee = (userId: string) => {
        setSelectedEmployees(prev => {
            const next = new Set(prev);
            if (next.has(userId)) {
                next.delete(userId);
            } else {
                next.add(userId);
            }
            return next;
        });
    };

    const toggleAll = () => {
        const ready = bajas.filter(b => b.status === "READY");
        if (selectedEmployees.size === ready.length) {
            setSelectedEmployees(new Set());
        } else {
            setSelectedEmployees(new Set(ready.map(b => b.userId)));
        }
    };

    const generateIDSEFile = async () => {
        if (selectedEmployees.size === 0) {
            toast.error("Selecciona al menos un empleado");
            return;
        }
        setGenerating(true);
        try {
            const res = await fetch("/api/imss/idse-generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    employeeIds: Array.from(selectedEmployees),
                    movementType: "02",
                }),
            });
            if (res.ok) {
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `IDSE_BAJAS_${new Date().toISOString().split("T")[0]}.txt`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
                toast.success("Archivo IDSE generado");
            } else {
                toast.error("Error al generar archivo");
            }
        } catch (e) {
            toast.error("Error al generar archivo");
        } finally {
            setGenerating(false);
        }
    };

    const readyCount = bajas.filter(b => b.status === "READY").length;
    const pendingCount = bajas.filter(b => b.status === "PENDING").length;
    const overdueCount = bajas.filter(b => b.status === "OVERDUE").length;

    const getStatusBadge = (status: string) => {
        switch (status) {
            case "READY":
                return <Badge variant="default" className="bg-success">Listo</Badge>;
            case "DEREGISTERED":
                return <Badge variant="secondary">Baja Completada</Badge>;
            case "OVERDUE":
                return <Badge variant="destructive">Vencido</Badge>;
            default:
                return <Badge variant="secondary">Pendiente</Badge>;
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title="IMSS Bajas — Aviso de Baja"
                description="Notifica las bajas de empleados ante el IMSS dentro de los 5 días hábiles"
                icon={UserMinus}
            />

            <ImssSubNav />

            <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                    El aviso de baja debe completarse antes de 5 días hábiles después de la terminación.
                    No dar de baja puede resultar en obligaciones de contribución continuadas.
                </AlertDescription>
            </Alert>

            <MetricGrid columns={3}>
                <MetricCard
                    label="Pendientes"
                    value={pendingCount}
                    icon={<Clock className="h-4 w-4" />}
                    tone="warning"
                    subtitle="Sin datos completos"
                />
                <MetricCard
                    label="Listos"
                    value={readyCount}
                    icon={<UserMinus className="h-4 w-4" />}
                    tone="success"
                    subtitle="Con NSS válido"
                />
                <MetricCard
                    label="Vencidos"
                    value={overdueCount}
                    icon={<AlertTriangle className="h-4 w-4" />}
                    tone="destructive"
                    subtitle="Plazo vencido"
                />
            </MetricGrid>

            {bajas.length > 0 ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Empleados Dados de Baja</CardTitle>
                        <CardDescription>
                            {bajas.length} empleado(s) dado(s) de baja
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-12">
                                        <Checkbox
                                            checked={
                                                readyCount > 0 && selectedEmployees.size === readyCount
                                                    ? true
                                                    : selectedEmployees.size > 0
                                                        ? "indeterminate"
                                                        : false
                                            }
                                            onCheckedChange={toggleAll}
                                            aria-label="Seleccionar todos"
                                        />
                                    </TableHead>
                                    <TableHead>Nombre</TableHead>
                                    <TableHead>No. Empleado</TableHead>
                                    <TableHead>NSS</TableHead>
                                    <TableHead>Fecha Baja</TableHead>
                                    <TableHead>Razón</TableHead>
                                    <TableHead>Días</TableHead>
                                    <TableHead>Estado</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {bajas.map(baja => (
                                    <TableRow key={baja.userId}>
                                        <TableCell>
                                            <Checkbox
                                                checked={selectedEmployees.has(baja.userId)}
                                                onCheckedChange={() => toggleEmployee(baja.userId)}
                                                disabled={baja.status !== "READY"}
                                                aria-label={`Seleccionar ${baja.name}`}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <div className="font-medium">{baja.name}</div>
                                            <div className="text-xs text-muted-foreground">
                                                {baja.email}
                                            </div>
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">
                                            {baja.employeeNumber || "-"}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">
                                            {baja.nss || "-"}
                                        </TableCell>
                                        <TableCell>
                                            {baja.terminationDate
                                                ? new Date(baja.terminationDate).toLocaleDateString("es-MX")
                                                : "-"}
                                        </TableCell>
                                        <TableCell>
                                            <span className="text-sm">
                                                {baja.terminationReason}
                                            </span>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-1">
                                                <span
                                                    className={
                                                        baja.daysSinceTermination > 5
                                                            ? "text-destructive font-bold"
                                                            : ""
                                                    }
                                                >
                                                    {baja.daysSinceTermination}d
                                                </span>
                                                {baja.daysSinceTermination > 5 && (
                                                    <AlertTriangle className="h-4 w-4 text-destructive" />
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>{getStatusBadge(baja.status)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            ) : (
                <Card>
                    <CardContent className="flex items-center justify-center py-12">
                        <div className="text-center text-muted-foreground">
                            <UserMinus className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p>No hay empleados dados de baja</p>
                        </div>
                    </CardContent>
                </Card>
            )}

            {selectedEmployees.size > 0 && (
                <Card>
                    <CardContent>
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="font-medium">
                                    {selectedEmployees.size} empleado(s) seleccionado(s)
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    Generará archivo IDSE tipo 02 (Baja)
                                </p>
                            </div>
                            <Button onClick={generateIDSEFile} disabled={generating}>
                                {generating ? (
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                ) : (
                                    <FileDown className="h-4 w-4 mr-2" />
                                )}
                                Generar Archivo IDSE
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Clock className="h-5 w-5" />
                        Notas Importantes
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-start space-x-3">
                        <AlertTriangle className="h-5 w-5 text-warning mt-0.5" />
                        <div>
                            <p className="font-medium">Liquidación Final</p>
                            <p className="text-sm text-muted-foreground">
                                Asegura que todos los pagos finales estén completados antes de dar de baja
                                del IMSS para evitar complicaciones.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start space-x-3">
                        <Clock className="h-5 w-5 text-info mt-0.5" />
                        <div>
                            <p className="font-medium">Plazo de 5 Días</p>
                            <p className="text-sm text-muted-foreground">
                                La baja ante el IMSS debe completarse dentro de los 5 días hábiles.
                                Las bajas tardías pueden resultar en multas.
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div className="flex justify-end">
                <Link
                    href="/dashboard/compliance/imss/reports"
                    className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                    Ver historial de archivos generados
                    <ArrowRight className="h-3.5 w-3.5" />
                </Link>
            </div>
        </div>
    );
}