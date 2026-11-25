"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Target, AlertTriangle } from "lucide-react";

export interface CostTargetsValues {
  foodTarget: string;
  foodWarn: string;
  laborTarget: string;
  laborWarn: string;
  marginTarget: string;
  marginWarn: string;
}

interface CostTargetsSectionProps {
  values: CostTargetsValues;
  onChange: (key: keyof CostTargetsValues, value: string) => void;
  foodPairInvalid: boolean;
  laborPairInvalid: boolean;
  marginPairInvalid: boolean;
  /** Error del servidor por campo, ya traducido al nombre del input (C13). */
  errors?: Record<string, string>;
}

export function CostTargetsSection({
  values,
  onChange,
  foodPairInvalid,
  laborPairInvalid,
  marginPairInvalid,
  errors = {},
}: CostTargetsSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" id="costos-title" className="flex items-center gap-2 text-base font-semibold">
          <Target className="h-5 w-5 text-foreground" aria-hidden="true" /> Objetivos de Costo y Semáforos Financieros
        </CardTitle>
        <CardDescription className="text-xs">
          Calibra los rangos de rentabilidad del grupo. Estos umbrales rigen los semáforos de Food Cost, Labor Cost y Margen en los reportes ejecutivos.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <TargetPair
          idPrefix="foodCost"
          label="Food Cost (Costo de Alimentos y Bebidas)"
          hint="Costo de insumos, materias primas y mermas sobre la venta neta. En costos, menor es mejor."
          targetLabel="Objetivo (Zona Verde hasta)"
          warnLabel="Precaución (Zona Amarilla hasta)"
          targetValue={values.foodTarget}
          warnValue={values.foodWarn}
          onTargetChange={(val) => onChange("foodTarget", val)}
          onWarnChange={(val) => onChange("foodWarn", val)}
          invalid={foodPairInvalid}
          invalidMessage="En costos, el umbral de precaución debe ser mayor o igual al objetivo para permitir la zona amarilla antes del semáforo rojo."
          isHigherBetter={false}
          targetError={errors.foodTarget}
          warnError={errors.foodWarn}
        />

        <TargetPair
          idPrefix="laborCost"
          label="Labor Cost (Costo Laboral Operativo)"
          hint="Sueldos brutos operativos sobre la venta neta (sin provisiones anuales). Menor es mejor."
          targetLabel="Objetivo (Zona Verde hasta)"
          warnLabel="Precaución (Zona Amarilla hasta)"
          targetValue={values.laborTarget}
          warnValue={values.laborWarn}
          onTargetChange={(val) => onChange("laborTarget", val)}
          onWarnChange={(val) => onChange("laborWarn", val)}
          invalid={laborPairInvalid}
          invalidMessage="En costos, el umbral de precaución debe ser mayor o igual al objetivo para permitir la zona amarilla."
          isHigherBetter={false}
          targetError={errors.laborTarget}
          warnError={errors.laborWarn}
        />

        <TargetPair
          idPrefix="healthyMargin"
          label="Margen Saludable Tras Insumos y Mano de Obra"
          hint="100% menos Food Cost y Labor Cost (Prime Margin). Mayor porcentaje representa mayor salud operativa."
          targetLabel="Objetivo (Zona Verde desde)"
          warnLabel="Precaución (Zona Amarilla desde)"
          targetValue={values.marginTarget}
          warnValue={values.marginWarn}
          onTargetChange={(val) => onChange("marginTarget", val)}
          onWarnChange={(val) => onChange("marginWarn", val)}
          invalid={marginPairInvalid}
          invalidMessage="En margen, el piso de precaución debe ser menor o igual al objetivo: valores superiores indican mayor rentabilidad."
          isHigherBetter={true}
          targetError={errors.marginTarget}
          warnError={errors.marginWarn}
        />
      </CardContent>
    </Card>
  );
}

interface TargetPairProps {
  idPrefix: string;
  label: string;
  hint: string;
  targetLabel: string;
  warnLabel: string;
  targetValue: string;
  warnValue: string;
  onTargetChange: (value: string) => void;
  onWarnChange: (value: string) => void;
  invalid: boolean;
  invalidMessage: string;
  isHigherBetter: boolean;
  targetError?: string;
  warnError?: string;
}

