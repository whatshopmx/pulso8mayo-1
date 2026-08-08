"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Check, Lock, Loader2 } from "lucide-react";

interface TierPayload {
  slug: "foundation" | "growth" | "executive";
  label: string;
  features: string[];
  maxBranches: number;
  branchCount: number;
  overLimit: boolean;
  source: "subscription" | "branch_count";
  status: string;
}

interface CatalogTier {
  id: string;
  slug: string;
  name: string;
  maxBranches: number;
  features: unknown;
  sortOrder: number;
}

/** Etiquetas legibles de los feature-slugs; un slug sin entrada se muestra tal cual. */
const FEATURE_LABELS: Record<string, string> = {
  operational_twin: "Gemelo operativo",
  workflows: "Flujos de trabajo",
  evidence_store: "Bóveda de evidencia",
  dashboard: "Dashboard",
  alerts: "Alertas",
  morning_brief: "Morning Brief diario",
  basic_ai: "IA básica",
  executive_twin: "Gemelo ejecutivo",
  cash_flow_intelligence: "Inteligencia de flujo de efectivo",
  brand_intelligence: "Inteligencia de marca",
  procurement_intelligence: "Inteligencia de compras",
  knowledge_engine: "Motor de conocimiento",
  benchmarking: "Benchmarking entre sucursales",
  auto_recommendations: "Recomendaciones automáticas",
  corporate_playbooks: "Playbooks corporativos",
  full_executive_committee: "Comité ejecutivo completo",
  risk_prediction: "Predicción de riesgo",
  financial_planning: "Planeación financiera",
  expansion_simulations: "Simulaciones de expansión",
  api_access: "Acceso API",
  erp_integrations: "Integraciones ERP",
  ai_copilot: "Copiloto IA",
  weekly_executive_meeting: "Junta ejecutiva semanal",
};

const TIER_ORDER = ["foundation", "growth", "executive"] as const;

export function TierBanner() {
  const [tier, setTier] = useState<TierPayload | null>(null);
  const [catalog, setCatalog] = useState<CatalogTier[]>([]);
  const [allFeatures, setAllFeatures] = useState<
    { feature: string; tier: string; tierLabel: string; active: boolean }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [subRes, featRes] = await Promise.all([
        fetch("/api/company/subscription"),
        fetch("/api/company/features"),
      ]);
      const subJson = await subRes.json().catch(() => null);
      const featJson = await featRes.json().catch(() => null);

      if (!subRes.ok || !subJson?.success) {
        setError(subJson?.error?.message ?? "No se pudo cargar el plan.");
        return;
      }

      setTier(subJson.data.tier);
      setCatalog(subJson.data.catalog ?? []);
      setAllFeatures(featRes.ok && featJson?.success ? featJson.data.features : []);
    } catch {
      setError("Error de conexión al cargar el plan.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const changeTier = async (slug: string) => {
    setSaving(slug);
    try {
      const res = await fetch("/api/company/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tierSlug: slug }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        toast.error(json?.error?.message ?? "No se pudo cambiar el plan.");
        return;
      }
      toast.success(`Plan actualizado a ${json.data.tier.label}.`);
      await load();
    } catch {
      toast.error("Error de conexión al cambiar el plan.");
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !tier) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Plan del grupo</CardTitle>
          <CardDescription>{error ?? "Sin datos de plan."}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" onClick={load}>
            Reintentar
          </Button>
        </CardContent>
      </Card>
    );
  }

  const usagePct = tier.maxBranches > 0
    ? Math.min(100, Math.round((tier.branchCount / tier.maxBranches) * 100))
    : 0;

  const locked = allFeatures.filter((f) => !f.active);
  const nextTier = TIER_ORDER[TIER_ORDER.indexOf(tier.slug) + 1];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                Plan {tier.label}
                <Badge variant={tier.status === "ACTIVE" ? "default" : "secondary"}>
                  {tier.status === "DERIVED" ? "Derivado por tamaño" : tier.status}
                </Badge>
              </CardTitle>
              <CardDescription>
                {tier.source === "subscription"
                  ? "Plan contratado por el grupo."
                  : "Sin suscripción registrada: el plan se deriva del número de sucursales activas."}
              </CardDescription>
            </div>
            {nextTier && (
              <Button
                size="sm"
                disabled={saving !== null}
                onClick={() => changeTier(nextTier)}
              >
                {saving === nextTier ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : null}
                Subir a {catalog.find((c) => c.slug === nextTier)?.name ?? nextTier}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Sucursales activas</span>
              <span className="font-medium">
                {tier.branchCount} / {tier.maxBranches}
              </span>
            </div>
            <Progress value={usagePct} />
          </div>

          {tier.overLimit && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />
              <p>
                El grupo tiene {tier.branchCount} sucursales activas y el plan{" "}
                {tier.label} incluye {tier.maxBranches}. Sube de plan para no
                perder cobertura de las sucursales excedentes.
              </p>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            {(tier.features as string[]).map((f) => (
              <div key={f} className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>{FEATURE_LABELS[f] ?? f}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {locked.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Disponible en planes superiores</CardTitle>
            <CardDescription>
              Estas capacidades están visibles pero deshabilitadas en tu plan actual.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {locked.map((f) => (
              <div
                key={f.feature}
                className="flex items-center justify-between gap-2 rounded-md border border-dashed p-2 text-sm opacity-70"
              >
                <span className="flex items-center gap-2">
                  <Lock className="h-3.5 w-3.5 shrink-0" />
                  {FEATURE_LABELS[f.feature] ?? f.feature}
                </span>
                <Badge variant="outline" className="shrink-0">
                  {f.tierLabel}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cambiar de plan</CardTitle>
          <CardDescription>
            El cambio afecta el gateo de features. La facturación real se gestiona
            aparte.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {catalog.map((c) => (
            <Button
              key={c.id}
              variant={c.slug === tier.slug ? "default" : "outline"}
              size="sm"
              disabled={c.slug === tier.slug || saving !== null}
              onClick={() => changeTier(c.slug)}
            >
              {saving === c.slug ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              {c.name} · hasta {c.maxBranches}
            </Button>
          ))}
          {catalog.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Catálogo vacío. Corre{" "}
              <code className="text-xs">npx tsx scripts/seed-subscription-tiers.ts</code>.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
