"use client";

import { Suspense, useEffect, useState, useCallback, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  CashFlowCalendar,
  type CashFlowProjection,
} from "@/components/finance/cash-flow-calendar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useBranch } from "@/lib/branch-context";
import { useSession } from "@/hooks/use-session";
import { Calendar, Loader2, AlertCircle, RefreshCw, Repeat } from "lucide-react";

/** Horizontes ofrecidos. `days` fuera de esta lista cae al default. */
const HORIZONTES = [7, 30, 60] as const;
const HORIZONTE_DEFAULT = 30;

/**
 * Quién captura el saldo de la empresa. Esto sólo decide si se dibuja el
 * control: la ruta lo vuelve a exigir con `withRoleAuth`, que es donde manda.
 */
const PUEDEN_CAPTURAR = ["SUPER_ADMIN", "ADMIN", "GERENTE"];

/**
 * Quién puede pagar o reprogramar desde aquí. Mismo criterio que las rutas
 * `/api/expenses/[id]/pay` y `/reschedule`, que son las que de verdad mandan.
 */
const PUEDEN_ACCIONAR = ["SUPER_ADMIN", "ADMIN", "GERENTE"];

export default function CashFlowPage() {
  // `useSearchParams` exige límite de Suspense, como en purchase-orders.
  return (
    <Suspense>
      <CashFlowContent />
    </Suspense>
  );
}

