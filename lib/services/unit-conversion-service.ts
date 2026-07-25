import { db } from "@/lib/db";
import { unitConversions } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export class UnitConversionService {
  static async getConversions(companyId: string) {
    return db.select()
      .from(unitConversions)
      .where(eq(unitConversions.companyId, companyId))
      .orderBy(unitConversions.fromUnit);
  }

  static async getConversionById(id: string, companyId: string) {
    return db.query.unitConversions.findFirst({
      where: and(
        eq(unitConversions.id, id),
        eq(unitConversions.companyId, companyId)
      ),
    });
  }

  static async createConversion(data: {
    companyId: string;
    fromUnit: string;
    toUnit: string;
    factor: number;
    description?: string;
  }) {
    const [conversion] = await db.insert(unitConversions).values(data).returning();
    return conversion;
  }

  static async deleteConversion(id: string, companyId: string) {
    const [deleted] = await db.delete(unitConversions)
      .where(and(
        eq(unitConversions.id, id),
        eq(unitConversions.companyId, companyId)
      ))
      .returning();
    return deleted;
  }

  static async convert(quantity: number, from: string, to: string, companyId: string) {
    if (from === to) return quantity;

    const conversion = await db.query.unitConversions.findFirst({
      where: and(
        eq(unitConversions.fromUnit, from),
        eq(unitConversions.toUnit, to),
        eq(unitConversions.companyId, companyId)
      ),
    });

    if (conversion) {
      return quantity * conversion.factor;
    }

    const reverseConversion = await db.query.unitConversions.findFirst({
      where: and(
        eq(unitConversions.fromUnit, to),
        eq(unitConversions.toUnit, from),
        eq(unitConversions.companyId, companyId)
      ),
    });

    if (reverseConversion) {
      return quantity / reverseConversion.factor;
    }

    return null;
  }
}
