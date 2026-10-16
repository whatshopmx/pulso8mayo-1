# C29 — Definiciones financieras compartidas entre motores

Fecha: 15-10-2026. Seguimiento: `tasks/todo-conexion-frontend-backend.md`. C29 cerrada (C29.1–C29.4). La Fase 5 sigue abierta: C30 y C31 están pendientes.

## Cambio (H06)

La Liga de Sucursales (QSR) y el motor financiero calculaban el mismo concepto con bases y fórmulas distintas: la vista de sucursales dividía entre venta **bruta**, no cargaba la nómina, usaba `costRecords` manuales e inventaba 31.5% / 24.5% cuando faltaba un costo, a veces marcándolo `VERIFIED`. El motor financiero ya usaba base neta (A3.2), carga patronal (A3.3) y objetivos del inquilino.

- **C29.1 — Definición compartida.** Nuevo módulo puro `lib/services/branch-cost-metrics.ts`: mapeo de procedencia (`FoodCostSource`/`LaborCostSource` → `LineSource`), degradación cuando la base no se midió, aplicación de la carga patronal y la fórmula única de food/labor/prime con los objetivos del inquilino. `financial-kpi-service` lo consume; su salida no cambia (extracción directa, verificada con la suite completa).
- **C29.2 — El motor QSR mide con la base, la carga y los numeradores compartidos.** `getBranchQSRRanking` resuelve la venta neta por sucursal con `resolveSalesBase` (IVA capturado o tasa vigente al cierre), toma food cost de `getFoodCostByBranch` (consumo + merma, como el KPI) y nómina de `getLaborCostByBranch` con `getLaborBurden`, y calcula los porcentajes y el estado con `calcularCostoPorcentual`. El umbral de prime cost sale de `getFinancialTargets` (30+28 / 35+32 = 58/67), no de las constantes 60/65. `dataQuality` es `VERIFIED` sólo si ambos renglones son `MEASURED`.
- **C29.3 — La vista nombra la diferencia.** `BranchQSRScore` expone `salesBaseCents`, `salesBaseKind`, `foodCostSource`, `laborCostSource` y `costNote`; `BranchQSRRankingResult` expone `primeCostTargetPercent`/`primeCostWarnPercent`. El scorecard muestra la meta del inquilino y la nota de concepto («el food cost incluye la merma y la nómina va con carga»); la tabla nombra «Food Cost % · merma» y «Labor Cost % · carga»; el CSV añade «Base de Ventas» y «Procedencia Costos».
- **C29.4 — Conciliación V1.** `tests/unit/finance/branch-kpi-consistency.test.ts` corre los **dos motores** contra los mismos insumos y comprueba que food y labor coinciden; incluye el caso de base estimada (IVA sin desglose) y la degradación de procedencia.

## Verificación

- `tests/unit/finance/branch-cost-metrics.test.ts` (10) y `tests/unit/finance/branch-kpi-consistency.test.ts` (3): 13 nuevas en verde.
- `lib/services/__tests__/cross-branch-qsr.test.ts` (6) sigue en verde; `tests/unit/company/tenant-network-service.test.ts` (C22) se adaptó a los nuevos insumos compartidos y pasa 7/7.
- Suite completa: **1364 aprobadas**, 1 omitida, 1 TODO (1366), 106 archivos.
- `tsc --noEmit` código 0; `build` código 0; `lint` global 0 errores (2483 warnings, mismo conteo que antes de C29).

## Límites declarados

1. **Ausencia todavía con referencia sectorial declarada.** Si falta base o algún renglón, la Liga conserva 31.5% / 24.5% **marcado `ESTIMATED`** (nunca `VERIFIED`). C30 reemplaza esa sustitución por un estado de ausencia explícito y corrige los indicadores de cumplimiento que parten de 100.
2. **Cambio de numerador.** La Liga pasó de `costRecords` manuales a la valorización por movimientos de inventario (`getFoodCostByBranch`) y la nómina calculada (`getLaborCostByBranch`). Es la unificación buscada, pero cambia qué datos alimentan la pantalla; conviene observarlo con datos reales.
3. **Sin V2 con Next/auth/Postgres.** La conciliación es V1 con dependencias simuladas; el recorrido de navegador aislado no se revisó en esta tarea (la V2 de la Fase 5 corresponde a C31).
4. El `compositeScore` de la Liga sigue usando el `primeCostPercent` (posiblemente sustituido); su recálculo con estados de ausencia queda para C30.
