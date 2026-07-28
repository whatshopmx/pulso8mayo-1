"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Supplier {
    id?: string;
    name: string;
    contactName?: string;
    email?: string;
    phone?: string;
    address?: string;
    taxId?: string;
    active?: boolean;
    matchTolerancePercent?: number;
}

interface SupplierFormProps {
    supplier?: Supplier;
    onSuccess?: () => void;
    onCancel?: () => void;
}

export function SupplierForm({ supplier, onSuccess, onCancel }: SupplierFormProps) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formData, setFormData] = useState<Supplier>({
        name: "",
        contactName: "",
        email: "",
        phone: "",
        address: "",
        taxId: "",
        active: true,
        matchTolerancePercent: 5,
    });

    useEffect(() => {
        if (supplier) {
            setFormData({
                ...supplier,
                active: supplier.active !== undefined ? supplier.active : true,
                matchTolerancePercent: supplier.matchTolerancePercent !== undefined ? supplier.matchTolerancePercent : 5,
            });
        }
    }, [supplier]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.name.trim()) {
            toast.error("El nombre es requerido");
            return;
        }

        setIsSubmitting(true);

        try {
            const url = supplier?.id
                ? `/api/inventory/suppliers/${supplier.id}`
                : "/api/inventory/suppliers";

            const method = supplier?.id ? "PATCH" : "POST";

            const response = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(formData),
            });

            const result = await response.json();

            if (response.ok) {
                toast.success(supplier?.id ? "Proveedor actualizado" : "Proveedor creado");
                onSuccess?.();
            } else {
                toast.error(result.error || "Failed to save supplier");
            }
        } catch (error) {
            console.error("Save supplier error:", error);
            toast.error("Error al guardar proveedor");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="name">Nombre / Razón Social *</Label>
                    <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="Ej. Distribuidora ABC S.A. de C.V."
                        required
                    />
                </div>

                <div className="space-y-2">
                    <Label htmlFor="taxId">RFC</Label>
                    <Input
                        id="taxId"
                        value={formData.taxId || ""}
                        onChange={(e) => setFormData({ ...formData, taxId: e.target.value })}
                        placeholder="Ej. ABC123456XYZ"
                        maxLength={13}
                    />
                </div>

                <div className="space-y-2">
                    <Label htmlFor="contactName">Nombre de Contacto</Label>
                    <Input
                        id="contactName"
                        value={formData.contactName || ""}
                        onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                        placeholder="Ej. Juan Pérez"
                    />
                </div>

                <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                        id="email"
                        type="email"
                        value={formData.email || ""}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        placeholder="contacto@proveedor.com"
                    />
                </div>

                <div className="space-y-2">
                    <Label htmlFor="phone">Teléfono</Label>
                    <Input
                        id="phone"
                        value={formData.phone || ""}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        placeholder="Ej. 55 1234 5678"
                    />
                </div>

                <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="address">Dirección</Label>
                    <Input
                        id="address"
                        value={formData.address || ""}
                        onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                        placeholder="Ej. Av. Principal 123, Col. Centro, CDMX"
                    />
                </div>

                <div className="space-y-2">
                    <Label htmlFor="matchTolerancePercent">Tolerancia de Desvío (%)</Label>
                    <Input
                        id="matchTolerancePercent"
                        type="number"
                        min={0}
                        max={100}
                        value={formData.matchTolerancePercent !== undefined ? formData.matchTolerancePercent : 5}
                        onChange={(e) => setFormData({ ...formData, matchTolerancePercent: Number(e.target.value) })}
                        placeholder="Ej. 5"
                    />
                </div>

                <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/10">
                    <div className="space-y-0.5">
                        <Label htmlFor="active" className="text-sm font-medium">Estado del Proveedor</Label>
                        <p className="text-xs text-muted-foreground">Surtir órdenes y compras</p>
                    </div>
                    <Switch
                        id="active"
                        checked={formData.active !== undefined ? formData.active : true}
                        onCheckedChange={(checked) => setFormData({ ...formData, active: checked })}
                    />
                </div>
            </div>

            <div className="flex items-center gap-2 pt-4">
                <Button
                    type="button"
                    variant="outline"
                    onClick={onCancel}
                    disabled={isSubmitting}
                >
                    Cancelar
                </Button>
                <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1"
                >
                    {isSubmitting ? (
                        <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Guardando...
                        </>
                    ) : (
                        supplier?.id ? "Actualizar" : "Crear Proveedor"
                    )}
                </Button>
            </div>
        </form>
    );
}
