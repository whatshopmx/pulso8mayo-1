"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, Loader2, Percent, Plus, Trash2 } from "lucide-react";
import {
  COMMISSION_CHANNELS,
  commissionChannelLabel,
  formatRateBps,
  MAX_RATE_BPS,
} from "@/lib/services/commission-types";
import type { CommissionRate } from "@/lib/services/commission-types";

/**
 * Porcentaje escrito por el usuario → puntos base.
 *
 * `parseFloat` acepta `1e3`, que con tres teclas produciría una tarifa del
 * 1000%. Aquí sólo se admiten dígitos con a lo más dos decimales, que es la
 * precisión en la que se negocia una tarifa de agregador.
 */
function percentToBps(raw: string): number | null {
  const cleaned = raw.trim().replace(/[%\s]/g, "");
  if (cleaned === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const bps = Math.round(Number(cleaned) * 100);
  return bps >= 0 && bps <= MAX_RATE_BPS ? bps : null;
}

/**
 * Configuración de tarifas por canal.
 *
 * Es la única pieza que hace que el renglón de comisiones del P&L exista: sin
 * tarifa configurada el sistema NO inventa una tasa de mercado, deja el renglón
 * en "sin datos" y lo dice. Por eso la pantalla insiste en que capturar aquí es
 * lo que enciende el cálculo.
 */
export function CommissionRatesPanel({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const [rates, setRates] = useState<CommissionRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const [channel, setChannel] = useState<string>("tpv");
  const [percent, setPercent] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(
    new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" }).slice(0, 8) + "01",
  );
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch("/api/finance/commission-rates");
      const json = await res.json();
      if (!res.ok || !json.success) {
        setFailed(true);
        return;
      }
      setRates(json.data?.rates ?? []);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const bps = percentToBps(percent);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (bps === null) {
      toast({
        title: "Tarifa inválida",
        description: `Captura un porcentaje entre 0 y ${MAX_RATE_BPS / 100}, con hasta dos decimales.`,
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/finance/commission-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel,
          rateBps: bps,
          effectiveFrom,
          notes: notes.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error?.message || json.error || "No se pudo guardar la tarifa.");
      }
      toast({
        title: "Tarifa guardada",
        description: `${commissionChannelLabel(channel)} al ${formatRateBps(bps)} desde el ${effectiveFrom}. Los cortes anteriores conservan la tarifa que tenían.`,
      });
      setPercent("");
      setNotes("");
      await load();
    } catch (err) {
      toast({
        title: "Error al guardar",
        description: err instanceof Error ? err.message : "Error de conexión.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (rate: CommissionRate) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/finance/commission-rates?id=${rate.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error?.message || "No se pudo borrar la tarifa.");
      }
      toast({
        title: "Tarifa borrada",
        description: `Los cortes que se valuaban con ella pasan a la vigencia anterior, o quedan sin estimar si no hay ninguna.`,
      });
      await load();
    } catch (err) {
      toast({
        title: "Error al borrar",
        description: err instanceof Error ? err.message : "Error de conexión.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg font-bold flex items-center gap-2">
          <Percent className="h-5 w-5 text-primary" /> Tarifas por Canal
        </CardTitle>
        <p className="text-sm text-muted-foreground max-w-[80ch]">
          Cada corte se valúa con la tarifa vigente en <span className="font-medium">su</span> fecha
          de negocio, no con la de hoy: capturar una tarifa nueva no mueve los meses ya cerrados. Un
          canal sin tarifa no se estima — el sistema no inventa una tasa de mercado, deja el renglón
          en blanco y lo dice.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {canEdit && (
          <form
            onSubmit={submit}
            className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_1fr_auto] gap-3 items-end rounded-md border bg-muted/30 p-3"
          >
            <div className="space-y-1">
              <Label htmlFor="rate-channel" className="text-xs">
                Canal
              </Label>
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger id="rate-channel" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMMISSION_CHANNELS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {commissionChannelLabel(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="rate-percent" className="text-xs">
                Tarifa (%)
              </Label>
              <Input
                id="rate-percent"
                type="text"
                inputMode="decimal"
                placeholder="27.50"
                className="h-9 w-28 tabular-nums"
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                aria-describedby="rate-percent-help"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="rate-from" className="text-xs">
                Vigente desde
              </Label>
              <Input
                id="rate-from"
                type="date"
                className="h-9 w-40"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="rate-notes" className="text-xs">
                Nota (opcional)
              </Label>
              <Input
                id="rate-notes"
                type="text"
                placeholder="Renegociada tras el volumen de diciembre"
                className="h-9"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <Button type="submit" size="sm" className="h-9" disabled={saving}>
              {saving ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Plus className="w-4 h-4 mr-1.5" />
              )}
              Guardar
            </Button>

            <p id="rate-percent-help" className="md:col-span-5 text-xs text-muted-foreground">
              Se guarda en puntos base ({percent && bps !== null ? `${percent}% = ${bps} bps` : "27.50% = 2750 bps"}).
              Capturar la misma fecha dos veces corrige la tarifa en lugar de crear una segunda.
            </p>
          </form>
        )}

        {loading ? (
          <div className="py-8 flex justify-center text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando tarifas...
          </div>
        ) : failed ? (
          <EmptyState
            bare
            icon={AlertCircle}
            title="No se pudieron cargar las tarifas"
            description="Error al conectar con el servicio de finanzas."
            action={
              <Button variant="outline" size="sm" onClick={load}>
                Reintentar
              </Button>
            }
          />
        ) : rates.length === 0 ? (
          <EmptyState
            bare
            icon={Percent}
            title="Sin tarifas configuradas"
            description={
              canEdit
                ? "Mientras no haya tarifas, el P&L no estima comisiones: el renglón queda en “sin datos”, que es distinto de cero. Captura la de tu terminal y la de cada agregador con el que operas."
                : "El P&L no estima comisiones hasta que dirección capture las tarifas de tu terminal y tus agregadores."
            }
          />
        ) : (
          <div className="border rounded-md overflow-x-auto">
            <Table>
              <TableCaption className="sr-only">
                Tarifas de comisión por canal, con su fecha de vigencia y quién las capturó.
              </TableCaption>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Canal</TableHead>
                  <TableHead className="text-right">Tarifa</TableHead>
                  <TableHead>Vigente desde</TableHead>
                  <TableHead>Nota</TableHead>
                  <TableHead>Capturada por</TableHead>
                  {canEdit && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rates.map((rate, idx) => {
                  // La vigencia más reciente de cada canal es la que rige hoy;
                  // las anteriores siguen valuando los cortes de su período y
                  // por eso no se borran solas.
                  const esVigente = rates.findIndex((r) => r.channel === rate.channel) === idx;
                  return (
                    <TableRow key={rate.id} className="hover:bg-muted/40 transition text-sm">
                      <TableCell className="font-medium">
                        {commissionChannelLabel(rate.channel)}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatRateBps(rate.rateBps)}
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                          {rate.rateBps} bps
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {rate.effectiveFrom}{" "}
                        {esVigente ? (
                          <Badge variant="outline" className="ml-1 text-xs py-0">
                            vigente
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">(histórica)</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[28ch]">
                        {rate.notes || "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {rate.createdByName || "Sin registrar"}
                      </TableCell>
                      {canEdit && (
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                            disabled={saving}
                            onClick={() => remove(rate)}
                            aria-label={`Borrar la tarifa de ${commissionChannelLabel(rate.channel)} vigente desde ${rate.effectiveFrom}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
