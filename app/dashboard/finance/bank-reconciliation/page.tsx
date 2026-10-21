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
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { formatCents } from "@/lib/utils";
import {
    Landmark,
    Upload,
    Loader2,
    CheckCircle2,
    XCircle,
    RotateCcw,
    Link2,
} from "lucide-react";

/**
 * Conciliación bancaria — el lado de las salidas.
 *
 * La contraparte de la conciliación de pasarelas (`cash-flow/reconciliation`,
 * del lado de las entradas): aquí el estado de cuenta del banco se importa y
 * cruza contra las partidas de corrida liquidadas. Una partida CONFIRMED con
 * comprobante y un movimiento del banco con el monto espejo son dos fuentes
 * independientes del mismo dinero: cruzados, la liquidación deja de apoyarse
 * sólo en quién la firmó.
 */

interface MatchCandidate {
    paymentRunItemId: string;
    paymentRunId: string;
    runTitle: string;
    itemType: string;
    amountCents: number;
    settledAt: string | null;
    settlementReference: string | null;
    dateDiffDays: number;
}

interface BankTransactionItem {
    id: string;
    valueDate: string;
    description: string;
    reference: string | null;
    amountCents: number;
    matchStatus: "UNMATCHED" | "MATCHED" | "IGNORED";
    sourceBankAccountId: string | null;
    accountLabel: string | null;
    matchedPaymentRunItemId: string | null;
    /** Fila gateway cruzada cuando el match es de ENTRADA. */
    matchedGatewayTransactionId: string | null;
    matchNotes: string | null;
}

interface DepositMatchCandidate {
    gatewayTransactionId: string;
    acquirer: string;
    externalId: string | null;
    authorizationCode: string | null;
    branchName: string | null;
    destinationAccountLastFour: string | null;
    netAmountCents: number;
    settlementDate: string | null;
    dateDiffDays: number;
}

interface SuggestionsPayload {
    transactionId: string;
    candidates: MatchCandidate[];
}

interface PagePayload {
    items: BankTransactionItem[];
    total: number;
    summary: {
        unmatchedCount: number;
        matchedCount: number;
        unmatchedOutflowCents: number;
        /** Depósitos (positivos) aún sin cruzar contra pasarela. */
        unmatchedDepositCount: number;
        /** Dinero de pasarela ya cruzado con el banco (entradas MATCHED). */
        matchedDepositCents: number;
    };
    suggestions: SuggestionsPayload[];
    depositSuggestions: { transactionId: string; candidates: DepositMatchCandidate[] }[];
}

interface CatalogAccount {
    id: string;
    label: string;
    accountLastFour: string;
    bankName: string;
}

type MatchFilter = "ALL" | "UNMATCHED" | "MATCHED" | "IGNORED";

function formatISODateShort(iso: string): string {
    return new Date(`${iso}T00:00:00`).toLocaleDateString("es-MX", {
        day: "2-digit",
        month: "short",
    });
}

