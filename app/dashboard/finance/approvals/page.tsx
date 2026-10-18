"use client";

import { useEffect, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCents } from "@/lib/utils";
import { Inbox, ExternalLink, RefreshCw, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Bandeja unificada de aprobaciones.
 *
 * Una sola pantalla para las tres cadenas de autorización de dinero: OC/OS
 * (matriz), gastos operativos (rol por monto) y corridas de pago (doble firma).
 * Cada renglón es actionable: el enlace lleva a la pantalla donde se resuelve,
 * y la acción misma sigue validada por la API de su flujo — esta bandeja no
 * aprueba nada, sólo contesta "qué puedo resolver hoy".
 */

interface UnifiedApprovalItem {
    id: string;
    source: "OC" | "OS" | "EXPENSE" | "PAYMENT_RUN";
    sourceLabel: string;
    docId: string;
    title: string;
    amountCents: number | null;
    requesterName: string | null;
    requiredRole: string | null;
    createdAt: string;
    branchId: string | null;
    branchName: string | null;
    actionHref: string;
}

interface InboxResponse {
    items: UnifiedApprovalItem[];
    total: number;
}

export default function ApprovalsPage() {
    const [data, setData] = useState<InboxResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);

    useEffect(() => {
        let ignore = false;
        setLoading(true);
        setError(null);
        fetch("/api/finance/approvals/inbox")
            .then(async (res) => {
                const json = await res.json();
                if (!res.ok || "error" in json) {
                    throw new Error(json.error ?? "No se pudo cargar la bandeja");
                }
                return json;
            })
            .then((json) => {
                if (!ignore) setData(json);
            })
            .catch((err: Error) => {
                if (!ignore) setError(err.message);
            })
            .finally(() => {
                if (!ignore) setLoading(false);
            });
        return () => {
            ignore = true;
        };
    }, [refreshKey]);

    const items = data?.items ?? [];
    const totalCents = items.reduce(
        (acc, item) => acc + (item.amountCents ?? 0),
        0
    );

    return (
        <div className="container mx-auto py-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <Inbox className="h-7 w-7 text-primary" /> Aprobaciones
                    </h1>
                    <p className="text-sm text-muted-foreground max-w-[70ch]">
                        Las tres cadenas de autorización en una lista: compras y órdenes de servicio,
                        gastos operativos y corridas de pago con doble firma. Abrir el renglón lleva a
                        la pantalla donde se resuelve.
                    </p>
                </div>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRefreshKey((k) => k + 1)}
                    title="Recargar"
                >
                    <RefreshCw
                        className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
                    />
                </Button>
            </div>

            {!loading && !error && items.length > 0 && (
                <div className="flex flex-wrap gap-2 text-sm">
                    {(["OC", "OS", "EXPENSE", "PAYMENT_RUN"] as const).map((src) => {
                        const count = items.filter((i) => i.source === src).length;
                        if (count === 0) return null;
                        return (
                            <Badge key={src} variant="outline">
                                {count}{" "}
                                {items.find((i) => i.source === src)?.sourceLabel.toLowerCase()}
                            </Badge>
                        );
                    })}
                    <span className="text-sm text-muted-foreground ml-auto tabular-nums">
                        Total en autorización: {formatCents(totalCents)}
                    </span>
                </div>
            )}

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base font-bold">Pendientes de resolver</CardTitle>
                    <CardDescription className="text-xs">
                        Ordenados por antigüedad: lo más viejo primero. Quien registró un documento no
                        lo ve aquí — la segregación de funciones se aplica en servidor.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {error ? (
                        <p className="text-sm text-destructive">{error}</p>
                    ) : loading && !data ? (
                        <div className="py-12 text-center text-muted-foreground text-sm">
                            Cargando bandeja…
                        </div>
                    ) : items.length === 0 ? (
                        <EmptyState
                            icon={CheckCircle2}
                            title="Bandeja al día"
                            description="No hay documentos esperando tu firma. Las nuevas solicitudes aparecerán aquí cuando un gasto, una compra o una corrida de pago las pida."
                        />
                    ) : (
                        <div className="border rounded-md overflow-x-auto">
                            <Table>
                                <TableCaption className="sr-only">
                                    Documentos pendientes de aprobación con monto, solicitante y
                                    enlace a su resolución.
                                </TableCaption>
                                <TableHeader>
                                    <TableRow className="bg-muted/50">
                                        <TableHead>Documento</TableHead>
                                        <TableHead>Solicita</TableHead>
                                        <TableHead>Sucursal</TableHead>
                                        <TableHead>Requiere</TableHead>
                                        <TableHead className="text-right">Monto</TableHead>
                                        <TableHead className="text-right">Resolver</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {items.map((item) => (
                                        <TableRow
                                            key={item.id}
                                            className="hover:bg-muted/40"
                                        >
                                            <TableCell>
                                                <div className="font-medium">{item.title}</div>
                                                <div className="text-xs text-muted-foreground">
                                                    {item.sourceLabel}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-sm">
                                                {item.requesterName ?? "—"}
                                            </TableCell>
                                            <TableCell className="text-sm">
                                                {item.branchName ?? "—"}
                                            </TableCell>
                                            <TableCell>
                                                {item.requiredRole ? (
                                                    <Badge variant="outline">{item.requiredRole}</Badge>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground">
                                                        Doble firma
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums font-semibold">
                                                {item.amountCents != null
                                                    ? formatCents(item.amountCents)
                                                    : "—"}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Link
                                                    href={item.actionHref}
                                                    className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                                                >
                                                    Abrir
                                                    <ExternalLink className="w-3.5 h-3.5" />
                                                </Link>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
