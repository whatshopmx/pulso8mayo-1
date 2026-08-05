# Plan — P&L Operativo Real por Sucursal

> **Objetivo:** que el P&L por sucursal deje de ser `ventas × 0.453 − gastos` y pase a calcularse
> con los datos reales del cliente, con procedencia declarada línea por línea.
>
> **Por qué importa más que cualquier otra corrección pendiente:** es el artefacto central del
> diagnóstico de venta (`pulso-concepto-dinero-primero.md` §6). Un P&L construido sobre los datos
> del propio cliente que devuelve constantes sectoriales es la peor primera impresión posible: le
> inventamos un número usando su información.
>
> **Origen:** auditoría del 2026-08-05, `pulso-concepto-dinero-primero.md` §3.5.
> Todas las firmas y campos de este plan están verificados en código.

---

## 0. Diagnóstico completo (más grave de lo documentado)

### 0.1 El defecto principal

`lib/services/pnl-service.ts:66-71`

```ts
// Heuristic Food Cost (28.5%) & Labor Cost (26.2%)
const foodCostCents = Math.round(totalSalesCents * 0.285);
const laborCostCents = Math.round(totalSalesCents * 0.262);
```

Consecuencias: las cinco sucursales tienen idéntico food cost %, el número no cambia nunca por más
que mejore la operación, y el margen operativo es una constante menos gastos. El
`dataCoveragePercent` que sí existe mide **solo cobertura de ventas** (cortes registrados / 30) —
no advierte que dos de los cuatro renglones son inventados.

### 0.2 Dos falsedades adyacentes (encontradas al buscar los insumos)

Importan porque son exactamente los servicios a los que uno alcanza para arreglar el P&L.

**a) `CostingService.getVarianceReport` (`costing-service.ts:154-191`) también es falso.**

```ts
lastCostPercent: lastCostDetail.foodCostPercent,
avgCostPercent: lastCostDetail.foodCostPercent,   // ← el mismo valor
variance: 0,                                      // ← hardcodeado
```

Devuelve varianza cero siempre, y los dos costos que compara son el mismo número. Además tiene un
**efecto de escritura dentro de un método de lectura**: hace `db.update(recipes)` de
`calculatedCost` y `foodCostPercentage` por cada receta, en un bucle N+1. No usar como fuente.

**b) `LaborCalculator.isHoliday()` (`labor-calculator.ts:333-336`) siempre devuelve `false`.**

```ts
// return !!holiday;
return false;
```

La prima de día festivo (×3) nunca se aplica. La tabla `holidays` existe en
`lib/db/schema/core.ts:66`. Mientras esto siga así, cualquier nómina "real" que calculemos
subestima el costo de los festivos — que en HORECA mexicano son los días de más venta.

### 0.3 Lo que sí está disponible (verificado campo por campo)

**Para nómina real:**

| Fuente | Campos relevantes |
|---|---|
| `employee_contracts` (`schema.ts:1449`) | `userId`, **`branchId`**, `contractType`, `startDate`/`endDate`, **`baseSalary`** (diario, en centavos), `monthlySalary`, `weeklySalary` |
| `shift_sessions` | `userId`, **`branchId`**, `status` (`COMPLETED`/`NO_SHOW`/…), `startedAt`/`endedAt`, `scheduledStartTime`/`scheduledEndTime` |
| `salary_history` (`schema.ts:1510`) | `newSalary`, `effectiveDate` → sueldo vigente en una fecha dada |
| `LaborCalculator` | `calculateOvertime(userId, startDate, endDate)` y `calculateOvertimeCost(hourlyRate, overtime)` |

**Para food cost real:**

| Fuente | Campos relevantes |
|---|---|
| `inventory_movements` | `branchId`, `itemId`, `type` (`RECEIVING`/`USAGE`/`ADJUSTMENT`/`TRANSFER`/`WASTE`/`RETURN`), `quantityChange`, `timestamp`. **Sin columna de costo** |
| `inventory_items` (`schema.ts:675`) | `lastCost`, `standardCost`, `averageCost`, `averageCostUpdatedAt`, `unit` |
| `inventory_price_history` | histórico de precios por ítem |
| `CostingService.getBranchMethod(branchId)` | ya devuelve `'LAST_COST' \| 'AVERAGE_COST'` **por sucursal**, configurable |
| `StockCountService` | `getStockCountHistory`, `getStockCountResults`, `completeStockCount` |

**Limitación clave:** `inventory_movements` no guarda costo, así que el costo hay que valorizarlo
al momento del cálculo contra `inventory_items` (según el método de la sucursal). Eso significa que
recalcular un período pasado puede dar un número distinto si el costo del ítem cambió. **Hay que
congelar el resultado** (ver Fase 3.3).

