'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Eye, Edit, Search, Target, Calendar, Plus, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

interface PerformanceGoal {
  id: string;
  userId: string;
  companyId: string;
  branchId: string | null;
  title: string;
  description: string | null;
  category: string | null;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  targetDate: Date | null;
  completedDate: Date | null;
  metrics: any;
  createdAt: Date;
  updatedAt: Date;
  userName: string | null;
}

interface GoalsListProps {
  companyId: string;
}

export function GoalsList({ companyId }: GoalsListProps) {
  const router = useRouter();
  const [goals, setGoals] = useState<PerformanceGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  useEffect(() => {
    const fetchGoals = async () => {
      try {
        setError(false);
        const params = new URLSearchParams({
          companyId,
          page: page.toString(),
          limit: limit.toString(),
        });

        if (statusFilter !== 'all') params.set('status', statusFilter);
        if (debouncedSearch) params.set('search', debouncedSearch);

        const response = await fetch(`/api/performance/goals?${params}`);
        if (!response.ok) {
          throw new Error(`Request failed: ${response.status}`);
        }
        const data = await response.json();

        setGoals(data.goals || []);
        setTotal(data.pagination?.total || 0);
      } catch (e) {
        console.error('Error fetching goals:', e);
        setError(true);
        setGoals([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    };

    fetchGoals();
  }, [companyId, page, statusFilter, debouncedSearch]);

  // Reset to page 1 when filters or search change
  useEffect(() => {
    setPage(1);
  }, [statusFilter, debouncedSearch]);

  const searching = search !== debouncedSearch;

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      NOT_STARTED: 'outline',
      IN_PROGRESS: 'secondary',
      COMPLETED: 'default',
      CANCELLED: 'destructive',
    };

    const labels: Record<string, string> = {
      NOT_STARTED: 'No Iniciado',
      IN_PROGRESS: 'En Progreso',
      COMPLETED: 'Completado',
      CANCELLED: 'Cancelado',
    };

    return (
      <Badge variant={variants[status] || 'outline'}>
        {labels[status] || status}
      </Badge>
    );
  };

  const isOverdue = (goal: PerformanceGoal) => {
    if (goal.status === 'COMPLETED' || goal.status === 'CANCELLED') return false;
    if (!goal.targetDate) return false;
    return new Date(goal.targetDate).getTime() < Date.now();
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar objetivos..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
                aria-label="Buscar objetivos por título o empleado"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]" aria-label="Filtrar por estado">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                <SelectItem value="NOT_STARTED">No Iniciado</SelectItem>
                <SelectItem value="IN_PROGRESS">En Progreso</SelectItem>
                <SelectItem value="COMPLETED">Completado</SelectItem>
                <SelectItem value="CANCELLED">Cancelado</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading || searching ? (
            <div
              className="flex items-center justify-center gap-2 p-8 text-center text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              {searching ? 'Buscando...' : 'Cargando...'}
            </div>
          ) : error ? (
            <div className="p-8 text-center">
              <p className="text-destructive">No se pudieron cargar los objetivos.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Intenta de nuevo en un momento.
              </p>
            </div>
          ) : goals.length === 0 ? (
            <div className="flex flex-col items-center gap-3 p-8 text-center">
              <p className="text-muted-foreground">No se encontraron objetivos</p>
              <Button onClick={() => router.push('/dashboard/performance/goals/new')}>
                <Plus className="mr-2 h-4 w-4" />
                Nuevo Objetivo
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <div className="flex items-center gap-2">
                      <Target className="h-4 w-4" />
                      Objetivo
                    </div>
                  </TableHead>
                  <TableHead>Empleado</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      Fecha Límite
                    </div>
                  </TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {goals.map((goal) => {
                  const overdue = isOverdue(goal);
                  return (
                    <TableRow key={goal.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{goal.title}</div>
                          {goal.description && (
                            <div className="text-sm text-muted-foreground line-clamp-1">
                              {goal.description}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {goal.userName ? (
                          <Link
                            href={`/dashboard/performance/personas/${goal.userId}`}
                            className="font-medium hover:underline"
                          >
                            {goal.userName}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
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
                          {getStatusBadge(goal.status)}
                          {overdue && (
                            <Badge variant="destructive">Atrasada</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Ver objetivo: ${goal.title}`}
                            onClick={() => router.push(`/dashboard/performance/goals/${goal.id}`)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Editar objetivo: ${goal.title}`}
                            onClick={() => router.push(`/dashboard/performance/goals/${goal.id}/edit`)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
            Mostrando {(page - 1) * limit + 1} a {Math.min(page * limit, total)} de {total} resultados
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}