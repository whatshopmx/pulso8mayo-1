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
import { Receipt, CheckCircle, Clock, XCircle, AlertCircle, Loader2, Shield } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/hooks/use-session";

interface Branch {
  id: string;
  name: string;
}

const ROLE_HIERARCHY: Record<string, number> = {
  "SUPER_ADMIN": 100,
  "OWNER": 95,
  "ADMIN": 90,
  "GERENTE": 80,
  "SUPERVISOR": 50,
  "EMPLEADO": 10,
  "READONLY": 0,
};

const ROLE_LABELS: Record<string, string> = {
  "OWNER": "Dueño",
  "DIRECTOR_OPS": "Director Ops",
  "ADMIN": "Admin",
  "GERENTE": "Gerente",
  "SUPERVISOR": "Supervisor",
};

interface ExpenseItem {
  id: string;
  companyId: string;
  branchId: string;
  branchName: string;
  category: string;
  amountCents: number;
  description: string;
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
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>("ALL");
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchBranches() {
      try {
        const res = await fetch("/api/branches");
        const data = await res.json();
        const list = data.data || data.branches || (Array.isArray(data) ? data : []);
        setBranches(list);
      } catch (err) {
        console.error("Error fetching branches:", err);
      }
    }
    fetchBranches();
  }, []);

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

  const handleApprove = async (id: string) => {
    setApprovingId(id);
    try {
      const res = await fetch("/api/expenses/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expenseId: id, notes: "Aprobado por administración" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({ title: "Gasto Aprobado", description: "El gasto ha sido aprobado exitosamente." });
        fetchExpenses();
      } else {
        toast({
          title: "No se pudo aprobar",
          description: data?.error || "El servidor rechazó la aprobación. Intenta de nuevo.",
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error("Failed to approve expense:", err);
      toast({
        title: "Error de conexión",
        description: "No se pudo completar la aprobación. Revisa tu red e intenta de nuevo.",
        variant: "destructive",
      });
    } finally {
      setApprovingId(null);
      setConfirmId(null);
    }
  };

  const renderApproveAction = (item: ExpenseItem) => {
    const requiredRole = item.requiredApproverRole || "OWNER";
    const userLevel = ROLE_HIERARCHY[currentUserRole] ?? 0;
    const requiredLevel = ROLE_HIERARCHY[requiredRole] ?? 0;
    const canApprove = userLevel >= requiredLevel && item.requestedBy !== currentUserId;

    if (!canApprove) {
      return (
        <span className="text-muted-foreground/60 text-[10px] flex flex-col items-center gap-0.5">
          <Shield className="w-3 h-3" />
          <span>Requiere {ROLE_LABELS[requiredRole] || requiredRole}</span>
        </span>
      );
    }

    return (
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs bg-success/10 text-success hover:bg-success/20 border-success/20"
        onClick={() => setConfirmId(item.id)}
        disabled={approvingId === item.id}
      >
        {approvingId === item.id ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          "Aprobar"
        )}
      </Button>
    );
  };

  const formatMXN = (cents: number) =>
    (cents / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });

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
            <Select value={selectedBranch} onValueChange={setSelectedBranch}>
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
                  <Loader2 className="w-4 h-4 mr-2" /> Reintentar
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
                      <TableCell className="text-right font-bold">{formatMXN(item.amountCents)}</TableCell>
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

      {/* Approve confirmation — irreversible authorization, deliberate gate */}
      <AlertDialog open={confirmId !== null} onOpenChange={(open) => !open && setConfirmId(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Aprobar este gasto?</AlertDialogTitle>
            <AlertDialogDescription>
              La aprobación compromete el pago y queda registrada en la bitácora de autorizaciones. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="default"
              disabled={approvingId === confirmId}
              onClick={() => confirmId && handleApprove(confirmId)}
            >
              {approvingId === confirmId ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              Sí, aprobar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
