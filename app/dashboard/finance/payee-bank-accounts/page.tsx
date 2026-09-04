"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import { statusBadgeClasses } from "@/lib/utils";
import { validateClabe, normalizeClabe } from "@/lib/banking/clabe";
import { mensajeDeError } from "@/lib/api/client-error";
import { useSession } from "@/hooks/use-session";
import {
  PayeeClabeVerificationDialog,
  type VerifiablePayeeAccount,
} from "@/components/finance/payee-clabe-verification-dialog";
import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  Ban,
  CheckCircle2,
  Handshake,
  Landmark,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

/**
 * Cuentas bancarias de payee — espejo de
 * `/dashboard/finance/supplier-bank-accounts` para el catálogo de
 * contrapartes de gasto operativo (renta, luz, honorarios). Sin esto, un
 * gasto operativo aprobado no tenía ninguna cuenta verificada contra la cual
 * `TreasuryService` pudiera dejarlo entrar a una corrida de pago.
 */

type AccountStatus = "PENDING_VERIFICATION" | "VERIFIED" | "REJECTED";

interface BankAccount {
  id: string;
  payeeId: string;
  clabeLast4: string;
  bankCode: string;
  bankName: string;
  accountHolderName: string;
  status: AccountStatus;
  active: boolean;
  verifiedAt: string | null;
  verificationMethod: string | null;
  verificationEvidenceUrl: string | null;
  registeredBy: string;
  replacesAccountId: string | null;
  rejectionReason: string | null;
  notes: string | null;
  createdAt: string;
}

interface Payee {
  id: string;
  name: string;
}

function motivoParaNoVerificar(
  account: BankAccount,
  currentUserId: string | undefined,
): string | null {
  if (account.registeredBy && account.registeredBy === currentUserId) {
    return "Tú capturaste esta cuenta. La verificación la tiene que hacer otra persona.";
  }
  return null;
}

const STATUS_LABEL: Record<AccountStatus, string> = {
  PENDING_VERIFICATION: "Sin verificar",
  VERIFIED: "Verificada",
  REJECTED: "Rechazada",
};

const STATUS_TONE: Record<AccountStatus, Parameters<typeof statusBadgeClasses>[0]> = {
  PENDING_VERIFICATION: "warning",
  VERIFIED: "success",
  REJECTED: "destructive",
};

