"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
    FileText,
    Upload,
    Loader2,
    AlertTriangle,
    CheckCircle,
    Clock,
    Shield,
    File,
    X,
} from "lucide-react";
import { toast } from "sonner";

interface DocStatus {
    id: string;
    userId: string;
    documentType: string;
    documentName: string;
    status: string;
    expirationDate: string | null;
    isValid: boolean;
}

interface EmployeeExpediente {
    userId: string;
    name: string;
    email: string;
    employeeNumber: string | null;
    department: string | null;
    position: string | null;
    hireDate: string | null;
    rfc: string | null;
    nss: string | null;
    branchName: string | null;
    totalDocuments: number;
    missingDocuments: string[];
    expiredDocuments: string[];
    compliancePercentage: number;
    documents: DocStatus[];
}

const REQUIRED_DOCS = [
    { type: "CONTRACT", name: "Contrato de Trabajo" },
    { type: "ID", name: "Identificación (INE)" },
    { type: "TAX_ID", name: "RFC" },
    { type: "BANK_INFO", name: "Datos Bancarios" },
    { type: "PROOF_OF_ADDRESS", name: "Comprobante de Domicilio" },
    { type: "CERTIFICATE", name: "Certificado Médico" },
];

export default function ExpedientePage() {
    const [employees, setEmployees] = useState<EmployeeExpediente[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedBranch, setSelectedBranch] = useState<string>("all");
    const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null);

    useEffect(() => {
        const fetchExpediente = async () => {
            setLoading(true);
            try {
                const params = new URLSearchParams();
                if (selectedBranch !== "all") {
                    params.set("branchId", selectedBranch);
                }
                const res = await fetch(`/api/expediente?${params.toString()}`);
                if (res.ok) {
                    const data = await res.json();
                    setEmployees(data.employees || []);
                }
            } catch (e) {
                toast.error("Error al cargar expediente");
            } finally {
                setLoading(false);
            }
        };
        fetchExpediente();
    }, [selectedBranch]);

    const getStatusBadge = (doc: DocStatus) => {
        if (doc.status === "VALIDATED" && doc.isValid) {
            return <Badge variant="default" className="bg-green-600">Válido</Badge>;
        }
        if (doc.status === "EXPIRED" || new Date(doc.expirationDate || 0) < new Date()) {
            return <Badge variant="destructive">Expirado</Badge>;
        }
        if (doc.status === "PENDING") {
            return <Badge variant="secondary">Pendiente</Badge>;
        }
        return <Badge variant="outline">{doc.status}</Badge>;
    };

    const avgCompliance =
        employees.length > 0
            ? Math.round(
                  employees.reduce((sum, e) => sum + e.compliancePercentage, 0) /
                      employees.length
              )
            : 0;

    const totalMissing = employees.reduce(
        (sum, e) => sum + e.missingDocuments.length,
        0
    );
    const totalExpired = employees.reduce(
        (sum, e) => sum + e.expiredDocuments.length,
        0
    );

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold">Expediente Laboral</h1>
                <p className="text-muted-foreground">
                    Gestión de documentos requeridos por ley mexicana
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm font-medium">
                            Empleados
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{employees.length}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm font-medium">
                            Cumplimiento
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{avgCompliance}%</div>
                        <Progress value={avgCompliance} className="h-1 mt-2" />
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm font-medium text-orange-600">
                            Doc. Faltantes
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-orange-600">
                            {totalMissing}
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm font-medium text-red-600">
                            Doc. Expirados
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-600">{totalExpired}</div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Documentos Requeridos</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                        {REQUIRED_DOCS.map(doc => (
                            <div
                                key={doc.type}
                                className="p-3 border rounded-lg text-center"
                            >
                                <File className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
                                <p className="text-sm font-medium">{doc.name}</p>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Empleados</CardTitle>
                    <CardDescription>
                        Expande cada empleado para ver documentos
                    </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-8"></TableHead>
                                <TableHead>Nombre</TableHead>
                                <TableHead>No. Empleado</TableHead>
                                <TableHead>Departamento</TableHead>
                                <TableHead>Cumplimiento</TableHead>
                                <TableHead>Documentos</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {employees.map(emp => (
                                <>
                                    <TableRow
                                        key={emp.userId}
                                        className="cursor-pointer"
                                        onClick={() =>
                                            setExpandedEmployee(
                                                expandedEmployee === emp.userId
                                                    ? null
                                                    : emp.userId
                                            )
                                        }
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                setExpandedEmployee(
                                                    expandedEmployee === emp.userId
                                                        ? null
                                                        : emp.userId
                                                );
                                            }
                                        }}
                                        tabIndex={0}
                                        role="button"
                                    >
                                        <TableCell>
                                            {expandedEmployee === emp.userId ? (
                                                <X className="h-4 w-4" />
                                            ) : (
                                                <FileText className="h-4 w-4" />
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <div className="font-medium">{emp.name}</div>
                                            <div className="text-xs text-muted-foreground">
                                                {emp.email}
                                            </div>
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">
                                            {emp.employeeNumber || "-"}
                                        </TableCell>
                                        <TableCell>
                                            <div className="text-sm">
                                                {emp.department}
                                            </div>
                                            <div className="text-xs text-muted-foreground">
                                                {emp.position}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge
                                                variant={
                                                    emp.compliancePercentage >= 80
                                                        ? "default"
                                                        : emp.compliancePercentage >= 50
                                                        ? "secondary"
                                                        : "destructive"
                                                }
                                            >
                                                {emp.compliancePercentage}%
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex gap-1">
                                                {emp.expiredDocuments.length > 0 && (
                                                    <Badge
                                                        variant="destructive"
                                                        className="text-xs"
                                                    >
                                                        {emp.expiredDocuments.length} exp
                                                    </Badge>
                                                )}
                                                {emp.missingDocuments.length > 0 && (
                                                    <Badge
                                                        variant="secondary"
                                                        className="text-xs"
                                                    >
                                                        {emp.missingDocuments.length} falt
                                                    </Badge>
                                                )}
                                                {emp.documents.filter(
                                                    d =>
                                                        d.status === "VALIDATED" &&
                                                        d.isValid
                                                ).length >
                                                    0 && (
                                                    <Badge
                                                        variant="default"
                                                        className="text-xs bg-green-600"
                                                    >
                                                        {emp.documents.filter(
                                                            d =>
                                                                d.status ===
                                                                    "VALIDATED" &&
                                                                d.isValid
                                                        ).length}{" "}
                                                        val
                                                    </Badge>
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                    {expandedEmployee === emp.userId && (
                                        <TableRow>
                                            <TableCell colSpan={6}>
                                                <div className="p-4 bg-muted/30">
                                                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                                                        {REQUIRED_DOCS.map(
                                                            req => {
                                                                const doc =
                                                                    emp.documents.find(
                                                                        d =>
                                                                            d.documentType ===
                                                                            req.type
                                                                    );
                                                                return (
                                                                    <div
                                                                        key={
                                                                            req.type
                                                                        }
                                                                        className={`p-3 border rounded-lg ${
                                                                            doc &&
                                                                            doc.status ===
                                                                                "VALIDATED" &&
                                                                            doc.isValid
                                                                                ? "border-green-200 bg-green-50"
                                                                                : "border-orange-200 bg-orange-50"
                                                                        }`}
                                                                    >
                                                                        <div className="flex justify-center mb-2">
                                                                            {doc &&
                                                                            doc.status ===
                                                                                "VALIDATED" &&
                                                                            doc.isValid ? (
                                                                                <CheckCircle className="h-5 w-5 text-green-600" />
                                                                            ) : (
                                                                                <AlertTriangle className="h-5 w-5 text-orange-500" />
                                                                            )}
                                                                        </div>
                                                                        <p className="text-xs font-medium text-center">
                                                                            {
                                                                                req.name
                                                                            }
                                                                        </p>
                                                                        {doc ? (
                                                                            <p className="text-xs text-center text-muted-foreground mt-1">
                                                                                {doc.expirationDate
                                                                                    ? `Exp: ${new Date(
                                                                                          doc.expirationDate
                                                                                      ).toLocaleDateString("es-MX")}`
                                                                                    : "Sin exp"}
                                                                            </p>
                                                                        ) : (
                                                                            <p className="text-xs text-center text-muted-foreground mt-1">
                                                                                No
                                                                                cargado
                                                                            </p>
                                                                        )}
                                                                    </div>
                                                                );
                                                            }
                                                        )}
                                                    </div>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}