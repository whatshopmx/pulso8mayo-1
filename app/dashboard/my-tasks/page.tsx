'use client';

import { useState } from 'react';
import { AssignmentList } from '@/components/assignments/assignment-list';
import { AssignmentStats } from '@/components/assignments/assignment-stats';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { FilterX } from 'lucide-react';

export default function MyTasksPage() {
    const [filters, setFilters] = useState<{
        status?: string;
        priority?: string;
        isOverdue?: boolean;
    }>({});

    const handleStatusChange = (assignmentId: string, status: string) => {
        console.log(`Assignment ${assignmentId} status changed to ${status}`);
        // Optionally trigger a refetch or show a toast notification
    };

    const handleViewDetails = (assignmentId: string) => {
        // Navigate to workflow execution page
        window.location.href = `/dashboard/workflows/${assignmentId}`;
    };

    const clearFilters = () => {
        setFilters({});
    };

    const hasFilters = Object.values(filters).some(v => v !== undefined);

    return (
        <div className="space-y-6 p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Mis Tareas</h1>
                    <p className="text-muted-foreground">
                        Gestiona tus flujos de trabajo asignados
                    </p>
                </div>
            </div>

            {/* Stats */}
            <AssignmentStats />

            {/* Filters */}
            <div className="flex flex-wrap gap-4 items-center">
                <Select
                    value={filters.status || 'all'}
                    onValueChange={(value) =>
                        setFilters({ ...filters, status: value === 'all' ? undefined : value })
                    }
                >
                    <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Estado" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Todos los estados</SelectItem>
                        <SelectItem value="PENDING">Pendiente</SelectItem>
                        <SelectItem value="STARTED">En progreso</SelectItem>
                        <SelectItem value="COMPLETED">Completado</SelectItem>
                        <SelectItem value="OVERDUE">Vencido</SelectItem>
                    </SelectContent>
                </Select>

                <Select
                    value={filters.priority || 'all'}
                    onValueChange={(value) =>
                        setFilters({ ...filters, priority: value === 'all' ? undefined : value })
                    }
                >
                    <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Prioridad" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Todas las prioridades</SelectItem>
                        <SelectItem value="LOW">Baja</SelectItem>
                        <SelectItem value="MEDIUM">Media</SelectItem>
                        <SelectItem value="HIGH">Alta</SelectItem>
                        <SelectItem value="URGENT">Urgente</SelectItem>
                    </SelectContent>
                </Select>

                <Select
                    value={filters.isOverdue === undefined ? 'all' : filters.isOverdue ? 'true' : 'false'}
                    onValueChange={(value) =>
                        setFilters({
                            ...filters,
                            isOverdue: value === 'all' ? undefined : value === 'true',
                        })
                    }
                >
                    <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Vencimiento" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Todas</SelectItem>
                        <SelectItem value="true">Solo vencidas</SelectItem>
                        <SelectItem value="false">No vencidas</SelectItem>
                    </SelectContent>
                </Select>

                {hasFilters && (
                    <Button variant="outline" size="sm" onClick={clearFilters}>
                        <FilterX className="h-4 w-4 mr-2" />
                        Limpiar filtros
                    </Button>
                )}
            </div>

            {/* Assignment List */}
            <AssignmentList
                filters={filters}
                onStatusChange={handleStatusChange}
                onViewDetails={handleViewDetails}
            />
        </div>
    );
}
