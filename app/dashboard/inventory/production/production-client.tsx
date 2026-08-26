"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, CookingPot, Lightbulb, ClipboardList, Package, Timer } from "lucide-react";
// Task 5 (plan-loteprod-gaps §6.4): producto cocinado dentro/fuera de su ventana en línea.
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

export function ProductionClient({ branchId }: { branchId: string }) {
    const [orders, setOrders] = useState<ProductionOrder[]>([]);
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [recipes, setRecipes] = useState<Recipe[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState("plan");
    const [isOrderOpen, setIsOrderOpen] = useState(false);
    const [isRecordOpen, setIsRecordOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    // Form state
    const [recipeId, setRecipeId] = useState("");
    const [plannedQty, setPlannedQty] = useState(1);
    const [plannedDate, setPlannedDate] = useState(new Date().toISOString().split("T")[0]);
    const [orderNotes, setOrderNotes] = useState("");

    // Record form state
    const [recordRecipeId, setRecordRecipeId] = useState("");
    const [producedQty, setProducedQty] = useState(1);
    const [recordNotes, setRecordNotes] = useState("");

    const fetchOrders = async () => {
        try {
            const res = await fetch(`/api/inventory/production?branchId=${branchId}`);
            const data = await res.json();
            if (res.ok) setOrders(data.orders || []);
        } catch { toast.error("Error al cargar órdenes"); }
    };

    const fetchSuggestions = async () => {
        try {
            const res = await fetch(`/api/inventory/production/suggestions?branchId=${branchId}`);
            const data = await res.json();
            if (res.ok) setSuggestions(data.suggestions || []);
        } catch { toast.error("Error al cargar sugerencias"); }
    };

    const fetchRecipes = async () => {
        try {
            const res = await fetch("/api/inventory/recipes");
            const data = await res.json();
            if (res.ok) setRecipes(Array.isArray(data) ? data : data.recipes || []);
        } catch { /* ignore */ }
    };

    useEffect(() => {
        setLoading(true);
        Promise.all([fetchOrders(), fetchSuggestions(), fetchRecipes()])
            .finally(() => setLoading(false));
    }, [branchId]);

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
            const res = await fetch("/api/inventory/production", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "record",
                    branchId,
                    recipeId: recordRecipeId,
                    producedQuantity: producedQty,
                    notes: recordNotes,
                    ingredients: [],
                }),
            });
            if (res.ok) {
                toast.success("Producción registrada");
                setIsRecordOpen(false);
                setRecordRecipeId("");
                setProducedQty(1);
                setRecordNotes("");
                fetchOrders();
            } else {
                const err = await res.json();
                toast.error(err.error || "Error al registrar");
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
            <div className="flex items-center justify-between">
                <TabsList>
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
                <div className="flex gap-2">
                    <Dialog open={isRecordOpen} onOpenChange={setIsRecordOpen}>
                        <DialogTrigger asChild>
                            <Button variant="outline" className="gap-2">
                                <Package className="w-4 h-4" />
                                Registrar Producción
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Registrar Producción</DialogTitle>
                            </DialogHeader>
                            <form onSubmit={handleRecordProduction} className="space-y-4">
                                <div className="space-y-2">
                                    <Label>Receta *</Label>
                                    <Select value={recordRecipeId} onValueChange={setRecordRecipeId}>
                                        <SelectTrigger><SelectValue placeholder="Seleccionar receta" /></SelectTrigger>
                                        <SelectContent>
                                            {recipes.map(r => (
                                                <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Cantidad Producida *</Label>
                                    <Input type="number" min={1} value={producedQty} onChange={e => setProducedQty(Number(e.target.value))} required />
                                </div>
                                <div className="space-y-2">
                                    <Label>Notas</Label>
                                    <Input value={recordNotes} onChange={e => setRecordNotes(e.target.value)} placeholder="Opcional" />
                                </div>
                                <DialogFooter>
                                    <Button type="button" variant="outline" onClick={() => setIsRecordOpen(false)}>Cancelar</Button>
                                    <Button type="submit" disabled={submitting}>
                                        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                        Registrar
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
                            </DialogHeader>
                            <form onSubmit={handleCreateOrder} className="space-y-4">
                                <div className="space-y-2">
                                    <Label>Receta *</Label>
                                    <Select value={recipeId} onValueChange={setRecipeId}>
                                        <SelectTrigger><SelectValue placeholder="Seleccionar receta" /></SelectTrigger>
                                        <SelectContent>
                                            {recipes.map(r => (
                                                <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
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

            {/* §6.4 — tiempo de retención: qué hay que tirar ahora mismo. Se
                monta sólo al abrir la pestaña para no encender su refresco
                automático de 30 s mientras se planean órdenes. */}
            <TabsContent value="line" className="space-y-4">
                {activeTab === "line" && <HoldTimeBoard branchId={branchId} />}
            </TabsContent>
        </Tabs>
    );
}
