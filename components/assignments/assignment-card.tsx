'use client';

import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, Calendar, Clock, Play, CheckCircle2, Eye } from 'lucide-react';
import { format, formatDistanceToNow, isPast, differenceInHours } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface Assignment {
    id: string;
    instanceId: string;
    assignedTo: string;
    status: 'PENDING' | 'NOTIFIED' | 'STARTED' | 'COMPLETED' | 'OVERDUE';
    dueDate: Date;
    isOverdue: boolean;
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    notes?: string;
    createdAt: Date;
    startedAt?: Date;
    completedAt?: Date;
}

interface WorkflowInstance {
    id: string;
    workflowTemplateId: string;
    status: string;
}

interface AssignmentCardProps {
    assignment: Assignment;
    instance: WorkflowInstance;
    onStatusChange: (status: Assignment['status']) => void;
    onViewDetails: () => void;
}

const statusLabels = {
    PENDING: 'Pendiente',
    NOTIFIED: 'Notificado',
    STARTED: 'En progreso',
    COMPLETED: 'Completado',
    OVERDUE: 'Vencido',
};

const statusColors = {
    PENDING: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100',
    NOTIFIED: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100',
    STARTED: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100',
    COMPLETED: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
    OVERDUE: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100',
};

const priorityColors = {
    LOW: 'border-l-gray-400',
    MEDIUM: 'border-l-blue-500',
    HIGH: 'border-l-orange-500',
    URGENT: 'border-l-red-500',
};

const priorityLabels = {
    LOW: 'Baja',
    MEDIUM: 'Media',
    HIGH: 'Alta',
    URGENT: 'Urgente',
};

export function AssignmentCard({
    assignment,
    instance,
    onStatusChange,
    onViewDetails,
}: AssignmentCardProps) {
    const dueDate = new Date(assignment.dueDate);
    const hoursUntilDue = differenceInHours(dueDate, new Date());
    const isDueSoon = hoursUntilDue > 0 && hoursUntilDue <= 24;
    const isOverdue = assignment.isOverdue || isPast(dueDate);

    const dueDateText = formatDistanceToNow(dueDate, {
        addSuffix: true,
        locale: es,
    });

    const getActionButtons = () => {
        switch (assignment.status) {
            case 'PENDING':
            case 'NOTIFIED':
                return (
                    <Button
                        size="sm"
                        onClick={() => onStatusChange('STARTED')}
                        className="w-full sm:w-auto"
                    >
                        <Play className="h-4 w-4 mr-2" />
                        Iniciar Tarea
                    </Button>
                );

            case 'STARTED':
                return (
                    <div className="flex gap-2 w-full sm:w-auto">
                        <Button
                            size="sm"
                            variant="default"
                            onClick={() => onStatusChange('COMPLETED')}
                            className="flex-1 sm:flex-none"
                        >
                            <CheckCircle2 className="h-4 w-4 mr-2" />
                            Completar
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={onViewDetails}
                        >
                            <Eye className="h-4 w-4 mr-2" />
                            Ver Progreso
                        </Button>
                    </div>
                );

            case 'COMPLETED':
                return (
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={onViewDetails}
                        className="w-full sm:w-auto"
                    >
                        <Eye className="h-4 w-4 mr-2" />
                        Ver Detalles
                    </Button>
                );

            case 'OVERDUE':
                return (
                    <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => onStatusChange('COMPLETED')}
                        className="w-full sm:w-auto"
                    >
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        Completar Ahora
                    </Button>
                );

            default:
                return null;
        }
    };

    return (
        <Card className={cn('border-l-4', priorityColors[assignment.priority])}>
            <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1 flex-1">
                        <h3 className="font-semibold text-lg leading-none">
                            {instance.workflowTemplateId.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                        </h3>
                        {assignment.notes && (
                            <p className="text-sm text-muted-foreground line-clamp-2">
                                {assignment.notes}
                            </p>
                        )}
                    </div>

                    {isOverdue && (
                        <Badge variant="destructive" className="shrink-0">
                            <AlertCircle className="h-3 w-3 mr-1" />
                            Vencido
                        </Badge>
                    )}

                    {isDueSoon && !isOverdue && (
                        <Badge variant="outline" className="shrink-0 border-yellow-500 text-yellow-700 dark:text-yellow-400">
                            <Clock className="h-3 w-3 mr-1" />
                            Vence pronto
                        </Badge>
                    )}
                </div>
            </CardHeader>

            <CardContent className="pb-3">
                <div className="flex flex-wrap gap-2 mb-4">
                    <Badge className={statusColors[assignment.status]}>
                        {statusLabels[assignment.status]}
                    </Badge>

                    <Badge variant="outline">
                        {priorityLabels[assignment.priority] || assignment.priority}
                    </Badge>
                </div>

                <div className="space-y-2 text-sm text-muted-foreground">
                    <div className="flex items-center">
                        <Calendar className="h-4 w-4 mr-2" />
                        <span className={isOverdue ? 'text-red-600 font-medium' : ''}>
                            Vence {dueDateText}
                        </span>
                    </div>

                    {assignment.startedAt && (
                        <div className="flex items-center">
                            <Clock className="h-4 w-4 mr-2" />
                            <span>
                                Iniciado {formatDistanceToNow(new Date(assignment.startedAt), {
                                    addSuffix: true,
                                    locale: es,
                                })}
                            </span>
                        </div>
                    )}

                    {assignment.completedAt && (
                        <div className="flex items-center">
                            <CheckCircle2 className="h-4 w-4 mr-2" />
                            <span>
                                Completado {formatDistanceToNow(new Date(assignment.completedAt), {
                                    addSuffix: true,
                                    locale: es,
                                })}
                            </span>
                        </div>
                    )}
                </div>
            </CardContent>

            <CardFooter className="pt-3">
                {getActionButtons()}
            </CardFooter>
        </Card>
    );
}
