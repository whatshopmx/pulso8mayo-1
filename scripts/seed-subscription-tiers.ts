/**
 * Seed idempotente del catálogo de tiers (ES v2 §10.2).
 *
 *   npx tsx scripts/seed-subscription-tiers.ts
 *
 * No borra nada: UPSERT por slug. Correr después de `pnpm db:migrate`.
 */
import { config } from "dotenv";
config({ path: ".env" });

import { db } from "@/lib/db";
import { subscriptionTiers } from "@/lib/db/schema";
import { featuresForTier, TIER_MAX_BRANCHES } from "@/lib/services/tier-service";

const TIERS = [
  {
    slug: "foundation",
    name: "Foundation",
    monthlyPriceCents: 0,
    maxBranches: TIER_MAX_BRANCHES.foundation,
    features: featuresForTier("foundation"),
    sortOrder: 1,
  },
  {
    slug: "growth",
    name: "Growth",
    monthlyPriceCents: 0,
    maxBranches: TIER_MAX_BRANCHES.growth,
    features: featuresForTier("growth"),
    sortOrder: 2,
  },
  {
    slug: "executive",
    name: "Executive",
    monthlyPriceCents: 0,
    maxBranches: TIER_MAX_BRANCHES.executive,
    features: featuresForTier("executive"),
    sortOrder: 3,
  },
] as const;

async function main() {
  console.log("Seeding subscription tiers...");

  for (const tier of TIERS) {
    await db
      .insert(subscriptionTiers)
      .values({
        slug: tier.slug,
        name: tier.name,
        monthlyPriceCents: tier.monthlyPriceCents,
        maxBranches: tier.maxBranches,
        features: tier.features,
        sortOrder: tier.sortOrder,
        active: true,
      })
      .onConflictDoUpdate({
        target: subscriptionTiers.slug,
        set: {
          name: tier.name,
          maxBranches: tier.maxBranches,
          features: tier.features,
          sortOrder: tier.sortOrder,
          active: true,
          updatedAt: new Date(),
        },
      });
    console.log(`  ✓ ${tier.name} (max ${tier.maxBranches} sucursales, ${tier.features.length} features)`);
  }

  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
