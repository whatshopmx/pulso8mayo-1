"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, PageContainer } from "@/components/shared";
import {
    ChefHat,
    Plus,
    Trash2,
    Edit2,
    Play,
    Percent,
    DollarSign,
    Calculator,
    AlertTriangle,
    Check,
    Loader2,
    History,
    Search,
    Filter,
    TrendingUp,
    TrendingDown,
    Layers,
    Clock,
    Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface RecipeItem {
    itemId: string;
    quantity: number;
    unit: string;
    isSubRecipe: boolean;
}

interface Recipe {
    id: string;
    name: string;
    description?: string;
    baseYield: string;
    unit: string;
    calculatedCost: number; // cents
    priceSelling: number; // cents
    holdTimeMinutes?: number | null;
    foodCostPercentage: string;
    createdAt: string;
}

interface InventoryProduct {
    id: string;
    name: string;
    sku?: string;
    unit?: string;
    lastCost?: number; // cents
}

interface SimulationResult {
    recipeId: string;
    recipeName: string;
    currentCostCents: number;
    simulatedCostCents: number;
    currentFoodCostPct: string;
    simulatedFoodCostPct: string;
}

interface RecipeVersion {
    id: string;
    versionNumber: number;
    name: string;
    description?: string;
    baseYield: string;
    unit: string;
    holdTimeMinutes?: number | null;
    calculatedCost: number;
    priceSelling: number;
    foodCostPercentage: string;
    itemsSnapshot: Array<{
        itemId: string;
        itemName?: string;
        itemSku?: string;
        quantity: string;
        unit: string;
        isSubRecipe: boolean;
        lastCost?: number;
    }>;
    changeReason?: string;
    authorName?: string;
    authorEmail?: string;
    createdAt: string;
}

export default function RecipesPage() {
    const [recipesList, setRecipesList] = useState<Recipe[]>([]);
    const [dbItems, setDbItems] = useState<InventoryProduct[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState("list");

    // Search and Filter State
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedCategory, setSelectedCategory] = useState<string>("ALL");

    // Version History State
    const [versionHistoryRecipe, setVersionHistoryRecipe] = useState<Recipe | null>(null);
    const [versionsList, setVersionsList] = useState<RecipeVersion[]>([]);
    const [loadingVersions, setLoadingVersions] = useState(false);
    const [isVersionDialogOpen, setIsVersionDialogOpen] = useState(false);

    // Recipe Form State
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
    const [recipeName, setRecipeName] = useState("");
    const [recipeDescription, setRecipeDescription] = useState("");
    const [recipeYield, setRecipeYield] = useState(1);
    const [recipeUnit, setRecipeUnit] = useState("PORTION");
    const [recipePriceSelling, setRecipePriceSelling] = useState(0);
    const [recipeHoldTime, setRecipeHoldTime] = useState<string>("");
    const [recipeIngredients, setRecipeIngredients] = useState<RecipeItem[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Simulation State
    const [simulatedItemId, setSimulatedItemId] = useState("");
    const [simulatedPercent, setSimulatedPercent] = useState(10); // +10%
    const [simulationResults, setSimulationResults] = useState<SimulationResult[]>([]);
    const [isSimulating, setIsSimulating] = useState(false);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [recipesRes, itemsRes] = await Promise.all([
                fetch("/api/inventory/recipes"),
                fetch("/api/inventory/products"),
            ]);

            if (recipesRes.ok) {
                const data = await recipesRes.json();
                setRecipesList(Array.isArray(data) ? data : data.recipes || []);
            }

            if (itemsRes.ok) {
                const data = await itemsRes.json();
                setDbItems(Array.isArray(data) ? data : data.products || []);
            }
        } catch (error) {
            console.error("Error loading recipes or items:", error);
            toast.error("Error al cargar recetas o insumos");
        } finally {
            setLoading(false);
        }
    };

    const handleOpenCreateDialog = () => {
        setEditingRecipe(null);
        setRecipeName("");
        setRecipeDescription("");
        setRecipeYield(1);
        setRecipeUnit("PORTION");
        setRecipePriceSelling(0);
        setRecipeHoldTime("");
        setRecipeIngredients([]);
        setIsDialogOpen(true);
    };

    const handleOpenEditDialog = async (recipe: Recipe) => {
        setEditingRecipe(recipe);
        setRecipeName(recipe.name);
        setRecipeDescription(recipe.description || "");
        setRecipeYield(Number(recipe.baseYield));
        setRecipeUnit(recipe.unit);
        setRecipePriceSelling(recipe.priceSelling / 100);
        setRecipeHoldTime(recipe.holdTimeMinutes != null ? String(recipe.holdTimeMinutes) : "");

        try {
            const res = await fetch(`/api/inventory/recipes/${recipe.id}`);
            if (res.ok) {
                const data = await res.json();
                if (data.items) {
                    setRecipeIngredients(data.items.map((i: any) => ({
                        itemId: i.itemId,
                        quantity: Number(i.quantity),
                        unit: i.unit,
                        isSubRecipe: i.isSubRecipe,
                    })));
                }
            }
        } catch (error) {
            toast.error("Error al cargar ingredientes de la receta");
        }
        setIsDialogOpen(true);
    };

    const handleOpenVersionsDialog = async (recipe: Recipe) => {
        setVersionHistoryRecipe(recipe);
        setIsVersionDialogOpen(true);
        setLoadingVersions(true);
        try {
            const res = await fetch(`/api/inventory/recipes/${recipe.id}/versions`);
            if (res.ok) {
                const data = await res.json();
                setVersionsList(data.versions || []);
            } else {
                toast.error("Error al cargar historial de versiones");
            }
        } catch (err) {
            console.error("Error fetching recipe versions:", err);
            toast.error("Error de red al cargar versiones");
        } finally {
            setLoadingVersions(false);
        }
    };

    const handleAddIngredient = () => {
        setRecipeIngredients(prev => [
            ...prev,
            { itemId: "", quantity: 1, unit: "KG", isSubRecipe: false }
        ]);
    };

    const handleRemoveIngredient = (index: number) => {
        setRecipeIngredients(prev => prev.filter((_, i) => i !== index));
    };

    const handleIngredientChange = (index: number, key: keyof RecipeItem, value: any) => {
        setRecipeIngredients(prev => prev.map((item, i) => {
            if (i === index) {
                const updated = { ...item, [key]: value };
                if (key === "itemId") {
                    if (item.isSubRecipe) {
                        const sub = recipesList.find(r => r.id === value);
                        if (sub) updated.unit = sub.unit;
                    } else {
                        const prod = dbItems.find(p => p.id === value);
                        if (prod) updated.unit = prod.unit || "UNIT";
                    }
                }
                return updated;
            }
            return item;
        }));
    };

    const handleSaveRecipe = async () => {
        if (!recipeName.trim()) {
            toast.error("Ingresa el nombre de la receta");
            return;
        }

        const invalidIngredients = recipeIngredients.filter(i => !i.itemId || i.quantity <= 0);
        if (invalidIngredients.length > 0) {
            toast.error("Todos los ingredientes deben tener insumo seleccionado y cantidad mayor a cero");
            return;
        }

        setIsSubmitting(true);
        const payload = {
            name: recipeName.trim(),
            description: recipeDescription.trim() || undefined,
            baseYield: recipeYield,
            unit: recipeUnit,
            priceSelling: recipePriceSelling,
            holdTimeMinutes: recipeHoldTime.trim() === "" ? null : Number(recipeHoldTime),
            items: recipeIngredients,
        };

        try {
            const url = editingRecipe
                ? `/api/inventory/recipes/${editingRecipe.id}`
                : "/api/inventory/recipes";
            const method = editingRecipe ? "PUT" : "POST";

            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || "Error al guardar la receta");
            }

            toast.success(editingRecipe ? "Ficha técnica actualizada" : "Ficha técnica creada con éxito");
            setIsDialogOpen(false);
            fetchData();
        } catch (error: any) {
            toast.error(error.message || "Error de servidor");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteRecipe = async (id: string) => {
        if (!confirm("¿Seguro que deseas eliminar esta ficha técnica?")) return;

        try {
            const res = await fetch(`/api/inventory/recipes/${id}`, {
                method: "DELETE",
            });
            if (res.ok) {
                toast.success("Receta eliminada");
                fetchData();
            } else {
                toast.error("Error al eliminar receta");
            }
        } catch (error) {
            toast.error("Error de red al eliminar receta");
        }
    };

    const handleRunSimulation = async () => {
        if (!simulatedItemId) {
            toast.error("Selecciona un insumo para la simulación");
            return;
        }

        setIsSimulating(true);
        try {
            const res = await fetch("/api/inventory/recipes/simulate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    itemId: simulatedItemId,
                    percentageChange: simulatedPercent / 100,
                }),
            });

            const data = await res.json();
            if (res.ok) {
                setSimulationResults(data.results || []);
                toast.success("Simulación completada con éxito");
            } else {
                toast.error(data.error || "Error al simular");
            }
        } catch (error) {
            toast.error("Error de servidor en simulación");
        } finally {
            setIsSimulating(false);
        }
    };

    // Cost calculations per ingredient row and totals
    const getIngredientCost = (item: RecipeItem) => {
        if (!item.itemId) return { costCents: 0, hasCost: false };
        if (item.isSubRecipe) {
            const sub = recipesList.find(r => r.id === item.itemId);
            if (sub) {
                const base = Number(sub.baseYield || 1);
                const unitCost = sub.calculatedCost / (base > 0 ? base : 1);
                return { costCents: unitCost * item.quantity, hasCost: sub.calculatedCost > 0 };
            }
        } else {
            const prod = dbItems.find(p => p.id === item.itemId);
            if (prod) {
                const unitCost = prod.lastCost || 0;
                return { costCents: unitCost * item.quantity, hasCost: (prod.lastCost ?? 0) > 0 };
            }
        }
        return { costCents: 0, hasCost: false };
    };

    const { estimatedCostCents, missingCostCount } = useMemo(() => {
        let total = 0;
        let missing = 0;
        recipeIngredients.forEach(ing => {
            const { costCents, hasCost } = getIngredientCost(ing);
            total += costCents;
            if (ing.itemId && !hasCost) missing++;
        });
        return { estimatedCostCents: total, missingCostCount: missing };
    }, [recipeIngredients, recipesList, dbItems]);

    const estimatedCostPesos = estimatedCostCents / 100;
    const estimatedFoodCostPct = recipePriceSelling > 0
        ? (estimatedCostPesos / recipePriceSelling) * 100
        : 0;

    // Filtered recipes list
    const filteredRecipes = useMemo(() => {
        return recipesList.filter(r => {
            const matchesQuery = !searchQuery.trim() ||
                r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (r.description && r.description.toLowerCase().includes(searchQuery.toLowerCase()));

            if (!matchesQuery) return false;

            if (selectedCategory === "PORTION") return r.unit === "PORTION";
            if (selectedCategory === "BULK") return r.unit === "KG" || r.unit === "L";
            if (selectedCategory === "ALERT") return Number(r.foodCostPercentage || 0) > 35;
            return true;
        });
    }, [recipesList, searchQuery, selectedCategory]);

    // KPI Summary Metrics
    const metrics = useMemo(() => {
        const total = recipesList.length;
        if (total === 0) return { total: 0, avgFoodCost: 0, optimalCount: 0, alertCount: 0 };

        let sumFoodCost = 0;
        let optimal = 0;
        let alerts = 0;

        recipesList.forEach(r => {
            const fc = Number(r.foodCostPercentage || 0);
            sumFoodCost += fc;
            if (fc <= 30 && fc > 0) optimal++;
            if (fc > 35) alerts++;
        });

        return {
            total,
            avgFoodCost: sumFoodCost / total,
            optimalCount: optimal,
            alertCount: alerts,
        };
    }, [recipesList]);

    return (
        <PageContainer>
            <PageHeader
                title="Recetas y Costeo (BOM)"
                description="Fichas técnicas de platillos, costeo teórico por porción, simulación de inflación y tiempo de retención"
                icon={ChefHat}
            />

            {/* KPI Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card className="p-4 border bg-card">
                    <span className="text-xs text-muted-foreground font-medium block">Total Fichas Técnicas</span>
                    <span className="text-2xl font-bold font-mono text-foreground mt-1 block">{metrics.total}</span>
                </Card>
                <Card className="p-4 border bg-card">
                    <span className="text-xs text-muted-foreground font-medium block">Food Cost Promedio</span>
                    <span className={cn(
                        "text-2xl font-bold font-mono mt-1 block",
                        metrics.avgFoodCost > 35 ? "text-destructive" : metrics.avgFoodCost > 30 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"
                    )}>
                        {metrics.avgFoodCost.toFixed(1)}%
                    </span>
                </Card>
                <Card className="p-4 border bg-card">
                    <span className="text-xs text-muted-foreground font-medium block">Margen Óptimo (≤30%)</span>
                    <span className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1 block">{metrics.optimalCount}</span>
                </Card>
                <Card className="p-4 border bg-card">
                    <span className="text-xs text-muted-foreground font-medium block">En Alerta de Costo (&gt;35%)</span>
                    <span className="text-2xl font-bold font-mono text-destructive mt-1 block">{metrics.alertCount}</span>
                </Card>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
                <TabsList>
                    <TabsTrigger value="list" className="gap-2">
                        <ChefHat className="w-4 h-4" /> Fichas Técnicas
                    </TabsTrigger>
                    <TabsTrigger value="simulation" className="gap-2">
                        <Calculator className="w-4 h-4" /> Simulador de Precios
                    </TabsTrigger>
                </TabsList>

                {/* Recipes List Tab */}
                <TabsContent value="list" className="space-y-4">
                    <div className="flex flex-col sm:flex-row gap-3 justify-between items-stretch sm:items-center">
                        {/* Search Input */}
                        <div className="relative flex-1 max-w-md">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                            <Input
                                placeholder="Buscar receta o platillo..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 text-sm"
                            />
                        </div>

                        {/* Create Button */}
                        <Button onClick={handleOpenCreateDialog} className="gap-2 shrink-0">
                            <Plus className="w-4 h-4" /> Nueva Ficha Técnica
                        </Button>
                    </div>

                    {/* Filter Pills */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <Button
                            type="button"
                            variant={selectedCategory === "ALL" ? "default" : "outline"}
                            size="sm"
                            className="h-8 text-xs"
                            onClick={() => setSelectedCategory("ALL")}
                        >
                            Todas ({recipesList.length})
                        </Button>
                        <Button
                            type="button"
                            variant={selectedCategory === "PORTION" ? "default" : "outline"}
                            size="sm"
                            className="h-8 text-xs"
                            onClick={() => setSelectedCategory("PORTION")}
                        >
                            Platillos / Porciones ({recipesList.filter(r => r.unit === "PORTION").length})
                        </Button>
                        <Button
                            type="button"
                            variant={selectedCategory === "BULK" ? "default" : "outline"}
                            size="sm"
                            className="h-8 text-xs"
                            onClick={() => setSelectedCategory("BULK")}
                        >
                            Bases a Granel (KG/L) ({recipesList.filter(r => r.unit === "KG" || r.unit === "L").length})
                        </Button>
                        <Button
                            type="button"
                            variant={selectedCategory === "ALERT" ? "destructive" : "outline"}
                            size="sm"
                            className="h-8 text-xs gap-1"
                            onClick={() => setSelectedCategory("ALERT")}
                        >
                            <AlertTriangle className="size-3" />
                            En Alerta ({metrics.alertCount})
                        </Button>
                    </div>

                    {loading ? (
                        <div className="flex items-center justify-center py-16">
                            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : filteredRecipes.length === 0 ? (
                        <Card className="text-center py-14 text-muted-foreground border">
                            <ChefHat className="h-12 w-12 mx-auto mb-3 opacity-40 text-muted-foreground" />
                            <p className="font-semibold text-foreground text-base">
                                {searchQuery ? "Sin resultados para tu búsqueda" : "No hay fichas técnicas registradas"}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                                {searchQuery ? "Prueba con otros términos de búsqueda." : "Crea tu primera receta para calcular costos por porción y habilitar la prep list de cocina."}
                            </p>
                            {!searchQuery && (
                                <Button onClick={handleOpenCreateDialog} className="mt-4 gap-2">
                                    <Plus className="w-4 h-4" /> Crear Receta
                                </Button>
                            )}
                        </Card>
                    ) : (
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            {filteredRecipes.map(recipe => {
                                const cost = recipe.calculatedCost / 100;
                                const price = recipe.priceSelling / 100;
                                const costPct = Number(recipe.foodCostPercentage || 0);
                                const grossMarginPct = price > 0 ? (1 - (cost / price)) * 100 : 0;

                                return (
                                    <Card key={recipe.id} className="flex flex-col justify-between border hover:border-foreground/25 transition-colors">
                                        <CardHeader className="pb-2">
                                            <div className="flex justify-between items-start gap-2">
                                                <div>
                                                    <CardTitle className="text-base font-semibold text-foreground">{recipe.name}</CardTitle>
                                                    <CardDescription className="text-xs line-clamp-1 mt-0.5">
                                                        {recipe.description || 'Sin descripción'}
                                                    </CardDescription>
                                                </div>
                                                <Badge
                                                    variant={costPct > 35 ? "destructive" : costPct > 30 ? "secondary" : "default"}
                                                    className="font-mono shrink-0 text-xs"
                                                >
                                                    {costPct.toFixed(1)}% FC
                                                </Badge>
                                            </div>
                                        </CardHeader>
                                        <CardContent className="text-xs space-y-2 pb-3">
                                            <div className="flex justify-between py-1 border-b border-border/60">
                                                <span className="text-muted-foreground">Rendimiento:</span>
                                                <span className="font-medium">{recipe.baseYield} {recipe.unit}</span>
                                            </div>
                                            <div className="flex justify-between py-1 border-b border-border/60">
                                                <span className="text-muted-foreground">Costo Teórico:</span>
                                                <span className="font-mono font-semibold">${cost.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                                            </div>
                                            <div className="flex justify-between py-1 border-b border-border/60">
                                                <span className="text-muted-foreground">Precio Venta:</span>
                                                <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">${price.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                                            </div>
                                            <div className="flex justify-between py-1 font-semibold">
                                                <span className="text-muted-foreground">Margen Bruto:</span>
                                                <span className={cn(
                                                    "font-mono",
                                                    grossMarginPct >= 70 ? "text-emerald-600 dark:text-emerald-400" : grossMarginPct >= 60 ? "text-foreground" : "text-amber-600 dark:text-amber-400"
                                                )}>
                                                    {grossMarginPct.toFixed(1)}%
                                                </span>
                                            </div>
                                            {recipe.holdTimeMinutes && recipe.holdTimeMinutes > 0 && (
                                                <div className="flex items-center gap-1.5 pt-1 text-muted-foreground">
                                                    <Clock className="size-3 text-primary" />
                                                    <span>Retención en línea: <strong>{recipe.holdTimeMinutes} min</strong></span>
                                                </div>
                                            )}
                                        </CardContent>
                                        <CardFooter className="flex justify-end gap-1.5 pt-2 border-t border-border/60 py-2 bg-muted/10">
                                            <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground" title="Historial de Versiones" onClick={() => handleOpenVersionsDialog(recipe)}>
                                                <History className="w-4 h-4" />
                                            </Button>
                                            <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground" title="Editar Ficha Técnica" onClick={() => handleOpenEditDialog(recipe)}>
                                                <Edit2 className="w-4 h-4" />
                                            </Button>
                                            <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" title="Eliminar Receta" onClick={() => handleDeleteRecipe(recipe.id)}>
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </CardFooter>
                                    </Card>
                                );
                            })}
                        </div>
                    )}
                </TabsContent>

                {/* Simulation Tab */}
                <TabsContent value="simulation" className="space-y-4">
                    <Card className="border">
                        <CardHeader>
                            <CardTitle className="text-lg">Simulador de Impacto Financiero</CardTitle>
                            <CardDescription className="text-xs">
                                Proyecta el impacto en los márgenes de platillos si un insumo clave cambia de costo (ej. inflación de aguacate, lácteos o carne).
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-4 md:grid-cols-3">
                                <div className="space-y-2">
                                    <Label className="text-xs">Ingrediente / Insumo</Label>
                                    <Select value={simulatedItemId} onValueChange={setSimulatedItemId}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Seleccionar insumo..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {dbItems.map(item => (
                                                <SelectItem key={item.id} value={item.id}>
                                                    {item.name} {item.sku && `(${item.sku})`}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-xs">Cambio de Costo (%)</Label>
                                    <Input
                                        type="number"
                                        value={simulatedPercent}
                                        onChange={(e) => setSimulatedPercent(Number(e.target.value))}
                                        placeholder="Ej. 15 o -10"
                                    />
                                </div>
                                <div className="flex items-end">
                                    <Button onClick={handleRunSimulation} disabled={isSimulating} className="w-full gap-2">
                                        {isSimulating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                                        Simular Proyección
                                    </Button>
                                </div>
                            </div>

                            {simulationResults.length > 0 && (
                                <div className="border rounded-lg overflow-hidden mt-6">
                                    <table className="min-w-full divide-y divide-border text-xs">
                                        <thead className="bg-muted/40">
                                            <tr>
                                                <th className="px-4 py-3 text-left font-semibold text-foreground">Receta Afectada</th>
                                                <th className="px-4 py-3 text-right font-semibold text-foreground">Costo Actual</th>
                                                <th className="px-4 py-3 text-right font-semibold text-foreground">Costo Simulado</th>
                                                <th className="px-4 py-3 text-right font-semibold text-foreground">Food Cost Actual</th>
                                                <th className="px-4 py-3 text-right font-semibold text-foreground">Food Cost Simulado</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border">
                                            {simulationResults.map(res => {
                                                const currentFoodCost = Number(res.currentFoodCostPct);
                                                const simulatedFoodCost = Number(res.simulatedFoodCostPct);
                                                const costIncrease = res.simulatedCostCents > res.currentCostCents;

                                                return (
                                                    <tr key={res.recipeId} className="hover:bg-muted/20">
                                                        <td className="px-4 py-3 font-medium text-foreground">{res.recipeName}</td>
                                                        <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                                                            ${(res.currentCostCents / 100).toFixed(2)}
                                                        </td>
                                                        <td className={cn(
                                                            "px-4 py-3 text-right font-mono font-semibold",
                                                            costIncrease ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"
                                                        )}>
                                                            ${(res.simulatedCostCents / 100).toFixed(2)}
                                                        </td>
                                                        <td className="px-4 py-3 text-right text-muted-foreground font-mono">
                                                            {currentFoodCost.toFixed(1)}%
                                                        </td>
                                                        <td className={cn(
                                                            "px-4 py-3 text-right font-mono font-semibold",
                                                            simulatedFoodCost > 35 ? "text-destructive" : (simulatedFoodCost > currentFoodCost ? "text-amber-600 dark:text-amber-400" : "text-foreground")
                                                        )}>
                                                            {simulatedFoodCost.toFixed(1)}%
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {/* Create/Edit Recipe Dialog */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editingRecipe ? "Editar Ficha Técnica" : "Nueva Ficha Técnica (Receta)"}</DialogTitle>
                        <DialogDescription className="text-xs">
                            Define la receta base, porciones, tiempo de retención y sus ingredientes para calcular el Food Cost.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-3">
                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label className="text-xs">Nombre de la Receta *</Label>
                                <Input
                                    value={recipeName}
                                    onChange={(e) => setRecipeName(e.target.value)}
                                    placeholder="Ej. Pizza Margarita Grande"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-xs">Descripción</Label>
                                <Input
                                    value={recipeDescription}
                                    onChange={(e) => setRecipeDescription(e.target.value)}
                                    placeholder="Ej. Pizza artesanal de 8 rebanadas"
                                />
                            </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-3">
                            <div className="space-y-2">
                                <Label className="text-xs">Rendimiento Base *</Label>
                                <Input
                                    type="number"
                                    min="0.01"
                                    value={recipeYield}
                                    onChange={(e) => setRecipeYield(Number(e.target.value))}
                                />
                                <div className="flex gap-1 pt-1">
                                    {[1, 2, 4, 10].map((step) => (
                                        <Button
                                            key={step}
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-6 px-1.5 text-xs font-mono"
                                            onClick={() => setRecipeYield(step)}
                                        >
                                            {step}
                                        </Button>
                                    ))}
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label className="text-xs">Unidad de Rendimiento</Label>
                                <Select value={recipeUnit} onValueChange={setRecipeUnit}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="PORTION">Porciones / Platillo</SelectItem>
                                        <SelectItem value="KG">Kilogramo (KG)</SelectItem>
                                        <SelectItem value="L">Litro (L)</SelectItem>
                                        <SelectItem value="UNIT">Piezas (Unidades)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label className="text-xs">Precio de Venta ($) *</Label>
                                <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={recipePriceSelling || ""}
                                    onChange={(e) => setRecipePriceSelling(Number(e.target.value))}
                                    placeholder="0.00"
                                />
                            </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-3">
                            <div className="space-y-2">
                                <Label className="text-xs">Tiempo de retención en línea (min)</Label>
                                <Input
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={recipeHoldTime}
                                    onChange={(e) => setRecipeHoldTime(e.target.value)}
                                    placeholder="Ej. 30 (opcional)"
                                />
                                <p className="text-xs text-muted-foreground">
                                    Ventana máxima fresca tras cocinar (pollo 30, hamburguesa 10). Vacío = sin hold time.
                                </p>
                            </div>
                        </div>

                        {/* Ingredients Builder */}
                        <Card className="border">
                            <CardHeader className="pb-2">
                                <div className="flex justify-between items-center">
                                    <div>
                                        <CardTitle className="text-sm font-semibold">Lista de Insumos / BOM ({recipeIngredients.length})</CardTitle>
                                        <CardDescription className="text-xs">
                                            Agrega insumos o sub-recetas para calcular la explosión de materiales y costo.
                                        </CardDescription>
                                    </div>
                                    <Button type="button" variant="outline" size="sm" onClick={handleAddIngredient} className="gap-1.5 h-8 text-xs">
                                        <Plus className="w-3.5 h-3.5" /> Agregar Insumo
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {recipeIngredients.length === 0 ? (
                                    <p className="text-xs text-muted-foreground text-center py-6 border border-dashed rounded">
                                        No hay insumos cargados. Haz clic en "Agregar Insumo" para armar la receta.
                                    </p>
                                ) : (
                                    recipeIngredients.map((item, index) => {
                                        const { costCents, hasCost } = getIngredientCost(item);
                                        const lineCostPesos = costCents / 100;

                                        return (
                                            <div key={index} className="flex flex-wrap sm:flex-nowrap gap-2 items-end border-b pb-3 last:border-b-0 last:pb-0 bg-muted/5 p-2 rounded">
                                                {/* Type selector (subrecipe or inventory item) */}
                                                <div className="w-24 shrink-0 space-y-1">
                                                    <Label className="text-xs text-muted-foreground">Tipo</Label>
                                                    <Select
                                                        value={item.isSubRecipe ? "subrecipe" : "product"}
                                                        onValueChange={(val) => {
                                                            handleIngredientChange(index, "isSubRecipe", val === "subrecipe");
                                                            handleIngredientChange(index, "itemId", "");
                                                        }}
                                                    >
                                                        <SelectTrigger className="h-8 text-xs">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="product">Insumo</SelectItem>
                                                            <SelectItem value="subrecipe">Sub-receta</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>

                                                {/* Item Selector */}
                                                <div className="flex-1 min-w-[180px] space-y-1">
                                                    <Label className="text-xs text-muted-foreground">Seleccionar</Label>
                                                    <Select
                                                        value={item.itemId}
                                                        onValueChange={(val) => handleIngredientChange(index, "itemId", val)}
                                                    >
                                                        <SelectTrigger className="h-8 text-xs">
                                                            <SelectValue placeholder="Seleccionar..." />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {item.isSubRecipe
                                                                ? recipesList.filter(r => r.id !== editingRecipe?.id).map(r => (
                                                                    <SelectItem key={r.id} value={r.id}>{r.name} ({r.unit})</SelectItem>
                                                                ))
                                                                : dbItems.map(p => (
                                                                    <SelectItem key={p.id} value={p.id}>{p.name} {p.sku && `(${p.sku})`}</SelectItem>
                                                                ))
                                                            }
                                                        </SelectContent>
                                                    </Select>
                                                </div>

                                                {/* Quantity */}
                                                <div className="w-24 shrink-0 space-y-1">
                                                    <Label className="text-xs text-muted-foreground">Cantidad</Label>
                                                    <Input
                                                        type="number"
                                                        min="0.0001"
                                                        step="0.0001"
                                                        value={item.quantity || ""}
                                                        onChange={(e) => handleIngredientChange(index, "quantity", Number(e.target.value))}
                                                        className="h-8 text-xs font-mono"
                                                    />
                                                </div>

                                                {/* Unit */}
                                                <div className="w-20 shrink-0 space-y-1">
                                                    <Label className="text-xs text-muted-foreground">Unidad</Label>
                                                    <Input value={item.unit} readOnly className="h-8 bg-muted/40 text-muted-foreground text-xs cursor-not-allowed" />
                                                </div>

                                                {/* Real-time Subtotal Cost per row */}
                                                <div className="w-24 shrink-0 space-y-1 text-right">
                                                    <Label className="text-xs text-muted-foreground">Subtotal</Label>
                                                    <div className="h-8 flex items-center justify-end font-mono text-xs font-semibold">
                                                        {item.itemId ? (
                                                            hasCost ? (
                                                                <span>${lineCostPesos.toFixed(2)}</span>
                                                            ) : (
                                                                <span className="text-amber-600 dark:text-amber-400 text-xs font-sans">Sin costo</span>
                                                            )
                                                        ) : (
                                                            <span className="text-muted-foreground">-</span>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Trash button */}
                                                <Button type="button" variant="ghost" size="icon" onClick={() => handleRemoveIngredient(index)} className="text-destructive h-8 w-8 shrink-0 hover:bg-destructive/10">
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            </div>
                                        );
                                    })
                                )}
                            </CardContent>
                        </Card>

                        {/* Missing Cost Notice */}
                        {missingCostCount > 0 && (
                            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
                                <AlertTriangle className="size-4 shrink-0" />
                                <span>Hay <strong>{missingCostCount}</strong> ingrediente(s) sin último costo registrado en inventario. El costo teórico mostrado puede ser inferior al real.</span>
                            </div>
                        )}

                        {/* Real-time Margin Estimator Summary */}
                        <div className="p-4 bg-muted/30 rounded-lg flex items-center justify-between border">
                            <div className="space-y-1">
                                <p className="text-xs text-muted-foreground">Costo Teórico Total</p>
                                <p className="font-mono text-xl font-bold text-foreground">${estimatedCostPesos.toFixed(2)}</p>
                            </div>
                            <div className="space-y-1 text-right">
                                <p className="text-xs text-muted-foreground">Food Cost Estimado</p>
                                <p className={cn(
                                    "text-xl font-bold font-mono flex items-center gap-1 justify-end",
                                    estimatedFoodCostPct > 35 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"
                                )}>
                                    <Percent className="w-4 h-4" />
                                    {estimatedFoodCostPct.toFixed(1)}%
                                </p>
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancelar</Button>
                        <Button onClick={handleSaveRecipe} disabled={isSubmitting} className="gap-2">
                            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            {editingRecipe ? "Guardar Cambios" : "Crear Ficha Técnica"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Recipe Version History Dialog */}
            <Dialog open={isVersionDialogOpen} onOpenChange={setIsVersionDialogOpen}>
                <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <History className="w-5 h-5 text-primary" />
                            Historial de Versiones: {versionHistoryRecipe?.name}
                        </DialogTitle>
                        <DialogDescription className="text-xs">
                            Auditoría inmutable de cambios en ingredientes, costos teóricos y modificaciones de ficha técnica.
                        </DialogDescription>
                    </DialogHeader>

                    {loadingVersions ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : versionsList.length === 0 ? (
                        <div className="text-center py-8 border border-dashed rounded-lg text-xs text-muted-foreground">
                            No hay versiones históricas registradas aún para esta receta.
                        </div>
                    ) : (
                        <div className="space-y-4 py-2">
                            {versionsList.map((ver) => (
                                <div key={ver.id} className="border rounded-lg p-4 space-y-3 bg-card/50">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <Badge variant="outline" className="font-mono font-bold text-xs">
                                                    v{ver.versionNumber}
                                                </Badge>
                                                <span className="font-semibold text-sm text-foreground">{ver.name}</span>
                                            </div>
                                            <p className="text-xs text-muted-foreground mt-1">
                                                {ver.changeReason || "Actualización de ficha técnica"}
                                            </p>
                                        </div>
                                        <div className="text-right text-xs text-muted-foreground">
                                            <span>{new Date(ver.createdAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                                            {ver.authorName && (
                                                <span className="block font-medium text-foreground">{ver.authorName}</span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Cost & Yield summary */}
                                    <div className="grid grid-cols-3 gap-2 p-2 bg-muted/40 rounded text-xs">
                                        <div>
                                            <span className="text-muted-foreground block">Rendimiento:</span>
                                            <span className="font-medium">{ver.baseYield} {ver.unit}</span>
                                        </div>
                                        <div>
                                            <span className="text-muted-foreground block">Costo Teórico:</span>
                                            <span className="font-mono font-bold text-foreground">${ver.calculatedCost.toFixed(2)}</span>
                                        </div>
                                        <div>
                                            <span className="text-muted-foreground block">Food Cost:</span>
                                            <span className="font-bold text-emerald-600 dark:text-emerald-400 font-mono">{Number(ver.foodCostPercentage).toFixed(1)}%</span>
                                        </div>
                                    </div>

                                    {/* Ingredients Snapshot */}
                                    {ver.itemsSnapshot && ver.itemsSnapshot.length > 0 && (
                                        <div className="border rounded divide-y divide-border text-xs">
                                            <div className="p-2 bg-muted/20 font-semibold text-xs text-muted-foreground">
                                                Ingredientes en esta versión ({ver.itemsSnapshot.length})
                                            </div>
                                            {ver.itemsSnapshot.map((item, idx) => (
                                                <div key={idx} className="flex justify-between items-center p-2">
                                                    <span className="font-medium">
                                                        {item.itemName || item.itemId}
                                                        {item.isSubRecipe && <Badge variant="secondary" className="ml-1 text-xs py-0">Sub-receta</Badge>}
                                                    </span>
                                                    <span className="font-mono text-muted-foreground">
                                                        {Number(item.quantity)} {item.unit}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsVersionDialogOpen(false)}>
                            Cerrar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </PageContainer>
    );
}
