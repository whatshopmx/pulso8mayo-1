"use client";

import { createProduct, updateProduct } from "@/app/actions/inventory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ProductPhotoUpload } from "@/components/inventory/product-photo-upload";
import { useState } from "react";
import { CATEGORIES, UNITS } from "@/lib/inventory/constants";

function SubmitButton() {
    const { pending } = useFormStatus();

    return (
        <Button type="submit" disabled={pending}>
            {pending ? "Guardando..." : "Guardar Producto"}
        </Button>
    );
}

interface ProductFormProps {
    suppliers?: { id: string; name: string }[];
    initialData?: any;
}

export function ProductForm({ suppliers = [], initialData }: ProductFormProps) {
    const action = initialData ? updateProduct.bind(null, initialData.id) : createProduct;
    const defaultCost = initialData?.lastCost ? (initialData.lastCost / 100).toFixed(2) : "";
    const defaultStandardCost = initialData?.standardCost ? (initialData.standardCost / 100).toFixed(2) : "";
    const [photoUrl, setPhotoUrl] = useState<string | null>(initialData?.photoUrl || null);

    return (
        <form action={action} className="max-w-2xl mx-auto space-y-6">
            <div className="flex items-center gap-4 mb-6">
                <Link href="/dashboard/inventory">
                    <Button variant="ghost" size="icon">
                        <ChevronLeft className="w-5 h-5" />
                    </Button>
                </Link>
                <h1 className="text-2xl font-bold">Nuevo Producto</h1>
            </div>

            <Card>
                <CardContent className="pt-6 space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="name">Nombre del Producto</Label>
                        <Input id="name" name="name" placeholder="Ej: Harina de Trigo" required defaultValue={initialData?.name} />
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="sku">SKU</Label>
                            <Input id="sku" name="sku" placeholder="HAR-001" defaultValue={initialData?.sku} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="barcode">Código de Barras</Label>
                            <Input id="barcode" name="barcode" placeholder="750100123456" defaultValue={initialData?.barcode} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="category">Categoría</Label>
                            <Select name="category" defaultValue={initialData?.category}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Seleccionar..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {CATEGORIES.map((cat) => (
                                        <SelectItem key={cat.value} value={cat.value}>
                                            {cat.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="unit">Unidad de Medida</Label>
                            <Select name="unit" defaultValue={initialData?.unit || "PIEZA"}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Seleccionar..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {UNITS.map((u) => (
                                        <SelectItem key={u.value} value={u.value}>
                                            {u.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="minLevel">Stock Mínimo</Label>
                            <Input id="minLevel" name="minLevel" type="number" min="0" placeholder="0" defaultValue={initialData?.minLevel} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="maxLevel">Stock Máximo</Label>
                            <Input id="maxLevel" name="maxLevel" type="number" min="0" placeholder="0" defaultValue={initialData?.maxLevel} />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                        <div className="space-y-2">
                            <Label htmlFor="typicalShelfLifeDays">Vida Útil (días)</Label>
                            <Input id="typicalShelfLifeDays" name="typicalShelfLifeDays" type="number" min="0" placeholder="Ej: 365" defaultValue={initialData?.typicalShelfLifeDays} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="storageRequirements">Requisitos de Almacenamiento</Label>
                            <Input id="storageRequirements" name="storageRequirements" placeholder="Ej: Temperatura ambiente < 25°C" defaultValue={initialData?.storageRequirements} />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                        <div className="space-y-2">
                            <Label htmlFor="storageType">Tipo de Almacenamiento</Label>
                            <Select name="storageType" defaultValue={initialData?.storageType || ""}>
                                <SelectTrigger id="storageType">
                                    <SelectValue placeholder="Sin clasificar" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="">Sin clasificar</SelectItem>
                                    <SelectItem value="DRY">Seco (sin control de temperatura)</SelectItem>
                                    <SelectItem value="REFRIGERATED">Refrigerado (0–4°C)</SelectItem>
                                    <SelectItem value="FROZEN">Congelado (≤ -18°C)</SelectItem>
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                Define el rango de temperatura que se exige al recibir este producto.
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                        <div className="space-y-2">
                            <Label htmlFor="brand">Marca</Label>
                            <Input id="brand" name="brand" placeholder="Ej: Maseca" defaultValue={initialData?.brand} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="presentation">Presentación</Label>
                            <Input id="presentation" name="presentation" placeholder="Ej: Bolsa de 5 kg, Caja de 12 botellas" defaultValue={initialData?.presentation} />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="allergenInfo">Información de Alérgenos</Label>
                        <Input id="allergenInfo" name="allergenInfo" placeholder="Ej: Contiene gluten, lácteos" defaultValue={initialData?.allergenInfo} />
                    </div>

                    <ProductPhotoUpload
                        currentPhotoUrl={initialData?.photoUrl}
                        onPhotoChange={setPhotoUrl}
                    />

                    {/* Fase 4: SKU de alto valor (conteo semanal 80/20) */}
                    <div className="flex items-center gap-3 rounded-lg border bg-muted/10 p-3">
                        <input
                            id="isHighValue"
                            type="checkbox"
                            name="isHighValue"
                            value="true"
                            defaultChecked={initialData?.isHighValue === true}
                            className="h-4 w-4 shrink-0"
                        />
                        <label htmlFor="isHighValue" className="text-sm">
                            <span className="font-semibold">SKU de alto valor</span>
                            <span className="block text-xs text-muted-foreground">
                                Se cuenta semanalmente por defecto (80% del costo). Máx. 30 SKUs por empresa.
                            </span>
                        </label>
                    </div>

                    {/* Supplier and Cost Section */}
                    <div className="grid grid-cols-3 gap-4 pt-2 border-t">
                        <div className="space-y-2">
                            <Label htmlFor="supplierId">Proveedor Preferido</Label>
                            <Select name="supplierId" defaultValue={initialData?.supplierId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Seleccionar Proveedor..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {suppliers.length > 0 ? (
                                        suppliers.map(s => (
                                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                        ))
                                    ) : (
                                        <div className="p-2 text-sm text-muted-foreground text-center">
                                            No hay proveedores registrados
                                        </div>
                                    )}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="lastCost">Último Costo de Compra</Label>
                            <Input id="lastCost" name="lastCost" type="number" step="0.01" min="0" placeholder="0.00" defaultValue={defaultCost} />
                            <p className="text-xs text-muted-foreground">Último costo unitario registrado.</p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="standardCost">Costo Estándar</Label>
                            <Input id="standardCost" name="standardCost" type="number" step="0.01" min="0" placeholder="0.00" defaultValue={defaultStandardCost} />
                            <p className="text-xs text-muted-foreground">Costo presupuestado u objetivo.</p>
                        </div>
                    </div>

                </CardContent>
            </Card>

            <div className="flex justify-end gap-2">
                <Link href="/dashboard/inventory">
                    <Button variant="outline" type="button">Cancelar</Button>
                </Link>
                <SubmitButton />
            </div>
        </form>
    );
}
