"use client";

import { Badge } from "@/components/ui/badge";
import { formatCents, statusBadgeClasses } from "@/lib/utils";
import {
  CheckCircle2,
  Clock,
  UserCheck,
  ShieldAlert,
  Banknote,
  Copy,
  FileWarning,
  FileX,
  Repeat,
  Scissors,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

export interface Violation {
  id: string;
  type:
    | "SELF_APPROVAL"
    | "OVERDUE_APPROVAL"
    | "ROLE_MISMATCH"
    | "CONTRACT_VARIANCE_EXCEEDED"
    | "CONTRACT_VARIANCE_BELOW"
    | "CONTRACT_TREND_RISING"
    | "RECURRING_SHORTAGE"
    | "SPLIT_PURCHASE"
    | "DUPLICATE_PAYMENT"
    | "NON_DEDUCTIBLE_CASH"
    | "CFDI_CANCELADO";
  severity: "LOW" | "MEDIUM" | "HIGH";
  /** `null` cuando la excepcion no nace de un gasto (faltantes recurrentes). */
  expenseId: string | null;
  branchName: string;
  category: string;
  amountCents: number;
  description: string;
  detail: string;
  createdAt: string;
}

interface ExcepcionesPanelProps {
  violations: Violation[];
  loading: boolean;
  /**
   * Días que cubre la detección de desviaciones de contrato recurrente.
   *
   * Se declara en pantalla porque sin ella "sin excepciones" no dice nada:
   * quien lee esta lista tiene que saber qué período se analizó. `null`
   * mientras la respuesta no lo traiga.
   */
  contractWindowDays?: number | null;
  /**
   * Días que cubre la detección de excepciones de **gasto** (A5.1).
   *
   * Es una ventana distinta de la de contratos y se declara por la misma razón:
   * antes el detector traía el histórico completo de la empresa a memoria en
   * cada carga, y ahora mira 90 días por omisión. Quien lee "sin excepciones"
   * tiene derecho a saber sobre qué período se afirma.
   */
  windowDays?: number | null;
}

const VIOLATION_ICONS: Record<string, React.ReactNode> = {
  SELF_APPROVAL: <UserCheck className="w-4 h-4" />,
  OVERDUE_APPROVAL: <Clock className="w-4 h-4" />,
  ROLE_MISMATCH: <ShieldAlert className="w-4 h-4" />,
  CONTRACT_VARIANCE_EXCEEDED: <FileWarning className="w-4 h-4 text-warning-text" />,
  CONTRACT_VARIANCE_BELOW: <TrendingDown className="w-4 h-4 text-muted-foreground" />,
  CONTRACT_TREND_RISING: <TrendingUp className="w-4 h-4 text-warning-text" />,
  RECURRING_SHORTAGE: <Repeat className="w-4 h-4 text-destructive" />,
  SPLIT_PURCHASE: <Scissors className="w-4 h-4 text-warning-text" />,
  DUPLICATE_PAYMENT: <Copy className="w-4 h-4 text-destructive" />,
  NON_DEDUCTIBLE_CASH: <Banknote className="w-4 h-4 text-warning-text" />,
  CFDI_CANCELADO: <FileX className="w-4 h-4 text-destructive" />,
};

const VIOLATION_TITLES: Record<string, string> = {
  SELF_APPROVAL: "Auto-aprobación",
  OVERDUE_APPROVAL: "Pendiente >48h",
  ROLE_MISMATCH: "Rol insuficiente",
  CONTRACT_VARIANCE_EXCEEDED: "Sobrecosto vs Contrato",
  CONTRACT_VARIANCE_BELOW: "Recibo bajo vs Contrato",
  CONTRACT_TREND_RISING: "Consumo al alza",
  RECURRING_SHORTAGE: "Faltantes recurrentes",
  // Los títulos son cortos porque van en un badge; el "por qué importa" vive en
  // `detail`, que es donde alguien lo lee cuando decide investigar.
  SPLIT_PURCHASE: "Posible fraccionamiento",
  DUPLICATE_PAYMENT: "Posible pago duplicado",
  NON_DEDUCTIBLE_CASH: "Efectivo no deducible",
  CFDI_CANCELADO: "CFDI cancelado",
};

// Tonos del sistema en vez de paleta cruda: `bg-red-50` no tiene contraparte
// `dark:`, así que una violación HIGH se pintaba como una losa casi blanca sobre
// el `--card` oscuro — el estado más grave, el menos legible.
const SEVERITY_TONES: Record<string, Parameters<typeof statusBadgeClasses>[0]> = {
  HIGH: "destructive",
  MEDIUM: "warning",
  LOW: "info",
};

const SEVERITY_SURFACES: Record<string, string> = {
  HIGH: "border-destructive/30 bg-destructive/5",
  MEDIUM: "border-warning/30 bg-warning/5",
  LOW: "border-info/30 bg-info/5",
};

export function ExcepcionesPanel({
  violations,
  loading,
  contractWindowDays,
  windowDays,
}: ExcepcionesPanelProps) {
  // `null` cuando ninguna de las dos ventanas llegó: los dos sitios donde se
  // pinta hacen `ventana ? <div…> : null`, y un fragmento vacío sí es truthy —
  // dejaría un separador con margen sobre nada.
  const ventana =
    typeof windowDays !== "number" && typeof contractWindowDays !== "number" ? null : (
    <>
      {typeof windowDays === "number" ? (
        <p className="text-xs text-muted-foreground">
          Las excepciones de gasto se buscan sobre los últimos {windowDays} días. Un gasto anterior
          a esa ventana deja de aparecer aquí, aunque siga sin resolverse.
        </p>
      ) : null}
      {typeof contractWindowDays === "number" ? (
        <p className="text-xs text-muted-foreground">
          Las desviaciones de contrato recurrente se miden sobre las facturas de los últimos{" "}
          {contractWindowDays} días. Una factura que sale de esa ventana deja de aparecer aquí. En
          servicios medidos (luz, agua) la referencia es la mediana de los recibos anteriores de esa
          sucursal; el detalle de cada excepción dice cuál se usó.
        </p>
      ) : null}
    </>
  );

  if (loading) {
    return (
      <div className="py-8 text-center text-xs text-muted-foreground">
        Analizando excepciones...
      </div>
    );
  }

  if (violations.length === 0) {
    return (
      // El "todo en orden" llevaba un `AlertTriangle` teñido de verde: el ícono de
      // advertencia usado como ícono de tranquilidad. Aquí va una palomita.
      <div className="py-10 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-success/10 mb-3">
          <CheckCircle2 className="w-6 h-6 text-success" />
        </div>
        <p className="text-sm font-medium">Sin excepciones detectadas</p>
        <p className="text-xs text-muted-foreground mt-1">
          Todos los gastos analizados cumplen con las políticas de control interno.
        </p>
        {ventana ? <div className="mt-3">{ventana}</div> : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {violations.map((v) => (
        <div
          key={v.id}
          className={`border rounded-lg p-3 ${SEVERITY_SURFACES[v.severity] || "border-border"}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <span className="mt-0.5 text-muted-foreground shrink-0">
                {VIOLATION_ICONS[v.type]}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold">
                    {VIOLATION_TITLES[v.type] || v.type}
                  </span>
                  <Badge
                    variant="outline"
                    className={`text-xs px-1.5 py-0 ${statusBadgeClasses(SEVERITY_TONES[v.severity] ?? "neutral")}`}
                  >
                    {v.severity === "HIGH" ? "Crítico" : v.severity === "MEDIUM" ? "Precaución" : "Bajo"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{v.detail}</p>
                <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                  <span className="font-medium">{v.branchName}</span>
                  <span>·</span>
                  <span>{v.category}</span>
                  <span>·</span>
                  <span className="font-bold tabular-nums">{formatCents(v.amountCents)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
      {ventana ? <div className="pt-3 border-t">{ventana}</div> : null}
    </div>
  );
}
