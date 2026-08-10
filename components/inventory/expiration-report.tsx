'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { AlertTriangle, Calendar, Download, Package } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';
import { MetricCard, MetricGrid } from "@/components/ui/metric-card";
import { useExportCsv } from "@/components/shared/use-export-csv";

interface ExpirationItem {
  itemId: string;
  itemName: string;
  batchId: string;
  lotNumber: string;
  currentQuantity: number;
  expirationDate: Date;
  daysUntilExpiration: number;
  branchName: string;
  unit: string;
}

interface ExpirationSummary {
  totalItems: number;
  expiringSoon: number;
  alreadyExpired: number;
  estimatedLoss: number;
}

interface ExpirationReportProps {
  branchId?: string;
}

export function ExpirationReport({ branchId }: ExpirationReportProps) {
  const [items, setItems] = useState<ExpirationItem[]>([]);
  const [summary, setSummary] = useState<ExpirationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [daysAhead, setDaysAhead] = useState('7');
  const [includeExpired, setIncludeExpired] = useState(false);
  const { exportToCsv } = useExportCsv();

  useEffect(() => {
    fetchExpirations();
  }, [branchId, daysAhead, includeExpired]);

  const fetchExpirations = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        daysAhead,
        includeExpired: includeExpired.toString(),
        ...(branchId && { branchId }),
      });

      const response = await fetch(`/api/inventory/expirations?${params}`);
      if (response.ok) {
        const data = await response.json();
        setItems(data.items);
        setSummary(data.summary);
      }
    } catch (error) {
      console.error('Error fetching expirations:', error);
      toast.error('Error al cargar reporte de vencimientos');
    } finally {
      setLoading(false);
    }
  };

  const exportToCSV = () => {
    exportToCsv({
      headers: ['Producto', 'Lote', 'Cantidad', 'Unidad', 'Vencimiento', 'Días Restantes', 'Sucursal'],
      rows: items.map(item => [
        item.itemName,
        item.lotNumber,
        item.currentQuantity,
        item.unit,
        new Date(item.expirationDate).toLocaleDateString('es-MX'),
        item.daysUntilExpiration,
        item.branchName,
      ]),
      filename: 'vencimientos',
    });
  };

  const getDaysBadge = (days: number) => {
    if (days < 0) {
      return (
        <Badge variant="destructive">
          Vencido hace {Math.abs(days)} días
        </Badge>
      );
    }
    if (days === 0) {
      return <Badge variant="destructive">Vence hoy</Badge>;
    }
    if (days <= 7) {
      return (
        <Badge variant="destructive">
          {days} días
        </Badge>
      );
    }
    if (days <= 14) {
      return (
        <Badge variant="warning">
          {days} días
        </Badge>
      );
    }
    return (
      <Badge variant="secondary">
        {days} días
      </Badge>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <p className="text-muted-foreground">Cargando reporte de vencimientos...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      {summary && (
        <MetricGrid columns={4}>
          <MetricCard
            label="Total Productos"
            value={summary.totalItems}
            icon={<Package className="h-4 w-4" />}
            subtitle="Próximos a vencer"
          />
          <MetricCard
            label="Vencen Pronto"
            value={summary.expiringSoon}
            icon={<Calendar className="h-4 w-4" />}
            subtitle="En los próximos 7 días"
            tone="warning"
          />
          <MetricCard
            label="Ya Vencidos"
            value={summary.alreadyExpired}
            icon={<AlertTriangle className="h-4 w-4" />}
            subtitle="Requieren acción inmediata"
            tone="destructive"
          />
          <MetricCard
            label="Pérdida Estimada"
            value={`$${summary.estimatedLoss.toFixed(2)}`}
            icon={<Package className="h-4 w-4" />}
            subtitle="Valor del inventario en riesgo"
          />
        </MetricGrid>
      )}

      {/* Filters */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Reporte de Vencimientos</CardTitle>
              <CardDescription>
                Inventario próximo a vencer ordenado por fecha de caducidad (FIFO)
              </CardDescription>
            </div>
            <Button onClick={exportToCSV} variant="outline" size="sm">
              <Download className="h-4 w-4 mr-2" />
              Exportar CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-4">
            <div className="flex-1">
              <label className="text-sm font-medium mb-2 block">Rango de días</label>
              <Select value={daysAhead} onValueChange={setDaysAhead}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Próximos 7 días</SelectItem>
                  <SelectItem value="14">Próximos 14 días</SelectItem>
                  <SelectItem value="30">Próximos 30 días</SelectItem>
                  <SelectItem value="90">Próximos 90 días</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1">
              <label className="text-sm font-medium mb-2 block">Incluir vencidos</label>
              <Select
                value={includeExpired.toString()}
                onValueChange={(v) => setIncludeExpired(v === 'true')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="false">No incluir</SelectItem>
                  <SelectItem value="true">Incluir vencidos</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Expiration Table */}
          {items.length === 0 ? (
            <div className="text-center py-12">
              <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-lg font-medium">No hay productos próximos a vencer</p>
              <p className="text-sm text-muted-foreground mt-2">
                ¡Excelente! Todos los productos están dentro de su fecha de vencimiento
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead>Lote</TableHead>
                  <TableHead>Cantidad</TableHead>
                  <TableHead>Vencimiento</TableHead>
                  <TableHead>Días Restantes</TableHead>
                  <TableHead>Sucursal</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, index) => (
                  <TableRow key={`${item.batchId}-${index}`}>
                    <TableCell className="font-medium">{item.itemName}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{item.lotNumber}</Badge>
                    </TableCell>
                    <TableCell>
                      {item.currentQuantity} {item.unit}
                    </TableCell>
                    <TableCell>
                      {new Date(item.expirationDate).toLocaleDateString('es-MX', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </TableCell>
                    <TableCell>{getDaysBadge(item.daysUntilExpiration)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {item.branchName}
                    </TableCell>
                    <TableCell>
                      {item.daysUntilExpiration < 0 ? (
                        <Badge variant="destructive">Vencido</Badge>
                      ) : item.daysUntilExpiration <= 7 ? (
                        <Badge variant="destructive">Crítico</Badge>
                      ) : item.daysUntilExpiration <= 14 ? (
                        <Badge variant="warning">Pronto</Badge>
                      ) : (
                        <Badge variant="secondary">OK</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
