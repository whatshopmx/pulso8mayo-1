"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    Plus,
    Search,
    Loader2,
    Warehouse,
    Edit,
    Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { LOCATION_TYPES } from "@/lib/inventory/constants";
import { useBranch } from "@/lib/branch-context";

interface StorageLocation {
    id: string;
    name: string;
    type: string;
    active: boolean;
    createdAt: string;
    updatedAt: string;
}

export function LocationManager() {
    const [locations, setLocations] = useState<StorageLocation[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingLocation, setEditingLocation] = useState<StorageLocation | null>(null);
    const [formName, setFormName] = useState("");
    const [formType, setFormType] = useState("DRY_STORAGE");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { selectedBranchId } = useBranch();

    const fetchLocations = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (selectedBranchId) params.set("branchId", selectedBranchId);
            if (searchTerm) params.set("search", searchTerm);
            const response = await fetch(`/api/inventory/storage-locations?${params.toString()}`);
            const result = await response.json();
            if (response.ok) {
                setLocations(result.locations);
            } else {
                toast.error(result.error || "Error al cargar ubicaciones");
            }
        } catch {
            toast.error("Error al cargar ubicaciones");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLocations();
    }, [selectedBranchId]);

    const resetForm = () => {
        setFormName("");
        setFormType("DRY_STORAGE");
    };

    const openEdit = (location: StorageLocation) => {
        setEditingLocation(location);
        setFormName(location.name);
        setFormType(location.type);
        setIsFormOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formName.trim()) {
            toast.error("El nombre es requerido");
            return;
        }

        setIsSubmitting(true);
        try {
            const url = editingLocation
                ? `/api/inventory/storage-locations/${editingLocation.id}`
                : "/api/inventory/storage-locations";
            const method = editingLocation ? "PATCH" : "POST";

            const response = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: formName.trim(), type: formType }),
            });

            const result = await response.json();
            if (response.ok) {
                toast.success(editingLocation ? "Ubicación actualizada" : "Ubicación creada");
                setIsFormOpen(false);
                setEditingLocation(null);
                resetForm();
                fetchLocations();
            } else {
                toast.error(result.error || "Error al guardar");
            }
        } catch {
            toast.error("Error al guardar ubicación");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (id: string, name: string) => {
        if (!confirm(`¿Eliminar "${name}"?`)) return;
        try {
            const response = await fetch(`/api/inventory/storage-locations/${id}`, {
                method: "DELETE",
            });
            if (response.ok) {
                toast.success("Ubicación eliminada");
                fetchLocations();
            } else {
                const result = await response.json();
                toast.error(result.error || "Error al eliminar");
            }
        } catch {
            toast.error("Error al eliminar ubicación");
        }
    };

    const getTypeLabel = (type: string) => {
        return LOCATION_TYPES.find(t => t.value === type)?.label || type;
    };

    const filteredLocations = locations.filter(loc => {
        if (!searchTerm) return true;
        const q = searchTerm.toLowerCase();
        return loc.name.toLowerCase().includes(q) || loc.type.toLowerCase().includes(q);
    });

    const typeBadgeVariant = (type: string) => {
        const coldTypes = ["REFRIGERATOR", "FREEZER"];
        return coldTypes.includes(type) ? "secondary" as const : "outline" as const;
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 flex-1">
                    <div className="relative flex-1 max-w-sm">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Buscar ubicaciones..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-8"
                        />
                    </div>
                    <Button variant="outline" onClick={fetchLocations} disabled={loading}>
                        <Search className="w-4 h-4" />
                    </Button>
                </div>
                <Dialog open={isFormOpen} onOpenChange={(open) => {
                    setIsFormOpen(open);
                    if (!open) { setEditingLocation(null); resetForm(); }
                }}>
                    <DialogTrigger asChild>
                        <Button className="gap-2">
                            <Plus className="w-4 h-4" />
                            Nueva Ubicación
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{editingLocation ? "Editar Ubicación" : "Nueva Ubicación"}</DialogTitle>
                            <DialogDescription>
                                {editingLocation ? "Actualiza los datos de la ubicación" : "Agrega una nueva ubicación de almacenamiento"}
                            </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="name">Nombre *</Label>
                                <Input
                                    id="name"
                                    value={formName}
                                    onChange={(e) => setFormName(e.target.value)}
                                    placeholder="Ej. Refrigerador Cocina Principal"
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Tipo</Label>
                                <Select value={formType} onValueChange={setFormType}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {LOCATION_TYPES.map((t) => (
                                            <SelectItem key={t.value} value={t.value}>
                                                {t.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => { setIsFormOpen(false); setEditingLocation(null); resetForm(); }}>
                                    Cancelar
                                </Button>
                                <Button type="submit" disabled={isSubmitting}>
                                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    {editingLocation ? "Actualizar" : "Crear"}
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </div>

            {loading ? (
                <Card>
                    <CardContent className="p-8 text-center text-muted-foreground">
                        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                        Cargando ubicaciones...
                    </CardContent>
                </Card>
            ) : filteredLocations.length === 0 ? (
                <Card>
                    <CardContent className="p-8 text-center">
                        <Warehouse className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                        <h3 className="text-lg font-semibold mb-2">No hay ubicaciones</h3>
                        <p className="text-muted-foreground mb-4">
                            {searchTerm
                                ? "No se encontraron ubicaciones que coincidan con tu búsqueda."
                                : "Agrega ubicaciones de almacenamiento para mejorar la trazabilidad."
                            }
                        </p>
                        {!searchTerm && (
                            <Button onClick={() => setIsFormOpen(true)}>
                                <Plus className="w-4 h-4 mr-2" />
                                Agregar Ubicación
                            </Button>
                        )}
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {filteredLocations.map((location) => (
                        <Card key={location.id}>
                            <CardHeader className="pb-2">
                                <div className="flex items-start justify-between">
                                    <div className="space-y-1 flex-1">
                                        <div className="flex items-center gap-2">
                                            <CardTitle className="text-lg">{location.name}</CardTitle>
                                            {!location.active && (
                                                <Badge variant="destructive" className="text-xs">Inactivo</Badge>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <Badge variant={typeBadgeVariant(location.type)}>
                                    {getTypeLabel(location.type)}
                                </Badge>
                                <div className="flex items-center gap-2 pt-4">
                                    <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(location)}>
                                        <Edit className="w-3 h-3 mr-1" /> Editar
                                    </Button>
                                    <Button variant="outline" size="sm" className="flex-1" onClick={() => handleDelete(location.id, location.name)}>
                                        <Trash2 className="w-3 h-3 mr-1" /> Eliminar
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
