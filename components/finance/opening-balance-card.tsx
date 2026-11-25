"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCents } from "@/lib/utils";
import { Wallet, Loader2, Pencil, Landmark } from "lucide-react";
import {
  describeOpeningBalance,
  type OpeningBalanceContract,
} from "@/lib/services/cash-flow-balance-rules";

/**
 * Saldo del que arranca la proyección.
 *
 * FIN-01: declara explícitamente fuente (saldo bancario conciliado vs supuesto
 * manual vs sin ancla bancaria), fecha efectiva y cuenta(s) con últimos 4 dígitos.
 * Si no existe ancla bancaria ni captura, nunca muestra un saldo absoluto aparente.
 */

export type OpeningBalanceInfo = OpeningBalanceContract;

interface Props {
  balanceCents: number | null;
  openingBalance?: OpeningBalanceInfo;
  /** Alcance vigente; `null` = grupo completo. */
  branchId: string | null;
  branchName: string | null;
  /** RBAC resuelto por el servidor: sólo quien responde por el dinero captura. */
  canEdit: boolean;
  onSaved: () => void;
}

export function OpeningBalanceCard({
  balanceCents,
  openingBalance,
  branchId,
  branchName,
  canEdit,
  onSaved,
}: Props) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sinCapturar = balanceCents === null;
  const desc = describeOpeningBalance(openingBalance, balanceCents, { branchId, branchName });

  const abrir = () => {
    // Se precarga en pesos: nadie captura centavos a mano.
    setValor(balanceCents === null ? "" : (balanceCents / 100).toFixed(2));
    setError(null);
    setEditando(true);
  };

  const guardar = async () => {
    const pesos = Number(valor.replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(pesos)) {
      setError("Escribe un monto válido.");
      return;
    }

    setGuardando(true);
    setError(null);
    try {
      const res = await fetch("/api/finance/cash-flow/assumptions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          openingBalanceCents: Math.round(pesos * 100),
          branchId,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json?.error?.message || "No se pudo guardar el saldo.");
        return;
      }
      setEditando(false);
      onSaved();
    } catch {
      setError("Error de conexión al guardar el saldo.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground font-medium">
            {desc.isBankAnchored ? (
              <Landmark className="w-4 h-4 text-primary" />
            ) : (
              <Wallet className="w-4 h-4" />
            )}
            <span>{desc.sourceLabel}</span>
            <Badge variant="outline" className="text-[11px] py-0">
              {desc.isBankAnchored ? "Conciliado" : sinCapturar ? "Sin ancla" : "Supuesto manual"}
            </Badge>
          </div>
          {canEdit && !editando && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={abrir}
            >
              <Pencil className="w-3 h-3 mr-1" />
              {sinCapturar ? "Capturar" : "Editar"}
            </Button>
          )}
        </div>

        {editando ? (
          <div className="space-y-2">
            <Input
              autoFocus
              inputMode="decimal"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") guardar();
                if (e.key === "Escape") setEditando(false);
              }}
              placeholder="0.00"
              aria-label={`Saldo en caja y bancos${branchName ? ` de ${branchName}` : " del grupo"}`}
              className="text-lg font-bold tabular-nums"
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={guardar} disabled={guardando}>
                {guardando && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                Guardar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditando(false)}
                disabled={guardando}
              >
                Cancelar
              </Button>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <p className="text-xs text-muted-foreground">
              Es el dinero disponible hoy
              {branchName ? ` en ${branchName}` : " en todo el grupo"}. De aquí
              arranca la proyección estimada.
            </p>
          </div>
        ) : sinCapturar ? (
          <>
            <div className="text-xl font-bold text-muted-foreground">Sin ancla bancaria</div>
            <p className="text-xs text-muted-foreground mt-1">
              Sin saldo base ni ancla bancaria no se calcula un saldo absoluto aparente.{" "}
              {canEdit
                ? "Captura el saldo o ancla tus cuentas bancarias para proyectar."
                : "Pídele a un administrador que capture el ancla bancaria."}
            </p>
          </>
        ) : (
          <>
            <div className="text-xl font-bold text-foreground tabular-nums">
              {formatCents(balanceCents)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              <span className="font-medium text-foreground">Fuente:</span> {desc.sourceLabel}
              {desc.effectiveAsOfDate && (
                <>
                  {" · "}
                  <span className="font-medium text-foreground">Fecha:</span> {desc.effectiveAsOfDate}
                </>
              )}
              {desc.accountsSummary && (
                <>
                  {" · "}
                  <span className="font-medium text-foreground">Cuenta:</span> {desc.accountsSummary}
                </>
              )}
              {openingBalance?.ageInDays != null && !desc.isBankAnchored && (
                <>
                  {" · "}
                  {openingBalance.ageInDays === 0
                    ? "capturado hoy"
                    : `hace ${openingBalance.ageInDays} ${
                        openingBalance.ageInDays === 1 ? "día" : "días"
                      }`}
                </>
              )}
            </p>
            {desc.isBankAnchored &&
              (openingBalance?.accountBreakdown?.length ?? 0) > 0 && (
                <ul className="text-xs text-muted-foreground mt-2 space-y-1">
                  {(openingBalance?.accountBreakdown ?? []).map((a) => (
                    <li key={a.id} className="tabular-nums flex justify-between gap-3">
                      <span className="truncate">
                        {a.bankName ? `${a.bankName} · ` : ""}
                        {a.label} ····{a.accountLastFour}
                        {a.asOfDate ? ` (al ${a.asOfDate})` : ""}
                      </span>
                      <span>{formatCents(a.reconciledBalanceCents ?? a.balanceCents)}</span>
                    </li>
                  ))}
                </ul>
              )}
            {desc.isBankAnchored &&
              (openingBalance?.unmatchedBankCount ?? 0) > 0 && (
                <p className="text-xs text-warning-text mt-1">
                  {openingBalance?.unmatchedBankCount} movimiento(s) bancario(s) importado(s) sin conciliar (
                  {formatCents(openingBalance?.unmatchedBankDeltaCents ?? 0)}) excluidos del saldo conciliado.
                </p>
              )}
            {openingBalance?.unanchoredAccountsCount != null &&
              openingBalance.unanchoredAccountsCount > 0 && (
                <p className="text-xs text-warning-text mt-1">
                  {openingBalance.unanchoredAccountsCount} cuenta(s) activa(s) sin ancla bancaria —
                  se usa supuesto manual. Configura el ancla en Cuentas bancarias.
                </p>
              )}
            {openingBalance?.isStale && (
              <p className="text-xs text-warning-text mt-1">
                Saldo desactualizado — conviene actualizar el ancla o la captura.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