function CashFlowContent() {
  // Scope único: el selector del encabezado del dashboard. El Select local
  // duplicaba el mismo control con otra respuesta y sin indicar cuál mandaba.
  const { selectedBranchId, setSelectedBranchId } = useBranch();
  const { session } = useSession();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // `null` mientras no hay payload: el componente exige el objeto completo. El
  // fallback de "arreglo legacy" que aceptaba antes vaciaba cuatro de las seis
  // secciones sin decir nada.
  const [projection, setProjection] = useState<CashFlowProjection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // El horizonte estaba fijo en 30 y editar la URL no hacía nada, porque la
  // página armaba la suya. Ahora vive en la URL: se puede mandar un enlace con
  // la vista exacta, y sobrevive al remonte.
  const diasPedidos = Number(searchParams.get("days"));
  const days = (HORIZONTES as readonly number[]).includes(diasPedidos)
    ? diasPedidos
    : HORIZONTE_DEFAULT;

  // Los contratos recurrentes proyectados se pueden apagar. Vive en la URL por
  // el mismo motivo que el horizonte: la vista se puede compartir y sobrevive
  // al remonte. Encendido por omisión — que la renta y la luz sean invisibles
  // hasta que llegue el recibo es el problema, no la preferencia.
  const mostrarRecurrentes = searchParams.get("recurring") !== "0";

  // La sucursal se sincroniza en un solo sentido por vez para no ciclarse:
  // al montar, una URL pegada manda sobre la cookie del encabezado; a partir de
  // ahí, el selector del encabezado escribe la URL.
  const [hidratado, setHidratado] = useState(false);
  const urlInicial = useRef(searchParams.get("branchId"));

  useEffect(() => {
    const deLaUrl = urlInicial.current;
    if (deLaUrl) {
      setSelectedBranchId(deLaUrl === "ALL" ? null : deLaUrl);
    }
    setHidratado(true);
    // Sólo al montar: es la hidratación inicial, no una sincronía continua.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const alcance = selectedBranchId ?? "ALL";

  // Espejo del estado de pantalla en la URL, ya hidratado. `replace` y no
  // `push`: cambiar de horizonte no debería llenar el historial del navegador.
  useEffect(() => {
    if (!hidratado) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("days", String(days));
    params.set("branchId", alcance);
    // Sólo se escribe cuando está apagado: el default no ensucia la URL ni el
    // enlace que alguien comparta.
    if (mostrarRecurrentes) params.delete("recurring");
    else params.set("recurring", "0");
    const nueva = `${pathname}?${params.toString()}`;
    if (nueva !== `${pathname}?${searchParams.toString()}`) {
      router.replace(nueva, { scroll: false });
    }
  }, [hidratado, days, alcance, mostrarRecurrentes, pathname, router, searchParams]);

  const fetchProjection = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL("/api/finance/cash-flow", window.location.origin);
      url.searchParams.set("days", String(days));
      if (alcance !== "ALL") {
        url.searchParams.set("branchId", alcance);
      }
      if (!mostrarRecurrentes) {
        url.searchParams.set("recurring", "0");
      }
      const res = await fetch(url.toString());
      const json = await res.json();
      if (res.ok && json.success) {
        setProjection(json.data ?? null);
      } else {
        setError(json?.error || "No se pudo calcular la proyección de flujo de efectivo.");
        setProjection(null);
      }
    } catch (err) {
      console.error("Failed to load cash flow projection:", err);
      setError("Error de conexión al calcular la proyección. Revisa tu red e intenta de nuevo.");
      setProjection(null);
    } finally {
      setLoading(false);
    }
  }, [alcance, days, mostrarRecurrentes]);

  useEffect(() => {
    // Se espera a la hidratación para no pedir dos veces la proyección: una con
    // la sucursal de la cookie y otra con la de la URL.
    if (!hidratado) return;
    fetchProjection();
  }, [hidratado, fetchProjection]);

  const cambiarHorizonte = (nuevos: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("days", String(nuevos));
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const alternarRecurrentes = () => {
    const params = new URLSearchParams(searchParams.toString());
    if (mostrarRecurrentes) params.set("recurring", "0");
    else params.delete("recurring");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            {/* "Panel de Alerta Temprana de Tesorería" aterrizaba en la
                anti-referencia que prohíbe PRODUCT.md, cuatro líneas arriba del
                comentario que rechaza "runway" por ser vocabulario ajeno. */}
            <Calendar className="h-7 w-7 text-primary" /> Flujo de efectivo
          </h1>
          <p className="text-sm text-muted-foreground">
            {/* "facturas vencidas" era falso: los vencidos se construyen sólo de
                gastos operativos y nunca contienen una factura. */}
            ¿Me alcanza? · ¿En qué gasto? · ¿Qué semanas son críticas? · ¿Qué gastos están vencidos?
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Un interruptor y no un filtro con opciones: la pregunta es binaria
              —¿cuento lo que sé que viene, o sólo lo capturado?— y presentarla
              como lista invitaría a buscar una tercera respuesta que no existe. */}
          <Button
            variant={mostrarRecurrentes ? "secondary" : "ghost"}
            size="sm"
            className="rounded-lg border"
            aria-pressed={mostrarRecurrentes}
            onClick={alternarRecurrentes}
            title={
              mostrarRecurrentes
                ? "Ocultar la renta, la luz y demás contratos recurrentes proyectados"
                : "Incluir la renta, la luz y demás contratos recurrentes proyectados"
            }
          >
            <Repeat className="w-4 h-4 mr-2" />
            Recurrentes
          </Button>

          <div
            className="flex items-center gap-1 rounded-lg border p-1"
            role="group"
            aria-label="Horizonte de proyección"
          >
            {HORIZONTES.map((opcion) => (
              <Button
                key={opcion}
                variant={opcion === days ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={opcion === days}
                onClick={() => cambiarHorizonte(opcion)}
              >
                {opcion} días
              </Button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="py-12 flex justify-center text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Analizando flujo de efectivo...
        </div>
      ) : error ? (
        <EmptyState
          icon={AlertCircle}
          title="No se pudo calcular el flujo de efectivo"
          description={error}
          action={
            <Button variant="outline" size="sm" onClick={fetchProjection}>
              <RefreshCw className="w-4 h-4 mr-2" /> Reintentar
            </Button>
          }
        />
      ) : !projection ? (
        <EmptyState
          icon={Calendar}
          title="Sin proyección"
          description="La consulta no devolvió datos de flujo de efectivo."
          action={
            <Button variant="outline" size="sm" onClick={fetchProjection}>
              <RefreshCw className="w-4 h-4 mr-2" /> Reintentar
            </Button>
          }
        />
      ) : (
        <CashFlowCalendar
          projection={projection}
          horizonDays={days}
          canEditAssumptions={PUEDEN_CAPTURAR.includes(session?.user?.role ?? "")}
          onAssumptionSaved={fetchProjection}
          canActOnExpenses={PUEDEN_ACCIONAR.includes(session?.user?.role ?? "")}
          // Revalida sin recargar: tras pagar, el saldo mínimo y los totales se
          // recalculan solos.
          onActionDone={fetchProjection}
        />
      )}
    </div>
  );
}
