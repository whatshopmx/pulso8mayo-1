// lib/services/sales-ingest-service.ts
//
// T6/T7 (`tasks/plan-inventario-desconexion.md`, Phase 2): AD-3 — las ventas
// son un *ingest*, no un form. Un solo servicio acepta filas normalizadas
// desde dos vías (pantalla corporativa de CSV y smart-link de cierre POS).
//
// La parte PURA (split de CSV, mapeo, normalización, guessMapping) vive en
// `sales-ingest-pure.ts` y se re-exporta aquí; este módulo solo añade la
// escritura a DB con idempotencia (`ingest`, AD-4) y la resolución de
// referencias de receta.

import { recipes, salesEntries } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { TheoreticalConsumptionService } from "@/lib/services/theoretical-consumption-service";
import {
  buildRows,
  type NormalizedSaleRow,
  type SalesRowError,
} from "@/lib/services/sales-ingest-pure";

export * from "@/lib/services/sales-ingest-pure";

export class SalesIngestService {
  /**
   * Fase pura del ingest: CSV crudo + mapeo → filas normalizadas + errores
   * accionables por fila. Las filas inválidas NO abortan el lote (AD-3).
   */
  static buildRows = buildRows;

  /**
   * Resuelve referencias de receta: UUID directo, o nombre exacto
   * (case-insensitive, trim) dentro de la empresa. Devuelve un mapa
   * ref → recipeId (null cuando no hay match — la fila va a errores, no
   * aborta el lote).
   *
   * Nota: `recipes` no tiene columna SKU/código (schema.ts:2530); si algún
   * cliente necesita resolver por SKU de ítem, se agrega aquí una segunda
   * pasada contra `inventory_items.sku` — hoy no existe ese flujo.
   */
  static async resolveRecipeRefs(
    companyId: string,
    refs: string[]
  ): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();
    const pending = new Set<string>();

    for (const ref of refs) {
      const trimmed = ref.trim();
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
        result.set(ref, trimmed.toLowerCase());
      } else {
        pending.add(trimmed.toLowerCase());
      }
    }

    if (pending.size > 0) {
      // Resolución por lotes para no reventar con archivos grandes. Import
      // dinámico: mantiene las funciones puras libres de conexión.
      const { db } = await import("@/lib/db");
      const matches = await db
        .select({ id: recipes.id, name: sql<string>`lower(${recipes.name})` })
        .from(recipes)
        .where(eq(recipes.companyId, companyId));

      const byName = new Map(matches.map((m) => [m.name, m.id]));
      for (const ref of refs) {
        if (result.has(ref)) continue;
        result.set(ref, byName.get(ref.trim().toLowerCase()) ?? null);
      }
    }

    return result;
  }

  /**
   * Escritura idempotente (AD-4 / T7): upsert por
   * `(companyId, branchId, saleDate, recipeId)`. Reimportar el mismo corte
   * reemplaza cantidad/ingreso (política keep-latest) y NO vuelve a descontar
   * consumo teórico — `consume` solo corre en filas realmente nuevas.
   *
   * Filas con la misma receta y día dentro del archivo se agregan antes de
   * escribir (un POS puede exportar varias líneas por hora).
   *
   * Devuelve `{inserted, skipped, errors[]}`: los errores incluyen las filas
   * cuya referencia de receta no resolvió (no abortan el lote, AD-3).
   */
  static async ingest(params: {
    companyId: string;
    branchId: string;
    userId: string;
    rows: NormalizedSaleRow[];
  }): Promise<{ inserted: number; skipped: number; errors: SalesRowError[] }> {
    const { companyId, branchId, userId } = params;

    // Agregado intra-archivo: receta+día → totales.
    const byRefDay = new Map<string, NormalizedSaleRow>();
    for (const row of params.rows) {
      const key = `${row.recipeRef.toLowerCase()}\u0000${row.saleDay}`;
      const prev = byRefDay.get(key);
      if (!prev) {
        byRefDay.set(key, { ...row });
      } else {
        prev.quantitySold += row.quantitySold;
        if (row.totalRevenueCents != null) {
          prev.totalRevenueCents = (prev.totalRevenueCents ?? 0) + row.totalRevenueCents;
        }
      }
    }
    const aggregated = [...byRefDay.values()];

    const resolved = await this.resolveRecipeRefs(
      companyId,
      aggregated.map((r) => r.recipeRef)
    );

    // Import dinámico, mismo criterio que `resolveRecipeRefs`: mantener la
    // carga del módulo libre de conexión para los scripts `verify-*`.
    const { db } = await import("@/lib/db");

    let inserted = 0;
    let skipped = 0;
    const errors: SalesRowError[] = [];

    for (const row of aggregated) {
      const recipeId = resolved.get(row.recipeRef);
      if (!recipeId) {
        errors.push({
          rowNumber: row.rowNumber,
          message: `Producto/receta no encontrada: "${row.recipeRef}"`,
        });
        continue;
      }

      // Medianoche del día local: `saleDay` ya viene normalizado sin huso, así
      // que el sello UTC-medianoche hace estable el roundtrip
      // `toISOString().slice(0,10)` que usan forecast/executive-report.
      const saleDate = new Date(`${row.saleDay}T00:00:00.000Z`);

      // Truco `xmax`: en Postgres, tras INSERT..ON CONFLICT DO UPDATE,
      // `xmax = 0` solo en la fila recién insertada.
      const [written] = await db
        .insert(salesEntries)
        .values({
          companyId,
          branchId,
          recipeId,
          quantitySold: row.quantitySold.toFixed(2),
          saleDate,
          totalRevenue: row.totalRevenueCents ?? 0,
        })
        .onConflictDoUpdate({
          target: [
            salesEntries.companyId,
            salesEntries.branchId,
            salesEntries.saleDate,
            salesEntries.recipeId,
          ],
          set: {
            quantitySold: sql`excluded.quantity_sold`,
            totalRevenue: sql`excluded.total_revenue`,
            updatedAt: new Date(),
          },
        })
        .returning({ isNew: sql<boolean>`xmax = 0` });

      if (written?.isNew) {
        inserted++;
        await TheoreticalConsumptionService.consume({
          companyId,
          branchId,
          recipeId,
          quantitySold: row.quantitySold,
          saleDate,
          userId,
        });
      } else {
        skipped++;
      }
    }

    return { inserted, skipped, errors };
  }
}
