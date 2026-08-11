"use client";

import { PageHeader } from "@/components/shared";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricGrid, MetricCard } from "@/components/ui/metric-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, UserPlus, FileDown, AlertTriangle, Clock, ArrowRight } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { ImssSubNav } from "@/components/compliance/imss-sub-nav";
import Link from "next/link";
import { toast } from "sonner";

interface IMSSAlta {
    userId: string;
    name: string;
    email: string;
    nss: string | null;
    curp: string | null;
    rfc: string | null;
    department: string | null;
    position: string | null;
    hireDate: string | null;
    employeeNumber: string | null;
    branchName: string | null;
    status: "PENDING" | "READY" | "REGISTERED" | "OVERDUE";
    daysSinceHire: number;
}

export default function IMSSAltasPage() {
    const [altas, setAltas] = useState<IMSSAlta[]>([]);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [selectedEmployees, setSelectedEmployees] = useState<Set<string>>(new Set());

    useEffect(() => {
        const fetchAltas = async () => {
            try {
                const res = await fetch("/api/imss/altas");
                if (res.ok) {
                    const data = await res.json();
                    setAltas(data.altas || []);
                }
            } catch (e) {
                toast.error("Error al cargar datos");
            } finally {
                setLoading(false);
            }
        };
        fetchAltas();
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
        const ready = altas.filter(a => a.status === "READY");
        if (selectedEmployees.size === ready.length) {
            setSelectedEmployees(new Set());
        } else {
            setSelectedEmployees(new Set(ready.map(a => a.userId)));
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
                    movementType: "08",
                }),
            });
            if (res.ok) {
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `IDSE_ALTAS_${new Date().toISOString().split("T")[0]}.txt`;
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

    const readyCount = altas.filter(a => a.status === "READY").length;
    const pendingCount = altas.filter(a => a.status === "PENDING").length;
    const overdueCount = altas.filter(a => a.status === "OVERDUE").length;

    const getStatusBadge = (status: string) => {
        switch (status) {
            case "READY":
                return <Badge variant="default" className="bg-success">Listo</Badge>;
            case "REGISTERED":
                return <Badge variant="secondary">Registrado</Badge>;
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
                title="IMSS Altas — Registro de Empleados"
                description="Registra nuevos empleados ante el IMSS dentro de los 5 días hábiles"
                icon={UserPlus}
            />

            <ImssSubNav />

            <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                    El registro debe completarse antes de 5 días hábiles después de la fecha de contratación.
                    Las multas por registro tardío pueden ser significativas.
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
                    icon={<UserPlus className="h-4 w-4" />}
                    tone="success"
                    subtitle="Con NSS, CURP y RFC"
                />
                <MetricCard
                    label="Vencidos"
                    value={overdueCount}
                    icon={<AlertTriangle className="h-4 w-4" />}
                    tone="destructive"
                    subtitle="Plazo vencido"
                />
            </MetricGrid>

            {altas.length > 0 ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Empleados</CardTitle>
                        <CardDescription>
                            {readyCount} listos para registrar con IMSS
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
                                    <TableHead>CURP</TableHead>
                                    <TableHead>RFC</TableHead>
                                    <TableHead>Fecha Alta</TableHead>
                                    <TableHead>Días</TableHead>
                                    <TableHead>Estado</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {altas.map(alta => (
                                    <TableRow
                                        key={alta.userId}
                                        className={alta.status === "READY" ? "border-l-2 border-success" : ""}
                                    >
                                        <TableCell>
                                            <Checkbox
                                                checked={selectedEmployees.has(alta.userId)}
                                                onCheckedChange={() => toggleEmployee(alta.userId)}
                                                disabled={alta.status !== "READY"}
                                                aria-label={`Seleccionar ${alta.name}`}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <div className="font-medium">{alta.name}</div>
                                            <div className="text-xs text-muted-foreground">
                                                {alta.department} • {alta.position}
                                            </div>
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">
                                            {alta.employeeNumber || "-"}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">
                                            {alta.nss || "-"}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">
                                            {alta.curp || "-"}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">
                                            {alta.rfc || "-"}
                                        </TableCell>
                                        <TableCell>
                                            {alta.hireDate
                                                ? new Date(alta.hireDate).toLocaleDateString("es-MX")
                                                : "-"}
                                        </TableCell>
                                        <TableCell>
                                            <span
                                                className={
                                                    alta.daysSinceHire > 5
                                                        ? "text-destructive font-bold"
                                                        : ""
                                                }
                                            >
                                                {alta.daysSinceHire}d
                                            </span>
                                        </TableCell>
                                        <TableCell>{getStatusBadge(alta.status)}</TableCell>
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
                            <UserPlus className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p>No hay empleados pendientes de registro IMSS</p>
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
                                    Generará archivo IDSE tipo 08 (Alta)
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