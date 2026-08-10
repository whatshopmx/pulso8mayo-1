"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle, ClipboardList, Users, ShieldCheck } from "lucide-react";
import { MetricCard } from "@/components/ui/metric-card";

interface Metrics {
    complianceRate: number;
    complianceSentiment: string;
    totalInspections: number;
    openIncidents: number;
    openIncidentsSentiment: string;
    activeStaff?: number;
    activeStaffSentiment?: string;
    period: string;
}

interface ComplianceMetricsProps {
    branch?: string;
    startDate?: string;
    endDate?: string;
}

export function ComplianceMetrics({ branch, startDate, endDate }: ComplianceMetricsProps) {
    const [metrics, setMetrics] = useState<Metrics | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchMetrics = async () => {
            setLoading(true);
            try {
                const params = new URLSearchParams();
                if (branch && branch !== 'all') params.set('branch', branch);
                if (startDate) params.set('startDate', startDate);
                if (endDate) params.set('endDate', endDate);

                const res = await fetch(`/api/analytics/compliance?${params.toString()}`);
                if (res.ok) {
                    const data = await res.json();
                    setMetrics(data);
                }
            } catch (error) {
                console.error("Error al obtener métricas", error);
            } finally {
                setLoading(false);
            }
        };
        fetchMetrics();
    }, [branch, startDate, endDate]);

    if (loading) {
        return (
            <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 md:grid-cols-2 lg:grid-cols-4">
                {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-32 rounded-xl bg-muted animate-pulse border border-border" />
                ))}
            </div>
        );
    }

    if (!metrics) return null;

    return (
        <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 md:grid-cols-2 lg:grid-cols-4">
            <MetricCard
                label="Flujos Ejecutados"
                value={metrics.totalInspections}
                icon={<ClipboardList className="h-4 w-4" />}
                subtitle="Total en período"
                delta={{ value: 12, isPositive: true }}
            />

            <MetricCard
                label="Cumplimiento NOM-251"
                value={`${metrics.complianceRate}%`}
                icon={<ShieldCheck className="h-4 w-4" />}
                subtitle={
                    <span className="inline-flex items-center gap-1 font-medium">
                        <CheckCircle className="h-3 w-3 text-success" />
                        <span>Estado: {metrics.complianceSentiment}</span>
                    </span>
                }
                delta={{ value: 3.2, isPositive: true }}
                tone={metrics.complianceRate > 90 ? "success" : metrics.complianceRate > 75 ? "warning" : "destructive"}
            />

            <MetricCard
                label="Personal / Turnos"
                value={metrics.activeStaff || 0}
                icon={<Users className="h-4 w-4" />}
                subtitle={
                    <span className="inline-flex items-center gap-1 font-medium">
                        <Users className="h-3 w-3 text-info" />
                        <span>Operación: {metrics.activeStaffSentiment}</span>
                    </span>
                }
                delta={{ value: 5, isPositive: true }}
            />

            <MetricCard
                label="Incidentes Abiertos"
                value={metrics.openIncidents}
                icon={<AlertCircle className="h-4 w-4" />}
                subtitle={
                    <span className="inline-flex items-center gap-1 font-medium">
                        <AlertCircle className={`h-3 w-3 ${metrics.openIncidents > 0 ? 'text-warning-text' : 'text-success'}`} />
                        <span>Riesgo: {metrics.openIncidentsSentiment}</span>
                    </span>
                }
                delta={{ value: 0, isPositive: true }}
                tone={metrics.openIncidents > 0 ? "destructive" : "neutral"}
            />
        </div>
    );
}
