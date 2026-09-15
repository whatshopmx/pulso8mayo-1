"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Plus, FileCheck, Users, Receipt, Wallet, Search, X, CheckSquare, Layers } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { formatCents } from "@/lib/utils";

export function AddPaymentRunItemModal({
  runId,
  branchId,
  onInvoiceAdded
}: {
  runId: string;
  branchId?: string | null;
  onInvoiceAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [payrollRuns, setPayrollRuns] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(false);
  const [isLoadingPayroll, setIsLoadingPayroll] = useState(false);
  const [isLoadingExpenses, setIsLoadingExpenses] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [isBatchAdding, setIsBatchAdding] = useState(false);
  const [activeTab, setActiveTab] = useState("invoices");
  const [searchQuery, setSearchQuery] = useState("");

  // Selection states per tab
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<string[]>([]);
  const [selectedPayrollIds, setSelectedPayrollIds] = useState<string[]>([]);

  const fetchInvoices = async () => {
    setIsLoadingInvoices(true);
    try {
      const url = branchId ? `/api/finance/treasury/invoices/unpaid?branchId=${branchId}` : "/api/finance/treasury/invoices/unpaid";
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se pudieron cargar las facturas");
      setInvoices(json.data || []);
    } catch (error: any) {
      toast.error("Error", {
        description: error.message || "No se pudieron cargar las facturas pendientes.",
      });
    } finally {
      setIsLoadingInvoices(false);
    }
  };

  const fetchPayrollRuns = async () => {
    setIsLoadingPayroll(true);
    try {
      const url = branchId ? `/api/finance/treasury/payroll/unpaid?branchId=${branchId}` : "/api/finance/treasury/payroll/unpaid";
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se pudieron cargar las nóminas");
      setPayrollRuns(json.data || []);
    } catch (error: any) {
      toast.error("Error", {
        description: error.message || "No se pudieron cargar las nóminas pendientes.",
      });
    } finally {
      setIsLoadingPayroll(false);
    }
  };

  const fetchExpenses = async () => {
    setIsLoadingExpenses(true);
    try {
      const url = branchId ? `/api/finance/treasury/expenses/unpaid?branchId=${branchId}` : "/api/finance/treasury/expenses/unpaid";
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se pudieron cargar los gastos operativos");
      setExpenses(json.data || []);
    } catch (error: any) {
      toast.error("Error", {
        description: error.message || "No se pudieron cargar los gastos operativos pendientes.",
      });
    } finally {
      setIsLoadingExpenses(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (newOpen) {
      setSearchQuery("");
      setSelectedInvoiceIds([]);
      setSelectedExpenseIds([]);
      setSelectedPayrollIds([]);
      if (activeTab === "invoices") fetchInvoices();
      else if (activeTab === "expenses") fetchExpenses();
      else if (activeTab === "payroll") fetchPayrollRuns();
    }
  };

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setSearchQuery("");
    if (tab === "invoices" && invoices.length === 0) fetchInvoices();
    if (tab === "expenses" && expenses.length === 0) fetchExpenses();
    if (tab === "payroll" && payrollRuns.length === 0) fetchPayrollRuns();
  };

  // Filtered lists
  const filteredInvoices = useMemo(() => {
    if (!searchQuery.trim()) return invoices;
    const q = searchQuery.toLowerCase();
    return invoices.filter(
      (inv) =>
        (inv.folio && inv.folio.toLowerCase().includes(q)) ||
        (inv.nombreEmisor && inv.nombreEmisor.toLowerCase().includes(q)) ||
        (inv.rfcEmisor && inv.rfcEmisor.toLowerCase().includes(q)) ||
        (inv.uuid && inv.uuid.toLowerCase().includes(q))
    );
  }, [invoices, searchQuery]);

  const filteredExpenses = useMemo(() => {
    if (!searchQuery.trim()) return expenses;
    const q = searchQuery.toLowerCase();
    return expenses.filter(
      (exp) =>
        (exp.description && exp.description.toLowerCase().includes(q)) ||
        (exp.payeeName && exp.payeeName.toLowerCase().includes(q)) ||
        (exp.category && exp.category.toLowerCase().includes(q))
    );
  }, [expenses, searchQuery]);

  const filteredPayrollRuns = useMemo(() => {
    if (!searchQuery.trim()) return payrollRuns;
    const q = searchQuery.toLowerCase();
    return payrollRuns.filter(
      (pr) =>
        (pr.branchName && pr.branchName.toLowerCase().includes(q)) ||
        (pr.periodStart && pr.periodStart.toLowerCase().includes(q)) ||
        (pr.periodEnd && pr.periodEnd.toLowerCase().includes(q))
    );
  }, [payrollRuns, searchQuery]);

  // Checkbox helpers
  const toggleSelectAllInvoices = () => {
    if (selectedInvoiceIds.length === filteredInvoices.length) {
      setSelectedInvoiceIds([]);
    } else {
      setSelectedInvoiceIds(filteredInvoices.map((i) => i.id));
    }
  };

  const toggleSelectInvoice = (id: string) => {
    setSelectedInvoiceIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAllExpenses = () => {
    if (selectedExpenseIds.length === filteredExpenses.length) {
      setSelectedExpenseIds([]);
    } else {
      setSelectedExpenseIds(filteredExpenses.map((e) => e.id));
    }
  };

  const toggleSelectExpense = (id: string) => {
    setSelectedExpenseIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAllPayroll = () => {
    if (selectedPayrollIds.length === filteredPayrollRuns.length) {
      setSelectedPayrollIds([]);
    } else {
      setSelectedPayrollIds(filteredPayrollRuns.map((p) => p.id));
    }
  };

  const toggleSelectPayroll = (id: string) => {
    setSelectedPayrollIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  // Active selections & totals
  const currentSelectionCount = useMemo(() => {
    if (activeTab === "invoices") return selectedInvoiceIds.length;
    if (activeTab === "expenses") return selectedExpenseIds.length;
    if (activeTab === "payroll") return selectedPayrollIds.length;
    return 0;
  }, [activeTab, selectedInvoiceIds, selectedExpenseIds, selectedPayrollIds]);

  const currentSelectionTotalCents = useMemo(() => {
    if (activeTab === "invoices") {
      return invoices
        .filter((inv) => selectedInvoiceIds.includes(inv.id))
        .reduce((acc, inv) => acc + (inv.total || 0), 0);
    }
    if (activeTab === "expenses") {
      return expenses
        .filter((exp) => selectedExpenseIds.includes(exp.id))
        .reduce((acc, exp) => acc + (exp.amount || 0), 0);
    }
    if (activeTab === "payroll") {
      return payrollRuns
        .filter((pr) => selectedPayrollIds.includes(pr.id))
        .reduce((acc, pr) => acc + (pr.totalAmountCents || 0), 0);
    }
    return 0;
  }, [activeTab, invoices, expenses, payrollRuns, selectedInvoiceIds, selectedExpenseIds, selectedPayrollIds]);

  // Single Adders
  const addInvoice = async (invoice: any) => {
    setAddingId(invoice.id);
    try {
      const res = await fetch(`/api/finance/treasury/runs/${runId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemType: "INVOICE",
          referenceId: invoice.id,
          notes: `Folio: ${invoice.folio || "S/F"} - ${invoice.nombreEmisor || invoice.rfcEmisor || "Proveedor"}`,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al agregar factura a la corrida.");

      toast.success("Factura agregada", {
        description: `Folio ${invoice.folio || invoice.uuid?.slice(0, 8)} adjuntado exitosamente.`,
      });

      setInvoices((prev) => prev.filter((inv) => inv.id !== invoice.id));
      setSelectedInvoiceIds((prev) => prev.filter((id) => id !== invoice.id));
      onInvoiceAdded();
    } catch (error: any) {
      toast.error("Error al agregar", {
        description: error.message,
      });
    } finally {
      setAddingId(null);
    }
  };

  const addExpense = async (expense: any) => {
    setAddingId(expense.id);
    try {
      const res = await fetch(`/api/finance/treasury/runs/${runId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemType: "OPERATING_EXPENSE",
          referenceId: expense.id,
          notes: `${expense.description} — ${expense.payeeName || expense.category}`,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al agregar el gasto a la corrida.");

      toast.success("Gasto agregado", {
        description: `"${expense.description}" adjuntado exitosamente.`,
      });

      setExpenses((prev) => prev.filter((e) => e.id !== expense.id));
      setSelectedExpenseIds((prev) => prev.filter((id) => id !== expense.id));
      onInvoiceAdded();
    } catch (error: any) {
      toast.error("Error al agregar", {
        description: error.message,
      });
    } finally {
      setAddingId(null);
    }
  };

  const addPayroll = async (payroll: any) => {
    setAddingId(payroll.id);
    try {
      const amountCents = payroll.totalAmountCents || 0;
      if (amountCents <= 0) {
        toast.error("Nómina sin monto", { description: "Esta corrida de nómina no tiene percepciones calculadas." });
        return;
      }

      const res = await fetch(`/api/finance/treasury/runs/${runId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemType: "PAYROLL",
          referenceId: payroll.id,
          notes: `Nómina (${payroll.branchName || "Sucursal"}) - Período ${payroll.periodStart} al ${payroll.periodEnd}`,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al agregar nómina a la corrida.");

      toast.success("Nómina agregada", {
        description: `Nómina de ${payroll.branchName} adjuntada exitosamente.`,
      });

      setPayrollRuns((prev) => prev.filter((p) => p.id !== payroll.id));
      setSelectedPayrollIds((prev) => prev.filter((id) => id !== payroll.id));
      onInvoiceAdded();
    } catch (error: any) {
      toast.error("Error al agregar", {
        description: error.message,
      });
    } finally {
      setAddingId(null);
    }
  };

  // Batch Adder
  const handleBatchAdd = async () => {
    if (currentSelectionCount === 0) return;
    setIsBatchAdding(true);

    try {
      if (activeTab === "invoices") {
        const itemsToAdd = invoices.filter((i) => selectedInvoiceIds.includes(i.id));
        let successCount = 0;

        for (const item of itemsToAdd) {
          try {
            const res = await fetch(`/api/finance/treasury/runs/${runId}/items`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                itemType: "INVOICE",
                referenceId: item.id,
                notes: `Folio: ${item.folio || "S/F"} - ${item.nombreEmisor || item.rfcEmisor || "Proveedor"}`,
              }),
            });
            if (res.ok) successCount++;
          } catch (e) {
            console.error(e);
          }
        }

        toast.success("Facturas adjuntadas en lote", {
          description: `Se agregaron ${successCount} facturas a la corrida.`,
        });

        setInvoices((prev) => prev.filter((inv) => !selectedInvoiceIds.includes(inv.id)));
        setSelectedInvoiceIds([]);
      } else if (activeTab === "expenses") {
        const itemsToAdd = expenses.filter((e) => selectedExpenseIds.includes(e.id));
        let successCount = 0;

        for (const item of itemsToAdd) {
          try {
            const res = await fetch(`/api/finance/treasury/runs/${runId}/items`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                itemType: "OPERATING_EXPENSE",
                referenceId: item.id,
                notes: `${item.description} — ${item.payeeName || item.category}`,
              }),
            });
            if (res.ok) successCount++;
          } catch (e) {
            console.error(e);
          }
        }

        toast.success("Gastos adjuntados en lote", {
          description: `Se agregaron ${successCount} gastos a la corrida.`,
        });

        setExpenses((prev) => prev.filter((exp) => !selectedExpenseIds.includes(exp.id)));
        setSelectedExpenseIds([]);
      } else if (activeTab === "payroll") {
        const itemsToAdd = payrollRuns.filter((p) => selectedPayrollIds.includes(p.id));
        let successCount = 0;

        for (const item of itemsToAdd) {
          try {
            const res = await fetch(`/api/finance/treasury/runs/${runId}/items`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                itemType: "PAYROLL",
                referenceId: item.id,
                notes: `Nómina (${item.branchName || "Sucursal"}) - Período ${item.periodStart} al ${item.periodEnd}`,
              }),
            });
            if (res.ok) successCount++;
          } catch (e) {
            console.error(e);
          }
        }

        toast.success("Nóminas adjuntadas en lote", {
          description: `Se agregaron ${successCount} nóminas a la corrida.`,
        });

        setPayrollRuns((prev) => prev.filter((p) => !selectedPayrollIds.includes(p.id)));
        setSelectedPayrollIds([]);
      }

      onInvoiceAdded();
    } catch (error: any) {
      toast.error("Error al procesar lote", {
        description: error.message || "Ocurrió un error al adjuntar los ítems.",
      });
    } finally {
      setIsBatchAdding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="font-medium gap-1.5 shadow-sm">
          <Plus className="h-4 w-4" /> Agregar Ítems a Corrida
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-5xl lg:max-w-6xl w-[94vw] max-h-[88vh] flex flex-col p-0 gap-0 overflow-hidden text-foreground bg-background rounded-xl border border-border shadow-2xl">
        {/* Header */}
        <DialogHeader className="p-5 pb-4 border-b border-border/60 bg-muted/20 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 space-y-0">
          <div>
            <DialogTitle className="flex items-center gap-2 text-xl font-bold tracking-tight">
              <FileCheck className="h-5 w-5 text-primary shrink-0" />
              Agregar Ítems a Corrida de Pago
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-0.5">
              Selecciona facturas de proveedores conciliadas (3-way match), gastos operativos autorizados o nóminas procesadas.
            </DialogDescription>
          </div>
          {currentSelectionCount > 0 && (
            <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 text-xs px-2.5 py-1 font-medium flex items-center gap-1.5 self-start sm:self-center">
              <CheckSquare className="h-3.5 w-3.5" />
              {currentSelectionCount} seleccionado{currentSelectionCount > 1 ? "s" : ""} ({formatCents(currentSelectionTotalCents)} MXN)
            </Badge>
          )}
        </DialogHeader>

        {/* Body Container */}
        <div className="flex flex-col flex-1 overflow-hidden p-5 space-y-4">
          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full flex flex-col flex-1 overflow-hidden">
            {/* Toolbar: Tabs + Search */}
            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between pb-2">
              <TabsList className="bg-muted/70 p-1 grid grid-cols-3 sm:flex sm:w-auto h-auto">
                <TabsTrigger value="invoices" className="flex items-center gap-2 text-xs font-medium px-3 py-1.5">
                  <Receipt className="h-3.5 w-3.5 text-blue-500" />
                  <span>Facturas</span>
                  <Badge variant="outline" className="ml-1 text-[10px] px-1.5 py-0 h-4 bg-background font-mono">
                    {invoices.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="expenses" className="flex items-center gap-2 text-xs font-medium px-3 py-1.5">
                  <Wallet className="h-3.5 w-3.5 text-emerald-500" />
                  <span>Gastos</span>
                  <Badge variant="outline" className="ml-1 text-[10px] px-1.5 py-0 h-4 bg-background font-mono">
                    {expenses.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="payroll" className="flex items-center gap-2 text-xs font-medium px-3 py-1.5">
                  <Users className="h-3.5 w-3.5 text-amber-500" />
                  <span>Nómina</span>
                  <Badge variant="outline" className="ml-1 text-[10px] px-1.5 py-0 h-4 bg-background font-mono">
                    {payrollRuns.length}
                  </Badge>
                </TabsTrigger>
              </TabsList>

              {/* Instant Search Bar */}
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Buscar por folio, proveedor, RFC..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 pr-8 h-9 text-xs"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Invoices Tab Content */}
            <TabsContent value="invoices" className="flex-1 overflow-hidden m-0 mt-2">
              <div className="h-[48vh] overflow-y-auto border border-border/80 rounded-lg bg-card">
                {isLoadingInvoices ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-xs">Cargando facturas pendientes...</p>
                  </div>
                ) : filteredInvoices.length === 0 ? (
                  <div className="text-center py-14 text-muted-foreground bg-muted/10 rounded-lg flex flex-col items-center justify-center">
                    <Layers className="h-10 w-10 text-muted-foreground/40 mb-2" />
                    <p className="text-sm font-medium text-foreground">
                      {searchQuery ? "No se encontraron facturas coincidentes" : "No hay facturas pendientes conciliadas"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                      {searchQuery
                        ? `No hay resultados para "${searchQuery}". Intenta con otros términos.`
                        : "Todas las facturas recibidas ya están liquidadas o asignadas a otras corridas de pago."}
                    </p>
                  </div>
                ) : (
                  <Table className="relative">
                    <TableHeader className="sticky top-0 bg-muted/90 backdrop-blur-sm z-10 border-b border-border">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-10 text-center">
                          <Checkbox
                            checked={
                              filteredInvoices.length > 0 &&
                              selectedInvoiceIds.length === filteredInvoices.length
                            }
                            onCheckedChange={toggleSelectAllInvoices}
                            aria-label="Seleccionar todas"
                          />
                        </TableHead>
                        <TableHead className="w-28 text-xs font-semibold">Fecha</TableHead>
                        <TableHead className="w-32 text-xs font-semibold">Folio</TableHead>
                        <TableHead className="text-xs font-semibold">Emisor / Proveedor</TableHead>
                        <TableHead className="w-36 text-xs font-semibold">Conciliación</TableHead>
                        <TableHead className="w-32 text-right text-xs font-semibold">Monto Total</TableHead>
                        <TableHead className="w-24 text-right text-xs font-semibold">Acción</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredInvoices.map((inv) => {
                        const isSelected = selectedInvoiceIds.includes(inv.id);
                        return (
                          <TableRow
                            key={inv.id}
                            className={`hover:bg-muted/40 transition-colors ${
                              isSelected ? "bg-primary/5 dark:bg-primary/10" : ""
                            }`}
                          >
                            <TableCell className="text-center">
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleSelectInvoice(inv.id)}
                                aria-label={`Seleccionar factura ${inv.folio}`}
                              />
                            </TableCell>
                            <TableCell className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                              {inv.fecha
                                ? new Date(inv.fecha).toLocaleDateString("es-MX", {
                                    day: "2-digit",
                                    month: "short",
                                    year: "numeric",
                                  })
                                : "-"}
                            </TableCell>
                            <TableCell className="font-mono text-xs font-bold text-foreground">
                              {inv.folio || "S/F"}
                            </TableCell>
                            <TableCell className="text-sm">
                              <div className="font-semibold text-foreground text-xs leading-snug">
                                {inv.nombreEmisor || inv.rfcEmisor}
                              </div>
                              {inv.nombreEmisor && (
                                <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                                  {inv.rfcEmisor}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25 text-[11px] font-medium"
                              >
                                {inv.matchStatus === "MATCHED"
                                  ? "3-Way Match Conciliado"
                                  : inv.matchStatus === "EXCEPTION_APPROVED"
                                  ? "Excepción Aprobada"
                                  : inv.matchStatus}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono font-bold text-xs whitespace-nowrap">
                              {formatCents(inv.total)}{" "}
                              <span className="text-[10px] text-muted-foreground font-normal">
                                {inv.currency || "MXN"}
                              </span>
                            </TableCell>
                            <TableCell className="text-right whitespace-nowrap">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs px-2.5 gap-1 hover:bg-primary hover:text-primary-foreground transition-colors"
                                disabled={addingId === inv.id || isBatchAdding}
                                onClick={() => addInvoice(inv)}
                              >
                                {addingId === inv.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Plus className="h-3 w-3" />
                                )}
                                Adjuntar
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            </TabsContent>

            {/* Expenses Tab Content */}
            <TabsContent value="expenses" className="flex-1 overflow-hidden m-0 mt-2">
              <div className="h-[48vh] overflow-y-auto border border-border/80 rounded-lg bg-card">
                {isLoadingExpenses ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-xs">Cargando gastos operativos...</p>
                  </div>
                ) : filteredExpenses.length === 0 ? (
                  <div className="text-center py-14 text-muted-foreground bg-muted/10 rounded-lg flex flex-col items-center justify-center">
                    <Layers className="h-10 w-10 text-muted-foreground/40 mb-2" />
                    <p className="text-sm font-medium text-foreground">
                      {searchQuery ? "No se encontraron gastos coincidentes" : "No hay gastos autorizados sin pagar"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                      {searchQuery
                        ? `No hay resultados para "${searchQuery}".`
                        : "Todos los gastos operativos aprobados ya están liquidados."}
                    </p>
                  </div>
                ) : (
                  <Table className="relative">
                    <TableHeader className="sticky top-0 bg-muted/90 backdrop-blur-sm z-10 border-b border-border">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-10 text-center">
                          <Checkbox
                            checked={
                              filteredExpenses.length > 0 &&
                              selectedExpenseIds.length === filteredExpenses.length
                            }
                            onCheckedChange={toggleSelectAllExpenses}
                            aria-label="Seleccionar todos"
                          />
                        </TableHead>
                        <TableHead className="text-xs font-semibold">Descripción del Gasto</TableHead>
                        <TableHead className="w-48 text-xs font-semibold">Contraparte / Proveedor</TableHead>
                        <TableHead className="w-36 text-xs font-semibold">Categoría</TableHead>
                        <TableHead className="w-32 text-right text-xs font-semibold">Monto</TableHead>
                        <TableHead className="w-24 text-right text-xs font-semibold">Acción</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredExpenses.map((exp) => {
                        const isSelected = selectedExpenseIds.includes(exp.id);
                        return (
                          <TableRow
                            key={exp.id}
                            className={`hover:bg-muted/40 transition-colors ${
                              isSelected ? "bg-primary/5 dark:bg-primary/10" : ""
                            }`}
                          >
                            <TableCell className="text-center">
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleSelectExpense(exp.id)}
                                aria-label={`Seleccionar gasto ${exp.description}`}
                              />
                            </TableCell>
                            <TableCell className="text-xs font-medium text-foreground">
                              {exp.description}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {exp.payeeName ?? (
                                <span className="text-[11px] text-amber-600 dark:text-amber-400 italic">
                                  Sin contraparte asignada
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-[11px] font-normal">
                                {exp.category}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono font-bold text-xs whitespace-nowrap">
                              {formatCents(exp.amount)} MXN
                            </TableCell>
                            <TableCell className="text-right whitespace-nowrap">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs px-2.5 gap-1 hover:bg-primary hover:text-primary-foreground transition-colors"
                                disabled={addingId === exp.id || isBatchAdding}
                                onClick={() => addExpense(exp)}
                              >
                                {addingId === exp.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Plus className="h-3 w-3" />
                                )}
                                Adjuntar
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            </TabsContent>

            {/* Payroll Tab Content */}
            <TabsContent value="payroll" className="flex-1 overflow-hidden m-0 mt-2">
              <div className="h-[48vh] overflow-y-auto border border-border/80 rounded-lg bg-card">
                {isLoadingPayroll ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-xs">Cargando corridas de nómina...</p>
                  </div>
                ) : filteredPayrollRuns.length === 0 ? (
                  <div className="text-center py-14 text-muted-foreground bg-muted/10 rounded-lg flex flex-col items-center justify-center">
                    <Layers className="h-10 w-10 text-muted-foreground/40 mb-2" />
                    <p className="text-sm font-medium text-foreground">
                      {searchQuery ? "No se encontraron nóminas coincidentes" : "No hay corridas de nómina pendientes"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                      {searchQuery
                        ? `No hay resultados para "${searchQuery}".`
                        : "Todas las nóminas timbradas ya fueron asociadas a una corrida de pago."}
                    </p>
                  </div>
                ) : (
                  <Table className="relative">
                    <TableHeader className="sticky top-0 bg-muted/90 backdrop-blur-sm z-10 border-b border-border">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-10 text-center">
                          <Checkbox
                            checked={
                              filteredPayrollRuns.length > 0 &&
                              selectedPayrollIds.length === filteredPayrollRuns.length
                            }
                            onCheckedChange={toggleSelectAllPayroll}
                            aria-label="Seleccionar todas"
                          />
                        </TableHead>
                        <TableHead className="text-xs font-semibold">Sucursal</TableHead>
                        <TableHead className="w-48 text-xs font-semibold">Período de Nómina</TableHead>
                        <TableHead className="w-40 text-xs font-semibold">Estatus</TableHead>
                        <TableHead className="w-36 text-right text-xs font-semibold">Monto Total</TableHead>
                        <TableHead className="w-24 text-right text-xs font-semibold">Acción</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredPayrollRuns.map((pr) => {
                        const isSelected = selectedPayrollIds.includes(pr.id);
                        return (
                          <TableRow
                            key={pr.id}
                            className={`hover:bg-muted/40 transition-colors ${
                              isSelected ? "bg-primary/5 dark:bg-primary/10" : ""
                            }`}
                          >
                            <TableCell className="text-center">
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleSelectPayroll(pr.id)}
                                aria-label={`Seleccionar nómina ${pr.branchName}`}
                              />
                            </TableCell>
                            <TableCell className="text-xs font-semibold text-foreground">
                              {pr.branchName}
                            </TableCell>
                            <TableCell className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                              {pr.periodStart} al {pr.periodEnd}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className="bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/25 text-[11px] font-medium"
                              >
                                {pr.status === "COMPLETED" ? "Procesada / Timbrada" : pr.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono font-bold text-xs whitespace-nowrap">
                              {formatCents(pr.totalAmountCents || 0)} MXN
                            </TableCell>
                            <TableCell className="text-right whitespace-nowrap">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs px-2.5 gap-1 hover:bg-primary hover:text-primary-foreground transition-colors"
                                disabled={addingId === pr.id || isBatchAdding}
                                onClick={() => addPayroll(pr)}
                              >
                                {addingId === pr.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Plus className="h-3 w-3" />
                                )}
                                Adjuntar
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* Footer */}
        <DialogFooter className="p-4 bg-muted/20 border-t border-border flex-row items-center justify-between gap-3 space-x-0">
          <div className="flex items-center gap-2">
            {currentSelectionCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => {
                  if (activeTab === "invoices") setSelectedInvoiceIds([]);
                  if (activeTab === "expenses") setSelectedExpenseIds([]);
                  if (activeTab === "payroll") setSelectedPayrollIds([]);
                }}
              >
                Limpiar Selección
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cerrar
            </Button>
            {currentSelectionCount > 0 && (
              <Button
                size="sm"
                disabled={isBatchAdding}
                onClick={handleBatchAdd}
                className="gap-1.5 shadow-sm font-medium text-xs bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {isBatchAdding ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Adjuntar {currentSelectionCount} seleccionado{currentSelectionCount > 1 ? "s" : ""} ({formatCents(currentSelectionTotalCents)} MXN)
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
