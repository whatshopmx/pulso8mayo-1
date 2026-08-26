// lib/services/supplier-preference-service.ts
//
// Proveedor principal y alterno por insumo (manual loteprod §4). La fuente de
// verdad es `supplier_items.preference_rank`; `inventory_items.supplier_id` —lo
// que agrupa las OC del sugeridor— se mantiene como espejo del rango 1 para que
// "¿a quién le compro esto?" tenga UNA respuesta.
//
// Todo el reordenamiento pasa por `ranksAfterPromotion` (lógica pura, probada
// aparte) y se escribe dentro de una transacción: el único parcial de la BD
// (a lo más un rango 1 por insumo) rechaza cualquier intento de dejar dos
// principales, así que el orden de las escrituras importa — primero se sueltan
// los rangos viejos, después se asignan los nuevos.

import { db } from "@/lib/db";
import { supplierItems, suppliers, inventoryItems } from "@/lib/db/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { ranksAfterPromotion } from "@/lib/inventory/supplier-preference";
import { createChildLogger } from "@/lib/logger";

const logger = createChildLogger("supplier-preference");

export interface ItemSupplierRow {
  supplierId: string;
  supplierName: string;
  supplierActive: boolean;
  preferenceRank: number | null;
  supplierSku: string | null;
  price: number | null;
  presentation: string | null;
  leadTimeDays: number | null;
  paymentTermsDays: number;
  paymentMethod: string | null;
}

/** Proveedores del insumo, principal primero y sin clasificar al final. */
export async function listItemSuppliers(
  companyId: string,
  itemId: string
): Promise<ItemSupplierRow[]> {
  return db
    .select({
      supplierId: supplierItems.supplierId,
      supplierName: suppliers.name,
      supplierActive: suppliers.active,
      preferenceRank: supplierItems.preferenceRank,
      supplierSku: supplierItems.supplierSku,
      price: supplierItems.price,
      presentation: supplierItems.presentation,
      leadTimeDays: supplierItems.leadTimeDays,
      paymentTermsDays: suppliers.paymentTermsDays,
      paymentMethod: suppliers.paymentMethod,
    })
    .from(supplierItems)
    .innerJoin(suppliers, eq(supplierItems.supplierId, suppliers.id))
    .where(and(eq(supplierItems.companyId, companyId), eq(supplierItems.itemId, itemId)))
    // NULLS LAST explícito: en Postgres el default de ASC es NULLS LAST, pero
    // dejarlo implícito hace que el orden dependa de un default del motor.
    .orderBy(sql`${supplierItems.preferenceRank} asc nulls last`, asc(suppliers.name)) as Promise<
    ItemSupplierRow[]
  >;
}

/**
 * Promueve un proveedor a principal del insumo. Crea la fila del catálogo si no
 * existía (dar de alta al alterno y elegirlo es un solo gesto en la UI) y deja
 * `inventory_items.supplier_id` apuntando al nuevo principal.
 *
 * Devuelve null si el proveedor no es del tenant.
 */
export async function setPrimarySupplier(
  companyId: string,
  itemId: string,
  supplierId: string
) {
  return db.transaction(async (tx) => {
    const [proveedor] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.id, supplierId), eq(suppliers.companyId, companyId)))
      .limit(1);
    if (!proveedor) return null;

    const [insumo] = await tx
      .select({ id: inventoryItems.id })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.companyId, companyId)))
      .limit(1);
    if (!insumo) return null;

    const actuales = await tx
      .select({
        supplierId: supplierItems.supplierId,
        preferenceRank: supplierItems.preferenceRank,
      })
      .from(supplierItems)
      .where(and(eq(supplierItems.companyId, companyId), eq(supplierItems.itemId, itemId)))
      .orderBy(sql`${supplierItems.preferenceRank} asc nulls last`);

    const cambios = ranksAfterPromotion(actuales, supplierId);

    // El promovido puede no estar en el catálogo del insumo todavía.
    if (!actuales.some((a) => a.supplierId === supplierId)) {
      await tx
        .insert(supplierItems)
        .values({ companyId, supplierId, itemId })
        .onConflictDoNothing();
    }

    if (cambios.length > 0) {
      // Soltar primero TODOS los rangos que van a moverse: si se escribiera el
      // nuevo rango 1 antes de degradar al anterior, el único parcial de la BD
      // abortaría la transacción entera.
      const afectados = cambios.map((c) => c.supplierId);
      await tx
        .update(supplierItems)
        .set({ preferenceRank: null, updatedAt: new Date() })
        .where(
          and(
            eq(supplierItems.companyId, companyId),
            eq(supplierItems.itemId, itemId),
            inArray(supplierItems.supplierId, afectados)
          )
        );

      for (const cambio of cambios) {
        await tx
          .update(supplierItems)
          .set({ preferenceRank: cambio.preferenceRank, updatedAt: new Date() })
          .where(
            and(
              eq(supplierItems.companyId, companyId),
              eq(supplierItems.itemId, itemId),
              eq(supplierItems.supplierId, cambio.supplierId)
            )
          );
      }
    }

    // Espejo para el sugeridor de OC y todo lo que ya lee `supplier_id`.
    await tx
      .update(inventoryItems)
      .set({ supplierId, updatedAt: new Date() })
      .where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.companyId, companyId)));

    logger.info({ companyId, itemId, supplierId, cambios: cambios.length }, "Proveedor principal actualizado");
    return { itemId, supplierId, cambios };
  });
}

