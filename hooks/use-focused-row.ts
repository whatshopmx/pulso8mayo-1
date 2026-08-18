"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Resalta y desplaza hacia la fila que llega en `?focus=<id>`.
 *
 * Existe porque el panel de flujo de efectivo enlaza cada hallazgo a su
 * registro origen. Sin esto, "tienes 6 gastos vencidos" obligaba a salir de la
 * pantalla, abrir la lista y buscar a mano por una descripción truncada.
 *
 * `useSearchParams` exige un límite de `Suspense` en la página que lo usa, como
 * ya hacía `purchase-orders`. La alternativa —leer `window.location.search` en
 * un efecto— evitaba ese requisito pero obligaba a un `setState` dentro del
 * efecto, con el render en cascada y el desajuste de hidratación que eso trae.
 */
export function useFocusedRow() {
  const focusId = useSearchParams().get("focus");
  const ref = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    if (!focusId || !ref.current) return;
    ref.current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusId]);

  /**
   * Props de la fila. Recibe la clase base y la fusiona, para que la llamada
   * sea un solo spread y no haya dos `className` peleándose en el JSX.
   *
   * `aria-current` para que un lector de pantalla anuncie cuál es la fila a la
   * que se llegó: el resaltado por color solo no se anuncia.
   */
  const focusProps = (id: string, baseClassName = "") =>
    id === focusId
      ? {
          ref,
          "aria-current": "true" as const,
          className: `${baseClassName} bg-primary/10 ring-2 ring-primary/40 ring-inset`.trim(),
        }
      : { className: baseClassName };

  return { focusId, focusProps };
}
