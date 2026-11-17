"use client";

import { useEffect, useRef, useState } from "react";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SalesCutPosFile({ cutId }: { cutId: string }) {
  const request = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: number } | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!link) return;
    const timer = setTimeout(() => setLink(null), Math.max(0, link.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [link]);

  async function consult() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setError(null); setLink(null);
    let failure = "No se pudo consultar el archivo POS. Intenta de nuevo.";
    try {
      const response = await fetch(`/api/sales/cuts/${encodeURIComponent(cutId)}/pos-file`, {
        signal: controller.signal, cache: "no-store",
      });
      if (!response.ok) {
        failure = response.status === 401 ? "Tu sesión terminó. Vuelve a iniciar sesión."
          : response.status === 403 ? "No tienes permiso para consultar este archivo POS."
          : response.status === 404 ? "El archivo POS no está disponible. Vuelve a subirlo desde el cierre de sucursal."
          : failure;
        throw new Error();
      }
      const body = await response.json();
      const data = body?.data;
      if (!body?.success || typeof data?.url !== "string" ||
        !Number.isFinite(data.expiresInSeconds) || data.expiresInSeconds <= 0) throw new Error();
      const url = new URL(data.url);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error();
      if (!controller.signal.aborted) setLink({ url: url.href,
        expiresAt: Date.now() + Math.min(data.expiresInSeconds, 600) * 1000 });
    } catch {
      if (!controller.signal.aborted) setError(failure);
    } finally {
      if (!controller.signal.aborted) { request.current = null; setLoading(false); }
    }
  }

  return (
    <div className="space-y-2">
      {link ? (
        <Button asChild variant="outline" className="w-full">
          <a href={link.url} target="_blank" rel="noopener noreferrer">
            <FileDown aria-hidden="true" />Abrir archivo POS
            <span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
        </Button>
      ) : (
        <Button type="button" variant="outline" className="w-full" disabled={loading}
          aria-busy={loading} onClick={consult}>
          <FileDown aria-hidden="true" />{loading ? "Consultando archivo…" : "Consultar archivo POS"}
        </Button>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground" role="status">
        {loading ? "Comprobando acceso al archivo del corte." : link ? "Enlace temporal disponible para este corte." : "El acceso se comprueba antes de abrir el archivo."}
      </p>
    </div>
  );
}
