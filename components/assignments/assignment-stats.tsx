'use client';

import { useEffect, useState } from 'react';
import { MetricCard } from '@/components/ui/metric-card';
import { AlertCircle, CheckCircle2, Clock, ListChecks, Play, Target } from 'lucide-react';

interface AssignmentStatsProps {
    userId?: string;
}

interface Stats {
    total: number;
    pending: number;
    started: number;
    completed: number;
    overdue: number;
    completedToday: number;
}

export function AssignmentStats({ userId }: AssignmentStatsProps) {
    const [stats, setStats] = useState<Stats | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const url = userId
                    ? `/api/workflows/assignments/stats?userId=${userId}`
                    : '/api/workflows/assignments/stats';

                const response = await fetch(url, { credentials: 'include' });

                if (response.ok) {
                    const data = await response.json();
                    setStats(data);
                }
            } catch (error) {
                console.error('Error fetching assignment stats:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchStats();

        // Auto-refresh every 30 seconds
        const interval = setInterval(fetchStats, 30000);
        return () => clearInterval(interval);
    }, [userId]);

    if (loading) {
        return (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
                {[...Array(6)].map((_, i) => (
                    <div
                        key={i}
                        className="h-32 rounded-lg border bg-card animate-pulse"
                    />
                ))}
            </div>
        );
    }

    if (!stats) {
        return null;
    }

    return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
            <MetricCard
                label="Total"
                value={stats.total}
                icon={<Target className="h-4 w-4" />}
                subtitle="All assignments"
            />
            <MetricCard
                label="Pending"
                value={stats.pending}
                icon={<ListChecks className="h-4 w-4" />}
                subtitle="Not started"
                tone={stats.pending > 0 ? 'warning' : 'neutral'}
            />
            <MetricCard
                label="Started"
                value={stats.started}
                icon={<Play className="h-4 w-4" />}
                subtitle="In progress"
            />
            <MetricCard
                label="Completed"
                value={stats.completed}
                icon={<CheckCircle2 className="h-4 w-4" />}
                subtitle="Finished tasks"
                tone="success"
            />
            <MetricCard
                label="Overdue"
                value={stats.overdue}
                icon={<AlertCircle className="h-4 w-4" />}
                subtitle="Past due date"
                tone={stats.overdue > 0 ? 'destructive' : 'neutral'}
            />
            <MetricCard
                label="Today"
                value={stats.completedToday}
                icon={<Clock className="h-4 w-4" />}
                subtitle="Completed today"
            />
        </div>
    );
}
