"use client";

import { useEffect, useState } from "react";
import { ImageIcon } from "lucide-react";

/**
 * Evidencia fotográfica de una merma, servida con aislamiento por tenancy.
 *
 * La URL de la imagen NUNCA viene en el payload del historial (ahí viaja la key
 * de R2, no pública): se pide a GET /api/inventory/waste/:id/evidence-url,
 * que valida empresa + sucursal antes de devolver una URL firmada que expira.
 */
export function EvidenceImage({ wasteId, alt }: { wasteId: string; alt: string }) {
  const [result, setResult] = useState<{
    forId: string;
    url: string | null;
    state: "loading" | "ready" | "empty" | "error";
  }>({ forId: wasteId, url: null, state: "loading" });

  // Loading derivado: mientras la petición del id actual no haya terminado,
  // mostramos placeholder sin necesidad de setState síncrono en el efecto.
  const view =
    result.forId === wasteId
      ? result
      : { url: null, state: "loading" as const };

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/inventory/waste/${wasteId}/evidence-url`)
      .then(async (res) => {
        if (!res.ok) return { url: null as string | null, ok: false };
        const json = await res.json();
        return { url: (json?.data?.url as string | undefined) ?? null, ok: true };
      })
      .then(({ url: u, ok }) => {
        if (cancelled) return;
        setResult({
          forId: wasteId,
          url: u,
          state: u ? "ready" : ok ? "empty" : "error",
        });
      })
      .catch(() => {
        if (!cancelled)
          setResult({ forId: wasteId, url: null, state: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [wasteId]);

  if (view.state === "loading") {
    return (
      <div className="h-32 rounded-lg border bg-sidebar animate-pulse flex items-center justify-center">
        <ImageIcon className="h-4 w-4 text-muted-foreground/50" aria-hidden="true" />
      </div>
    );
  }

  if (view.state !== "ready" || !view.url) {
    return (
      <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
        <ImageIcon className="h-3 w-3" aria-hidden="true" />
        {view.state === "error"
          ? "No se pudo cargar la evidencia."
          : "Sin evidencia guardada para este registro."}
      </p>
    );
  }

  return (
    <a href={view.url} target="_blank" rel="noopener noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={view.url}
        alt={alt}
        className="rounded-lg border max-h-56 w-auto hover:opacity-90 transition-opacity"
      />
    </a>
  );
}
