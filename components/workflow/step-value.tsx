"use client";

import * as React from "react";
import { Check, X, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResolvedReviewStep } from "@/lib/workflows/step-definitions";

/**
 * Muestra *lo que el operador registró*, interpretado según el tipo del paso.
 *
 * Antes esta superficie hacía `JSON.stringify(value)` para todo, porque el tipo
 * nunca llegaba a la revisión. Con el tipo resuelto, un Sí/No se lee como Sí/No,
 * una temperatura trae su unidad y su rango esperado, y un JSON crudo sólo
 * aparece cuando de verdad no sabemos qué es — rotulado como tal.
 */

/**
 * `value` es `jsonb`: llega como número, string, arreglo u objeto, y a veces
 * como string que *contiene* JSON. Se desenvuelve una sola vez, aquí.
 */
function parseValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!/^[[{]/.test(trimmed)) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

/**
 * El conteo de inventario guarda `{ systemQuantity, itemId, inputValue }` en
 * `value` (`workflow-execution-service.ts:88-93`): la respuesta real es
 * `inputValue` y `systemQuantity` es el dato contra el que se contrasta.
 */
function unwrapStockCount(value: unknown): { answer: unknown; systemQuantity?: unknown } {
  if (value && typeof value === "object" && !Array.isArray(value) && "inputValue" in value) {
    const record = value as { inputValue?: unknown; systemQuantity?: unknown };
    return { answer: record.inputValue ?? null, systemQuantity: record.systemQuantity };
  }
  return { answer: value };
}

function isEmptyAnswer(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function formatDate(value: unknown): string {
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString("es-MX", { year: "numeric", month: "long", day: "numeric" });
}

function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = Math.round(total % 60);
  if (minutes === 0) return `${seconds} s`;
  return `${minutes} min ${seconds.toString().padStart(2, "0")} s`;
}

/** Caja neutra para la respuesta, común a todos los tipos. */
function Answer({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("text-sm text-foreground", className)}>{children}</div>;
}

function Expected({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-muted-foreground">{children}</span>;
}

export interface StepValueProps {
  step: ResolvedReviewStep;
  className?: string;
}

export function StepValue({ step, className }: StepValueProps) {
  const { answer, systemQuantity } = unwrapStockCount(parseValue(step.value));

  // La evidencia visual ES la respuesta de estos pasos: la fila ya pinta las
  // miniaturas, repetir una URL aquí sería ruido.
  if (step.type === "PHOTO" || step.type === "VIDEO" || step.type === "AUDIO" || step.type === "INFO") {
    return null;
  }

  if (isEmptyAnswer(answer)) {
    return (
      <Answer className={cn("text-muted-foreground italic", className)}>
        Sin dato registrado
      </Answer>
    );
  }

  switch (step.type) {
    case "YESNO": {
      const raw = String(answer).trim().toUpperCase();
      const yes = raw === "SI" || raw === "SÍ" || raw === "YES" || raw === "TRUE";
      const no = raw === "NO" || raw === "FALSE";
      if (!yes && !no) break; // cae al genérico: no inventamos un veredicto
      return (
        <Answer className={cn("flex items-center gap-1.5 font-medium", className)}>
          {yes ? (
            <>
              <Check className="h-4 w-4 text-success shrink-0" aria-hidden="true" />
              <span className="text-success">Sí</span>
            </>
          ) : (
            <>
              <X className="h-4 w-4 text-destructive shrink-0" aria-hidden="true" />
              <span className="text-destructive">No</span>
            </>
          )}
        </Answer>
      );
    }

    case "CHECKBOX": {
      const selected = Array.isArray(answer) ? answer.map(String) : [String(answer)];
      // Con las opciones de la plantilla se ve lo *no* marcado, que en una
      // revisión suele importar más que lo marcado.
      const options = step.options ?? selected.map((value) => ({ value, label: value }));
      return (
        <Answer className={cn("space-y-1", className)}>
          <ul className="space-y-1">
            {options.map((option) => {
              const checked = selected.includes(option.value);
              return (
                <li key={option.value} className="flex items-center gap-1.5">
                  {checked ? (
                    <Check className="h-3.5 w-3.5 text-success shrink-0" aria-hidden="true" />
                  ) : (
                    <Minus className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
                  )}
                  <span className={checked ? "text-foreground" : "text-muted-foreground"}>
                    {option.label}
                  </span>
                </li>
              );
            })}
          </ul>
          {step.options && (
            <Expected>
              {selected.length} de {step.options.length} marcadas
            </Expected>
          )}
        </Answer>
      );
    }

    case "NUMBER":
    case "TIMER": {
      const numeric = Number(answer);
      if (!Number.isFinite(numeric)) break;

      if (step.type === "TIMER") {
        return <Answer className={cn("font-mono", className)}>{formatSeconds(numeric)}</Answer>;
      }

      const { min, max } = step.range ?? {};
      const belowMin = min !== undefined && numeric < min;
      const aboveMax = max !== undefined && numeric > max;
      const outOfRange = belowMin || aboveMax;

      return (
        <Answer className={cn("space-y-0.5", className)}>
          <div
            className={cn(
              "font-mono font-medium",
              outOfRange ? "text-destructive" : "text-foreground"
            )}
          >
            {numeric}
            {step.unit ? ` ${step.unit}` : ""}
            {outOfRange && (
              <span className="ml-2 text-xs font-sans font-semibold">
                {belowMin ? "por debajo del mínimo" : "por encima del máximo"}
              </span>
            )}
          </div>
          {step.range && (
            <Expected>
              Esperado:{" "}
              {min !== undefined && max !== undefined
                ? `entre ${min} y ${max}`
                : min !== undefined
                  ? `mínimo ${min}`
                  : `máximo ${max}`}
              {step.unit ? ` ${step.unit}` : ""}
            </Expected>
          )}
          {systemQuantity !== undefined && systemQuantity !== null && (
            <Expected>
              En sistema: {String(systemQuantity)}
              {step.unit ? ` ${step.unit}` : ""}
            </Expected>
          )}
        </Answer>
      );
    }

    case "SELECT": {
      const raw = String(answer);
      const match = step.options?.find((option) => option.value === raw);
      return (
        <Answer className={cn("space-y-0.5", className)}>
          <div className="font-medium">{match?.label ?? raw}</div>
          {step.options && !match && (
            <Expected>Opción fuera del catálogo de la plantilla</Expected>
          )}
        </Answer>
      );
    }

    case "DATE":
      return <Answer className={className}>{formatDate(answer)}</Answer>;

    case "TIME":
      return <Answer className={cn("font-mono", className)}>{String(answer)}</Answer>;

    case "LOCATION": {
      if (answer && typeof answer === "object") {
        const record = answer as { lat?: unknown; lng?: unknown; latitude?: unknown; longitude?: unknown };
        const lat = record.lat ?? record.latitude;
        const lng = record.lng ?? record.longitude;
        if (lat !== undefined && lng !== undefined) {
          return (
            <Answer className={cn("font-mono", className)}>
              {String(lat)}, {String(lng)}
            </Answer>
          );
        }
      }
      break;
    }

    case "SIGNATURE": {
      const raw = String(answer);
      if (raw.startsWith("data:image") || raw.startsWith("http")) {
        return (
          <img
            src={raw}
            alt="Firma registrada"
            loading="lazy"
            className={cn("h-20 w-auto rounded-md border border-border bg-background", className)}
          />
        );
      }
      return <Answer className={cn("text-muted-foreground", className)}>Firma registrada</Answer>;
    }

    case "TEXT":
      return <Answer className={cn("whitespace-pre-wrap", className)}>{String(answer)}</Answer>;
  }

  // Último recurso: tipo desconocido o valor con una forma que no corresponde al
  // tipo. Se muestra crudo pero rotulado, para que el revisor sepa que está
  // viendo un dato sin interpretar y no un formato "normal".
  if (typeof answer === "object") {
    return (
      <Answer className={cn("space-y-1", className)}>
        <pre className="overflow-x-auto rounded-md border border-border bg-background p-2.5 text-xs font-mono">
          {JSON.stringify(answer, null, 2)}
        </pre>
        <Expected>Formato no reconocido para este tipo de paso</Expected>
      </Answer>
    );
  }

  return <Answer className={cn("whitespace-pre-wrap", className)}>{String(answer)}</Answer>;
}
