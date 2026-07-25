"use client";

import { CheckCircle2, Clock, AlertTriangle, Calendar, ShieldCheck, ArrowDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export interface IncidentTimelineProps {
  status: "DETECTED" | "IN_REMEDIATION" | "AWAITING_EXTERNAL" | "CONFIRMED" | "RESOLVED" | "ESCALATED" | string;
  createdAt?: string | Date;
  resolvedAt?: string | Date | null;
  scheduledDate?: string | Date | null;
  remediationActionStatus?: string | null;
  serviceType?: string | null;
  resolution?: string | null;
}

export function IncidentTimeline({
  status,
  createdAt,
  resolvedAt,
  scheduledDate,
  remediationActionStatus,
  serviceType,
  resolution,
}: IncidentTimelineProps) {
  const steps = [
    {
      id: "DETECTED",
      title: "Incidente Detección",
      description: "Detectado por regla de lógica en workflow de operación",
      icon: AlertTriangle,
      completed: true,
      current: status === "DETECTED",
      color: "text-amber-500 bg-amber-50 dark:bg-amber-950/40 border-amber-200",
    },
    {
      id: "AWAITING_EXTERNAL",
      title: "Requerimiento de Servicio Externo",
      description: serviceType ? `Acción de gerencia requerida: ${serviceType}` : "Se requiere coordinar visita de proveedor normativo",
      icon: Clock,
      completed: ["AWAITING_EXTERNAL", "CONFIRMED", "RESOLVED"].includes(status),
      current: status === "AWAITING_EXTERNAL" || (status === "IN_REMEDIATION" && remediationActionStatus === "PENDING"),
      color: "text-blue-500 bg-blue-50 dark:bg-blue-950/40 border-blue-200",
    },
    {
      id: "CONFIRMED",
      title: "Cita Confirmada",
      description: scheduledDate
        ? `Visita programada para: ${new Date(scheduledDate).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}`
        : "Fecha de visita agendada por la gerencia",
      icon: Calendar,
      completed: ["CONFIRMED", "RESOLVED"].includes(status),
      current: status === "CONFIRMED",
      color: "text-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200",
    },
    {
      id: "RESOLVED",
      title: "Workflow Completado e Incidente Resuelto",
      description: resolution || "Certificado/verificación AI completada y validada en sistema",
      icon: ShieldCheck,
      completed: status === "RESOLVED",
      current: status === "RESOLVED",
      color: "text-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200",
    },
  ];

  return (
    <div className="space-y-4 py-2">
      <div className="relative pl-6 space-y-6 before:absolute before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-muted font-sans">
        {steps.map((step, idx) => {
          const StepIcon = step.icon;
          const isDone = step.completed;
          const isCurrent = step.current;

          return (
            <div key={step.id} className="relative flex items-start gap-3">
              {/* Dot Icon */}
              <div
                className={`absolute -left-6 top-0 w-6.5 h-6.5 rounded-full border flex items-center justify-center transition-all ${
                  isDone
                    ? "bg-emerald-500 text-white border-emerald-600 shadow-sm"
                    : isCurrent
                    ? step.color + " ring-4 ring-amber-500/20"
                    : "bg-muted text-muted-foreground border-border"
                }`}
              >
                {isDone ? <CheckCircle2 className="w-4 h-4" /> : <StepIcon className="w-3.5 h-3.5" />}
              </div>

              {/* Step Card */}
              <div className={`flex-1 p-3 rounded-lg border text-xs space-y-1 ${isCurrent ? "bg-muted/60 font-medium" : "bg-card"}`}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-foreground">{step.title}</span>
                  {isCurrent && (
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-300 text-[10px]">
                      Paso Actual
                    </Badge>
                  )}
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">{step.description}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
