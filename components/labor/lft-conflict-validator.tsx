'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { AlertTriangle, AlertCircle, Info, Download, CheckCircle } from 'lucide-react';
import { LFTConflictDetector, LFTConflict, ShiftSchedule } from '@/lib/services/lft-conflict-detector';
import { ScheduleCalendarPDF } from '@/lib/reports/schedule-calendar-pdf';
import { format, startOfWeek, endOfWeek } from 'date-fns';
import { toast } from 'sonner';

interface LFTConflictValidatorProps {
    schedules: ShiftSchedule[];
    dateRange?: { start: Date; end: Date };
}

export function LFTConflictValidator({ schedules, dateRange }: LFTConflictValidatorProps) {
    const [conflicts, setConflicts] = useState<LFTConflict[]>([]);
    const [hasChecked, setHasChecked] = useState(false);

    const detectConflicts = () => {
        const detected = LFTConflictDetector.detectConflicts(schedules);
        setConflicts(detected);
        setHasChecked(true);

        if (detected.length === 0) {
            toast.success('¡No se encontraron conflictos LFT!', {
                description: 'El calendario cumple con la normativa laboral',
            });
        } else {
            toast.warning(`Se encontraron ${detected.length} conflictos LFT`, {
                description: 'Revisa los detalles abajo',
            });
        }
    };

    const exportToPDF = async () => {
        try {
            const range = dateRange || {
                start: startOfWeek(new Date(), { weekStartsOn: 1 }),
                end: endOfWeek(new Date(), { weekStartsOn: 1 }),
            };

            await ScheduleCalendarPDF.exportToPDF(
                schedules,
                'Calendario de Turnos con Validación LFT',
                range,
                conflicts
            );

            toast.success('Calendario exportado exitosamente');
        } catch (error) {
            console.error('Error exporting PDF:', error);
            toast.error('Error al exportar calendario');
        }
    };

    const getSeverityIcon = (severity: string) => {
        switch (severity) {
            case 'LEVE':
                return <Info className="h-5 w-5 text-yellow-600" />;
            case 'GRAVE':
                return <AlertTriangle className="h-5 w-5 text-red-600" />;
            case 'MUY_GRAVE':
                return <AlertCircle className="h-5 w-5 text-red-700" />;
            default:
                return <Info className="h-5 w-5 text-gray-600" />;
        }
    };

    const getSummary = () => {
        return {
            total: conflicts.length,
            bySeverity: {
                LEVE: conflicts.filter(c => c.severity === 'LEVE').length,
                GRAVE: conflicts.filter(c => c.severity === 'GRAVE').length,
                MUY_GRAVE: conflicts.filter(c => c.severity === 'MUY_GRAVE').length,
            },
            byType: conflicts.reduce((acc, c) => {
                acc[c.type] = (acc[c.type] || 0) + 1;
                return acc;
            }, {} as Record<string, number>),
        };
    };

    const summary = getSummary();

    return (
        <div className="space-y-4">
            {/* Action Buttons */}
            <div className="flex gap-3">
                <Button onClick={detectConflicts} variant="default">
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Validar LFT
                </Button>
                {hasChecked && (
                    <Button onClick={exportToPDF} variant="outline">
                        <Download className="h-4 w-4 mr-2" />
                        Exportar Calendario PDF
                    </Button>
                )}
            </div>

            {/* Validation Results */}
            {hasChecked && (
                <>
                    {/* Summary Cards */}
                    {conflicts.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Total Conflictos</CardTitle>
                                    <AlertCircle className="h-4 w-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{summary.total}</div>
                                    <p className="text-xs text-muted-foreground">
                                        Violaciones detectadas
                                    </p>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Leves</CardTitle>
                                    <Info className="h-4 w-4 text-yellow-600" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold text-yellow-600">{summary.bySeverity.LEVE}</div>
                                    <p className="text-xs text-muted-foreground">
                                        Requieren atención
                                    </p>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Graves</CardTitle>
                                    <AlertTriangle className="h-4 w-4 text-red-600" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold text-red-600">{summary.bySeverity.GRAVE}</div>
                                    <p className="text-xs text-muted-foreground">
                                        Acción requerida
                                    </p>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Muy Graves</CardTitle>
                                    <AlertCircle className="h-4 w-4 text-red-700" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold text-red-700">{summary.bySeverity.MUY_GRAVE}</div>
                                    <p className="text-xs text-muted-foreground">
                                        Riesgo legal alto
                                    </p>
                                </CardContent>
                            </Card>
                        </div>
                    )}

                    {/* Conflicts List */}
                    <Card>
                        <CardHeader>
                            <CardTitle>
                                {conflicts.length === 0 ? (
                                    <div className="flex items-center gap-2">
                                        <CheckCircle className="h-5 w-5 text-green-600" />
                                        <span>✅ Sin Conflictos LFT</span>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <AlertTriangle className="h-5 w-5 text-red-600" />
                                        <span>Conflictos LFT Detectados</span>
                                    </div>
                                )}
                            </CardTitle>
                            <CardDescription>
                                {conflicts.length === 0
                                    ? 'El calendario cumple con todas las normas de la LFT'
                                    : 'Se detectaron violaciones a la Ley Federal del Trabajo'}
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {conflicts.length === 0 ? (
                                <div className="text-center py-8">
                                    <CheckCircle className="h-16 w-16 mx-auto text-green-600 mb-4" />
                                    <p className="text-lg font-medium text-green-900">
                                        ¡Excelente! No hay conflictos
                                    </p>
                                    <p className="text-sm text-muted-foreground mt-2">
                                        El calendario de turnos cumple con la normativa laboral
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {conflicts.map((conflict) => (
                                        <div
                                            key={conflict.id}
                                            className={cn(
                                                "p-4 border rounded-lg bg-card",
                                                conflict.severity === 'MUY_GRAVE' && "border-destructive/30 bg-destructive/[0.02]",
                                                conflict.severity === 'GRAVE' && "border-destructive/20 bg-destructive/[0.01]",
                                                conflict.severity === 'LEVE' && "border-amber-500/20 bg-amber-500/[0.01]"
                                            )}
                                        >
                                            <div className="flex items-start gap-3">
                                                {getSeverityIcon(conflict.severity)}
                                                <div className="flex-1 space-y-2">
                                                    <div className="flex items-center justify-between">
                                                        <p className="font-medium">
                                                            {conflict.userName} - {conflict.type}
                                                        </p>
                                                        <Badge
                                                            variant={
                                                                conflict.severity === 'MUY_GRAVE'
                                                                    ? 'destructive'
                                                                    : conflict.severity === 'GRAVE'
                                                                    ? 'destructive'
                                                                    : 'default'
                                                            }
                                                        >
                                                            {conflict.severity}
                                                        </Badge>
                                                    </div>
                                                    <p className="text-sm text-muted-foreground">
                                                        {conflict.description}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {conflict.article} • Fechas:{' '}
                                                        {conflict.dates.map(d => format(d, 'dd/MM/yyyy')).join(', ')}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </>
            )}
        </div>
    );
}
