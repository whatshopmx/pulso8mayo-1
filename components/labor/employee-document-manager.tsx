"use client";

import * as React from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { 
    FileText, 
    Upload, 
    CheckCircle, 
    XCircle, 
    AlertCircle, 
    Clock, 
    ChevronRight, 
    User, 
    AlertTriangle, 
    Search,
    Filter
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { DocumentsTab } from "@/components/employees/tabs/documents-tab";

interface EmployeeComplianceStatus {
    userId: string;
    userName: string;
    userEmail: string;
    userRole: string;
    branchId: string | null;
    branchName: string | null;
    totalDocuments: number;
    validDocuments: number;
    pendingDocuments: number;
    expiredDocuments: number;
    missingRequired: string[];
    compliancePercentage: number;
    documents: any[];
}

interface Branch {
    id: string;
    name: string;
}

export function EmployeeDocumentManager() {
    const [activeTab, setActiveTab] = React.useState("roster");
    const [employees, setEmployees] = React.useState<EmployeeComplianceStatus[]>([]);
    const [branches, setBranches] = React.useState<Branch[]>([]);
    const [selectedBranch, setSelectedBranch] = React.useState<string>("all");
    const [searchTerm, setSearchTerm] = React.useState("");
    const [selectedEmployee, setSelectedEmployee] = React.useState<EmployeeComplianceStatus | null>(null);
    const [loading, setLoading] = React.useState(false);

    const fetchComplianceData = async (branchId?: string) => {
        setLoading(true);
        try {
            const url = new URL('/api/documents/compliance', window.location.origin);
            if (branchId && branchId !== "all") {
                url.searchParams.set('branchId', branchId);
            }
            const response = await fetch(url.toString());
            if (response.ok) {
                const result = await response.json();
                setEmployees(result.employees || []);
                setBranches(result.branches || []);
            }
        } catch (error) {
            console.error("Error fetching compliance data:", error);
            toast.error("Error al cargar datos de cumplimiento");
        } finally {
            setLoading(false);
        }
    };

    React.useEffect(() => {
        fetchComplianceData();
    }, []);

    const filteredEmployees = employees.filter(emp => 
        emp.userName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        emp.userEmail.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleSelectEmployee = (emp: EmployeeComplianceStatus) => {
        setSelectedEmployee(emp);
        setActiveTab("detail");
    };

    const handleRefresh = async () => {
        await fetchComplianceData(selectedBranch === "all" ? undefined : selectedBranch);
        if (selectedEmployee) {
            const empResponse = await fetch(`/api/documents/compliance?userId=${selectedEmployee.userId}`);
            if (empResponse.ok) {
                const empData = await empResponse.json();
                setSelectedEmployee(empData.employee);
            }
        }
    };

    return (
        <div className="space-y-6">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <div className="flex items-center justify-between mb-4">
                    <TabsList>
                        <TabsTrigger value="roster">
                            Lista de Empleados
                        </TabsTrigger>
                        <TabsTrigger value="detail" disabled={!selectedEmployee}>
                            Expediente Individual
                        </TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="roster" className="space-y-4">
                    <div className="flex flex-col md:flex-row gap-4">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Buscar empleado por nombre o email..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-9"
                            />
                        </div>
                        <div className="flex gap-2 w-full md:w-auto">
                            <Select value={selectedBranch} onValueChange={(v) => {
                                setSelectedBranch(v);
                                fetchComplianceData(v);
                            }}>
                                <SelectTrigger className="w-[200px]">
                                    <Filter className="h-4 w-4 mr-2" />
                                    <SelectValue placeholder="Todas las sucursales" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todas las sucursales</SelectItem>
                                    {branches.map(branch => (
                                        <SelectItem key={branch.id} value={branch.id}>
                                            {branch.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <Card>
                        <CardHeader>
                            <CardTitle>Expedientes Laborales</CardTitle>
                            <CardDescription>
                                Estado de cumplimiento documental por empleado
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {loading && employees.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                                    <Clock className="h-10 w-10 animate-spin mb-4 opacity-20" />
                                    <p>Cargando información de cumplimiento...</p>
                                </div>
                            ) : filteredEmployees.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                                    <User className="h-12 w-12 mb-4 opacity-20" />
                                    <p>No se encontraron empleados con los criterios de búsqueda</p>
                                </div>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Empleado</TableHead>
                                            <TableHead>Sucursal</TableHead>
                                            <TableHead>Documentos</TableHead>
                                            <TableHead>Cumplimiento</TableHead>
                                            <TableHead className="text-right">Acciones</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {filteredEmployees.map((emp) => (
                                            <TableRow key={emp.userId}>
                                                <TableCell>
                                                    <div>
                                                        <div className="font-medium text-sm">{emp.userName}</div>
                                                        <div className="text-xs text-muted-foreground">{emp.userEmail}</div>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="outline" className="font-normal">
                                                        {emp.branchName || "Sin sucursal"}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-4 text-xs">
                                                        <div className="flex items-center gap-1" title="Validados">
                                                            <CheckCircle className="h-3 w-3 text-green-600" />
                                                            <span>{emp.validDocuments}</span>
                                                        </div>
                                                        <div className="flex items-center gap-1" title="Pendientes">
                                                            <Clock className="h-3 w-3 text-yellow-600" />
                                                            <span>{emp.pendingDocuments}</span>
                                                        </div>
                                                        {emp.missingRequired.length > 0 && (
                                                            <div className="flex items-center gap-1 text-destructive" title="Faltan obligatorios">
                                                                <AlertTriangle className="h-3 w-3" />
                                                                <span>{emp.missingRequired.length} faltan</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="min-w-[150px]">
                                                    <div className="space-y-1">
                                                         <div className="flex justify-between text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                                            <span>Progreso</span>
                                                            <span>{emp.compliancePercentage}%</span>
                                                        </div>
                                                        <Progress value={emp.compliancePercentage} className="h-1.5" />
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <Button 
                                                        variant="ghost" 
                                                        size="sm"
                                                        onClick={() => handleSelectEmployee(emp)}
                                                    >
                                                        Gestionar
                                                        <ChevronRight className="h-4 w-4 ml-1" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="detail">
                    {selectedEmployee ? (
                        <div className="space-y-6">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <Button variant="outline" size="sm" onClick={() => setActiveTab("roster")}>
                                        Volver
                                    </Button>
                                    <div>
                                        <h2 className="text-xl font-bold">{selectedEmployee.userName}</h2>
                                        <p className="text-sm text-muted-foreground">{selectedEmployee.userEmail}</p>
                                    </div>
                                </div>
                                <Badge variant="secondary">{selectedEmployee.branchName || "Sin sucursal"}</Badge>
                            </div>

                            <DocumentsTab 
                                documents={selectedEmployee.documents} 
                                employeeId={selectedEmployee.userId}
                                onSuccess={handleRefresh}
                                canEdit={true}
                                canValidate={true}
                            />
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-20 bg-muted/30 rounded-lg border-2 border-dashed">
                            <User className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
                            <h3 className="text-lg font-medium">Selecciona un empleado</h3>
                            <p className="text-muted-foreground text-sm">Elige un empleado de la lista para gestionar sus documentos</p>
                        </div>
                    )}
                </TabsContent>
            </Tabs>
        </div>
    );
}
