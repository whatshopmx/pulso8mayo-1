"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Brain, Loader2, Lock, Sparkles } from "lucide-react";

/**
 * Copiloto ejecutivo (T14b) — pregunta abierta sobre el estado del grupo.
 *
 * El panel se muestra SIEMPRE, tenga o no el tier la feature `ai_copilot`: sin
 * la feature la respuesta llega igual, pero construida con la heurística
 * determinista del servicio. Ocultarlo dejaría al usuario sin la lectura del
 * gemelo, que es dato propio; lo que se gatea es el razonamiento con LLM.
 */

export interface CopilotGate {
  allowed: boolean;
  currentTier: string;
  requiredTier: string | null;
  reason: string;
}

interface ReasoningSource {
  engineId: string;
  label: string;
  score: number;
  confidence: number;
  insights: string[];
  generatedAt: string | null;
}

interface ReasoningPriority {
  engineId: string;
  title: string;
  description: string;
  impact: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  estimatedSavingsCents: number | null;
  actionUrl: string | null;
}

interface ReasonedAnswer {
  question: string;
  answer: string;
  mode: "llm" | "heuristic";
  degraded: boolean;
  degradedReason: string | null;
  sources: ReasoningSource[];
  keyFacts: string[];
  priorities: ReasoningPriority[];
  generatedAt: string;
}

const SUGGESTIONS = [
  "¿Dónde estoy perdiendo dinero este mes?",
  "¿Qué sucursal necesita mi atención hoy?",
  "¿Puedo abrir una sucursal nueva este trimestre?",
];

const IMPACT_STYLES: Record<ReasoningPriority["impact"], string> = {
  CRITICAL: "bg-destructive text-destructive-foreground",
  HIGH: "bg-amber-500 text-white",
  MEDIUM: "bg-sky-500 text-white",
  LOW: "bg-muted text-muted-foreground",
};

const TIER_LABELS: Record<string, string> = {
  foundation: "Foundation",
  growth: "Growth",
  executive: "Executive",
};

export function ExecutiveCopilotClient({ gate }: { gate: CopilotGate }) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ReasonedAnswer | null>(null);

  async function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    try {
      const res = await fetch("/api/executive/reason", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.success) {
        toast.error(json?.error?.message ?? "No se pudo consultar al copiloto.");
        return;
      }
      setResult(json.data as ReasonedAnswer);
    } catch {
      toast.error("No se pudo consultar al copiloto.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Brain className="h-5 w-5 text-violet-500" />
              Copiloto ejecutivo
            </CardTitle>
            <CardDescription>
              Pregunta sobre el estado del grupo. La respuesta cita las lecturas que la sustentan.
            </CardDescription>
          </div>
          {!gate.allowed && gate.requiredTier && (
            <Badge variant="outline" className="gap-1">
              <Lock className="h-3 w-3" />
              Modo básico
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {!gate.allowed && gate.requiredTier && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-3">
            <p className="text-xs text-muted-foreground">
              Tu plan {TIER_LABELS[gate.currentTier] ?? gate.currentTier} responde con un
              resumen del gemelo. El razonamiento con IA requiere el plan{" "}
              {TIER_LABELS[gate.requiredTier] ?? gate.requiredTier}.
            </p>
            <Button size="sm" variant="outline" asChild>
              <Link href="/dashboard/company/subscription">Mejorar plan</Link>
            </Button>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
          className="space-y-2"
        >
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="¿Dónde estoy perdiendo dinero este mes?"
            maxLength={500}
            rows={2}
            disabled={loading}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(question);
              }
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <Button
                  key={s}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground"
                  disabled={loading}
                  onClick={() => {
                    setQuestion(s);
                    void ask(s);
                  }}
                >
                  {s}
                </Button>
              ))}
            </div>
            <Button type="submit" size="sm" disabled={loading || !question.trim()}>
              {loading ? (
                <>
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  Analizando
                </>
              ) : (
                <>
                  <Sparkles className="mr-1 h-3.5 w-3.5" />
                  Preguntar
                </>
              )}
            </Button>
          </div>
        </form>

        {result && (
          <div className="space-y-4 rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={result.mode === "llm" ? "default" : "secondary"}>
                {result.mode === "llm" ? "Razonado con IA" : "Resumen del gemelo"}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {new Date(result.generatedAt).toLocaleString("es-MX")}
              </span>
            </div>

            <p className="whitespace-pre-line text-sm leading-relaxed">{result.answer}</p>

            {result.priorities.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Prioridades relacionadas
                </h4>
                <ul className="space-y-1.5">
                  {result.priorities.slice(0, 3).map((p, i) => (
                    <li
                      key={`${p.engineId}-${i}`}
                      className="flex flex-wrap items-center gap-2 text-xs"
                    >
                      <Badge className={IMPACT_STYLES[p.impact]}>{p.impact}</Badge>
                      <span className="font-medium">{p.title}</span>
                      {p.actionUrl && (
                        <Link
                          href={p.actionUrl}
                          className="text-primary underline underline-offset-2"
                        >
                          Ver
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-1.5">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Fuentes
              </h4>
              {result.sources.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Ningún engine ha publicado lecturas todavía; la respuesta usa solo las
                  dimensiones del gemelo.
                </p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {result.sources.map((s) => (
                    <li key={s.engineId}>
                      <Badge variant="outline" className="font-normal">
                        {s.label}: {s.score}/100 · confianza {s.confidence}%
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
