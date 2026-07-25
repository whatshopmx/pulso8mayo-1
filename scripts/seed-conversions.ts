import "dotenv/config";
import { db } from "@/lib/db";
import { unitConversions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const HORECA_CONVERSIONS = [
  { fromUnit: "KG", toUnit: "G", factor: 1000, description: "Kilogramos a Gramos" },
  { fromUnit: "G", toUnit: "KG", factor: 0.001, description: "Gramos a Kilogramos" },
  { fromUnit: "L", toUnit: "mL", factor: 1000, description: "Litros a Mililitros" },
  { fromUnit: "mL", toUnit: "L", factor: 0.001, description: "Mililitros a Litros" },
  { fromUnit: "BOX", toUnit: "UNIT", factor: 12, description: "Caja a Piezas (estándar 12)" },
  { fromUnit: "UNIT", toUnit: "BOX", factor: 1 / 12, description: "Piezas a Caja" },
  { fromUnit: "DOZEN", toUnit: "UNIT", factor: 12, description: "Docena a Piezas" },
  { fromUnit: "UNIT", toUnit: "DOZEN", factor: 1 / 12, description: "Piezas a Docena" },
  { fromUnit: "KG", toUnit: "LB", factor: 2.20462, description: "Kilogramos a Libras" },
  { fromUnit: "LB", toUnit: "KG", factor: 0.453592, description: "Libras a Kilogramos" },
  { fromUnit: "BOX", toUnit: "KG", factor: 10, description: "Caja a KG (ej: harina 10kg)" },
  { fromUnit: "KG", toUnit: "BOX", factor: 0.1, description: "KG a Caja" },
  { fromUnit: "L", toUnit: "BOX", factor: 0.0833, description: "Litros a Caja (ej: 12 botellas)" },
  { fromUnit: "BOX", toUnit: "L", factor: 12, description: "Caja a Litros" },
  { fromUnit: "BULTO", toUnit: "KG", factor: 25, description: "Bulto a KG (estándar 25kg)" },
  { fromUnit: "KG", toUnit: "BULTO", factor: 0.04, description: "KG a Bulto" },
];

async function main() {
  const companyId = process.argv[2];
  if (!companyId) {
    console.error("Usage: npx tsx scripts/seed-conversions.ts <companyId>");
    console.error("  Provide the company UUID to scope the conversions.");
    process.exit(1);
  }

  console.log(`Seeding ${HORECA_CONVERSIONS.length} conversions for company ${companyId}...`);

  await db.delete(unitConversions).where(eq(unitConversions.companyId, companyId));

  for (const conv of HORECA_CONVERSIONS) {
    await db.insert(unitConversions).values({
      companyId,
      fromUnit: conv.fromUnit,
      toUnit: conv.toUnit,
      factor: conv.factor,
      description: conv.description,
    });
  }

  console.log("Done! Conversions seeded successfully.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
