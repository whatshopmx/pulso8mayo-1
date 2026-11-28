"use client";

import { useState } from "react";
import { AlertTriangle, Clock, Lock, Paperclip, ShieldCheck, UserCheck } from "lucide-react";
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
import type {
  ExceptionEvent,
  ExceptionStatus,
} from "@/lib/services/exception-lifecycle";
import {
  computeExceptionUiCapabilities,
} from "@/lib/services/exception-ui-capabilities";
import type { GroupExceptionLifecycle } from "@/lib/services/group-exceptions-service";
import { ExceptionEvidenceDialog } from "./exception-evidence-dialog";

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

export interface ExceptionLifecycleActionsProps {
  exceptionId: string;
  lifecycle: GroupExceptionLifecycle;
  /** EXC-05: capacidad efectiva del rol (`exceptions:update`). Default `true` por compatibilidad. */
  canMutate?: boolean;
  /** EXC-05: usuario en sesión para reflejar segregación de funciones (`VERIFY`). */
  currentUserId?: string | null;
  /** EXC-05: aviso de conflicto concurrente inicial (para pruebas/estado recuperado). */
  initialConflictMessage?: string | null;
  onDone: () => void;
}

export interface LifecycleSubmitResult {
  ok: boolean;
  conflict: boolean;
  status: number;
  message: string;
}

/**
 * Ejecuta una transición canónica contra `/api/exceptions/:id/:action` enviando
 * `expectedStatus` para detección de conflicto concurrente (`409 Conflict`).
 */
export async function submitExceptionLifecycleAction(params: {
  exceptionId: string;
  event: ExceptionEvent;
  expectedStatus: ExceptionStatus;
  value?: string;
  fetchImpl?: typeof fetch;
}): Promise<LifecycleSubmitResult> {
  const meta = EVENT_META[params.event];
  const trimmed = (params.value ?? "").trim();
  const body: Record<string, unknown> = {
    expectedStatus: params.expectedStatus,
  };
  if (meta.input === "owner") {
    body.ownerId = trimmed;
  } else if (meta.field && trimmed) {
    body[meta.field] = trimmed;
  }

  const doFetch = params.fetchImpl ?? fetch;
  const res = await doFetch(`/api/exceptions/${params.exceptionId}/${meta.path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const serverMessage =
      json?.error?.message ??
      (res.status === 409
        ? "Conflicto concurrente: la excepción cambió en otra sesión."
        : "No se pudo completar la acción.");
    return {
      ok: false,
      conflict: res.status === 409,
      status: res.status,
      message: serverMessage,
    };
  }

  return {
    ok: true,
    conflict: false,
    status: res.status,
    message: `${meta.label}: listo`,
  };
}

/**
 * Acciones de lifecycle canónico para una excepción del feed.
 *
 * Solo se ofrece lo que es legal desde el estado actual (`allowedEvents`) y
 * autorizado para el rol/usuario (`computeExceptionUiCapabilities`). Ante un
 * `409 Conflict`, muestra aviso explícito y recarga el estado desde el servidor.
 */
export function ExceptionLifecycleActions({
  exceptionId,
  lifecycle,
  canMutate = true,
  currentUserId = null,
  initialConflictMessage = null,
  onDone,
}: ExceptionLifecycleActionsProps) {
  const [openEvent, setOpenEvent] = useState<ExceptionEvent | null>(null);
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [conflictMessage, setConflictMessage] = useState<string | null>(
    initialConflictMessage,
  );
  const [evidenceDialogOpen, setEvidenceDialogOpen] = useState(false);

  const capabilities = computeExceptionUiCapabilities({
    lifecycle,
    canUpdate: canMutate,
    currentUserId,
  });
  const primary = capabilities.primaryAction;
  const others = capabilities.secondaryActions;

  const slaPast =
    lifecycle.slaDueAt && new Date(lifecycle.slaDueAt).getTime() < Date.now();

  async function submit() {
    if (!openEvent) return;
    const meta = EVENT_META[openEvent];
    const trimmed = value.trim();
    if (meta.required && !trimmed) return;

    setSubmitting(true);
    setConflictMessage(null);
    try {
      const outcome = await submitExceptionLifecycleAction({
        exceptionId,
        event: openEvent,
        expectedStatus: lifecycle.status,
        value: trimmed,
      });

      if (!outcome.ok) {
        if (outcome.conflict) {
          const msg = `Conflicto concurrente: ${outcome.message} Actualizando estado…`;
          setConflictMessage(msg);
          setOpenEvent(null);
          setValue("");
          toast.error(msg);
          onDone();
          return;
        }
        throw new Error(outcome.message);
      }

      toast.success(outcome.message);
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

        {capabilities.readOnlyReason && (
          <Badge variant="outline" className="text-xs gap-1 text-muted-foreground">
            <Lock className="w-3 h-3" />
            {capabilities.readOnlyReason}
          </Badge>
        )}
      </div>

      {conflictMessage && (
        <div
          role="alert"
          className="flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1 text-xs text-warning-text max-w-sm"
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>{conflictMessage}</span>
        </div>
      )}

      {capabilities.canMutate && capabilities.blockedActions.length > 0 && (
        <div className="text-[11px] text-muted-foreground flex items-center gap-1">
          <Lock className="w-3 h-3 shrink-0" />
          <span>{capabilities.blockedActions[0].reason}</span>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap justify-end">
        <Button
          variant="outline"
          size="sm"
          className="text-xs h-8 gap-1.5"
          onClick={() => setEvidenceDialogOpen(true)}
        >
          <Paperclip className="w-3.5 h-3.5" />
          Evidencias
        </Button>
        {capabilities.canMutate && primary && (
          <Button
            size="sm"
            className="text-xs h-8"
            onClick={() => {
              setConflictMessage(null);
              setValue("");
              setOpenEvent(primary);
            }}
          >
            {EVENT_META[primary].label}
          </Button>
        )}
        {capabilities.canMutate &&
          others.map((event) => (
            <Button
              key={event}
              variant="outline"
              size="sm"
              className="text-xs h-8"
              onClick={() => {
                setConflictMessage(null);
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

      <ExceptionEvidenceDialog
        exceptionId={exceptionId}
        open={evidenceDialogOpen}
        onOpenChange={setEvidenceDialogOpen}
        onEvidenceChanged={onDone}
      />
    </div>
  );
}
