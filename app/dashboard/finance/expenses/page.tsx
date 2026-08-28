"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExpenseForm } from "@/components/finance/expense-form";
import { EmptyState } from "@/components/ui/empty-state";
import { useFocusedRow } from "@/hooks/use-focused-row";
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
import { useSearchParams } from "next/navigation";
import { Receipt, CheckCircle, Clock, XCircle, AlertCircle, Loader2, Shield, ImagePlus, RefreshCw, Filter } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/hooks/use-session";
import { denyExpenseResolution } from "@/lib/expenses/approval-policy";
import { useBranches } from "@/hooks/queries/use-branches";
import { useBranch } from "@/lib/branch-context";
import { formatCents, statusBadgeClasses } from "@/lib/utils";
import { localDateString } from "@/lib/workflows/today";

/**
 * Roles que pueden capturar un gasto. Misma lista que `ROLES_FINANZAS` en
 * `app/api/expenses/route.ts`: el cliente no inventa autoridad, refleja la del
 * servidor. Un botón que promete lo que la API va a negar es peor que no tenerlo.
 */
// `PUEDEN_CAPTURAR` vivía aquí sin usarse. No se cableó a `ExpenseForm` porque
// sería redundante: `ROUTE_PERMISSIONS` deja entrar a `/dashboard/finance`
// exactamente a esos cuatro roles (`lib/rbac/permissions.ts:127`), así que
// quien puede ver esta pantalla ya puede capturar, y el `POST /api/expenses`
// lo vuelve a exigir del lado del servidor. Una tercera copia de la lista sólo
// añadía un lugar más donde quedar desincronizada.

/** Estatus que puede filtrarse en la cola de autorizaciones. */
type StatusFilter = "ALL" | ExpenseItem["status"];

const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  ALL: "Todos los estatus",
  PENDING_APPROVAL: "Pendientes de aprobar",
  APPROVED: "Aprobados",
  REJECTED: "Rechazados",
  PAID: "Pagados",
};

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
  payeeId?: string | null;
  payeeName?: string | null;
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "PAID";
  requestedBy?: string | null;
  /** Pendiente que nadie puede resolver. Lo calcula el servidor al leer. */
  sinAprobadorPosible?: boolean;
  requestedByName: string | null;
  approvedByName: string | null;
  approvalNotes: string | null;
  requiredApproverRole?: string | null;
  dueDate: string | null;
  createdAt: string;
}

/**
 * ¿Este gasto ya venció?
 *
 * Sólo tiene sentido para lo que sigue debiéndose: un gasto pagado o rechazado
 * no "vence". La fecha se ancla al mediodía UTC para que ningún huso mueva el
 * día, y hoy se calcula con `localDateString` — en UTC-6, `toISOString()`
 * después de las 6pm adelanta la fecha y un gasto salta a "vencido" una tarde
 * antes de tiempo.
 */
function estaVencido(item: ExpenseItem): boolean {
  if (!item.dueDate) return false;
  if (item.status === "PAID" || item.status === "REJECTED") return false;
  return item.dueDate < localDateString(new Date(), null);
}

export default function ExpensesPage() {
  // `useFocusedRow` usa `useSearchParams`, que exige límite de Suspense.
  return (
    <Suspense>
      <ExpensesContent />
    </Suspense>
  );
}

