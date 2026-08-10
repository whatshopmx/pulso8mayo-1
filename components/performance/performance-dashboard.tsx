'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PerformanceReviewList } from '@/components/performance/review-list';
import { GoalsList } from '@/components/performance/goals-list';
import { PerformanceChart } from '@/components/performance/performance-chart';
import { MetricCard, MetricGrid } from '@/components/ui/metric-card';
import { Plus, FileCheck2, Clock4, Target, TrendingUp } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface StatsResponse {
  stats: {
    reviews: {
      total: number;
      completed: number;
      submitted: number;
      inProgress: number;
      draft: number;
      pending: number;
      completionRate: number;
    };
    goals: {
      total: number;
      completed: number;
      inProgress: number;
      notStarted: number;
      cancelled: number;
      overdue: number;
      completionRate: number;
    };
    people: {
      evaluated: number;
    };
  };
}

interface PerformanceDashboardProps {
  companyId: string;
  userId?: string;
  userRole?: string;
}

export function PerformanceDashboard({ companyId }: PerformanceDashboardProps) {
  const router = useRouter();
  const [stats, setStats] = useState<StatsResponse['stats'] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch(`/api/performance/stats`);
        if (!res.ok) {
          throw new Error(`Request failed: ${res.status}`);
        }
        const data = await res.json();
        setStats(data.stats || null);
      } catch (error) {
        console.error('Error fetching performance stats:', error);
        setStats(null);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [companyId]);

  const reviews = stats?.reviews;
  const goals = stats?.goals;

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Desempeño</h1>
          <p className="text-muted-foreground">
            Evaluaciones, objetivos y tendencias de tu equipo
          </p>
        </div>
        <Button onClick={() => router.push('/dashboard/performance/reviews/new')}>
          <Plus className="mr-2 h-4 w-4" />
          Nueva Evaluación
        </Button>
      </div>

      {/* Stats Cards */}
      <MetricGrid columns={4}>
        <MetricCard
          label="Evaluaciones Totales"
          value={reviews?.total ?? 0}
          icon={<FileCheck2 className="h-4 w-4" />}
          tone="primary"
          subtitle={
            reviews && reviews.total > 0
              ? `${reviews.completed} completadas`
              : 'Sin datos'
          }
          loading={loading}
        />
        <MetricCard
          label="Evaluaciones Pendientes"
          value={reviews?.pending ?? 0}
          icon={<Clock4 className="h-4 w-4" />}
          tone="warning"
          subtitle="Borrador, en progreso o enviadas"
          loading={loading}
        />
        <MetricCard
          label="Objetivos"
          value={goals?.total ?? 0}
          icon={<Target className="h-4 w-4" />}
          tone="info"
          subtitle={
            goals && goals.overdue > 0
              ? `${goals.overdue} vencidos`
              : goals
                ? `${goals.completed} completados`
                : 'Sin datos'
          }
          loading={loading}
        />
        <MetricCard
          label="Tasa de Completado"
          value={
            loading
              ? 0
              : reviews && reviews.total > 0
                ? `${reviews.completionRate}%`
                : '—'
          }
          icon={<TrendingUp className="h-4 w-4" />}
          tone="success"
          subtitle={
            reviews && reviews.total > 0
              ? `${stats?.people.evaluated ?? 0} empleados evaluados`
              : 'Sin evaluaciones aún'
          }
          loading={loading}
        />
      </MetricGrid>

      {/* Tabs */}
      <Tabs defaultValue="reviews" className="space-y-4">
        <TabsList>
          <TabsTrigger value="reviews">Evaluaciones</TabsTrigger>
          <TabsTrigger value="goals">Objetivos</TabsTrigger>
          <TabsTrigger value="analytics">Analítica</TabsTrigger>
        </TabsList>

        <TabsContent value="reviews" className="space-y-4">
          <PerformanceReviewList companyId={companyId} />
        </TabsContent>

        <TabsContent value="goals" className="space-y-4">
          <GoalsList companyId={companyId} />
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Analítica de Desempeño</CardTitle>
              <CardDescription>
                Tendencias reales de evaluación por período
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PerformanceChart companyId={companyId} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}