"use client";

import * as React from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Copy,
  Check,
  Building2,
  User,
  Clock,
  FileText,
  Layers,
  Plus,
  Minus,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

export interface AuditRecord {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValue: unknown;
  newValue: unknown;
  performedBy: string;
  performedAt: string;
  reason: string | null;
  branchId: string;
  metadata?: Record<string, unknown>;
}

interface AuditDetailDrawerProps {
  log: AuditRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchName?: string;
  actionLabel?: string;
  actionVariant?: "default" | "secondary" | "destructive" | "outline";
  entityLabel?: string;
}

function formatPrimitive(val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (typeof val === "boolean") return val ? "Sí" : "No";
  if (typeof val === "number") return val.toLocaleString("es-MX");
  if (typeof val === "object") {
    try {
      return JSON.stringify(val);
    } catch {
      return "—";
    }
  }
  return String(val);
}

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

export function AuditDetailDrawer({
  log,
  open,
  onOpenChange,
  branchName,
  actionLabel,
  actionVariant = "outline",
  entityLabel,
}: AuditDetailDrawerProps) {
  const [copied, setCopied] = React.useState(false);

  if (!log) return null;

  const handleCopyRawJson = () => {
    try {
      navigator.clipboard.writeText(JSON.stringify(log, null, 2));
      setCopied(true);
      toast.success("Registro de auditoría copiado al portapapeles");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("No se pudo copiar el JSON");
    }
  };

  const formattedDate = new Date(log.performedAt).toLocaleString("es-MX", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const oldObj = isObject(log.oldValue) ? log.oldValue : null;
  const newObj = isObject(log.newValue) ? log.newValue : null;

  // Build key differences if both are objects
  const diffKeys = React.useMemo(() => {
    if (!oldObj && !newObj) return [];
    const keys = new Set([...Object.keys(oldObj || {}), ...Object.keys(newObj || {})]);
    return Array.from(keys);
  }, [oldObj, newObj]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl p-0 flex flex-col h-full bg-background border-l border-border"
      >
        <SheetHeader className="p-6 pb-4 border-b border-border/60 bg-muted/20">
          <div className="flex items-center justify-between gap-2 pr-6">
            <div className="flex items-center gap-2">
              <Badge variant={actionVariant} className="text-xs font-medium">
                {actionLabel || log.action}
              </Badge>
              <Badge variant="outline" className="text-xs">
                {entityLabel || log.entityType}
              </Badge>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyRawJson}
              className="h-7 text-xs gap-1.5 px-2"
              title="Copiar JSON completo"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copied ? "Copiado" : "Copiar JSON"}</span>
            </Button>
          </div>

          <SheetTitle className="text-base font-semibold text-foreground mt-2">
            Detalle de Auditoría
          </SheetTitle>
          <SheetDescription className="text-xs font-mono text-muted-foreground break-all">
            ID: {log.id}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 px-6 py-4">
          <div className="space-y-6">
            {/* Operational Context Cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg border border-border/60 bg-card space-y-1">
                <div className="text-xs text-muted-foreground flex items-center gap-1.5 font-medium">
                  <Building2 className="h-3.5 w-3.5" />
                  Sucursal
                </div>
                <div className="text-sm font-semibold text-foreground">
                  {branchName || log.branchId}
                </div>
              </div>

              <div className="p-3 rounded-lg border border-border/60 bg-card space-y-1">
                <div className="text-xs text-muted-foreground flex items-center gap-1.5 font-medium">
                  <User className="h-3.5 w-3.5" />
                  Realizado por
                </div>
                <div className="text-sm font-semibold text-foreground truncate" title={log.performedBy}>
                  {log.performedBy}
                </div>
              </div>

              <div className="p-3 rounded-lg border border-border/60 bg-card space-y-1">
                <div className="text-xs text-muted-foreground flex items-center gap-1.5 font-medium">
                  <Layers className="h-3.5 w-3.5" />
                  ID de Entidad
                </div>
                <div className="text-xs font-mono font-medium text-foreground truncate" title={log.entityId || "—"}>
                  {log.entityId || "—"}
                </div>
              </div>

              <div className="p-3 rounded-lg border border-border/60 bg-card space-y-1">
                <div className="text-xs text-muted-foreground flex items-center gap-1.5 font-medium">
                  <Clock className="h-3.5 w-3.5" />
                  Fecha y Hora
                </div>
                <div className="text-xs font-medium text-foreground">
                  {formattedDate}
                </div>
              </div>
            </div>

            {/* Motivo de la acción */}
            <div className="p-3.5 rounded-lg border border-border/60 bg-muted/20 space-y-1.5">
              <div className="text-xs text-muted-foreground flex items-center gap-1.5 font-medium">
                <FileText className="h-3.5 w-3.5" />
                Motivo u Observación
              </div>
              <p className="text-xs text-foreground leading-relaxed">
                {log.reason || "Sin motivo especificado en el registro."}
              </p>
            </div>

            <Separator />

            {/* Change Inspection / Diff Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  Inspección de Cambios
                </h4>
                <span className="text-xs text-muted-foreground">
                  {log.action === "CREATE"
                    ? "Registro nuevo"
                    : log.action === "DELETE"
                    ? "Registro eliminado"
                    : "Comparación de valores"}
                </span>
              </div>

              {/* Case 1: Structured object diff for UPDATE */}
              {log.action === "UPDATE" && (oldObj || newObj) ? (
                <div className="space-y-2.5">
                  {diffKeys.length === 0 ? (
                    <div className="text-xs text-muted-foreground italic">
                      No se detectaron campos modificados estructurados.
                    </div>
                  ) : (
                    diffKeys.map((key) => {
                      const oldVal = oldObj ? oldObj[key] : undefined;
                      const newVal = newObj ? newObj[key] : undefined;
                      const hasChanged = JSON.stringify(oldVal) !== JSON.stringify(newVal);

                      return (
                        <div
                          key={key}
                          className={`p-3 rounded-lg border text-xs transition-colors ${
                            hasChanged
                              ? "border-border bg-muted/30"
                              : "border-border/40 bg-card opacity-70"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="font-mono font-semibold text-foreground">
                              {key}
                            </span>
                            {hasChanged ? (
                              <Badge variant="outline" className="text-xs h-5 py-0 text-primary border-primary/30 font-medium">
                                Modificado
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">Sin cambio</span>
                            )}
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                            {/* Valor anterior */}
                            <div className="p-2 rounded bg-destructive/10 border border-destructive/20 text-destructive-foreground">
                              <div className="text-xs uppercase font-medium flex items-center gap-1 text-destructive mb-1">
                                <Minus className="h-3 w-3" /> Anterior
                              </div>
                              <div className="font-mono text-xs break-all text-foreground">
                                {formatPrimitive(oldVal)}
                              </div>
                            </div>

                            {/* Valor nuevo */}
                            <div className="p-2 rounded bg-success/10 border border-success/20">
                              <div className="text-xs uppercase font-medium flex items-center gap-1 text-success mb-1">
                                <Plus className="h-3 w-3" /> Nuevo
                              </div>
                              <div className="font-mono text-xs break-all text-foreground font-medium">
                                {formatPrimitive(newVal)}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              ) : log.action === "CREATE" && newObj ? (
                /* Case 2: Structured attributes for CREATE */
                <div className="space-y-2">
                  <div className="grid grid-cols-1 gap-2">
                    {Object.entries(newObj).map(([key, val]) => (
                      <div
                        key={key}
                        className="p-2.5 rounded-lg border border-border/60 bg-card flex items-start justify-between gap-4 text-xs"
                      >
                        <span className="font-mono font-medium text-muted-foreground">{key}</span>
                        <span className="font-mono text-foreground font-semibold text-right break-all">
                          {formatPrimitive(val)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : log.action === "DELETE" && oldObj ? (
                /* Case 3: Structured attributes for DELETE */
                <div className="space-y-2">
                  <div className="grid grid-cols-1 gap-2">
                    {Object.entries(oldObj).map(([key, val]) => (
                      <div
                        key={key}
                        className="p-2.5 rounded-lg border border-destructive/20 bg-destructive/5 flex items-start justify-between gap-4 text-xs"
                      >
                        <span className="font-mono font-medium text-muted-foreground">{key}</span>
                        <span className="font-mono text-foreground line-through text-right break-all">
                          {formatPrimitive(val)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                /* Case 4: Primitive or non-object values */
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg border border-border/60 bg-muted/20 space-y-1">
                    <div className="text-xs text-muted-foreground font-medium">Valor Anterior</div>
                    <div className="font-mono text-xs break-all text-foreground">
                      {formatPrimitive(log.oldValue)}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg border border-border/60 bg-muted/20 space-y-1">
                    <div className="text-xs text-muted-foreground font-medium">Valor Nuevo</div>
                    <div className="font-mono text-xs break-all text-foreground font-semibold">
                      {formatPrimitive(log.newValue)}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Metadata section if present */}
            {log.metadata && Object.keys(log.metadata).length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Metadatos del Sistema
                  </h4>
                  <pre className="p-3 rounded-lg bg-muted/40 border border-border text-xs font-mono overflow-x-auto text-muted-foreground">
                    {JSON.stringify(log.metadata, null, 2)}
                  </pre>
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
