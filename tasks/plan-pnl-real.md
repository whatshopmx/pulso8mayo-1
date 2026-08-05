# Implementation Plan — P&L Operativo Real por Sucursal

> Fuente: `docs/plan-pnl-real.md` (auditoría 2026-08-05).
> Lista de tareas: `tasks/todo-pnl-real.md`. IDs `PL1`–`PL17` (prefijo propio para no chocar
> con la serie `T24`–`T58` ni con `P1`–`P4`, que en el doc de origen son *decisiones*, no tareas).

## Overview

Hoy `getPnLByBranch` devuelve food cost y nómina como constantes sectoriales (28.5% / 26.2%) sobre
las ventas del propio cliente. Este plan las sustituye por cálculo real con **procedencia declarada
renglón por renglón**, de modo que un P&L parcialmente real sea seguro de mostrar en el diagnóstico
de venta.

## Hallazgos de la verificación de código (correcciones al plan de origen)

Leí el código antes de desglosar. Cuatro cosas cambian el orden y el alcance:

### H1 — `operatingExpenses` no filtra por fecha. Es el defecto más grave del P&L.

`lib/services/pnl-service.ts:53-62` construye `expenseConditions` con `companyId` y `branchId` y
**nunca añade `startDate`/`endDate`**, aunque `operating_expenses.businessDate` existe
(`lib/db/schema.ts:2708`) y el bloque de ventas sí lo usa. Resultado: se comparan **gastos de todo el
histórico** contra **ventas de un período**. En un tenant con seis meses de captura, el margen
operativo de una vista semanal es basura — y a diferencia del food cost heurístico, esto **no está
etiquetado ni documentado en ningún lado**. Es una línea de código y va antes que todo lo demás.

### H2 — `LaborCalculator.calculateOvertime` clasifica **todas** las horas trabajadas como extra.

`labor-calculator.ts:263-266`: cuando la jornada **no** excede el umbral diario, hace
`nocturnal = nightMinutes; diurnal = dayMinutes` — es decir, mete los minutos **ordinarios** en el
desglose de horas extra. `totalRegular` (línea 166) queda en 0 siempre, y `calculateOvertimeCost`
(líneas 351-354) multiplica ese `diurnal` por **×2** y `nocturnal` por **×3**.

Un turno diurno normal de 8 h devuelve 480 minutos de "extra diurna" y se cobraría al doble. La
Fase 1 del plan de origen dice "más horas extra vía `LaborCalculator`" dando por hecho que funciona.
**No funciona**: usarlo tal cual produciría una nómina 2-3× la real, cambiando el error de
subestimar a sobreestimar. Arreglarlo es prerrequisito bloqueante, no un detalle.

### H3 — `isHoliday()` no "siempre devuelve false": devuelve `true` los domingos.

`labor-calculator.ts:320-336`. La rama de la tabla `holidays` sí está comentada (§0.2b del plan de
origen acierta en eso), pero **antes** hay un `if (date.getDay() === 0) return true`. Y en
`calculateSessionOvertime:251-254`, `isHoliday` manda **el turno completo** al bucket de festivo
(×3). Efecto real: **cada turno de domingo se cobra íntegro al triple**.

Legalmente al revés de lo que se quiere: en México el domingo no es día festivo — genera **prima
dominical del 25%** (LFT art. 71), no ×3. Así que el renglón de nómina tiene hoy dos sesgos
opuestos (H2 y H3 inflan; los festivos reales faltan). Corregir domingo≠festivo va en la misma tarea
que H2.

### H4 — Ventana semanal mal aplicada en rangos largos.

`calculateOvertime:170-173` aplica `MAX_WEEKLY_HOURS = 48` **al rango completo** que reciba. Si se
llama con un mes, todo lo que exceda 48 h **en el mes** se marca como extra semanal. El servicio de
costo debe llamar semana por semana, o la corrección de H2 no sirve de nada en vistas mensuales.

### Notas menores confirmadas

- `shift_sessions` **no tiene `companyId`** (`schema.ts:406-410`, solo `branchId`) → la agregación
  por company de la Fase 4 exige `JOIN branches`.
- `shift_sessions.startedAt` tiene `defaultNow()`: es hora de creación de fila, no de entrada real.
  Para días trabajados usar `checkInTime`; para minutos, la columna `totalWorkMinutes`.
