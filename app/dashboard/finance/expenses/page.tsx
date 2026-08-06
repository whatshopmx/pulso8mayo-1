"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExpenseForm } from "@/components/finance/expense-form";
import { EmptyState } from "@/components/ui/empty-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Receipt, CheckCircle, Clock, XCircle, AlertCircle, Loader2, Shield, ImagePlus, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/hooks/use-session";
import { roleIsAtLeast } from "@/lib/permissions";
import { useBranches } from "@/hooks/use-branches";
import { formatCents } from "@/lib/utils";

// Etiquetas legibles para cada rol aprobador. Debe cubrir todo
// APPROVER_ROLES_HIERARCHY para que "Requiere X" nunca muestre el identificador crudo.
const ROLE_LABELS: Record<string, string> = {
  "SUPER_ADMIN": "Super Admin",
  "OWNER": "Dueño",
  "DIRECTOR_OPS": "Director Ops",
  "ADMIN": "Admin",
  "GERENTE": "Gerente",
  "SUPERVISOR": "Supervisor",
  "EMPLEADO": "Empleado",
  "READONLY": "Solo lectura",
};

interface ExpenseItem {
  id: string;
  companyId: string;
  branchId: string;
  branchName: string;
  category: string;
  amountCents: number;
  description: string;
  evidenceUrl?: string | null;
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "PAID";
  requestedBy?: string | null;
  requestedByName: string | null;
  approvedByName: string | null;
  approvalNotes: string | null;
  requiredApproverRole?: string | null;
  dueDate: string | null;
  createdAt: string;
}

