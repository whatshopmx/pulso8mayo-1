"use client";

import { PageHeader } from "@/components/shared";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, FileDown, AlertTriangle, ArrowRight } from "lucide-react";
import { ImssSubNav } from "@/components/compliance/imss-sub-nav";
import Link from "next/link";
import { toast } from "sonner";

/** Salario diario de referencia cuando el empleado no tiene salario base capturado. */
const IMSS_MIN_SALARY_DEFAULT = 300;

interface EmployeeSalary {
    userId: string;
    name: string;
    employeeNumber: string | null;
    nss: string | null;
    baseSalary: number | null;
    position: string | null;
    branchName: string;
}

export default function SUAGeneratorPage() {
    const [employees, setEmployees] = useState<EmployeeSalary[]>([]);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [selectedEmployees, setSelectedEmployees] = useState<Map<string, number>>(new Map());
    const [fechaMovimiento, setFechaMovimiento] = useState(
        new Date().toISOString().slice(0, 10)
    );

    useEffect(() => {
        const fetchEmployees = async () => {
            try {
                const res = await fetch("/api/employees");
                if (res.ok) {
                    const data = await res.json();
                    const emps = (data.employees || []).filter((e: EmployeeSalary) => e.nss);
                    setEmployees(emps);
                }
            } catch (e) {
                toast.error("Error al cargar empleados");
            } finally {
                setLoading(false);
            }
        };
        fetchEmployees();
    }, []);

    const handleSalaryChange = (userId: string, value: string) => {
        const numValue = parseFloat(value) || 0;
        setSelectedEmployees(prev => {
            const next = new Map(prev);
            if (numValue > 0) {
                next.set(userId, numValue);
            } else {
                next.delete(userId);
            }
            return next;
        });
    };

    const getDefaultSalary = (userId: string) => {
        const emp = employees.find(e => e.userId === userId);
        return selectedEmployees.get(userId) || emp?.baseSalary || IMSS_MIN_SALARY_DEFAULT;
    };

    const generateSUAFile = async () => {
        if (selectedEmployees.size === 0) {
            toast.error("Ingresa al menos un salario");
            return;
        }
        setGenerating(true);
        try {
            const employeeIds = Array.from(selectedEmployees.keys());
            const salaries: Record<string, number> = {};
            selectedEmployees.forEach((salary: number, id: string) => {
                salaries[id] = salary;
            });

            const res = await fetch("/api/imss/sua-generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    employeeIds,
                    newSalaries: salaries,
                    fechaMovimiento,
                }),
            });

            if (res.ok) {
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `SUA_ACTUALIZACION_${fechaMovimiento.replace(/-/g, "")}.txt`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
                toast.success("Archivo SUA generado");
            } else {
                toast.error("Error al generar archivo");
            }
        } catch (e) {
            toast.error("Error al generar archivo");
        } finally {
            setGenerating(false);
        }
    };

    const readyCount = employees.filter(e => e.nss && e.nss.length === 11).length;

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
                title="SUA — Actualización Salarial"
                description="Genera archivo SUA para reportar cambios salariales al IMSS"
                icon={FileDown}
            />

            <ImssSubNav />

            <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                    El formato SUA se usa para actualizar salarios base en el IMSS.
                    El SDI (Salario Diario Integrado) se calcula automáticamente.
                </AlertDescription>
            </Alert>

            <Card>
                <CardHeader>
                    <CardTitle className="text-sm">Fecha de Movimiento</CardTitle>
                </CardHeader>
                <CardContent>
                    <Input
                        type="date"
                        value={fechaMovimiento}
                        onChange={e => setFechaMovimiento(e.target.value)}
                        className="w-40"
                    />
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Empleados con NSS</CardTitle>
                    <CardDescription>
                        {readyCount} empleados listos para actualización salarial
                    </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Nombre</TableHead>
                                <TableHead>No. Empleado</TableHead>
                                <TableHead>NSS</TableHead>
                                <TableHead>Puesto</TableHead>
                                <TableHead>Salario Actual</TableHead>
                                <TableHead>Nuevo Salario</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {employees
                                .filter(e => e.nss && e.nss.length === 11)
                                .map(emp => (
                                    <TableRow key={emp.userId}>
                                        <TableCell className="font-medium">
                                            {emp.name}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">
                                            {emp.employeeNumber || "-"}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">
                                            {emp.nss}
                                        </TableCell>
                                        <TableCell>{emp.position || "-"}</TableCell>
                                        <TableCell className="text-muted-foreground">
                                            ${emp.baseSalary || IMSS_MIN_SALARY_DEFAULT}/día
                                        </TableCell>
                                        <TableCell>
                                            <Input
                                                type="number"
                                                placeholder="Nuevo salario diario"
                                                defaultValue={getDefaultSalary(emp.userId)}
                                                onBlur={e =>
                                                    handleSalaryChange(
                                                        emp.userId,
                                                        e.target.value
                                                    )
                                                }
                                                className="w-32"
                                            />
                                        </TableCell>
                                    </TableRow>
                                ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {selectedEmployees.size > 0 && (
                <Card>
                    <CardContent>
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="font-medium">
                                    {selectedEmployees.size} empleado(s) con salario nuevo
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    Generará archivo SUA para IMSS
                                </p>
                            </div>
                            <Button onClick={generateSUAFile} disabled={generating}>
                                {generating ? (
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                ) : (
                                    <FileDown className="h-4 w-4 mr-2" />
                                )}
                                Generar Archivo SUA
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