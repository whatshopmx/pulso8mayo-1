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
import {
  ArrowRight,
  Building2,
  Handshake,
  Loader2,
  Plus,
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
  const [search, setSearch] = useState("");

  // Crear
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [creating, setCreating] = useState(false);

  // Dar de baja
  const [pendingDeactivation, setPendingDeactivation] = useState<Payee | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      // Se traen también las dadas de baja: el historial debe poder verse.
      const url = new URL("/api/finance/payees", window.location.origin);
      url.searchParams.set("active", "false");
      if (search.trim()) url.searchParams.set("search", search.trim());

      const res = await fetch(url.toString());
      const data = await res.json();
      if (res.ok && data.success) {
        setPayees(data.data || []);
      } else {
        setError(data?.error || "No se pudieron cargar las contrapartes.");
        setPayees([]);
      }
    } catch (err) {
      console.error("Failed to load payees:", err);
      setError("Error de conexión al cargar las contrapartes.");
      setPayees([]);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    load();
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
        throw new Error(data.error?.message || data.error || "No se pudo crear la contraparte.");
      }
      toast({ title: "Contraparte creada", description: `"${data.data.name}" ya está en el catálogo.` });
      setCreateOpen(false);
      setName("");
      setTaxId("");
      setContactName("");
      setEmail("");
      setPhone("");
      load(true);
    } catch (err: any) {
      toast({
        title: "No se pudo crear la contraparte",
        description: err.message || "Revisa e inténtalo de nuevo.",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const handleDeactivate = async () => {
    if (!pendingDeactivation) return;
    setDeactivating(true);
    try {
      const res = await fetch(`/api/finance/payees/${pendingDeactivation.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.error || "No se pudo dar de baja la contraparte.");
      }
      toast({
        title: "Contraparte dada de baja",
        description: `"${pendingDeactivation.name}" ya no aparece en los formularios. Los gastos históricos se conservan.`,
      });
      load(true);
    } catch (err: any) {
      toast({
        title: "No se pudo dar de baja",
        description: err.message || "Revisa e inténtalo de nuevo.",
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
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-8 w-56"
              placeholder="Buscar por nombre, RFC, contacto…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
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
                    <TableHead className="text-center">Acción</TableHead>
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
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-destructive"
                            onClick={() => setPendingDeactivation(payee)}
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Dar de baja
                          </Button>
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