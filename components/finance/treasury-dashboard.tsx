"use client";

import { useEffect, useState, useCallback } from "react";
import { formatCents, statusBadgeClasses } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Loader2, Plus, RefreshCw, Wallet, FileText, ArrowRight } from "lucide-react";

export function TreasuryDashboard() {
  const [data, setData] = useState<{ paymentRuns: any[]; recurringContracts: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/finance/treasury");
      const json = await res.json();
      if (res.ok && json.success) {
        setData(json.data);
      } else {
        setError(json.error || "Error al cargar la tesorería");
      }
    } catch (e) {
      setError("Error de conexión");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-64 items-center justify-center gap-4 text-destructive">
        <p>{error}</p>
        <Button variant="outline" onClick={() => load()}>
          Reintentar
        </Button>
      </div>
    );
  }

  const { paymentRuns = [], recurringContracts = [] } = data || {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold tracking-tight">Panel de Tesorería</h2>
        <Button variant="outline" size="sm" onClick={() => load(true)}>
          <RefreshCw className="mr-2 h-4 w-4" /> Actualizar
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Corridas de Pago */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-lg">Próximas Corridas de Pago</CardTitle>
              <CardDescription>Programación de egresos (nómina, proveedores)</CardDescription>
            </div>
            <Wallet className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {paymentRuns.length === 0 ? (
              <EmptyState
                icon={Wallet}
                title="Sin corridas programadas"
                description="No hay corridas de pago pendientes."
                action={
                  <Button variant="secondary" size="sm">
                    <Plus className="mr-2 h-4 w-4" /> Crear Corrida
                  </Button>
                }
              />
            ) : (
              <div className="space-y-4 pt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Título</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Estatus</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paymentRuns.map((run) => (
                      <TableRow key={run.id}>
                        <TableCell className="font-medium">{run.title}</TableCell>
                        <TableCell>
                          {new Date(run.runDate).toLocaleDateString("es-MX", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </TableCell>
                        <TableCell>
                          <Badge variant={run.status === 'APPROVED' ? 'default' : 'secondary'}>
                            {run.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCents(run.totalAmountCents)} {run.currency}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex justify-end">
                  <Button variant="ghost" size="sm">
                    Ver calendario completo <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Contratos Recurrentes */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-lg">Gastos Recurrentes</CardTitle>
              <CardDescription>Renta, servicios, mantenimiento fijo</CardDescription>
            </div>
            <FileText className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {recurringContracts.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="Sin contratos registrados"
                description="Registra la renta mensual o CFE para habilitar alertas."
                action={
                  <Button variant="secondary" size="sm">
                    <Plus className="mr-2 h-4 w-4" /> Nuevo Contrato
                  </Button>
                }
              />
            ) : (
              <div className="space-y-4 pt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Concepto</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Frecuencia</TableHead>
                      <TableHead className="text-right">Monto Base</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recurringContracts.map((contract) => (
                      <TableRow key={contract.id}>
                        <TableCell className="font-medium">{contract.title}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{contract.contractType}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {contract.paymentFrequency}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCents(contract.baseAmountCents)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex justify-end">
                  <Button variant="ghost" size="sm">
                    Administrar contratos <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
