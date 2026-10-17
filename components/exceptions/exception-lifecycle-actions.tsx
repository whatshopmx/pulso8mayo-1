"use client";

import { useState } from "react";
import { Clock, ShieldCheck, UserCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
  allowedEvents,
  type ExceptionEvent,
  type ExceptionStatus,
} from "@/lib/services/exception-lifecycle";
import type { GroupExceptionLifecycle } from "@/lib/services/group-exceptions-service";

const STATUS_LABELS: Record<ExceptionStatus, string> = {
  OPEN: "Abierta",
  ASSIGNED: "Asignada",
  IN_ACTION: "En acción",
  RESOLVED: "Resuelta",
  VERIFIED: "Verificada",
  CLOSED: "Cerrada",
  REOPENED: "Reabierta",
  ESCALATED: "Escalada",
  CANCELLED: "Cancelada",
};

interface EventMeta {
  label: string;
  path: string;
  input: "none" | "owner" | "text";
  field?: "resolution" | "reason";
  placeholder?: string;
  required: boolean;
}

const EVENT_META: Record<ExceptionEvent, EventMeta> = {
  ASSIGN: { label: "Asignar", path: "assign", input: "owner", required: true },
  START_ACTION: { label: "Iniciar acción", path: "start-action", input: "none", required: false },
  RESOLVE: {
    label: "Resolver",
    path: "resolve",
    input: "text",
    field: "resolution",
    placeholder: "¿Qué se hizo para corregirlo?",
    required: true,
  },
  VERIFY: { label: "Verificar", path: "verify", input: "none", required: false },
  CLOSE: { label: "Cerrar", path: "close", input: "none", required: false },
  REOPEN: {
    label: "Reabrir",
    path: "reopen",
    input: "text",
    field: "reason",
    placeholder: "¿Por qué se reabre?",
    required: true,
  },
  ESCALATE: {
    label: "Escalar",
    path: "escalate",
    input: "text",
    field: "reason",
    placeholder: "Motivo (opcional)",
    required: false,
  },
  CANCEL: {
    label: "Cancelar",
    path: "cancel",
    input: "text",
    field: "reason",
    placeholder: "Motivo (opcional)",
    required: false,
  },
};

/** Acción que domina cada estado; el resto queda como acción secundaria. */
const PRIMARY_EVENT: Partial<Record<ExceptionStatus, ExceptionEvent>> = {
  OPEN: "ASSIGN",
  ASSIGNED: "START_ACTION",
  IN_ACTION: "RESOLVE",
  RESOLVED: "VERIFY",
  VERIFIED: "CLOSE",
  REOPENED: "START_ACTION",
  ESCALATED: "RESOLVE",
};

export interface ExceptionLifecycleActionsProps {
  exceptionId: string;
  lifecycle: GroupExceptionLifecycle;
  onDone: () => void;
}

/**
 * Acciones de lifecycle canónico para una excepción del feed.
 *
 * Solo se ofrece lo que es legal desde el estado actual (`allowedEvents`, la
 * misma máquina de estados que aplica el servidor) — sin botones que el API
 * vaya a rechazar. La acción principal es la única en Operational Red; el resto
 * usa outline/ghost para respetar el presupuesto de color.
 */
export function ExceptionLifecycleActions({
  exceptionId,
  lifecycle,
  onDone,
}: ExceptionLifecycleActionsProps) {
  const [openEvent, setOpenEvent] = useState<ExceptionEvent | null>(null);
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const events = allowedEvents(lifecycle.status);
  const primary = PRIMARY_EVENT[lifecycle.status];
  const others = events.filter((e) => e !== primary);

  const slaPast =
    lifecycle.slaDueAt && new Date(lifecycle.slaDueAt).getTime() < Date.now();

  async function submit() {
    if (!openEvent) return;
    const meta = EVENT_META[openEvent];
    const trimmed = value.trim();
    if (meta.required && !trimmed) return;

    setSubmitting(true);
    try {
      const body =
        meta.input === "owner"
          ? { ownerId: trimmed }
          : meta.field
            ? { [meta.field]: trimmed }
            : {};

      const res = await fetch(`/api/exceptions/${exceptionId}/${meta.path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          json?.error?.message ?? "No se pudo completar la acción.",
        );
      }

      toast.success(`${meta.label}: listo`);
      setOpenEvent(null);
      setValue("");
      onDone();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo completar la acción.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2 shrink-0">
      <div className="flex items-center gap-1.5 flex-wrap justify-end">
        <Badge variant="outline" className="text-xs font-medium">
          {STATUS_LABELS[lifecycle.status]}
        </Badge>

        {lifecycle.ownerId ? (
          <Badge variant="outline" className="text-xs gap-1 text-muted-foreground">
            <UserCheck className="w-3 h-3" />
            Responsable
          </Badge>
        ) : (
          <Badge variant="outline" className="text-xs text-muted-foreground">
            Sin responsable
          </Badge>
        )}

        {lifecycle.slaDueAt && (
          <Badge
            variant="outline"
            className={
              slaPast
                ? "text-xs gap-1 border-destructive/30 bg-destructive/10 text-destructive"
                : "text-xs gap-1 text-muted-foreground"
            }
          >
            {slaPast ? (
              <Clock className="w-3 h-3" />
            ) : (
              <ShieldCheck className="w-3 h-3" />
            )}
            {slaPast
              ? "SLA vencido"
              : `Vence en ${formatDistanceToNow(new Date(lifecycle.slaDueAt), {
                  locale: es,
                })}`}
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap justify-end">
        {primary && (
          <Button
            size="sm"
            className="text-xs h-8"
            onClick={() => {
              setValue("");
              setOpenEvent(primary);
            }}
          >
            {EVENT_META[primary].label}
          </Button>
        )}
        {others.map((event) => (
          <Button
            key={event}
            variant="outline"
            size="sm"
            className="text-xs h-8"
            onClick={() => {
              setValue("");
              setOpenEvent(event);
            }}
          >
            {EVENT_META[event].label}
          </Button>
        ))}
      </div>

      <Dialog
        open={openEvent !== null}
        onOpenChange={(open) => {
          if (!open) {
            setOpenEvent(null);
            setValue("");
          }
        }}
      >
        <DialogContent>
          {openEvent && (
            <>
              <DialogHeader>
                <DialogTitle>{EVENT_META[openEvent].label}</DialogTitle>
                <DialogDescription>
                  {openEvent === "ASSIGN"
                    ? "Indica el id del usuario responsable de resolverla."
                    : "La acción queda registrada en la auditoría de la excepción."}
                </DialogDescription>
              </DialogHeader>

              {EVENT_META[openEvent].input === "owner" && (
                <div className="space-y-2">
                  <Label htmlFor="exception-owner">Responsable</Label>
                  <Input
                    id="exception-owner"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="Id de usuario"
                    autoFocus
                  />
                </div>
              )}

              {EVENT_META[openEvent].input === "text" && (
                <div className="space-y-2">
                  <Label htmlFor="exception-text">
                    {openEvent === "RESOLVE" ? "Resolución" : "Motivo"}
                  </Label>
                  <Textarea
                    id="exception-text"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={EVENT_META[openEvent].placeholder}
                    rows={3}
                    autoFocus
                  />
                </div>
              )}

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setOpenEvent(null);
                    setValue("");
                  }}
                  disabled={submitting}
                >
                  Cancelar
                </Button>
                <Button
                  onClick={submit}
                  disabled={
                    submitting ||
                    (EVENT_META[openEvent].required && !value.trim())
                  }
                >
                  {submitting ? "Procesando…" : EVENT_META[openEvent].label}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
