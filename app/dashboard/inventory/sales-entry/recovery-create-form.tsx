"use client";

import { useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";

const fields = [
  ["legacySaleId", "Venta por recuperar"],
  ["saleAttestationId", "Atestación de venta"],
  ["recipeAttestationId", "Atestación de receta histórica"],
  ["absenceAttestationId", "Atestación de ausencia de consumo"],
] as const;
const uuid = z.string().uuid();

export function RecoveryCreateForm({ branchId, onCreated, onPendingChange }: {
  branchId: string;
  onCreated: (proposalId: string) => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = new FormData(event.currentTarget);
    const refs = Object.fromEntries(fields.map(([name]) => [name, String(form.get(name) ?? "").trim().toLowerCase()]));
    const reason = String(form.get("reason") ?? "").trim();
    setError(null);
    if (![branchId, ...Object.values(refs)].every(value => uuid.safeParse(value).success)) {
      setError("Revisa los identificadores de venta y atestaciones; deben ser UUID válidos.");
      return;
    }
    if (new Set([refs.saleAttestationId, refs.recipeAttestationId, refs.absenceAttestationId]).size !== 3) {
      setError("Se requieren tres atestaciones distintas, una por cada documento.");
      return;
    }
    if (!reason || reason.length > 2000) {
      setError("Escribe un motivo de recuperación de entre 1 y 2000 caracteres.");
      return;
    }
    const payload = { branchId, ...refs, reason };
    const fingerprint = JSON.stringify(payload);
    if (attempt.current?.fingerprint !== fingerprint) {
      attempt.current = { fingerprint, key: crypto.randomUUID() };
    }
    submitting.current = true;
    setPending(true);
    onPendingChange(true);
    try {
      const response = await fetch("/api/inventory/sales-entry/recovery-proposals", {
        method: "POST", headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30000),
        body: JSON.stringify({ ...payload, idempotencyKey: attempt.current.key }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo registrar el expediente.");
      if (!uuid.safeParse(data.data?.id).success) throw new Error("El servidor no devolvió un expediente válido. Puedes reintentar.");
      onCreated(data.data.id);
    } catch (failure) {
      setError(failure instanceof Error && failure.name === "TimeoutError"
        ? "La verificación tardó demasiado. Reintenta con los mismos datos para consultar o completar el registro."
        : failure instanceof Error ? failure.message : "No se pudo registrar el expediente. Puedes reintentar.");
    } finally {
      submitting.current = false;
      setPending(false);
      onPendingChange(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p id="recovery-create-help" className="text-sm text-muted-foreground">
        Usa los identificadores de las atestaciones ya verificadas de esta venta y sucursal.
        Registrar el expediente no descuenta inventario. Otra persona deberá revisarlo antes de aplicarlo.
      </p>
      <fieldset disabled={pending} aria-describedby="recovery-create-help" className="min-w-0 space-y-4">
        {fields.map(([name, label]) => (
          <div key={name} className="space-y-1">
            <Label htmlFor={`recovery-create-${name}`}>{label}</Label>
            <Input id={`recovery-create-${name}`} name={name} required autoComplete="off"
              placeholder="Identificador UUID" className="font-mono text-sm" />
          </div>
        ))}
        <div className="space-y-1">
          <Label htmlFor="recovery-create-reason">Motivo de recuperación</Label>
          <Textarea id="recovery-create-reason" name="reason" required maxLength={2000} rows={3} />
        </div>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <Button type="submit" disabled={!branchId || pending}>
          {pending ? "Registrando expediente…" : "Registrar expediente"}
        </Button>
      </fieldset>
      {pending && <p role="status" className="text-sm text-muted-foreground">Verificando fuentes y registrando el expediente…</p>}
    </form>
  );
}
