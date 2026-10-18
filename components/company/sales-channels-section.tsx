"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CommissionRatesPanel } from "@/components/finance/commission-rates-panel";
import { useSession } from "@/hooks/use-session";
import { roleIsAtLeast } from "@/lib/permissions";
import { formatRateBps } from "@/lib/services/commission-types";
import type { SalesChannelView } from "@/lib/services/sales-channel-catalog";
import { AlertTriangle, CheckCircle2, Loader2, Radio } from "lucide-react";

/**
 * Canales de venta del grupo (Fase 1 — operación multi-canal).
 *
 * Responde "¿qué plataformas tenemos?" en el lugar donde se configura el modelo
 * operativo, en vez de obligar a saltar a Finanzas. La lista de canales activos
 * es la que después consumen el corte manual y la conciliación semanal.
 *
 * El estado no se inventa en el cliente: lo deriva el servidor del catálogo
 * canónico más las tarifas capturadas (`/api/company/sales-channels`). Aquí sólo
 * se pinta y se enlaza con el editor de tarifas, que es donde se activa un canal.
 */
export function SalesChannelsSection() {
  const { session } = useSession();
  // Mismos roles que pueden escribir tarifas: sólo dirección mueve la tasa que
  // vale el margen de todas las sucursales.
  const canEdit = !!session?.user?.role && roleIsAtLeast(session.user.role, "ADMIN");

  const [channels, setChannels] = useState<SalesChannelView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/company/sales-channels");
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setChannels(null);
        setError(json?.error?.message || "No pudimos cargar los canales de venta.");
        return;
      }
      setChannels(json.data?.channels ?? []);
    } catch {
      setChannels(null);
      setError("No pudimos cargar los canales de venta.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const activos = channels?.filter((c) => c.active) ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-bold flex items-center gap-2">
            <Radio className="h-5 w-5 text-primary" /> Canales de venta
          </CardTitle>
          <CardDescription className="max-w-[80ch]">
            Qué plataformas opera el grupo. Un canal está activo cuando es de sistema (mostrador o
            terminal) o cuando tiene una tarifa capturada: configurar la tarifa{" "}
            <span className="font-medium">es</span> activar la plataforma. El corte manual y la
            conciliación semanal ofrecen sólo los canales activos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando canales…
            </div>
          ) : error ? (
            // Igual que el resto de la página: un fallo de carga no se disfraza
            // de "todo apagado". Sin datos no se afirma qué canales existen.
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>No se pudieron cargar los canales</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>{error}</p>
                <Button variant="outline" size="sm" onClick={() => void cargar()}>
                  Reintentar
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <p className="text-xs text-muted-foreground mb-2">
                {activos.length} canal{activos.length === 1 ? "" : "es"} activo
                {activos.length === 1 ? "" : "s"} de {channels?.length ?? 0}.
              </p>
              <ul className="divide-y divide-border">
                {channels?.map((c) => (
                  <li key={c.key} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium truncate">{c.label}</span>
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {c.kind === "SYSTEM" ? "Sistema" : "Agregador"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {c.rateBps === null ? "Sin tarifa del grupo" : formatRateBps(c.rateBps)}
                      </span>
                      {c.active ? (
                        <Badge
                          variant="outline"
                          className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                        >
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Activo
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          Sin configurar
                        </Badge>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      {/* El editor es lo que activa un canal; al guardar, la lista se recarga. */}
      <CommissionRatesPanel canEdit={canEdit} onSaved={() => void cargar()} />
    </div>
  );
}
