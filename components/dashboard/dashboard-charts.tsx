"use client"

import { useEffect, useState, useCallback } from "react"
import { WorkflowStatusChart } from "./workflow-status-chart"
import { DailyExecutionsChart } from "./daily-executions-chart"
import { CriticalIncidentsList } from "./critical-incidents-list"
import { AlertDistributionChart } from "./alert-distribution-chart"
import { ErrorState } from "@/components/shared"

interface DashboardChartsProps {
    branch?: string;
    startDate?: string;
    endDate?: string;
}

export function DashboardCharts({ branch, startDate, endDate }: DashboardChartsProps) {
    const [data, setData] = useState<any>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(false)

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(false);
        try {
            const params = new URLSearchParams();
            if (branch && branch !== 'all') params.set('branch', branch);
            if (startDate) params.set('startDate', startDate);
            if (endDate) params.set('endDate', endDate);

            const res = await fetch(`/api/analytics/compliance?${params.toString()}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json()
            setData(json)
        } catch (err) {
            console.error("Error fetching dashboard charts data:", err)
            setError(true)
        } finally {
            setLoading(false)
        }
    }, [branch, startDate, endDate])

    useEffect(() => {
        fetchData()
    }, [fetchData])

    if (loading) {
        return (
            <div className="flex flex-col gap-6">
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div className="h-[400px] rounded-xl bg-muted animate-pulse border border-border" />
                    <div className="h-[400px] rounded-xl bg-muted animate-pulse border border-border" />
                </div>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div className="h-[400px] rounded-xl bg-muted animate-pulse border border-border" />
                    <div className="h-[400px] rounded-xl bg-muted animate-pulse border border-border" />
                </div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="p-6 rounded-xl border border-border bg-card">
                <ErrorState
                    message="No se pudieron cargar las métricas operativas."
                    onRetry={fetchData}
                />
            </div>
        )
    }

    if (!data) return null

    return (
        <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <DailyExecutionsChart 
                    data={data.dailyTrend || []} 
                />
                <WorkflowStatusChart 
                    data={data.workflowsByStatus || []} 
                />
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <CriticalIncidentsList 
                    incidents={data.criticalIncidents || []} 
                />
                <AlertDistributionChart 
                    branch={branch}
                    startDate={startDate}
                    endDate={endDate}
                />
            </div>
        </div>
    )
}
