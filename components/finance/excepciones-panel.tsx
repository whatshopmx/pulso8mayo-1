"use client";

import { Badge } from "@/components/ui/badge";
import { formatCents, statusBadgeClasses } from "@/lib/utils";
import {
  CheckCircle2,
  Clock,
  UserCheck,
  ShieldAlert,
  FileWarning,
  Repeat,
  TrendingDown,
} from "lucide-react";

export interface Violation {
  id: string;
  type:
    | "SELF_APPROVAL"
    | "OVERDUE_APPROVAL"
    | "ROLE_MISMATCH"
    | "CONTRACT_VARIANCE_EXCEEDED"
    | "CONTRACT_VARIANCE_BELOW"
    | "RECURRING_SHORTAGE";
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
}

const VIOLATION_ICONS: Record<string, React.ReactNode> = {
  SELF_APPROVAL: <UserCheck className="w-4 h-4" />,
  OVERDUE_APPROVAL: <Clock className="w-4 h-4" />,
  ROLE_MISMATCH: <ShieldAlert className="w-4 h-4" />,
  CONTRACT_VARIANCE_EXCEEDED: <FileWarning className="w-4 h-4 text-warning-text" />,
  CONTRACT_VARIANCE_BELOW: <TrendingDown className="w-4 h-4 text-muted-foreground" />,
  RECURRING_SHORTAGE: <Repeat className="w-4 h-4 text-destructive" />,
};

const VIOLATION_TITLES: Record<string, string> = {
  SELF_APPROVAL: "Auto-aprobación",
  OVERDUE_APPROVAL: "Pendiente >48h",
  ROLE_MISMATCH: "Rol insuficiente",
  CONTRACT_VARIANCE_EXCEEDED: "Sobrecosto vs Contrato",
  CONTRACT_VARIANCE_BELOW: "Recibo bajo vs Contrato",
  RECURRING_SHORTAGE: "Faltantes recurrentes",
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

export function ExcepcionesPanel({ violations, loading }: ExcepcionesPanelProps) {
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
    </div>
  );
}