---

## Fase 0 — Honestidad inmediata (1 hora, va hoy)

**Regla:** la corrección de credibilidad no espera a la corrección de ingeniería. Un número
inventado **etiquetado** es aceptable; sin etiquetar, no.

1. En `BranchPnL` añadir procedencia por renglón (interfaz completa en Fase 3.1).
2. En `pnl-branch-table.tsx`, marcar visualmente cada celda cuyo origen sea `SECTOR_DEFAULT`
   (asterisco + nota al pie: *"Food cost y nómina son estimaciones sectoriales; no se calculan con
   tus datos todavía."*).
3. Mismo etiquetado en la respuesta de `/api/finance/pnl`, para que cualquier consumidor futuro
   (incluido el `FinanceEngine`) reciba la advertencia y no la pierda.

Con esto, el diagnóstico de venta ya se puede hacer sin mentir: se muestran ventas y gastos reales,
y se dice explícitamente que los otros dos renglones llegan cuando haya 2-4 semanas de captura.
**Esa frase, además, vende la implementación.**

---

## Fase 1 — Nómina real por sucursal (estimado: 1 semana)

**Archivo nuevo:** `lib/services/labor-cost-service.ts`

```ts
export type LaborCostSource = 'MEASURED' | 'CONTRACT_ONLY' | 'SECTOR_DEFAULT';

export interface BranchLaborCost {
  branchId: string;
  baseCostCents: number;        // días trabajados × sueldo diario vigente
  overtimeCostCents: number;    // vía LaborCalculator
  headcount: number;
  source: LaborCostSource;
  coveragePercent: number;      // % de turnos del período con sesión COMPLETED
}

export async function getLaborCostByBranch(
  companyId: string,
  startDate: string,
  endDate: string,
): Promise<BranchLaborCost[]>
```

**Escalera de cálculo** (se usa el mejor método con datos disponibles, y se declara cuál se usó):

1. **`MEASURED`** — contratos activos en el período (`employee_contracts` por `branchId`, con
   `startDate`/`endDate` solapando) × días con `shift_sessions.status = 'COMPLETED'`, más horas
   extra vía `LaborCalculator`. El sueldo vigente sale de `salary_history` (último `newSalary` con
   `effectiveDate <= fecha`), con fallback a `employee_contracts.baseSalary`.
2. **`CONTRACT_ONLY`** — si no hay turnos registrados: contratos activos × días del período. Es
   plantilla teórica, no asistencia real. Se declara como tal.
3. **`SECTOR_DEFAULT`** — 26.2% de ventas, **etiquetado**. Último recurso.

**Detalles de implementación que importan:**

- `LaborCalculator.calculateOvertime` es **por usuario y por rango** → una consulta por empleado.
  Con 100 empleados son 100 consultas. Aceptable en un cálculo semanal cacheado; **no** aceptable
  en la ruta del dashboard. Cachear el resultado (Fase 3.3) o batchear la consulta de
  `shift_sessions` por company y hacer el cálculo en memoria.
- `calculateOvertimeCost` **requiere `hourlyRate`**: derivarlo de `baseSalary` diario / horas de
  jornada del contrato (no asumir 8 si el contrato dice otra cosa).
- **Arreglar `isHoliday()`** contra la tabla `holidays` como parte de esta fase, o la nómina de los
  días de mayor venta queda subestimada. Es descomentar y consultar.
- Nómina ≠ costo patronal. `baseSalary` no incluye IMSS, INFONAVIT ni provisiones (aguinaldo,
  vacaciones, prima). Para un P&L **operativo** es defendible usar sueldo bruto, pero hay que
  **decirlo en la nota al pie**, porque el contador del cliente va a comparar contra su número y va
  a ser mayor. Un factor de carga social configurable por tenant es la salida limpia; si no se hace
  ahora, dejarlo anotado.

---

## Fase 2 — Food cost real por sucursal (estimado: 1-2 semanas)

**Archivo nuevo:** `lib/services/food-cost-service.ts`

```ts
export type FoodCostSource =
  | 'CONSUMPTION'    // movimientos USAGE + WASTE valorizados
  | 'INVENTORY_DIFF' // inv. inicial + compras − inv. final
  | 'PURCHASES'      // RECEIVING del período (proxy grueso)
  | 'SECTOR_DEFAULT';

export interface BranchFoodCost {
  branchId: string;
  foodCostCents: number;
  wasteCents: number;          // separado: es el número que el dueño quiere ver
  source: FoodCostSource;
  costingMethod: 'LAST_COST' | 'AVERAGE_COST';
  coveragePercent: number;
}
```

**Escalera de cálculo, en orden de preferencia:**

1. **`CONSUMPTION`** — `Σ inventory_movements(type IN ('USAGE','WASTE')) × costo(item)`, donde el
   costo se toma según `CostingService.getBranchMethod(branchId)` (`lastCost` o `averageCost`). Es
   el más fiel y aprovecha la configuración por sucursal que ya existe. **`WASTE` se reporta
   aparte**: es el renglón que justifica el precio del producto.
2. **`INVENTORY_DIFF`** — si hay al menos dos conteos en el período (`StockCountService`):
   `inventario_inicial + compras(RECEIVING) − inventario_final`. Es el food cost clásico y el que
   el dueño reconoce. Requiere disciplina de conteo, así que es el objetivo de la semana 4+.
3. **`PURCHASES`** — `Σ RECEIVING × costo`. Proxy grueso y **sesgado**: una compra adelantada
   infla el costo de la semana. Usar solo con la advertencia explícita.
4. **`SECTOR_DEFAULT`** — 28.5%, etiquetado.

**Lo que NO usar, y por qué:**

- **`CostingService.getVarianceReport`** — falso (§0.2a) y con escritura oculta.
- **COGS teórico desde recetas** (`salesEntries.recipeId × getRecipeCostDetail`) — atractivo, pero
  `salesEntries` requiere venta **a nivel platillo**, y la ingesta de POS actual llena
  `dailySalesCuts`, que son **totales por turno/canal**. **Verificar antes de descartar:**
  `select count(*) from sales_entries;` — si está vacía en los tenants reales, este camino no existe
  hoy y depende de ingesta item-level del POS (trabajo mayor, fuera de este plan).

---

## Fase 3 — El contrato de salida: procedencia por renglón

Esta es la parte de diseño que hace que un P&L parcialmente real sea **seguro de mostrar**, y es lo
que hoy falta más que los cálculos.

### 3.1 Nueva interfaz

```ts
export type LineSource = 'MEASURED' | 'DERIVED' | 'SECTOR_DEFAULT' | 'NO_DATA';

export interface PnLLine {
  cents: number;
  percentOfSales: number;
  source: LineSource;
  coveragePercent: number;   // cobertura de ESTE renglón, no global
  note: string;              // "12 de 14 turnos capturados", "estimación sectorial 28.5%"
}

export interface BranchPnL {
  branchId: string;
  branchName: string;
  sales: PnLLine;
  foodCost: PnLLine;
  waste: PnLLine;            // nuevo, separado del food cost
  labor: PnLLine;
  operatingExpenses: PnLLine;
  operatingProfit: PnLLine;
  /** El renglón más débil del P&L. Si es SECTOR_DEFAULT, el margen no es confiable. */
  weakestLine: LineSource;
}
```

**Se elimina** `dataCoveragePercent` global: una cobertura única para cuatro renglones de calidad
distinta oculta exactamente el problema que este plan corrige.

### 3.2 Regla de presentación (UI)

- Renglón `MEASURED` → normal.
- `DERIVED` / `SECTOR_DEFAULT` → marcado visualmente + nota al pie con el método.
- `NO_DATA` → guion, **nunca cero**. Un cero se lee como "no gastamos nada".
- Si `weakestLine !== 'MEASURED'`, el margen operativo va marcado como aproximado. No se puede
  presentar un margen firme sobre un costo inventado.

### 3.3 Congelar el resultado

Como el costo se valoriza al momento del cálculo (§0.3), recalcular un período pasado puede dar un
número distinto. Al cerrar la semana, persistir el `BranchPnL` completo (tabla `pnl_snapshots` o
`executiveState`, según lo que se decida en el cierre del Track A) para que el histórico sea estable
y comparable. Sin esto, la tendencia semana-a-semana se mueve sola.

---

## Fase 4 — Rendimiento (no opcional)

`pnl-service.ts` hoy itera sucursales con 2 consultas cada una. Con nómina y food cost pasa a ~5
consultas × N sucursales — para 15 sucursales, ~75 consultas secuenciales, contra el objetivo de
`pulso-executive-os-v2.md` §14 de **<30s para 15 sucursales**.

Reescribir como **agregación por company con `GROUP BY branch_id`** (una consulta por concepto, no
por sucursal) y ensamblar en memoria. Es la misma cantidad de código y una diferencia de un orden de
magnitud.

---

## Fase 5 — Verificación

El criterio no es "compila", es "el número es correcto":

1. **Prueba de diferenciación** — en un tenant con datos, las sucursales deben mostrar food cost %
   **distintos entre sí**. Si salen todas iguales, algún renglón sigue cayendo a
   `SECTOR_DEFAULT` sin avisar.
2. **Prueba de sensibilidad** — registrar una merma grande en una sucursal y confirmar que su food
   cost sube y el de las otras no.
3. **Cuadre de nómina** — para una sucursal y una semana, comparar contra el cálculo manual de
   `Σ(días × sueldo diario) + horas extra`. Tolerancia: centavos por redondeo.
4. **Prueba de escalera** — para cada nivel: quitar los turnos → debe caer a `CONTRACT_ONLY`;
   quitar contratos → `SECTOR_DEFAULT`; y en ambos casos la UI debe mostrar la marca.
5. **Prueba de vacío** — tenant sin datos: todos los renglones en `NO_DATA` con guiones, sin ceros
   y sin margen calculado.
6. `npx tsc --noEmit` limpio y `pnpm run build` verde. Ojo: hoy el typecheck **ya falla** por
   `refresh-engines.ts` (ver `plan-cierre-sprint-2-track-a.md` Fase 0) — cerrar eso primero o el
   ruido tapa los errores nuevos.

---

## Orden y esfuerzo

| # | Trabajo | Esfuerzo (estimado) | Bloquea |
|---|---|---|---|
| **F0** | Etiquetado de estimaciones en API + UI | **1 hora** | Nada. Va hoy. Desbloquea el diagnóstico de venta |
| **F3.1** | Interfaz `PnLLine` con procedencia | 2-3 horas | F1 y F2 escriben contra ella |
| **F1** | Nómina real + arreglar `isHoliday()` | ~1 semana | — |
| **F2** | Food cost real (escaleras 1 y 3) | ~1 semana | — |
| **F4** | Agregación por company (`GROUP BY`) | 2-3 horas | Objetivo de <30s |
| **F2b** | `INVENTORY_DIFF` (requiere disciplina de conteo) | 3-4 días | Necesita 2 conteos reales |
| **F3.3** | Congelar snapshots semanales | 3-4 horas | Tendencia estable |
| **F5** | Verificación completa | 1 día | Cierre |

**Total: ~2.5 semanas** para tener un P&L real, con 1 hora de trabajo que ya elimina el riesgo de
credibilidad hoy.

---

## Decisiones pendientes

| # | Decisión | Recomendación |
|---|---|---|
| **P1** | ¿La nómina del P&L es sueldo bruto o costo patronal (con IMSS y provisiones)? | Bruto en v1, con nota al pie explícita + factor de carga configurable por tenant como siguiente paso. Si no, el contador desacredita el número. |
| **P2** | ¿La merma se muestra dentro del food cost o como renglón aparte? | **Aparte.** Es el número que justifica el precio del producto; enterrarlo dentro del COGS lo hace invisible. |
| **P3** | ¿Dónde viven los snapshots semanales? | Tabla propia `pnl_snapshots`. Meterlo en `executiveState` lo mezcla con caché de engines, que tiene otro ciclo de vida. |
| **P4** | ¿Se arregla `getVarianceReport` o se marca como deprecado? | Deprecar con `@deprecated` y no llamarlo desde ningún lugar nuevo. Arreglarlo bien exige comparar `lastCost` vs `averageCost` de verdad, y eso es otro alcance. |

---

## Checklist

- [ ] F0: `PnLLine.source` marcado en API y UI, con nota al pie
- [ ] `dataCoveragePercent` global eliminado, sustituido por cobertura por renglón
- [ ] `labor-cost-service.ts` con escalera `MEASURED` / `CONTRACT_ONLY` / `SECTOR_DEFAULT`
- [ ] `LaborCalculator.isHoliday()` consultando la tabla `holidays`
- [ ] Sueldo vigente resuelto vía `salary_history` con fallback a `employee_contracts.baseSalary`
- [ ] `hourlyRate` derivado de la jornada del contrato, no de un 8 asumido
- [ ] `food-cost-service.ts` con escalera `CONSUMPTION` / `INVENTORY_DIFF` / `PURCHASES` / `SECTOR_DEFAULT`
- [ ] Merma como renglón separado
- [ ] `select count(*) from sales_entries` verificado (¿existe la vía de COGS teórico?)
- [ ] `getVarianceReport` marcado `@deprecated`, sin llamadas nuevas
- [ ] `pnl-service` reescrito con `GROUP BY branch_id`, una consulta por concepto
- [ ] Snapshots semanales persistidos
- [ ] Las 6 pruebas de la Fase 5 pasando
- [ ] P1-P4 decididas