- `holidays.companyId` existe y `holidays.date` es `text` → arreglar `isHoliday` obliga a pasar
  `companyId` por métodos que hoy son estáticos y no lo reciben.
- `employee_contracts` confirma `workStartTime`/`workEndTime`/`breakDurationMinutes`/`workDays` →
  el `hourlyRate` sí se puede derivar de la jornada real, como pide el plan.
- `inventory_movements` confirma que **no hay columna de costo** → valorización al vuelo y necesidad
  de congelar snapshots, tal como dice el plan.

## Architecture Decisions

1. **`PnLLine` antes que los cálculos.** El contrato de procedencia (F3.1) se implementa en PL2, no
   al final: nómina y food cost escriben contra él en vez de retrofitearlo.
2. **`labor-cost-service` no consume `LaborCalculator` hasta que PL4 esté verde.** Se prefiere
   arreglar el calculador (una fuente de verdad, ya usado en `/dashboard/labor`) sobre duplicar la
   lógica de horas extra en el servicio de costo.
3. **Escalera explícita, nunca fallback silencioso.** Todo descenso de nivel escribe `source` +
   `note`. La prueba de diferenciación (PL17) existe justamente para cazar descensos mudos.
4. **Merma como renglón propio** (decisión P2 del doc de origen, adoptada).
5. **Sueldo bruto en v1** (decisión P1), con nota al pie explícita y `socialChargeFactor` reservado
   en la interfaz para no romper el contrato después.
6. **`pnl_snapshots` tabla propia** (decisión P3), no `executiveState`.
7. **`getVarianceReport` se deprecia, no se arregla** (decisión P4).

## Dependency Graph

```
PL1 (fecha de gastos)  ── independiente, va primero
        │
PL2 (PnLLine en el servicio) ──┬── PL3 (UI de procedencia)
        │                      │
        │            PL4 (fix LaborCalculator) ── PL5 (isHoliday vs holidays)
        │                      │
        │            PL6 (sueldo vigente + hourlyRate)
        │                      │
        │                      └── PL7 (getLaborCostByBranch) ── PL8 (cablear nómina)
        │
        │            PL9 (spike de datos) ── PL10 (food-cost-service) ── PL11 (cablear food+merma)
        │                                              │                        │
        │                                              └── PL16 (INVENTORY_DIFF)│
        │                                                                       │
        └────────────────────── PL13 (GROUP BY) ←── PL8 + PL11 ─────────────────┘
                                     │
                     PL14 (schema snapshots) ── PL15 (congelado semanal)
                                                        │
                                                      PL17 (las 6 pruebas)
PL12 (deprecar getVarianceReport) ── independiente
```

## Task List

### Fase 0 — Honestidad inmediata (bloqueante, va hoy)
- [ ] PL1: Filtrar `operatingExpenses` por `businessDate` *(H1 — no estaba en el plan de origen)*
- [ ] PL2: `PnLLine` con procedencia en `pnl-service` + API
- [ ] PL3: UI de procedencia en `pnl-branch-table`

### Checkpoint A — El P&L ya no miente
- [ ] Los gastos del período cuadran con la suma de `operating_expenses` de ese rango
- [ ] Food cost y nómina salen marcados `SECTOR_DEFAULT` con nota al pie visible
- [ ] `weakestLine !== 'MEASURED'` ⇒ margen operativo marcado como aproximado
- [ ] `npx tsc --noEmit` limpio y `pnpm run build` verde
- [ ] **Revisión humana antes de seguir** — a partir de aquí el diagnóstico de venta ya es honesto

### Fase 1 — Nómina real
- [ ] PL4: Arreglar `LaborCalculator` (H2 horas ordinarias + H3 domingo + H4 ventana semanal)
- [ ] PL5: `isHoliday()` contra la tabla `holidays`
- [ ] PL6: Sueldo vigente vía `salary_history` + `hourlyRate` desde la jornada del contrato
- [ ] PL7: `labor-cost-service.ts` con la escalera MEASURED / CONTRACT_ONLY / SECTOR_DEFAULT
- [ ] PL8: Cablear nómina real en `pnl-service`

### Checkpoint B — Nómina
- [ ] Cuadre manual de una sucursal-semana: `Σ(días × sueldo diario) + extras`, tolerancia centavos
- [ ] Turno diurno de 8 h ⇒ **cero** costo de horas extra (regresión de H2)
- [ ] Turno de domingo ⇒ prima dominical, no ×3 (regresión de H3)
- [ ] Quitar turnos ⇒ baja a `CONTRACT_ONLY`; quitar contratos ⇒ `SECTOR_DEFAULT`; ambos marcados

