'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Save, Loader2, Target } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';

interface GoalFormProps {
  companyId: string;
  goalId?: string;
  initialData?: any;
}

interface Employee {
  id: string;
  name: string;
  email: string;
  branchId: string | null;
}

export function GoalForm({ companyId, goalId, initialData }: GoalFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const [formData, setFormData] = useState({
    // No default assignee on create: a goal must be attributed deliberately.
    // Defaulting to the logged-in user was how goals silently landed on their
    // creator. On edit the current assignee comes from the record.
    userId: initialData?.userId || '',
    // Derived from the assignee — never asked for directly. Sent to the API
    // only when known, because the schema validates it as a uuid.
    branchId: initialData?.branchId || '',
    title: initialData?.title || '',
    description: initialData?.description || '',
    category: initialData?.category || '',
    targetDate: initialData?.targetDate
      ? new Date(initialData.targetDate).toISOString().split('T')[0]
      : '',
    status: initialData?.status || 'NOT_STARTED',
  });

  useEffect(() => {
    const fetchEmployees = async () => {
      try {
        const res = await fetch(`/api/employees?limit=100`);
        if (res.ok) {
          const data = await res.json();
          // `/api/employees` returns `{ success, data, pagination }`.
          setEmployees((data.data || []).map((e: any) => ({
            id: e.userId || e.id,
            name: e.userName || e.name || 'Sin nombre',
            email: e.userEmail || e.email || '',
            branchId: e.branchId ?? null,
          })));
        }
      } catch (e) {
        console.error('Error fetching employees:', e);
      }
    };

    fetchEmployees();
  }, []);

  const handleAssignChange = (assigneeId: string) => {
    const employee = employees.find((e) => e.id === assigneeId);
    setFormData(prev => ({
      ...prev,
      userId: assigneeId,
      branchId: employee?.branchId ?? '',
    }));
  };

  const handleSubmit = async () => {
    if (!formData.title.trim()) {
      toast({ title: 'Error', description: 'El título es requerido', variant: 'destructive' });
      return;
    }
    if (!formData.userId) {
      toast({
        title: 'Error',
        description: 'Selecciona el empleado al que se asigna el objetivo',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const url = goalId
        ? `/api/performance/goals?id=${goalId}`
        : '/api/performance/goals';
      const method = goalId ? 'PATCH' : 'POST';

      const { branchId, ...rest } = formData;
      const body = {
        ...rest,
        ...(branchId ? { branchId } : {}),
        companyId,
      };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        toast({
          title: goalId ? 'Objetivo actualizado' : 'Objetivo creado',
          description: goalId
            ? 'El objetivo se actualizó correctamente'
            : 'El objetivo se creó exitosamente',
        });
        router.push('/dashboard/performance');
        router.refresh();
      } else {
        const error = await res.json();
        toast({ title: 'Error', description: error.error || 'Error al guardar', variant: 'destructive' });
      }
    } catch (e) {
      console.error('Error saving goal:', e);
      toast({ title: 'Error', description: 'Error de conexión', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const categories = [
    'Productividad',
    'Calidad',
    'Liderazgo',
    'Aprendizaje',
    'Colaboración',
    'Innovación',
    'Servicio al Cliente',
    'Ventas',
    'Operaciones',
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            {goalId ? 'Editar Objetivo' : 'Nuevo Objetivo'}
          </CardTitle>
          <CardDescription>
            Define un objetivo de desempeño con métricas claras y fecha límite
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="assignee">Empleado *</Label>
            <Select value={formData.userId} onValueChange={handleAssignChange}>
              <SelectTrigger id="assignee">
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
            <p className="text-xs text-muted-foreground">
              El objetivo se asigna a esta persona y hereda su sucursal.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">Título del Objetivo *</Label>
            <Input
              id="title"
              placeholder="Ej: Mejorar la tasa de retención de clientes en un 15%"
              value={formData.title}
              onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descripción</Label>
            <Textarea
              id="description"
              placeholder="Describe el objetivo en detalle, incluyendo métricas y KPIs esperados..."
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              rows={4}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="category">Categoría</Label>
              <Select
                value={formData.category}
                onValueChange={(v) => setFormData(prev => ({ ...prev, category: v }))}
              >
                <SelectTrigger id="category">
                  <SelectValue placeholder="Seleccionar categoría" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="targetDate">Fecha Límite</Label>
              <Input
                id="targetDate"
                type="date"
                value={formData.targetDate}
                onChange={(e) => setFormData(prev => ({ ...prev, targetDate: e.target.value }))}
              />
            </div>

            {goalId && (
              <div className="space-y-2">
                <Label htmlFor="status">Estado</Label>
                <Select
                  value={formData.status}
                  onValueChange={(v) => setFormData(prev => ({ ...prev, status: v }))}
                >
                  <SelectTrigger id="status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NOT_STARTED">No Iniciado</SelectItem>
                    <SelectItem value="IN_PROGRESS">En Progreso</SelectItem>
                    <SelectItem value="COMPLETED">Completado</SelectItem>
                    <SelectItem value="CANCELLED">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => router.back()} disabled={loading}>
          Cancelar
        </Button>
        <Button onClick={handleSubmit} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          {goalId ? 'Actualizar Objetivo' : 'Crear Objetivo'}
        </Button>
      </div>
    </div>
  );
}
