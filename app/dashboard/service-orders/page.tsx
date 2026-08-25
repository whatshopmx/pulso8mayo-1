"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { PageHeader, PageContainer, EmptyState } from "@/components/shared";
import {
  useServiceOrders,
  useCreateServiceOrder,
  useCostCenters,
} from "@/hooks/queries";
import { useSession } from "@/hooks/use-session";
import { useBranch } from "@/lib/branch-context";
import { roleIsAtLeast } from "@/lib/permissions";
import { Plus, Loader2, ClipboardList, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";

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

const TYPE_LABELS: Record<string, string> = {
  CORRECTIVO: "Correctivo",
  PREVENTIVO: "Preventivo",
  CONTRACTUAL: "Contractual",
  EXTRAORDINARIO: "Extraordinario",
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
  const { session } = useSession();
  const canCreate = !!session?.user?.role && roleIsAtLeast(session.user.role, "SUPERVISOR");

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, isError } = useServiceOrders({
    status: statusFilter === "all" ? undefined : statusFilter,
    type: typeFilter === "all" ? undefined : typeFilter,
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
                      onClick={() => router.push(`/dashboard/service-orders/${o.id}`)}
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

function CreateOrderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const createMutation = useCreateServiceOrder();
  const { data: ccData } = useCostCenters();
  const { session } = useSession();
  const { selectedBranchId, branches } = useBranch();
  // GERENTE/SUPERVISOR tienen sucursal fija por sesión; el servidor la impone igual.
  const branchFixed = !!session?.user?.role && ["GERENTE", "SUPERVISOR"].includes(session.user.role);

  const [type, setType] = useState("CORRECTIVO");
  const [urgency, setUrgency] = useState("NORMAL");
  const [scope, setScope] = useState("");
  const [justification, setJustification] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [branchId, setBranchId] = useState(selectedBranchId ?? branches[0]?.id ?? "");

  const cents = Math.round(parseFloat(amountStr || "0") * 100);

  const submit = async () => {
    if (!branchId || !type || !cents) {
      toast.error("Indica sucursal, tipo y un monto mayor a cero");
      return;
    }
    try {
      const result = await createMutation.mutateAsync({
        branchId,
        type,
        urgency,
        scope: scope || undefined,
        justification: justification || undefined,
        amount: cents,
        costCenterId: costCenterId || undefined,
      });
      toast.success("Borrador creado");
      onClose();
      const id = result?.order?.id;
      if (id) router.push(`/dashboard/service-orders/${id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al crear la orden");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva Orden de Servicio</DialogTitle>
          <DialogDescription>
            El borrador usa folio temporal; el folio definitivo se emite al enviar a aprobación.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="so-type">Tipo</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="so-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="so-urgency">Urgencia</Label>
              <Select value={urgency} onValueChange={setUrgency}>
                <SelectTrigger id="so-urgency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NORMAL">Normal</SelectItem>
                  <SelectItem value="URGENTE">Urgente</SelectItem>
                  <SelectItem value="EMERGENCIA">Emergencia</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="so-branch">Sucursal</Label>
            <Select value={branchId || undefined} onValueChange={setBranchId} disabled={branchFixed}>
              <SelectTrigger id="so-branch"><SelectValue placeholder="Selecciona…" /></SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="so-amount">Monto (MXN)</Label>
              <Input
                id="so-amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value.replace(/[^0-9.]/g, ""))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="so-cc">Centro de costo</Label>
              <Select value={costCenterId || undefined} onValueChange={setCostCenterId}>
                <SelectTrigger id="so-cc"><SelectValue placeholder="Selecciona…" /></SelectTrigger>
                <SelectContent>
                  {(ccData?.costCenters ?? []).map((cc) => (
                    <SelectItem key={cc.id} value={cc.id}>
                      {cc.code} · {cc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="so-scope">Alcance del servicio</Label>
            <Input id="so-scope" value={scope} onChange={(e) => setScope(e.target.value)} placeholder="¿Qué trabajo se realizará?" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="so-just">Justificación</Label>
            <Textarea id="so-just" value={justification} onChange={(e) => setJustification(e.target.value)} rows={2} placeholder="Motivo del servicio" />
          </div>

          {urgency !== "EMERGENCIA" && !costCenterId && (
            <p className="text-xs text-muted-foreground">
              Sin centro de costo no se podrá validar presupuesto al enviar (las emergencias lo omiten).
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={createMutation.isPending}>
            {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Crear borrador
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