export default function BankReconciliationPage() {
    const [data, setData] = useState<PagePayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [matchFilter, setMatchFilter] = useState<MatchFilter>("ALL");
    const [accounts, setAccounts] = useState<CatalogAccount[]>([]);
    const [ignoring, setIgnoring] = useState<string | null>(null);
    const [confirming, setConfirming] = useState<string | null>(null);

    // Importación
    const [importOpen, setImportOpen] = useState(false);
    const [importAccount, setImportAccount] = useState("none");
    const [importFile, setImportFile] = useState<File | null>(null);
    const [importing, setImporting] = useState(false);

    const suggestionsByTx = new Map(
        (data?.suggestions ?? []).map((s) => [s.transactionId, s.candidates])
    );

    const depositSuggestionsByTx = new Map(
        (data?.depositSuggestions ?? []).map((s) => [s.transactionId, s.candidates])
    );

    const fetchPage = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams();
            if (matchFilter !== "ALL") params.set("matchStatus", matchFilter);
            const res = await fetch(`/api/finance/bank-transactions?${params.toString()}`);
            const json = await res.json();
            if (!res.ok || json.error) throw new Error(json.error ?? "No se pudo cargar.");
            setData(json.data);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    }, [matchFilter]);

    useEffect(() => {
        fetchPage();
    }, [fetchPage]);

    useEffect(() => {
        fetch("/api/finance/bank-accounts?activeOnly=true")
            .then((res) => res.json())
            .then((json) => {
                if (json.success && Array.isArray(json.data)) setAccounts(json.data);
            })
            .catch(() => {});
    }, []);

    const handleImport = async () => {
        if (!importFile) {
            toast.error("Archivo requerido", {
                description: "Selecciona el CSV del estado de cuenta.",
            });
            return;
        }
        setImporting(true);
        try {
            const csvText = await importFile.text();
            const res = await fetch("/api/finance/bank-transactions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    csvText,
                    sourceBankAccountId: importAccount === "none" ? undefined : importAccount,
                }),
            });
            const json = await res.json();
            if (!res.ok || json.error) throw new Error(json.error ?? "No se pudo importar.");
            const { importedCount, duplicateCount, errorCount } = json.data;
            toast.success(`Importados ${importedCount} movimientos`, {
                description:
                    `${duplicateCount} duplicados omitidos (reimportar es seguro)` +
                    (errorCount > 0 ? ` · ${errorCount} líneas ilegibles` : ""),
            });
            setImportOpen(false);
            setImportFile(null);
            await fetchPage();
        } catch (err) {
            toast.error("Error al importar", { description: (err as Error).message });
        } finally {
            setImporting(false);
        }
    };

    const doPatch = async (payload: Record<string, unknown>, successTitle: string) => {
        const res = await fetch("/api/finance/bank-transactions", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok || json.error) {
            throw new Error(json.error ?? "No se pudo aplicar la acción.");
        }
        toast.success(successTitle);
        await fetchPage();
    };

    const handleConfirm = async (tx: BankTransactionItem) => {
        const candidates = suggestionsByTx.get(tx.id) ?? [];
        if (candidates.length === 0) {
            toast.error("Sin sugerencia", {
                description:
                    "No hay partida CONFIRMED con monto espejo en la ventana. Puedes exportar la partida desde la corrida o ignorar el movimiento.",
            });
            return;
        }
        if (candidates.length > 1) {
            // La ambigüedad es un problema real, no molesto: confirmar a
            // ciegas el primero pondría una firma automática donde el dinero
            // es de nadie. Página elegirá manualmente con el detalle de la corrida.
            toast.warning("Más de una candidata", {
                description:
                    "Hay varias partidas con el mismo monto en la ventana. Revisa las corridas para cruzar manualmente o ignora si ninguna aplica.",
            });
            return;
        }
        setConfirming(tx.id);
        try {
            await doPatch(
                {
                    action: "CONFIRM_MATCH",
                    transactionId: tx.id,
                    paymentRunItemId: candidates[0].paymentRunItemId,
                },
                "Movimiento cruzado con la partida",
            );
        } catch (err) {
            toast.error("Error al cruzar", { description: (err as Error).message });
        } finally {
            setConfirming(null);
        }
    };

    const handleIgnore = async (tx: BankTransactionItem) => {
        setIgnoring(tx.id);
        try {
            await doPatch(
                { action: "IGNORE", transactionId: tx.id },
                "Movimiento ignorado"
            );
        } catch (err) {
            toast.error("Error al ignorar", { description: (err as Error).message });
        } finally {
            setIgnoring(null);
        }
    };

    const handleUnmatch = async (tx: BankTransactionItem) => {
        try {
            await doPatch(
                { action: "UNMATCH", transactionId: tx.id },
                "Match deshecho — vuelve a la bandeja",
            );
        } catch (err) {
            toast.error("Error al deshacer", { description: (err as Error).message });
        }
    };

    /**
     * Confirmar el cruce de UNA entrada contra la fila de pasarela sugerida.
     * Idéntico protocolo que el de salidas: la sugerencia nombra, la persona
     * confirma; más de una candidata en ventana es ambigüedad que no se
     * firma a ciegas.
     */
    const depositCandidatesFor = (tx: BankTransactionItem) =>
        depositSuggestionsByTx.get(tx.id) ?? [];

    const describeDepositCandidate = (c: DepositMatchCandidate): string =>
        `Depositó ${c.acquirer}` +
        (c.branchName ? ` (Suc. ${c.branchName})` : "") +
        (c.destinationAccountLastFour ? ` a ····${c.destinationAccountLastFour}` : "");

    const handleConfirmDeposit = async (tx: BankTransactionItem) => {
        const candidates = depositCandidatesFor(tx);
        if (candidates.length === 0) {
            toast.error("Sin sugerencia de pasarela", {
                description:
                    "No hay reporte con abono neto exacto aterrizando en esta cuenta en la ventana. Asigna cuenta destino al reporte o ignora el movimiento.",
            });
            return;
        }
        if (candidates.length > 1) {
            toast.warning("Más de una candidata", {
                description:
                    "Varias filas de pasarela calzan: " +
                    candidates.slice(0, 3).map(describeDepositCandidate).join(" · ") +
                    ". Revisa el reporte de pasarela para cruzar manualmente.",
            });
            return;
        }
        setConfirming(tx.id);
        try {
            await doPatch(
                {
                    action: "CONFIRM_DEPOSIT_MATCH",
                    transactionId: tx.id,
                    gatewayTransactionId: candidates[0].gatewayTransactionId,
                },
                `Depósito cruzado: ${describeDepositCandidate(candidates[0])}`,
            );
        } catch (err) {
            toast.error("Error al cruzar", { description: (err as Error).message });
        } finally {
            setConfirming(null);
        }
    };

    const handleUnmatchDeposit = async (tx: BankTransactionItem) => {
        try {
            await doPatch(
                { action: "UNMATCH", transactionId: tx.id, deposit: true },
                "Cruce deshecho — el depósito vuelve a la bandeja",
            );
        } catch (err) {
            toast.error("Error al deshacer", { description: (err as Error).message });
        }
    };

    const items = data?.items ?? [];
    const summary = data?.summary;

    // Entradas: los movimientos positivos viven su propia sección con su
    // propio protocolo, sin mezclarse con las salidas de corridas.
    const depositItems = items.filter((tx) => tx.amountCents > 0);

    return (
        <div className="container mx-auto py-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <Landmark className="h-7 w-7 text-primary" /> Conciliación bancaria
                    </h1>
                    <p className="text-sm text-muted-foreground max-w-[70ch]">
                        Importa el estado de cuenta y crúzalo contra las partidas de pago
                        liquidadas. El cruce requiere monto espejo exacto; la sugerencia nunca
                        es confirmación — cruzar es un acto tuyo con auditoría.
                    </p>
                </div>
                <div className="flex gap-2">
                    <Dialog
                        open={importOpen}
                        onOpenChange={(v) => {
                            setImportOpen(v);
                            if (!v) setImportFile(null);
                        }}
                    >
                        <DialogTrigger asChild>
                            <Button size="sm">
                                <Upload className="mr-2 h-4 w-4" /> Importar estado de cuenta
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[480px]">
                            <form
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    handleImport();
                                }}
                            >
                                <DialogHeader>
                                    <DialogTitle>Importar estado de cuenta</DialogTitle>
                                    <DialogDescription>
                                        CSV con columnas fecha, descripción, monto (y
                                        opcionalmente referencia). Reimportar el mismo archivo no
                                        duplica movimientos.
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="grid gap-4 py-4">
                                    <div className="grid gap-2">
                                        <Label htmlFor="import-cuenta">Cuenta de origen</Label>
                                        <Select value={importAccount} onValueChange={setImportAccount}>
                                            <SelectTrigger id="import-cuenta">
                                                <SelectValue placeholder="¿De qué cuenta es el estado?" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="none">Sin asignar cuenta</SelectItem>
                                                {accounts.map((a) => (
                                                    <SelectItem key={a.id} value={a.id}>
                                                        {a.label} ····· {a.accountLastFour}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="import-csv">Archivo CSV</Label>
                                        <Input
                                            id="import-csv"
                                            type="file"
                                            accept=".csv,.txt"
                                            onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                                        />
                                        {importFile && (
                                            <p className="text-xs text-muted-foreground">
                                                {importFile.name} — {(importFile.size / 1024).toFixed(1)} KB
                                            </p>
                                        )}
                                    </div>
                                </div>
                                <DialogFooter>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setImportOpen(false)}
                                    >
                                        Cancelar
                                    </Button>
                                    <Button type="submit" size="sm" disabled={importing || !importFile}>
                                        {importing && (
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        )}
                                        Importar
                                    </Button>
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {summary && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    <Card>
                        <CardHeader className="pb-2">
                            <CardDescription className="text-xs">Sin cruzar</CardDescription>
                            <CardTitle className="text-xl font-bold tabular-nums">
                                {summary.unmatchedCount}
                            </CardTitle>
                        </CardHeader>
                    </Card>
                    <Card>
                        <CardHeader className="pb-2">
                            <CardDescription className="text-xs">
                                Salidas sin conciliar (el banco descontó que el libro no sostiene)
                            </CardDescription>
                            <CardTitle className="text-xl font-bold tabular-nums text-destructive">
                                {formatCents(summary.unmatchedOutflowCents)}
                            </CardTitle>
                        </CardHeader>
                    </Card>
                    <Card>
                        <CardHeader className="pb-2">
                            <CardDescription className="text-xs">Cruzados</CardDescription>
                            <CardTitle className="text-xl font-bold tabular-nums">
                                {summary.matchedCount}
                            </CardTitle>
                        </CardHeader>
                    </Card>
                    <Card>
                        <CardHeader className="pb-2">
                            <CardDescription className="text-xs">
                                Depósitos sin cruzar
                            </CardDescription>
                            <CardTitle className="text-xl font-bold tabular-nums">
                                {summary.unmatchedDepositCount}
                            </CardTitle>
                        </CardHeader>
                    </Card>
                    <Card>
                        <CardHeader className="pb-2">
                            <CardDescription className="text-xs">
                                Pasarela cruzada con el banco
                            </CardDescription>
                            <CardTitle className="text-xl font-bold tabular-nums text-emerald-700">
                                {formatCents(summary.matchedDepositCents)}
                            </CardTitle>
                        </CardHeader>
                    </Card>
                </div>
            )}

            <Card>
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-2">
                        <div>
                            <CardTitle className="text-base font-bold">Movimientos</CardTitle>
                            <CardDescription className="text-xs">
                                Ordenados por fecha valor descendente.
                            </CardDescription>
                        </div>
                        <div className="flex items-center gap-1 text-xs">
                            {(["ALL", "UNMATCHED", "MATCHED", "IGNORED"] as const).map((f) => (
                                <button
                                    key={f}
                                    type="button"
                                    onClick={() => setMatchFilter(f)}
                                    className={`px-2 py-1 rounded-md transition-colors ${
                                        matchFilter === f
                                            ? "bg-primary/10 text-primary font-semibold"
                                            : "text-muted-foreground hover:bg-muted/50"
                                    }`}
                                >
                                    {f === "ALL"
                                        ? "Todos"
                                        : f === "UNMATCHED"
                                          ? "Sin cruzar"
                                          : f === "MATCHED"
                                            ? "Cruzados"
                                            : "Ignorados"}
                                </button>
                            ))}
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {error ? (
                        <p className="text-sm text-destructive">{error}</p>
                    ) : loading && !data ? (
                        <div className="py-12 text-center text-muted-foreground text-sm">
                            Cargando movimientos…
                        </div>
                    ) : items.length === 0 ? (
                        <EmptyState
                            icon={CheckCircle2}
                            title="No hay movimientos"
                            description={
                                matchFilter === "ALL"
                                    ? "Importa el CSV del estado de cuenta para empezar. Reimportar es seguro."
                                    : "Sin movimientos con este filtro."
                            }
                        />
                    ) : (
                        <div className="border rounded-md overflow-x-auto">
                            <Table>
                                <TableCaption className="sr-only">
                                    Movimientos bancarios con estado de cruce y acción
                                </TableCaption>
                                <TableHeader>
                                    <TableRow className="bg-muted/50">
                                        <TableHead>Fecha</TableHead>
                                        <TableHead>Concepto</TableHead>
                                        <TableHead>Referencia</TableHead>
                                        <TableHead className="text-right">Monto</TableHead>
                                        <TableHead>Cruce</TableHead>
                                        <TableHead className="text-right">Acción</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {items.map((tx) => {
                                        const candidates = suggestionsByTx.get(tx.id) ?? [];
                                        return (
                                            <TableRow key={tx.id} className="hover:bg-muted/40">
                                                <TableCell className="text-sm tabular-nums whitespace-nowrap">
                                                    {formatISODateShort(tx.valueDate)}
                                                </TableCell>
                                                <TableCell className="text-sm max-w-[28ch] truncate">
                                                    {tx.description}
                                                </TableCell>
                                                <TableCell className="text-xs text-muted-foreground">
                                                    {tx.reference ?? "—"}
                                                </TableCell>
                                                <TableCell
                                                    className={`text-right tabular-nums font-semibold ${
                                                        tx.amountCents < 0 ? "text-destructive" : "text-emerald-700"
                                                    }`}
                                                >
                                                    {formatCents(tx.amountCents)}
                                                </TableCell>
                                                <TableCell>
                                                    {tx.matchStatus === "MATCHED" ? (
                                                        <Badge variant="success">Cruzado</Badge>
                                                    ) : tx.matchStatus === "IGNORED" ? (
                                                        <Badge variant="outline">Ignorado</Badge>
                                                    ) : candidates.length > 0 ? (
                                                        <Badge variant="warning">
                                                            {candidates.length} sugerida
                                                            {candidates.length === 1 ? "" : "s"}
                                                        </Badge>
                                                    ) : (
                                                        <Badge variant="secondary">Sin cruce</Badge>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {tx.matchStatus === "UNMATCHED" ? (
                                                        <div className="flex gap-1 justify-end">
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                disabled={confirming === tx.id}
                                                                onClick={() => handleConfirm(tx)}
                                                                title="Cruzar contra la partida sugerida"
                                                            >
                                                                {confirming === tx.id ? (
                                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                                ) : (
                                                                    <Link2 className="w-3.5 h-3.5" />
                                                                )}
                                                                Cruzar
                                                            </Button>
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                disabled={ignoring === tx.id}
                                                                onClick={() => handleIgnore(tx)}
                                                                title="Comisión, ISR u otro movimiento legítimo sin partida"
                                                            >
                                                                <XCircle className="w-3.5 h-3.5" />
                                                                Ignorar
                                                            </Button>
                                                        </div>
                                                    ) : tx.matchStatus === "MATCHED" ? (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => handleUnmatch(tx)}
                                                            title="Deshacer el cruce"
                                                        >
                                                            <RotateCcw className="w-3.5 h-3.5" />
                                                            Deshacer
                                                        </Button>
                                                    ) : (
                                                        <span className="text-xs text-muted-foreground">—</span>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* ── Entradas (depósitos de pasarela) ─────────────────────── */}
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-2">
                        <div>
                            <CardTitle className="text-base font-bold">
                                Entradas (depósitos)
                            </CardTitle>
                            <CardDescription className="text-xs max-w-[70ch]">
                                Los abonos del banco cruzan contra los depósitos de pasarela:
                                la sugerencia nombra el destino declarado — la confirmación
                                es tuya, atómica y reversible.
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {error ? (
                        <p className="text-sm text-destructive">{error}</p>
                    ) : loading && !data ? (
                        <div className="py-12 text-center text-muted-foreground text-sm">
                            Cargando depósitos…
                        </div>
                    ) : depositItems.length === 0 ? (
                        <EmptyState
                            icon={CheckCircle2}
                            title="Sin depósitos en este filtro"
                            description={
                                matchFilter === "ALL"
                                    ? "Los abonos positivos del estado de cuenta aparecen aquí para cruzarse contra los reportes de pasarela."
                                    : "Sin movimientos positivos con este filtro."
                            }
                        />
                    ) : (
                        <div className="border rounded-md overflow-x-auto">
                            <Table>
                                <TableCaption className="sr-only">
                                    Depósitos bancarios con sugerencia de pasarela y acción
                                </TableCaption>
                                <TableHeader>
                                    <TableRow className="bg-muted/50">
                                        <TableHead>Fecha</TableHead>
                                        <TableHead>Concepto</TableHead>
                                        <TableHead>Cuenta</TableHead>
                                        <TableHead className="text-right">Monto</TableHead>
                                        <TableHead>Sugerencia de pasarela</TableHead>
                                        <TableHead className="text-right">Acción</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {depositItems.map((tx) => {
                                        const cands = depositCandidatesFor(tx);
                                        return (
                                            <TableRow key={tx.id} className="hover:bg-muted/40">
                                                <TableCell className="text-sm tabular-nums whitespace-nowrap">
                                                    {formatISODateShort(tx.valueDate)}
                                                </TableCell>
                                                <TableCell className="text-sm max-w-[28ch] truncate">
                                                    {tx.description}
                                                </TableCell>
                                                <TableCell className="text-xs text-muted-foreground">
                                                    {tx.accountLabel ?? "—"}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums font-semibold text-emerald-700">
                                                    {formatCents(tx.amountCents)}
                                                </TableCell>
                                                <TableCell className="max-w-[36ch]">
                                                    {tx.matchStatus === "MATCHED" ? (
                                                        tx.matchedGatewayTransactionId ? (
                                                            <Badge variant="success">Cruzado con pasarela</Badge>
                                                        ) : (
                                                            <Badge variant="success">Cruzado (salida)</Badge>
                                                        )
                                                    ) : tx.matchStatus === "IGNORED" ? (
                                                        <Badge variant="outline">Ignorado</Badge>
                                                    ) : cands.length > 0 ? (
                                                        <span className="text-xs">
                                                            {describeDepositCandidate(cands[0])}
                                                            {cands.length > 1 && ` (+${cands.length - 1})`}
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs text-muted-foreground">
                                                            Sin candidato — revisa el destino del reporte
                                                        </span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {tx.matchStatus === "UNMATCHED" ? (
                                                        <div className="flex gap-1 justify-end">
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                disabled={confirming === tx.id}
                                                                onClick={() => handleConfirmDeposit(tx)}
                                                                title="Cruzar contra el depósito de pasarela sugerido"
                                                            >
                                                                {confirming === tx.id ? (
                                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                                ) : (
                                                                    <Link2 className="w-3.5 h-3.5" />
                                                                )}
                                                                Confirmar
                                                            </Button>
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                disabled={ignoring === tx.id}
                                                                onClick={() => handleIgnore(tx)}
                                                                title="Depósito legítimo sin match de pasarela (ej. ventanilla)"
                                                            >
                                                                <XCircle className="w-3.5 h-3.5" />
                                                                Ignorar
                                                            </Button>
                                                        </div>
                                                    ) : tx.matchStatus === "MATCHED" && tx.matchedGatewayTransactionId ? (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => handleUnmatchDeposit(tx)}
                                                            title="Deshacer el cruce con pasarela"
                                                        >
                                                            <RotateCcw className="w-3.5 h-3.5" />
                                                            Deshacer
                                                        </Button>
                                                    ) : (
                                                        <span className="text-xs text-muted-foreground">—</span>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
