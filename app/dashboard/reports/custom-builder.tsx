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
import { Download, Filter, Plus, X, Save, Play } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";

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
        { id: 'employeeNumber', label: 'Employee Number', category: 'Basic Info' },
        { id: 'name', label: 'Full Name', category: 'Basic Info' },
        { id: 'department', label: 'Department', category: 'Professional' },
        { id: 'position', label: 'Position', category: 'Professional' },
        { id: 'employeeStatus', label: 'Status', category: 'Professional' },
        { id: 'hireDate', label: 'Hire Date', category: 'Professional' },
        { id: 'terminationDate', label: 'Termination Date', category: 'Professional' },
        { id: 'terminationReason', label: 'Termination Reason', category: 'Professional' },
        { id: 'branchId', label: 'Branch', category: 'Professional' },
        { id: 'gender', label: 'Gender', category: 'Personal' },
        { id: 'dateOfBirth', label: 'Date of Birth', category: 'Personal' },
        { id: 'curp', label: 'CURP', category: 'Personal' },
        { id: 'rfc', label: 'RFC', category: 'Personal' },
        { id: 'personalEmail', label: 'Personal Email', category: 'Contact' },
        { id: 'personalPhone', label: 'Personal Phone', category: 'Contact' },
        { id: 'city', label: 'City', category: 'Contact' },
        { id: 'state', label: 'State', category: 'Contact' },
    ],
    contracts: [
        { id: 'contractNumber', label: 'Contract Number', category: 'Contract' },
        { id: 'contractType', label: 'Contract Type', category: 'Contract' },
        { id: 'workRegime', label: 'Work Regime', category: 'Contract' },
        { id: 'baseSalary', label: 'Daily Salary', category: 'Compensation' },
        { id: 'monthlySalary', label: 'Monthly Salary', category: 'Compensation' },
        { id: 'weeklySalary', label: 'Weekly Salary', category: 'Compensation' },
        { id: 'startDate', label: 'Start Date', category: 'Contract' },
        { id: 'endDate', label: 'End Date', category: 'Contract' },
        { id: 'status', label: 'Contract Status', category: 'Contract' },
    ],
    documents: [
        { id: 'documentType', label: 'Document Type', category: 'Document' },
        { id: 'documentName', label: 'Document Name', category: 'Document' },
        { id: 'status', label: 'Status', category: 'Document' },
        { id: 'expirationDate', label: 'Expiration Date', category: 'Validity' },
        { id: 'isRequired', label: 'Required', category: 'Validity' },
    ],
};

