"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, PageContainer } from "@/components/shared";
import { ChefHat, Plus, Trash2, Edit2, Play, Percent, DollarSign, Calculator, AlertTriangle, Check, Loader2 } from "lucide-react";
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

export default function RecipesPage() {
    const [recipesList, setRecipesList] = useState<Recipe[]>([]);
    const [dbItems, setDbItems] = useState<InventoryProduct[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState("list");

    // Recipe Form State
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
    const [recipeName, setRecipeName] = useState("");
    const [recipeDescription, setRecipeDescription] = useState("");
    const [recipeYield, setRecipeYield] = useState(1);
    const [recipeUnit, setRecipeUnit] = useState("PORTION");
    const [recipePriceSelling, setRecipePriceSelling] = useState(0);
    // Task 4 (loteprod §6.4): "" = la receta no maneja tiempo de retención.
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
            // Fetch recipes
            const recipesRes = await fetch("/api/inventory/recipes");
            if (recipesRes.ok) {
                const data = await recipesRes.json();
                setRecipesList(data || []);
            }

            // Fetch products
            const itemsRes = await fetch("/api/inventory/products");
            if (itemsRes.ok) {
                const data = await itemsRes.json();
                setDbItems(data || []);
            }
        } catch (error) {
            console.error("Error loading data:", error);
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
                // Autofill default unit if itemId changes
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
        if (!recipeName) {
            toast.error("Ingresa el nombre de la receta");
            return;
        }

        const invalidIngredients = recipeIngredients.filter(i => !i.itemId || i.quantity <= 0);
        if (invalidIngredients.length > 0) {
            toast.error("Todos los ingredientes deben tener insumo y cantidad válida");
            return;
        }

        setIsSubmitting(true);
        const payload = {
            name: recipeName,
            description: recipeDescription || undefined,
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

            toast.success(editingRecipe ? "Receta actualizada" : "Receta creada");
            setIsDialogOpen(false);
            fetchData();
        } catch (error: any) {
            toast.error(error.message || "Error de servidor");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteRecipe = async (id: string) => {
        if (!confirm("¿Seguro que deseas eliminar esta receta?")) return;

        try {
            const res = await fetch(`/api/inventory/recipes/${id}`, {
                method: "DELETE",
            });
            if (res.ok) {
                toast.success("Receta eliminada");
                fetchData();
            } else {
                toast.error("Error al eliminar");
            }
        } catch (error) {
            toast.error("Error al eliminar");
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
                toast.success("Simulación completada");
            } else {
                toast.error(data.error || "Error al simular");
            }
        } catch (error) {
            toast.error("Error de servidor en simulación");
        } finally {
            setIsSimulating(false);
        }
    };

    // Calculate real-time estimated cost of the recipe before saving
    const getEstimatedCost = () => {
        let total = 0;
        recipeIngredients.forEach(ing => {
            if (ing.isSubRecipe) {
                const sub = recipesList.find(r => r.id === ing.itemId);
                if (sub) {
                    const base = Number(sub.baseYield || 1);
                    total += (sub.calculatedCost / base) * ing.quantity;
                }
            } else {
                const item = dbItems.find(p => p.id === ing.itemId);
                if (item) {
                    total += (item.lastCost || 0) * ing.quantity;
                }
            }
        });
        return total;
    };

    const estimatedCost = getEstimatedCost();
    const estimatedFoodCostPct = recipePriceSelling > 0 ? ((estimatedCost / 100) / recipePriceSelling) * 100 : 0;

    return (
        <PageContainer>
            <PageHeader
                title="Recetas y Costeo (BOM)"
                description="Gestiona las fichas técnicas de tus platillos, calcula márgenes y simula fluctuaciones de costos"
                icon={ChefHat}
            />

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
                <TabsList>
                    <TabsTrigger value="list" className="gap-2">
                        <ChefHat className="w-4 h-4" /> Platillos y Recetas
                    </TabsTrigger>
                    <TabsTrigger value="simulation" className="gap-2">
                        <Calculator className="w-4 h-4" /> Simulador de Precios
                    </TabsTrigger>
                </TabsList>

                {/* Recipes List Tab */}
                <TabsContent value="list" className="space-y-4">
                    <div className="flex justify-between items-center">
                        <h3 className="text-lg font-semibold text-slate-800">Fichas Técnicas Activas</h3>
                        <Button onClick={handleOpenCreateDialog} className="gap-2">
                            <Plus className="w-4 h-4" /> Nueva Receta
                        </Button>
                    </div>

                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-8 h-8 animate-spin" />
                        </div>
                    ) : recipesList.length === 0 ? (
                        <Card className="text-center py-12 text-muted-foreground">
                            <ChefHat className="h-12 w-12 mx-auto mb-4 opacity-55" />
                            <p className="font-medium">No hay recetas registradas.</p>
                            <p className="text-sm text-slate-500">Crea tu primera receta para calcular costos.</p>
                        </Card>
                    ) : (
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            {recipesList.map(recipe => {
                                const cost = recipe.calculatedCost / 100;
                                const price = recipe.priceSelling / 100;
                                const costPct = Number(recipe.foodCostPercentage || 0);

                                return (
                                    <Card key={recipe.id} className="hover:shadow-md transition-shadow">
                                        <CardHeader className="pb-2">
                                            <div className="flex justify-between items-start">
                                                <div>
                                                    <CardTitle className="text-base">{recipe.name}</CardTitle>
                                                    <CardDescription className="text-xs line-clamp-1">
                                                        {recipe.description || 'Sin descripción'}
                                                    </CardDescription>
                                                </div>
                                                <Badge variant={costPct > 35 ? "destructive" : "secondary"}>
                                                    {costPct.toFixed(1)}% Cost
                                                </Badge>
                                            </div>
                                        </CardHeader>
                                        <CardContent className="text-sm space-y-2 pb-4">
                                            <div className="flex justify-between py-1 border-b">
                                                <span className="text-muted-foreground">Rendimiento:</span>
                                                <span className="font-medium">{recipe.baseYield} {recipe.unit}</span>
                                            </div>
                                            <div className="flex justify-between py-1 border-b">
                                                <span className="text-muted-foreground">Costo Receta:</span>
                                                <span className="font-mono font-semibold">${cost.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                                            </div>
                                            <div className="flex justify-between py-1 border-b">
                                                <span className="text-muted-foreground">Precio Venta:</span>
                                                <span className="font-mono font-semibold text-emerald-600">${price.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                                            </div>
                                            <div className="flex justify-between py-1 font-semibold text-emerald-700">
                                                <span>Margen Bruto:</span>
                                                <span>{price > 0 ? ((1 - (cost / price)) * 100).toFixed(1) : 0}%</span>
                                            </div>
                                        </CardContent>
                                        <CardFooter className="flex justify-end gap-2 pt-0 border-t py-2">
                                            <Button size="icon" variant="ghost" className="h-8 w-8 text-slate-500" onClick={() => handleOpenEditDialog(recipe)}>
                                                <Edit2 className="w-4 h-4" />
                                            </Button>
                                            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => handleDeleteRecipe(recipe.id)}>
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
                    <Card>
                        <CardHeader>
                            <CardTitle>Simulador de Impacto Financiero</CardTitle>
                            <CardDescription>
                                Proyecta el impacto en tus márgenes de alimentos si un ingrediente cambia de costo (ej. sequías, inflación de aguacate o carne).
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-4 md:grid-cols-3">
                                <div className="space-y-2">
                                    <Label>Ingrediente / Insumo</Label>
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
                                    <Label>Cambio de Costo (%)</Label>
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
                                    <table className="min-w-full divide-y divide-border text-sm">
                                        <thead className="bg-slate-50">
                                            <tr>
                                                <th className="px-4 py-3 text-left font-semibold text-slate-700">Receta Afectada</th>
                                                <th className="px-4 py-3 text-right font-semibold text-slate-700">Costo Actual</th>
                                                <th className="px-4 py-3 text-right font-semibold text-slate-700">Costo Simulado</th>
                                                <th className="px-4 py-3 text-right font-semibold text-slate-700">Food Cost Actual</th>
                                                <th className="px-4 py-3 text-right font-semibold text-slate-700">Food Cost Simulado</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border">
                                            {simulationResults.map(res => {
                                                const currentFoodCost = Number(res.currentFoodCostPct);
                                                const simulatedFoodCost = Number(res.simulatedFoodCostPct);
                                                const costIncrease = res.simulatedCostCents > res.currentCostCents;

                                                return (
                                                    <tr key={res.recipeId} className="hover:bg-slate-50/50">
                                                        <td className="px-4 py-3 font-medium text-slate-800">{res.recipeName}</td>
                                                        <td className="px-4 py-3 text-right font-mono text-slate-600">
                                                            ${(res.currentCostCents / 100).toFixed(2)}
                                                        </td>
                                                        <td className={cn(
                                                            "px-4 py-3 text-right font-mono font-semibold",
                                                            costIncrease ? "text-amber-600" : "text-emerald-600"
                                                        )}>
                                                            ${(res.simulatedCostCents / 100).toFixed(2)}
                                                        </td>
                                                        <td className="px-4 py-3 text-right text-slate-600">
                                                            {currentFoodCost.toFixed(1)}%
                                                        </td>
                                                        <td className={cn(
                                                            "px-4 py-3 text-right font-semibold",
                                                            simulatedFoodCost > 35 ? "text-destructive" : (simulatedFoodCost > currentFoodCost ? "text-amber-600" : "text-slate-700")
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
                        <DialogDescription>
                            Define la receta base, porciones y sus ingredientes para calcular el Food Cost.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label>Nombre de la Receta *</Label>
                                <Input
                                    value={recipeName}
                                    onChange={(e) => setRecipeName(e.target.value)}
                                    placeholder="Ej. Pizza Margarita Grande"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Descripción</Label>
                                <Input
                                    value={recipeDescription}
                                    onChange={(e) => setRecipeDescription(e.target.value)}
                                    placeholder="Ej. Pizza artesanal de 8 rebanadas"
                                />
                            </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-3">
                            <div className="space-y-2">
                                <Label>Rendimiento Base *</Label>
                                <Input
                                    type="number"
                                    min="0.01"
                                    value={recipeYield}
                                    onChange={(e) => setRecipeYield(Number(e.target.value))}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Unidad de Rendimiento</Label>
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
                                <Label>Precio de Venta ($) *</Label>
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
                                <Label>Tiempo de retención (min)</Label>
                                <Input
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={recipeHoldTime}
                                    onChange={(e) => setRecipeHoldTime(e.target.value)}
                                    placeholder="Ej. 30"
                                />
                                <p className="text-xs text-muted-foreground">
                                    Ventana máxima en línea después de producir (pollo 30, hamburguesa armada 10).
                                    Vacío = la receta no maneja hold time.
                                </p>
                            </div>
                        </div>

                        {/* Ingredients Builder */}
                        <Card>
                            <CardHeader className="pb-2">
                                <div className="flex justify-between items-center">
                                    <CardTitle className="text-sm font-semibold">Ingredientes / BOM (BOM List)</CardTitle>
                                    <Button type="button" variant="outline" size="sm" onClick={handleAddIngredient} className="gap-1.5">
                                        <Plus className="w-3.5 h-3.5" /> Agregar Insumo
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {recipeIngredients.length === 0 ? (
                                    <p className="text-xs text-muted-foreground text-center py-4">No hay ingredientes cargados.</p>
                                ) : (
                                    recipeIngredients.map((item, index) => (
                                        <div key={index} className="flex gap-3 items-end border-b pb-3 last:border-b-0 last:pb-0">
                                            {/* Type selector (subrecipe or inventory item) */}
                                            <div className="w-24 shrink-0 space-y-1.5">
                                                <Label className="text-xs">Tipo</Label>
                                                <Select
                                                    value={item.isSubRecipe ? "subrecipe" : "product"}
                                                    onValueChange={(val) => {
                                                        handleIngredientChange(index, "isSubRecipe", val === "subrecipe");
                                                        handleIngredientChange(index, "itemId", "");
                                                    }}
                                                >
                                                    <SelectTrigger className="h-9 text-xs">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="product">Insumo</SelectItem>
                                                        <SelectItem value="subrecipe">Receta</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>

                                            {/* Item Selector */}
                                            <div className="flex-1 space-y-1.5">
                                                <Label className="text-xs">Seleccionar</Label>
                                                <Select
                                                    value={item.itemId}
                                                    onValueChange={(val) => handleIngredientChange(index, "itemId", val)}
                                                >
                                                    <SelectTrigger className="h-9">
                                                        <SelectValue placeholder="Buscar..." />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {item.isSubRecipe 
                                                            ? recipesList.filter(r => r.id !== editingRecipe?.id).map(r => (
                                                                <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                                                            ))
                                                            : dbItems.map(p => (
                                                                <SelectItem key={p.id} value={p.id}>{p.name} {p.sku && `(${p.sku})`}</SelectItem>
                                                            ))
                                                        }
                                                    </SelectContent>
                                                </Select>
                                            </div>

                                            {/* Quantity */}
                                            <div className="w-24 shrink-0 space-y-1.5">
                                                <Label className="text-xs">Cantidad</Label>
                                                <Input
                                                    type="number"
                                                    min="0.0001"
                                                    step="0.0001"
                                                    value={item.quantity || ""}
                                                    onChange={(e) => handleIngredientChange(index, "quantity", Number(e.target.value))}
                                                    className="h-9"
                                                />
                                            </div>

                                            {/* Unit */}
                                            <div className="w-20 shrink-0 space-y-1.5">
                                                <Label className="text-xs">Unidad</Label>
                                                <Input value={item.unit} readOnly className="h-9 bg-slate-50 text-slate-500 cursor-not-allowed" />
                                            </div>

                                            {/* Trash button */}
                                            <Button type="button" variant="ghost" size="icon" onClick={() => handleRemoveIngredient(index)} className="text-destructive h-9 w-9 shrink-0">
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    ))
                                )}
                            </CardContent>
                        </Card>

                        {/* Real-time Margin Estimator Summary */}
                        <div className="p-4 bg-slate-50 rounded-lg flex items-center justify-between border">
                            <div className="space-y-1">
                                <p className="text-xs text-muted-foreground">Costo Teórico Estimado</p>
                                <p className="font-mono text-lg font-bold">${(estimatedCost / 100).toFixed(2)}</p>
                            </div>
                            <div className="space-y-1 text-right">
                                <p className="text-xs text-muted-foreground">Food Cost Estimado</p>
                                <p className={cn(
                                    "text-lg font-bold flex items-center gap-1 justify-end",
                                    estimatedFoodCostPct > 35 ? "text-destructive" : "text-emerald-700"
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
                            {editingRecipe ? "Guardar Cambios" : "Crear Receta"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </PageContainer>
    );
}
