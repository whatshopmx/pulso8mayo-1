"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Target, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

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
}

export function CostTargetsSection({
  values,
  onChange,
  foodPairInvalid,
  laborPairInvalid,
  marginPairInvalid,
}: CostTargetsSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Target className="w-5 h-5 text-foreground" /> Objetivos de Costo y Semáforos Financieros
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
}: TargetPairProps) {
  const errorId = `${idPrefix}-error`;
  const tVal = Math.min(100, Math.max(0, parseFloat(targetValue) || 0));
  const wVal = Math.min(100, Math.max(0, parseFloat(warnValue) || 0));

  return (
    <div className="space-y-3 pb-5 border-b border-border/60 last:border-b-0 last:pb-0">
      <div>
        <p className="text-xs font-semibold text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground leading-tight">{hint}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}Target`} className="text-xs">
            {targetLabel}
          </Label>
          <div className="relative">
            <Input
              id={`${idPrefix}Target`}
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={targetValue}
              onChange={(e) => onTargetChange(e.target.value)}
              className="pr-8 text-sm font-medium"
              required
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">
              %
            </span>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}Warn`} className="text-xs">
            {warnLabel}
          </Label>
          <div className="relative">
            <Input
              id={`${idPrefix}Warn`}
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={warnValue}
              onChange={(e) => onWarnChange(e.target.value)}
              className="pr-8 text-sm font-medium"
              required
              aria-invalid={invalid}
              aria-describedby={invalid ? errorId : undefined}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">
              %
            </span>
          </div>
        </div>
      </div>

      {/* Visual Spectrum Gauge */}
      {!invalid && (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
            <span>0%</span>
            <span>
              {isHigherBetter
                ? `Alerta: <${wVal}% · Óptimo: >${tVal}%`
                : `Óptimo: <${tVal}% · Alerta: >${wVal}%`}
            </span>
            <span>100%</span>
          </div>

          <div
            className="h-2.5 w-full rounded-full overflow-hidden flex bg-muted/60 border border-border/50"
            role="progressbar"
            aria-label={`Rango de semáforo para ${label}`}
          >
            {isHigherBetter ? (
              <>
                {/* Red Zone (0 to warn) */}
                <div
                  style={{ width: `${wVal}%` }}
                  className="bg-destructive/80 transition-all duration-300"
                  title={`Zona Roja (Crítica): 0% a ${wVal}%`}
                />
                {/* Yellow Zone (warn to target) */}
                <div
                  style={{ width: `${Math.max(0, tVal - wVal)}%` }}
                  className="bg-amber-500/80 transition-all duration-300"
                  title={`Zona Amarilla (Precaución): ${wVal}% a ${tVal}%`}
                />
                {/* Green Zone (target to 100) */}
                <div
                  style={{ width: `${Math.max(0, 100 - tVal)}%` }}
                  className="bg-emerald-500/80 transition-all duration-300"
                  title={`Zona Verde (Saludable): ${tVal}% a 100%`}
                />
              </>
            ) : (
              <>
                {/* Green Zone (0 to target) */}
                <div
                  style={{ width: `${tVal}%` }}
                  className="bg-emerald-500/80 transition-all duration-300"
                  title={`Zona Verde (Saludable): 0% a ${tVal}%`}
                />
                {/* Yellow Zone (target to warn) */}
                <div
                  style={{ width: `${Math.max(0, wVal - tVal)}%` }}
                  className="bg-amber-500/80 transition-all duration-300"
                  title={`Zona Amarilla (Precaución): ${tVal}% a ${wVal}%`}
                />
                {/* Red Zone (warn to 100) */}
                <div
                  style={{ width: `${Math.max(0, 100 - wVal)}%` }}
                  className="bg-destructive/80 transition-all duration-300"
                  title={`Zona Roja (Crítica): ${wVal}% a 100%`}
                />
              </>
            )}
          </div>
        </div>
      )}

      {invalid && (
        <div
          id={errorId}
          role="alert"
          className="flex items-center gap-1.5 p-2 rounded-md bg-destructive/10 border border-destructive/20 text-xs text-destructive"
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>{invalidMessage}</span>
        </div>
      )}
    </div>
  );
}
