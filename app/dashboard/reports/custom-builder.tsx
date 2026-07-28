"use client";

import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Download, Filter, Plus, X, Save, Play, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";
import { PageHeader, PageContainer } from "@/components/shared";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface Field {
    id: string;
    label: string;
    category: string;
}

interface FilterConfig {
    field: string;
    operator: string;
    value: string;
}

const AVAILABLE_FIELDS: Record<string, Field[]> = {
    employees: [
        { id: 'employeeNumber', label: 'Número de Empleado', category: 'Información Básica' },
        { id: 'name', label: 'Nombre Completo', category: 'Información Básica' },
        { id: 'department', label: 'Departamento', category: 'Profesional' },
        { id: 'position', label: 'Puesto', category: 'Profesional' },
        { id: 'employeeStatus', label: 'Estado', category: 'Profesional' },
        { id: 'hireDate', label: 'Fecha de Contratación', category: 'Profesional' },
        { id: 'terminationDate', label: 'Fecha de Baja', category: 'Profesional' },
        { id: 'terminationReason', label: 'Motivo de Baja', category: 'Profesional' },
        { id: 'branchId', label: 'Sucursal', category: 'Profesional' },
        { id: 'gender', label: 'Género', category: 'Datos Personales' },
        { id: 'dateOfBirth', label: 'Fecha de Nacimiento', category: 'Datos Personales' },
        { id: 'curp', label: 'CURP', category: 'Datos Personales' },
        { id: 'rfc', label: 'RFC', category: 'Datos Personales' },
        { id: 'personalEmail', label: 'Correo Personal', category: 'Contacto' },
        { id: 'personalPhone', label: 'Teléfono Personal', category: 'Contacto' },
        { id: 'city', label: 'Ciudad', category: 'Contacto' },
        { id: 'state', label: 'Estado', category: 'Contacto' },
    ],
    contracts: [
        { id: 'contractNumber', label: 'Número de Contrato', category: 'Contrato' },
        { id: 'contractType', label: 'Tipo de Contrato', category: 'Contrato' },
        { id: 'workRegime', label: 'Régimen de Trabajo', category: 'Contrato' },
        { id: 'baseSalary', label: 'Sueldo Diario', category: 'Compensación' },
        { id: 'monthlySalary', label: 'Sueldo Mensual', category: 'Compensación' },
        { id: 'weeklySalary', label: 'Sueldo Semanal', category: 'Compensación' },
        { id: 'startDate', label: 'Fecha de Inicio', category: 'Contrato' },
        { id: 'endDate', label: 'Fecha de Fin', category: 'Contrato' },
        { id: 'status', label: 'Estado del Contrato', category: 'Contrato' },
    ],
    documents: [
        { id: 'documentType', label: 'Tipo de Documento', category: 'Documento' },
        { id: 'documentName', label: 'Nombre del Documento', category: 'Documento' },
        { id: 'status', label: 'Estado', category: 'Documento' },
        { id: 'expirationDate', label: 'Fecha de Vencimiento', category: 'Vigencia' },
        { id: 'isRequired', label: 'Requerido', category: 'Vigencia' },
    ],
};

const OPERATORS = [
    { value: 'equals', label: 'Igual a' },
    { value: 'contains', label: 'Contiene' },
    { value: 'starts_with', label: 'Empieza con' },
    { value: 'greater_than', label: 'Mayor que' },
    { value: 'less_than', label: 'Menor que' },
    { value: 'between', label: 'Entre' },
    { value: 'is_null', label: 'Es nulo' },
    { value: 'is_not_null', label: 'No es nulo' },
];

