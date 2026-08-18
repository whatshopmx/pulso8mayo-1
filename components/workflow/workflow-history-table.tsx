"use client";

import { useState, useEffect, useRef, useTransition, useMemo } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams, useRouter } from "next/navigation";
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
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import {
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  Search,
  Filter,
  Download,
  Eye,
  Play,
  Calendar,
  User,
  FileText,
  Building2,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  X,
} from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ReviewStatusBadge } from "@/components/workflow/review-status-badge";
import { scoreColorClass } from "@/lib/utils/score";
import { toast } from "sonner";

interface WorkflowHistoryItem {
  id: string;
  templateName: string;
  templateId: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "BLOCKED" | "FAILED" | "CANCELLED";
  reviewStatus: "APPROVED" | "REJECTED" | null;
  reviewedAt: string | Date | null;
  score: number | null;
  assigneeName: string | null;
  assigneeId: string | null;
  branchName: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  completedAt: string | Date | null;
  stepsTotal: number;
  stepsCompleted: number;
  hasIncidents: boolean;
  hasEvidence: boolean;
  evidenceCount: number;
}

interface PaginationMetadata {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

type OperationalPreset = "all" | "today" | "this_week" | "with_incidents" | "pending_review" | "failed_or_blocked";

interface WorkflowHistoryFilters {
  status?: string;
  templateId?: string;
  assigneeId?: string;
  branchId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  preset?: OperationalPreset;
  page?: number;
  limit?: number;
}

interface WorkflowHistoryTableProps {
  branchId?: string;
}

export function WorkflowHistoryTable({ branchId: initialBranchId }: WorkflowHistoryTableProps) {
  const t = useTranslations("workflows");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  // URL state synchronization
  const initialPage = parseInt(searchParams.get("page") || "1", 10);
  const initialLimit = parseInt(searchParams.get("limit") || "20", 10);
  const initialPreset = (searchParams.get("preset") as OperationalPreset) || "all";
  const initialSearch = searchParams.get("search") || "";

  const [workflows, setWorkflows] = useState<WorkflowHistoryItem[]>([]);
  const [pagination, setPagination] = useState<PaginationMetadata>({
    page: initialPage,
    limit: initialLimit,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search debouncing state
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [activePreset, setActivePreset] = useState<OperationalPreset>(initialPreset);

  const [filters, setFilters] = useState<WorkflowHistoryFilters>({
    branchId: initialBranchId || searchParams.get("branchId") || undefined,
    status: searchParams.get("status") || undefined,
    templateId: searchParams.get("templateId") || undefined,
    assigneeId: searchParams.get("assigneeId") || undefined,
    dateFrom: searchParams.get("dateFrom") || undefined,
    dateTo: searchParams.get("dateTo") || undefined,
    search: initialSearch || undefined,
    preset: initialPreset,
    page: initialPage,
    limit: initialLimit,
  });

  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([]);
  const [assignees, setAssignees] = useState<{ id: string; name: string }[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);

  // Scroll to row if returning from execution
  const [reviewedId, setReviewedId] = useState<string | null>(null);
  const reviewedRowRef = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    setReviewedId(searchParams.get("revisada"));
  }, [searchParams]);

  useEffect(() => {
    if (!reviewedId || loading) return;
    reviewedRowRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [reviewedId, loading, workflows]);

  // Update filters when branchId prop changes
  useEffect(() => {
    if (initialBranchId !== filters.branchId) {
      setFilters((prev) => ({
        ...prev,
        branchId: initialBranchId || undefined,
        page: 1,
      }));
    }
  }, [initialBranchId]);

  // Debounce search input (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((prev) => {
        if (prev.search === searchInput.trim()) return prev;
        return {
          ...prev,
          search: searchInput.trim() || undefined,
          page: 1,
        };
      });
    }, 300);

    return () => clearTimeout(timer);
  }, [searchInput]);

  // Fetch filter metadata on mount
  useEffect(() => {
    fetchFilterOptions();
  }, []);

  // Fetch workflows whenever filters change
  useEffect(() => {
    fetchWorkflows();
    updateUrlParams();
  }, [filters]);

  const updateUrlParams = () => {
    startTransition(() => {
      const params = new URLSearchParams();
      if (filters.page && filters.page > 1) params.set("page", filters.page.toString());
      if (filters.limit && filters.limit !== 20) params.set("limit", filters.limit.toString());
      if (filters.preset && filters.preset !== "all") params.set("preset", filters.preset);
      if (filters.search) params.set("search", filters.search);
      if (filters.status && filters.status !== "all") params.set("status", filters.status);
      if (filters.templateId && filters.templateId !== "all") params.set("templateId", filters.templateId);
      if (filters.assigneeId && filters.assigneeId !== "all") params.set("assigneeId", filters.assigneeId);
      if (filters.branchId && filters.branchId !== "all") params.set("branchId", filters.branchId);
      if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
      if (filters.dateTo) params.set("dateTo", filters.dateTo);

      const qs = params.toString();
      const currentQs = window.location.search.replace(/^\?/, "");
      if (qs !== currentQs) {
        router.replace(qs ? `?${qs}` : window.location.pathname, { scroll: false });
      }
    });
  };

  const fetchWorkflows = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.page) params.append("page", filters.page.toString());
      if (filters.limit) params.append("limit", filters.limit.toString());
      if (filters.preset && filters.preset !== "all") params.append("preset", filters.preset);
      if (filters.status) params.append("status", filters.status);
      if (filters.templateId) params.append("templateId", filters.templateId);
      if (filters.assigneeId) params.append("assigneeId", filters.assigneeId);
      if (filters.branchId) params.append("branchId", filters.branchId);
      if (filters.dateFrom) params.append("dateFrom", filters.dateFrom);
      if (filters.dateTo) params.append("dateTo", filters.dateTo);
      if (filters.search) params.append("search", filters.search);

      const response = await fetch(`/api/workflows/history?${params}`);
      if (!response.ok) {
        throw new Error("Failed to fetch workflow history");
      }
      const json = await response.json();
      setWorkflows(json.data || []);
      if (json.pagination) {
        setPagination(json.pagination);
      }
    } catch (err: any) {
      console.error("Failed to fetch workflows:", err);
      setError(tErrors("services.history") || "No se pudo cargar el historial de workflows");
      toast.error(tErrors("services.history") || "Error al cargar historial");
    } finally {
      setLoading(false);
    }
  };

  const fetchFilterOptions = async () => {
    try {
      const response = await fetch("/api/workflows/history/filters");
      if (response.ok) {
        const data = await response.json();
        setTemplates(data.templates || []);
        setAssignees(data.assignees || []);
        setBranches(data.branches || []);
      }
    } catch (err) {
      console.error("Failed to fetch filter options:", err);
    }
  };

  const getStatusBadge = (status: WorkflowHistoryItem["status"]) => {
    switch (status) {
      case "COMPLETED":
        return (
          <Badge variant="success" className="gap-1 text-xs">
            <CheckCircle2 className="w-3 h-3" />
            {t("history.status.completed")}
          </Badge>
        );
      case "IN_PROGRESS":
        return (
          <Badge variant="secondary" className="gap-1 bg-accent/60 text-accent-foreground border-border/50 text-xs">
            <Play className="w-3 h-3" />
            {t("history.status.inProgress")}
          </Badge>
        );
      case "PENDING":
        return (
          <Badge variant="outline" className="gap-1 text-xs">
            <Clock className="w-3 h-3" />
            {t("history.status.pending")}
          </Badge>
        );
      case "BLOCKED":
        return (
          <Badge variant="destructive" className="gap-1 text-xs">
            <XCircle className="w-3 h-3" />
            {t("history.status.blocked")}
          </Badge>
        );
      case "FAILED":
        return (
          <Badge variant="destructive" className="gap-1 text-xs">
            <AlertTriangle className="w-3 h-3" />
            {t("history.status.failed")}
          </Badge>
        );
      case "CANCELLED":
        return <Badge variant="secondary" className="text-xs">{t("history.status.cancelled")}</Badge>;
      default:
        return <Badge variant="secondary" className="text-xs">{status}</Badge>;
    }
  };

  const getProgressPercentage = (completed: number, total: number) => {
    if (total === 0) return 0;
    return Math.round((completed / total) * 100);
  };

  const handlePresetSelect = (preset: OperationalPreset) => {
    setActivePreset(preset);
    setFilters((prev) => ({
      ...prev,
      preset: preset === "all" ? undefined : preset,
      page: 1,
    }));
  };

  const clearAllFilters = () => {
    setSearchInput("");
    setActivePreset("all");
    setFilters({
      branchId: initialBranchId || undefined,
      page: 1,
      limit: filters.limit,
    });
  };

  // Count active secondary filters for popover badge
  const activeSecondaryCount = useMemo(() => {
    let count = 0;
    if (filters.status && filters.status !== "all") count++;
    if (filters.templateId && filters.templateId !== "all") count++;
    if (filters.assigneeId && filters.assigneeId !== "all") count++;
    if (filters.branchId && filters.branchId !== "all" && !initialBranchId) count++;
    if (filters.dateFrom) count++;
    if (filters.dateTo) count++;
    return count;
  }, [filters, initialBranchId]);

  const hasAnyFilterActive = useMemo(() => {
    return Boolean(
      (filters.preset && filters.preset !== "all") ||
      filters.search ||
      activeSecondaryCount > 0
    );
  }, [filters, activeSecondaryCount]);

  // Real CSV Export Handler
  const handleExportCsv = () => {
    if (workflows.length === 0) {
      toast.info("No hay registros para exportar con los filtros actuales.");
      return;
    }

    try {
      const headers = [
        "ID Workflow",
        "Plantilla",
        "Estado Ejecución",
        "Veredicto Revisión",
        "Calificación (%)",
        "Pasos Completados",
        "Pasos Totales",
        "Incidencias",
        "Evidencias",
        "Asignado",
        "Sucursal",
        "Fecha Creación",
      ];

      const csvRows = workflows.map((w) => [
        `"${w.id}"`,
        `"${w.templateName.replace(/"/g, '""')}"`,
        `"${w.status}"`,
        `"${w.reviewStatus || "SIN_VEREDICTO"}"`,
        w.score !== null ? w.score : "",
        w.stepsCompleted,
        w.stepsTotal,
        w.hasIncidents ? "SÍ" : "NO",
        w.evidenceCount,
        `"${(w.assigneeName || "Sin asignar").replace(/"/g, '""')}"`,
        `"${w.branchName.replace(/"/g, '""')}"`,
        `"${format(new Date(w.createdAt), "yyyy-MM-dd HH:mm:ss")}"`,
      ]);

      const csvContent = "\uFEFF" + [headers.join(","), ...csvRows.map((r) => r.join(","))].join("\r\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const filename = `historial-workflows-${format(new Date(), "yyyy-MM-dd-HHmm")}.csv`;
      link.setAttribute("href", url);
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success(`Se exportaron ${workflows.length} registros exitosamente.`);
    } catch (err) {
      console.error("Error al exportar CSV:", err);
      toast.error("Ocurrió un error al generar el archivo CSV.");
    }
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      setFilters((prev) => ({ ...prev, page: newPage }));
      window.scrollTo({ top: 200, behavior: "smooth" });
    }
  };

  const handleLimitChange = (newLimitStr: string) => {
    const newLimit = parseInt(newLimitStr, 10);
    setFilters((prev) => ({ ...prev, limit: newLimit, page: 1 }));
  };

  return (
    <div className="space-y-4">
      {/* Search & Operational Filter Bar */}
      <Card className="border-border/70">
        <CardContent className="p-4 sm:p-5 space-y-4">
          {/* Top Bar: Search, Quick Chips & Action Buttons */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative w-full lg:max-w-md">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={tCommon("searchWorkflow") || "Buscar workflow por plantilla..."}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-9 bg-background/80"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => setSearchInput("")}
                  className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Right Tools: Advanced Filters Popover & CSV Export */}
            <div className="flex items-center gap-2 self-end lg:self-auto w-full sm:w-auto">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2 flex-1 sm:flex-initial">
                    <SlidersHorizontal className="h-4 w-4" />
                    <span>Filtros avanzados</span>
                    {activeSecondaryCount > 0 && (
                      <Badge variant="default" className="h-5 px-1.5 text-xs ml-1">
                        {activeSecondaryCount}
                      </Badge>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 sm:w-96 p-4 space-y-4" align="end">
                  <div className="flex items-center justify-between border-b pb-2">
                    <div className="flex items-center gap-2">
                      <Filter className="h-4 w-4 text-muted-foreground" />
                      <h4 className="font-semibold text-sm">Filtros Secundarios</h4>
                    </div>
                    {activeSecondaryCount > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setFilters((prev) => ({
                            ...prev,
                            status: undefined,
                            templateId: undefined,
                            assigneeId: undefined,
                            dateFrom: undefined,
                            dateTo: undefined,
                            page: 1,
                          }));
                        }}
                        className="h-7 px-2 text-xs text-muted-foreground"
                      >
                        Limpiar
                      </Button>
                    )}
                  </div>

                  <div className="grid gap-3">
                    {/* Status Select */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium">{tCommon("status") || "Estado"}</label>
                      <Select
                        value={filters.status || "all"}
                        onValueChange={(val) =>
                          setFilters((prev) => ({ ...prev, status: val === "all" ? undefined : val, page: 1 }))
                        }
                      >
                        <SelectTrigger className="h-9 text-xs">
                          <SelectValue placeholder={tCommon("allStatuses") || "Todos los estados"} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all" className="text-xs">{tCommon("allStatuses") || "Todos los estados"}</SelectItem>
                          <SelectItem value="COMPLETED" className="text-xs">{t("history.status.completed") || "Completado"}</SelectItem>
                          <SelectItem value="IN_PROGRESS" className="text-xs">{t("history.status.inProgress") || "En Progreso"}</SelectItem>
                          <SelectItem value="PENDING" className="text-xs">{t("history.status.pending") || "Pendiente"}</SelectItem>
                          <SelectItem value="BLOCKED" className="text-xs">{t("history.status.blocked") || "Bloqueado"}</SelectItem>
                          <SelectItem value="FAILED" className="text-xs">{t("history.status.failed") || "Fallido"}</SelectItem>
                          <SelectItem value="CANCELLED" className="text-xs">{t("history.status.cancelled") || "Cancelado"}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Template Select */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium">{t("templates.title") || "Plantilla"}</label>
                      <Select
                        value={filters.templateId || "all"}
                        onValueChange={(val) =>
                          setFilters((prev) => ({ ...prev, templateId: val === "all" ? undefined : val, page: 1 }))
                        }
                      >
                        <SelectTrigger className="h-9 text-xs">
                          <SelectValue placeholder={tCommon("allTemplates") || "Todas las plantillas"} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all" className="text-xs">{tCommon("allTemplates") || "Todas las plantillas"}</SelectItem>
                          {templates.map((tmpl) => (
                            <SelectItem key={tmpl.id} value={tmpl.id} className="text-xs">
                              {tmpl.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Branch Select (if not locked by initialBranchId) */}
                    {!initialBranchId && (
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium">{tCommon("branch") || "Sucursal"}</label>
                        <Select
                          value={filters.branchId || "all"}
                          onValueChange={(val) =>
                            setFilters((prev) => ({ ...prev, branchId: val === "all" ? undefined : val, page: 1 }))
                          }
                        >
                          <SelectTrigger className="h-9 text-xs">
                            <SelectValue placeholder={tCommon("allBranches") || "Todas las sucursales"} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all" className="text-xs">{tCommon("allBranches") || "Todas las sucursales"}</SelectItem>
                            {branches.map((b) => (
                              <SelectItem key={b.id} value={b.id} className="text-xs">
                                {b.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {/* Assignee Select */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium">{tCommon("assignee") || "Responsable"}</label>
                      <Select
                        value={filters.assigneeId || "all"}
                        onValueChange={(val) =>
                          setFilters((prev) => ({ ...prev, assigneeId: val === "all" ? undefined : val, page: 1 }))
                        }
                      >
                        <SelectTrigger className="h-9 text-xs">
                          <SelectValue placeholder={tCommon("allUsers") || "Todos los usuarios"} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all" className="text-xs">{tCommon("allUsers") || "Todos los usuarios"}</SelectItem>
                          {assignees.map((a) => (
                            <SelectItem key={a.id} value={a.id} className="text-xs">
                              {a.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Date Range Inputs */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">{tCommon("dateFrom") || "Desde"}</label>
                        <Input
                          type="date"
                          value={filters.dateFrom || ""}
                          onChange={(e) =>
                            setFilters((prev) => ({ ...prev, dateFrom: e.target.value || undefined, page: 1 }))
                          }
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">{tCommon("dateTo") || "Hasta"}</label>
                        <Input
                          type="date"
                          value={filters.dateTo || ""}
                          onChange={(e) =>
                            setFilters((prev) => ({ ...prev, dateTo: e.target.value || undefined, page: 1 }))
                          }
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>

              <Button
                variant="outline"
                size="sm"
                onClick={handleExportCsv}
                className="gap-2 flex-1 sm:flex-initial"
              >
                <Download className="h-4 w-4" />
                <span>{tCommon("export") || "Exportar CSV"}</span>
              </Button>
            </div>
          </div>

          {/* Quick Operational Chips */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none text-xs">
            <span className="text-muted-foreground shrink-0 mr-1 font-medium text-xs">Vistas rápidas:</span>
            <Button
              variant={activePreset === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => handlePresetSelect("all")}
              className="h-7 text-xs rounded-full px-3"
            >
              Todos
            </Button>
            <Button
              variant={activePreset === "today" ? "default" : "outline"}
              size="sm"
              onClick={() => handlePresetSelect("today")}
              className="h-7 text-xs rounded-full px-3"
            >
              Hoy
            </Button>
            <Button
              variant={activePreset === "this_week" ? "default" : "outline"}
              size="sm"
              onClick={() => handlePresetSelect("this_week")}
              className="h-7 text-xs rounded-full px-3"
            >
              Esta Semana
            </Button>
            <Button
              variant={activePreset === "with_incidents" ? "default" : "outline"}
              size="sm"
              onClick={() => handlePresetSelect("with_incidents")}
              className="h-7 text-xs rounded-full px-3 gap-1"
            >
              <AlertTriangle className="h-3 w-3 text-warning-text" />
              Con Incidencias
            </Button>
            <Button
              variant={activePreset === "pending_review" ? "default" : "outline"}
              size="sm"
              onClick={() => handlePresetSelect("pending_review")}
              className="h-7 text-xs rounded-full px-3"
            >
              Por Revisar
            </Button>
            <Button
              variant={activePreset === "failed_or_blocked" ? "default" : "outline"}
              size="sm"
              onClick={() => handlePresetSelect("failed_or_blocked")}
              className="h-7 text-xs rounded-full px-3"
            >
              Bloqueados / Fallidos
            </Button>

            {hasAnyFilterActive && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAllFilters}
                className="h-7 text-xs px-2.5 text-muted-foreground hover:text-foreground shrink-0 ml-auto"
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                {tCommon("clearFilters") || "Limpiar filtros"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Main Content Table & Card */}
      <Card className="border-border/70">
        <CardHeader className="p-4 sm:p-5 border-b border-border/60">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base sm:text-lg font-semibold">{t("history.title") || "Historial de Ejecuciones"}</CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Registro cronológico y estatus de workflows en operación
              </CardDescription>
            </div>
            {!loading && (
              <div className="text-xs text-muted-foreground font-medium">
                {pagination.total > 0
                  ? `Mostrando ${(pagination.page - 1) * pagination.limit + 1}–${Math.min(
                      pagination.page * pagination.limit,
                      pagination.total
                    )} de ${pagination.total} ejecuciones`
                  : "0 registros"}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            /* Skeleton Loading State */
            <div className="p-4 space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center justify-between py-3 border-b border-border/40 gap-4">
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <Skeleton className="h-6 w-24" />
                  <Skeleton className="h-4 w-16 hidden md:block" />
                  <Skeleton className="h-4 w-28 hidden lg:block" />
                  <Skeleton className="h-8 w-20" />
                </div>
              ))}
            </div>
          ) : error ? (
            /* Error State with Retry */
            <div className="flex flex-col items-center justify-center py-12 text-center px-4 space-y-3">
              <AlertTriangle className="h-10 w-10 text-destructive mb-1" />
              <p className="font-semibold text-foreground">Ocurrió un error al cargar el historial</p>
              <p className="text-xs sm:text-sm text-muted-foreground max-w-md">{error}</p>
              <Button variant="outline" size="sm" onClick={fetchWorkflows} className="mt-2 gap-2 text-xs">
                <RotateCcw className="h-4 w-4" />
                Reintentar
              </Button>
            </div>
          ) : workflows.length === 0 ? (
            /* Empty State */
            <div className="flex flex-col items-center justify-center py-14 text-center px-4">
              <FileText className="h-12 w-12 text-muted-foreground/60 mb-3" />
              <p className="font-medium text-foreground">
                {t("history.noWorkflowsFound") || "No se encontraron workflows con los filtros actuales"}
              </p>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1 max-w-sm">
                Intenta ajustar la búsqueda o seleccionar otro rango de fechas.
              </p>
              {hasAnyFilterActive && (
                <Button variant="outline" size="sm" onClick={clearAllFilters} className="mt-4 gap-2 text-xs">
                  <RotateCcw className="h-4 w-4" />
                  Limpiar todos los filtros
                </Button>
              )}
            </div>
          ) : (
            <>
              {/* Desktop / Tablet Table View (Flat-by-Default, Single Dividers) */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-b border-border/80 bg-muted/40 hover:bg-muted/40">
                      <TableHead className="font-semibold text-xs text-foreground/80">{tCommon("workflow") || "Workflow"}</TableHead>
                      <TableHead className="font-semibold text-xs text-foreground/80">{tCommon("status") || "Estado"}</TableHead>
                      <TableHead className="font-semibold text-xs text-foreground/80">{tCommon("progress") || "Progreso"}</TableHead>
                      <TableHead className="font-semibold text-xs text-foreground/80">{tCommon("score") || "Calificación"}</TableHead>
                      <TableHead className="font-semibold text-xs text-foreground/80">{tCommon("assigned") || "Asignado"}</TableHead>
                      <TableHead className="font-semibold text-xs text-foreground/80">{tCommon("branch") || "Sucursal"}</TableHead>
                      <TableHead className="font-semibold text-xs text-foreground/80">{tCommon("date") || "Fecha"}</TableHead>
                      <TableHead className="text-right font-semibold text-xs text-foreground/80">{tCommon("actions") || "Acciones"}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workflows.map((workflow) => {
                      const targetUrl = `/dashboard/workflows/review/${workflow.id}`;
                      const progressPct = getProgressPercentage(workflow.stepsCompleted, workflow.stepsTotal);

                      return (
                        <TableRow
                          key={workflow.id}
                          ref={workflow.id === reviewedId ? reviewedRowRef : undefined}
                          data-revisada={workflow.id === reviewedId || undefined}
                          className="scroll-mt-24 border-b border-border/60 hover:bg-accent/30 transition-colors data-[revisada]:bg-accent/50"
                        >
                          {/* Template Name & Indicators */}
                          <TableCell className="font-medium">
                            <div className="space-y-1">
                              <Link
                                href={targetUrl}
                                className="font-semibold text-foreground hover:text-primary transition-colors line-clamp-1 text-sm"
                              >
                                {workflow.templateName}
                              </Link>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                {workflow.hasEvidence && (
                                  <span className="flex items-center gap-1">
                                    <FileText className="h-3 w-3" />
                                    {workflow.evidenceCount} {tCommon("evidences") || "Evidencias"}
                                  </span>
                                )}
                                {workflow.hasIncidents && (
                                  <span className="flex items-center gap-1 text-warning-text font-medium">
                                    <AlertTriangle className="h-3 w-3" />
                                    {tCommon("incidents") || "Incidencias"}
                                  </span>
                                )}
                              </div>
                            </div>
                          </TableCell>

                          {/* Status & Review Verdict Badges */}
                          <TableCell>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {getStatusBadge(workflow.status)}
                              {workflow.reviewStatus && <ReviewStatusBadge status={workflow.reviewStatus} />}
                            </div>
                          </TableCell>

                          {/* Progress Bar (Success when completed, neutral in progress) */}
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="w-20">
                                <div className="h-2 bg-muted rounded-full overflow-hidden">
                                  <div
                                    className={`h-full transition-all ${
                                      workflow.status === "COMPLETED" ? "bg-success" : "bg-foreground/70"
                                    }`}
                                    style={{ width: `${progressPct}%` }}
                                  />
                                </div>
                              </div>
                              <span className="text-xs text-muted-foreground font-mono">
                                {workflow.stepsCompleted}/{workflow.stepsTotal}
                              </span>
                            </div>
                          </TableCell>

                          {/* Score Cell */}
                          <TableCell className={scoreColorClass(workflow.score)}>
                            {workflow.score !== null ? `${workflow.score}%` : "-"}
                          </TableCell>

                          {/* Assignee Cell */}
                          <TableCell>
                            {workflow.assigneeName ? (
                              <div className="flex items-center gap-1.5 text-xs">
                                <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <span className="truncate max-w-[120px]">{workflow.assigneeName}</span>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">{tCommon("unassigned") || "Sin asignar"}</span>
                            )}
                          </TableCell>

                          {/* Branch Cell */}
                          <TableCell className="text-xs">
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <Building2 className="h-3 w-3 shrink-0" />
                              <span className="truncate max-w-[110px]">{workflow.branchName}</span>
                            </div>
                          </TableCell>

                          {/* Date Cell */}
                          <TableCell>
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-1 text-xs">
                                <Calendar className="h-3 w-3 text-muted-foreground" />
                                {format(new Date(workflow.createdAt), "dd MMM yyyy", { locale: es })}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {formatDistanceToNow(new Date(workflow.createdAt), { addSuffix: true, locale: es })}
                              </div>
                            </div>
                          </TableCell>

                          {/* Action Button: Directly navigates to /execute or /review */}
                          <TableCell className="text-right">
                            <Link href={targetUrl}>
                              <Button
                                variant={workflow.status === "PENDING" ? "default" : "ghost"}
                                size="sm"
                                className="h-8 gap-1.5 text-xs font-medium"
                              >
                                <>
                                  <Eye className="h-3.5 w-3.5" />
                                  {tCommon("view") || "Ver"}
                                </>
                              </Button>
                            </Link>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile Card List View (<768px) */}
              <div className="md:hidden divide-y divide-border/60">
                {workflows.map((workflow) => {
                  const targetUrl = `/dashboard/workflows/review/${workflow.id}`;
                  const progressPct = getProgressPercentage(workflow.stepsCompleted, workflow.stepsTotal);

                  return (
                    <div
                      key={workflow.id}
                      ref={workflow.id === reviewedId ? reviewedRowRef : undefined}
                      className="p-4 space-y-3 hover:bg-accent/20 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <Link href={targetUrl} className="font-semibold text-sm hover:text-primary transition-colors">
                          {workflow.templateName}
                        </Link>
                        <div className="shrink-0">{getStatusBadge(workflow.status)}</div>
                      </div>

                      {/* Metadata Row: Branch, Assignee, Score */}
                      <div className="flex items-center justify-between text-xs text-muted-foreground flex-wrap gap-2">
                        <div className="flex items-center gap-1">
                          <Building2 className="h-3.5 w-3.5" />
                          <span>{workflow.branchName}</span>
                        </div>
                        {workflow.assigneeName && (
                          <div className="flex items-center gap-1">
                            <User className="h-3.5 w-3.5" />
                            <span>{workflow.assigneeName}</span>
                          </div>
                        )}
                        {workflow.score !== null && (
                          <span className={`font-bold ${scoreColorClass(workflow.score)}`}>
                            {workflow.score}%
                          </span>
                        )}
                      </div>

                      {/* Progress Bar & Badges */}
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <div className="flex items-center gap-2 flex-1">
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden flex-1 max-w-[120px]">
                            <div
                              className={`h-full transition-all ${
                                workflow.status === "COMPLETED" ? "bg-success" : "bg-foreground/70"
                              }`}
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                          <span className="text-muted-foreground font-mono text-xs">
                            {workflow.stepsCompleted}/{workflow.stepsTotal}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {workflow.hasEvidence && (
                            <Badge variant="outline" className="text-xs py-0 px-1.5 gap-1">
                              <FileText className="h-3 w-3" />
                              {workflow.evidenceCount}
                            </Badge>
                          )}
                          {workflow.hasIncidents && (
                            <Badge variant="destructive" className="text-xs py-0 px-1.5 gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              Incidencias
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Bottom Row: Date & Full-width Action */}
                      <div className="flex items-center justify-between pt-1 gap-2 border-t border-border/40">
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(workflow.createdAt), "dd MMM yyyy", { locale: es })}
                        </span>
                        <Link href={targetUrl} className="flex-1 max-w-[140px]">
                          <Button
                            variant={workflow.status === "PENDING" ? "default" : "outline"}
                            size="sm"
                            className="w-full h-8 text-xs gap-1.5"
                          >
                            <>
                              <Eye className="h-3.5 w-3.5" />
                              Ver Revisión
                            </>
                          </Button>
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Pagination Bar */}
              {pagination.totalPages > 1 && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 border-t border-border/60 gap-3">
                  {/* Page Size Selector */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Filas por página:</span>
                    <Select value={pagination.limit.toString()} onValueChange={handleLimitChange}>
                      <SelectTrigger className="h-8 w-16 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10" className="text-xs">10</SelectItem>
                        <SelectItem value="20" className="text-xs">20</SelectItem>
                        <SelectItem value="50" className="text-xs">50</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Navigation Buttons */}
                  <div className="flex items-center gap-1.5 self-center sm:self-auto">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(pagination.page - 1)}
                      disabled={pagination.page <= 1 || loading}
                      className="h-8 px-2.5 text-xs gap-1"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      <span className="hidden sm:inline">Anterior</span>
                    </Button>

                    <div className="text-xs px-2 font-medium">
                      Página <span className="font-semibold text-foreground">{pagination.page}</span> de{" "}
                      <span className="font-semibold text-foreground">{pagination.totalPages}</span>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(pagination.page + 1)}
                      disabled={pagination.page >= pagination.totalPages || loading}
                      className="h-8 px-2.5 text-xs gap-1"
                    >
                      <span className="hidden sm:inline">Siguiente</span>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
