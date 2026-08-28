"use client";

// Task 6b (plan-loteprod-gaps §6.2) — alta y edición de una línea de la hoja.
//
// El mismo formulario sirve para crear y para corregir: son los mismos siete
// campos del manual y separarlos en dos diálogos sólo duplicaría la validación.
// Editar NO toca la producción registrada — para eso está el checkbox de
// completar, que es la única acción de la hoja que mueve inventario.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PREP_SHIFT_LABELS, PREP_STATION_SUGGESTIONS } from "@/lib/inventory/prep-list";
import type { PrepLine } from "./prep-list-board";

interface Recipe {
    id: string;
    name: string;
    unit: string;
}

interface Employee {
    id: string;
    name: string | null;
}

/** Valor del Select cuando el campo se deja vacío: Radix no admite `value=""`. */
const SIN_VALOR = "__none__";

export function PrepListLineDialog({
    open,
    onOpenChange,
    branchId,
    date,
    line,
    onSaved,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    branchId: string;
    date: string | null;
    /** Línea a editar; null = alta. */
    line: PrepLine | null;
    onSaved: () => void;
}) {
    const [recipes, setRecipes] = useState<Recipe[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [submitting, setSubmitting] = useState(false);

    const [recipeId, setRecipeId] = useState("");
    const [quantity, setQuantity] = useState(1);
    const [station, setStation] = useState("");
    const [shift, setShift] = useState(SIN_VALOR);
    const [responsibleUserId, setResponsibleUserId] = useState(SIN_VALOR);
    const [deadlineTime, setDeadlineTime] = useState("");
    const [notes, setNotes] = useState("");

    // Catálogos: sólo al abrir, y una vez por apertura.
    useEffect(() => {
        if (!open) return;
        (async () => {
            try {
                const res = await fetch("/api/inventory/recipes");
                const data = await res.json();
                if (res.ok) setRecipes(Array.isArray(data) ? data : data.recipes || []);
            } catch { /* el select queda vacío; el formulario lo dice */ }
        })();
        (async () => {
            try {
                const res = await fetch(`/api/branches/${branchId}/employees`);
                const json = await res.json();
                if (res.ok && json.success) setEmployees(json.data || []);
            } catch { /* responsable es opcional */ }
        })();
    }, [open, branchId]);

    // Precarga al abrir: la línea a editar, o los valores en blanco del alta.
    useEffect(() => {
        if (!open) return;
        setRecipeId(line?.recipeId ?? "");
        setQuantity(line?.plannedQuantity ?? 1);
        setStation(line?.station ?? "");
        setShift(line?.shift ?? SIN_VALOR);
        setResponsibleUserId(line?.responsibleUserId ?? SIN_VALOR);
        setDeadlineTime(line?.deadlineTime ?? "");
        setNotes(line?.notes ?? "");
    }, [open, line]);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!line && !recipeId) {
            toast.error("Selecciona la preparación");
            return;
        }
        if (!date) {
            toast.error("Selecciona la fecha de la hoja");
            return;
        }

        setSubmitting(true);
        try {
            const payload = {
                branchId,
                station: station || null,
                shift: shift === SIN_VALOR ? null : shift,
                responsibleUserId: responsibleUserId === SIN_VALOR ? null : responsibleUserId,
                deadlineTime: deadlineTime || null,
                plannedQuantity: quantity,
                notes: notes || null,
            };

            const res = await fetch("/api/inventory/production/prep-list", {
                method: line ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(
                    line
                        ? { ...payload, orderId: line.id }
                        : {
                            ...payload,
                            recipeId,
                            unit: recipes.find(r => r.id === recipeId)?.unit || "PORTION",
                            date,
                        }
                ),
            });
            const json = await res.json();

            if (!res.ok || !json.success) {
                toast.error(json?.error?.message || "No se pudo guardar la línea");
                return;
            }

            toast.success(line ? "Línea actualizada" : "Línea agregada a la prep list");
            onOpenChange(false);
            onSaved();
        } catch {
            toast.error("Error al guardar la línea");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{line ? "Editar línea" : "Nueva línea de la prep list"}</DialogTitle>
                    <DialogDescription>
                        {line
                            ? "Corrige la planeación de la línea. No afecta la producción ya registrada."
                            : `Qué se prepara, en qué estación, quién y a qué hora — para el ${date ?? "día seleccionado"}.`}
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={submit} className="space-y-4">
                    {line ? (
                        <div className="space-y-2">
                            <Label>Preparación</Label>
                            <p className="text-sm font-medium">{line.recipeName}</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <Label htmlFor="prep-recipe">Preparación *</Label>
                            <Select value={recipeId} onValueChange={setRecipeId}>
                                <SelectTrigger id="prep-recipe">
                                    <SelectValue placeholder="Seleccionar receta" />
                                </SelectTrigger>
                                <SelectContent>
                                    {recipes.map(r => (
                                        <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="prep-quantity">Cantidad a producir *</Label>
                            <Input
                                id="prep-quantity"
                                type="number"
                                min={1}
                                value={quantity}
                                onChange={(e) => setQuantity(Number(e.target.value))}
                                required
                            />
                            <div className="flex gap-1.5 pt-1">
                                {[1, 5, 10, 25].map((step) => (
                                    <Button
                                        key={step}
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-7 px-2 text-xs font-mono"
                                        onClick={() => setQuantity((q) => Math.max(1, q + step))}
                                    >
                                        +{step}
                                    </Button>
                                ))}
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="prep-deadline">Hora límite</Label>
                            <Input
                                id="prep-deadline"
                                type="time"
                                value={deadlineTime}
                                onChange={(e) => setDeadlineTime(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="prep-station">Estación</Label>
                        <Input
                            id="prep-station"
                            list="prep-station-suggestions"
                            value={station}
                            onChange={(e) => setStation(e.target.value)}
                            placeholder="Cocina caliente, Parrilla, Prep station…"
                        />
                        {/* Sugerencias, no catálogo cerrado: cada cocina nombra sus
                            estaciones distinto y el agrupado ya normaliza acentos. */}
                        <datalist id="prep-station-suggestions">
                            {PREP_STATION_SUGGESTIONS.map(s => <option key={s} value={s} />)}
                        </datalist>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="prep-shift">Turno</Label>
                            <Select value={shift} onValueChange={setShift}>
                                <SelectTrigger id="prep-shift">
                                    <SelectValue placeholder="Sin turno" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={SIN_VALOR}>Sin turno</SelectItem>
                                    {Object.entries(PREP_SHIFT_LABELS).map(([value, label]) => (
                                        <SelectItem key={value} value={value}>{label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="prep-responsible">Responsable</Label>
                            <Select value={responsibleUserId} onValueChange={setResponsibleUserId}>
                                <SelectTrigger id="prep-responsible">
                                    <SelectValue placeholder="Sin asignar" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={SIN_VALOR}>Sin asignar</SelectItem>
                                    {employees.map(emp => (
                                        <SelectItem key={emp.id} value={emp.id}>
                                            {emp.name || "Sin nombre"}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="prep-notes">Notas</Label>
                        <Input
                            id="prep-notes"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Opcional"
                        />
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={submitting}>
                            {submitting && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
                            {line ? "Guardar" : "Agregar"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