const OPERATORS = [
    { value: 'equals', label: 'Equals' },
    { value: 'contains', label: 'Contains' },
    { value: 'starts_with', label: 'Starts with' },
    { value: 'greater_than', label: 'Greater than' },
    { value: 'less_than', label: 'Less than' },
    { value: 'between', label: 'Between' },
    { value: 'is_null', label: 'Is null' },
    { value: 'is_not_null', label: 'Is not null' },
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
    const [isGenerating, setIsGenerating] = React.useState(false);

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

    const handlePreview = async () => {
        if (selectedFields.length === 0) {
            toast({
                title: "Error",
                description: "Please select at least one field",
                variant: "destructive",
            });
            return;
        }

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
                toast({
                    title: "Preview Generated",
                    description: `Showing ${result.data.length} records`,
                });
            } else {
                throw new Error('Failed to generate preview');
            }
        } catch (error) {
            toast({
                title: "Error",
                description: "Failed to generate preview",
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
                description: "Please select at least one field",
                variant: "destructive",
            });
            return;
        }

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
                    title: "Export Complete",
                    description: `Report exported as ${format.toUpperCase()}`,
                });
            } else {
                throw new Error('Failed to export');
            }
        } catch (error) {
            toast({
                title: "Error",
                description: "Failed to export report",
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
                description: "Please provide a report name",
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
                    title: "Template Saved",
                    description: "Report template saved successfully",
                });
            } else {
                throw new Error('Failed to save template');
            }
        } catch (error) {
            toast({
                title: "Error",
                description: "Failed to save template",
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

    return (
        <div className="container mx-auto py-6 space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold">Custom Report Builder</h1>
                <p className="text-muted-foreground mt-1">
                    Build custom reports by selecting fields and applying filters
                </p>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
                {/* Configuration Panel */}
                <div className="space-y-6">
                    {/* Report Details */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Report Details</CardTitle>
                            <CardDescription>Name and describe your report</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label>Report Name *</Label>
                                <Input
                                    placeholder="e.g., Active Employees by Department"
                                    value={reportName}
                                    onChange={(e) => setReportName(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Description</Label>
                                <Input
                                    placeholder="Brief description of the report"
                                    value={reportDescription}
                                    onChange={(e) => setReportDescription(e.target.value)}
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* Data Source */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Data Source</CardTitle>
                            <CardDescription>Select the data source for your report</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Select value={dataSource} onValueChange={setDataSource}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="employees">Employees</SelectItem>
                                    <SelectItem value="contracts">Contracts</SelectItem>
                                    <SelectItem value="documents">Documents</SelectItem>
                                </SelectContent>
                            </Select>
                        </CardContent>
                    </Card>

                    {/* Fields Selection */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center justify-between">
                                <span>Fields</span>
                                <Badge variant="secondary">{selectedFields.length} selected</Badge>
                            </CardTitle>
                            <CardDescription>Select fields to include in the report</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4 max-h-96 overflow-y-auto">
                                {Object.entries(groupedFields).map(([category, fields]) => (
                                    <div key={category}>
                                        <h4 className="text-sm font-semibold mb-2 text-muted-foreground">{category}</h4>
                                        <div className="space-y-2">
                                            {fields.map(field => (
                                                <div key={field.id} className="flex items-center space-x-2">
                                                    <Checkbox
                                                        id={field.id}
                                                        checked={selectedFields.includes(field.id)}
                                                        onCheckedChange={() => handleToggleField(field.id)}
                                                    />
                                                    <label
                                                        htmlFor={field.id}
                                                        className="text-sm cursor-pointer"
                                                    >
                                                        {field.label}
                                                    </label>
                                                </div>
                                            ))}
                                        </div>
                                        <Separator className="my-3" />
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Filters */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center justify-between">
                                <span>Filters</span>
                                <Button variant="outline" size="sm" onClick={handleAddFilter}>
                                    <Plus className="h-4 w-4 mr-1" />
                                    Add Filter
                                </Button>
                            </CardTitle>
                            <CardDescription>Apply filters to narrow down results</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {filters.map((filter, index) => (
                                <div key={index} className="space-y-2 p-3 border rounded-lg relative">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="absolute top-2 right-2 h-6 w-6 p-0"
                                        onClick={() => handleRemoveFilter(index)}
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                    <Select
                                        value={filter.field}
                                        onValueChange={(value) => handleFilterChange(index, 'field', value)}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select field" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {availableFields.map(field => (
                                                <SelectItem key={field.id} value={field.id}>{field.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
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
                                    <Input
                                        placeholder="Value"
                                        value={filter.value}
                                        onChange={(e) => handleFilterChange(index, 'value', e.target.value)}
                                        disabled={filter.operator === 'is_null' || filter.operator === 'is_not_null'}
                                    />
                                </div>
                            ))}
                        </CardContent>
                    </Card>

                    {/* Date Range */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Date Range</CardTitle>
                            <CardDescription>Filter records by date range</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>From</Label>
                                    <Input
                                        type="date"
                                        value={dateFrom}
                                        onChange={(e) => setDateFrom(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>To</Label>
                                    <Input
                                        type="date"
                                        value={dateTo}
                                        onChange={(e) => setDateTo(e.target.value)}
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Preview & Actions Panel */}
                <div className="space-y-6">
                    {/* Actions */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Actions</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-2">
                                <Button
                                    className="w-full"
                                    onClick={handlePreview}
                                    disabled={isGenerating || selectedFields.length === 0}
                                >
                                    <Play className="h-4 w-4 mr-2" />
                                    Generate Preview
                                </Button>
                                <div className="grid grid-cols-2 gap-2">
                                    <Button
                                        variant="outline"
                                        onClick={() => handleExport('csv')}
                                        disabled={isGenerating || selectedFields.length === 0}
                                    >
                                        <Download className="h-4 w-4 mr-2" />
                                        Export CSV
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={() => handleExport('json')}
                                        disabled={isGenerating || selectedFields.length === 0}
                                    >
                                        <Download className="h-4 w-4 mr-2" />
                                        Export JSON
                                    </Button>
                                </div>
                                <Button
                                    variant="secondary"
                                    className="w-full"
                                    onClick={handleSaveTemplate}
                                    disabled={!reportName}
                                >
                                    <Save className="h-4 w-4 mr-2" />
                                    Save as Template
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Preview */}
                    {previewData.length > 0 && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Preview</CardTitle>
                                <CardDescription>
                                    Showing {previewData.length} of {previewData.length} records
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="border rounded-lg overflow-auto max-h-96">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                {selectedFields.map(field => (
                                                    <TableHead key={field}>{field}</TableHead>
                                                ))}
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {previewData.map((row, index) => (
                                                <TableRow key={index}>
                                                    {selectedFields.map(field => (
                                                        <TableCell key={field}>
                                                            {row[field] !== null && row[field] !== undefined
                                                                ? String(row[field])
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
                    )}
                </div>
            </div>
        </div>
    );
}
