"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Clock, UserCheck, ShieldAlert } from "lucide-react";

export interface Violation {
  id: string;
  type: "SELF_APPROVAL" | "OVERDUE_APPROVAL" | "ROLE_MISMATCH";
  severity: "LOW" | "MEDIUM" | "HIGH";
  expenseId: string;
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
};

const VIOLATION_TITLES: Record<string, string> = {
  SELF_APPROVAL: "Auto-aprobación",
  OVERDUE_APPROVAL: "Pendiente >48h",
  ROLE_MISMATCH: "Rol insuficiente",
};

const SEVERITY_COLORS: Record<string, string> = {
  HIGH: "border-red-300 bg-red-50",
  MEDIUM: "border-amber-300 bg-amber-50",
  LOW: "border-blue-300 bg-blue-50",
};

const SEVERITY_BADGES: Record<string, string> = {
  HIGH: "bg-red-100 text-red-700",
  MEDIUM: "bg-amber-100 text-amber-700",
  LOW: "bg-blue-100 text-blue-700",
};

function formatMXN(cents: number) {
  return (cents / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

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
      <div className="py-10 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-100 mb-3">
          <AlertTriangle className="w-6 h-6 text-emerald-600" />
        </div>
        <p className="text-sm font-medium">Sin excepciones detectadas</p>
        <p className="text-xs text-muted-foreground mt-1">
          Todos los gastos cumplen con las políticas de control interno.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {violations.map((v) => (
        <div
          key={v.id}
          className={`border rounded-lg p-3 ${SEVERITY_COLORS[v.severity] || "border-gray-200"}`}
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
                    className={`text-[10px] px-1.5 py-0 h-4 ${SEVERITY_BADGES[v.severity]}`}
                  >
                    {v.severity === "HIGH" ? "Crítico" : v.severity === "MEDIUM" ? "Precaución" : "Bajo"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{v.detail}</p>
                <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground">
                  <span className="font-medium">{v.branchName}</span>
                  <span>·</span>
                  <span>{v.category}</span>
                  <span>·</span>
                  <span className="font-bold">{formatMXN(v.amountCents)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
