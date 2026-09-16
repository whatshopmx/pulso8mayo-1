"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Brain,
  Sparkles,
  Loader2,
  TrendingUp,
  Flame,
  ArrowRight,
  ShieldAlert,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ReasoningSource {
  engineId: string;
  label: string;
  score: number;
  confidence: number;
  insights: string[];
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
  sources: ReasoningSource[];
  keyFacts: string[];
  priorities: ReasoningPriority[];
}

interface SimulationScenario {
  id: string;
  icon: React.ElementType;
  title: string;
  description: string;
  prompt: string;
  impactTag: string;
}

const PRESET_SIMULATIONS: SimulationScenario[] = [
  {
    id: "ebitda-porciones",
    icon: TrendingUp,
    title: "Estandarización de Porciones & Recetas",
    description: "Analizar impacto en EBITDA al alinear el rendimiento de cocina de las tiendas con mayor merma al estándar de la mejor sucursal.",
    prompt: "¿Cuánto aumentaría el EBITDA consolidado si reducimos la merma y estandarizamos porciones en las sucursales con mayor costo de alimentos?",
    impactTag: "+$46K MXN/mes pot.",
  },
  {
    id: "inflacion-proteinas",
    icon: Flame,
    title: "Mitigación de Inflación en Carnes & Proteínas",
    description: "Simular impacto de un aumento del 7% en costos de proveedor cárnico sobre el Prime Cost de la red.",
    prompt: "¿Cómo mitigar el impacto de un aumento del 7% en costos de carne de res sin perder margen en el menú?",
    impactTag: "Protección Margen",
  },
  {
    id: "expansion-readiness",
    icon: Brain,
    title: "Capacidad de Absorción (Apertura Sucursal #6)",
    description: "Evaluar solidez de flujo de caja y capacidad de supervisión para determinar si el grupo puede absorber una nueva unidad este trimestre.",
    prompt: "¿Está la cadena lista para abrir una nueva sucursal este trimestre según la solidez de caja y disciplina operativa?",
    impactTag: "Evaluación Expansión",
  },
];

export function ExecutiveCopilotCard({ companyId }: { companyId: string }) {
  const [customQuestion, setCustomQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [result, setResult] = useState<ReasonedAnswer | null>(null);

  async function executeReasoning(promptText: string, scenarioId?: string) {
    if (!promptText.trim() || loading) return;

    setLoading(true);
    if (scenarioId) setActiveScenarioId(scenarioId);

    try {
      const res = await fetch("/api/executive/reason", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: promptText.trim() }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.success) {
        toast.error(json?.error?.message ?? "No se pudo procesar la consulta.");
        return;
      }

      setResult(json.data as ReasonedAnswer);
    } catch {
      toast.error("Error de conexión con el copiloto ejecutivo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-border bg-card shadow-none">
      <CardHeader className="pb-3 border-b border-border">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-500" />
              Socio Estratégico & Simulador de Decisiones
            </CardTitle>
            <CardDescription>
              Escenarios de optimización generados a partir del Executive Twin de la red
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-xs font-normal border-border w-fit">
            Motor Causal Multi-Unidad
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-4 sm:p-5 space-y-4">
        {/* 3 Pre-calculated simulation cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {PRESET_SIMULATIONS.map((sim) => {
            const Icon = sim.icon;
            const isSelected = activeScenarioId === sim.id && loading;

            return (
              <button
                key={sim.id}
                type="button"
                onClick={() => executeReasoning(sim.prompt, sim.id)}
                disabled={loading}
                className={cn(
                  "p-3.5 rounded-lg border text-left flex flex-col justify-between transition-all group",
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-border bg-muted/20 hover:border-border hover:bg-muted/40"
                )}
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Icon className="h-4 w-4 text-primary" />
                    <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-background border border-border text-foreground">
                      {sim.impactTag}
                    </span>
                  </div>
                  <h4 className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                    {sim.title}
                  </h4>
                  <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">
                    {sim.description}
                  </p>
                </div>

                <div className="mt-3 pt-2 border-t border-border/50 flex items-center justify-between text-[11px] font-medium text-primary">
                  <span>{isSelected ? "Simulando..." : "Correr simulación"}</span>
                  {isSelected ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Custom inquiry row */}
        <div className="flex gap-2">
          <Textarea
            placeholder="O escribe una pregunta estratégica... (ej. ¿Qué sucursal tiene mayor riesgo de fuga en nómina?)"
            value={customQuestion}
            onChange={(e) => setCustomQuestion(e.target.value)}
            disabled={loading}
            className="min-h-[42px] max-h-24 resize-none text-xs bg-background"
            rows={1}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                executeReasoning(customQuestion);
              }
            }}
          />
          <Button
            size="sm"
            disabled={loading || !customQuestion.trim()}
            onClick={() => executeReasoning(customQuestion)}
            className="shrink-0 h-auto text-xs"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Consultar"}
          </Button>
        </div>

        {/* Reasoning Result Display */}
        {result && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" />
                Diagnóstico del Directorio Digital
              </span>
              <span className="text-[10px] text-muted-foreground">
                Fuentes: {result.sources?.map((s) => s.label).join(", ") || "Executive Twin"}
              </span>
            </div>

            <p className="text-xs font-medium text-foreground leading-relaxed whitespace-pre-line">
              {result.answer}
            </p>

            {result.keyFacts && result.keyFacts.length > 0 && (
              <div className="pt-2 border-t border-border/50">
                <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1">
                  Hechos verificados en datos:
                </p>
                <ul className="space-y-1">
                  {result.keyFacts.map((fact, i) => (
                    <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                      <span className="text-primary font-bold">•</span>
                      <span>{fact}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
