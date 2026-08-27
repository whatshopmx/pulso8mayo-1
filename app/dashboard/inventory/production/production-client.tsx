"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, CookingPot, Lightbulb, ClipboardList, Package, Timer, ChefHat, AlertTriangle, Layers } from "lucide-react";
import { PrepListBoard } from "@/components/inventory/prep-list-board";
import { HoldTimeBoard } from "@/components/inventory/hold-time-board";
import { toast } from "sonner";

interface Recipe {
    id: string;
    name: string;
    unit: string;
}

interface ProductionOrder {
    id: string;
    plannedQuantity: number;
    unit: string;
    plannedDate: string;
    status: string;
    notes: string | null;
    recipe: { id: string; name: string } | null;
}

interface Suggestion {
    recipeId: string;
    recipeName: string;
    suggestedQuantity: number;
    unit: string;
    avgDailySales: number;
    currentStock: number;
}

interface FefoAllocationItem {
    itemId: string;
    itemName: string;
    requiredQuantity: number;
    unit: string;
    allocations: Array<{
        batchId: string;
        lotNumber: string;
        expirationDate: string | null;
        quantity: number;
    }>;
    allocatedQuantity: number;
    shortfall: number;
}

export function ProductionClient({
    branchId: initialBranchId,
    branches = [],
}: {
    branchId: string;
    branches?: Array<{ id: string; name: string }>;
}) {
    const [selectedBranchId, setSelectedBranchId] = useState(initialBranchId);
    const branchId = selectedBranchId || initialBranchId;

    const [orders, setOrders] = useState<ProductionOrder[]>([]);
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [recipes, setRecipes] = useState<Recipe[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState("prep-list");
    const [isOrderOpen, setIsOrderOpen] = useState(false);
    const [isRecordOpen, setIsRecordOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    // Form state for creating orders
    const [recipeId, setRecipeId] = useState("");
    const [plannedQty, setPlannedQty] = useState(1);
    const [plannedDate, setPlannedDate] = useState(new Date().toISOString().split("T")[0]);
    const [orderNotes, setOrderNotes] = useState("");

    // Record form state with live FEFO preview
    const [recordRecipeId, setRecordRecipeId] = useState("");
    const [producedQty, setProducedQty] = useState(1);
    const [recordNotes, setRecordNotes] = useState("");
    const [previewLoading, setPreviewLoading] = useState(false);
    const [fefoPreview, setFefoPreview] = useState<FefoAllocationItem[]>([]);

    const fetchOrders = useCallback(async () => {
        try {
            const res = await fetch(`/api/inventory/production?branchId=${branchId}`);
            const data = await res.json();
            if (res.ok) setOrders(data.orders || []);
        } catch { toast.error("Error al cargar órdenes"); }
    }, [branchId]);

    const fetchSuggestions = useCallback(async () => {
        try {
            const res = await fetch(`/api/inventory/production/suggestions?branchId=${branchId}`);
            const data = await res.json();
            if (res.ok) setSuggestions(data.suggestions || []);
        } catch { toast.error("Error al cargar sugerencias"); }
    }, [branchId]);

    const fetchRecipes = useCallback(async () => {
        try {
            const res = await fetch("/api/inventory/recipes");
            const data = await res.json();
            if (res.ok) setRecipes(Array.isArray(data) ? data : data.recipes || []);
        } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        setLoading(true);
        Promise.all([fetchOrders(), fetchSuggestions(), fetchRecipes()])
            .finally(() => setLoading(false));
    }, [fetchOrders, fetchSuggestions, fetchRecipes]);

    // Consultar vista previa FEFO cuando cambia la receta o la cantidad a registrar
    useEffect(() => {
        if (!isRecordOpen || !recordRecipeId || producedQty <= 0) {
            setFefoPreview([]);
            return;
        }

        let cancelled = false;
        setPreviewLoading(true);

        const fetchPreview = async () => {
            try {
                const res = await fetch(
                    `/api/inventory/production?branchId=${branchId}&preview=true&recipeId=${recordRecipeId}&quantity=${producedQty}`
                );
                const data = await res.json();
                if (!cancelled && res.ok && data.success) {
                    setFefoPreview(data.preview || []);
                }
            } catch (err) {
                console.error("Error fetching FEFO preview:", err);
            } finally {
                if (!cancelled) setPreviewLoading(false);
            }
        };

        const timer = setTimeout(fetchPreview, 250);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [isRecordOpen, recordRecipeId, producedQty, branchId]);

    const handleCreateOrder = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!recipeId || !plannedQty) {
            toast.error("Completa todos los campos requeridos");
            return;
        }
        setSubmitting(true);
        try {
            const res = await fetch("/api/inventory/production", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    branchId,
                    recipeId,
                    plannedQuantity: plannedQty,
                    plannedDate,
                    notes: orderNotes,
                }),
            });
            if (res.ok) {
                toast.success("Orden de producción creada");
                setIsOrderOpen(false);
                setRecipeId("");
                setPlannedQty(1);
                setOrderNotes("");
                fetchOrders();
            } else {
                const err = await res.json();
                toast.error(err.error || "Error al crear orden");
            }
        } catch { toast.error("Error al crear orden"); }
        finally { setSubmitting(false); }
    };

    const handleRecordProduction = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!recordRecipeId || !producedQty) {
            toast.error("Completa todos los campos requeridos");
            return;
        }
        setSubmitting(true);
        try {
            const selectedRecipe = recipes.find(r => r.id === recordRecipeId);
            const res = await fetch("/api/inventory/production", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "record",
                    branchId,
                    recipeId: recordRecipeId,
                    producedQuantity: producedQty,
                    unit: selectedRecipe?.unit || "PORTION",
                    notes: recordNotes,
                }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                const cost = data.result?.ingredientCost;
                const costStr = cost ? ` ($${(cost / 100).toFixed(2)})` : "";
                toast.success(`Producción registrada con éxito por FEFO${costStr}`);

                if (data.result?.shortfalls?.length > 0) {
                    toast.warning("Algunos insumos tuvieron faltante de lote y se registraron en merma");
                }

                setIsRecordOpen(false);
                setRecordRecipeId("");
                setProducedQty(1);
                setRecordNotes("");
                setFefoPreview([]);
                fetchOrders();
            } else {
                toast.error(data.error || "Error al registrar producción");
            }
        } catch { toast.error("Error al registrar producción"); }
        finally { setSubmitting(false); }
    };

    const statusBadge = (status: string) => {
        const variants: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
            PLANNED: "secondary",
            IN_PROGRESS: "default",
            COMPLETED: "outline",
            CANCELLED: "destructive",
        };
        const labels: Record<string, string> = {
            PLANNED: "Planeada",
            IN_PROGRESS: "En Progreso",
            COMPLETED: "Completada",
            CANCELLED: "Cancelada",
        };
        return <Badge variant={variants[status] || "outline"}>{labels[status] || status}</Badge>;
    };

    return (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <TabsList>
                    <TabsTrigger value="prep-list" className="gap-2">
                        <ChefHat className="w-4 h-4" />
                        Prep List Diaria
                    </TabsTrigger>
                    <TabsTrigger value="plan" className="gap-2">
                        <ClipboardList className="w-4 h-4" />
                        Órdenes
                    </TabsTrigger>
                    <TabsTrigger value="suggestions" className="gap-2">
                        <Lightbulb className="w-4 h-4" />
                        Sugerencias
                    </TabsTrigger>
                    <TabsTrigger value="line" className="gap-2">
                        <Timer className="w-4 h-4" />
                        En línea
                    </TabsTrigger>
                </TabsList>
                <div className="flex items-center gap-2 flex-wrap">
                    {branches.length > 1 && (
                        <Select value={branchId} onValueChange={setSelectedBranchId}>
                            <SelectTrigger className="h-9 w-44 text-xs bg-card">
                                <SelectValue placeholder="Sucursal" />
                            </SelectTrigger>
                            <SelectContent>
                                {branches.map((b) => (
                                    <SelectItem key={b.id} value={b.id}>
                                        {b.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                    <Dialog open={isRecordOpen} onOpenChange={setIsRecordOpen}>
                        <DialogTrigger asChild>
                            <Button variant="outline" className="gap-2">
                                <Package className="w-4 h-4" />
                                Registrar Producción
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
                            <DialogHeader>
                                <DialogTitle>Registrar Producción</DialogTitle>
                                <DialogDescription>
                                    Produce una receta descontando automáticamente los insumos por fecha de caducidad (FEFO).
                                </DialogDescription>
                            </DialogHeader>
                            <form onSubmit={handleRecordProduction} className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="recipe-select">Receta *</Label>
                                    <Select value={recordRecipeId} onValueChange={setRecordRecipeId}>
                                        <SelectTrigger id="recipe-select">
                                            <SelectValue placeholder="Seleccionar receta" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {recipes.map(r => (
                                                <SelectItem key={r.id} value={r.id}>{r.name} ({r.unit})</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="quantity-input">Cantidad Producida *</Label>
                                    <Input
                                        id="quantity-input"
                                        type="number"
                                        min={1}
                                        value={producedQty}
                                        onChange={e => setProducedQty(Math.max(1, Number(e.target.value)))}
                                        required
                                    />
                                </div>

                                {/* Vista Previa FEFO de Lotes a Descontar */}
                                {recordRecipeId && (
                                    <div className="border rounded-lg p-3 bg-muted/20 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
                                                <Layers className="size-3.5 text-primary" />
                                                Lotes a descontar (Asignación FEFO)
                                            </span>
                                            {previewLoading && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
                                        </div>

                                        {previewLoading ? (
                                            <p className="text-xs text-muted-foreground py-2 text-center">Calculando asignación de lotes...</p>
                                        ) : fefoPreview.length === 0 ? (
                                            <p className="text-xs text-muted-foreground py-1">Esta receta no tiene insumos configurados.</p>
                                        ) : (
                                            <div className="space-y-2 max-h-48 overflow-y-auto text-xs">
                                                {fefoPreview.map((item) => (
                                                    <div key={item.itemId} className="p-2 border rounded bg-card space-y-1">
                                                        <div className="flex justify-between font-medium">
                                                            <span>{item.itemName}</span>
                                                            <span>{item.requiredQuantity.toFixed(2)} {item.unit}</span>
                                                        </div>

                                                        {item.allocations.length > 0 ? (
                                                            <div className="space-y-0.5 text-muted-foreground">
                                                                {item.allocations.map((a, idx) => (
                                                                    <div key={idx} className="flex justify-between font-mono text-[11px]">
                                                                        <span>Lote: {a.lotNumber} {a.expirationDate ? `(Vence ${new Date(a.expirationDate).toLocaleDateString()})` : ""}</span>
                                                                        <span>-{a.quantity.toFixed(2)} {item.unit}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <p className="text-destructive text-[11px] font-mono">Sin lotes con saldo disponible</p>
                                                        )}

                                                        {item.shortfall > 0 && (
                                                            <div className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 font-medium pt-0.5">
                                                                <AlertTriangle className="size-3 shrink-0" />
                                                                <span>Faltan {item.shortfall.toFixed(2)} {item.unit} (se registrará merma auditada)</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="space-y-2">
                                    <Label htmlFor="notes-input">Notas</Label>
                                    <Input
                                        id="notes-input"
                                        value={recordNotes}
                                        onChange={e => setRecordNotes(e.target.value)}
                                        placeholder="Opcional"
                                    />
                                </div>
                                <DialogFooter>
                                    <Button type="button" variant="outline" onClick={() => setIsRecordOpen(false)}>Cancelar</Button>
                                    <Button type="submit" disabled={submitting}>
                                        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                        Confirmar y Descontar Lotes
                                    </Button>
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>
                    <Dialog open={isOrderOpen} onOpenChange={setIsOrderOpen}>
                        <DialogTrigger asChild>
                            <Button className="gap-2">
                                <Plus className="w-4 h-4" />
                                Nueva Orden
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Nueva Orden de Producción</DialogTitle>
                                <DialogDescription>
                                    Planifica una orden en la prep list de cocina.
                                </DialogDescription>
                            </DialogHeader>
                            <form onSubmit={handleCreateOrder} className="space-y-4">
                                <div className="space-y-2">
                                    <Label>Receta *</Label>
                                    <Select value={recipeId} onValueChange={setRecipeId}>
                                        <SelectTrigger><SelectValue placeholder="Seleccionar receta" /></SelectTrigger>
                                        <SelectContent>
                                            {recipes.map(r => (
                                                <SelectItem key={r.id} value={r.id}>{r.name} ({r.unit})</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Cantidad *</Label>
                                        <Input type="number" min={1} value={plannedQty} onChange={e => setPlannedQty(Number(e.target.value))} required />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Fecha *</Label>
                                        <Input type="date" value={plannedDate} onChange={e => setPlannedDate(e.target.value)} required />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label>Notas</Label>
                                    <Input value={orderNotes} onChange={e => setOrderNotes(e.target.value)} placeholder="Opcional" />
                                </div>
                                <DialogFooter>
                                    <Button type="button" variant="outline" onClick={() => setIsOrderOpen(false)}>Cancelar</Button>
                                    <Button type="submit" disabled={submitting}>
                                        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                        Crear Orden
                                    </Button>
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {/* Pestaña Principal: Prep List Diaria con agrupación por estación y lotes FEFO */}
            <TabsContent value="prep-list" className="space-y-4">
                <PrepListBoard branchId={branchId} />
            </TabsContent>

            <TabsContent value="plan" className="space-y-4">
                {loading ? (
                    <Card>
                        <CardContent className="p-8 text-center text-muted-foreground">
                            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                            Cargando órdenes...
                        </CardContent>
                    </Card>
                ) : orders.length === 0 ? (
                    <Card>
                        <CardContent className="p-8 text-center">
                            <CookingPot className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                            <h3 className="text-lg font-semibold mb-2">Sin órdenes de producción</h3>
                            <p className="text-muted-foreground mb-4">Crea tu primera orden para planificar la producción batch.</p>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {orders.map((order) => (
                            <Card key={order.id}>
                                <CardHeader className="pb-2">
                                    <div className="flex items-start justify-between">
                                        <CardTitle className="text-lg">{order.recipe?.name || "Receta eliminada"}</CardTitle>
                                        {statusBadge(order.status)}
                                    </div>
                                    <CardDescription>
                                        {order.plannedQuantity} {order.unit} — {new Date(order.plannedDate).toLocaleDateString()}
                                    </CardDescription>
                                </CardHeader>
                                {order.notes && (
                                    <CardContent className="pt-0">
                                        <p className="text-sm text-muted-foreground">{order.notes}</p>
                                    </CardContent>
                                )}
                            </Card>
                        ))}
                    </div>
                )}
            </TabsContent>

            <TabsContent value="suggestions" className="space-y-4">
                {loading ? (
                    <Card>
                        <CardContent className="p-8 text-center text-muted-foreground">
                            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                            Calculando sugerencias...
                        </CardContent>
                    </Card>
                ) : suggestions.length === 0 ? (
                    <Card>
                        <CardContent className="p-8 text-center">
                            <Lightbulb className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                            <h3 className="text-lg font-semibold mb-2">Sin sugerencias</h3>
                            <p className="text-muted-foreground">
                                No hay sugerencias de producción basadas en ventas recientes.
                                Registra ventas para obtener recomendaciones.
                            </p>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {suggestions.map((s) => (
                            <Card key={s.recipeId}>
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-lg">{s.recipeName}</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-2 text-sm">
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Sugerido:</span>
                                            <span className="font-medium">{s.suggestedQuantity} {s.unit}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Ventas diarias promedio:</span>
                                            <span>{s.avgDailySales}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Stock actual (porciones):</span>
                                            <span>{s.currentStock}</span>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </TabsContent>

            {/* §6.4 — tiempo de retención: qué hay que tirar ahora mismo */}
            <TabsContent value="line" className="space-y-4">
                {activeTab === "line" && <HoldTimeBoard branchId={branchId} />}
            </TabsContent>
        </Tabs>
    );
}

