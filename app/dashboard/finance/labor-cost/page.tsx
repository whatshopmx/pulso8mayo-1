import Link from "next/link";
import { LaborCostTable } from "@/components/finance/labor-cost-table";
import { Users, Target } from "lucide-react";

/**
 * Costo laboral por sucursal.
 *
 * `labor-cost-service` ya calculaba esto para el P&L, pero el número quedaba
 * enterrado como un renglón más de la utilidad operativa. Aquí es el sujeto:
 * la comparación entre sucursales es la que decide dónde hay un problema de
 * plantilla, y el P&L no la deja ver.
 *
 * No lleva alerta de horas extra a propósito: `LaborCalculator` clasifica hoy
 * la jornada completa como hora extra (ver la nota @deprecated en
 * `calculateOvertimeCost`), y una alerta construida sobre ese cálculo mandaría
 * un WhatsApp equivocado. Llega con PL4 de `plan-pnl-real.md`.
 *
 * El alcance por rol lo aplica la ruta (`resolveBranchScope`), no esta página.
 */
export const metadata = {
  title: "Costo Laboral | Pulso",
  description: "Nómina bruta sobre venta neta por sucursal, contra el objetivo del grupo.",
};

export default function LaborCostPage() {
  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-7 w-7 text-primary" /> Costo Laboral
          </h1>
          <p className="text-sm text-muted-foreground max-w-[70ch]">
            Cuánto de cada peso vendido se va en nómina, sucursal por sucursal. Cada renglón
            declara si el ratio salió de la asistencia capturada o de la plantilla contratada:
            no valen lo mismo para decidir.
          </p>
        </div>

        <Link
          href="/dashboard/company/operating-config"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 shrink-0"
        >
          <Target className="w-3.5 h-3.5" /> Ajustar objetivo de costo laboral
        </Link>
      </div>

      <LaborCostTable />
    </div>
  );
}
