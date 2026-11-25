"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DollarSign, ShieldAlert, Wallet, Sparkles, AlertCircle, Check, Info } from "lucide-react";
import { ETIQUETA_CLASIFICACION, politicaPorInput } from "@/lib/company/operating-policy-catalog";

/**
 * C15 — un umbral y una promesa no son lo mismo.
 *
 * Cuatro de los cinco topes de esta tarjeta cambian decisiones: los revisó
 * `rolExigidoPorMonto`, `validateEmergencyCap` y la aprobación de merma. El
 * fondo de caja chica no lo lee nadie —`petty-cash-service` trabaja con el
 * monto que el operador escribe en cada movimiento— y su texto decía
 * «monto máximo asignado al fondo revolvente», que suena a tope y no lo es.
 *
 * El distintivo sale del catálogo, no de esta tarjeta: si mañana el fondo pasa
 * a consumirse, el texto se actualiza en un solo lugar y no en dos.
 */
function EstadoDePolitica({ input }: { input: keyof FinancialThresholdsValues }) {
  const clasificacion = politicaPorInput(input)?.clasificacion ?? "descriptiva";
  return (
    <Badge
      variant="secondary"
      className={
        clasificacion === "aplicada"
          ? "ml-auto shrink-0 gap-1 border-primary/20 bg-primary/15 px-1.5 py-0 text-xs font-normal tracking-tight text-primary"
          : "ml-auto shrink-0 gap-1 bg-muted px-1.5 py-0 text-xs font-normal tracking-tight text-muted-foreground"
      }
    >
      {clasificacion === "aplicada" ? (
        <Check className="h-3 w-3" aria-hidden="true" />
      ) : (
        <Info className="h-3 w-3" aria-hidden="true" />
      )}
      {ETIQUETA_CLASIFICACION[clasificacion]}
    </Badge>
  );
}

/** Aviso del servidor junto al input que lo provocó (C13). */
function ErrorDeCampo({ id, mensaje }: { id: string; mensaje?: string }) {
  if (!mensaje) return null;
  return (
    <p id={id} className="text-xs text-destructive">
      {mensaje}
    </p>
  );
}

export interface FinancialThresholdsValues {
  managerAuthLimit: string;
  doubleApprovalThreshold: string;
  pettyCashLimit: string;
  emergencyCap: string;
  courtesyWasteCap: string;
}

interface FinancialThresholdsSectionProps {
  values: FinancialThresholdsValues;
  onChange: (key: keyof FinancialThresholdsValues, value: string) => void;
  /** Error del servidor por campo, ya traducido al nombre del input. */
  errors?: Record<string, string>;
  /** El límite del gerente quedó por encima del umbral de Dirección General. */
  authLadderInvalid?: boolean;
}

