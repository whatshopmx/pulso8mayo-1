// lib/inventory/waste-kpi.ts
//
// Task 3 (plan-loteprod-gaps §8.1): criterio único de qué mermas suman a
// KPIs y pérdida real. Una merma PENDING_APPROVAL aún no es consumo aceptado
// y una REJECTED jamás movió inventario — ninguna de las dos puede inflar un
// porcentaje de merma. Server-only: arrastra columnas de Drizzle.

import { sql } from "drizzle-orm";
import { inventoryWaste } from "@/lib/db/schema";

/** Condición SQL para AND-ear en cualquier aggregate de pérdida por merma. */
export const wasteLossEligible = sql`(${inventoryWaste.approvalStatus} IN ('AUTO', 'APPROVED'))`;
