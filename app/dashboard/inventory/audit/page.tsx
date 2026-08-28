"use client";

import * as React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  RefreshCw,
  ClipboardList,
  Eye,
  FilterX,
  Search,
  ChevronLeft,
  ChevronRight,
  Building2,
  Calendar,
  Download,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader, PageContainer } from "@/components/shared";
import { DataTableSkeleton } from "@/components/shared/skeletons";
import { useBranches } from "@/hooks/queries/use-branches";
import { AuditDetailDrawer, type AuditRecord } from "./audit-detail-drawer";

interface AuditResponse {
  logs: AuditRecord[];
  total: number;
  limit: number;
  offset: number;
}

const ACTION_CONFIG: Record<
  string,
  {
    label: string;
    variant?: "default" | "secondary" | "destructive" | "outline";
    className?: string;
  }
> = {
  CREATE: {
    label: "Creación",
    variant: "outline",
    className:
      "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25 font-medium",
  },
  UPDATE: {
    label: "Actualización",
    variant: "outline",
    className:
      "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/25 font-medium",
  },
  DELETE: {
    label: "Eliminación",
    variant: "destructive",
  },
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
  PURCHASE_ORDER: "Orden de Compra",
  PAYEE: "Beneficiario",
};

const PAGE_SIZE_OPTIONS = [25, 50, 100];

