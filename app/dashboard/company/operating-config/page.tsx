"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PurchasingApprovalsSection } from "@/components/company/purchasing-approvals-section";
import { PurchasingDelegationSection } from "@/components/company/purchasing-delegation-section";
import {
  OperatingConfigForm,
  type OperatingConfigValues,
} from "@/components/company/operating-config-form";
import { OperatingConfigSkeleton } from "@/components/company/operating-config-skeleton";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Sliders } from "lucide-react";

/**
 * C13 — una carga fallida no puede parecerse a una configuración en default.
 *
 * Antes, un `GET` que fallaba dejaba `config` en `null` y el formulario se
 * montaba igual, con los defaults de módulo en cada campo. Un operador que
 * Guardaba después de un fallo estaba escribiendo esos defaults sobre la fila
 * real, incluyendo umbrales que nadie eligió.
 *
 * Ahora hay tres estados y sólo uno monta el formulario: cargando, cargada con
 * datos, y fallida con reintento.
 */
export default function OperatingConfigPage() {
  const [config, setConfig] = useState<OperatingConfigValues | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Ignora respuestas anteriores: un reintento lento no debe pisar una más nueva.
  const intento = useRef(0);

  const cargar = useCallback(async () => {
    const numero = ++intento.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/company/operating-config");
      const json = await res.json().catch(() => null);
      if (numero !== intento.current) return;
      if (!res.ok || !json?.success) {
        setConfig(null);
        setError(json?.error?.message || "No pudimos cargar la configuración del grupo.");
        return;
      }
      setConfig(json.data);
    } catch {
      if (numero !== intento.current) return;
      setConfig(null);
      setError("No pudimos cargar la configuración del grupo.");
    } finally {
      if (numero === intento.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Sliders className="h-6 w-6 text-foreground" /> Modelo Operativo del Grupo
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configura la arquitectura funcional entre corporativo y sucursales, los límites de autorización y las metas financieras.
        </p>
      </div>

      {loading ? (
        <OperatingConfigSkeleton />
      ) : error ? (
        // El formulario no se monta: no hay dato guardado que editar, y mostrar
        // defaults aquí sería una mentira que el siguiente guardado persistiría.
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
            <div className="space-y-1">
              <h2 className="font-semibold">No se pudo cargar la configuración</h2>
              <p className="text-sm text-muted-foreground">{error}</p>
              <p className="text-sm text-muted-foreground">
                No se muestran valores de ejemplo para que no se guarden por error. Vuelve a intentarlo.
              </p>
            </div>
          </div>
          <Button variant="outline" onClick={() => void cargar()}>
            Reintentar
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          <OperatingConfigForm initialConfig={config} onSuccess={() => void cargar()} />
          <PurchasingApprovalsSection />
          <PurchasingDelegationSection />
        </div>
      )}
    </div>
  );
}
