"use client";

import { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PageHeader, PageContainer, EmptyState } from "@/components/shared";
import { useBranch } from "@/lib/branch-context";
import { usePurchaseOrders, useCreatePurchaseOrder, useInventory, usePriceCheck } from "@/hooks/queries";
import { Plus, FileText, Loader2, AlertTriangle, Check, ChevronsUpDown, Search, ArrowUp, ArrowDown, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "warning" }> = {
  DRAFT: { label: "Borrador", variant: "secondary" },
  PENDING_APPROVAL: { label: "Por Aprobar", variant: "warning" },
  APPROVED: { label: "Aprobada", variant: "default" },
  REJECTED: { label: "Rechazada", variant: "destructive" },
  SENT: { label: "Enviada", variant: "default" },
  PARTIALLY_RECEIVED: { label: "Recibida Parcial", variant: "warning" },
  CLOSED: { label: "Cerrada", variant: "outline" },
  CANCELLED: { label: "Cancelada", variant: "destructive" },
};

function formatCurrency(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "$0.00";
  return `$${(cents / 100).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;
}

function formatDate(date: string | Date | null | undefined) {
  if (!date) return "-";
  return new Date(date).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function PurchaseOrdersPage() {
  return (
    <Suspense>
      <PurchaseOrdersContent />
    </Suspense>
  );
}

function PurchaseOrdersContent() {
  const { selectedBranchId, selectedBranch } = useBranch();
  const searchParams = useSearchParams();
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [dialogOpen, setDialogOpen] = useState(searchParams.get("new") === "1");
  const initialItemId = searchParams.get("item") || undefined;
  const [page, setPage] = useState(0);
  const pageSize = 20;

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortField, setSortField] = useState<string>("createdAt");
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>("desc");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 300);
    return () => clearTimeout(handler);
  }, [search]);

  const { data, isLoading } = usePurchaseOrders({
    branchId: selectedBranchId || undefined,
    status: statusFilter !== "ALL" ? statusFilter : undefined,
    search: debouncedSearch || undefined,
    sortField,
    sortOrder,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    limit: pageSize,
    offset: page * pageSize,
  });

  const orders = data?.orders || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
    setPage(0);
  };

  const renderSortIcon = (field: string) => {
    if (sortField !== field) return <ChevronsUpDown className="ml-1 h-3.5 w-3.5 text-muted-foreground/70" />;
    return sortOrder === "asc" ? 
      <ArrowUp className="ml-1 h-3.5 w-3.5 text-primary" /> : 
      <ArrowDown className="ml-1 h-3.5 w-3.5 text-primary" />;
  };

  return (
    <PageContainer>
      <PageHeader
        title="Órdenes de Compra"
        description="Gestiona las órdenes de compra a proveedores"
        icon={FileText}
        branchName={selectedBranch?.name}
        actions={
          <Button onClick={() => setDialogOpen(true)} size="sm">
            <Plus className="mr-2 h-4 w-4" /> Nueva Orden
          </Button>
        }
      />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[240px]">
              <Label className="text-xs font-semibold mb-1 block">Buscar</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por PO # o proveedor..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-9"
                />
                {search && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setSearch("")}
                    className="absolute right-1 top-1 h-7 w-7"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            
            <div className="w-40">
              <Label className="text-xs font-semibold mb-1 block">Estado</Label>
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos</SelectItem>
                  {Object.entries(STATUS_LABELS).map(([key, { label }]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-36">
              <Label className="text-xs font-semibold mb-1 block">Desde</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(0); }}
                className="h-9 text-xs"
              />
            </div>

            <div className="w-36">
              <Label className="text-xs font-semibold mb-1 block">Hasta</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(0); }}
                className="h-9 text-xs"
              />
            </div>

            {(search || statusFilter !== "ALL" || dateFrom || dateTo) && (
              <Button
                variant="ghost"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("ALL");
                  setDateFrom("");
                  setDateTo("");
                  setPage(0);
                }}
                className="h-9 text-xs text-muted-foreground hover:text-foreground"
              >
                Limpiar
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-4">
              <div className="h-10 bg-muted/60 animate-pulse rounded" />
              <div className="h-12 bg-muted/40 animate-pulse rounded" />
              <div className="h-12 bg-muted/40 animate-pulse rounded" />
              <div className="h-12 bg-muted/40 animate-pulse rounded" />
              <div className="h-12 bg-muted/40 animate-pulse rounded" />
            </div>
          ) : orders.length === 0 ? (
            <div className="py-16">
              <EmptyState
                icon={FileText}
                title="Sin órdenes de compra"
                description={
                  search || statusFilter !== "ALL" || dateFrom || dateTo
                    ? "No se encontraron órdenes que coincidan con los filtros aplicados."
                    : "Crea tu primera orden de compra para comenzar."
                }
                action={
                  search || statusFilter !== "ALL" || dateFrom || dateTo
                    ? {
                        label: "Limpiar filtros",
                        onClick: () => {
                          setSearch("");
                          setStatusFilter("ALL");
                          setDateFrom("");
                          setDateTo("");
                          setPage(0);
                        },
                      }
                    : { label: "Nueva Orden", onClick: () => setDialogOpen(true) }
                }
              />
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSort("poNumber")}>
                      <div className="flex items-center">
                        PO #
                        {renderSortIcon("poNumber")}
                      </div>
                    </TableHead>
                    <TableHead className="cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSort("supplierName")}>
                      <div className="flex items-center">
                        Proveedor
                        {renderSortIcon("supplierName")}
                      </div>
                    </TableHead>
                    <TableHead className="cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSort("branchName")}>
                      <div className="flex items-center">
                        Sucursal
                        {renderSortIcon("branchName")}
                      </div>
                    </TableHead>
                    <TableHead className="cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSort("status")}>
                      <div className="flex items-center">
                        Estado
                        {renderSortIcon("status")}
                      </div>
                    </TableHead>
                    <TableHead className="cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSort("totalAmount")}>
                      <div className="flex items-center">
                        Total
                        {renderSortIcon("totalAmount")}
                      </div>
                    </TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead className="cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSort("createdAt")}>
                      <div className="flex items-center">
                        Fecha
                        {renderSortIcon("createdAt")}
                      </div>
                    </TableHead>
                    <TableHead className="text-right">Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((row: any) => {
                    const po = row.po || row;
                    const statusConfig = STATUS_LABELS[po.status] || { label: po.status, variant: "outline" as const };
                    return (
                      <TableRow key={po.id as string}>
                        <TableCell className="font-mono text-sm font-medium">{po.poNumber}</TableCell>
                        <TableCell>{row.supplierName || "—"}</TableCell>
                        <TableCell>{row.branchName || "—"}</TableCell>
                        <TableCell>
                          <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{formatCurrency(po.totalAmount)}</TableCell>
                        <TableCell>{row.itemCount || 0}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatDate(po.createdAt)}</TableCell>
                        <TableCell className="text-right">
                          <Link href={`/dashboard/inventory/purchase-orders/${po.id}`}>
                            <Button variant="ghost" size="sm">Ver</Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {totalPages > 1 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border-t">
                  <p className="text-sm text-muted-foreground">
                    Mostrando {orders.length} de {total} órdenes (pág. {page + 1} de {totalPages})
                  </p>
                  <div className="flex items-center gap-1.5">
                    <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                      Anterior
                    </Button>
                    
                    {Array.from({ length: Math.min(5, totalPages) }, (_, idx) => {
                      let pageNum = idx;
                      if (page > 2 && totalPages > 5) {
                        pageNum = page - 2 + idx;
                        if (pageNum + (5 - idx) > totalPages) {
                          pageNum = totalPages - 5 + idx;
                        }
                      }
                      
                      return (
                        <Button
                          key={pageNum}
                          variant={page === pageNum ? "default" : "outline"}
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => setPage(pageNum)}
                        >
                          {pageNum + 1}
                        </Button>
                      );
                    })}

                    <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
                      Siguiente
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <CreatePODialog open={dialogOpen} onOpenChange={setDialogOpen} initialItemId={initialItemId} />
    </PageContainer>
  );
}

function CreatePODialog({ open, onOpenChange, initialItemId }: { open: boolean; onOpenChange: (v: boolean) => void; initialItemId?: string }) {
  const { selectedBranchId } = useBranch();
  const { data: products = [] } = useInventory(selectedBranchId || undefined);
  const createPO = useCreatePurchaseOrder();
  const priceCheck = usePriceCheck();
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string }>>([]);

  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [dateRequired, setDateRequired] = useState("");
  const [items, setItems] = useState<Array<{ itemId: string; quantity: string; unitCost: string }>>([
    { itemId: initialItemId || "", quantity: "", unitCost: "" },
  ]);
  const [priceAlerts, setPriceAlerts] = useState<Record<number, { avgCost: number; increasePercentage: number; exceedsThreshold: boolean } | null>>({});
  const [searchQueries, setSearchQueries] = useState<Record<number, string>>({});
  const [openPopovers, setOpenPopovers] = useState<Record<number, boolean>>({});

  const calculateTotals = () => {
    let subtotal = 0;
    let taxAmount = 0;
    let iepsAmount = 0;

    items.forEach((item) => {
      const qty = Number(item.quantity) || 0;
      const cost = Number(item.unitCost) || 0;
      const lineTotal = qty * cost;
      
      const product = (products as any[]).find(p => p.id === item.itemId);
      const taxRate = product?.taxRate ?? 16;
      const iepsRate = product?.iepsRate ?? 0;

      const lineTax = lineTotal * (taxRate / 100);
      const lineIeps = lineTotal * (iepsRate / 100);

      subtotal += lineTotal;
      taxAmount += lineTax;
      iepsAmount += lineIeps;
    });

    const total = subtotal + taxAmount + iepsAmount;

    return {
      subtotal,
      taxAmount,
      iepsAmount,
      total,
    };
  };

  const totals = calculateTotals();

  useEffect(() => {
    if (open) {
      fetch("/api/inventory/suppliers")
        .then((res) => res.ok && res.json())
        .then((data) => setSuppliers(data.suppliers || []))
        .catch(() => {});
    }
  }, [open]);

  const handlePriceCheck = async (idx: number, itemId: string, costStr: string) => {
    if (!supplierId || !itemId || !costStr) {
      setPriceAlerts(prev => {
        const next = { ...prev };
        delete next[idx];
        return next;
      });
      return;
    }
    const costInCents = Math.round(Number(costStr) * 100);
    if (isNaN(costInCents) || costInCents <= 0) return;

    try {
      const res = await priceCheck.mutateAsync({
        supplierId,
        items: [{ itemId, unitCost: costInCents }],
      });
      const alert = res.alerts?.find((a: any) => a.itemId === itemId);
      if (alert && alert.avgCost !== null) {
        setPriceAlerts(prev => ({
          ...prev,
          [idx]: {
            avgCost: alert.avgCost,
            increasePercentage: alert.increasePercentage,
            exceedsThreshold: alert.exceedsThreshold,
          }
        }));
      } else {
        setPriceAlerts(prev => {
          const next = { ...prev };
          delete next[idx];
          return next;
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    items.forEach((item, idx) => {
      if (item.itemId && item.unitCost) {
        handlePriceCheck(idx, item.itemId, item.unitCost);
      }
    });
  }, [supplierId]);

  const resetForm = () => {
    setSupplierId("");
    setNotes("");
    setDateRequired("");
    setItems([{ itemId: "", quantity: "", unitCost: "" }]);
    setPriceAlerts({});
    setSearchQueries({});
    setOpenPopovers({});
  };

  const addItem = () => {
    setItems([...items, { itemId: "", quantity: "", unitCost: "" }]);
  };

  const removeItem = (idx: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== idx));
      setPriceAlerts(prev => {
        const next = { ...prev };
        delete next[idx];
        const shifted: typeof priceAlerts = {};
        Object.entries(next).forEach(([k, v]) => {
          const keyNum = Number(k);
          if (keyNum > idx) {
            shifted[keyNum - 1] = v;
          } else {
            shifted[keyNum] = v;
          }
        });
        return shifted;
      });
      setSearchQueries(prev => {
        const next = { ...prev };
        delete next[idx];
        const shifted: typeof searchQueries = {};
        Object.entries(next).forEach(([k, v]) => {
          const keyNum = Number(k);
          if (keyNum > idx) {
            shifted[keyNum - 1] = v;
          } else {
            shifted[keyNum] = v;
          }
        });
        return shifted;
      });
      setOpenPopovers(prev => {
        const next = { ...prev };
        delete next[idx];
        const shifted: typeof openPopovers = {};
        Object.entries(next).forEach(([k, v]) => {
          const keyNum = Number(k);
          if (keyNum > idx) {
            shifted[keyNum - 1] = v;
          } else {
            shifted[keyNum] = v;
          }
        });
        return shifted;
      });
    }
  };

  const updateItem = (idx: number, field: string, value: string) => {
    const updatedItems = items.map((item, i) => i === idx ? { ...item, [field]: value } : item);
    setItems(updatedItems);

    const currentItem = updatedItems[idx];
    if (field === "itemId" || field === "unitCost") {
      handlePriceCheck(idx, currentItem.itemId, currentItem.unitCost);
    }
  };

  const handleSubmit = async () => {
    if (!supplierId) {
      toast.error("Selecciona un proveedor");
      return;
    }
    if (!selectedBranchId) {
      toast.error("Selecciona una sucursal");
      return;
    }

    const validItems = items.filter(i => i.itemId && Number(i.quantity) > 0 && Number(i.unitCost) >= 0);
    if (validItems.length === 0) {
      toast.error("Agrega al menos un producto con cantidad válida");
      return;
    }

    createPO.mutate({
      supplierId,
      branchId: selectedBranchId,
      notes: notes || undefined,
      dateRequired: dateRequired || undefined,
      items: validItems.map(i => ({
        itemId: i.itemId,
        orderedQuantity: Number(i.quantity),
        unitCost: Math.round(Number(i.unitCost) * 100),
      })),
    }, {
      onSuccess: () => {
        toast.success("Orden de compra creada");
        onOpenChange(false);
        resetForm();
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : "Error al crear orden");
      },
    });
  };

  const supplierList = Array.isArray(suppliers) ? suppliers : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nueva Orden de Compra</DialogTitle>
          <DialogDescription>
            Ingresa los datos de la orden y los productos a solicitar
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Proveedor *</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar proveedor" />
                </SelectTrigger>
                <SelectContent>
                  {supplierList.map((s: { id: string; name: string }) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Fecha Requerida</Label>
              <Input type="date" value={dateRequired} onChange={(e) => setDateRequired(e.target.value)} />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Notas</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas para el proveedor..." />
          </div>

          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-3">
              <Label className="text-base font-semibold">Productos</Label>
              <Button variant="outline" size="sm" onClick={addItem}>
                <Plus className="h-3 w-3 mr-1" /> Agregar
              </Button>
            </div>

            {items.map((item, idx) => (
              <div key={idx} className="flex flex-col gap-1 mb-3">
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-5">
                    <Label className="text-xs">{idx === 0 ? "Producto" : ""}</Label>
                    {(() => {
                      const selectedProduct = (products as Array<{ id: string; name: string }>).find(p => p.id === item.itemId);
                      const query = (searchQueries[idx] || "").toLowerCase();
                      const filteredProducts = (products as Array<{ id: string; name: string }>).filter(p => 
                        p.name.toLowerCase().includes(query)
                      );
                      
                      return (
                        <Popover 
                          open={openPopovers[idx] || false} 
                          onOpenChange={(open) => setOpenPopovers(prev => ({ ...prev, [idx]: open }))}
                        >
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              role="combobox"
                              aria-expanded={openPopovers[idx]}
                              className="w-full justify-between h-8 text-sm px-2 font-normal border-input bg-background"
                            >
                              <span className="truncate">{selectedProduct ? selectedProduct.name : "Seleccionar..."}</span>
                              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-80 p-2 z-50 bg-popover border shadow-md rounded-md" align="start">
                            <div className="flex items-center border-b pb-2 mb-2 px-1 gap-2">
                              <Search className="h-4 w-4 shrink-0 opacity-50" />
                              <input
                                placeholder="Buscar producto..."
                                className="flex h-8 w-full rounded-md bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                                value={searchQueries[idx] || ""}
                                onChange={(e) => setSearchQueries(prev => ({ ...prev, [idx]: e.target.value }))}
                              />
                            </div>
                            <div className="max-h-60 overflow-y-auto space-y-0.5">
                              {filteredProducts.length === 0 ? (
                                <p className="text-xs text-muted-foreground p-2 text-center">No se encontraron productos</p>
                              ) : (
                                filteredProducts.map((p) => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    className={cn(
                                      "relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 px-2 text-xs outline-none hover:bg-accent hover:text-accent-foreground text-left transition-colors",
                                      item.itemId === p.id && "bg-accent/50 font-medium"
                                    )}
                                    onClick={() => {
                                      const costInCents = (p as any).lastCost ?? (p as any).averageCost;
                                      const costPesos = costInCents !== undefined && costInCents !== null ? (costInCents / 100).toFixed(2) : "";
                                      
                                      const updatedItems = items.map((itm, i) => i === idx ? { ...itm, itemId: p.id, unitCost: costPesos } : itm);
                                      setItems(updatedItems);
                                      
                                      handlePriceCheck(idx, p.id, costPesos);
                                      setOpenPopovers(prev => ({ ...prev, [idx]: false }));
                                      setSearchQueries(prev => ({ ...prev, [idx]: "" }));
                                    }}
                                  >
                                    <Check className={cn("mr-2 h-3 w-3 shrink-0", item.itemId === p.id ? "opacity-100" : "opacity-0")} />
                                    <span className="truncate">{p.name}</span>
                                  </button>
                                ))
                              )}
                            </div>
                          </PopoverContent>
                        </Popover>
                      );
                    })()}
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">{idx === 0 ? "Cantidad" : ""}</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      className="h-8 text-sm"
                      value={item.quantity}
                      onChange={(e) => updateItem(idx, "quantity", e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div className="col-span-3">
                    <Label className="text-xs">{idx === 0 ? "Costo Unit." : ""}</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      className="h-8 text-sm"
                      value={item.unitCost}
                      onChange={(e) => updateItem(idx, "unitCost", e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="col-span-2 flex gap-1">
                    <Label className="text-xs invisible">_</Label>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-red-500"
                      onClick={() => removeItem(idx)}
                      disabled={items.length === 1}
                    >
                      ×
                    </Button>
                  </div>
                </div>
                {priceAlerts[idx] && (
                  <div className={cn(
                    "text-xs flex items-center gap-1.5 px-2 py-1 rounded-sm mt-1",
                    priceAlerts[idx]?.exceedsThreshold ? "text-amber-700 bg-amber-50" : "text-muted-foreground bg-slate-50"
                  )}>
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    <span>Promedio histórico: {formatCurrency(priceAlerts[idx]?.avgCost)}</span>
                    {priceAlerts[idx]?.exceedsThreshold && (
                      <span className="font-semibold">
                        (Aumento de {priceAlerts[idx]?.increasePercentage}%)
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          
          {/* Summary section */}
          <div className="border-t pt-3 mt-4 space-y-1.5 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span className="font-mono">{formatCurrency(Math.round(totals.subtotal * 100))}</span>
            </div>
            {totals.taxAmount > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>IVA Detallado</span>
                <span className="font-mono">{formatCurrency(Math.round(totals.taxAmount * 100))}</span>
              </div>
            )}
            {totals.iepsAmount > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>IEPS Detallado</span>
                <span className="font-mono">{formatCurrency(Math.round(totals.iepsAmount * 100))}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold text-base border-t pt-1.5">
              <span>Total Estimado</span>
              <span className="font-mono text-emerald-700">{formatCurrency(Math.round(totals.total * 100))}</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); resetForm(); }}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={createPO.isPending}>
            {createPO.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Crear Orden
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
