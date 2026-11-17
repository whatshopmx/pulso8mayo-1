# INV-01.b4.coverage.menu — Cobertura de ingreso y rentabilidad en ingeniería de menú

Continuación 2026-11-17 sobre HEAD `0dfd139d75a5870d7af3baad5423d218f54a093f` más cambios locales. **Código implementado y V1 comprobada; sin aceptación (V2/V3 pendientes).** Depende de `INV-01.b4.coverage.cogs` y reutiliza el fragmento SQL `saleRevenueComplete`.

## Brecha cerrada

`app/api/inventory/menu-engineering/route.ts` agrupaba ventas por receta y hacía `revenueCents = Number(s.totalRevenue || 0)`: un ingreso `null` (venta sin revisión canónica completa) se convertía en cero, el food cost caía a la estimación estática de la receta (`foodCostPercentage`) y el platillo se clasificaba en un cuadrante (Estrella/Vaca/Incógnita/Peso) **como si fuera rentabilidad medida**. Es el mismo patrón corregido en COGS y en el dashboard ejecutivo.

Este incremento propaga la cobertura al módulo de menú:

- `route.ts`: lee filas de `sales_entries` (sin `GROUP BY`, porque la subconsulta correlacionada de `saleRevenueComplete` no cabe en un `count(*) filter (where …)` agrupado) y agrega por receta en JS. Cada platillo expone `reportedRevenueCents` (subtotal), `revenueCents` (`number | null`, firme solo con cobertura COMPLETE) y `revenueCoverage { status, totalEntries, completeEntries }`. `foodCostPercent`/`marginPercent` pasan a `number | null` y se calculan **solo** sobre ingreso completo; se elimina el fallback a `foodCostPercentage` como si fuese medición. Las medianas de margen se calculan solo con platillos COMPLETE; el resto queda `UNCLASSIFIED` (nuevo cuadrante) y nunca participa en la clasificación medida.
- `menu-engineering-matrix.tsx`: añade `UNCLASSIFIED` ("Sin dato — cobertura de ingreso incompleta") a la leyenda; el scatter solo grafica platillos con margen medido (los incompletos quedan en la tabla, no como punto); la tabla muestra "N/D"/"Parcial" y el badge "Sin dato"; el estado vacío distingue "sin rentabilidad medida" de "sin datos de ventas"; la línea de mediana de margen no se dibuja cuando `medianMargin` es `null`.

## Verificación (V1)

| Comando | Resultado |
|---|---|
| `pnpm.cmd exec vitest run --configLoader bundle --maxWorkers=1 --pool=threads tests/unit/inventory/menu-engineering-coverage.test.ts lib/services/__tests__/executive-report-coverage.test.ts lib/services/__tests__/cogs-revenue-coverage.test.ts` | **27/27, 3 archivos, exit 0** |
| `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc --noEmit --incremental false` | **exit 0** |
| `pnpm.cmd exec eslint app/api/inventory/menu-engineering/route.ts components/inventory/menu-engineering-matrix.tsx tests/unit/inventory/menu-engineering-coverage.test.ts` | **exit 0**, 0 errores, 4 advertencias preexistentes |

Casos nuevos (4): ingreso completo calcula 25% food cost / 75% margen y clasifica; ingreso parcial conserva subtotal 300 pero `revenueCents`/`foodCost`/`margin` null y `UNCLASSIFIED`; `revenue` null no se convierte en cero; sin unidades vendidas `medianMargin` null; todo parcial deja `medianMargin` null y ningún cuadrante medido.

## Límites

- **V1 únicamente**: DB mockeada (recetas/ventas) y `saleRevenueComplete` sin ejecutarse contra Postgres; no se ejecuta la ruta con sesión real.
- **V2 pendiente**: Postgres real + runtime NOBYPASSRLS con dos empresas/dos sucursales; `saleRevenueComplete` resuelve bajo RLS (reusa el SELECT ya concedido por 0138/0141/0154 para COGS; sin migración nueva). El costo sigue usando `recipes.calculatedCost` (modelo de costo de menú existente; no es la expansión de recetas de COGS) — acreditar su exactitud con datos reales queda fuera de este cambio.
- **V3 pendiente**: recorrido HTTP/navegador con Better Auth real (matriz con platillos completos graficados y parciales en tabla como "Sin dato").
- No se modifica el modelo de costos ni migraciones. Sin despliegue.

No se acepta `INV-01.b4.coverage.menu`, el padre coverage ni `INV-01.b`. Pendientes: V2/V3 de `storage`/`executive`/`menu`, aplicación de `0154`, dependencia `b4b`, build global y aceptación HTTP/UI en `INV-01.d`.
