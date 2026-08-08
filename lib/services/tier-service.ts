/**
 * TierService — empaquetado por tamaño de cliente.
 *
 * Fuentes: docs/pulso-executive-os-v2.md §10.2 y
 * docs/pulso-diseno-grupo-restaurantero.md §16.
 *
 * Resolución del tier (AD-1, con la precedencia invertida respecto al borrador
 * del plan): una suscripción ACTIVA en `company_subscriptions` **manda**; el
 * conteo de sucursales solo se usa cuando no hay suscripción. Derivar siempre
 * por `branches.length` haría que un cliente que pagó Executive perdiera sus
 * features al cerrar una sucursal.
 *
 * El conteo de sucursales sigue importando para el *límite*: `overLimit` avisa
 * cuando el grupo ya rebasó `maxBranches` del tier contratado.
 */
import { db } from "@/lib/db";
import {
  branches,
  companySubscriptions,
  subscriptionTiers,
} from "@/lib/db/schema";
import { and, count, eq } from "drizzle-orm";

export type TierSlug = "foundation" | "growth" | "executive";

/**
 * Matriz de features por tier (ES v2 §10.2). Cada tier **incluye** los del
 * anterior — la herencia se resuelve en `featuresForTier`, no se duplica aquí.
 */
export const TIER_FEATURES = {
  foundation: [
    "operational_twin",
    "workflows",
    "evidence_store",
    "dashboard",
    "alerts",
    "morning_brief",
    "basic_ai",
  ],
  growth: [
    "executive_twin",
    "cash_flow_intelligence",
    "brand_intelligence",
    "procurement_intelligence",
    "knowledge_engine",
    "benchmarking",
    "auto_recommendations",
    "corporate_playbooks",
  ],
  executive: [
    "full_executive_committee",
    "risk_prediction",
    "financial_planning",
    "expansion_simulations",
    "api_access",
    "erp_integrations",
    "ai_copilot",
    "weekly_executive_meeting",
  ],
} as const;

export type FeatureSlug =
  | (typeof TIER_FEATURES)["foundation"][number]
  | (typeof TIER_FEATURES)["growth"][number]
  | (typeof TIER_FEATURES)["executive"][number];

/** Orden ascendente — usado para la herencia acumulativa y el ranking. */
export const TIER_ORDER: TierSlug[] = ["foundation", "growth", "executive"];

/** Límite de sucursales por tier cuando no hay fila en `subscription_tiers`. */
export const TIER_MAX_BRANCHES: Record<TierSlug, number> = {
  foundation: 5,
  growth: 15,
  executive: 50,
};

export const TIER_LABELS: Record<TierSlug, string> = {
  foundation: "Foundation",
  growth: "Growth",
  executive: "Executive",
};

export interface CompanyTier {
  slug: TierSlug;
  label: string;
  /** Features activas (acumulativas hasta este tier). */
  features: FeatureSlug[];
  maxBranches: number;
  branchCount: number;
  /** El grupo ya rebasó el límite del tier contratado. */
  overLimit: boolean;
  /** 'subscription' si vino de company_subscriptions; 'branch_count' si se derivó. */
  source: "subscription" | "branch_count";
  status: string;
  expiresAt: Date | null;
}

/** Features acumulativas hasta `slug` inclusive. */
export function featuresForTier(slug: TierSlug): FeatureSlug[] {
  const upTo = TIER_ORDER.slice(0, TIER_ORDER.indexOf(slug) + 1);
  return upTo.flatMap((t) => [...TIER_FEATURES[t]]) as FeatureSlug[];
}

/** Tier mínimo que incluye `feature` (para el CTA "Upgrade a X"). */
export function tierRequiredFor(feature: string): TierSlug | null {
  for (const slug of TIER_ORDER) {
    if ((TIER_FEATURES[slug] as readonly string[]).includes(feature)) return slug;
  }
  return null;
}

/** Tier derivado por número de sucursales (fallback sin suscripción). */
export function tierFromBranchCount(branchCount: number): TierSlug {
  if (branchCount <= TIER_MAX_BRANCHES.foundation) return "foundation";
  if (branchCount <= TIER_MAX_BRANCHES.growth) return "growth";
  return "executive";
}

function isTierSlug(value: string): value is TierSlug {
  return (TIER_ORDER as string[]).includes(value);
}

// ── Cache TTL en proceso ────────────────────────────────────────────────────
// El tier cambia con muy baja frecuencia pero se consulta en cada render de
// página gateada. 60s es suficiente para que un upgrade se refleje "al instante"
// desde la perspectiva del usuario sin martillar la DB.
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: CompanyTier }>();

