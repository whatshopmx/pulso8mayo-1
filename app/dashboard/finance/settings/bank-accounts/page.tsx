"use client";

import { useCallback, useEffect, useState } from "react";
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
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { formatCents } from "@/lib/utils";
import { useSession } from "@/hooks/use-session";
import { roleIsAtLeast } from "@/lib/permissions";
import { BANXICO_BANK_CODES } from "@/lib/banking/clabe";
import { Landmark, Plus, Loader2 } from "lucide-react";

/**
 * Catálogo de cuentas bancarias propias — de dónde sale el dinero.
 *
 * Espejo inverso del catálogo de cuentas de contrapartes: allí la CLABE es
 * del DESTINATARIO y el flujo exige verificación CEP; aquí el identificativo
 * es el NÚMERO DE CUENTA de origen y no hay flujo CEP (no hay tercero contra
 * quién contrastar lo propio). El catálogo alimenta el selector de corridas y
 * de ahí la columna CUENTA_ORIGEN del layout de dispersión: sin catálogo,
 * cada corrida queda huérfana de origen declarado.
 *
 * El número completo nunca regresa del servidor ni se muestra — únicamente
 * los últimos 4 dígitos. La baja es lógica: cada cuenta es evidencia del
 * origen de pagos pasados.
 */

interface SafeCompanyBankAccount {
    id: string;
    label: string;
    accountLastFour: string;
    bankCode: string;
    bankName: string;
    clabeLastFour: string | null;
    currency: string;
    active: boolean;
    purpose: "DISPERSION" | "RECEPCION" | "MIXTO";
    registeredByName: string | null;
    notes: string | null;
    createdAt: string;
    /** Ancla + saldo computado; null = sin ancla (nunca un cero inventado). */
    openingBalanceCents?: number | null;
    openingAsOfDate?: string | null;
    computedBalanceCents?: number | null;
}

const PURPOSE_LABELS: Record<SafeCompanyBankAccount["purpose"], string> = {
    DISPERSION: "Dispersión",
    RECEPCION: "Recepción",
    MIXTO: "Mixta",
};

const BANK_OPTIONS = Object.entries(BANXICO_BANK_CODES).map(([code, name]) => ({
    code,
    name,
}));