/**
 * Agrega al proveedor al final del orden de preferencia (primer alterno libre).
 * Es el gesto que hace posible el §4: tener al sustituto ya aprobado ANTES de
 * que el principal falle. Si ya venía rangueado, se respeta su lugar.
 */
export async function addAlternateSupplier(
  companyId: string,
  itemId: string,
  supplierId: string
) {
  return db.transaction(async (tx) => {
    const [proveedor] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.id, supplierId), eq(suppliers.companyId, companyId)))
      .limit(1);
    if (!proveedor) return null;

    const actuales = await tx
      .select({
        supplierId: supplierItems.supplierId,
        preferenceRank: supplierItems.preferenceRank,
      })
      .from(supplierItems)
      .where(and(eq(supplierItems.companyId, companyId), eq(supplierItems.itemId, itemId)));

    const yaRangueado = actuales.find(
      (a) => a.supplierId === supplierId && a.preferenceRank !== null
    );
    if (yaRangueado) return { itemId, supplierId, preferenceRank: yaRangueado.preferenceRank };

    const maxRango = actuales.reduce((max, a) => Math.max(max, a.preferenceRank ?? 0), 0);
    // Sin principal todavía, el primero en llegar lo es: dejarlo en 2 crearía
    // un insumo con alterno y sin principal, que no significa nada.
    const nuevoRango = maxRango + 1;

    await tx
      .insert(supplierItems)
      .values({ companyId, supplierId, itemId, preferenceRank: nuevoRango })
      .onConflictDoUpdate({
        target: [supplierItems.supplierId, supplierItems.itemId],
        set: { preferenceRank: nuevoRango, updatedAt: new Date() },
      });

    // Si quedó como principal (no había ninguno), el espejo debe seguirlo.
    if (nuevoRango === 1) {
      await tx
        .update(inventoryItems)
        .set({ supplierId, updatedAt: new Date() })
        .where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.companyId, companyId)));
    }

    return { itemId, supplierId, preferenceRank: nuevoRango };
  });
}

/**
 * Saca al proveedor del orden de preferencia sin borrarlo del catálogo: sigue
 * cotizando el insumo, pero deja de ser principal o alterno. Si era el
 * principal, el insumo queda sin principal a propósito — elegir el reemplazo es
 * una decisión de compras, no algo que el sistema deba adivinar.
 */
export async function clearSupplierPreference(
  companyId: string,
  itemId: string,
  supplierId: string
) {
  return db.transaction(async (tx) => {
    const [fila] = await tx
      .select({ preferenceRank: supplierItems.preferenceRank })
      .from(supplierItems)
      .where(
        and(
          eq(supplierItems.companyId, companyId),
          eq(supplierItems.itemId, itemId),
          eq(supplierItems.supplierId, supplierId)
        )
      )
      .limit(1);
    if (!fila) return null;

    await tx
      .update(supplierItems)
      .set({ preferenceRank: null, updatedAt: new Date() })
      .where(
        and(
          eq(supplierItems.companyId, companyId),
          eq(supplierItems.itemId, itemId),
          eq(supplierItems.supplierId, supplierId)
        )
      );

    if (fila.preferenceRank === 1) {
      await tx
        .update(inventoryItems)
        .set({ supplierId: null, updatedAt: new Date() })
        .where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.companyId, companyId)));
    }

    return { itemId, supplierId };
  });
}
