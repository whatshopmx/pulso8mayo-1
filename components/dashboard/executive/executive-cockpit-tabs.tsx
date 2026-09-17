"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  ExecutiveCockpitHeader,
  type ExecutiveViewMode,
  type VitalSignsData,
} from "./executive-cockpit-header";

interface ExecutiveCockpitTabsProps {
  companyName: string;
  data: VitalSignsData;
  /** Vista resuelta en el servidor a partir de `?view=` (soporta enlaces directos). */
  initialView: ExecutiveViewMode;
  cockpit: ReactNode;
  economics: ReactNode;
  liquidity: ReactNode;
}

function normalizeView(value: string | null | undefined): ExecutiveViewMode {
  return value === "economics" || value === "liquidity" ? value : "cockpit";
}

function readViewFromLocation(): ExecutiveViewMode {
  if (typeof window === "undefined") return "cockpit";
  return normalizeView(new URL(window.location.href).searchParams.get("view"));
}

/**
 * Coordinador de las 3 vistas estratégicas de la cabina ejecutiva.
 *
 * `page.tsx` precarga los modelos (Twin, ranking, brief) en una sola pasada de
 * servidor y los entrega ya renderizados como `children`. El cambio de vista es
 * estado de React: 0 ms, sin pantalla blanca y sin volver a consultar Postgres.
 * La URL se mantiene compartible con `history.replaceState` (sin navegación RSC).
 */
export function ExecutiveCockpitTabs({
  companyName,
  data,
  initialView,
  cockpit,
  economics,
  liquidity,
}: ExecutiveCockpitTabsProps) {
  const [view, setView] = useState<ExecutiveViewMode>(initialView);
  // Las vistas visitadas permanecen montadas: alternar es sólo visibilidad CSS.
  const [visited, setVisited] = useState<ReadonlySet<ExecutiveViewMode>>(
    () => new Set<ExecutiveViewMode>([initialView])
  );

  const selectView = useCallback((value: string) => {
    const next = normalizeView(value);
    setView(next);
    setVisited((previous) => (previous.has(next) ? previous : new Set([...previous, next])));

    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    // History nativo: conserva el enlace directo sin disparar una navegación RSC.
    window.history.replaceState(null, "", url);
  }, []);

  useEffect(() => {
    // Atrás/adelante del navegador: re-sincroniza la vista con la URL real.
    const syncFromHistory = () => setView(readViewFromLocation());
    window.addEventListener("popstate", syncFromHistory);
    return () => window.removeEventListener("popstate", syncFromHistory);
  }, []);

  useEffect(() => {
    // Atajos de teclado 1/2/3 para alternar los 3 modos de decisión sin
    // abandonar el teclado. Se ignoran modificadores y campos de texto para
    // no secuestrar la escritura del copiloto.
    const SHORTCUTS: Readonly<Record<string, ExecutiveViewMode>> = {
      "1": "cockpit",
      "2": "economics",
      "3": "liquidity",
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const next = SHORTCUTS[event.key];
      if (next) {
        event.preventDefault();
        selectView(next);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectView]);

  const panes: ReadonlyArray<readonly [ExecutiveViewMode, ReactNode]> = [
    ["cockpit", cockpit],
    ["economics", economics],
    ["liquidity", liquidity],
  ];

  return (
    <Tabs value={view} onValueChange={selectView} className="min-w-0 gap-6">
      <ExecutiveCockpitHeader companyName={companyName} data={data} />
      {panes.map(([value, content]) => (
        <TabsContent
          key={value}
          value={value}
          forceMount={visited.has(value) ? true : undefined}
          hidden={view !== value}
          className="min-w-0 space-y-6"
        >
          {content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
