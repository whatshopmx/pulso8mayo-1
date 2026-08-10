'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Star, Save, Send, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';

interface ReviewFormProps {
  companyId: string;
  userId: string;
  reviewId?: string; // If editing
  initialData?: any;
}

interface Employee {
  id: string;
  name: string;
  email: string;
}

interface Criteria {
  id: string;
  name: string;
  description: string | null;
  category: string;
  weight: number;
}

interface CriteriaResponse {
  criteriaId: string;
  rating: number;
  comments?: string;
}

const FILLED_STAR = 'fill-chart-1 text-chart-1';
const EMPTY_STAR = 'fill-transparent text-muted-foreground';

export function ReviewForm({ companyId, userId, reviewId, initialData }: ReviewFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [criteria, setCriteria] = useState<Criteria[]>([]);

  // Seed criteria ratings from initial data when editing
  const initialResponses = useMemo(() => {
    const responses: Record<string, { rating: number; comments: string }> = {};
    const source = initialData?.criteriaResponses;
    if (Array.isArray(source)) {
      for (const r of source) {
        if (r?.criteriaId && r?.rating) {
          responses[r.criteriaId] = { rating: r.rating, comments: r.comments || '' };
        }
      }
    }
    return responses;
  }, [initialData]);

  const [criteriaRatings, setCriteriaRatings] = useState<Record<string, { rating: number; comments: string }>>(initialResponses);

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth(); // 0-based
  const currentQuarter = `${currentYear}-Q${Math.floor(currentMonth / 3) + 1}`;

  const [formData, setFormData] = useState({
    userId: initialData?.userId || '',
    reviewerId: initialData?.reviewerId || userId,
    reviewType: initialData?.reviewType || 'MANAGER',
    reviewPeriod: initialData?.reviewPeriod || currentQuarter,
    overallRating: initialData?.overallRating || 0,
    strengths: initialData?.strengths || '',
    areasForImprovement: initialData?.areasForImprovement || '',
    developmentPlan: initialData?.developmentPlan || '',
    comments: initialData?.comments || '',
  });

  useEffect(() => {
    // Fetch employees for selection
    const fetchEmployees = async () => {
      try {
        const res = await fetch(`/api/employees?companyId=${companyId}&limit=100`);
        if (res.ok) {
          const data = await res.json();
          setEmployees(data.employees?.map((e: any) => ({
            id: e.userId || e.id,
            name: e.userName || e.name || 'Sin nombre',
            email: e.userEmail || e.email || '',
          })) || []);
        }
      } catch (e) {
        console.error('Error fetching employees:', e);
      }
    };

    // Fetch evaluation criteria
    const fetchCriteria = async () => {
      try {
        const res = await fetch(`/api/performance/criteria?companyId=${companyId}`);
        if (res.ok) {
          const data = await res.json();
          setCriteria(data.criteria || []);
        }
      } catch (e) {
        console.error('Error fetching criteria:', e);
      }
    };

    fetchEmployees();
    fetchCriteria();
  }, [companyId]);

  const handleRatingClick = (criteriaId: string, rating: number) => {
    setCriteriaRatings(prev => ({
      ...prev,
      [criteriaId]: { ...prev[criteriaId], rating, comments: prev[criteriaId]?.comments || '' },
    }));
  };

  // Live weighted average (same formula the server applies)
  const weightedPreview = useMemo(() => {
    const entries = Object.entries(criteriaRatings).filter(([, v]) => v.rating > 0);
    if (!entries.length || !criteria.length) return null;

    const weightMap = new Map(criteria.map((c) => [c.id, c.weight || 1]));
    let totalWeight = 0;
    let sum = 0;
    for (const [criteriaId, v] of entries) {
      const w = weightMap.get(criteriaId) ?? 1;
      totalWeight += w;
      sum += v.rating * w;
    }
    return totalWeight > 0 ? Math.round((sum / totalWeight) * 10) / 10 : null;
  }, [criteriaRatings, criteria]);

  const hasCriteriaRatings = Object.values(criteriaRatings).some((v) => v.rating > 0);

  const handleSubmit = async (status: 'DRAFT' | 'SUBMITTED') => {
    if (!formData.userId) {
      toast({ title: 'Error', description: 'Selecciona un empleado a evaluar', variant: 'destructive' });
      return;
    }
    if (!formData.reviewPeriod) {
      toast({ title: 'Error', description: 'Selecciona un período de evaluación', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const url = reviewId
        ? `/api/performance/reviews?id=${reviewId}`
        : '/api/performance/reviews';
      const method = reviewId ? 'PATCH' : 'POST';

      const criteriaRatingsPayload: CriteriaResponse[] = Object.entries(criteriaRatings)
        .filter(([, v]) => v.rating > 0)
        .map(([criteriaId, v]) => ({
          criteriaId,
          rating: v.rating,
          comments: v.comments || undefined,
        }));

      // overallRating 0 means "unrated" — omit so zod's min(1) passes;
      // the server computes the weighted rating when criteria exist.
      const { overallRating, ...rest } = formData;
      const body = {
        ...rest,
        ...(overallRating > 0 ? { overallRating } : {}),
        companyId,
        status,
        ...(criteriaRatingsPayload.length ? { criteriaRatings: criteriaRatingsPayload } : {}),
      };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        toast({
          title: status === 'DRAFT' ? 'Borrador guardado' : 'Evaluación enviada',
          description: status === 'DRAFT'
            ? 'La evaluación se guardó como borrador'
            : 'La evaluación fue enviada exitosamente',
        });
        router.push('/dashboard/performance');
        router.refresh();
      } else {
        const error = await res.json();
        toast({ title: 'Error', description: error.error || 'Error al guardar', variant: 'destructive' });
      }
    } catch (e) {
      console.error('Error saving review:', e);
      toast({ title: 'Error', description: 'Error de conexión', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const periods = [
    `${currentYear}-Q1`, `${currentYear}-Q2`, `${currentYear}-Q3`, `${currentYear}-Q4`,
    `${currentYear}-H1`, `${currentYear}-H2`,
    `${currentYear}-ANNUAL`,
  ];

  const categoryLabels: Record<string, string> = {
    TECHNICAL: 'Técnico',
    SOFT_SKILLS: 'Habilidades Blandas',
    LEADERSHIP: 'Liderazgo',
    COMMUNICATION: 'Comunicación',
    PROBLEM_SOLVING: 'Resolución de Problemas',
    TEAMWORK: 'Trabajo en Equipo',
  };

  const renderStars = (current: number, onSelect: (value: number) => void, size = 'h-6 w-6') => (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Calificación de 1 a 5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={current === star}
          aria-label={`${star} de 5 estrellas`}
          onClick={() => onSelect(star)}
          className="rounded-sm p-1 transition-colors focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Star
            className={`${size} ${star <= current ? FILLED_STAR : EMPTY_STAR}`}
          />
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Basic Info */}
      <Card>
        <CardHeader>
          <CardTitle>Información de la Evaluación</CardTitle>
          <CardDescription>Configura los datos básicos de la evaluación de desempeño</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="employee">Empleado a Evaluar</Label>
              <Select
                value={formData.userId}
                onValueChange={(v) => setFormData(prev => ({ ...prev, userId: v }))}
              >
                <SelectTrigger id="employee">
                  <SelectValue placeholder="Seleccionar empleado" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {emp.name} ({emp.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="type">Tipo de Evaluación</Label>
              <Select
                value={formData.reviewType}
                onValueChange={(v) => setFormData(prev => ({ ...prev, reviewType: v }))}
              >
                <SelectTrigger id="type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SELF">Autoevaluación</SelectItem>
                  <SelectItem value="MANAGER">Evaluación de Manager</SelectItem>
                  <SelectItem value="PEER">Evaluación de Par</SelectItem>
                  <SelectItem value="360">Evaluación 360</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="period">Período</Label>
              <Select
                value={formData.reviewPeriod}
                onValueChange={(v) => setFormData(prev => ({ ...prev, reviewPeriod: v }))}
              >
                <SelectTrigger id="period">
                  <SelectValue placeholder="Seleccionar período" />
                </SelectTrigger>
                <SelectContent>
                  {periods.map((period) => (
                    <SelectItem key={period} value={period}>{period}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="overall-rating">Calificación General</Label>
              {hasCriteriaRatings && weightedPreview !== null ? (
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-2xl font-bold">{weightedPreview}/5</span>
                  <span className="text-sm text-muted-foreground">
                    promedio ponderado de criterios
                  </span>
                </div>
              ) : (
                <>
                  {renderStars(formData.overallRating, (star) =>
                    setFormData(prev => ({ ...prev, overallRating: star }))
                  )}
                  <span className="ml-2 text-sm text-muted-foreground">
                    {formData.overallRating > 0 ? `${formData.overallRating}/5` : 'Sin calificar'}
                  </span>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Criteria Ratings */}
      {criteria.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Criterios de Evaluación</CardTitle>
            <CardDescription>Califica cada criterio de 1 a 5 estrellas</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {criteria.map((c) => (
              <div key={c.id} className="border rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{c.name}</div>
                    {c.description && (
                      <div className="text-sm text-muted-foreground">{c.description}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{categoryLabels[c.category] || c.category}</Badge>
                    {c.weight > 1 && (
                      <Badge variant="secondary">Peso {c.weight}</Badge>
                    )}
                  </div>
                </div>
                {renderStars(criteriaRatings[c.id]?.rating || 0, (star) => handleRatingClick(c.id, star), 'h-5 w-5')}
                <Input
                  placeholder="Comentario sobre este criterio..."
                  value={criteriaRatings[c.id]?.comments || ''}
                  onChange={(e) => setCriteriaRatings(prev => ({
                    ...prev,
                    [c.id]: { ...prev[c.id], rating: prev[c.id]?.rating || 0, comments: e.target.value },
                  }))}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Assessment Details */}
      <Card>
        <CardHeader>
          <CardTitle>Evaluación Detallada</CardTitle>
          <CardDescription>Documenta las fortalezas, áreas de mejora y plan de desarrollo</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="strengths">Fortalezas</Label>
            <Textarea
              id="strengths"
              placeholder="Describe las principales fortalezas del empleado..."
              value={formData.strengths}
              onChange={(e) => setFormData(prev => ({ ...prev, strengths: e.target.value }))}
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="improvements">Áreas de Mejora</Label>
            <Textarea
              id="improvements"
              placeholder="Identifica áreas donde el empleado puede mejorar..."
              value={formData.areasForImprovement}
              onChange={(e) => setFormData(prev => ({ ...prev, areasForImprovement: e.target.value }))}
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="devplan">Plan de Desarrollo</Label>
            <Textarea
              id="devplan"
              placeholder="Describe el plan de desarrollo propuesto..."
              value={formData.developmentPlan}
              onChange={(e) => setFormData(prev => ({ ...prev, developmentPlan: e.target.value }))}
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="comments">Comentarios Adicionales</Label>
            <Textarea
              id="comments"
              placeholder="Cualquier comentario adicional..."
              value={formData.comments}
              onChange={(e) => setFormData(prev => ({ ...prev, comments: e.target.value }))}
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => router.back()} disabled={loading}>
          Cancelar
        </Button>
        <Button variant="secondary" onClick={() => handleSubmit('DRAFT')} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Guardar Borrador
        </Button>
        <Button onClick={() => handleSubmit('SUBMITTED')} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          Enviar Evaluación
        </Button>
      </div>
    </div>
  );
}