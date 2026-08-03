/**
 * Predictions Panel — Executive Dashboard
 *
 * Shows the highest-risk prediction across all branches, formatted
 * like the design mockup: probability, contributing factors, and
 * recommended actions.
 *
 * Server Component.
 */

import { PredictiveScoringService } from "@/lib/services/predictive-scoring-service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain, TrendingUp, Lightbulb, AlertTriangle } from "lucide-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function riskColor(probability: number): "destructive" | "secondary" | "outline" {
  if (probability >= 70) return "destructive";
  if (probability >= 40) return "outline"; // amber/warning
  return "secondary";
}

function riskLabel(riskType: string): string {
  switch (riskType) {
    case "compliance":
      return "Compliance NOM-251";
    case "merma":
      return "Merma";
    case "rotacion":
      return "Rotación de Personal";
    default:
      return riskType;
  }
}

function factorBadge(status: "good" | "warning" | "critical"): string {
  switch (status) {
    case "critical":
      return "bg-red-50 text-destructive dark:bg-red-950 dark:text-red-400 border-destructive/30";
    case "warning":
      return "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400 border-amber-500/30";
    case "good":
      return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-emerald-500/30";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export async function PredictionsPanel({ companyId }: { companyId: string }) {
  const predictions = await PredictiveScoringService.predictAll(companyId);

  if (predictions.length === 0) {
    return (
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Brain className="h-5 w-5 text-muted-foreground" />
            Predicciones
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Sin datos suficientes para generar predicciones. Se necesitan al
            menos 7 días de actividad.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Show top 2 predictions (the highest-risk ones)
  const top = predictions.slice(0, 2);

  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <Brain className="h-5 w-5 text-violet-500" />
          Pulso Inteligente
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {top.map((pred) => (
          <div key={`${pred.branchId}-${pred.riskType}`} className="space-y-3">
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">{pred.branchName}</p>
                <p className="text-xs text-muted-foreground">
                  Riesgo: {riskLabel(pred.riskType)}
                </p>
              </div>
              <Badge variant={riskColor(pred.probability)} className="text-sm">
                {pred.probability}% probabilidad
              </Badge>
            </div>

            {/* Main prediction text */}
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">{pred.branchName}</strong>{" "}
              tiene{" "}
              <strong className="text-foreground">
                {pred.probability}% de probabilidad
              </strong>{" "}
              de{" "}
              {pred.riskType === "compliance"
                ? "bajar de 80 en compliance NOM-251 en los próximos 14 días"
                : pred.riskType === "merma"
                  ? "superar el umbral crítico de merma en las próximas 2 semanas"
                  : "tener rotación de personal por encima del promedio en 30 días"}
              .
            </p>

            {/* Factors */}
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Factores detectados
              </p>
              <div className="flex flex-wrap gap-1.5">
                {pred.factors
                  .filter((f) => f.status !== "good")
                  .map((f, i) => (
                    <Badge
                      key={i}
                      variant="outline"
                      className={`text-xs ${factorBadge(f.status)}`}
                    >
                      {f.currentValue}
                    </Badge>
                  ))}
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <Lightbulb className="h-3 w-3" />
                Acciones recomendadas
              </p>
              <ol className="list-decimal list-inside space-y-1">
                {pred.recommendedActions.slice(0, 4).map((action, i) => (
                  <li key={i} className="text-xs text-muted-foreground">
                    {action}
                  </li>
                ))}
              </ol>
            </div>

            {/* Estimated impact */}
            {pred.factors.filter((f) => f.status !== "good").length > 1 && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                Cumpliendo estas acciones, la probabilidad estimada baja a ~
                {Math.max(0, Math.round(pred.probability * 0.3))}%
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
