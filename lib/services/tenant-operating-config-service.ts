// Fase 11 / T41: Tenant Operating Model Config Service
// Manages the 7 structural dimensions of the tenant operating model (design §2)
// and financial authorization thresholds in cents.

import { db } from "@/lib/db";
import { tenantOperatingConfig } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export interface TenantOperatingConfigInput {
  purchasingStructure?: "CENTRALIZADA" | "POR_SUCURSAL" | "HIBRIDO";
  foodProduction?: "IN_SITU" | "COCINA_CENTRAL" | "MIXTO";
  treasuryModel?: "CUENTA_UNICA" | "CUENTA_POR_SUCURSAL" | "MIXTO";
  supplierPayment?: "CENTRALIZADO" | "POR_SUCURSAL" | "HIBRIDO";
  managerAutonomy?: "ALTA" | "MEDIA" | "BAJA";
  payrollDispersion?: "CONSOLIDADA" | "POR_RAZON_SOCIAL" | "MIXTO";
  tenantType?: "GRUPO_PROPIO" | "MIXTO_FRANQUICIAS";
  managerAuthLimitCents?: number;
  doubleApprovalThresholdCents?: number;
  pettyCashLimitCents?: number;
}

export async function getTenantOperatingConfig(companyId: string) {
  const [existing] = await db
    .select()
    .from(tenantOperatingConfig)
    .where(eq(tenantOperatingConfig.companyId, companyId))
    .limit(1);

  if (existing) return existing;

  // Case A defaults (centralized group, medium autonomy)
  const [created] = await db
    .insert(tenantOperatingConfig)
    .values({
      companyId,
      purchasingStructure: "CENTRALIZADA",
      foodProduction: "IN_SITU",
      treasuryModel: "CUENTA_UNICA",
      supplierPayment: "CENTRALIZADO",
      managerAutonomy: "MEDIA",
      payrollDispersion: "CONSOLIDADA",
      tenantType: "GRUPO_PROPIO",
      managerAuthLimitCents: 100000, // $1,000 MXN default
      doubleApprovalThresholdCents: 1000000, // $10,000 MXN default
      pettyCashLimitCents: 500000, // $5,000 MXN default
    })
    .returning();

  return created;
}

export async function upsertTenantOperatingConfig(
  companyId: string,
  input: TenantOperatingConfigInput
) {
  const existing = await getTenantOperatingConfig(companyId);

  const [updated] = await db
    .update(tenantOperatingConfig)
    .set({
      ...input,
      updatedAt: new Date(),
    })
    .where(eq(tenantOperatingConfig.id, existing.id))
    .returning();

  return updated;
}
