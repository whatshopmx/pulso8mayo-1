"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { mensajeDeError } from "@/lib/api/client-error";
import {
  ArrowRight,
  Building2,
  FileText,
  Handshake,
  Landmark,
  Loader2,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  Trash2,
  XCircle,
} from "lucide-react";

interface Payee {
  id: string;
  name: string;
  taxId: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  active: boolean;
  createdAt: string;
}

/**
 * Catálogo de contrapartes — Fase 1 de `tasks/plan-payees-contrapartes.md`.
 *
 * La contraparte responde "a quién le pagamos" para la renta, la luz, el gas,
 * el internet y el contador: gastos que no pasan por el inventario y que hasta
 * ahora vivían sin identidad propia. Dar de baja es lógico (`active=false`):
 * los gastos históricos conservan el nombre, solo deja de ofrecerse en los
 * formularios.
 */
export default function PayeesPage() {
  const { toast } = useToast();
  const [payees, setPayees] = useState<Payee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A18 — `search` es lo que el usuario ve escrito; `busqueda` es lo que se
  // consulta. Antes eran lo mismo y cada tecla disparaba un `fetch` con `ILIKE`:
  // "Inmobiliaria" pedía trece veces el catálogo entero.
  const [search, setSearch] = useState("");
  const [busqueda, setBusqueda] = useState("");

  // Crear
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [creating, setCreating] = useState(false);

  // Editar
  const [editPayee, setEditPayee] = useState<Payee | null>(null);
  const [editTaxId, setEditTaxId] = useState("");
  const [editContactName, setEditContactName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editing, setEditing] = useState(false);

  // Dar de baja
  const [pendingDeactivation, setPendingDeactivation] = useState<Payee | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  const load = useCallback(
    async ({ silent = false, signal }: { silent?: boolean; signal?: AbortSignal } = {}) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        // Se traen también las dadas de baja: el historial debe poder verse.
        const url = new URL("/api/finance/payees", window.location.origin);
        url.searchParams.set("active", "false");
        if (busqueda) url.searchParams.set("search", busqueda);

        const res = await fetch(url.toString(), { signal });
        const data = await res.json();
        if (res.ok && data.success) {
          setPayees(data.data || []);
        } else {
          setError(mensajeDeError(data, "No se pudieron cargar las contrapartes."));
          setPayees([]);
        }
      } catch (err) {
        // Una búsqueda abandonada no es un fallo. Sin esto, cancelar mostraba
        // "Error de conexión" y vaciaba la lista justo cuando el usuario seguía
        // escribiendo.
        if (signal?.aborted || (err as Error)?.name === "AbortError") return;
        console.error("Failed to load payees:", err);
        setError("Error de conexión al cargar las contrapartes.");
        setPayees([]);
      } finally {
        // La búsqueda que reemplazó a ésta es la dueña del estado de carga.
        if (!signal?.aborted) setLoading(false);
      }
    },
    [busqueda]
  );

  // A18 — Debounce de 300 ms. El `clearTimeout` del cleanup es lo que hace que
  // sólo la última tecla llegue a pedir.
  useEffect(() => {
    const t = setTimeout(() => setBusqueda(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // A18 — Y el `abort` del cleanup, que la respuesta de una búsqueda vieja no
  // pise la lista: sin esto ganaba la última en *llegar*, que no es
  // necesariamente la del texto que está en pantalla.
  useEffect(() => {
    const control = new AbortController();
    load({ signal: control.signal });
    return () => control.abort();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast({ title: "Error", description: "El nombre de la contraparte es obligatorio.", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/finance/payees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          taxId: taxId.trim() || undefined,
          contactName: contactName.trim() || undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(mensajeDeError(data, "No se pudo crear la contraparte."));
      }
      toast({ title: "Contraparte creada", description: `"${data.data.name}" ya está en el catálogo.` });
      setCreateOpen(false);
      setName("");
      setTaxId("");
      setContactName("");
      setEmail("");
      setPhone("");
      load({ silent: true });
    } catch (err) {
      toast({
        title: "No se pudo crear la contraparte",
        description: (err as Error).message || "Revisa e inténtalo de nuevo.",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (payee: Payee) => {
    setEditPayee(payee);
    setEditTaxId(payee.taxId ?? "");
    setEditContactName(payee.contactName ?? "");
    setEditEmail(payee.email ?? "");
    setEditPhone(payee.phone ?? "");
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editPayee) return;
    setEditing(true);
    try {
      const res = await fetch(`/api/finance/payees/${editPayee.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taxId: editTaxId.trim() || null,
          contactName: editContactName.trim() || null,
          email: editEmail.trim() || null,
          phone: editPhone.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(mensajeDeError(data, "No se pudo actualizar la contraparte."));
      }
      toast({ title: "Contraparte actualizada", description: `Los datos de "${editPayee.name}" fueron guardados.` });
      setEditPayee(null);
      load({ silent: true });
    } catch (err) {
      toast({
        title: "No se pudo actualizar",
        description: (err as Error).message || "Revisa e inténtalo de nuevo.",
        variant: "destructive",
      });
    } finally {
      setEditing(false);
    }
  };

  const handleDeactivate = async () => {
    if (!pendingDeactivation) return;
    setDeactivating(true);
    try {
      const res = await fetch(`/api/finance/payees/${pendingDeactivation.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(mensajeDeError(data, "No se pudo dar de baja la contraparte."));
      }
      toast({
        title: "Contraparte dada de baja",
        description: `"${pendingDeactivation.name}" ya no aparece en los formularios. Los gastos históricos se conservan.`,
      });
      load({ silent: true });
    } catch (err) {
      toast({
        title: "No se pudo dar de baja",
        description: (err as Error).message || "Revisa e inténtalo de nuevo.",
        variant: "destructive",
      });
    } finally {
      setDeactivating(false);
      setPendingDeactivation(null);
    }
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Handshake className="h-7 w-7 text-primary" /> Contrapartes
          </h1>
          <p className="text-sm text-muted-foreground">
            A quién le pagas la renta, la luz, el gas, el internet y los servicios profesionales —
            la identidad que la CxP agrupa al preguntar &quot;a quién le debo&quot;.
          </p>
        </div>
        {/* Mismo caso que Gastos: en un teléfono el buscador de 224 px fijo más
            el botón no caben en una fila, y la pantalla se iba a scroll
            horizontal. */}
        <div className="flex w-full shrink-0 flex-wrap items-center gap-3 md:w-auto">
          <div className="relative w-full sm:w-56">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-8 w-full"
              placeholder="Buscar por nombre, RFC, contacto…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="w-full sm:w-auto">
                <Plus className="w-4 h-4 mr-2" /> Nueva Contraparte
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-lg font-bold">
                  <Building2 className="w-5 h-5 text-primary" /> Nueva Contraparte
                </DialogTitle>
                <DialogDescription className="text-xs">
                  El nombre es la identidad: &quot;CFE&quot; y &quot;Comisión Federal de Electricidad&quot; son la
                  misma contraparte. El RFC es opcional (hay gastos sin CFDI).
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label htmlFor="payee-name">Nombre</Label>
                  <Input
                    id="payee-name"
                    placeholder="ej. Inmobiliaria Condesa, CFE, Contador Alanís"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="payee-taxid">RFC (opcional)</Label>
                  <Input
                    id="payee-taxid"
                    placeholder="ej. XXXX000000XXX"
                    value={taxId}
                    onChange={(e) => setTaxId(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="payee-contact">Contacto (opcional)</Label>
                  <Input
                    id="payee-contact"
                    placeholder="Nombre de la persona con quien tratas"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="payee-email">Correo (opcional)</Label>
                    <Input
                      id="payee-email"
                      type="email"
                      placeholder="correo@empresa.mx"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="payee-phone">Teléfono (opcional)</Label>
                    <Input
                      id="payee-phone"
                      placeholder="55 0000 0000"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={creating}>
                    {creating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Crear Contraparte
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          {loading ? (
            <div className="py-12 flex justify-center text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mr-2" /> Cargando contrapartes...
            </div>
          ) : error ? (
            <EmptyState
              icon={XCircle}
              title="No se pudieron cargar las contrapartes"
              description={error}
              action={
                <Button variant="outline" size="sm" onClick={() => load()}>
                  <RefreshCw className="w-4 h-4 mr-2" /> Reintentar
                </Button>
              }
            />
          ) : payees.length === 0 ? (
            <EmptyState
              icon={Handshake}
              title="Sin contrapartes en el catálogo"
              description={
                search.trim()
                  ? "Ninguna contraparte coincide con la búsqueda."
                  : "Crea la primera contraparte (la renta suele ser la mayor) para que la CxP responda «a quién le debo»."
              }
              action={
                search.trim() ? (
                  <Button variant="outline" size="sm" onClick={() => setSearch("")}>
                    Limpiar búsqueda
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
                    <Plus className="w-4 h-4 mr-2" /> Nueva Contraparte
                  </Button>
                )
              }
            />
          ) : (
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableCaption className="sr-only">
                  Contrapartes: nombre, RFC, contacto, estatus y acción de baja lógica.
                </TableCaption>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Nombre</TableHead>
                    <TableHead>RFC</TableHead>
                    <TableHead>Contacto</TableHead>
                    <TableHead>Estatus</TableHead>
                    <TableHead className="text-center">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payees.map((payee) => (
                    <TableRow key={payee.id} className="hover:bg-muted/40 transition text-xs">
                      <TableCell className="font-medium whitespace-nowrap">{payee.name}</TableCell>
                      <TableCell className="tabular-nums">
                        {payee.taxId || <span className="text-muted-foreground/40">—</span>}
                      </TableCell>
                      <TableCell>
                        {[payee.contactName, payee.email, payee.phone].filter(Boolean).join(" · ") || (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {payee.active ? (
                          <Badge variant="outline" className="text-xs font-normal text-success border-success/30 bg-success/10">
                            Activa
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
                            Dada de baja
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {payee.active ? (
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
                              asChild
                              title="Ver gastos registrados para esta contraparte"
                            >
                              <Link href={`/dashboard/finance/expenses?payeeId=${payee.id}`}>
                                <Receipt className="w-3.5 h-3.5" /> Ver gastos
                              </Link>
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
                              asChild
                              title="Ver facturas y gastos por pagar de esta contraparte"
                            >
                              <Link href={`/dashboard/finance/payables?payeeId=${payee.id}`}>
                                <FileText className="w-3.5 h-3.5" /> Ver facturas
                              </Link>
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
                              asChild
                              title="Cuenta bancaria verificada para pagarle por tesorería"
                            >
                              <Link href={`/dashboard/finance/payee-bank-accounts?payeeId=${payee.id}`}>
                                <Landmark className="w-3.5 h-3.5" /> Cuenta bancaria
                              </Link>
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
                              onClick={() => openEdit(payee)}
                              title="Editar datos de contacto"
                            >
                              <Pencil className="w-3.5 h-3.5" /> Editar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-destructive"
                              onClick={() => setPendingDeactivation(payee)}
                              title="Dar de baja esta contraparte"
                            >
                              <Trash2 className="w-3.5 h-3.5" /> Dar de baja
                            </Button>
                          </div>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard/finance">
            Volver a Finanzas <ArrowRight className="w-4 h-4 ml-1.5" />
          </Link>
        </Button>
        <p className="text-xs text-muted-foreground">
          La baja es lógica: los gastos históricos conservan el nombre congelado.
        </p>
      </div>

      {/* ── Dialog de edición ── */}
      <Dialog open={editPayee !== null} onOpenChange={(open) => { if (!open) setEditPayee(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <Pencil className="w-5 h-5 text-primary" /> Editar Contraparte
            </DialogTitle>
            <DialogDescription className="text-xs">
              El nombre es la identidad y no puede cambiarse. Actualiza los datos de
              contacto que quieres corregir.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Nombre (no editable)</Label>
              <Input value={editPayee?.name ?? ""} disabled className="bg-muted/50 text-muted-foreground" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-taxid">RFC (opcional)</Label>
              <Input
                id="edit-taxid"
                placeholder="ej. XXXX000000XXX"
                value={editTaxId}
                onChange={(e) => setEditTaxId(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-contact">Contacto (opcional)</Label>
              <Input
                id="edit-contact"
                placeholder="Nombre de la persona con quien tratas"
                value={editContactName}
                onChange={(e) => setEditContactName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-email">Correo (opcional)</Label>
                <Input
                  id="edit-email"
                  type="email"
                  placeholder="correo@empresa.mx"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-phone">Teléfono (opcional)</Label>
                <Input
                  id="edit-phone"
                  placeholder="55 0000 0000"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditPayee(null)} disabled={editing}>
                Cancelar
              </Button>
              <Button type="submit" disabled={editing}>
                {editing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Guardar cambios
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDeactivation !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeactivation(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Dar de baja esta contraparte?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeactivation
                ? `"${pendingDeactivation.name}" dejará de aparecer en los formularios de gasto. Los gastos registrados en el pasado conservan su nombre; nada se borra.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deactivating}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deactivating}
              onClick={(e) => {
                e.preventDefault();
                handleDeactivate();
              }}
            >
              {deactivating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Sí, dar de baja
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}