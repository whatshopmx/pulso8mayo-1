"use client";

import { useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, BadgeCheck, FileCheck2, Loader2, ShieldAlert, Upload } from "lucide-react";

/**
 * Verificación de titularidad de una CLABE de payee — espejo de
 * `clabe-verification-dialog.tsx` (proveedores). Se duplica en vez de
 * generalizarse por la misma razón que el servicio: el componente de
 * proveedor ya es UI probada, y cambiarle el contrato para admitir dos
 * catálogos arriesga esa pantalla por una economía de líneas.
 */

export interface VerifiablePayeeAccount {
  id: string;
  payeeName: string;
  bankName: string;
  clabeLast4: string;
  /** Nombre que declaró quien capturó la cuenta. */
  accountHolderName: string;
}

interface Props {
  account: VerifiablePayeeAccount | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVerified: (mensaje: string) => void;
  onRequestReject: (accountId: string) => void;
}

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.,;:()"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

type MatchLevel = "exact" | "close" | "different";

function compareHolders(declared: string, fromCep: string): {
  level: MatchLevel;
  percent: number;
} {
  const a = normalizeName(declared);
  const b = normalizeName(fromCep);
  if (!b) return { level: "different", percent: 0 };
  if (a === b) return { level: "exact", percent: 100 };
  const longest = Math.max(a.length, b.length);
  const percent = Math.round((1 - levenshtein(a, b) / longest) * 100);
  return { level: percent >= 70 ? "close" : "different", percent };
}

const MATCH_COPY: Record<MatchLevel, { title: string; detail: string }> = {
  exact: {
    title: "Los nombres coinciden",
    detail:
      "Salvo acentos, mayúsculas y puntuación, es el mismo nombre. Aun así, léelos: el sistema compara texto, no identidad.",
  },
  close: {
    title: "Se parecen, pero no son iguales",
    detail:
      "Un sufijo distinto, o un nombre que no es el de la contraparte, es la forma exacta que toma el fraude de cuenta suplantada. Si no estás seguro, rechaza.",
  },
  different: {
    title: "No coinciden",
    detail:
      "El CEP dice que esa cuenta es de alguien más. Rechaza la cuenta y pide a la contraparte su estado de cuenta.",
  },
};

export function PayeeClabeVerificationDialog({
  account,
  open,
  onOpenChange,
  onVerified,
  onRequestReject,
}: Props) {
  const [holderNameFromCep, setHolderNameFromCep] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [evidenceKey, setEvidenceKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const match = useMemo(
    () =>
      account && holderNameFromCep.trim()
        ? compareHolders(account.accountHolderName, holderNameFromCep)
        : null,
    [account, holderNameFromCep],
  );

  function reset() {
    setHolderNameFromCep("");
    setFile(null);
    setEvidenceKey(null);
    setError(null);
    setUploading(false);
    setSubmitting(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleFile(selected: File | null) {
    setFile(selected);
    setEvidenceKey(null);
    setError(null);
    if (!selected) return;

    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", selected);
      const res = await fetch("/api/finance/payee-bank-accounts/evidence", {
        method: "POST",
        body,
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json?.error?.message || "No se pudo subir el CEP.");
        return;
      }
      setEvidenceKey(json.data.storageKey);
    } catch (err) {
      console.error("Failed to upload CEP:", err);
      setError("Error de conexión al subir el CEP.");
    } finally {
      setUploading(false);
    }
  }

  async function handleVerify() {
    if (!account || !evidenceKey) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/finance/payee-bank-accounts/${account.id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holderNameFromCep: holderNameFromCep.trim(), evidenceUrl: evidenceKey }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json?.error?.message || "No se pudo verificar la cuenta.");
        return;
      }
      const { supersededLast4 } = json.data;
      onVerified(
        [
          `Cuenta ****${account.clabeLast4} de ${account.payeeName} verificada.`,
          "Ya puede entrar a una corrida de pago.",
          supersededLast4
            ? `La cuenta anterior ****${supersededLast4} quedó dada de baja.`
            : null,
        ]
          .filter(Boolean)
          .join(" "),
      );
      handleOpenChange(false);
    } catch (err) {
      console.error("Failed to verify bank account:", err);
      setError("Error de conexión al verificar la cuenta.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!account) return null;

  const canVerify = !!evidenceKey && !!holderNameFromCep.trim() && !submitting && !uploading;
  const rejectIsPrimary = !!match && match.level !== "exact";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Verificar titularidad</DialogTitle>
          <DialogDescription>
            {account.payeeName} · {account.bankName} · cuenta ****{account.clabeLast4}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-border bg-muted/40 p-3 text-xs space-y-1.5">
            <p className="font-semibold">Cómo se prueba que la cuenta es de la contraparte</p>
            <ol className="list-decimal pl-4 space-y-1 text-muted-foreground">
              <li>
                Desde el portal de tu banco, transfiere <strong>$0.01</strong> a esta CLABE.
              </li>
              <li>
                Descarga el <strong>CEP</strong> (Comprobante Electrónico de Pago) en{" "}
                <span className="font-mono">cep.banxico.org.mx</span>. Trae el nombre del titular
                de la cuenta destino.
              </li>
              <li>Sube el CEP aquí y copia el nombre del titular tal como aparece en él.</li>
            </ol>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cep-file">CEP de Banxico</Label>
            <div className="flex items-center gap-2">
              <Input
                id="cep-file"
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                disabled={uploading || submitting}
                className="text-xs"
              />
              {uploading && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
            </div>
            {evidenceKey ? (
              <p className="text-xs text-success inline-flex items-center gap-1">
                <FileCheck2 className="w-3.5 h-3.5" /> {file?.name} adjunto
              </p>
            ) : (
              <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <Upload className="w-3.5 h-3.5" /> PDF o captura, hasta 10 MB. Sin CEP no se puede
                verificar.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cep-holder">Titular según el CEP</Label>
            <Input
              id="cep-holder"
              value={holderNameFromCep}
              onChange={(e) => setHolderNameFromCep(e.target.value)}
              placeholder="Cópialo del CEP, sin corregirlo"
              disabled={submitting}
            />
          </div>

          {match && (
            <div
              className={`rounded-md border p-3 text-xs space-y-2 ${
                match.level === "exact"
                  ? "border-success/40 bg-success/5"
                  : "border-warning/40 bg-warning/5"
              }`}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <p className="text-muted-foreground">Declarado al capturar</p>
                  <p className="font-medium break-words">{account.accountHolderName}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">En el CEP</p>
                  <p className="font-medium break-words">{holderNameFromCep}</p>
                </div>
              </div>
              <p className="inline-flex items-start gap-1.5 font-semibold">
                {match.level === "exact" ? (
                  <BadgeCheck className="w-3.5 h-3.5 shrink-0 mt-px text-success" />
                ) : (
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-px text-warning-text" />
                )}
                {MATCH_COPY[match.level].title} · {match.percent}% de coincidencia
              </p>
              <p className="text-muted-foreground">{MATCH_COPY[match.level].detail}</p>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
              <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-px" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            variant={rejectIsPrimary ? "destructive" : "outline"}
            onClick={() => {
              handleOpenChange(false);
              onRequestReject(account.id);
            }}
            disabled={submitting}
          >
            Rechazar cuenta
          </Button>
          <Button
            variant={rejectIsPrimary ? "outline" : "default"}
            onClick={handleVerify}
            disabled={!canVerify}
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Verificando...
              </>
            ) : (
              "Verificar titularidad"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
