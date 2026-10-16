# C30 — Dato real, estimado y ausente en la Liga de Sucursales

Fecha: 16-10-2026. Seguimiento: `tasks/todo-conexion-frontend-backend.md`. C30 cerrada (C30.1–C30.3). La Fase 5 sigue abierta: C31 está pendiente.

## Cambio (H06)

La Liga de Sucursales no distinguía la ausencia de un dato de un dato real: cuando faltaban costos sustituía food 31.5% y labor 24.5% y, como la bandera de estimación sólo se activaba en otros casos, un renglón sin insumos podía leerse como una medición; los indicadores de cumplimiento partían de 100 cuando no había temperaturas ni cortes. La evaluación del cockpit ejecutivo sustituía la venta y los costos de red por constantes (4.82M, 57.8 / 29.4 / 28.4).

- **C30.1 — El servicio emite estados de calidad explícitos.** Nuevo tipo `MetricQuality` (`MEASURED` / `ESTIMATED` / `MISSING`) y calidad por renglón (`quality.sales`, `foodCost`, `laborCost`, `nom251`, `cashReconciliation`). `foodCostPercent`, `laborCostPercent`, `primeCostPercent`, `primeCostStatus`, `nom251ComplianceRate`, `cashReconciliationRate` y `compositeScore` pasan a `null` cuando falta el insumo o la evidencia; no hay sustitución sectorial ni 100 por defecto. El `compositeScore` pondera **sólo** los indicadores disponibles y renormaliza los pesos; `null` si no hay ninguno. Los promedios de red y de red segmentada promedian sólo las observaciones existentes (`null` si no hay ninguna) y las anomalías dejan fuera las sucursales sin el indicador. El podio excluye unidades sin score.
- **C30.2 — La Liga nombra la ausencia y la procedencia.** La tarjeta de red, el podio, la tabla y el CSV muestran «Sin dato» / «Sin datos» en lugar de un cero o un porcentaje inventado. El panel de hallazgos deja de afirmar «Consistencia de red óptima» cuando no hay dos sucursales con prime cost. La leyenda del semáforo usa los objetivos del inquilino en vez de las constantes 60/65.
- **C30.3 — El cockpit ejecutivo deja de inventar costos.** `VitalSignsData` acepta `null` en venta, prime, food y labor; la cabecera muestra «Sin datos» y no pinta semáforo sin medición. La cascada P&L no dibuja un puente con costos inventados: sin food o nómina muestra un estado de ausencia. La mayor fuga de la red se elige sólo entre sucursales con prime cost.

## Verificación

- **V1** — `tests/unit/finance/data-quality.test.ts` (6): conjunto vacío (sin 31.5/24.5, sin 100 por defecto, `dataQuality: MISSING`, promedios `null`), ventas sin costos (venta medida, costo ausente, cuadre 100 real), cero real (food/labor medidos en 0 → `0%`, no ausencia), datos completos (todo medido, promedios de las observaciones), promedio sin diluir con una sucursal sin dato, y base estimada declarada con procedencia y nota. `lib/services/__tests__/cross-branch-qsr.test.ts` (6) incluye que una sucursal sin food cost no entra en la comparación de anomalías.
- **V2** — `tests/e2e/group-network.spec.ts` (4) en Chromium aislado; el cuarto caso inyecta una sucursal sin datos y comprueba que la pantalla muestra ausencia (no 31.5% ni 24.5%) y «Sin datos suficientes para comparar».
- Suite completa: **1370 aprobadas**, 1 omitida, 1 TODO (1372), 107 archivos.
- `tsc --noEmit` código 0; `build` código 0; `lint` global 0 errores (2482 warnings); suite aislada de navegador **87/87**.
- Sin migraciones: C30 no toca el esquema.

## Límites declarados

1. **Sin V2 con Next/auth/Postgres.** La representación se comprueba en la UI aislada con la API interceptada; la autorización y el cálculo contra la base viven en las unitarias sobre el servicio real.
2. **El cockpit ejecutivo conserva los defaults del `ExecutiveTwinEngine`** (`healthScore 88`, `driftScore 12`, venta objetivo 96%, liquidez 22): son de otro motor y otro hallazgo; C30 sólo retiró los que provenían de la Liga (venta y costos de red).
3. **Los umbrales duros 60/65 siguen en el cockpit ejecutivo** (`executive-cockpit-header`, `prime-cost-stack-card`), que no recibe los objetivos del inquilino. La Liga ya los usa; unificar el ejecutivo queda para otra tarea.
4. **La verificación con datos reales de ventas del período no se ejecutó**: la conciliación es V1 con dependencias simuladas.