export const TierService = {
  /** Invalida la cache de una compañía (o toda si se omite). */
  invalidate(companyId?: string): void {
    if (companyId) cache.delete(companyId);
    else cache.clear();
  },

  async getCompanyTier(companyId: string): Promise<CompanyTier> {
    const hit = cache.get(companyId);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

    const [branchRow] = await db
      .select({ n: count() })
      .from(branches)
      .where(and(eq(branches.companyId, companyId), eq(branches.active, true)));
    const branchCount = branchRow?.n ?? 0;

    const [sub] = await db
      .select({
        status: companySubscriptions.status,
        expiresAt: companySubscriptions.expiresAt,
        slug: subscriptionTiers.slug,
        maxBranches: subscriptionTiers.maxBranches,
        features: subscriptionTiers.features,
      })
      .from(companySubscriptions)
      .innerJoin(
        subscriptionTiers,
        eq(companySubscriptions.tierId, subscriptionTiers.id),
      )
      .where(eq(companySubscriptions.companyId, companyId))
      .limit(1);

    // Una suscripción CANCELLED no otorga features: cae al tier derivado.
    const subActive =
      sub &&
      (sub.status === "ACTIVE" || sub.status === "TRIAL") &&
      (!sub.expiresAt || sub.expiresAt.getTime() > Date.now()) &&
      isTierSlug(sub.slug);

    const slug: TierSlug = subActive
      ? (sub.slug as TierSlug)
      : tierFromBranchCount(branchCount);

    // `subscription_tiers.features` gana sobre la matriz estática cuando trae
    // datos: permite ajustar el empaquetado comercial sin deploy.
    const rowFeatures =
      subActive && Array.isArray(sub.features) && sub.features.length > 0
        ? (sub.features as FeatureSlug[])
        : null;

    const maxBranches = subActive
      ? sub.maxBranches
      : TIER_MAX_BRANCHES[slug];

    const value: CompanyTier = {
      slug,
      label: TIER_LABELS[slug],
      features: rowFeatures ?? featuresForTier(slug),
      maxBranches,
      branchCount,
      overLimit: branchCount > maxBranches,
      source: subActive ? "subscription" : "branch_count",
      status: subActive ? sub.status : "DERIVED",
      expiresAt: subActive ? sub.expiresAt : null,
    };

    cache.set(companyId, { at: Date.now(), value });
    return value;
  },

  async hasFeature(companyId: string, feature: string): Promise<boolean> {
    const tier = await this.getCompanyTier(companyId);
    return (tier.features as string[]).includes(feature);
  },

  /**
   * Estado de una feature para la UI: si está activa y, si no, qué tier hace
   * falta. Devuelve `allowed:true` con `requiredTier:null` para features
   * desconocidas — un slug mal escrito no debe bloquear una pantalla.
   */
  async getFeatureGate(
    companyId: string,
    feature: string,
  ): Promise<{ allowed: boolean; currentTier: TierSlug; requiredTier: TierSlug | null; reason: string }> {
    const tier = await this.getCompanyTier(companyId);
    const allowed = (tier.features as string[]).includes(feature);
    const requiredTier = tierRequiredFor(feature);

    if (allowed) {
      return { allowed: true, currentTier: tier.slug, requiredTier, reason: "included" };
    }
    if (!requiredTier) {
      return { allowed: true, currentTier: tier.slug, requiredTier: null, reason: "unknown_feature" };
    }
    return {
      allowed: false,
      currentTier: tier.slug,
      requiredTier,
      reason: `Requiere el plan ${TIER_LABELS[requiredTier]}`,
    };
  },

  /** Catálogo de tiers para la pantalla de plan. */
  async listTiers() {
    return db
      .select()
      .from(subscriptionTiers)
      .where(eq(subscriptionTiers.active, true))
      .orderBy(subscriptionTiers.sortOrder);
  },

  /**
   * Alta/cambio de tier. UPSERT sobre `company_subscriptions.company_id`
   * (único), de modo que llamar dos veces no deja dos suscripciones vivas.
   */
  async setTier(
    companyId: string,
    tierSlug: TierSlug,
    opts?: { status?: string; expiresAt?: Date | null; autoRenew?: boolean },
  ): Promise<CompanyTier> {
    const [tier] = await db
      .select({ id: subscriptionTiers.id })
      .from(subscriptionTiers)
      .where(eq(subscriptionTiers.slug, tierSlug))
      .limit(1);

    if (!tier) {
      throw new Error(
        `Tier '${tierSlug}' no existe. Corre 'npx tsx scripts/seed-subscription-tiers.ts'.`,
      );
    }

    await db
      .insert(companySubscriptions)
      .values({
        companyId,
        tierId: tier.id,
        status: opts?.status ?? "ACTIVE",
        expiresAt: opts?.expiresAt ?? null,
        autoRenew: opts?.autoRenew ?? true,
      })
      .onConflictDoUpdate({
        target: companySubscriptions.companyId,
        set: {
          tierId: tier.id,
          status: opts?.status ?? "ACTIVE",
          expiresAt: opts?.expiresAt ?? null,
          autoRenew: opts?.autoRenew ?? true,
          updatedAt: new Date(),
        },
      });

    this.invalidate(companyId);
    return this.getCompanyTier(companyId);
  },

  /** Cambia solo el estado (PAST_DUE, CANCELLED…) sin tocar el tier. */
  async setStatus(companyId: string, status: string): Promise<CompanyTier> {
    await db
      .update(companySubscriptions)
      .set({ status, updatedAt: new Date() })
      .where(eq(companySubscriptions.companyId, companyId));
    this.invalidate(companyId);
    return this.getCompanyTier(companyId);
  },
} as const;
