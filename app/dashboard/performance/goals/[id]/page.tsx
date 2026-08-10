'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ArrowLeft, Target, Calendar, Trash2, CheckCircle, Pencil } from 'lucide-react';
import { useRouter, useParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface GoalDetail {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  category: string | null;
  status: string;
  targetDate: string | null;
  completedDate: string | null;
  metrics: any;
  createdAt: string;
  updatedAt: string;
  userName: string | null;
}

type PendingAction = 'delete' | 'cancel' | null;

export default function GoalDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { toast } = useToast();
  const [goal, setGoal] = useState<GoalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const goalId = params.id as string;

  useEffect(() => {
    const fetchGoal = async () => {
      try {
        const res = await fetch(`/api/performance/goals?id=${goalId}`);
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        if (!res.ok) {
          throw new Error(`Request failed: ${res.status}`);
        }
        const data = await res.json();
        setGoal(data.goal || null);
      } catch (e) {
        console.error('Error fetching goal:', e);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };

    fetchGoal();
  }, [goalId]);

  const handleStatusChange = async (newStatus: string) => {
    try {
      const res = await fetch(`/api/performance/goals?id=${goalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (res.ok) {
        const data = await res.json();
        setGoal(prev => prev ? { ...prev, ...data.goal } : null);
        toast({ title: 'Estado actualizado', description: statusLabels[newStatus] || newStatus });
      }
    } catch (e) {
      toast({ title: 'Error', description: 'No se pudo actualizar', variant: 'destructive' });
    } finally {
      setPendingAction(null);
    }
  };

  const handleDelete = async () => {
    try {
      const res = await fetch(`/api/performance/goals?id=${goalId}`, { method: 'DELETE' });
      if (res.ok) {
        toast({ title: 'Objetivo eliminado' });
        router.push('/dashboard/performance/goals');
      }
    } catch (e) {
      toast({ title: 'Error', description: 'No se pudo eliminar', variant: 'destructive' });
    } finally {
      setPendingAction(null);
    }
  };

  const statusLabels: Record<string, string> = {
    NOT_STARTED: 'No Iniciado',
    IN_PROGRESS: 'En Progreso',
    COMPLETED: 'Completado',
    CANCELLED: 'Cancelado',
  };

  const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; color: string }> = {
    NOT_STARTED: { label: 'No Iniciado', variant: 'outline', color: 'text-gray-500' },
    IN_PROGRESS: { label: 'En Progreso', variant: 'secondary', color: 'text-blue-500' },
    COMPLETED: { label: 'Completado', variant: 'default', color: 'text-green-500' },
    CANCELLED: { label: 'Cancelado', variant: 'destructive', color: 'text-red-500' },
  };

  const getProgressValue = (status: string) => {
    switch (status) {
      case 'NOT_STARTED': return 0;
      case 'IN_PROGRESS': return 50;
      case 'COMPLETED': return 100;
      case 'CANCELLED': return 0;
      default: return 0;
    }
  };

  const isOverdue = (() => {
    if (!goal) return false;
    if (goal.status === 'COMPLETED' || goal.status === 'CANCELLED') return false;
    if (!goal.targetDate) return false;
    return new Date(goal.targetDate).getTime() < Date.now();
  })();

  if (loading) {
    return (
      <div className="container mx-auto py-6">
        <div className="flex items-center justify-center h-64" role="status" aria-live="polite">
          <div className="text-muted-foreground">Cargando objetivo...</div>
        </div>
      </div>
    );
  }

  if (notFound || !goal) {
    return (
      <div className="container mx-auto py-6">
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <div className="text-muted-foreground">Objetivo no encontrado</div>
          <Button variant="outline" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Volver
          </Button>
        </div>
      </div>
    );
  }

  const si = statusConfig[goal.status] || statusConfig.NOT_STARTED;

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" aria-label="Volver" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Target className="h-7 w-7" />
              {goal.title}
            </h1>
            <p className="text-muted-foreground">{goal.userName || 'Empleado'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={si.variant}>{si.label}</Badge>
          {isOverdue && (
            <Badge variant="destructive">Atrasada</Badge>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Editar objetivo"
            onClick={() => router.push(`/dashboard/performance/goals/${goal.id}/edit`)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Eliminar objetivo"
            onClick={() => setPendingAction('delete')}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>

      {/* Progress */}
      <Card>
        <CardHeader>
          <CardTitle>Progreso</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Progress value={getProgressValue(goal.status)} className="h-3" />
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>Creado: {format(new Date(goal.createdAt), 'dd MMM yyyy', { locale: es })}</span>
            {goal.targetDate && (
              <span className={`flex items-center gap-1 ${isOverdue ? 'font-medium text-destructive' : ''}`}>
                <Calendar className="h-3 w-3" />
                Meta: {format(new Date(goal.targetDate), 'dd MMM yyyy', { locale: es })}
              </span>
            )}
            {goal.completedDate && (
              <span className="text-green-600">
                Completado: {format(new Date(goal.completedDate), 'dd MMM yyyy', { locale: es })}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Details */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Detalles</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {goal.description && (
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">Descripción</div>
                <p className="whitespace-pre-wrap">{goal.description}</p>
              </div>
            )}
            {goal.category && (
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">Categoría</div>
                <Badge variant="outline">{goal.category}</Badge>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Acciones Rápidas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {goal.status === 'NOT_STARTED' && (
              <Button className="w-full" onClick={() => handleStatusChange('IN_PROGRESS')}>
                Iniciar Objetivo
              </Button>
            )}
            {goal.status === 'IN_PROGRESS' && (
              <Button className="w-full" onClick={() => handleStatusChange('COMPLETED')}>
                <CheckCircle className="mr-2 h-4 w-4" /> Marcar como Completado
              </Button>
            )}
            {(goal.status === 'NOT_STARTED' || goal.status === 'IN_PROGRESS') && (
              <Button
                variant="destructive"
                className="w-full"
                onClick={() => setPendingAction('cancel')}
              >
                Cancelar Objetivo
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      <Separator />

      {/* Confirmation dialogs */}
      <AlertDialog
        open={pendingAction !== null}
        onOpenChange={(open) => { if (!open) setPendingAction(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction === 'delete' ? '¿Eliminar este objetivo?' : '¿Cancelar este objetivo?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction === 'delete'
                ? 'Esta acción no se puede deshacer. El objetivo se eliminará permanentemente.'
                : 'El objetivo quedará marcado como cancelado. Podrás crear uno nuevo si lo necesitas.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, volver</AlertDialogCancel>
            <AlertDialogAction
              variant={pendingAction === 'delete' ? 'destructive' : 'default'}
              onClick={() => {
                if (pendingAction === 'delete') {
                  handleDelete();
                } else if (pendingAction === 'cancel') {
                  handleStatusChange('CANCELLED');
                }
              }}
            >
              {pendingAction === 'delete' ? 'Sí, eliminar' : 'Sí, cancelar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}