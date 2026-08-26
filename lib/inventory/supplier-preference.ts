// lib/inventory/supplier-preference.ts
//
// Proveedor principal vs alterno por insumo (manual loteprod §4). Lógica pura
// del reordenamiento: qué rango queda cada proveedor cuando se promueve uno a
// principal. Sin DB, para poder probar los casos feos —promover al que ya es
// principal, promover a uno sin rango, huecos en la numeración— sin sembrar
// nada.
//
// Regla de la BD que esta función debe respetar: a lo más UN rango 1 por
// (empresa, insumo). Por eso el resultado siempre reasigna rangos densos
// (1, 2, 3…) en vez de dejar dos filas peleando por el 1.

export interface SupplierRankRow {
  supplierId: string;
  /** null = está en el catálogo del insumo pero sin clasificar. */
  preferenceRank: number | null;
}

/**
 * Orden estable de los proveedores de un insumo: primero los rangueados por su
 * número, después los sin clasificar en el orden en que venían. El orden de
 * entrada decide los empates, así que el llamador debe traerlos ordenados por
 * algo determinista (rank asc nulls last, luego fecha de alta).
 */
export function sortByPreference(rows: SupplierRankRow[]): SupplierRankRow[] {
  return [...rows].sort((a, b) => {
    if (a.preferenceRank === b.preferenceRank) return 0;
    if (a.preferenceRank === null) return 1;
    if (b.preferenceRank === null) return -1;
    return a.preferenceRank - b.preferenceRank;
  });
}

/**
 * Rangos resultantes de promover `promotedSupplierId` a principal.
 *
 * - El promovido queda en 1.
 * - Los demás que YA tenían rango se recorren detrás, densos: 2, 3, 4…
 * - Los que no tenían rango siguen sin tenerlo: promover a uno no clasifica de
 *   golpe a todo el catálogo del insumo.
 * - Si el promovido no estaba en la lista, se agrega como principal (el
 *   servicio se encarga de que exista la fila en `supplier_items`).
 *
 * Devuelve SOLO las filas cuyo rango cambia — lo que hay que escribir.
 */
export function ranksAfterPromotion(
  rows: SupplierRankRow[],
  promotedSupplierId: string
): { supplierId: string; preferenceRank: number }[] {
  const ordenados = sortByPreference(rows);
  const cambios: { supplierId: string; preferenceRank: number }[] = [];

  const previo = new Map(rows.map((r) => [r.supplierId, r.preferenceRank]));
  if (previo.get(promotedSupplierId) !== 1) {
    cambios.push({ supplierId: promotedSupplierId, preferenceRank: 1 });
  }

  let siguiente = 2;
  for (const fila of ordenados) {
    if (fila.supplierId === promotedSupplierId) continue;
    // Sin rango previo se queda sin rango: es catálogo, no alternativa elegida.
    if (fila.preferenceRank === null) continue;
    if (fila.preferenceRank !== siguiente) {
      cambios.push({ supplierId: fila.supplierId, preferenceRank: siguiente });
    }
    siguiente += 1;
  }

  return cambios;
}

/** Etiqueta ES del rango, para no repetir el condicional en cada vista. */
export function preferenceRankLabel(rank: number | null | undefined): string {
  if (rank === null || rank === undefined) return "Sin clasificar";
  if (rank === 1) return "Principal";
  return `Alterno ${rank - 1}`;
}