function ExpensesContent() {
  const { toast } = useToast();
  const { session } = useSession();
  const currentUserRole = session?.user?.role || "EMPLEADO";
  const currentUserId = session?.user?.id;
  const { data: branchesData } = useBranches();
  const branches = branchesData ?? [];
  // Scope único: el control del encabezado. El Select local contestaba sobre
  // "todas" mientras el header seguía anunciando una sucursal concreta.
  const { selectedBranchId } = useBranch();
  const selectedBranch = selectedBranchId ?? "ALL";
  const searchParams = useSearchParams();
  const payeeId = searchParams.get("payeeId");
  const { focusId, focusProps } = useFocusedRow();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    focusId || payeeId ? "ALL" : "PENDING_APPROVAL"
  );
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  /** Alcance **aplicado** por el servidor, no el pedido. */
  const [scope, setScope] = useState<{
    branchId: string | null;
    branchName: string | null;
    /** `NONE` = rol acotado a sucursal sin ninguna asignada; no es "sin gastos". */
    kind?: "ALL" | "BRANCH" | "NONE";
  } | null>(null);
  /** Hubo historial que no cupo en la cota del servidor. */
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionInFlightId, setActionInFlightId] = useState<string | null>(null);
  /** Gasto y tipo de resolución pendiente de confirmar en el diálogo. */
  const [pendingAction, setPendingAction] = useState<
    { type: "approve" | "reject"; item: ExpenseItem } | null
  >(null);
  const [actionNotes, setActionNotes] = useState("");

  /**
   * `silent` evita el spinner al recargar tras aprobar o rechazar: desmontar la
   * tabla devolvía el scroll al inicio, así que una sesión de 30 aprobaciones
   * perdía su lugar 30 veces.
   */
  const fetchExpenses = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const url = new URL("/api/expenses", window.location.origin);
      if (selectedBranch !== "ALL") {
        url.searchParams.set("branchId", selectedBranch);
      }
      if (payeeId) {
        url.searchParams.set("payeeId", payeeId);
      }
      const res = await fetch(url.toString());
      const data = await res.json();
      if (res.ok && data.success) {
        setExpenses(data.data?.items || []);
        setScope(data.data?.scope ?? null);
        setTruncated(Boolean(data.data?.truncated));
        setError(null);
      } else {
        setError(data?.error || "No se pudieron cargar los gastos operativos.");
        setExpenses([]);
        setScope(null);
        setTruncated(false);
      }
    } catch (err) {
      console.error("Error fetching expenses:", err);
      setError("Error de conexión al cargar los gastos. Revisa tu red e intenta de nuevo.");
      setExpenses([]);
    } finally {
      setLoading(false);
    }
  }, [selectedBranch, payeeId]);

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
        fetchExpenses(true);
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
    // El rol exigido lo decide el servidor con la escalera de la empresa. Aquí
    // había un `|| "OWNER"` que era una segunda opinión sobre la autoridad del
    // mismo gasto, y no coincidía con la del servicio.
    const requiredRole = item.requiredApproverRole || "GERENTE";
    // Afordancia de UX únicamente; la autorización real se aplica en
    // expense-service.ts — que desde A16 evalúa **esta misma función**, no una
    // copia parecida. Antes la pantalla escondía el botón de aprobar lo propio
    // mientras el servidor lo permitía (y hasta auto-aprobaba al crear); ahora
    // las dos derivan de `denyExpenseResolution`. Rechazar exige lo mismo que
    // aprobar: sacar un gasto de la cola es resolverlo.
    const denegado = denyExpenseResolution({
      actorRole: currentUserRole,
      actorId: currentUserId,
      requiredApproverRole: requiredRole,
      requestedBy: item.requestedBy,
    });

    // Los dos motivos se dicen distinto. Con un solo mensaje, a quien registró
    // el gasto se le contestaba "Requiere OWNER" —que suena a que le falta
    // rango— cuando lo que pasa es que nadie firma lo suyo.
    if (denegado === "ROLE") {
      return (
        <span className="text-muted-foreground/60 text-xs flex flex-col items-center gap-0.5">
          <Shield className="w-3 h-3" />
          <span>Requiere {ROLE_LABELS[requiredRole] || requiredRole}</span>
        </span>
      );
    }

    // Que sea tuyo no es lo peor que puede pasarle a la fila: si además nadie
    // más alcanza el rol, el gasto no está esperando a alguien — está atascado.
    if (denegado === "SELF" && item.sinAprobadorPosible) {
      return (
        <span className="text-warning-text text-xs flex flex-col items-center gap-0.5">
          <AlertCircle className="w-3 h-3" />
          <span>Sin aprobador</span>
        </span>
      );
    }

    if (denegado === "SELF") {
      return (
        <span className="text-muted-foreground/60 text-xs flex flex-col items-center gap-0.5">
          <Shield className="w-3 h-3" />
          <span>Lo registraste tú</span>
        </span>
      );
    }

    const busy = actionInFlightId === item.id;

    return (
      // 28px de alto quedaba muy por debajo del mínimo táctil, y esta es la
      // acción que un gerente resuelve desde el teléfono en la cocina.
      <div className="flex items-center justify-center gap-1">
        <Button
          size="sm"
          variant="outline"
          className="h-9 text-xs bg-success/10 text-success hover:bg-success/20 border-success/20"
          onClick={() => openAction("approve", item)}
          disabled={busy}
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : "Aprobar"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-9 text-xs bg-destructive/10 text-destructive hover:bg-destructive/20 border-destructive/20"
          onClick={() => openAction("reject", item)}
          disabled={busy}
        >
          Rechazar
        </Button>
      </div>
    );
  };

  const visibleExpenses =
    statusFilter === "ALL" ? expenses : expenses.filter((e) => e.status === statusFilter);

  /**
   * Se llegó por un enlace a un gasto que no está en lo que se cargó.
   *
   * Puede pasar aunque el filtro no lo esconda: la lista está acotada —la cola
   * de pendientes viene completa, el historial resuelto no (A10)— así que un
   * gasto viejo puede quedar fuera. Sin este aviso la pantalla se ve normal y
   * la persona busca en vano una fila resaltada que nunca estuvo.
   */
  /** Pendientes que nadie puede resolver. El servidor los marca al leer. */
  const atascados = expenses.filter((e) => e.sinAprobadorPosible).length;

  const enlaceSinDestino =
    !loading && !error && focusId !== null && !expenses.some((e) => e.id === focusId);

  const getStatusBadge = (status: ExpenseItem["status"]) => {
    switch (status) {
      case "APPROVED":
        return (
          <Badge variant="outline" className={`gap-1 ${statusBadgeClasses("success")}`}>
            <CheckCircle className="w-3 h-3" /> Aprobado
          </Badge>
        );
      case "PENDING_APPROVAL":
        return (
          <Badge variant="outline" className={`gap-1 ${statusBadgeClasses("warning")}`}>
            <Clock className="w-3 h-3" /> Pendiente
          </Badge>
        );
      case "REJECTED":
        return (
          <Badge variant="outline" className={`gap-1 ${statusBadgeClasses("destructive")}`}>
            <XCircle className="w-3 h-3" /> Rechazado
          </Badge>
        );
      case "PAID":
        return (
          <Badge variant="outline" className={`gap-1 ${statusBadgeClasses("info")}`}>
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

        {/* `flex-wrap` y anchos flexibles: en un teléfono el select de 208 px
            fijo más el botón no caben en la fila, y la pantalla se iba a scroll
            horizontal. El encabezado es de dos controles, no de una barra que
            haya que arrastrar de lado. */}
        <div className="flex w-full shrink-0 flex-wrap items-center gap-3 md:w-auto">
          {/* La sucursal la fija el encabezado; lo que faltaba aquí era poder
              aislar la cola de pendientes sin cazar insignias ámbar entre todo
              el historial. */}
          <div className="w-full sm:w-52">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger aria-label="Filtrar por estatus" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(STATUS_FILTER_LABELS) as StatusFilter[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {STATUS_FILTER_LABELS[key]}
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
          {payeeId && (
            <div className="mt-2 bg-primary/10 border border-primary/20 rounded-md p-3 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-primary shrink-0" />
                <span>
                  Filtrando por contraparte:{" "}
                  <strong className="font-semibold text-foreground">
                    {expenses.find((e) => e.payeeId === payeeId)?.payeeName || "Contraparte seleccionada"}
                  </strong>
                </span>
              </div>
              <Button variant="ghost" size="sm" className="h-7 text-xs px-2 hover:bg-primary/20" asChild>
                <Link href="/dashboard/finance/expenses">Limpiar filtro</Link>
              </Button>
            </div>
          )}

          {/* El alcance **aplicado**, no el pedido: un GERENTE que pide otra
              sucursal recibe la suya, y rotular la que pidió sería etiquetar
              cifras de una sucursal con el nombre de otra. La ruta ya lo
              devolvía; esta pantalla no lo pintaba. */}
          {!loading && !error && scope && (
            <p className="text-xs text-muted-foreground">
              Alcance aplicado:{" "}
              <span className="font-medium text-foreground">
                {scope.kind === "NONE"
                  ? "ninguna sucursal"
                  : scope.branchName ?? "todas las sucursales"}
              </span>
              .
            </p>
          )}

          {/* El historial viene acotado a propósito (la cola de pendientes no).
              Decirlo evita leer una lista recortada como si fuera completa,
              igual que hace Control Interno. */}
          {!loading && !error && truncated && (
            <p className="text-xs text-warning-text">
              El historial de gastos resueltos está acotado: se muestran los más recientes.
              La cola de pendientes se muestra completa.
            </p>
          )}

          {/* El aviso que hacía falta: gastos que no esperan a nadie porque
              nadie alcanza el rol. Antes esto sólo existía como `console.warn`
              en el servidor, así que la cola parecía trabajo pendiente cuando
              en realidad era un problema de configuración. */}
          {!loading && !error && atascados > 0 && (
            <p className="text-xs text-warning-text flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>
                {atascados === 1
                  ? "1 gasto no tiene a nadie que pueda aprobarlo"
                  : `${atascados} gastos no tienen a nadie que pueda aprobarlos`}
                : quien los registró es el único con el rol requerido, y desde la
                segregación de funciones nadie firma lo suyo. Da de alta a otro
                aprobador o ajusta los umbrales en{" "}
                <Link href="/dashboard/company" className="underline underline-offset-2 font-medium">
                  Organización
                </Link>
                .
              </span>
            </p>
          )}

          {/* Se llegó por un enlace y el gasto no está en lo que se cargó. Sin
              esto la pantalla se ve normal y la persona busca en vano la fila
              resaltada que le prometió el enlace de donde venía. */}
          {enlaceSinDestino && (
            <p className="text-xs text-warning-text flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>
                El gasto al que te trajo el enlace no está en este listado. Puede pertenecer a
                otra sucursal o haber quedado fuera del historial acotado — prueba con el alcance
                &quot;Todas&quot; en el encabezado.
              </span>
            </p>
          )}
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
                <Button variant="outline" size="sm" onClick={() => fetchExpenses()}>
                  <RefreshCw className="w-4 h-4 mr-2" /> Reintentar
                </Button>
              }
            />
          ) : scope?.kind === "NONE" ? (
            /* Fail-closed con explicación: tu usuario no alcanza ninguna
               sucursal. Decirlo con "sin gastos registrados" haría que quien
               mira concluya que la empresa no gasta nada. */
            <EmptyState
              icon={AlertCircle}
              title="Tu usuario no tiene una sucursal asignada"
              description="Los gastos se consultan por sucursal y tu rol está acotado a una, pero no tienes ninguna. Pídele a un administrador que te asigne la tuya."
            />
          ) : expenses.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="Sin gastos operativos registrados"
              description="Registra tu primer gasto operativo (renta, luz, gas, mantenimiento) para iniciar la cadena de autorización."
              action={<ExpenseForm branches={branches} onSuccess={fetchExpenses} />}
            />
          ) : visibleExpenses.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title={`Sin gastos ${STATUS_FILTER_LABELS[statusFilter].toLowerCase()}`}
              description="Hay gastos registrados, pero ninguno con este estatus en la sucursal en foco."
              action={
                <Button variant="outline" size="sm" onClick={() => setStatusFilter("ALL")}>
                  Ver todos los estatus
                </Button>
              }
            />
          ) : (
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableCaption className="sr-only">
                  Gastos operativos: fecha, sucursal, categoría, contraparte, descripción,
                  evidencia, monto, quién lo solicitó, estatus de autorización y acción
                  disponible.
                </TableCaption>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Fecha</TableHead>
                    <TableHead>Sucursal</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead>Contraparte</TableHead>
                    <TableHead>Descripción</TableHead>
                    <TableHead>Evidencia</TableHead>
                    <TableHead className="text-right">Monto ($)</TableHead>
                    <TableHead>Solicitado por</TableHead>
                    <TableHead>Estatus</TableHead>
                    <TableHead className="text-center">Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleExpenses.map((item) => (
                    <TableRow
                      key={item.id}
                      {...focusProps(item.id, "hover:bg-muted/40 transition text-xs")}
                    >
                      <TableCell className="font-medium whitespace-nowrap">
                        {new Date(item.createdAt).toLocaleDateString("es-MX", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                        {/* `dueDate` estaba en la interfaz y no se pintaba, pero es
                            lo que decide si un gasto está vencido: la cola no
                            mostraba lo único que la ordena por urgencia. */}
                        {item.dueDate && (
                          <span
                            className={`block text-xs font-normal ${
                              estaVencido(item) ? "text-destructive" : "text-muted-foreground"
                            }`}
                          >
                            {estaVencido(item) ? "Venció" : "Vence"} el{" "}
                            {new Date(`${item.dueDate}T12:00:00Z`).toLocaleDateString("es-MX", {
                              day: "numeric",
                              month: "short",
                            })}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{item.branchName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs font-normal">
                          {item.category}
                        </Badge>
                      </TableCell>
                      {/* Los gastos históricos sin contraparte muestran "—": no se
                          inventa un beneficiario retroactivo. Los gastos con payee
                          dado de baja siguen mostrando el nombre congelado. */}
                      <TableCell className="whitespace-nowrap">
                        {item.payeeName ? (
                          <span className="font-medium">{item.payeeName}</span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
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
                          <span className="text-muted-foreground/40 text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-bold">{formatCents(item.amountCents)}</TableCell>
                      {/* Sin nombre real no se inventa uno: esta columna alimenta la
                          bitácora de autorizaciones y un auditor la lee como un hecho. */}
                      <TableCell>
                        {item.requestedByName || (
                          <span className="text-muted-foreground/70">Sin registrar</span>
                        )}
                      </TableCell>
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
