# INV-01.b4.coverage.executive — Cobertura de ingreso por sucursal y consolidado

Continuación 2026-11-17 sobre HEAD `0dfd139d75a5870d7af3baad5423d218f54a093f` más cambios locales. **Código implementado y V1 comprobada; sin aceptación (V2/V3 pendientes).** Depende de `INV-01.b4.coverage.cogs` (código V1/V2/V3 ya comprobado) y reutiliza su fragmento SQL `saleRevenueComplete`.

## Brecha cerrada

`ExecutiveReportService.getReport` sumaba `sales_entries.total_revenue` con `coalesce(…, 0)` y calculaba `foodCostPercent = cogs / revenue` contra ese **subtotal**, sin distinguir venta reportada de venta completa. Un ingreso `null` (parcial, sin revisión canónica) se leía como cero y el food cost quedaba inflado — el mismo patrón corregido en `inventory-reports-service.getCogsReport`.

Este incremento propaga la cobertura al dashboard ejecutivo, por sucursal y consolidado:

- `lib/services/executive-report-service.ts`: `BranchKPI` ahora distingue `reportedRevenueCents` (subtotal) de `revenueCents` (`number | null`, firme solo con cobertura COMPLETE) y añade `revenueCoverage { status, totalEntries, completeEntries }`. `foodCostPercent` pasa a `number | null` y se calcula **solo** sobre un total firme. Se extraen los helpers puros `computeRevenueCoverage`, `mergeCoverage` y `foodCostPercentOf` (testeables sin DB). El consolidado usa `mergeCoverage`: una sucursal parcial contamina el total.
- `components/inventory/executive-dashboard.tsx`: la tarjeta Food Cost muestra "—" con tono `neutral` cuando la cobertura no es completa (sin semáforo verde falso); la tarjeta Ingresos declara `Cobertura Completa/Parcial/Sin datos` y el subtotal reportado; el desglose por sucursal añade columna "Cobertura" y muestra "N/D"/"Parcial" en Food Cost/Revenue.
- `lib/services/intelligence-service.ts` y `lib/services/intelligence/finance-engine.ts`: consumidores ajustados para `foodCostPercent`/`revenueCents` anulables (reportan "sin dato" o usan `?? 0` sin inventar un número firme).

## Verificación (V1)

| Comando | Resultado |
|---|---|
| `pnpm.cmd exec vitest run --configLoader bundle --maxWorkers=1 --pool=threads lib/services/__tests__/executive-report-coverage.test.ts lib/services/__tests__/cogs-revenue-coverage.test.ts` | **23/23, 2 archivos, exit 0** |
| `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc --noEmit --incremental false` | **exit 0** |
| `pnpm.cmd exec eslint lib/services/executive-report-service.ts lib/services/intelligence-service.ts lib/services/intelligence/finance-engine.ts components/inventory/executive-dashboard.tsx lib/services/__tests__/executive-report-coverage.test.ts` | **exit 0**, 0 errores, 10 advertencias preexistentes |

Casos nuevos (11): `computeRevenueCoverage` — vacío/NO_DATA, `null` no se promociona a cero, cero explícito COMPLETE sin porcentaje, fila incompleta contamina subtotal; `mergeCoverage` — lista vacía, COMPLETE+NO_DATA, una parcial contamina; `foodCostPercentOf` — nunca contra subtotal ni cero, 25% con oráculo 300/1200; `consolidateKPIs` — consolidado COMPLETE con revenue firme y food cost, consolidado PARTIAL sin revenue firme ni food cost.

Regresión: `cogs-revenue-coverage.test.ts` (12 casos) sigue en verde; no se modifica el fragmento SQL ni `inventory-reports-service`.

## Límites

- **V1 únicamente**: helpers puros + `consolidateKPIs` con KPIs sintéticos; no se ejecuta `getReport` contra Postgres real.
- **V2 pendiente**: Postgres real + runtime NOBYPASSRLS con dos empresas/dos sucursales; `saleRevenueComplete` resuelve bajo RLS (la cobertura ejecutiva reusa el SELECT ya concedido por 0154/0138/0141 para COGS; no hay migración nueva).
- **V3 pendiente**: recorrido HTTP con Better Auth real (reporte ejecutivo por sucursal/consolidado con cobertura parcial visible) y navegador.
- No se modifica `menu-engineering` (es `INV-01.b4.coverage.menu`). No se aplica migración ni despliegue.

No se acepta `INV-01.b4.coverage.executive`, el padre coverage ni `INV-01.b`. Pendientes: `coverage.menu`, aplicación de `0154`/dependencia `b4b`, build global y aceptación HTTP/UI en `INV-01.d`.
