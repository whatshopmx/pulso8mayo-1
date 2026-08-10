'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Star,
  ArrowLeft,
  Send,
  CheckCircle,
  Clock,
  User,
  Calendar,
  ThumbsUp,
  Target,
  ClipboardList,
  MessageSquare,
} from 'lucide-react';
import { useRouter, useParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface ReviewDetail {
  id: string;
  userId: string;
  userName: string | null;
  reviewerId: string;
  reviewerName: string | null;
  reviewType: string;
  reviewPeriod: string;
  reviewDate: string;
  status: string;
  overallRating: number | null;
  strengths: string | null;
  areasForImprovement: string | null;
  developmentPlan: string | null;
  comments: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface CriteriaResponse {
  id: string;
  criteriaId: string;
  rating: number;
  comments: string | null;
  name: string | null;
  category: string | null;
  weight: number | null;
}

const FILLED_STAR = 'fill-chart-1 text-chart-1';
const EMPTY_STAR = 'fill-transparent text-muted-foreground';

export default function ReviewDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { toast } = useToast();
  const [review, setReview] = useState<ReviewDetail | null>(null);
  const [criteria, setCriteria] = useState<CriteriaResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const reviewId = params.id as string;

  useEffect(() => {
    const fetchReview = async () => {
      try {
        const res = await fetch(`/api/performance/reviews?id=${reviewId}`);
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        if (!res.ok) {
          throw new Error(`Request failed: ${res.status}`);
        }
        const data = await res.json();
        setReview(data.review || null);
        setCriteria(Array.isArray(data.criteria) ? data.criteria : []);
      } catch (e) {
        console.error('Error fetching review:', e);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };

    fetchReview();
  }, [reviewId]);

  const handleStatusChange = async (newStatus: string) => {
    try {
      const res = await fetch(`/api/performance/reviews?id=${reviewId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (res.ok) {
        toast({ title: 'Estado actualizado', description: `Evaluación marcada como ${statusLabels[newStatus] || newStatus}` });
        // Refresh data
        const data = await res.json();
        setReview(prev => prev ? { ...prev, ...data.review } : null);
      }
    } catch (e) {
      toast({ title: 'Error', description: 'No se pudo actualizar el estado', variant: 'destructive' });
    }
  };

  const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: any }> = {
    DRAFT: { label: 'Borrador', variant: 'outline', icon: Clock },
    IN_PROGRESS: { label: 'En Progreso', variant: 'secondary', icon: Clock },
    SUBMITTED: { label: 'Enviado', variant: 'default', icon: Send },
    COMPLETED: { label: 'Completado', variant: 'default', icon: CheckCircle },
  };

  const statusLabels: Record<string, string> = {
    DRAFT: 'Borrador',
    IN_PROGRESS: 'En Progreso',
    SUBMITTED: 'Enviada',
    COMPLETED: 'Completada',
  };

  const typeLabels: Record<string, string> = {
    SELF: 'Autoevaluación',
    MANAGER: 'Evaluación de Manager',
    PEER: 'Evaluación de Par',
    '360': 'Evaluación 360',
  };

  const categoryLabels: Record<string, string> = {
    TECHNICAL: 'Técnico',
    SOFT_SKILLS: 'Habilidades Blandas',
    LEADERSHIP: 'Liderazgo',
    COMMUNICATION: 'Comunicación',
    PROBLEM_SOLVING: 'Resolución de Problemas',
    TEAMWORK: 'Trabajo en Equipo',
  };

  // Weighted average from criteria responses (mirrors server logic)
  const weightedAverage = (() => {
    if (!criteria.length) return null;
    let totalWeight = 0;
    let sum = 0;
    for (const c of criteria) {
      const w = c.weight || 1;
      totalWeight += w;
      sum += c.rating * w;
    }
    return totalWeight > 0 ? Math.round((sum / totalWeight) * 10) / 10 : null;
  })();

  if (loading) {
    return (
      <div className="container mx-auto py-6">
        <div className="flex items-center justify-center h-64" role="status" aria-live="polite">
          <div className="text-muted-foreground">Cargando evaluación...</div>
        </div>
      </div>
    );
  }

  if (notFound || !review) {
    return (
      <div className="container mx-auto py-6">
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <div className="text-muted-foreground">Evaluación no encontrada</div>
          <Button variant="outline" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Volver
          </Button>
        </div>
      </div>
    );
  }

  const statusInfo = statusConfig[review.status] || statusConfig.DRAFT;
  const StatusIcon = statusInfo.icon;

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" aria-label="Volver" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Evaluación de Desempeño</h1>
            <p className="text-muted-foreground">
              {typeLabels[review.reviewType] || review.reviewType} — {review.reviewPeriod}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusInfo.variant} className="flex items-center gap-1">
            <StatusIcon className="h-3 w-3" />
            {statusInfo.label}
          </Badge>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Empleado</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{review.userName || 'N/A'}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Evaluador</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{review.reviewerName || 'N/A'}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Fecha</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">
                {format(new Date(review.reviewDate), 'dd MMM yyyy', { locale: es })}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {criteria.length ? 'Calificación Ponderada' : 'Calificación General'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  className={`h-5 w-5 ${star <= Math.round(weightedAverage ?? review.overallRating ?? 0)
                    ? FILLED_STAR
                    : EMPTY_STAR
                    }`}
                />
              ))}
              <span className="ml-2 font-bold text-lg">
                {weightedAverage ?? review.overallRating ? `${weightedAverage ?? review.overallRating}/5` : '-'}
              </span>
            </div>
            {criteria.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1">promedio ponderado de criterios</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Criteria Card */}
      {criteria.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Criterios de Evaluación</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {criteria.map((c) => (
              <div key={c.id} className="border rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">{c.name || 'Criterio'}</div>
                  <div className="flex items-center gap-2 shrink-0">
                    {c.category && (
                      <Badge variant="outline">{categoryLabels[c.category] || c.category}</Badge>
                    )}
                    {(c.weight ?? 1) > 1 && (
                      <Badge variant="secondary">Peso {c.weight}</Badge>
                    )}
                    <Badge variant={c.rating >= 4 ? 'default' : c.rating === 3 ? 'secondary' : 'destructive'}>
                      {c.rating}/5
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-1" aria-label={`Calificación: ${c.rating} de 5`}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      className={`h-4 w-4 ${star <= c.rating ? FILLED_STAR : EMPTY_STAR}`}
                    />
                  ))}
                </div>
                {c.comments && (
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{c.comments}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Assessment Details */}
      <div className="grid gap-6 md:grid-cols-2">
        {review.strengths && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-success">
                <ThumbsUp className="h-4 w-4" />
                Fortalezas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap">{review.strengths}</p>
            </CardContent>
          </Card>
        )}

        {review.areasForImprovement && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-warning-text">
                <Target className="h-4 w-4" />
                Áreas de Mejora
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap">{review.areasForImprovement}</p>
            </CardContent>
          </Card>
        )}
      </div>

      {review.developmentPlan && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4" />
              Plan de Desarrollo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap">{review.developmentPlan}</p>
          </CardContent>
        </Card>
      )}

      {review.comments && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Comentarios
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap">{review.comments}</p>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <Separator />
      <div className="flex justify-end gap-3">
        {review.status === 'DRAFT' && (
          <>
            <Button variant="outline" onClick={() => handleStatusChange('IN_PROGRESS')}>
              Marcar En Progreso
            </Button>
            <Button onClick={() => handleStatusChange('SUBMITTED')}>
              <Send className="mr-2 h-4 w-4" /> Enviar Evaluación
            </Button>
          </>
        )}
        {review.status === 'IN_PROGRESS' && (
          <Button onClick={() => handleStatusChange('SUBMITTED')}>
            <Send className="mr-2 h-4 w-4" /> Enviar Evaluación
          </Button>
        )}
        {review.status === 'SUBMITTED' && (
          <Button onClick={() => handleStatusChange('COMPLETED')}>
            <CheckCircle className="mr-2 h-4 w-4" /> Marcar como Completada
          </Button>
        )}
      </div>
    </div>
  );
}