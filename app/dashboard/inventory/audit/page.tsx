"use client";

import * as React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { RefreshCw, ClipboardList, Eye } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, PageContainer } from "@/components/shared";

interface AuditRecord {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValue: unknown;
  newValue: unknown;
  performedBy: string;
  performedAt: string;
  reason: string | null;
  branchId: string;
}

interface AuditResponse {
  logs: AuditRecord[];
  total: number;
  limit: number;
  offset: number;
}

const ACTION_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  CREATE: { label: "Creación", variant: "default" },
  UPDATE: { label: "Actualización", variant: "secondary" },
  DELETE: { label: "Eliminación", variant: "destructive" },
};

const ENTITY_LABELS: Record<string, string> = {
  ITEM: "Producto",
  BATCH: "Lote",
  MOVEMENT: "Movimiento",
  TRANSFER: "Transferencia",
  WASTE: "Merma",
  RECEIVING: "Recepción",
  ADJUSTMENT: "Ajuste",
  SUPPLIER: "Proveedor",
};

export default function InventoryAuditPage() {
  const [data, setData] = React.useState<AuditResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [entityType, setEntityType] = React.useState<string>("ALL");
  const [action, setAction] = React.useState<string>("ALL");

  const fetchLogs = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (entityType !== "ALL") params.set("entityType", entityType);
      if (action !== "ALL") params.set("action", action);

      const response = await fetch(`/api/inventory/audit?${params.toString()}`);
      if (response.ok) {
        const result = await response.json();
        setData(result);
      } else {
        toast.error("Error al cargar el registro de auditoría");
      }
    } catch (error) {
      console.error("Error fetching audit logs:", error);
      toast.error("Error al cargar el registro de auditoría");
    } finally {
      setLoading(false);
    }
  }, [entityType, action]);

  React.useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const formatTimestamp = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleDateString("es-MX", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatValue = (val: unknown): string => {
    if (!val) return "—";
    if (typeof val === "object") {
      try {
        return JSON.stringify(val, null, 2).slice(0, 100) + (JSON.stringify(val).length > 100 ? "..." : "");
      } catch {
        return "—";
      }
    }
    return String(val);
  };

  return (
    <PageContainer>
      <PageHeader
        title="Auditoría de Inventario"
        description="Registro inmutable de todas las operaciones de inventario"
        icon={ClipboardList}
      />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex gap-4">
              <div className="w-48">
                <Label>Entidad</Label>
                <Select value={entityType} onValueChange={setEntityType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Todas</SelectItem>
                    {Object.entries(ENTITY_LABELS).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-48">
                <Label>Acción</Label>
                <Select value={action} onValueChange={setAction}>
                  <SelectTrigger>
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Todas</SelectItem>
                    <SelectItem value="CREATE">Creación</SelectItem>
                    <SelectItem value="UPDATE">Actualización</SelectItem>
                    <SelectItem value="DELETE">Eliminación</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button variant="outline" onClick={fetchLogs} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Actualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin" />
            </div>
          ) : !data || data.logs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Eye className="h-12 w-12 mx-auto mb-4 opacity-40" />
              <p>No hay registros de auditoría</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Acción</TableHead>
                    <TableHead>Entidad</TableHead>
                    <TableHead>ID Entidad</TableHead>
                    <TableHead>Realizado por</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead>Valor Anterior</TableHead>
                    <TableHead>Valor Nuevo</TableHead>
                    <TableHead>Fecha</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell>
                        <Badge variant={ACTION_LABELS[log.action]?.variant || "outline"}>
                          {ACTION_LABELS[log.action]?.label || log.action}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {ENTITY_LABELS[log.entityType] || log.entityType}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs max-w-[120px] truncate">
                        {log.entityId || "—"}
                      </TableCell>
                      <TableCell className="text-sm">{log.performedBy.slice(0, 8)}</TableCell>
                      <TableCell className="text-sm max-w-[150px] truncate">
                        {log.reason || "—"}
                      </TableCell>
                      <TableCell className="text-xs max-w-[150px] truncate text-muted-foreground">
                        {formatValue(log.oldValue)}
                      </TableCell>
                      <TableCell className="text-xs max-w-[150px] truncate text-muted-foreground">
                        {formatValue(log.newValue)}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {formatTimestamp(log.performedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="text-sm text-muted-foreground mt-4">
                Mostrando {data.logs.length} de {data.total} registros
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
