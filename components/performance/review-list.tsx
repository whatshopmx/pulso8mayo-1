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
import { Eye, Edit, Search, Plus, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

interface PerformanceReview {
  id: string;
  userId: string;
  reviewerId: string;
  reviewType: 'SELF' | 'MANAGER' | 'PEER' | '360';
  reviewPeriod: string;
  reviewDate: Date;
  status: 'DRAFT' | 'IN_PROGRESS' | 'COMPLETED' | 'SUBMITTED';
  overallRating: number | null;
  strengths: string | null;
  areasForImprovement: string | null;
  submittedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  userName: string | null;
  reviewerName: string | null;
}

interface PerformanceReviewListProps {
  companyId: string;
}

export function PerformanceReviewList({ companyId }: PerformanceReviewListProps) {
  const router = useRouter();
  const [reviews, setReviews] = useState<PerformanceReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  useEffect(() => {
    const fetchReviews = async () => {
      try {
        setError(false);
        const params = new URLSearchParams({
          companyId,
          page: page.toString(),
          limit: limit.toString(),
        });

        if (statusFilter !== 'all') params.set('status', statusFilter);
        if (typeFilter !== 'all') params.set('reviewType', typeFilter);
        if (debouncedSearch) params.set('search', debouncedSearch);

        const response = await fetch(`/api/performance/reviews?${params}`);
        if (!response.ok) {
          throw new Error(`Request failed: ${response.status}`);
        }
        const data = await response.json();

        setReviews(data.reviews || []);
        setTotal(data.pagination?.total || 0);
      } catch (e) {
        console.error('Error fetching reviews:', e);
        setError(true);
        setReviews([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    };

    fetchReviews();
  }, [companyId, page, statusFilter, typeFilter, debouncedSearch]);

  // Reset to page 1 when filters or search change
  useEffect(() => {
    setPage(1);
  }, [statusFilter, typeFilter, debouncedSearch]);

  const searching = search !== debouncedSearch;

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      DRAFT: 'outline',
      IN_PROGRESS: 'secondary',
      COMPLETED: 'default',
      SUBMITTED: 'default',
    };

    const labels: Record<string, string> = {
      DRAFT: 'Borrador',
      IN_PROGRESS: 'En Progreso',
      COMPLETED: 'Completado',
      SUBMITTED: 'Enviado',
    };

    return (
      <Badge variant={variants[status] || 'outline'}>
        {labels[status] || status}
      </Badge>
    );
  };

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      SELF: 'Autoevaluación',
      MANAGER: 'Evaluación de Manager',
      PEER: 'Evaluación de Par',
      '360': 'Evaluación 360',
    };
    return labels[type] || type;
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
                placeholder="Buscar por nombre..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
                aria-label="Buscar evaluaciones por nombre"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]" aria-label="Filtrar por estado">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                <SelectItem value="DRAFT">Borrador</SelectItem>
                <SelectItem value="IN_PROGRESS">En Progreso</SelectItem>
                <SelectItem value="COMPLETED">Completado</SelectItem>
                <SelectItem value="SUBMITTED">Enviado</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[180px]" aria-label="Filtrar por tipo">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los tipos</SelectItem>
                <SelectItem value="SELF">Autoevaluación</SelectItem>
                <SelectItem value="MANAGER">Manager</SelectItem>
                <SelectItem value="PEER">Par</SelectItem>
                <SelectItem value="360">360</SelectItem>
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
              <p className="text-destructive">No se pudieron cargar las evaluaciones.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Intenta de nuevo en un momento.
              </p>
            </div>
          ) : reviews.length === 0 ? (
            <div className="flex flex-col items-center gap-3 p-8 text-center">
              <p className="text-muted-foreground">No se encontraron evaluaciones</p>
              <Button onClick={() => router.push('/dashboard/performance/reviews/new')}>
                <Plus className="mr-2 h-4 w-4" />
                Nueva Evaluación
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empleado</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Período</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reviews.map((review) => (
                  <TableRow key={review.id}>
                    <TableCell>
                      <Link
                        href={`/dashboard/performance/personas/${review.userId}`}
                        className="font-medium hover:underline"
                      >
                        {review.userName || 'N/A'}
                      </Link>
                    </TableCell>
                    <TableCell>{getTypeLabel(review.reviewType)}</TableCell>
                    <TableCell>{review.reviewPeriod}</TableCell>
                    <TableCell>
                      {format(new Date(review.reviewDate), 'dd MMM yyyy', { locale: es })}
                    </TableCell>
                    <TableCell>
                      {review.overallRating ? (
                        <Badge variant="outline">
                          {review.overallRating}/5
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>{getStatusBadge(review.status)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Ver evaluación de ${review.userName || 'empleado'}`}
                          onClick={() => router.push(`/dashboard/performance/reviews/${review.id}`)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Editar evaluación de ${review.userName || 'empleado'}`}
                          onClick={() => router.push(`/dashboard/performance/reviews/${review.id}/edit`)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
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