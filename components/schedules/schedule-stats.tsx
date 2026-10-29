'use client';

import { useEffect, useState } from 'react';
import { MetricCard } from '@/components/ui/metric-card';
import { Calendar, CheckCircle, Clock, ListTodo } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface ScheduleStatsProps {
    branchId: string;
}

interface Stats {
    totalSchedules: number;
    activeSchedules: number;
    executionsToday: number;
    upcomingExecutions: number;
}

export function ScheduleStats({ branchId }: ScheduleStatsProps) {
    const t = useTranslations('workflows.scheduling.stats');
    const [stats, setStats] = useState<Stats | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const response = await fetch(
                    `/api/workflows/schedules/stats?branchId=${branchId}`,
                    { credentials: 'include' }
                );

                if (response.ok) {
                    const body = await response.json();
                    setStats(body.data);
                    setError(false);
                } else {
                    setError(true);
                }
            } catch (error) {
                console.error('Error fetching schedule stats:', error);
                setError(true);
            } finally {
                setLoading(false);
            }
        };

        setLoading(true);
        setStats(null);

        fetchStats();

        // Auto-refresh every 30 seconds
        const interval = setInterval(fetchStats, 30000);
        return () => clearInterval(interval);
    }, [branchId]);

    if (loading) {
        return (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {[...Array(4)].map((_, i) => (
                    <div
                        key={i}
                        className="h-32 rounded-lg border bg-card animate-pulse"
                    />
                ))}
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                No se pudieron cargar los KPIs de programación.
            </div>
        );
    }

    if (!stats) {
        return null;
    }

    return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <MetricCard
                label={t('total')}
                value={stats.totalSchedules}
                icon={<ListTodo className="h-4 w-4" />}
                subtitle={t('totalSubtitle')}
            />
            <MetricCard
                label={t('active')}
                value={stats.activeSchedules}
                icon={<CheckCircle className="h-4 w-4" />}
                subtitle={t('activeSubtitle')}
                tone="success"
            />
            <MetricCard
                label={t('executionsToday')}
                value={stats.executionsToday}
                icon={<Calendar className="h-4 w-4" />}
                subtitle={t('executionsTodaySubtitle')}
            />
            <MetricCard
                label={t('upcoming')}
                value={stats.upcomingExecutions}
                icon={<Clock className="h-4 w-4" />}
                subtitle={t('upcomingSubtitle')}
            />
        </div>
    );
}