export default function CompanyBankAccountsPage() {
    const { session } = useSession();
    const canEdit =
        !!session?.user?.role && roleIsAtLeast(session.user.role, "ADMIN");

    const [accounts, setAccounts] = useState<SafeCompanyBankAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [saving, setSaving] = useState(false);

    // Formulario de alta
    const [label, setLabel] = useState("");
    const [bankCode, setBankCode] = useState("");
    const [accountNumber, setAccountNumber] = useState("");
    const [clabe, setClabe] = useState("");
    const [purpose, setPurpose] = useState<SafeCompanyBankAccount["purpose"] | "">("");
    /** Captura del ancla de saldo (portal del banco → a dedo, con fecha). */
    const [anchorDialog, setAnchorDialog] = useState<{
        accountId: string;
        label: string;
        balanceInput: string;
        dateInput: string;
    } | null>(null);
    const [notes, setNotes] = useState("");

    const fetchAccounts = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("/api/finance/bank-accounts?withBalances=true");
            const json = await res.json();
            if (!res.ok || json.error) {
                throw new Error(json.error ?? "No se pudo cargar el catálogo");
            }
            setAccounts(json.data ?? []);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchAccounts();
    }, [fetchAccounts]);

    const resetForm = () => {
        setLabel("");
        setBankCode("");
        setAccountNumber("");
        setClabe("");
        setPurpose("");
        setNotes("");
    };

    const handleCreate = async () => {
        if (!label.trim() || !accountNumber.trim() || (!bankCode && !clabe.trim())) {
            toast.error("Campos incompletos", {
                description:
                    "Etiqueta, número de cuenta y banco (o CLABE, de la que se deriva el banco) son obligatorios.",
            });
            return;
        }
        setSaving(true);
        try {
            const res = await fetch("/api/finance/bank-accounts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    label: label.trim(),
                    accountNumber: accountNumber.trim(),
                    bankCode: bankCode || undefined,
                    clabe: clabe.trim() || undefined,
                    purpose: purpose || undefined,
                    notes: notes.trim() || undefined,
                }),
            });
            const json = await res.json();
            if (!res.ok || json.error) {
                throw new Error(json.error ?? "No se pudo registrar la cuenta.");
            }
            toast.success("Cuenta registrada", {
                description: "Ya aparece en el selector de corridas de pago.",
            });
            resetForm();
            setDialogOpen(false);
            await fetchAccounts();
        } catch (err) {
            toast.error("Error al registrar", {
                description: (err as Error).message,
            });
        } finally {
            setSaving(false);
        }
    };

    const handleDeactivate = async (accountId: string, accountFormat: string) => {
        try {
            const res = await fetch("/api/finance/bank-accounts", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ accountId }),
            });
            const json = await res.json();
            if (!res.ok || json.error) {
                throw new Error(json.error ?? "No se pudo dar de baja la cuenta.");
            }
            toast.success("Cuenta dada de baja", {
                description: `${accountFormat} ya no se ofrece en nuevas corridas. Los pagos que ya salieron por ella conservan su rastro.`,
            });
            await fetchAccounts();
        } catch (err) {
            toast.error("Error al dar de baja", { description: (err as Error).message });
        }
    };

    // La cuenta no muere por cambiar de rol: editar propósito es otro verbo (PUT).
    const handlePurposeChange = async (
        accountId: string,
        nextPurpose: SafeCompanyBankAccount["purpose"]
    ) => {
        try {
            const res = await fetch("/api/finance/bank-accounts", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ accountId, purpose: nextPurpose }),
            });
            const json = await res.json();
            if (!res.ok || json.error) {
                throw new Error(json.error ?? "No se pudo actualizar el propósito.");
            }
            toast.success("Propósito actualizado");
            await fetchAccounts();
        } catch (err) {
            toast.error("Error al actualizar propósito", {
                description: (err as Error).message,
            });
        }
    };

    /**
     * Ancla del saldo computado: captura a mano del portal/corte del banco.
     * El sistema no puede derivarla — es el único número que entra a dedo y
     * por eso se firma con fecha. Vaciarla quita el ancla (nunca mitad).
     */
    const handleSaveAnchor = async (
        accountId: string,
        openingBalanceCents: number | null,
        openingAsOfDate: string | null
    ) => {
        try {
            const res = await fetch("/api/finance/bank-accounts", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ accountId, openingBalanceCents, openingAsOfDate }),
            });
            const json = await res.json();
            if (!res.ok || json.error) {
                throw new Error(json.error ?? "No se pudo guardar el saldo base.");
            }
            toast.success("Saldo base guardado");
            await fetchAccounts();
        } catch (err) {
            toast.error("Error al guardar saldo base", {
                description: (err as Error).message,
            });
        }
    };

    const active = accounts.filter((a) => a.active);
    const inactive = accounts.filter((a) => !a.active);

    return (
        <div className="container mx-auto py-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <Landmark className="h-7 w-7 text-primary" /> Cuentas bancarias propias
                    </h1>
                    <p className="text-sm text-muted-foreground max-w-[70ch]">
                        De qué cuenta sale cada pago. El catálogo alimenta el selector de corridas y
                        la columna CUENTA_ORIGEN del layout de dispersión. El número completo nunca
                        se muestra — sólo sus últimos 4 dígitos.
                    </p>
                </div>
                {canEdit && (
                    <Button size="sm" onClick={() => setDialogOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" /> Registrar cuenta
                    </Button>
                )}
            </div>

            {!loading && !error && accounts.length === 0 && (
                <Card>
                    <CardContent className="py-4">
                        <EmptyState
                            icon={Landmark}
                            title="Sin cuentas registradas"
                            description="Sin catálogo, cada corrida de pago permite escribir el origen a mano — o dejarlo vacío y que el layout de dispersión declare SIN_CUENTA_ORIGEN. Registra al menos una cuenta."
                        />
                    </CardContent>
                </Card>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            {active.length > 0 && (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base font-bold">Activas</CardTitle>
                        <CardDescription className="text-xs">
                            Ofrecidas en el selector de corridas de pago. La captura queda firmada
                            por quien la registró.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="border rounded-md overflow-x-auto">
                            <Table>
                                <TableCaption className="sr-only">
                                    Cuentas activas de la empresa con banco, últimos cuatro dígitos y
                                    quien las registró.
                                </TableCaption>
                                <TableHeader>
                                    <TableRow className="bg-muted/50">
                                        <TableHead>Cuenta</TableHead>
                                        <TableHead>Banco</TableHead>
                                        <TableHead>Propósito</TableHead>
                                        <TableHead>Saldo computado</TableHead>
                                        <TableHead>CLABE</TableHead>
                                        <TableHead>Registró</TableHead>
                                        {canEdit && <TableHead className="text-right">Acción</TableHead>}
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {active.map((a) => (
                                        <TableRow key={a.id} className="hover:bg-muted/40">
                                            <TableCell>
                                                <div className="font-medium">{a.label}</div>
                                                <div className="text-xs text-muted-foreground tabular-nums">
                                                    ····{a.accountLastFour}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-sm">{a.bankName}</TableCell>
                                            <TableCell>
                                                {canEdit ? (
                                                    <Select
                                                        value={a.purpose}
                                                        onValueChange={(val) =>
                                                            handlePurposeChange(
                                                                a.id,
                                                                val as SafeCompanyBankAccount["purpose"]
                                                            )
                                                        }
                                                    >
                                                        <SelectTrigger className="h-7 w-[130px] text-xs">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {(Object.keys(PURPOSE_LABELS) as Array<SafeCompanyBankAccount["purpose"]>).map((p) => (
                                                                <SelectItem key={p} value={p}>
                                                                    {PURPOSE_LABELS[p]}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                ) : (
                                                    <Badge variant="outline">{PURPOSE_LABELS[a.purpose]}</Badge>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                {a.computedBalanceCents != null ? (
                                                    <div>
                                                        <div className="font-semibold tabular-nums text-sm">
                                                            {formatCents(a.computedBalanceCents)}
                                                        </div>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-5 px-1 text-[10px] text-muted-foreground"
                                                            onClick={() =>
                                                                setAnchorDialog({
                                                                    accountId: a.id,
                                                                    label: a.label,
                                                                    balanceInput: String((a.openingBalanceCents ?? 0) / 100),
                                                                    dateInput: a.openingAsOfDate ?? "",
                                                                })
                                                            }
                                                        >
                                                            base {formatCents(a.openingBalanceCents ?? 0)} al {a.openingAsOfDate}
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    canEdit ? (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="h-7 text-xs"
                                                            onClick={() =>
                                                                setAnchorDialog({
                                                                    accountId: a.id,
                                                                    label: a.label,
                                                                    balanceInput: "",
                                                                    dateInput: new Date().toISOString().slice(0, 10),
                                                                })
                                                            }
                                                        >
                                                            Capturar saldo base
                                                        </Button>
                                                    ) : (
                                                        <span className="text-xs text-muted-foreground">Sin ancla</span>
                                                    )
                                                )}
                                            </TableCell>
                                            <TableCell className="text-sm text-muted-foreground">
                                                {a.clabeLastFour ? `····${a.clabeLastFour}` : "—"}
                                            </TableCell>
                                            <TableCell className="text-sm">
                                                {a.registeredByName ?? "—"}
                                            </TableCell>
                                            {canEdit && (
                                                <TableCell className="text-right">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() =>
                                                            handleDeactivate(a.id, a.label)
                                                        }
                                                    >
                                                        Dar de baja
                                                    </Button>
                                                </TableCell>
                                            )}
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            )}

            {inactive.length > 0 && (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base font-bold">Dadas de baja</CardTitle>
                        <CardDescription className="text-xs">
                            Ya no se ofrecen en nuevas corridas. Quedan como evidencia del origen de
                            los pagos que salieron por ellas — no se borran.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="border rounded-md overflow-x-auto">
                            <Table>
                                <TableCaption className="sr-only">
                                    Cuentas dadas de baja, conservadas como evidencia histórica.
                                </TableCaption>
                                <TableHeader>
                                    <TableRow className="bg-muted/50">
                                        <TableHead>Cuenta</TableHead>
                                        <TableHead>Banco</TableHead>
                                        <TableHead>Estado</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {inactive.map((a) => (
                                        <TableRow key={a.id} className="hover:bg-muted/40">
                                            <TableCell>
                                                <span className="font-medium">{a.label}</span>
                                                <span className="text-xs text-muted-foreground ml-2 tabular-nums">
                                                    ····{a.accountLastFour}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-sm">{a.bankName}</TableCell>
                                            <TableCell>
                                                <Badge variant="outline">Baja</Badge>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            )}

            <Dialog
                open={anchorDialog !== null}
                onOpenChange={(val) => {
                    if (!val) setAnchorDialog(null);
                }}
            >
                <DialogContent className="sm:max-w-[420px]">
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (!anchorDialog) return;
                            const peso = Number(anchorDialog.balanceInput.replace(/[^0-9.\-]/g, ""));
                            if (!Number.isFinite(peso) || !anchorDialog.dateInput) {
                                toast.error("Captura el monto y la fecha del corte del banco.");
                                return;
                            }
                            handleSaveAnchor(
                                anchorDialog.accountId,
                                Math.round(peso * 100),
                                anchorDialog.dateInput
                            );
                            setAnchorDialog(null);
                        }}
                    >
                        <DialogHeader>
                            <DialogTitle>Saldo base — {anchorDialog?.label}</DialogTitle>
                            <DialogDescription>
                                Tomado del portal o corte del banco: apertura + movimientos
                                importados = saldo computado. Es el único número que entra a
                                dedo; con fecha, no se duplica contra el libro.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="grid gap-2">
                                <Label htmlFor="anchor-monto">Monto (MXN, admite negativo)</Label>
                                <Input
                                    id="anchor-monto"
                                    inputMode="decimal"
                                    value={anchorDialog?.balanceInput ?? ""}
                                    onChange={(e) =>
                                        setAnchorDialog((prev) =>
                                            prev ? { ...prev, balanceInput: e.target.value } : prev
                                        )
                                    }
                                    required
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="anchor-fecha">Fecha del corte</Label>
                                <Input
                                    id="anchor-fecha"
                                    type="date"
                                    value={anchorDialog?.dateInput ?? ""}
                                    onChange={(e) =>
                                        setAnchorDialog((prev) =>
                                            prev ? { ...prev, dateInput: e.target.value } : prev
                                        )
                                    }
                                    required
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setAnchorDialog(null)}
                            >
                                Cancelar
                            </Button>
                            <Button type="submit" size="sm">
                                Guardar
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
            <Dialog
                open={dialogOpen}
                onOpenChange={(val) => {
                    setDialogOpen(val);
                    if (!val) resetForm();
                }}
            >
                <DialogContent className="sm:max-w-[480px]">
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            handleCreate();
                        }}
                    >
                        <DialogHeader>
                            <DialogTitle>Registrar cuenta de origen</DialogTitle>
                            <DialogDescription>
                                Número de cuenta de la empresa, tal como el banco lo reconoce para
                                dispersar. La CLABE es opcional — sólo como referencia SPEI.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="grid gap-2">
                                <Label htmlFor="cuenta-formato">Etiqueta</Label>
                                <Input
                                    id="cuenta-formato"
                                    placeholder="Ej. BBVA · Cuenta operativa"
                                    value={label}
                                    onChange={(e) => setLabel(e.target.value)}
                                    required
                                    maxLength={80}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="cuenta-numero">Número de cuenta</Label>
                                <Input
                                    id="cuenta-numero"
                                    inputMode="numeric"
                                    placeholder="Sólo dígitos"
                                    value={accountNumber}
                                    onChange={(e) => setAccountNumber(e.target.value)}
                                    required
                                />
                                <p className="text-xs text-muted-foreground">
                                    Queda cifrado; en pantalla sólo se verán los últimos 4.
                                </p>
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="cuenta-banco">
                                    Banco {clabe.trim() ? "(opcional — lo define la CLABE)" : ""}
                                </Label>
                                <Select value={bankCode} onValueChange={setBankCode}>
                                    <SelectTrigger id="cuenta-banco" className="w-full">
                                        <SelectValue placeholder="Selecciona banco" />
                                    </SelectTrigger>
                                    <SelectContent className="max-h-64">
                                        {BANK_OPTIONS.map((b) => (
                                            <SelectItem key={b.code} value={b.code}>
                                                {b.code} · {b.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="cuenta-proposito">Propósito</Label>
                                <Select value={purpose} onValueChange={(val) => setPurpose(val as SafeCompanyBankAccount["purpose"])}>
                                    <SelectTrigger id="cuenta-proposito" className="w-full">
                                        <SelectValue placeholder="Mixta (dispersa y recibe)" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {(Object.keys(PURPOSE_LABELS) as Array<SafeCompanyBankAccount["purpose"]>).map((p) => (
                                            <SelectItem key={p} value={p}>
                                                {PURPOSE_LABELS[p]}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    Dispersión = de aquí salen las corridas de pago; Recepción = aquí aterrizan los
                                    depósitos de pasarela; Mixta = ambas. Los selectores preseleccionan por propósito
                                    y siempre se pueden cambiar a mano.
                                </p>
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="cuenta-clabe">
                                    CLABE propia <span className="text-muted-foreground">(opcional)</span>
                                </Label>
                                <Input
                                    id="cuenta-clabe"
                                    inputMode="numeric"
                                    placeholder="18 dígitos, sólo como referencia"
                                    value={clabe}
                                    onChange={(e) => setClabe(e.target.value)}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="cuenta-notas">
                                    Notas <span className="text-muted-foreground">(opcional)</span>
                                </Label>
                                <Textarea
                                    id="cuenta-notas"
                                    rows={2}
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    maxLength={1000}
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setDialogOpen(false)}
                            >
                                Cancelar
                            </Button>
                            <Button type="submit" size="sm" disabled={saving}>
                                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Registrar
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
