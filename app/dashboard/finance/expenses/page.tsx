"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExpenseForm } from "@/components/finance/expense-form";
import { Receipt, CheckCircle, Clock, XCircle, AlertCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Branch {
  id: string;
  name: string;
}

interface ExpenseItem {
  id: string;
  companyId: string;
  branchId: string;
  branchName: string;
  category: string;
  amountCents: number;
  description: string;
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "PAID";
  requestedByName: string | null;
  approvedByName: string | null;
  approvalNotes: string | null;
  dueDate: string | null;
  createdAt: string;
}

export default function ExpensesPage() {
  const { toast } = useToast();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>("ALL");
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [approvingId, setApprovingId] = useState<string | null>(null);

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
      }
    } catch (err) {
      console.error("Error fetching expenses:", err);
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
      if (res.ok) {
        toast({ title: "Gasto Aprobado", description: "El gasto ha sido aprobado exitosamente." });
        fetchExpenses();
      }
    } catch (err) {
      console.error("Failed to approve expense:", err);
    } finally {
      setApprovingId(null);
    }
  };

  const formatMXN = (cents: number) =>
    (cents / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });

  const getStatusBadge = (status: ExpenseItem["status"]) => {
    switch (status) {
      case "APPROVED":
        return (
          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 gap-1">
            <CheckCircle className="w-3 h-3" /> Aprobado
          </Badge>
        );
      case "PENDING_APPROVAL":
        return (
          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 gap-1">
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
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 gap-1">
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
          ) : expenses.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-xs">
              Sin gastos operativos registrados en esta sucursal.
            </div>
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
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-emerald-200"
                            onClick={() => handleApprove(item.id)}
                            disabled={approvingId === item.id}
                          >
                            {approvingId === item.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              "Aprobar"
                            )}
                          </Button>
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
    </div>
  );
}