export default function InventoryAuditPage() {
  const { data: branches = [], isLoading: branchesLoading } = useBranches();

  const [data, setData] = React.useState<AuditResponse | null>(null);
  const [loading, setLoading] = React.useState(true);

  // Filters state
  const [branchId, setBranchId] = React.useState<string>("ALL");
  const [entityType, setEntityType] = React.useState<string>("ALL");
  const [action, setAction] = React.useState<string>("ALL");
  const [searchEntityId, setSearchEntityId] = React.useState<string>("");
  const [dateFrom, setDateFrom] = React.useState<string>("");
  const [dateTo, setDateTo] = React.useState<string>("");

  // Pagination state
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(25);

  // Detail drawer state
  const [selectedLog, setSelectedLog] = React.useState<AuditRecord | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const hasActiveFilters =
    branchId !== "ALL" ||
    entityType !== "ALL" ||
    action !== "ALL" ||
    searchEntityId.trim() !== "" ||
    dateFrom !== "" ||
    dateTo !== "";

  const resetFilters = () => {
    setBranchId("ALL");
    setEntityType("ALL");
    setAction("ALL");
    setSearchEntityId("");
    setDateFrom("");
    setDateTo("");
    setPage(0);
  };

  const fetchLogs = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (branchId !== "ALL") params.set("branchId", branchId);
      if (entityType !== "ALL") params.set("entityType", entityType);
      if (action !== "ALL") params.set("action", action);
      if (searchEntityId.trim()) params.set("entityId", searchEntityId.trim());
      if (dateFrom) params.set("dateFrom", new Date(`${dateFrom}T00:00:00`).toISOString());
      if (dateTo) params.set("dateTo", new Date(`${dateTo}T23:59:59`).toISOString());

      params.set("limit", pageSize.toString());
      params.set("offset", (page * pageSize).toString());

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
  }, [branchId, entityType, action, searchEntityId, dateFrom, dateTo, page, pageSize]);

  React.useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const branchMap = React.useMemo(() => {
    const map = new Map<string, string>();
    branches.forEach((b) => map.set(b.id, b.name));
    return map;
  }, [branches]);

  const handleRowClick = (log: AuditRecord) => {
    setSelectedLog(log);
    setDrawerOpen(true);
  };

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

  const formatCellValue = (val: unknown): string => {
    if (!val) return "—";
    if (typeof val === "object" && val !== null) {
      if (Array.isArray(val)) {
        return `[${val.length} elementos]`;
      }
      const keys = Object.keys(val as Record<string, unknown>);
      if (keys.length === 0) return "—";
      return `${keys.length} ${keys.length === 1 ? "campo" : "campos"}`;
    }
    return String(val);
  };

  const getPerformerInitials = (performer: string): string => {
    if (!performer) return "SYS";
    const parts = performer.trim().split(/[\s@._-]+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return performer.slice(0, 2).toUpperCase();
  };

  const handleExportCSV = () => {
    if (!data || data.logs.length === 0) {
      toast.error("No hay registros para exportar");
      return;
    }

    try {
      const headers = [
        "ID",
        "Fecha",
        "Acción",
        "Entidad",
        "ID Entidad",
        "Sucursal",
        "Realizado Por",
        "Motivo",
        "Valor Anterior",
        "Valor Nuevo",
      ];

      const rows = data.logs.map((log) => [
        `"${log.id}"`,
        `"${new Date(log.performedAt).toISOString()}"`,
        `"${log.action}"`,
        `"${ENTITY_LABELS[log.entityType] || log.entityType}"`,
        `"${log.entityId || ""}"`,
        `"${branchMap.get(log.branchId) || log.branchId}"`,
        `"${log.performedBy}"`,
        `"${(log.reason || "").replace(/"/g, '""')}"`,
        `"${JSON.stringify(log.oldValue || "").replace(/"/g, '""')}"`,
        `"${JSON.stringify(log.newValue || "").replace(/"/g, '""')}"`,
      ]);

      const csvContent =
        "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const today = new Date().toISOString().split("T")[0];
      link.setAttribute("href", url);
      link.setAttribute("download", `auditoria_inventario_${today}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success("Reporte CSV descargado correctamente");
    } catch (err) {
      console.error("Export error:", err);
      toast.error("Error al generar el archivo CSV");
    }
  };

  const totalPages = data ? Math.ceil(data.total / pageSize) : 1;
  const currentTotal = data?.total ?? 0;
  const startRow = currentTotal > 0 ? page * pageSize + 1 : 0;
  const endRow = Math.min((page + 1) * pageSize, currentTotal);

  return (
    <PageContainer>
      <PageHeader
        title="Auditoría de Inventario"
        description="Registro inmutable y trazabilidad de todas las operaciones de inventario"
        icon={ClipboardList}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCSV}
              disabled={!data || data.logs.length === 0}
              className="h-9 gap-1.5 text-xs"
            >
              <Download className="h-3.5 w-3.5" />
              Exportar CSV
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader className="space-y-4">
          {/* Top toolbar */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              {/* Sucursal */}
              <div className="w-48">
                <Label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                  <Building2 className="h-3.5 w-3.5" />
                  Sucursal
                </Label>
                <Select
                  value={branchId}
                  onValueChange={(val) => {
                    setBranchId(val);
                    setPage(0);
                  }}
                  disabled={branchesLoading}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Todas las sucursales" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Todas las sucursales</SelectItem>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id} className="text-xs">
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Entidad */}
              <div className="w-44">
                <Label className="text-xs text-muted-foreground mb-1 block">Entidad</Label>
                <Select
                  value={entityType}
                  onValueChange={(val) => {
                    setEntityType(val);
                    setPage(0);
                  }}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Todas las entidades</SelectItem>
                    {Object.entries(ENTITY_LABELS).map(([key, label]) => (
                      <SelectItem key={key} value={key} className="text-xs">
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Acción */}
              <div className="w-40">
                <Label className="text-xs text-muted-foreground mb-1 block">Acción</Label>
                <Select
                  value={action}
                  onValueChange={(val) => {
                    setAction(val);
                    setPage(0);
                  }}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Todas las acciones</SelectItem>
                    <SelectItem value="CREATE">Creación</SelectItem>
                    <SelectItem value="UPDATE">Actualización</SelectItem>
                    <SelectItem value="DELETE">Eliminación</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Búsqueda por ID */}
              <div className="w-48">
                <Label className="text-xs text-muted-foreground mb-1 block">ID Entidad</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="Buscar ID..."
                    value={searchEntityId}
                    onChange={(e) => {
                      setSearchEntityId(e.target.value);
                      setPage(0);
                    }}
                    className="h-9 pl-8 text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end lg:self-auto">
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetFilters}
                  className="h-9 text-xs text-muted-foreground hover:text-foreground gap-1.5"
                >
                  <FilterX className="h-3.5 w-3.5" />
                  Limpiar filtros
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={fetchLogs} className="h-9 gap-1.5 text-xs">
                <RefreshCw className="h-3.5 w-3.5" />
                Actualizar
              </Button>
            </div>
          </div>

          {/* Secondary filter row: Dates */}
          <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-border/50">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                Desde:
              </Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(0);
                }}
                className="h-8 w-36 text-xs"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Hasta:</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setPage(0);
                }}
                className="h-8 w-36 text-xs"
              />
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {loading ? (
            <DataTableSkeleton columns={8} rows={8} />
          ) : !data || data.logs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Eye className="h-12 w-12 mx-auto mb-4 opacity-40" />
              <p className="font-medium text-sm text-foreground">
                No se encontraron registros de auditoría
              </p>
              <p className="text-xs mt-1 text-muted-foreground">
                {hasActiveFilters
                  ? "Prueba a modificar o limpiar los filtros aplicados para ver más resultados."
                  : "Las operaciones y modificaciones en el inventario quedarán registradas aquí automáticamente."}
              </p>
              {hasActiveFilters && (
                <Button variant="outline" size="sm" onClick={resetFilters} className="mt-4 gap-1.5 text-xs">
                  <FilterX className="h-3.5 w-3.5" />
                  Restablecer filtros
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="rounded-md border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="w-[120px]">Acción</TableHead>
                      <TableHead className="w-[130px]">Entidad</TableHead>
                      <TableHead className="w-[130px]">ID Entidad</TableHead>
                      <TableHead className="w-[130px]">Sucursal</TableHead>
                      <TableHead className="w-[160px]">Realizado por</TableHead>
                      <TableHead className="min-w-[160px]">Motivo</TableHead>
                      <TableHead className="w-[120px]">Cambio</TableHead>
                      <TableHead className="w-[140px]">Fecha</TableHead>
                      <TableHead className="w-[60px] text-right"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.logs.map((log) => {
                      const actionCfg = ACTION_CONFIG[log.action] || {
                        label: log.action,
                        variant: "outline" as const,
                      };

                      return (
                        <TableRow
                          key={log.id}
                          onClick={() => handleRowClick(log)}
                          className="cursor-pointer hover:bg-muted/50 transition-colors group"
                        >
                          <TableCell>
                            <Badge
                              variant={actionCfg.variant || "outline"}
                              className={`text-xs ${actionCfg.className || ""}`}
                            >
                              {actionCfg.label}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs font-normal">
                              {ENTITY_LABELS[log.entityType] || log.entityType}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs max-w-[120px] truncate text-muted-foreground">
                            {log.entityId || "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground font-medium">
                            {branchMap.get(log.branchId) || log.branchId.slice(0, 8)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Avatar className="h-6 w-6 text-xs bg-muted border border-border">
                                <AvatarFallback className="text-xs font-semibold">
                                  {getPerformerInitials(log.performedBy)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="text-xs font-medium text-foreground truncate max-w-[110px]" title={log.performedBy}>
                                {log.performedBy}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs max-w-[160px] truncate text-muted-foreground">
                            {log.reason || <span className="italic text-muted-foreground/60">Sin motivo</span>}
                          </TableCell>
                          <TableCell className="text-xs">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground font-mono text-xs">
                              {formatCellValue(log.newValue || log.oldValue)}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatTimestamp(log.performedAt)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                              title="Ver detalle del cambio"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRowClick(log);
                              }}
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination controls */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-4 pt-4 border-t border-border/50 text-xs text-muted-foreground">
                <div>
                  Mostrando <span className="font-medium text-foreground">{startRow}</span> a{" "}
                  <span className="font-medium text-foreground">{endRow}</span> de{" "}
                  <span className="font-medium text-foreground">{currentTotal}</span> registros
                </div>

                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5">
                    <span>Filas por página:</span>
                    <Select
                      value={pageSize.toString()}
                      onValueChange={(val) => {
                        setPageSize(Number(val));
                        setPage(0);
                      }}
                    >
                      <SelectTrigger className="h-8 w-16 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAGE_SIZE_OPTIONS.map((opt) => (
                          <SelectItem key={opt} value={opt.toString()} className="text-xs">
                            {opt}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0 || loading}
                      className="h-8 px-2 text-xs"
                      aria-label="Página anterior"
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Anterior
                    </Button>
                    <span className="px-2 text-xs">
                      Página {page + 1} de {totalPages || 1}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                      disabled={page >= totalPages - 1 || loading}
                      className="h-8 px-2 text-xs"
                      aria-label="Página siguiente"
                    >
                      Siguiente
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Slide-over change detail inspector */}
      <AuditDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        log={selectedLog}
        branchName={selectedLog ? branchMap.get(selectedLog.branchId) : undefined}
        actionLabel={selectedLog ? ACTION_CONFIG[selectedLog.action]?.label : undefined}
        actionVariant={selectedLog ? ACTION_CONFIG[selectedLog.action]?.variant : undefined}
        entityLabel={selectedLog ? ENTITY_LABELS[selectedLog.entityType] : undefined}
      />
    </PageContainer>
  );
}
