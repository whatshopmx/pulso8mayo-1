import { sql } from "drizzle-orm";

/** La proyección contiene un subtotal, no demuestra por sí sola ingreso completo.
 * Elegir el head ANTES de filtrar receta evita revivir una revisión remapeada.
 * Las ventas legadas sin procedencia canónica quedan pendientes de recuperación.
 * Calificar las referencias externas literalmente: el SELECT de Drizzle elimina
 * calificadores de objetos Column en proyecciones de una sola tabla, incluso
 * dentro de subconsultas, donde los nombres quedarían ambiguos o autocorrelados.
 */
export const saleRevenueComplete = sql<boolean>`COALESCE((
  SELECT count(*) > 0 AND count(h.total_revenue) = count(*)
    AND sum(h.total_revenue) = "sales_entries"."total_revenue"
    AND sum(h.quantity_sold) = "sales_entries"."quantity_sold"
  FROM (
    SELECT DISTINCT ON (r.identity_id) r.recipe_id, r.quantity_sold, r.total_revenue
    FROM public.sales_consumption_revisions r
    JOIN public.sales_consumption_identities i ON i.id = r.identity_id
      AND i.company_id = r.company_id AND i.branch_id = r.branch_id
    WHERE i.company_id = "sales_entries"."company_id"
      AND i.branch_id = "sales_entries"."branch_id"
      AND i.sale_day = "sales_entries"."sale_date"::date
    ORDER BY r.identity_id, r.revision DESC
  ) h WHERE h.recipe_id = "sales_entries"."recipe_id"
), false)`;
