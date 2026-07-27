"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Conversion {
  id: string;
  fromUnit: string;
  toUnit: string;
  factor: number;
  description?: string | null;
}

export function UnitConversionManager() {
  const [conversions, setConversions] = useState<Conversion[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [formData, setFormData] = useState({ fromUnit: "", toUnit: "", factor: "", description: "" });

  useEffect(() => {
    fetch("/api/inventory/conversions")
      .then((res) => res.json())
      .then((data) => {
        setConversions(Array.isArray(data) ? data : data.conversions || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const uniqueUnits = [...new Set(conversions.flatMap((c) => [c.fromUnit, c.toUnit]))].sort();

  const handleAdd = async () => {
    if (!formData.fromUnit || !formData.toUnit || !formData.factor) {
      toast.error("Completa todos los campos requeridos");
      return;
    }

    try {
      const res = await fetch("/api/inventory/conversions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromUnit: formData.fromUnit,
          toUnit: formData.toUnit,
          factor: Number(formData.factor),
          description: formData.description || undefined,
        }),
      });

      if (!res.ok) throw new Error("Failed to create conversion");

      const newConversion = await res.json();
      setConversions((prev) => [...prev, newConversion]);
      setIsAddOpen(false);
      setFormData({ fromUnit: "", toUnit: "", factor: "", description: "" });
      toast.success("Conversión agregada");
    } catch {
      toast.error("Error al agregar conversión");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/inventory/conversions/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      setConversions((prev) => prev.filter((c) => c.id !== id));
      toast.success("Conversión eliminada");
    } catch {
      toast.error("Error al eliminar conversión");
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg">Conversiones de Unidad</CardTitle>
          <CardDescription>Define las reglas de conversión entre unidades de medida</CardDescription>
        </div>
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2">
              <Plus className="w-4 h-4" />
              Agregar
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nueva Conversión</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>De (unidad origen)</Label>
                  <Select value={formData.fromUnit} onValueChange={(v) => setFormData((p) => ({ ...p, fromUnit: v }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar..." />
                    </SelectTrigger>
                    <SelectContent>
                      {uniqueUnits.map((unit) => (
                        <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>A (unidad destino)</Label>
                  <Select value={formData.toUnit} onValueChange={(v) => setFormData((p) => ({ ...p, toUnit: v }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar..." />
                    </SelectTrigger>
                    <SelectContent>
                      {uniqueUnits.map((unit) => (
                        <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Factor (1 unidad origen = ? unidades destino)</Label>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Ej: 2.20462"
                  value={formData.factor}
                  onChange={(e) => setFormData((p) => ({ ...p, factor: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Descripción (opcional)</Label>
                <Input
                  placeholder="Ej: Kilogramos a Libras"
                  value={formData.description}
                  onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddOpen(false)}>Cancelar</Button>
              <Button onClick={handleAdd}>Guardar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {conversions.length === 0 ? (
          <div className="p-8 text-center border rounded-lg bg-muted/20 text-muted-foreground text-sm">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 text-muted-foreground/60" />
            <p>No hay conversiones configuradas. Agrega una para empezar.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>De</TableHead>
                <TableHead>A</TableHead>
                <TableHead>Factor</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {conversions.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.fromUnit}</TableCell>
                  <TableCell>{c.toUnit}</TableCell>
                  <TableCell className="font-mono">{c.factor}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{c.description || "-"}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(c.id)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