export function FinancialThresholdsSection({
  values,
  onChange,
  errors = {},
  authLadderInvalid = false,
}: FinancialThresholdsSectionProps) {
  const mensajeDe = (campo: keyof FinancialThresholdsValues) => errors[campo];
  const describir = (campo: keyof FinancialThresholdsValues) => {
    const ids = [`${campo}-hint`];
    if (mensajeDe(campo)) ids.push(`${campo}-error`);
    return ids.join(" ");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" id="umbrales-title" className="flex items-center gap-2 text-base font-semibold">
          <DollarSign className="h-5 w-5 text-foreground" aria-hidden="true" /> Umbrales Financieros y Políticas de Aprobación
        </CardTitle>
        <CardDescription className="text-xs">
          Los umbrales financieros gobiernan autorizaciones por rol, topes corporativos de compras y el límite del fondo de caja chica.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {/* Límite Gerente */}
        <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded bg-muted p-1 text-muted-foreground">
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
            </div>
            <Label htmlFor="managerAuthLimit" className="text-xs font-semibold">
              Límite de Autonomía de Gerente
            </Label>
            <EstadoDePolitica input="managerAuthLimit" />
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
              $
            </span>
            <Input
              id="managerAuthLimit"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={values.managerAuthLimit}
              onChange={(e) => onChange("managerAuthLimit", e.target.value)}
              className="h-11 pl-7 pr-12 text-sm font-medium"
              aria-invalid={!!mensajeDe("managerAuthLimit") || authLadderInvalid}
              aria-describedby={
                authLadderInvalid
                  ? `${describir("managerAuthLimit")} auth-ladder-error`
                  : describir("managerAuthLimit")
              }
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-muted-foreground">
              MXN
            </span>
          </div>
          <ErrorDeCampo id="managerAuthLimit-error" mensaje={mensajeDe("managerAuthLimit")} />
          <p id="managerAuthLimit-hint" className="text-xs leading-tight text-muted-foreground">
            Gastos por debajo de este monto los autoriza un gerente de sucursal. Aplica cuando la empresa no
            capturó una regla de autorización para ese monto, y siempre lo resuelve alguien distinto de quien
            lo registró, salvo el dueño y el super administrador.
          </p>
        </div>

        {/* Umbral Dirección General */}
        <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded bg-muted p-1 text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            </div>
            <Label htmlFor="doubleApprovalThreshold" className="text-xs font-semibold">
              Umbral Autorización Dirección General
            </Label>
            <EstadoDePolitica input="doubleApprovalThreshold" />
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
              $
            </span>
            <Input
              id="doubleApprovalThreshold"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={values.doubleApprovalThreshold}
              onChange={(e) => onChange("doubleApprovalThreshold", e.target.value)}
              className="h-11 pl-7 pr-12 text-sm font-medium"
              aria-invalid={!!mensajeDe("doubleApprovalThreshold") || authLadderInvalid}
              aria-describedby={authLadderInvalid ? `doubleApprovalThreshold-hint auth-ladder-error` : describir("doubleApprovalThreshold")}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-muted-foreground">
              MXN
            </span>
          </div>
          <ErrorDeCampo id="doubleApprovalThreshold-error" mensaje={mensajeDe("doubleApprovalThreshold")} />
          {authLadderInvalid && (
            <p id="auth-ladder-error" role="alert" className="rounded-md border border-destructive/20 bg-destructive/10 p-2 text-xs text-destructive">
              Este umbral quedó por debajo del límite del gerente. La escalera de autorización no puede
              invertirse: Dirección General debe exigirse en un monto igual o mayor.
            </p>
          )}
          <p id="doubleApprovalThreshold-hint" className="text-xs leading-tight text-muted-foreground">
            Desde este monto el gasto exige la firma del dueño del grupo. No es doble firma: el sistema tiene un
            aprobador por gasto. Aplica cuando no hay una regla de autorización para ese monto.
            También aporta un umbral a la detección de fraccionamiento.
          </p>
        </div>

        {/* Fondo Caja Chica */}
        <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded bg-muted p-1 text-muted-foreground">
              <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
            </div>
            <Label htmlFor="pettyCashLimit" className="text-xs font-semibold">
              Fondo Fijo de Caja Chica por Sucursal
            </Label>
            <EstadoDePolitica input="pettyCashLimit" />
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
              $
            </span>
            <Input
              id="pettyCashLimit"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={values.pettyCashLimit}
              onChange={(e) => onChange("pettyCashLimit", e.target.value)}
              className="h-11 pl-7 pr-12 text-sm font-medium"
              aria-invalid={!!mensajeDe("pettyCashLimit")}
              aria-describedby={describir("pettyCashLimit")}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-muted-foreground">
              MXN
            </span>
          </div>
          <ErrorDeCampo id="pettyCashLimit-error" mensaje={mensajeDe("pettyCashLimit")} />
          <p id="pettyCashLimit-hint" className="text-xs leading-tight text-muted-foreground">
            Tope corporativo para el fondo fijo por sucursal. Aplica en apertura y reapertura de
            fondos, y la reposición no puede exceder el fondo fijo autorizado. Cero deshabilita
            la caja chica; vacío permite abrir sin tope de grupo. Los retiros se acotan al saldo en caja.
          </p>
        </div>

        {/* Tope Mensual Compras de Emergencia */}
        <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded bg-muted p-1 text-muted-foreground">
              <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
            </div>
            <Label htmlFor="emergencyPurchaseCap" className="text-xs font-semibold">
              Tope Mensual Compras de Emergencia
            </Label>
            <EstadoDePolitica input="emergencyCap" />
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
              $
            </span>
            <Input
              id="emergencyPurchaseCap"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={values.emergencyCap}
              onChange={(e) => onChange("emergencyCap", e.target.value)}
              placeholder="Sin límite fijado"
              className="h-11 pl-7 pr-12 text-sm font-medium"
              aria-invalid={!!mensajeDe("emergencyCap")}
              aria-describedby={describir("emergencyCap")}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-muted-foreground">
              MXN
            </span>
          </div>
          <ErrorDeCampo id="emergencyCap-error" mensaje={mensajeDe("emergencyCap")} />
          <p id="emergencyCap-hint" className="text-xs leading-tight text-muted-foreground">
            Acumulado mensual permitido de compras urgentes por sucursal. Sólo se consulta en documentos
            marcados como emergencia: si el acumulado más la orden supera el tope, el envío se rechaza. Las órdenes
            normales no pasan por aquí, sino por presupuesto y centro de costo.
          </p>
        </div>

        {/* Tope Mensual Cortesías y Personal */}
        <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3.5 md:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded bg-muted p-1 text-muted-foreground">
              <DollarSign className="h-3.5 w-3.5" aria-hidden="true" />
            </div>
            <Label htmlFor="courtesyWasteCap" className="text-xs font-semibold">
              Tope Mensual de Cortesías y Consumo de Personal (Grupo Completo)
            </Label>
            <EstadoDePolitica input="courtesyWasteCap" />
          </div>
          <div className="relative max-w-md">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
              $
            </span>
            <Input
              id="courtesyWasteCap"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={values.courtesyWasteCap}
              onChange={(e) => onChange("courtesyWasteCap", e.target.value)}
              placeholder="Sin límite fijado"
              className="h-11 pl-7 pr-12 text-sm font-medium"
              aria-invalid={!!mensajeDe("courtesyWasteCap")}
              aria-describedby={describir("courtesyWasteCap")}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-muted-foreground">
              MXN
            </span>
          </div>
          <ErrorDeCampo id="courtesyWasteCap-error" mensaje={mensajeDe("courtesyWasteCap")} />
          <p id="courtesyWasteCap-hint" className="text-xs leading-tight text-muted-foreground">
            Presupuesto mensual consolidado para mermas por consumo de colaboradores y atenciones a
            comensales. Hasta el tope aprueba un gerente; al superarlo se requiere administrador o superior.
            Sólo aplica a esas dos clases de merma. Una merma sin costo conocido no escala por monto.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