export default function ExpensesPage() {
  const { toast } = useToast();
  const { session } = useSession();
  const currentUserRole = session?.user?.role || "EMPLEADO";
  const currentUserId = session?.user?.id;
  const { branches, loading: loadingBranches } = useBranches();
  const [selectedBranch, setSelectedBranch] = useState<string>("ALL");
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionInFlightId, setActionInFlightId] = useState<string | null>(null);
  /** Gasto y tipo de resolución pendiente de confirmar en el diálogo. */
  const [pendingAction, setPendingAction] = useState<
    { type: "approve" | "reject"; item: ExpenseItem } | null
  >(null);
  const [actionNotes, setActionNotes] = useState("");

  const fetchExpenses = useCallback(async () => {
    setLoading(true);
    try {
      const url = new URL("/api/expenses", window.location.origin);
      if (selectedBranch !== "ALL") {
        url.searchParams.set("branchId", selectedBranch);
      }
      const res = await fetch(url.toString());
      const data = await res.json();
      if (res.ok && data.success) {
        setExpenses(data.data || []);
        setError(null);
      } else {
        setError(data?.error || "No se pudieron cargar los gastos operativos.");
        setExpenses([]);
      }
    } catch (err) {
      console.error("Error fetching expenses:", err);
      setError("Error de conexión al cargar los gastos. Revisa tu red e intenta de nuevo.");
      setExpenses([]);
    } finally {
      setLoading(false);
    }
  }, [selectedBranch]);

  useEffect(() => {
    fetchExpenses();
  }, [fetchExpenses]);

  const openAction = (type: "approve" | "reject", item: ExpenseItem) => {
    setActionNotes("");
    setPendingAction({ type, item });
  };

  const submitAction = async () => {
    if (!pendingAction) return;
    const { type, item } = pendingAction;
    const trimmed = actionNotes.trim();

    // El motivo es obligatorio al rechazar; la nota es opcional al aprobar.
    if (type === "reject" && !trimmed) return;

    setActionInFlightId(item.id);
    try {
      const res = await fetch(
        type === "approve" ? "/api/expenses/approvals" : "/api/expenses/reject",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            type === "approve"
              ? { expenseId: item.id, notes: trimmed || undefined }
              : { expenseId: item.id, reason: trimmed }
          ),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({
          title: type === "approve" ? "Gasto aprobado" : "Gasto rechazado",
          description:
            type === "approve"
              ? "El gasto ha sido aprobado exitosamente."
              : "El gasto fue rechazado y el motivo quedó en la bitácora.",
        });
        fetchExpenses();
      } else {
        toast({
          title: type === "approve" ? "No se pudo aprobar" : "No se pudo rechazar",
          description: data?.error || "El servidor rechazó la operación. Intenta de nuevo.",
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error(`Failed to ${type} expense:`, err);
      toast({
        title: "Error de conexión",
        description: "No se pudo completar la operación. Revisa tu red e intenta de nuevo.",
        variant: "destructive",
      });
    } finally {
      setActionInFlightId(null);
      setPendingAction(null);
      setActionNotes("");
    }
  };

  const renderApproveAction = (item: ExpenseItem) => {
    const requiredRole = item.requiredApproverRole || "OWNER";
    // Afordancia de UX únicamente; la autorización real se aplica en
    // expense-service.ts. Se usa el mismo helper para que no puedan divergir.
    // Rechazar exige la misma autoridad que aprobar.
    const canResolve =
      roleIsAtLeast(currentUserRole, requiredRole) && item.requestedBy !== currentUserId;

    if (!canResolve) {
      return (
        <span className="text-muted-foreground/60 text-[10px] flex flex-col items-center gap-0.5">
          <Shield className="w-3 h-3" />
          <span>Requiere {ROLE_LABELS[requiredRole] || requiredRole}</span>
        </span>
      );
    }

    const busy = actionInFlightId === item.id;

    return (
      <div className="flex items-center justify-center gap-1">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs bg-success/10 text-success hover:bg-success/20 border-success/20"
          onClick={() => openAction("approve", item)}
          disabled={busy}
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : "Aprobar"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs bg-destructive/10 text-destructive hover:bg-destructive/20 border-destructive/20"
          onClick={() => openAction("reject", item)}
          disabled={busy}
        >
          Rechazar
        </Button>
      </div>
    );
  };

  const getStatusBadge = (status: ExpenseItem["status"]) => {
    switch (status) {
      case "APPROVED":
        return (
          <Badge variant="outline" className="bg-success/10 text-success border-success/20 gap-1">
            <CheckCircle className="w-3 h-3" /> Aprobado
          </Badge>
        );
      case "PENDING_APPROVAL":
        return (
          <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20 gap-1">
            <Clock className="w-3 h-3" /> Pendiente
          </Badge>
        );
      case "REJECTED":
        return (
          <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 gap-1">
            <XCircle className="w-3 h-3" /> Rechazado
          </Badge>
        );
      case "PAID":
        return (
          <Badge variant="outline" className="bg-info/10 text-info border-info/20 gap-1">
            <CheckCircle className="w-3 h-3" /> Pagado
          </Badge>
        );
    }
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Receipt className="h-7 w-7 text-primary" /> Gastos Operativos y Autorizaciones
          </h1>
          <p className="text-sm text-muted-foreground">
            Control de gastos por categoría (renta, luz, gas, mantenimientos) con reglas de autorización según monto.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-48">
            <Select value={selectedBranch} onValueChange={setSelectedBranch} disabled={loadingBranches}>
              <SelectTrigger>
                <SelectValue placeholder="Todas las sucursales" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todas las sucursales</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <ExpenseForm branches={branches} onSuccess={fetchExpenses} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-bold">Listado de Gastos Operativos</CardTitle>
          <CardDescription className="text-xs">
            Gastos registrados y su estado actual en la cadena de autorización.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 flex justify-center text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mr-2" /> Cargando gastos operativos...
            </div>
          ) : error ? (
            <EmptyState
              icon={AlertCircle}
              title="No se pudieron cargar los gastos"
              description={error}
              action={
                <Button variant="outline" size="sm" onClick={fetchExpenses}>
                  <RefreshCw className="w-4 h-4 mr-2" /> Reintentar
                </Button>
              }
            />
          ) : expenses.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="Sin gastos operativos registrados"
              description="Registra tu primer gasto operativo (renta, luz, gas, mantenimiento) para iniciar la cadena de autorización."
              action={<ExpenseForm branches={branches} onSuccess={fetchExpenses} />}
            />
          ) : (
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Fecha</TableHead>
                    <TableHead>Sucursal</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead>Descripción</TableHead>
                    <TableHead>Evidencia</TableHead>
                    <TableHead className="text-right">Monto ($)</TableHead>
                    <TableHead>Solicitado por</TableHead>
                    <TableHead>Estatus</TableHead>
                    <TableHead className="text-center">Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expenses.map((item) => (
                    <TableRow key={item.id} className="hover:bg-muted/40 transition text-xs">
                      <TableCell className="font-medium whitespace-nowrap">
                        {new Date(item.createdAt).toLocaleDateString("es-MX", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </TableCell>
                      <TableCell className="font-medium">{item.branchName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs font-normal">
                          {item.category}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium max-w-xs truncate">{item.description}</TableCell>
                      <TableCell>
                        {item.evidenceUrl ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            asChild
                            className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
                          >
                            {/* Ancla real: `window.open` descartaba clic central y "copiar enlace". */}
                            <a href={item.evidenceUrl} target="_blank" rel="noopener noreferrer">
                              <ImagePlus className="w-3.5 h-3.5 text-primary" /> Ver ticket
                            </a>
                          </Button>
                        ) : (
                          <span className="text-muted-foreground/40 text-[10px]">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-bold">{formatCents(item.amountCents)}</TableCell>
                      <TableCell>{item.requestedByName || "Gerente"}</TableCell>
                      <TableCell>{getStatusBadge(item.status)}</TableCell>
                      <TableCell className="text-center">
                        {item.status === "PENDING_APPROVAL" ? (
                          renderApproveAction(item)
                        ) : (
                          <span className="text-muted-foreground/50 text-xs">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Resolution confirmation — irreversible authorization, deliberate gate */}
      <AlertDialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingAction(null);
            setActionNotes("");
          }
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction?.type === "reject" ? "¿Rechazar este gasto?" : "¿Aprobar este gasto?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction?.type === "reject"
                ? "El rechazo es definitivo: para corregir el gasto habrá que registrarlo de nuevo. El motivo queda en la bitácora de autorizaciones."
                : "La aprobación compromete el pago y queda registrada en la bitácora de autorizaciones. Esta acción no se puede deshacer."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {pendingAction && (
            <div className="space-y-2 text-sm">
              <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{pendingAction.item.description}</span>
                {" · "}
                {pendingAction.item.branchName}
                {" · "}
                <span className="font-semibold text-foreground">
                  {formatCents(pendingAction.item.amountCents)}
                </span>
              </div>
              <Label htmlFor="action-notes" className="text-xs">
                {pendingAction.type === "reject" ? "Motivo del rechazo" : "Notas (opcional)"}
              </Label>
              <Textarea
                id="action-notes"
                rows={3}
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
                placeholder={
                  pendingAction.type === "reject"
                    ? "Ej. Falta la factura del proveedor; el monto no coincide con la cotización."
                    : "Ej. Validado contra factura F-1042."
                }
              />
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant={pendingAction?.type === "reject" ? "destructive" : "default"}
              disabled={
                actionInFlightId !== null ||
                (pendingAction?.type === "reject" && actionNotes.trim() === "")
              }
              onClick={(e) => {
                // El diálogo no debe cerrarse antes de conocer el resultado.
                e.preventDefault();
                submitAction();
              }}
            >
              {actionInFlightId !== null ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {pendingAction?.type === "reject" ? "Sí, rechazar" : "Sí, aprobar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