### Fase 2 — Food cost real
- [ ] PL9: Spike de disponibilidad de datos (`sales_entries`, movimientos, conteos)
- [ ] PL10: `food-cost-service.ts` — escaleras CONSUMPTION / PURCHASES / SECTOR_DEFAULT
- [ ] PL11: Cablear food cost + merma como renglón separado
- [ ] PL12: Deprecar `getVarianceReport`

### Checkpoint C — Food cost
- [ ] Prueba de diferenciación: las sucursales muestran food cost % **distintos**
- [ ] Prueba de sensibilidad: merma grande en una sucursal ⇒ solo sube el suyo
- [ ] La merma aparece como renglón propio, no enterrada en el COGS

### Fase 3 — Rendimiento y estabilidad
- [ ] PL13: Reescribir `pnl-service` con `GROUP BY branch_id`
- [ ] PL14: Tabla `pnl_snapshots` + migración
- [ ] PL15: Congelado semanal y lectura desde snapshot

### Fase 4 — Cierre
- [ ] PL16: Escalera `INVENTORY_DIFF`
- [ ] PL17: Script de verificación con las 6 pruebas de la Fase 5

### Checkpoint D — Completo
- [ ] Las 6 pruebas pasando
- [ ] 15 sucursales en <30 s (objetivo `pulso-executive-os-v2.md` §14)
- [ ] Listo para revisión

## Risks and Mitigations

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Nómina sobreestimada 2-3× por H2 si se cablea `LaborCalculator` sin arreglar | **Alto** — peor que el bug actual: hoy subestima, esto inflaría | PL4 es bloqueante de PL7. Regresión explícita "8 h ⇒ 0 extras" en el checkpoint B |
| El typecheck ya falla por `refresh-engines.ts` y tapa errores nuevos | Alto | Precondición: cerrar Fase 0 de `plan-cierre-sprint-2-track-a.md` antes de PL1 |
| `sales_entries` vacía ⇒ el COGS teórico no existe hoy | Medio | PL9 lo mide antes de diseñar PL10; si está vacía, se descarta por escrito |
| Valorización al vuelo mueve el histórico semana a semana | Medio | PL14/PL15 congelan el snapshot al cierre |
| 100 empleados × 1 consulta de `calculateOvertime` en la ruta del dashboard | Medio | PL7 batchea `shift_sessions` por company; PL13 consolida en `GROUP BY` |
| Cambiar `BranchPnL` rompe `finance-engine.ts:162` | Medio | PL2 actualiza el consumidor en la misma tarea; sin período de compatibilidad |
| `isHoliday` necesita `companyId` en métodos estáticos que no lo reciben | Bajo | PL5 cambia la firma y actualiza los llamadores; el conjunto es acotado |
| El contador del cliente compara contra costo patronal y el número no cuadra | Medio | Nota al pie explícita "sueldo bruto, sin IMSS ni provisiones" desde PL8 |

## Open Questions

- **Q1 (bloquea PL8):** ¿los domingos del cliente piloto se pagan con prima dominical del 25%, o hay
  un acuerdo distinto? La corrección de H3 necesita saber contra qué se compara el cuadre.
- **Q2 (bloquea PL10):** resultado de PL9 — ¿hay movimientos `USAGE`/`WASTE` reales, o el único
  camino hoy es `PURCHASES`?
- **Q3 (bloquea PL15):** ¿el congelado corre en Inngest junto a `refresh-engines`, o como job propio?
  Depende del cierre del Track A.
- **Q4 (no bloquea):** ¿`socialChargeFactor` configurable por tenant entra en v1 o queda anotado?
  Recomendación: reservar el campo en la interfaz ahora, implementar después.

## Definition of Done (todas las tareas)

- `npx tsc --noEmit` limpio y `pnpm run build` verde.
- Dinero en centavos (integer). Todo scoping por `companyId`/`branchId`.
- Migraciones con `pnpm db:generate` (nunca `db:push` sin verificar `.env`).
- Ningún renglón nuevo se muestra sin `source` + `note`.
- Verificación por script `npx tsx scripts/verify-*.ts` (el repo no tiene runner de unit tests).
