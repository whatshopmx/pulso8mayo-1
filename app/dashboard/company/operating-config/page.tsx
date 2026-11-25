"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PurchasingApprovalsSection } from "@/components/company/purchasing-approvals-section";
import { PurchasingDelegationSection } from "@/components/company/purchasing-delegation-section";
import { SalesChannelsSection } from "@/components/company/sales-channels-section";
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
 * guardaba después de un fallo estaba escribiendo esos defaults sobre la fila
 * real, incluyendo umbrales que nadie eligió.
 *
 * Ahora hay tres estados y sólo uno monta el formulario: cargando, cargada con
 * datos, y fallida con reintento.
 *
 * C17 — la página tiene cinco guardados independientes. El índice superior y
 * el texto de cada tarjeta lo dicen; antes la barra pegajosa prometía aplicar
 * «las nuevas políticas al grupo» y las otras cuatro tarjetas seguían sin
 * guardar.
 */
const SECCIONES = [
  { href: "#umbrales", label: "Umbrales" },
  { href: "#costos", label: "Costos y fiscales" },
  { href: "#modelo", label: "Modelo operativo" },
  { href: "#canales", label: "Compras y canales" },
];

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

  /**
   * Revalidación posterior al guardado: no vuelve a montar el esqueleto ni
   * pierde el scroll. Si falla, conserva lo que el operador tiene en pantalla.
   */
  const refrescarSilencioso = useCallback(async () => {
    const numero = ++intento.current;
    try {
      const res = await fetch("/api/company/operating-config");
      const json = await res.json().catch(() => null);
      if (numero !== intento.current) return;
      if (!res.ok || !json?.success) return;
      setConfig(json.data);
    } catch {
      // Conserva los datos vigentes; el toast de guardado ya confirmó la escritura.
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 py-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Sliders className="h-6 w-6 text-foreground" aria-hidden="true" /> Modelo Operativo del Grupo
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configura la arquitectura funcional entre corporativo y sucursales, los límites de autorización y las metas financieras.
        </p>
        <nav aria-label="Secciones de configuración" className="mt-3 flex flex-wrap items-center gap-1">
          {SECCIONES.map((seccion) => (
            <Button key={seccion.href} asChild variant="ghost" size="sm" className="h-9 text-xs text-muted-foreground">
              <a href={seccion.href}>{seccion.label}</a>
            </Button>
          ))}
          <span className="ml-1 text-xs text-muted-foreground">
            · Cada tarjeta se guarda por separado.
          </span>
        </nav>
      </div>

      {loading ? (
        <OperatingConfigSkeleton />
      ) : error ? (
        // El formulario no se monta: no hay dato guardado que editar, y mostrar
        // defaults aquí sería una mentira que el siguiente guardado persistiría.
        <div role="alert" className="space-y-4 rounded-lg border border-destructive/30 bg-destructive/5 p-6">
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
          <Button variant="outline" className="h-11" onClick={() => void cargar()}>
            Reintentar
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          <OperatingConfigForm initialConfig={config} onSuccess={() => void refrescarSilencioso()} />
          <section id="canales" aria-label="Canales de venta" className="scroll-mt-24 space-y-6">
            <SalesChannelsSection />
          </section>
          <section id="aprobaciones" className="scroll-mt-24">
            <PurchasingApprovalsSection />
          </section>
          <section id="delegacion" className="scroll-mt-24">
            <PurchasingDelegationSection />
          </section>
        </div>
      )}
    </div>
  );
}
