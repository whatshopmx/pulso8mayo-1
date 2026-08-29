'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Coffee, AlertTriangle, CheckCircle, XCircle, MessageCircle, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';

interface EmployeeBreakStatus {
    userId: string;
    userName: string;
    userPhone: string;
    branchId: string;
    branchName: string;
    shiftStarted: Date | string;
    minutesWorked: number;
    lastBreakStart: Date | string | null;
    lastBreakEnd: Date | string | null;
    lastBreakDuration: number | null;
    totalBreakMinutes: number;
    breakCount: number;
    hasActiveBreak: boolean;
    complianceStatus: 'COMPLIANT' | 'WARNING' | 'NON_COMPLIANT';
    complianceIssues: string[];
    lastWhatsAppNotification: Date | string | null;
}

interface BreakManagementDashboardProps {
    companyId?: string;
    userRole?: string;
    userBranchId?: string;
}

export function BreakManagementDashboard({ userBranchId }: BreakManagementDashboardProps) {
    const [employees, setEmployees] = useState<EmployeeBreakStatus[]>([]);
    const [loading, setLoading] = useState(true);
    const [sendingBulk, setSendingBulk] = useState(false);
    const [selectedBranch, setSelectedBranch] = useState<string>(userBranchId || 'all');
    const [selectedStatus, setSelectedStatus] = useState<string>('all');
    const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);

    const fetchBranches = async () => {
        try {
            const response = await fetch('/api/branches');
            if (response.ok) {
                const data = await response.json();
                setBranches(data.data || data.branches || data || []);
            }
        } catch (error) {
            console.error('Error fetching branches:', error);
        }
    };

    const fetchBreakData = useCallback(async () => {
        try {
            setLoading(true);
            const params = new URLSearchParams();
            if (selectedBranch !== 'all') {
                params.set('branchId', selectedBranch);
            }

            const response = await fetch(`/api/labor/breaks/status?${params}`);
            if (response.ok) {
                const data = await response.json();
                setEmployees(data.employees || []);
            }
        } catch (error) {
            console.error('Error fetching break data:', error);
            toast.error('Error al cargar datos de breaks');
        } finally {
            setLoading(false);
        }
    }, [selectedBranch]);

    useEffect(() => {
        fetchBranches();
    }, []);

    useEffect(() => {
        fetchBreakData();
    }, [fetchBreakData]);

    const sendWhatsAppReminder = async (userId: string, userName: string, phone: string) => {
        try {
            const response = await fetch('/api/labor/breaks/send-reminder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, phone }),
            });

            if (response.ok) {
                toast.success(`Recordatorio enviado a ${userName} por WhatsApp`);
                fetchBreakData();
            } else {
                throw new Error('Error al enviar recordatorio');
            }
        } catch (error) {
            console.error('Error sending WhatsApp reminder:', error);
            toast.error('Error al enviar recordatorio');
        }
    };

    const sendBulkReminders = async () => {
        try {
            setSendingBulk(true);
            const res = await fetch('/api/labor/breaks/send-bulk-reminders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ branchId: selectedBranch }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                toast.success(data.message);
                fetchBreakData();
            } else {
                throw new Error(data.error || 'Error al enviar recordatorios');
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Error al enviar recordatorios masivos';
            toast.error(message);
        } finally {
            setSendingBulk(false);
        }
    };

    const summary = useMemo(() => {
        const total = employees.length;
        const compliant = employees.filter(e => e.complianceStatus === 'COMPLIANT').length;
        const warning = employees.filter(e => e.complianceStatus === 'WARNING').length;
        const nonCompliant = employees.filter(e => e.complianceStatus === 'NON_COMPLIANT').length;
        const onBreak = employees.filter(e => e.hasActiveBreak).length;
        const missedBreaks = employees.filter(e => e.minutesWorked > 300 && e.totalBreakMinutes === 0).length;
        const pendingReminders = warning + nonCompliant;

        return {
            total,
            compliant,
            warning,
            nonCompliant,
            onBreak,
            missedBreaks,
            pendingReminders
        };
    }, [employees]);

    const filteredEmployees = useMemo(() => {
        if (selectedStatus === 'all') return employees;
        return employees.filter(emp => emp.complianceStatus === selectedStatus);
    }, [employees, selectedStatus]);

    const getComplianceBadge = (status: string) => {
        switch (status) {
            case 'COMPLIANT':
                return (
                    <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-0 text-xs font-medium">
                        <CheckCircle className="h-3 w-3 mr-1 text-emerald-600" />
                        Cumplido
                    </Badge>
                );
            case 'WARNING':
                return (
                    <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300 text-xs font-medium">
                        <AlertTriangle className="h-3 w-3 mr-1 text-amber-600" />
                        Advertencia
                    </Badge>
                );
            case 'NON_COMPLIANT':
                return (
                    <Badge variant="destructive" className="text-xs font-medium">
                        <XCircle className="h-3 w-3 mr-1" />
                        Incumplimiento
                    </Badge>
                );
            default:
                return <Badge variant="outline" className="text-xs">{status}</Badge>;
        }
    };

    return (
        <div className="space-y-6">
            {/* Live Operational Metrics (Flat by default) */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                <Card className="border border-border bg-card">
                    <CardHeader className="p-3.5 pb-1.5">
                        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Total Turno
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3.5 pt-0">
                        <div className="text-2xl font-bold tracking-tight text-foreground">{summary.total}</div>
                    </CardContent>
                </Card>

                <Card className="border border-border bg-card">
                    <CardHeader className="p-3.5 pb-1.5">
                        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                            <Coffee className="h-3 w-3 text-emerald-600" /> En Break
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3.5 pt-0">
                        <div className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">{summary.onBreak}</div>
                    </CardContent>
                </Card>

                <Card className="border border-border bg-card">
                    <CardHeader className="p-3.5 pb-1.5">
                        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                            <CheckCircle className="h-3 w-3 text-emerald-600" /> Cumplidos
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3.5 pt-0">
                        <div className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">{summary.compliant}</div>
                    </CardContent>
                </Card>

                <Card className="border border-border bg-card">
                    <CardHeader className="p-3.5 pb-1.5">
                        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3 text-amber-600" /> Advertencias
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3.5 pt-0">
                        <div className="text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">{summary.warning}</div>
                    </CardContent>
                </Card>

                <Card className="border border-border bg-card">
                    <CardHeader className="p-3.5 pb-1.5">
                        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                            <XCircle className="h-3 w-3 text-destructive" /> Incumplidos
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3.5 pt-0">
                        <div className="text-2xl font-bold tracking-tight text-destructive">{summary.nonCompliant}</div>
                    </CardContent>
                </Card>

                <Card className="border border-border bg-card">
                    <CardHeader className="p-3.5 pb-1.5">
                        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Omitidos &gt;5h
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3.5 pt-0">
                        <div className="text-2xl font-bold tracking-tight text-destructive">{summary.missedBreaks}</div>
                    </CardContent>
                </Card>
            </div>

            {/* Filters and Actions Bar */}
            <Card className="border border-border bg-card">
                <CardHeader className="p-4 border-b border-border">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                            <CardTitle className="text-base font-bold text-foreground">Estado de Descansos por Empleado</CardTitle>
                            <CardDescription className="text-xs text-muted-foreground">
                                Monitoreo en tiempo real según Art. 63 LFT y NOM-035
                            </CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                onClick={sendBulkReminders}
                                variant="default"
                                size="sm"
                                disabled={sendingBulk || summary.pendingReminders === 0}
                                className="bg-primary text-primary-foreground hover:bg-primary/90 text-xs h-8"
                            >
                                {sendingBulk ? (
                                    <>
                                        <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                        Enviando...
                                    </>
                                ) : (
                                    <>
                                        <MessageCircle className="h-3.5 w-3.5 mr-1.5" />
                                        Recordar a pendientes ({summary.pendingReminders})
                                    </>
                                )}
                            </Button>
                            <Button onClick={fetchBreakData} variant="outline" size="sm" className="text-xs h-8">
                                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                                Actualizar
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-4 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Sucursal</label>
                            <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                                <SelectTrigger className="h-9 text-xs">
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
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Estado de Cumplimiento</label>
                            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                                <SelectTrigger className="h-9 text-xs">
                                    <SelectValue placeholder="Todos los estados" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todos los estados</SelectItem>
                                    <SelectItem value="COMPLIANT">✅ Cumplidos</SelectItem>
                                    <SelectItem value="WARNING">⚠️ Advertencias</SelectItem>
                                    <SelectItem value="NON_COMPLIANT">❌ Incumplimientos</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Employee Break Status Table */}
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-12 space-y-2">
                            <RefreshCw className="h-6 w-6 animate-spin text-primary" />
                            <p className="text-xs text-muted-foreground">Consultando estado de descansos...</p>
                        </div>
                    ) : filteredEmployees.length === 0 ? (
                        <div className="text-center py-12 border border-dashed rounded-lg">
                            <Coffee className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                            <p className="text-sm font-semibold text-foreground">No hay colaboradores para mostrar</p>
                            <p className="text-xs text-muted-foreground mt-1">
                                No se encontraron turnos activos con los filtros seleccionados
                            </p>
                        </div>
                    ) : (
                        <div className="rounded-md border border-border overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-muted/40">
                                        <TableHead className="text-xs">Empleado</TableHead>
                                        <TableHead className="text-xs">Sucursal</TableHead>
                                        <TableHead className="text-xs">Inicio Turno</TableHead>
                                        <TableHead className="text-xs">Horas Trabajadas</TableHead>
                                        <TableHead className="text-xs">Breaks</TableHead>
                                        <TableHead className="text-xs">Total Minutos</TableHead>
                                        <TableHead className="text-xs">Estado</TableHead>
                                        <TableHead className="text-xs">Cumplimiento</TableHead>
                                        <TableHead className="text-xs text-right">Acciones</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredEmployees.map((employee) => (
                                        <TableRow key={employee.userId} className="hover:bg-muted/30">
                                            <TableCell className="text-xs font-medium">
                                                <div>
                                                    <p className="font-semibold text-foreground">{employee.userName}</p>
                                                    <p className="text-xs text-muted-foreground font-mono">{employee.userPhone}</p>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground">{employee.branchName}</TableCell>
                                            <TableCell className="text-xs font-mono">
                                                {format(new Date(employee.shiftStarted), 'HH:mm', { locale: es })}
                                            </TableCell>
                                            <TableCell className="text-xs font-mono font-medium">
                                                {Math.floor(employee.minutesWorked / 60)}h {employee.minutesWorked % 60}m
                                            </TableCell>
                                            <TableCell className="text-xs">
                                                <div className="flex items-center gap-1.5">
                                                    <Coffee className={`h-3.5 w-3.5 ${employee.hasActiveBreak ? 'text-emerald-600' : 'text-muted-foreground'}`} />
                                                    <span>{employee.breakCount}</span>
                                                    {employee.hasActiveBreak && (
                                                        <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0">
                                                            En pausa
                                                        </Badge>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-xs font-mono font-medium">
                                                {employee.totalBreakMinutes} min
                                            </TableCell>
                                            <TableCell className="text-xs">
                                                {employee.complianceIssues.length > 0 ? (
                                                    <div className="space-y-0.5">
                                                        {employee.complianceIssues.map((issue, idx) => (
                                                            <p key={idx} className="text-xs text-destructive flex items-center gap-1">
                                                                <AlertTriangle className="h-3 w-3 shrink-0" />
                                                                {issue}
                                                            </p>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
                                                        <CheckCircle className="h-3 w-3 shrink-0" />
                                                        Al día
                                                    </p>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-xs">
                                                {getComplianceBadge(employee.complianceStatus)}
                                            </TableCell>
                                            <TableCell className="text-xs text-right">
                                                <div className="flex gap-1.5 justify-end">
                                                    {employee.minutesWorked >= 240 && employee.totalBreakMinutes === 0 && (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="h-7 text-xs px-2"
                                                            onClick={() => sendWhatsAppReminder(
                                                                employee.userId,
                                                                employee.userName,
                                                                employee.userPhone
                                                            )}
                                                            title="Enviar recordatorio por WhatsApp"
                                                        >
                                                            <MessageCircle className="h-3.5 w-3.5 mr-1 text-emerald-600" />
                                                            Recordar
                                                        </Button>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* WhatsApp Automation & LFT Requirements Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* LFT Requirements */}
                <Card className="border border-border bg-card">
                    <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-sm font-bold text-foreground flex items-center gap-2">
                            <Coffee className="h-4 w-4 text-primary" />
                            Normativa LFT y NOM-035
                        </CardTitle>
                        <CardDescription className="text-xs text-muted-foreground">
                            Obligaciones legales aplicables a sucursales
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-4 pt-2 space-y-2.5 text-xs">
                        <div className="p-2.5 bg-muted/40 rounded-lg border border-border space-y-1">
                            <p className="font-semibold text-foreground">Art. 63 LFT - Descanso Continuo</p>
                            <p className="text-muted-foreground">
                                Durante la jornada continua de trabajo se concederá al trabajador un descanso de media hora, por lo menos.
                            </p>
                        </div>
                        <div className="p-2.5 bg-muted/40 rounded-lg border border-border space-y-1">
                            <p className="font-semibold text-foreground">Jornada Máxima y Reposo</p>
                            <p className="text-muted-foreground">
                                8 horas diurnas / 7 nocturnas. Descanso obligatorio mínimo de 12 horas entre turnos.
                            </p>
                        </div>
                    </CardContent>
                </Card>

                {/* WhatsApp Bot Guide */}
                <Card className="border border-border bg-card">
                    <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-sm font-bold text-foreground flex items-center gap-2">
                            <MessageCircle className="h-4 w-4 text-emerald-600" />
                            Comandos WhatsApp para el Personal
                        </CardTitle>
                        <CardDescription className="text-xs text-muted-foreground">
                            El colaborador registra su descanso sin app instalada
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-4 pt-2 space-y-2 text-xs">
                        <div className="p-2.5 bg-muted/40 rounded-lg border border-border space-y-1.5">
                            <div className="flex items-center justify-between">
                                <span className="font-semibold text-foreground">Iniciar Pausa:</span>
                                <code className="bg-background px-1.5 py-0.5 rounded text-primary font-mono text-xs">pausa</code>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="font-semibold text-foreground">Finalizar Pausa:</span>
                                <code className="bg-background px-1.5 py-0.5 rounded text-primary font-mono text-xs">fin pausa</code>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="font-semibold text-foreground">Consultar Horas:</span>
                                <code className="bg-background px-1.5 py-0.5 rounded text-primary font-mono text-xs">status</code>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
