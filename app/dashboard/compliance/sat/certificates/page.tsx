"use client";

import { PageHeader } from "@/components/shared";
import { FileText } from "lucide-react";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, FileDown, Calculator, AlertTriangle, CheckCircle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

interface EmployeeCert {
    userId: string;
    name: string;
    rfc: string | null;
    hasRFC: boolean;
    employeeNumber: string | null;
}

export default function SATCertificatesPage() {
    const [employees, setEmployees] = useState<EmployeeCert[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear() - 1);
    const [selectedEmployees, setSelectedEmployees] = useState<Set<string>>(new Set());
    const [generating, setGenerating] = useState(false);

    useEffect(() => {
        const fetchCertificates = async () => {
            try {
                const res = await fetch(`/api/sat/certificates?year=${selectedYear}`);
                if (res.ok) {
                    const data = await res.json();
                    setEmployees(data.employees || []);
                }
            } catch (e) {
                toast.error("Error al cargar datos");
            } finally {
                setLoading(false);
            }
        };
        fetchCertificates();
    }, [selectedYear]);

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
        const withRFC = employees.filter(e => e.hasRFC);
        if (selectedEmployees.size === withRFC.length) {
            setSelectedEmployees(new Set());
        } else {
            setSelectedEmployees(new Set(withRFC.map(e => e.userId)));
        }
    };

    const generateCertificate = async (userId: string) => {
        try {
            const res = await fetch("/api/sat/certificates", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId, year: selectedYear }),
            });
            if (res.ok) {
                const blob = await res.blob();
                const emp = employees.find(e => e.userId === userId);
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `Constancia_${selectedYear}_${emp?.name || "empleado"}.pdf`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
                toast.success("Constancia generada");
            }
        } catch (e) {
            toast.error("Error al generar constancia");
        }
    };

    const generateAllCertificates = async () => {
        setGenerating(true);
        try {
            for (const userId of selectedEmployees) {
                await generateCertificate(userId);
            }
        } finally {
            setGenerating(false);
        }
    };

    const withRFC = employees.filter(e => e.hasRFC);
    const withoutRFC = employees.filter(e => !e.hasRFC);

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
                title="Constancias de Nómina"
                description="Genera Constancias de Retenciones e Ingresos (SAT)"
                icon={FileText}
            />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm font-medium">Generadas</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600">{withRFC.length}</div>
                        <p className="text-xs text-muted-foreground">Con RFC válido</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm font-medium">Pendientes</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-orange-600">{withoutRFC.length}</div>
                        <p className="text-xs text-muted-foreground">Sin RFC</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm font-medium">Año Fiscal</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Input
                            type="number"
                            value={selectedYear}
                            onChange={e => setSelectedYear(parseInt(e.target.value))}
                            className="w-24"
                        />
                    </CardContent>
                </Card>
            </div>

            {withRFC.length > 0 ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Empleados con RFC</CardTitle>
                        <CardDescription>
                            Genera constancias individuales o masivas
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-12">
                                        <Checkbox
                                            checked={selectedEmployees.size === withRFC.length && withRFC.length > 0}
                                            onCheckedChange={toggleAll}
                                        />
                                    </TableHead>
                                    <TableHead>Nombre</TableHead>
                                    <TableHead>RFC</TableHead>
                                    <TableHead>No. Empleado</TableHead>
                                    <TableHead>Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {withRFC.map(emp => (
                                    <TableRow key={emp.userId}>
                                        <TableCell>
                                            <Checkbox
                                                checked={selectedEmployees.has(emp.userId)}
                                                onCheckedChange={() => toggleEmployee(emp.userId)}
                                            />
                                        </TableCell>
                                        <TableCell className="font-medium">{emp.name}</TableCell>
                                        <TableCell className="font-mono text-xs">{emp.rfc}</TableCell>
                                        <TableCell className="font-mono text-xs">
                                            {emp.employeeNumber || "-"}
                                        </TableCell>
                                        <TableCell>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => generateCertificate(emp.userId)}
                                            >
                                                <FileDown className="h-4 w-4 mr-2" />
                                                PDF
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            ) : null}

            {withoutRFC.length > 0 && (
                <Card className="border-orange-200">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-orange-700">
                            <AlertTriangle className="h-5 w-5" />
                            Empleados Sin RFC
                        </CardTitle>
                        <CardDescription>
                            Estos empleados no pueden generar constancias hasta que proporcionen su RFC
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Nombre</TableHead>
                                    <TableHead>No. Empleado</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {withoutRFC.map(emp => (
                                    <TableRow key={emp.userId} className="opacity-50">
                                        <TableCell className="font-medium">{emp.name}</TableCell>
                                        <TableCell className="font-mono text-xs">
                                            {emp.employeeNumber || "-"}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
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
                            </div>
                            <Button onClick={generateAllCertificates} disabled={generating}>
                                {generating ? (
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                ) : (
                                    <FileDown className="h-4 w-4 mr-2" />
                                )}
                                Generar Todos
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}