export default function PayeeBankAccountsPage() {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [payees, setPayees] = useState<Payee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [payeeId, setPayeeId] = useState("");
  const [clabe, setClabe] = useState("");
  const [accountHolderName, setAccountHolderName] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const [payeesError, setPayeesError] = useState<string | null>(null);

  const { session } = useSession();
  const currentUserId = session?.user?.id;
  const [verifying, setVerifying] = useState<VerifiablePayeeAccount | null>(null);
  const [verifySuccess, setVerifySuccess] = useState<string | null>(null);

  const payeeName = useCallback(
    (id: string) => {
      const nombre = payees.find((p) => p.id === id)?.name;
      if (nombre) return nombre;
      return payeesError ? "Nombre no disponible" : "Contraparte desconocida";
    },
    [payees, payeesError],
  );

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    setPayeesError(null);
    try {
      const [accountsRes, payeesRes] = await Promise.all([
        fetch("/api/finance/payee-bank-accounts"),
        fetch("/api/finance/payees?active=false"),
      ]);
      const accountsJson = await accountsRes.json();
      const payeesJson = await payeesRes.json();

      if (!accountsRes.ok || !accountsJson.success) {
        setError(
          accountsJson?.error?.message ||
            "El servidor no devolvió las cuentas bancarias de contrapartes.",
        );
        setAccounts([]);
      } else {
        setAccounts(accountsJson.data ?? []);
      }

      if (payeesRes.ok && payeesJson.success) {
        setPayees(payeesJson.data ?? []);
      } else {
        setPayeesError(
          mensajeDeError(
            payeesJson,
            "No se pudo cargar el catálogo de contrapartes. Sin él no se puede registrar una cuenta.",
          ),
        );
        setPayees([]);
      }
    } catch (err) {
      console.error("Failed to load payee bank accounts:", err);
      setError("Error de conexión al cargar las cuentas bancarias.");
      setAccounts([]);
      setPayeesError("Error de conexión al cargar el catálogo de contrapartes.");
      setPayees([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const clabeCheck = useMemo(() => {
    const normalized = normalizeClabe(clabe);
    if (!normalized) return null;
    const result = validateClabe(normalized);
    if (result.ok === false) {
      return { ok: false, bankName: "", last4: "", message: result.message };
    }
    return { ok: true, bankName: result.bankName, last4: result.last4, message: "" };
  }, [clabe]);

  const canSubmit =
    !!payeeId && !!accountHolderName.trim() && clabeCheck?.ok === true && !submitting;

  async function handleRegister() {
    setSubmitting(true);
    setFormError(null);
    setFormSuccess(null);
    try {
      const res = await fetch("/api/finance/payee-bank-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payeeId, clabe, accountHolderName, notes: notes || undefined }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setFormError(json?.error?.message || "No se pudo registrar la cuenta.");
        return;
      }

      const { isChange, sharedWithPayeeIds, alertedUserIds } = json.data;
      setFormSuccess(
        [
          isChange
            ? "Cambio de CLABE registrado. La cuenta anterior sigue siendo la pagable."
            : "Cuenta registrada.",
          "Queda sin verificar: no se le puede pagar hasta comprobar la titularidad con el CEP de Banxico.",
          sharedWithPayeeIds?.length
            ? `Atención: esta cuenta ya está registrada en ${sharedWithPayeeIds.length} contraparte(s) más.`
            : null,
          alertedUserIds?.length ? `Se alertó a ${alertedUserIds.length} usuario(s).` : null,
        ]
          .filter(Boolean)
          .join(" "),
      );
      setClabe("");
      setAccountHolderName("");
      setNotes("");
      await load(true);
    } catch (err) {
      console.error("Failed to register bank account:", err);
      setFormError("Error de conexión al registrar la cuenta.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReject(accountId: string) {
    setFormError(null);
    try {
      const res = await fetch(`/api/finance/payee-bank-accounts/${accountId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setFormError(json?.error?.message || "No se pudo rechazar la cuenta.");
        return;
      }
      setRejectingId(null);
      setRejectReason("");
      await load(true);
    } catch (err) {
      console.error("Failed to reject bank account:", err);
      setFormError("Error de conexión al rechazar la cuenta.");
    }
  }

  const pendingCount = accounts.filter(
    (a) => a.status === "PENDING_VERIFICATION" && a.active,
  ).length;
  const changeCount = accounts.filter((a) => a.replacesAccountId && a.active).length;

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Landmark className="h-7 w-7 text-primary" /> Cuentas Bancarias de Contrapartes
          </h1>
          <p className="text-sm text-muted-foreground">
            A qué cuenta se le paga cada gasto operativo (renta, luz, honorarios), y quién lo
            autorizó.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Actualizar
        </Button>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs">
        <ShieldCheck className="w-4 h-4 text-muted-foreground shrink-0 mt-px" />
        <span>
          <span className="font-semibold">El fraude que esto detiene</span> no es el gasto
          inventado: es cambiarle la CLABE a una contraparte real (el arrendador, el despacho
          contable) y esperar el siguiente pago legítimo. Por eso capturar una cuenta no la vuelve
          pagable, no desplaza a la cuenta vigente, y siempre notifica al dueño. La CLABE completa
          no se muestra en pantalla — solo los últimos 4 dígitos.
        </span>
      </div>

      {(pendingCount > 0 || changeCount > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className={pendingCount > 0 ? "border-warning/40" : undefined}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Esperando verificación</p>
              <p className="text-2xl font-bold tabular-nums">{pendingCount}</p>
              <p className="text-xs text-muted-foreground">
                No se les puede pagar hasta comprobar titularidad
              </p>
            </CardContent>
          </Card>
          <Card className={changeCount > 0 ? "border-destructive/40" : undefined}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Cambios de cuenta sin resolver</p>
              <p
                className={`text-2xl font-bold tabular-nums ${
                  changeCount > 0 ? "text-destructive" : ""
                }`}
              >
                {changeCount}
              </p>
              <p className="text-xs text-muted-foreground">
                Contrapartes que ya tenían una cuenta verificada
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold">Registrar una cuenta</CardTitle>
          <CardDescription className="text-xs">
            La CLABE se valida contra el dígito verificador de Banxico y el catálogo de bancos
            antes de guardarse. Cópiala del estado de cuenta de la contraparte, no de un correo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="payee">Contraparte</Label>
              <Select value={payeeId} onValueChange={setPayeeId} disabled={!!payeesError}>
                <SelectTrigger id="payee">
                  <SelectValue
                    placeholder={
                      payeesError
                        ? "Catálogo de contrapartes no disponible"
                        : "Selecciona una contraparte"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {payees.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {payeesError && (
                <p className="text-xs text-destructive flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    {payeesError}{" "}
                    <button
                      type="button"
                      onClick={() => load()}
                      className="underline underline-offset-2 font-medium"
                    >
                      Reintentar
                    </button>
                  </span>
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="holder">Titular de la cuenta</Label>
              <Input
                id="holder"
                value={accountHolderName}
                onChange={(e) => setAccountHolderName(e.target.value)}
                placeholder="Nombre exacto de la contraparte"
              />
              <p className="text-xs text-muted-foreground">
                Se compara contra el CEP de Banxico al verificar.
              </p>
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="clabe">CLABE (18 dígitos)</Label>
              <Input
                id="clabe"
                value={clabe}
                onChange={(e) => setClabe(e.target.value)}
                placeholder="000000000000000000"
                inputMode="numeric"
                autoComplete="off"
                className="font-mono tabular-nums"
                aria-describedby="clabe-feedback"
                aria-invalid={clabeCheck?.ok === false}
              />
              <p id="clabe-feedback" className="text-xs" aria-live="polite">
                {!clabeCheck ? (
                  <span className="text-muted-foreground">
                    Se aceptan espacios y guiones; se limpian solos.
                  </span>
                ) : clabeCheck.ok ? (
                  <span className="text-success inline-flex items-center gap-1">
                    <BadgeCheck className="w-3.5 h-3.5" />
                    {clabeCheck.bankName} · cuenta terminada en {clabeCheck.last4}. Válida
                    matemáticamente — la titularidad todavía no está comprobada.
                  </span>
                ) : (
                  <span className="text-destructive inline-flex items-start gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
                    {clabeCheck.message}
                  </span>
                )}
              </p>
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="notes">Nota (opcional)</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="De dónde salió esta cuenta: quién la envió, en qué documento."
                rows={2}
              />
            </div>
          </div>

          {formError && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
              <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-px" />
              <span>{formError}</span>
            </div>
          )}
          {formSuccess && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-xs">
              <ShieldAlert className="w-4 h-4 text-warning-text shrink-0 mt-px" />
              <span>{formSuccess}</span>
            </div>
          )}

          <Button onClick={handleRegister} disabled={!canSubmit}>
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Registrando...
              </>
            ) : (
              "Registrar cuenta sin verificar"
            )}
          </Button>
        </CardContent>
      </Card>

      {verifySuccess && (
        <div className="flex items-start gap-2 rounded-md border border-success/40 bg-success/5 p-3 text-xs">
          <BadgeCheck className="w-4 h-4 text-success shrink-0 mt-px" />
          <span>{verifySuccess}</span>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold">Cuentas registradas</CardTitle>
          <CardDescription className="text-xs">
            Las cuentas dadas de baja se conservan: son la evidencia de a quién se le pagó y de qué
            se intentó cambiar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 flex justify-center text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mr-2" /> Cargando cuentas...
            </div>
          ) : error ? (
            <EmptyState
              icon={AlertCircle}
              title="No se pudieron cargar las cuentas"
              description={error}
              action={
                <Button variant="outline" size="sm" onClick={() => load()}>
                  <RefreshCw className="w-4 h-4 mr-2" /> Reintentar
                </Button>
              }
            />
          ) : accounts.length === 0 ? (
            <EmptyState
              icon={Handshake}
              title="Ninguna contraparte tiene cuenta registrada"
              description="Mientras no haya cuentas verificadas, ningún gasto operativo puede entrar a una corrida de pago."
            />
          ) : (
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableCaption className="sr-only">
                  Cuentas bancarias de contrapartes: contraparte, banco, últimos 4 dígitos,
                  titular, estado y acción de rechazo.
                </TableCaption>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Contraparte</TableHead>
                    <TableHead>Banco</TableHead>
                    <TableHead>Cuenta</TableHead>
                    <TableHead>Titular declarado</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.map((account) => (
                    <TableRow
                      key={account.id}
                      className={`hover:bg-muted/40 ${account.active ? "" : "opacity-60"}`}
                    >
                      <TableCell className="font-medium">
                        {payeeName(account.payeeId)}
                        {account.replacesAccountId && account.active && (
                          <span className="text-xs text-destructive block mt-0.5">
                            Sustituye a una cuenta verificada
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {account.bankName}
                        <span className="text-xs text-muted-foreground block">
                          {account.bankCode}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono tabular-nums">
                        ****{account.clabeLast4}
                      </TableCell>
                      <TableCell className="text-sm">{account.accountHolderName}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5 items-start">
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded-full border w-fit ${statusBadgeClasses(
                              STATUS_TONE[account.status],
                            )}`}
                          >
                            {STATUS_LABEL[account.status]}
                          </span>
                          {account.status === "PENDING_VERIFICATION" && (
                            <span className="text-xs text-muted-foreground">
                              No se le puede pagar
                            </span>
                          )}
                          {account.status === "VERIFIED" && account.verifiedAt && (
                            <span className="text-xs text-muted-foreground">
                              {account.verificationMethod === "MANUAL_CEP"
                                ? "CEP de Banxico"
                                : account.verificationMethod || "Verificada"}
                              {" · "}
                              {new Date(account.verifiedAt).toLocaleDateString("es-MX")}
                              {account.verificationEvidenceUrl ? " · con evidencia" : ""}
                            </span>
                          )}
                          {account.status === "REJECTED" && account.rejectionReason && (
                            <span className="text-xs text-muted-foreground">
                              {account.rejectionReason}
                            </span>
                          )}
                          {!account.active && account.status === "VERIFIED" && (
                            <span className="text-xs text-muted-foreground">Dada de baja</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {account.active ? (
                          rejectingId === account.id ? (
                            <div className="flex flex-col gap-2 items-end">
                              <Input
                                value={rejectReason}
                                onChange={(e) => setRejectReason(e.target.value)}
                                placeholder="Motivo del rechazo"
                                className="text-xs h-8 w-56"
                              />
                              <div className="flex gap-1.5">
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  disabled={!rejectReason.trim()}
                                  onClick={() => handleReject(account.id)}
                                >
                                  Confirmar
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setRejectingId(null);
                                    setRejectReason("");
                                  }}
                                >
                                  Cancelar
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col items-end gap-1.5">
                              {account.status === "PENDING_VERIFICATION" &&
                                (() => {
                                  const motivo = motivoParaNoVerificar(account, currentUserId);
                                  return (
                                    <>
                                      <Button
                                        size="sm"
                                        disabled={!!motivo}
                                        title={motivo ?? undefined}
                                        onClick={() =>
                                          setVerifying({
                                            id: account.id,
                                            payeeName: payeeName(account.payeeId),
                                            bankName: account.bankName,
                                            clabeLast4: account.clabeLast4,
                                            accountHolderName: account.accountHolderName,
                                          })
                                        }
                                      >
                                        <ShieldCheck className="w-3.5 h-3.5 mr-1.5" /> Verificar
                                        titularidad
                                      </Button>
                                      {motivo && (
                                        <span className="block w-52 text-xs text-muted-foreground text-right whitespace-normal">
                                          {motivo}
                                        </span>
                                      )}
                                    </>
                                  );
                                })()}
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setRejectingId(account.id);
                                  setRejectReason("");
                                }}
                              >
                                <Ban className="w-3.5 h-3.5 mr-1.5" /> Rechazar
                              </Button>
                            </div>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Cerrada
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs">
        <Badge variant="outline" className="text-xs shrink-0">
          Verificación
        </Badge>
        <span>
          <span className="font-semibold">Verificar titularidad es la prueba del centavo.</span> En
          México no existe un servicio que devuelva el nombre del titular a partir de una CLABE: se
          transfiere $0.01, se descarga el CEP de Banxico —que sí trae el titular de la cuenta
          destino— y se contrasta contra el nombre declarado. El sistema muestra los dos nombres y
          su parecido, pero no aprueba solo: la decisión es de quien verifica, y no puede ser quien
          capturó la cuenta.
        </span>
      </div>

      <PayeeClabeVerificationDialog
        account={verifying}
        open={!!verifying}
        onOpenChange={(open) => {
          if (!open) setVerifying(null);
        }}
        onVerified={async (mensaje) => {
          setVerifySuccess(mensaje);
          setVerifying(null);
          await load(true);
        }}
        onRequestReject={(accountId) => {
          setVerifying(null);
          setRejectingId(accountId);
          setRejectReason("");
        }}
      />

      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard/finance/payees">
            Volver a Contrapartes <ArrowRight className="w-4 h-4 ml-1.5" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