export default function CustomReportBuilder() {
    const { toast } = useToast();
    const [dataSource, setDataSource] = React.useState<string>('employees');
    const [selectedFields, setSelectedFields] = React.useState<string[]>([]);
    const [filters, setFilters] = React.useState<FilterConfig[]>([]);
    const [reportName, setReportName] = React.useState('');
    const [reportDescription, setReportDescription] = React.useState('');
    const [dateFrom, setDateFrom] = React.useState('');
    const [dateTo, setDateTo] = React.useState('');
    const [previewData, setPreviewData] = React.useState<any[]>([]);
    const [totalCount, setTotalCount] = React.useState(0);
    const [isGenerating, setIsGenerating] = React.useState(false);
    const [currentStep, setCurrentStep] = React.useState(0);

    const handleToggleField = (fieldId: string) => {
        setSelectedFields(prev =>
            prev.includes(fieldId)
                ? prev.filter(f => f !== fieldId)
                : [...prev, fieldId]
        );
    };

    const handleAddFilter = () => {
        setFilters(prev => [...prev, { field: '', operator: 'equals', value: '' }]);
    };

    const handleRemoveFilter = (index: number) => {
        setFilters(prev => prev.filter((_, i) => i !== index));
    };

    const handleFilterChange = (index: number, field: keyof FilterConfig, value: string) => {
        setFilters(prev =>
            prev.map((filter, i) =>
                i === index ? { ...filter, [field]: value } : filter
            )
        );
    };

    const validateFilters = () => {
        for (let i = 0; i < filters.length; i++) {
            const filter = filters[i];
            if (!filter.field) {
                toast({
                    title: "Filtro incompleto",
                    description: `Por favor, selecciona un campo para el filtro #${i + 1}`,
                    variant: "destructive",
                });
                return false;
            }
            if (filter.operator !== 'is_null' && filter.operator !== 'is_not_null' && !filter.value.trim()) {
                toast({
                    title: "Filtro incompleto",
                    description: `Por favor, especifica un valor para el filtro #${i + 1}`,
                    variant: "destructive",
                });
                return false;
            }
        }
        return true;
    };

    const handlePreview = async () => {
        if (selectedFields.length === 0) {
            toast({
                title: "Error",
                description: "Por favor, selecciona al menos un campo",
                variant: "destructive",
            });
            return;
        }
        if (!validateFilters()) return;

        setIsGenerating(true);
        try {
            const response = await fetch('/api/reports/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    dataSource,
                    fields: selectedFields,
                    filters,
                    dateFrom,
                    dateTo,
                }),
            });

            if (response.ok) {
                const result = await response.json();
                setPreviewData(result.data.slice(0, 10));
                setTotalCount(result.data.length);
                toast({
                    title: "Vista previa generada",
                    description: `Mostrando ${result.data.length} registros`,
                });
            } else {
                throw new Error('Failed to generate preview');
            }
        } catch (error) {
            toast({
                title: "Error",
                description: "Error al generar la vista previa",
                variant: "destructive",
            });
        } finally {
            setIsGenerating(false);
        }
    };

    const handleExport = async (format: 'csv' | 'json') => {
        if (selectedFields.length === 0) {
            toast({
                title: "Error",
                description: "Por favor, selecciona al menos un campo",
                variant: "destructive",
            });
            return;
        }
        if (!validateFilters()) return;

        setIsGenerating(true);
        try {
            const url = format === 'csv'
                ? '/api/reports/execute?format=csv'
                : '/api/reports/execute';
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    dataSource,
                    fields: selectedFields,
                    filters,
                    dateFrom,
                    dateTo,
                    format,
                }),
            });

            if (response.ok) {
                if (format === 'csv') {
                    const blob = await response.blob();
                    const downloadUrl = window.URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = downloadUrl;
                    a.download = `report-${Date.now()}.csv`;
                    a.click();
                    window.URL.revokeObjectURL(downloadUrl);
                } else {
                    const result = await response.json();
                    const jsonStr = JSON.stringify(result.data, null, 2);
                    const blob = new Blob([jsonStr], { type: "application/json" });
                    const downloadUrl = window.URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = downloadUrl;
                    a.download = `report-${Date.now()}.json`;
                    a.click();
                    window.URL.revokeObjectURL(downloadUrl);
                }
                toast({
                    title: "Exportación completada",
                    description: `Reporte exportado como ${format.toUpperCase()}`,
                });
            } else {
                throw new Error('Failed to export');
            }
        } catch (error) {
            toast({
                title: "Error",
                description: "Error al exportar el reporte",
                variant: "destructive",
            });
        } finally {
            setIsGenerating(false);
        }
    };

    const handleSaveTemplate = async () => {
        if (!reportName) {
            toast({
                title: "Error",
                description: "Por favor, proporciona un nombre de reporte",
                variant: "destructive",
            });
            return;
        }

        try {
            const response = await fetch('/api/reports/templates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: reportName,
                    description: reportDescription,
                    dataSource,
                    fields: selectedFields,
                    filters,
                    dateFrom,
                    dateTo,
                }),
            });

            if (response.ok) {
                toast({
                    title: "Plantilla guardada",
                    description: "Plantilla de reporte guardada exitosamente",
                });
            } else {
                throw new Error('Failed to save template');
            }
        } catch (error) {
            toast({
                title: "Error",
                description: "Error al guardar la plantilla",
                variant: "destructive",
            });
        }
    };

    const availableFields = AVAILABLE_FIELDS[dataSource] || [];
    const groupedFields = availableFields.reduce<Record<string, Field[]>>((acc, field) => {
        if (!acc[field.category]) acc[field.category] = [];
        acc[field.category].push(field);
        return acc;
    }, {});

    const STEPS = [
        { id: 0, label: "Fuente" },
        { id: 1, label: "Campos" },
        { id: 2, label: "Filtros" },
        { id: 3, label: "Generar" }
    ];

    return (
        <PageContainer>
            <PageHeader
                title="Constructor de Reportes Personalizados"
                description="Construye reportes personalizados seleccionando campos y aplicando filtros"
                icon={Filter}
                actions={
                    <Button asChild variant="outline">
                        <Link href="/dashboard/reports">
                            <ArrowLeft className="h-4 w-4 mr-2" />
                            Regresar
                        </Link>
                    </Button>
                }
            />

            {/* Progress Indicator */}
            <div className="flex items-center justify-between mb-8 max-w-xl mx-auto">
                {STEPS.map((step, idx) => (
                    <React.Fragment key={step.id}>
                        <div className="flex flex-col items-center">
                            <button
                                type="button"
                                onClick={() => {
                                    if (step.id < currentStep || (step.id > currentStep && selectedFields.length > 0)) {
                                        setCurrentStep(step.id);
                                    }
                                }}
                                disabled={step.id > currentStep && selectedFields.length === 0}
                                className={cn(
                                    "h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold border transition-colors",
                                    currentStep === step.id
                                        ? "bg-primary border-primary text-primary-foreground"
                                        : currentStep > step.id
                                        ? "bg-primary/10 border-primary/30 text-primary"
                                        : "bg-muted border-muted text-muted-foreground"
                                )}
                            >
                                {step.id + 1}
                            </button>
                            <span
                                className={cn(
                                    "text-xs mt-2 font-medium",
                                    currentStep === step.id
                                        ? "text-foreground"
                                        : "text-muted-foreground"
                                )}
                            >
                                {step.label}
                            </span>
                        </div>
                        {idx < STEPS.length - 1 && (
                            <div
                                className={cn(
                                    "h-[2px] flex-1 mx-2 -mt-6 transition-colors",
                                    currentStep > step.id ? "bg-primary" : "bg-muted"
                                )}
                            />
                        )}
                    </React.Fragment>
                ))}
            </div>

            {/* Step Contents */}
            <div className="max-w-4xl mx-auto space-y-6">
                {currentStep === 0 && (
                    <div className="grid gap-6 md:grid-cols-2">
                        {/* Report Details */}
                        <Card>
                            <CardHeader>
                                <CardTitle>Detalles del Reporte</CardTitle>
                                <CardDescription>Nombra y describe tu reporte</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label>Nombre del Reporte *</Label>
                                    <Input
                                        placeholder="Ej: Empleados Activos por Departamento"
                                        value={reportName}
                                        onChange={(e) => setReportName(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Descripción</Label>
                                    <Input
                                        placeholder="Breve descripción del reporte"
                                        value={reportDescription}
                                        onChange={(e) => setReportDescription(e.target.value)}
                                    />
                                </div>
                            </CardContent>
                        </Card>

                        {/* Data Source */}
                        <Card>
                            <CardHeader>
                                <CardTitle>Fuente de Datos</CardTitle>
                                <CardDescription>Selecciona la fuente de datos para tu reporte</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <Select
                                    value={dataSource}
                                    onValueChange={(val) => {
                                        setDataSource(val);
                                        setSelectedFields([]);
                                        setFilters([]);
                                    }}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="employees">Empleados</SelectItem>
                                        <SelectItem value="contracts">Contratos</SelectItem>
                                        <SelectItem value="documents">Documentos</SelectItem>
                                    </SelectContent>
                                </Select>
                            </CardContent>
                        </Card>
                    </div>
                )}

                {currentStep === 1 && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center justify-between">
                                <span>Campos del Reporte</span>
                                <Badge variant="secondary">{selectedFields.length} seleccionados</Badge>
                            </CardTitle>
                            <CardDescription>Selecciona los campos a incluir en el reporte</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4 max-h-96 overflow-y-auto pr-2">
                                {Object.entries(groupedFields).map(([category, fields]) => (
                                    <div key={category}>
                                        <h4 className="text-sm font-semibold mb-2 text-muted-foreground">{category}</h4>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                                            {fields.map(field => (
                                                <div key={field.id} className="flex items-center space-x-2 p-2 border rounded-md hover:bg-muted/50 transition-colors">
                                                    <Checkbox
                                                        id={field.id}
                                                        checked={selectedFields.includes(field.id)}
                                                        onCheckedChange={() => handleToggleField(field.id)}
                                                    />
                                                    <label
                                                        htmlFor={field.id}
                                                        className="text-sm cursor-pointer select-none flex-1 truncate"
                                                        title={field.label}
                                                    >
                                                        {field.label}
                                                    </label>
                                                </div>
                                            ))}
                                        </div>
                                        <Separator className="my-4" />
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                )}

                {currentStep === 2 && (
                    <div className="grid gap-6 md:grid-cols-3">
                        {/* Filters Panel */}
                        <Card className="md:col-span-2">
                            <CardHeader>
                                <CardTitle className="flex items-center justify-between">
                                    <span>Filtros</span>
                                    <Button variant="outline" size="sm" onClick={handleAddFilter}>
                                        <Plus className="h-4 w-4 mr-1" />
                                        Agregar Filtro
                                    </Button>
                                </CardTitle>
                                <CardDescription>Aplica filtros para acotar los resultados</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {filters.length === 0 ? (
                                    <div className="text-center py-6 text-sm text-muted-foreground">
                                        No hay filtros aplicados. Haz clic en "Agregar Filtro" para comenzar.
                                    </div>
                                ) : (
                                    filters.map((filter, index) => (
                                        <div key={index} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center p-3 border rounded-lg relative pr-10 sm:pr-12">
                                            <div className="sm:col-span-4">
                                                <Select
                                                    value={filter.field}
                                                    onValueChange={(value) => handleFilterChange(index, 'field', value)}
                                                >
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Seleccionar campo" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {availableFields.map(field => (
                                                            <SelectItem key={field.id} value={field.id}>{field.label}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="sm:col-span-4">
                                                <Select
                                                    value={filter.operator}
                                                    onValueChange={(value) => handleFilterChange(index, 'operator', value)}
                                                >
                                                    <SelectTrigger>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {OPERATORS.map(op => (
                                                            <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="sm:col-span-4">
                                                <Input
                                                    placeholder="Valor"
                                                    value={filter.value}
                                                    onChange={(e) => handleFilterChange(index, 'value', e.target.value)}
                                                    disabled={filter.operator === 'is_null' || filter.operator === 'is_not_null'}
                                                />
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="absolute top-1/2 -translate-y-1/2 right-2 h-8 w-8 p-0"
                                                onClick={() => handleRemoveFilter(index)}
                                            >
                                                <X className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    ))
                                )}
                            </CardContent>
                        </Card>

                        {/* Date Range */}
                        <Card>
                            <CardHeader>
                                <CardTitle>Rango de Fechas</CardTitle>
                                <CardDescription>Filtrar registros por rango de fechas</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label>Desde</Label>
                                    <Input
                                        type="date"
                                        value={dateFrom}
                                        onChange={(e) => setDateFrom(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Hasta</Label>
                                    <Input
                                        type="date"
                                        value={dateTo}
                                        onChange={(e) => setDateTo(e.target.value)}
                                    />
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                )}

                {currentStep === 3 && (
                    <div className="space-y-6">
                        {/* Actions Panel */}
                        <Card>
                            <CardHeader>
                                <CardTitle>Acciones</CardTitle>
                                <CardDescription>Genera la vista previa o exporta los datos finales</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                                    <Button
                                        className="w-full"
                                        onClick={handlePreview}
                                        disabled={isGenerating || selectedFields.length === 0}
                                    >
                                        <Play className="h-4 w-4 mr-2" />
                                        Generar Vista Previa
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={() => handleExport('csv')}
                                        disabled={isGenerating || selectedFields.length === 0}
                                    >
                                        <Download className="h-4 w-4 mr-2" />
                                        Exportar CSV
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={() => handleExport('json')}
                                        disabled={isGenerating || selectedFields.length === 0}
                                    >
                                        <Download className="h-4 w-4 mr-2" />
                                        Exportar JSON
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        className="w-full"
                                        onClick={handleSaveTemplate}
                                        disabled={!reportName}
                                    >
                                        <Save className="h-4 w-4 mr-2" />
                                        Guardar como Plantilla
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Preview Panel */}
                        {previewData.length > 0 ? (
                            <Card>
                                <CardHeader>
                                    <CardTitle>Vista Previa</CardTitle>
                                    <CardDescription>
                                        Mostrando {previewData.length} de {totalCount} registros
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="border rounded-lg overflow-auto max-h-96">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    {selectedFields.map(fieldId => {
                                                        const field = availableFields.find(f => f.id === fieldId);
                                                        return <TableHead key={fieldId}>{field?.label || fieldId}</TableHead>;
                                                    })}
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {previewData.map((row, index) => (
                                                    <TableRow key={index}>
                                                        {selectedFields.map(fieldId => (
                                                            <TableCell key={fieldId}>
                                                                {row[fieldId] !== null && row[fieldId] !== undefined
                                                                    ? String(row[fieldId])
                                                                    : '-'}
                                                            </TableCell>
                                                        ))}
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </CardContent>
                            </Card>
                        ) : (
                            <Card>
                                <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                                    <Play className="h-10 w-10 mb-2 opacity-55" />
                                    <p className="text-sm font-medium">No se ha generado la vista previa</p>
                                    <p className="text-xs">Haz clic en "Generar Vista Previa" para ver una muestra de los datos.</p>
                                </CardContent>
                            </Card>
                        )}
                    </div>
                )}

                {/* Navigation Footer */}
                <div className="flex justify-between items-center pt-4">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => setCurrentStep(prev => Math.max(0, prev - 1))}
                        disabled={currentStep === 0}
                    >
                        Anterior
                    </Button>
                    
                    {currentStep < 3 && (
                        <Button
                            type="button"
                            onClick={() => {
                                if (currentStep === 2) {
                                    if (!validateFilters()) return;
                                }
                                setCurrentStep(prev => Math.min(3, prev + 1));
                            }}
                            disabled={
                                (currentStep === 0 && !reportName) ||
                                (currentStep === 1 && selectedFields.length === 0)
                            }
                        >
                            Siguiente
                        </Button>
                    )}
                </div>
            </div>
        </PageContainer>
    );
}