function TargetPair({
  idPrefix,
  label,
  hint,
  targetLabel,
  warnLabel,
  targetValue,
  warnValue,
  onTargetChange,
  onWarnChange,
  invalid,
  invalidMessage,
  isHigherBetter,
  targetError,
  warnError,
}: TargetPairProps) {
  const errorId = `${idPrefix}-error`;
  const hintId = `${idPrefix}-hint`;
  const targetErrorId = `${idPrefix}Target-error`;
  const warnErrorId = `${idPrefix}Warn-error`;
  const tVal = Math.min(100, Math.max(0, parseFloat(targetValue) || 0));
  const wVal = Math.min(100, Math.max(0, parseFloat(warnValue) || 0));

  const zonas = isHigherBetter
    ? [
        { nombre: "Rojo", clase: "bg-destructive", rango: `0%–${wVal}%` },
        { nombre: "Amarillo", clase: "bg-warning", rango: `${wVal}%–${tVal}%` },
        { nombre: "Verde", clase: "bg-success", rango: `${tVal}%–100%` },
      ]
    : [
        { nombre: "Verde", clase: "bg-success", rango: `0%–${tVal}%` },
        { nombre: "Amarillo", clase: "bg-warning", rango: `${tVal}%–${wVal}%` },
        { nombre: "Rojo", clase: "bg-destructive", rango: `${wVal}%–100%` },
      ];

  const descripcionSemaforo = `Semáforo: ${zonas
    .map((zona) => `${zona.nombre.toLowerCase()} de ${zona.rango.replace("–", " a ")}`)
    .join("; ")}.`;

  return (
    <div className="space-y-3 border-b border-border/60 pb-5 last:border-b-0 last:pb-0">
      <div>
        <p className="text-xs font-semibold text-foreground">{label}</p>
        <p id={hintId} className="text-xs leading-tight text-muted-foreground">
          {hint}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}Target`} className="text-xs">
            {targetLabel}
          </Label>
          <div className="relative">
            <Input
              id={`${idPrefix}Target`}
              type="number"
              inputMode="decimal"
              min="0"
              max="100"
              step="0.1"
              value={targetValue}
              onChange={(e) => onTargetChange(e.target.value)}
              className="h-11 pr-8 text-sm font-medium"
              aria-invalid={!!targetError}
              aria-describedby={targetError ? `${hintId} ${targetErrorId}` : hintId}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-muted-foreground" aria-hidden="true">
              %
            </span>
          </div>
          {targetError && (
            <p id={targetErrorId} className="text-xs text-destructive">
              {targetError}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}Warn`} className="text-xs">
            {warnLabel}
          </Label>
          <div className="relative">
            <Input
              id={`${idPrefix}Warn`}
              type="number"
              inputMode="decimal"
              min="0"
              max="100"
              step="0.1"
              value={warnValue}
              onChange={(e) => onWarnChange(e.target.value)}
              className="h-11 pr-8 text-sm font-medium"
              aria-invalid={!!warnError || invalid}
              aria-describedby={
                warnError ? `${hintId} ${warnErrorId}` : invalid ? `${hintId} ${errorId}` : hintId
              }
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-muted-foreground" aria-hidden="true">
              %
            </span>
          </div>
          {warnError && (
            <p id={warnErrorId} className="text-xs text-destructive">
              {warnError}
            </p>
          )}
        </div>
      </div>

      {/* Semáforo: el color nunca es la única señal — cada zona lleva su rango en texto. */}
      <div className="space-y-1.5 pt-1">
        <div
          className={`flex h-2.5 w-full overflow-hidden rounded-full border border-border/50 bg-muted/60 ${invalid ? "opacity-50" : ""}`}
          role="img"
          aria-label={descripcionSemaforo}
        >
          {zonas.map((zona, indice) => {
            const inicio = indice === 0 ? 0 : parseFloat(zonas[indice - 1].rango.split("–")[1]);
            const fin = parseFloat(zona.rango.split("–")[1]);
            const ancho = zona.rango.endsWith("100%") ? Math.max(0, 100 - inicio) : Math.max(0, fin - inicio);
            return (
              <div
                key={zona.nombre}
                style={{ width: `${ancho}%` }}
                className={`${zona.clase} transition-all duration-300`}
              />
            );
          })}
        </div>

        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {zonas.map((zona) => (
            <li key={zona.nombre} className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${zona.clase}`} aria-hidden="true" />
              <span>
                {zona.nombre}: {zona.rango}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {invalid && (
        <div
          id={errorId}
          role="alert"
          className="flex items-center gap-1.5 rounded-md border border-destructive/20 bg-destructive/10 p-2 text-xs text-destructive"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{invalidMessage}</span>
        </div>
      )}
    </div>
  );
}
