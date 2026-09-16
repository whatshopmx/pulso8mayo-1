"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useBranch } from "@/lib/branch-context";
import {
  CreditCard,
  Plus,
  RefreshCw,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  Building2,
  Edit2,
  Power,
  PowerOff,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";

interface Terminal {
  id: string;
  companyId: string;
  branchId: string;
  branchName: string | null;
  serialNumber: string;
  alias: string;
  acquirer: "CLIP" | "MERCADO_PAGO" | "BBVA" | "BANORTE" | "SANTANDER" | "OTHER";
  affiliationNumber: string | null;
  active: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

const ACQUIRER_LABELS: Record<string, string> = {
  CLIP: "Clip",
  MERCADO_PAGO: "Mercado Pago",
  BBVA: "BBVA México",
  BANORTE: "Banorte",
  SANTANDER: "Santander",
  OTHER: "Otro / Agregador",
};

export default function TerminalsSettingsPage() {
  const { selectedBranchId } = useBranch();
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [filterBranchId, setFilterBranchId] = useState<string>(selectedBranchId || "ALL");
  const [loading, setLoading] = useState(true);

  // Dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTerminal, setEditingTerminal] = useState<Terminal | null>(null);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [formBranchId, setFormBranchId] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [alias, setAlias] = useState("");
  const [acquirer, setAcquirer] = useState<string>("CLIP");
  const [affiliationNumber, setAffiliationNumber] = useState("");
  const [notes, setNotes] = useState("");

  const loadTerminals = useCallback(async () => {
    setLoading(true);
    try {
      const url = new URL("/api/finance/terminals", window.location.origin);
      if (filterBranchId !== "ALL") url.searchParams.set("branchId", filterBranchId);

      const res = await fetch(url.toString());
      const json = await res.json();
      if (res.ok && json.success) {
        setTerminals(json.data.terminals || []);
      } else {
        toast.error("Error al cargar terminales", { description: json.error });
      }
    } catch (err) {
      toast.error("Error de conexión al cargar terminales");
    } finally {
      setLoading(false);
    }
  }, [filterBranchId]);

  useEffect(() => {
    fetch("/api/branches")
      .then((res) => res.json())
      .then((json) => {
        if (json.success && Array.isArray(json.data)) {
          setBranches(json.data);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadTerminals();
  }, [loadTerminals]);

  const handleOpenCreate = () => {
    setEditingTerminal(null);
    setFormBranchId(filterBranchId !== "ALL" ? filterBranchId : (branches[0]?.id || ""));
    setSerialNumber("");
    setAlias("");
    setAcquirer("CLIP");
    setAffiliationNumber("");
    setNotes("");
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (t: Terminal) => {
    setEditingTerminal(t);
    setFormBranchId(t.branchId);
    setSerialNumber(t.serialNumber);
    setAlias(t.alias);
    setAcquirer(t.acquirer);
    setAffiliationNumber(t.affiliationNumber || "");
    setNotes(t.notes || "");
    setIsDialogOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serialNumber.trim() || !alias.trim() || !formBranchId) {
      toast.error("Campos obligatorios incompletos", {
        description: "Especifica sucursal, número de serie y alias.",
      });
      return;
    }

    setSaving(true);
    try {
      if (editingTerminal) {
        // PATCH
        const res = await fetch("/api/finance/terminals", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editingTerminal.id,
            branchId: formBranchId,
            alias: alias.trim(),
            acquirer,
            affiliationNumber: affiliationNumber.trim() || null,
            notes: notes.trim() || null,
          }),
        });
        const json = await res.json();
        if (res.ok && json.success) {
          toast.success("Terminal actualizada");
          setIsDialogOpen(false);
          loadTerminals();
        } else {
          toast.error("Error al actualizar", { description: json.error });
        }
      } else {
        // POST
        const res = await fetch("/api/finance/terminals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            branchId: formBranchId,
            serialNumber: serialNumber.trim(),
            alias: alias.trim(),
            acquirer,
            affiliationNumber: affiliationNumber.trim() || null,
            notes: notes.trim() || null,
          }),
        });
        const json = await res.json();
        if (res.ok && json.success) {
          toast.success("Terminal registrada exitosamente");
          setIsDialogOpen(false);
          loadTerminals();
        } else {
          toast.error("Error al registrar", { description: json.error });
        }
      }
    } catch (err: any) {
      toast.error("Error de red", { description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (t: Terminal) => {
    try {
      const res = await fetch("/api/finance/terminals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: t.id,
          active: !t.active,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(t.active ? "Terminal desactivada" : "Terminal activada");
        loadTerminals();
      } else {
        toast.error("Error al modificar estado", { description: json.error });
      }
    } catch {
      toast.error("Error de conexión");
    }
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard/finance"
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Finanzas
            </Link>
          </div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 mt-1">
            <CreditCard className="h-7 w-7 text-primary" /> Catálogo de Terminales TPV
          </h1>
          <p className="text-sm text-muted-foreground">
            Inventario de terminales físicas autorizadas por sucursal y blindaje contra terminales fantasma.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleOpenCreate}>
            <Plus className="w-4 h-4 mr-1.5" /> Nueva Terminal
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadTerminals()}
            disabled={loading}
            title="Actualizar"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Control Anti-Fraude Notice */}
      <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4 text-xs">
        <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div className="space-y-1">
          <span className="font-semibold text-primary block">
            Auditoría Anti-Fraude TPV (Módulo 6.2)
          </span>
          <span className="text-muted-foreground leading-relaxed block">
            Todas las terminales físicas que operan en sala o barra deben estar inventariadas con su número de serie.
            Cualquier voucher o cierre de turno registrado con un número de serie no autorizado alertará de inmediato
            a la dirección sobre una posible <strong>terminal fantasma</strong> operando en el restaurante.
          </span>
        </div>
      </div>

      {/* Filter by branch */}
      <Card>
        <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base font-bold">Terminales Registradas</CardTitle>
            <CardDescription className="text-xs">
              {terminals.length} terminal{terminals.length === 1 ? "" : "es"} en total
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 min-w-[220px]">
            <Label htmlFor="branchFilter" className="text-xs whitespace-nowrap">
              Filtrar sucursal:
            </Label>
            <Select value={filterBranchId} onValueChange={setFilterBranchId}>
              <SelectTrigger id="branchFilter" className="h-8 text-xs">
                <SelectValue placeholder="Todas las sucursales" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todas las sucursales</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 flex justify-center items-center text-muted-foreground text-sm">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando catálogo de terminales...
            </div>
          ) : terminals.length === 0 ? (
            <EmptyState
              icon={CreditCard}
              title="No hay terminales registradas"
              description="Agrega la primera terminal física de tus sucursales con su número de serie y adquirente."
              action={
                <Button size="sm" onClick={handleOpenCreate}>
                  <Plus className="w-4 h-4 mr-1.5" /> Registrar Terminal
                </Button>
              }
            />
          ) : (
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableCaption className="sr-only">
                  Catálogo de terminales físicas TPV autorizadas por sucursal
                </TableCaption>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Alias / Ubicación</TableHead>
                    <TableHead>Sucursal</TableHead>
                    <TableHead>Número de Serie</TableHead>
                    <TableHead>Adquirente</TableHead>
                    <TableHead>Afiliación</TableHead>
                    <TableHead className="text-center">Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {terminals.map((t) => (
                    <TableRow key={t.id} className="hover:bg-muted/40">
                      <TableCell className="font-semibold text-sm">
                        <div className="flex items-center gap-1.5">
                          <CreditCard className="w-4 h-4 text-muted-foreground" />
                          <span>{t.alias}</span>
                        </div>
                        {t.notes && (
                          <span className="text-xs text-muted-foreground block font-normal mt-0.5">
                            {t.notes}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Building2 className="w-3.5 h-3.5" />
                          <span>{t.branchName || "—"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs font-medium">
                        {t.serialNumber}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs font-normal">
                          {ACQUIRER_LABELS[t.acquirer] || t.acquirer}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm font-mono text-muted-foreground">
                        {t.affiliationNumber || "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        {t.active ? (
                          <Badge
                            variant="outline"
                            className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25 text-xs"
                          >
                            Activa
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="bg-muted text-muted-foreground text-xs"
                          >
                            Inactiva
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs"
                            onClick={() => handleOpenEdit(t)}
                            title="Editar terminal"
                          >
                            <Edit2 className="w-3.5 h-3.5 mr-1" /> Editar
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={`h-8 px-2 text-xs ${
                              t.active
                                ? "text-amber-700 hover:text-amber-800 dark:text-amber-400"
                                : "text-emerald-700 hover:text-emerald-800 dark:text-emerald-400"
                            }`}
                            onClick={() => handleToggleActive(t)}
                            title={t.active ? "Desactivar terminal" : "Activar terminal"}
                          >
                            {t.active ? (
                              <>
                                <PowerOff className="w-3.5 h-3.5 mr-1" /> Desactivar
                              </>
                            ) : (
                              <>
                                <Power className="w-3.5 h-3.5 mr-1" /> Activar
                              </>
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal Alta / Edición de Terminal */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <form onSubmit={handleSave}>
            <DialogHeader>
              <DialogTitle>
                {editingTerminal ? "Editar Terminal TPV" : "Registrar Terminal Autorizada"}
              </DialogTitle>
              <DialogDescription>
                {editingTerminal
                  ? "Actualiza la ubicación, adquirente o notas de la terminal."
                  : "Da de alta una terminal física asignada a una sucursal para auditoría de lotes."}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4 text-sm">
              <div className="grid gap-2">
                <Label htmlFor="terminalBranch" className="flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5 text-muted-foreground" /> Sucursal Asignada *
                </Label>
                <Select value={formBranchId} onValueChange={setFormBranchId} required>
                  <SelectTrigger id="terminalBranch">
                    <SelectValue placeholder="Selecciona sucursal" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="terminalSerial">Número de Serie Físico *</Label>
                <Input
                  id="terminalSerial"
                  placeholder="Ej. S920-8271629 ó CL-99281"
                  value={serialNumber}
                  onChange={(e) => setSerialNumber(e.target.value.toUpperCase())}
                  disabled={!!editingTerminal}
                  required
                />
                <span className="text-xs text-muted-foreground">
                  {editingTerminal
                    ? "El número de serie es inmutable para mantener la trazabilidad de auditoría."
                    : "Impreso en el reverso o etiqueta del hardware. No se puede repetir en la empresa."}
                </span>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="terminalAlias">Alias / Ubicación Interna *</Label>
                <Input
                  id="terminalAlias"
                  placeholder="Ej. Barra 1, Terraza Principal, Caja Rápida"
                  value={alias}
                  onChange={(e) => setAlias(e.target.value)}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="terminalAcquirer">Adquirente / Banco *</Label>
                  <Select value={acquirer} onValueChange={setAcquirer}>
                    <SelectTrigger id="terminalAcquirer">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CLIP">Clip</SelectItem>
                      <SelectItem value="MERCADO_PAGO">Mercado Pago</SelectItem>
                      <SelectItem value="BBVA">BBVA México</SelectItem>
                      <SelectItem value="BANORTE">Banorte</SelectItem>
                      <SelectItem value="SANTANDER">Santander</SelectItem>
                      <SelectItem value="OTHER">Otro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="terminalAffiliation">No. Afiliación</Label>
                  <Input
                    id="terminalAffiliation"
                    placeholder="Ej. 7829102"
                    value={affiliationNumber}
                    onChange={(e) => setAffiliationNumber(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="terminalNotes">Notas adicionales</Label>
                <Textarea
                  id="terminalNotes"
                  placeholder="Ej. Modelo Verifone V200c, asignado al capitán de turno..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsDialogOpen(false)}
                disabled={saving}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {editingTerminal ? "Guardar Cambios" : "Registrar Terminal"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
