'use client';

import { useEffect, useState } from 'react';
import { ScheduleCard } from './schedule-card';
import { Loader2 } from 'lucide-react';

interface Schedule {
    id: string;
    templateId: string;
    title: string;
    description?: string;
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'ONCE';
    assignmentType: 'ROLE' | 'USER' | 'AUTO' | 'MANUAL';
    assignedRole?: string;
    assignedUserId?: string;
    timeOfDay?: string;
    dayOfWeek?: number;
    dayOfMonth?: number;
    isActive: boolean;
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    nextExecutionAt?: Date;
    executionCount: number;
    createdAt: Date;
}

interface ScheduleFilters {
    isActive?: boolean;
    frequency?: string;
    assignmentType?: string;
}

interface ScheduleListProps {
    branchId: string;
    filters?: ScheduleFilters;
    onEdit: (schedule: Schedule) => void;
    onDelete: (scheduleId: string) => void;
    onToggle: (scheduleId: string, isActive: boolean) => void;
}

export function ScheduleList({
    branchId,
    filters,
    onEdit,
    onDelete,
    onToggle,
}: ScheduleListProps) {
    const [schedules, setSchedules] = useState<Schedule[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchSchedules = async () => {
            setLoading(true);
            setError(null);

            try {
                const params = new URLSearchParams({ branchId });

                if (filters?.isActive !== undefined) {
                    params.append('isActive', String(filters.isActive));
                }
                if (filters?.frequency) {
                    params.append('frequency', filters.frequency);
                }
                if (filters?.assignmentType) {
                    params.append('assignmentType', filters.assignmentType);
                }

                const response = await fetch(`/api/workflows/schedules?${params}`, {
                    credentials: 'include',
                });

                if (!response.ok) {
                    throw new Error('Failed to fetch schedules');
                }

                const body = await response.json();
                setSchedules(body.data ?? []);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Unknown error');
            } finally {
                setLoading(false);
            }
        };

        fetchSchedules();
    }, [branchId, filters]);

    const handleDelete = async (scheduleId: string) => {
        if (!confirm('¿Estás seguro de que deseas eliminar este schedule?')) {
            return;
        }

        try {
            const response = await fetch(`/api/workflows/schedules/${scheduleId}`, {
                method: 'DELETE',
                credentials: 'include',
            });

            if (!response.ok) {
                throw new Error('Failed to delete schedule');
            }

            setSchedules(schedules.filter(s => s.id !== scheduleId));
            onDelete(scheduleId);
        } catch (err) {
            alert('Error al eliminar el schedule');
        }
    };

    const handleToggle = async (scheduleId: string, currentActive: boolean) => {
        try {
            const response = await fetch(`/api/workflows/schedules/${scheduleId}/toggle`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ isActive: !currentActive }),
            });

            if (!response.ok) {
                throw new Error('Failed to toggle schedule');
            }

            const body = await response.json();
            const updated = body.data;
            setSchedules(schedules.map(s => s.id === scheduleId ? updated : s));
            onToggle(scheduleId, !currentActive);
        } catch (err) {
            alert('Error al cambiar el estado del schedule');
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="text-center py-12">
                <p className="text-red-600">Error: {error}</p>
            </div>
        );
    }

    if (schedules.length === 0) {
        return (
            <div className="text-center py-12">
                <p className="text-muted-foreground">
                    No se encontraron schedules. Crea uno nuevo para comenzar.
                </p>
            </div>
        );
    }

    return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {schedules.map((schedule) => (
                <ScheduleCard
                    key={schedule.id}
                    schedule={schedule}
                    onEdit={() => onEdit(schedule)}
                    onDelete={() => handleDelete(schedule.id)}
                    onToggle={() => handleToggle(schedule.id, schedule.isActive)}
                />
            ))}
        </div>
    );
}
