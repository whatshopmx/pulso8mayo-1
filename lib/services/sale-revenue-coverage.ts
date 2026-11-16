import { sql } from "drizzle-orm";
import { salesEntries } from "@/lib/db/schema";

/** La proyección contiene un subtotal, no demuestra por sí sola ingreso completo.
 * Elegir el head ANTES de filtrar receta evita revivir una revisión remapeada.
 * Las ventas legadas sin procedencia canónica quedan pendientes de recuperación.
 */
export const saleRevenueComplete = sql<boolean>`COALESCE((
  SELECT count(*) > 0 AND count(h.total_revenue) = count(*)
    AND sum(h.total_revenue) = ${salesEntries.totalRevenue}
    AND sum(h.quantity_sold) = ${salesEntries.quantitySold}
  FROM (
    SELECT DISTINCT ON (r.identity_id) r.recipe_id, r.quantity_sold, r.total_revenue
    FROM public.sales_consumption_revisions r
    JOIN public.sales_consumption_identities i ON i.id = r.identity_id
      AND i.company_id = r.company_id AND i.branch_id = r.branch_id
    WHERE i.company_id = ${salesEntries.companyId}
      AND i.branch_id = ${salesEntries.branchId}
      AND i.sale_day = ${salesEntries.saleDate}::date
    ORDER BY r.identity_id, r.revision DESC
  ) h WHERE h.recipe_id = ${salesEntries.recipeId}
), false)`;
