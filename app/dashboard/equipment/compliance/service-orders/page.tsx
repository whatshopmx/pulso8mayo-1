"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, PageContainer, EmptyState } from "@/components/shared";
import { useServiceOrders } from "@/hooks/queries";
import { CreateOrderDialog, TYPE_LABELS } from "@/components/service-orders/create-order-dialog";
import { useSession } from "@/hooks/use-session";
import { roleIsAtLeast } from "@/lib/permissions";
import { Plus, Loader2, ClipboardList, ChevronLeft, ChevronRight } from "lucide-react";

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "warning" }> = {
  DRAFT: { label: "Borrador", variant: "secondary" },
  PENDING_APPROVAL: { label: "Por Aprobar", variant: "warning" },
  APPROVED: { label: "Aprobada", variant: "default" },
  SCHEDULED: { label: "Programada", variant: "default" },
  IN_PROGRESS: { label: "En Ejecución", variant: "warning" },
  PENDING_CONFORMITY: { label: "Por Conformar", variant: "warning" },
  CLOSED: { label: "Cerrada", variant: "outline" },
  REJECTED: { label: "Rechazada", variant: "destructive" },
  CANCELLED: { label: "Cancelada", variant: "destructive" },
};

const URGENCY_CONFIG: Record<string, { label: string; className: string }> = {
  NORMAL: { label: "Normal", className: "" },
  URGENTE: { label: "Urgente", className: "border-amber-600/40 text-amber-700 dark:text-amber-400" },
  EMERGENCIA: { label: "Emergencia", className: "border-red-600/40 text-red-700 dark:text-red-400 font-medium" },
};

function formatCurrency(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "$0.00";
  return `$${(cents / 100).toLocaleString("es-MX", { minimumFractionDigits: 2 })}`;
}

function formatDate(date: string | Date | null | undefined) {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("es-MX", { year: "numeric", month: "short", day: "numeric" });
}

const PAGE_SIZE = 25;

export default function ServiceOrdersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session } = useSession();
  const canCreate = !!session?.user?.role && roleIsAtLeast(session.user.role, "SUPERVISOR");

  // Filtro por servicio normativo origen (?complianceServiceId=…) — enlace "Ver OS" desde Servicios Normativos.
  const complianceServiceId = searchParams.get("complianceServiceId") ?? undefined;

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, isError } = useServiceOrders({
    status: statusFilter === "all" ? undefined : statusFilter,
    type: typeFilter === "all" ? undefined : typeFilter,
    complianceServiceId,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const orders = data?.orders ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <PageContainer>
      <PageHeader
        title="Órdenes de Servicio"
        description="Control documental y financiero de servicios: matriz de autorización, presupuesto y conformidad."
        icon={ClipboardList}
        actions={
          complianceServiceId ? (
            <Badge variant="outline" className="gap-1">
              Filtradas por servicio normativo
              <Link href="/dashboard/equipment/compliance/service-orders" className="ml-1 underline underline-offset-2">
                quitar filtro
              </Link>
            </Badge>
          ) : undefined
        }
      />

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-full sm:w-[180px]" aria-label="Filtrar por estado">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([value, cfg]) => (
              <SelectItem key={value} value={value}>{cfg.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(0); }}>
          <SelectTrigger className="w-full sm:w-[180px]" aria-label="Filtrar por tipo">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los tipos</SelectItem>
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="sm:ml-auto">
          {canCreate && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Nueva Orden
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Cargando órdenes…
            </div>
          ) : isError ? (
            <EmptyState
              icon={ClipboardList}
              title="Error al cargar"
              description="No se pudieron cargar las órdenes. Intenta de nuevo."
            />
          ) : orders.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="Sin órdenes de servicio"
              description="Crea la primera orden para iniciar el flujo de autorización."
              action={canCreate ? { label: "Nueva Orden", onClick: () => setCreateOpen(true) } : undefined}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Folio</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead>Sucursal</TableHead>
                  <TableHead>Centro</TableHead>
                  <TableHead>Creada</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => {
                  const statusCfg = STATUS_CONFIG[o.status] ?? { label: o.status, variant: "outline" as const };
                  const urgencyCfg = URGENCY_CONFIG[o.urgency];
                  return (
                    <TableRow
                      key={o.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/dashboard/equipment/compliance/service-orders/${o.id}`)}
                    >
                      <TableCell className="font-mono text-sm">
                        {o.folio.startsWith("DRAFT") ? (
                          <span className="text-muted-foreground">{o.folio}</span>
                        ) : (
                          o.folio
                        )}
                        {urgencyCfg && o.urgency !== "NORMAL" && (
                          <Badge variant="outline" className={`ml-2 ${urgencyCfg.className}`}>
                            {urgencyCfg.label}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{TYPE_LABELS[o.type] ?? o.type}</TableCell>
                      <TableCell>
                        <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(o.amount)}</TableCell>
                      <TableCell>{o.branchName}</TableCell>
                      <TableCell>{o.costCenterCode ?? "-"}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(o.createdAt)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
          <span>Página {page + 1} de {totalPages} · {total} órdenes</span>
          <Button variant="outline" size="icon" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Página anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)} aria-label="Página siguiente">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      <CreateOrderDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </PageContainer>
  );
}

