import { Suspense } from "react";
import { Loader2, Percent } from "lucide-react";
import { requireRole } from "@/lib/rbac/require-role";
import { CommissionsByChannelTable } from "@/components/finance/commissions-by-channel-table";
import { CommissionRatesPanel } from "@/components/finance/commission-rates-panel";

/**
 * Comisiones por canal y sus tarifas.
 *
 * Por qué existe la pantalla y no sólo el renglón del P&L: en el P&L las
 * comisiones son un importe único, y con un importe único no se decide nada. La
 * pregunta real —"¿me conviene Rappi?"— es una comparación entre canales: qué
 * venta entra por cada uno y cuánto de esa venta se queda el intermediario.
 *
 * Y por qué la configuración de tarifas vive aquí y no en Objetivos de Costo:
 * la tarifa no es una meta, es el insumo que hace existir el cálculo. Ponerla en
 * otra pantalla dejaría este tablero vacío sin decir qué falta para llenarlo.
 *
 * El alcance por rol lo aplica la ruta (`resolveBranchScope`), no esta página;
 * el acceso al módulo lo aplica `proxy.ts` con la entrada `/dashboard/finance`.
 */
export const metadata = {
  title: "Comisiones por Canal | Pulso",
  description:
    "Lo que se queda cada agregador y la terminal, con la tarifa vigente en la fecha de cada corte.",
};

export default async function CommissionsPage() {
  // La escritura de tarifas es de dirección: la tasa multiplica el volumen del
  // mes de todas las sucursales, así que cambiarla mueve el P&L del grupo. La
  // ruta lo vuelve a comprobar — esto sólo decide si se pinta el formulario.
  const { userRole } = await requireRole(["SUPER_ADMIN", "ADMIN", "GERENTE", "SUPERVISOR"]);
  const canEdit = userRole === "SUPER_ADMIN" || userRole === "ADMIN";

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Percent className="h-7 w-7 text-primary" /> Comisiones por Canal
        </h1>
        <p className="text-sm text-muted-foreground max-w-[75ch]">
          Cuánto se queda cada agregador y cuánto la terminal, contra la venta que entra por cada
          canal. Es un cálculo con tu tarifa negociada, no un importe medido: el sistema no tiene el
          monto neto de ninguna liquidación, así que el renglón del P&amp;L viaja marcado como
          estimado.
        </p>
      </div>

      {/* `useSearchParams` (el rango de fechas del encabezado) exige un límite
          de Suspense o el prerender de la ruta falla en build. */}
      <Suspense
        fallback={
          <div className="py-12 flex justify-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> Cargando comisiones...
          </div>
        }
      >
        <CommissionsByChannelTable />
      </Suspense>

      <CommissionRatesPanel canEdit={canEdit} />
    </div>
  );
}
