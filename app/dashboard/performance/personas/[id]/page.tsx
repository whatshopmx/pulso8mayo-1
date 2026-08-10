'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ArrowLeft, Star, Target, FileCheck2, Clock4, Loader2, Eye } from 'lucide-react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface PersonStats {
  user: { id: string; name: string | null; email: string | null } | null;
  stats: {
    reviews: {
      total: number;
      completed: number;
      pending: number;
      completionRate: number;
    };
    goals: {
      total: number;
      completed: number;
      inProgress: number;
      overdue: number;
    };
  };
}

interface ReviewRow {
  id: string;
  reviewType: string;
  reviewPeriod: string;
  reviewDate: string;
  status: string;
  overallRating: number | null;
  reviewerName: string | null;
}

interface GoalRow {
  id: string;
  title: string;
  status: string;
  targetDate: string | null;
  category: string | null;
  userName: string | null;
}

const typeLabels: Record<string, string> = {
  SELF: 'Autoevaluación',
  MANAGER: 'Manager',
  PEER: 'Par',
  '360': '360',
};

const statusLabels: Record<string, string> = {
  DRAFT: 'Borrador',
  IN_PROGRESS: 'En Progreso',
  SUBMITTED: 'Enviado',
  COMPLETED: 'Completado',
  NOT_STARTED: 'No Iniciado',
  CANCELLED: 'Cancelado',
};

export default function PersonPage() {
  const router = useRouter();
  const params = useParams();
  const personId = params.id as string;

  const [person, setPerson] = useState<PersonStats['user']>(null);
  const [kpis, setKpis] = useState<PersonStats['stats'] | null>(null);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const fetchPerson = async () => {
      try {
        setError(false);
        const [statsRes, reviewsRes, goalsRes] = await Promise.all([
          fetch(`/api/performance/stats?userId=${personId}`),
          fetch(`/api/performance/reviews?userId=${personId}&limit=200`),
          fetch(`/api/performance/goals?userId=${personId}&limit=200`),
        ]);

        const statsData = await statsRes.json();
        const reviewsData = await reviewsRes.json();
        const goalsData = await goalsRes.json();

        setPerson(statsData.user || null);
        setKpis(statsData.stats || null);
        setReviews(reviewsData.reviews || []);
        setGoals(goalsData.goals || []);
      } catch (e) {
        console.error('Error fetching person:', e);
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchPerson();
  }, [personId]);

  // Average rating from completed reviews
  const averageRating = useMemo(() => {
    const rated = reviews.filter((r) => r.status === 'COMPLETED' && r.overallRating != null);
    if (!rated.length) return null;
    const sum = rated.reduce((acc, r) => acc + (r.overallRating ?? 0), 0);
    return Math.round((sum / rated.length) * 10) / 10;
  }, [reviews]);

  const isOverdue = (goal: GoalRow) => {
    if (goal.status === 'COMPLETED' || goal.status === 'CANCELLED') return false;
    if (!goal.targetDate) return false;
    return new Date(goal.targetDate).getTime() < Date.now();
  };

  if (loading) {
    return (
      <div className="container mx-auto py-6">
        <div className="flex items-center justify-center h-64 gap-2 text-muted-foreground" role="status" aria-live="polite">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando...
        </div>
      </div>
    );
  }

  if (error || !person) {
    return (
      <div className="container mx-auto py-6">
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <div className="text-muted-foreground">Empleado no encontrado</div>
          <Button variant="outline" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Volver
          </Button>
        </div>
      </div>
    );
  }

  const activeGoals = goals.filter((g) => g.status === 'IN_PROGRESS' || g.status === 'NOT_STARTED');
  const overdueGoals = goals.filter(isOverdue);

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" aria-label="Volver" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold">{person.name || 'Empleado'}</h1>
          <p className="text-muted-foreground">{person.email || 'Equipo'}</p>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <Star className="h-3.5 w-3.5" /> Rating Promedio
            </CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-bold">
              {averageRating != null ? `${averageRating}/5` : '—'}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <Target className="h-3.5 w-3.5" /> Metas Activas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-bold">{activeGoals.length}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <Clock4 className="h-3.5 w-3.5" /> Metas Vencidas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <span className={`text-2xl font-bold ${overdueGoals.length > 0 ? 'text-destructive' : ''}`}>
              {overdueGoals.length}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <FileCheck2 className="h-3.5 w-3.5" /> Evaluaciones Completadas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-bold">
              {kpis?.reviews.completed ?? 0}
            </span>
            <span className="ml-1 text-sm text-muted-foreground">de {kpis?.reviews.total ?? 0}</span>
          </CardContent>
        </Card>
      </div>

      {/* Metas */}
      <Card>
        <CardHeader>
          <CardTitle>Metas</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {goals.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              Sin objetivos asignados
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Objetivo</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead>Fecha Límite</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {goals.map((goal) => {
                  const overdue = isOverdue(goal);
                  return (
                    <TableRow key={goal.id}>
                      <TableCell className="font-medium">{goal.title}</TableCell>
                      <TableCell>
                        {goal.category ? (
                          <Badge variant="outline">{goal.category}</Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {goal.targetDate ? (
                          <span className={overdue ? 'font-medium text-destructive' : undefined}>
                            {format(new Date(goal.targetDate), 'dd MMM yyyy', { locale: es })}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{statusLabels[goal.status] || goal.status}</Badge>
                          {overdue && <Badge variant="destructive">Atrasada</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Ver objetivo: ${goal.title}`}
                          onClick={() => router.push(`/dashboard/performance/goals/${goal.id}`)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Evaluaciones */}
      <Card>
        <CardHeader>
          <CardTitle>Evaluaciones</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {reviews.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              Sin evaluaciones registradas
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Período</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead>Evaluador</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reviews.map((review) => (
                  <TableRow key={review.id}>
                    <TableCell>{review.reviewPeriod}</TableCell>
                    <TableCell>{typeLabels[review.reviewType] || review.reviewType}</TableCell>
                    <TableCell>
                      {format(new Date(review.reviewDate), 'dd MMM yyyy', { locale: es })}
                    </TableCell>
                    <TableCell>
                      {review.overallRating ? (
                        <Badge variant="outline">{review.overallRating}/5</Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>{review.reviewerName || '-'}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{statusLabels[review.status] || review.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Ver evaluación de ${review.reviewPeriod}`}
                        onClick={() => router.push(`/dashboard/performance/reviews/${review.id}`)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Footer action */}
      <div className="flex justify-end">
        <Link
          href={`/dashboard/performance/reviews/new`}
          className="inline-flex"
        >
          <Button>
            Nueva evaluación para {person.name?.split(' ')[0] || 'este empleado'}
          </Button>
        </Link>
      </div>
    </div>
  );
}