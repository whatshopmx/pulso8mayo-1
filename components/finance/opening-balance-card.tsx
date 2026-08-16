"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCents } from "@/lib/utils";
import { Wallet, Loader2, Pencil } from "lucide-react";

/**
 * Saldo del que arranca la proyección.
 *
 * Era la constante `INITIAL_BALANCE = 2000000` — los mismos $20,000 para todo
 * inquilino. No hay banco ni libro mayor en el esquema, así que el dato no se
 * deriva: se captura aquí, en la misma tarjeta que lo muestra, para que
 * corregirlo no exija salir de la pantalla que motivó la corrección.
 */

export interface OpeningBalanceInfo {
  source: "BRANCH" | "COMPANY" | "NONE";
  asOfDate: string | null;
  ageInDays: number | null;
  isStale: boolean;
}

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
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
            <Wallet className="w-4 h-4" />
            Saldo en caja y bancos
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
              arranca la proyección.
            </p>
          </div>
        ) : sinCapturar ? (
          <>
            <div className="text-2xl font-bold text-muted-foreground">Sin capturar</div>
            <p className="text-xs text-muted-foreground mt-1">
              {canEdit
                ? "Captura el saldo para proyectar el mes"
                : "Pídele a un administrador que capture el saldo"}
            </p>
          </>
        ) : (
          <>
            <div className="text-2xl font-bold text-foreground tabular-nums">
              {formatCents(balanceCents)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {/* La antigüedad va siempre a la vista: un saldo de hace nueve
                  días proyecta distinto que el de hoy, y quien lo lee tiene
                  derecho a saber de cuándo es. */}
              {openingBalance?.ageInDays === 0
                ? "Capturado hoy"
                : openingBalance?.ageInDays != null
                  ? `Capturado hace ${openingBalance.ageInDays} ${
                      openingBalance.ageInDays === 1 ? "día" : "días"
                    }`
                  : null}
              {openingBalance?.source === "COMPANY" && branchId && (
                <> · dato del grupo, esta sucursal no tiene el suyo</>
              )}
            </p>
            {openingBalance?.isStale && (
              <p className="text-xs text-warning-text mt-1">
                Conviene actualizarlo
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
