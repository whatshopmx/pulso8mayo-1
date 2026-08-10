'use client';

import { useEffect, useState } from 'react';
import { MetricCard } from '@/components/ui/metric-card';
import { Calendar, CheckCircle, Clock, ListTodo } from 'lucide-react';

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
    const [stats, setStats] = useState<Stats | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const response = await fetch(
                    `/api/workflows/schedules/stats?branchId=${branchId}`,
                    { credentials: 'include' }
                );

                if (response.ok) {
                    const data = await response.json();
                    setStats(data);
                }
            } catch (error) {
                console.error('Error fetching schedule stats:', error);
            } finally {
                setLoading(false);
            }
        };

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

    if (!stats) {
        return null;
    }

    return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <MetricCard
                label="Total Schedules"
                value={stats.totalSchedules}
                icon={<ListTodo className="h-4 w-4" />}
                subtitle="All configured schedules"
            />
            <MetricCard
                label="Active Schedules"
                value={stats.activeSchedules}
                icon={<CheckCircle className="h-4 w-4" />}
                subtitle="Currently running"
                tone="success"
            />
            <MetricCard
                label="Executions Today"
                value={stats.executionsToday}
                icon={<Calendar className="h-4 w-4" />}
                subtitle="Workflows executed today"
            />
            <MetricCard
                label="Upcoming"
                value={stats.upcomingExecutions}
                icon={<Clock className="h-4 w-4" />}
                subtitle="Next 24 hours"
            />
        </div>
    );
}
