# Implementation Plan — Costo Promedio Real (`average_cost`) y Reporte de Varianza

> Origen: decisión **P4** de `docs/plan-pnl-real.md:312` ("deprecar `getVarianceReport`, arreglarlo
> bien es otro alcance") y el comentario `@deprecated` en `lib/services/costing-service.ts:154-167`.
> Este documento **es** ese otro alcance.
>
> IDs `CP1`–`CP12` (prefijo propio para no chocar con `PL1`–`PL17` de `tasks/plan-pnl-real.md`,
> la serie `T24`–`T58`, ni con `P1`–`P4`, que son *decisiones*).
>
> Verificación contra la base `pulso horeca` (`autumn-paper-33753411`), 2026-08-05.

## Overview

El sistema tiene dos métodos de costeo configurables por sucursal (`LAST_COST` / `AVERAGE_COST`) y
cuatro servicios que ramifican sobre ellos. **El segundo método nunca ha producido un número
distinto del primero**, porque `inventory_items.average_cost` está en `NULL` para el 100% de los
ítems y todos los consumidores hacen `averageCost || lastCost`.

Este plan llena ese costo con una semántica declarada, **modela como configuración del tenant la
parte que es lógica de negocio del cliente y no supuesto nuestro**, cierra las vías que lo esquivan,
y recién entonces reconstruye el reporte de varianza — que hoy es un stub que devuelve `variance: 0`
hardcodeado y además escribe en `recipes` dentro de un método de lectura.

**El orden importa y no es negociable:** reescribir el reporte primero produce un reporte de puros
ceros verdaderos en vez de ceros falsos. Mejor, pero igual de inútil.

**Los dos ejes de configuración de costeo** quedan así:

| Eje | Valores | Dónde vive | Estado |
|---|---|---|---|
| **Método** — con qué costo se valoriza | `LAST_COST` / `AVERAGE_COST` | company + override por sucursal | ✅ existe, ❌ el segundo nunca produjo un número distinto |
| **Alcance** — de quién es ese costo | `COMPANY` / `BRANCH` | company (sin override) | ❌ no existe; hoy es un supuesto implícito y contradictorio (H4) |

Todo lo demás — semántica WAC, trato de lotes sin costo, base de ponderación — es decisión fija de
ingeniería, no configuración. El criterio está en AD-6.

## Hallazgos de la verificación (código + base)

### H1 — `average_cost` está vacío en el 100% de los ítems

```
inventory_items:            30
  con last_cost:            30
  con average_cost:          0   ← ninguno
  con average_cost_updated_at: 0
```

Consecuencia inmediata: **cualquier sucursal configurada en `AVERAGE_COST` obtiene hoy exactamente
el mismo food cost que en `LAST_COST`**, en silencio. `food-cost-service.ts:60` ya expone
`usedCostFallback` para hacerlo visible — con los datos actuales esa bandera saldría `true` en el
100% de las líneas. Es la única razón por la que el hueco no ha explotado: hoy nadie está en
`AVERAGE_COST` (`companies.costing_method = 'LAST_PRICE'`, las 3 sucursales en `NULL` → heredan).

### H2 — El escritor existe y es correcto de intención; nunca se ejecutó

`average_cost` se escribe en **un solo lugar del repo**: `InventoryService.recordMovement`, rama
`type === 'RECEIVING'` (`lib/services/inventory-service.ts:130-160`). La ruta
`/api/inventory/receiving:157` sí pasa por ahí. Pero los datos actuales vienen del seed, que inserta
directo y esquiva el recálculo:

```ts
// scripts/seed-04-inventory.ts:182, 233-234
await db.insert(inventoryBatches).values(batchValues)
await db.insert(inventoryMovements).values(receivingValues)   // ← bypass
```

70 lotes con `unit_cost` y 30 movimientos `RECEIVING` en la base, cero recálculos disparados.
**El cálculo no está roto: nunca ha corrido.**

### H3 — El escritor tiene tres defectos que hay que resolver antes de llenarlo

`inventory-service.ts:130-160`:

1. **`batches[batches.length - 1]?.unitCost` (línea 155)** sale de un `SELECT` **sin `ORDER BY`**.
   Postgres no garantiza orden de filas: cuál lote se considera "el último costo" es arbitrario y
   puede cambiar entre ejecuciones. `last_cost` — el número que hoy sostiene *todo* el costeo — se
   escribiría de forma no determinista.
2. **Pondera por `current_quantity`, no por lo comprado.** El promedio se mueve conforme se consume
   el inventario. La misma semana recalculada dos días después da otro número — justo el problema
   que `pnl_snapshots` existe para contener (`food-cost-service.ts:29-32`).
3. **Filtra `status = 'AVAILABLE'`.** En esta base 25 de 70 lotes están `EXPIRED` (514 unidades):
   quedarían silenciosamente fuera del promedio de compra.

### H4 — Desajuste de alcance: el costo es de la company, los lotes son de la sucursal

`inventory_items` es **company-scoped** (`schema.ts:675-702`: tiene `companyId`, **no** `branchId`).
`inventory_batches` es **branch-scoped** (`schema.ts:733-749`). `recordMovement` calcula el promedio
filtrando `itemId AND branchId` y lo escribe en la columna compartida por todas las sucursales: **la
última sucursal que recibe pisa el promedio de las demás.**

En la base actual solo 1 ítem tiene lotes en más de una sucursal, así que el daño es invisible hoy.
Pero `getFoodCostByBranch` es explícitamente *por sucursal*, y el producto se vende a grupos
restauranteros (`docs/pulso-diseno-grupo-restaurantero.md`). Un food cost por sucursal valorizado
con un promedio de company es una contradicción que el P&L heredaría.

**Esto no se decide de nuestro lado: es lógica de negocio del tenant** (ver AD-3). Un restaurante de
una sola ubicación y un grupo de 15 sucursales que negocian cada una con su proveedor tienen
respuestas legítimamente distintas. Se modela como configuración, no como supuesto.

### H8 — La config del tenant hoy son columnas sueltas, no una tabla de settings

No existe `company_settings` ni servicio de configuración: `companies` lleva `costingMethod`,
`blindStockCount` y `taxRate` como columnas directas (`schema/core.ts:14-26`), y `branches` puede
sobreescribir `costingMethod` (`schema/core.ts:41`). La escalera sucursal → company → default ya
está implementada en `CostingService.getBranchMethod:29-44` y duplicada en
`food-cost-service.ts:123-134`.

Ese es el patrón a extender — no introducir una tabla de settings genérica para un solo campo.
Pero sí hay que **dejar de duplicar la resolución** en cada servicio (CP2b).

### H5 — Tres vías crean lotes **sin costo**, y ninguna es el seed

| Vía | Línea | Qué crea |
|---|---|---|
| Recepción de transferencia entre sucursales | `inventory-service.ts:608-618` | lote nuevo **sin `unitCost`** |
| Conteo de inventario (lote `SC-`) | `inventory-service.ts:711-719` | lote **sin `unitCost`** |
| Consumo teórico (lote dummy) | `theoretical-consumption-service.ts:125` | lote **sin `unitCost`** |

Hoy los 70 lotes de la base tienen costo porque todos vienen del seed. En operación real, cada
transferencia entre sucursales inyecta stock no costeado. Para un WAC eso es veneno: incluirlo
arrastra el promedio a cero, excluirlo introduce un sesgo distinto. Hay que decidirlo explícitamente
(CP1), no descubrirlo en producción.

### H6 — La buena noticia: la varianza sí va a existir

```
items con lotes:                       30
items con costo variable entre lotes:  30   ← todos
dispersión promedio (max vs min lote): 29.4 %
```

Todos los ítems tienen lotes a precios distintos, con casi 30% de spread promedio. En cuanto
`average_cost` se llene, **va a diferir de `last_cost` de verdad**. El reporte de varianza no es una
idea teórica: es un número que hoy no se puede ver. Ese es el valor de negocio de este plan.

### H7 — El motor de costeo correcto ya está escrito

`RecipeService.computeCost(graph, recipeId, method, …)` (`recipe-service.ts:307`) ya recibe el
método como parámetro, corre sobre un grafo cargado en 3 consultas y memoiza sub-recetas. Es
exactamente lo que el handoff (`handoffs/phase-2-variance-report.md:49`) pide construir llamando
`getRecipeCostDetail()` dos veces — que es la versión N+1 recursiva que `RecipeService` ya
reemplazó. **No hay que escribir el motor, hay que exponerlo:** `loadGraph` y `computeCost` son
`private static`, y el único punto público (`calculateRecipeCost:57`) **también escribe** en
`recipes` (líneas 85-98). El reporte necesita una entrada pública de solo lectura.

### Notas menores confirmadas

- `companies.costing_method` guarda `'LAST_PRICE'`, un tercer string que no es ninguno de los dos
  valores sobre los que ramifica el código. Funciona por accidente del fallback
  (`costing-service.ts:42-43`, `food-cost-service.ts:123-124`). No hay UI para cambiar el default de
  company (`handoffs/phase-2-variance-report.md:76-94`).
- `ReportsService.getVarianceReport` (`reports-service.ts:20`) es un homónimo **distinto** — compara
  consumo teórico vs real en *cantidad*, no métodos de costeo. Lee `sales_entries`, que tiene
  **0 filas**, así que su columna teórica sale vacía. Fuera del alcance de este plan; no confundir.
- `CostingService.getVarianceReport` tiene **cero llamadas** en todo el repo. Borrarlo no rompe nada.
- `inventory_price_history` (40 filas) registra `previousCost`/`newCost` por ítem, sin cantidad: sirve
  para auditar el movimiento de `last_cost`, **no** para reconstruir un promedio ponderado.

## Architecture Decisions

1. **`average_cost` = promedio ponderado móvil de COMPRA (WAC), no valuación de existencia.**
   En cada recepción: `nuevoProm = (qtyEnMano·promAnterior + qtyRecibida·costoRecibido) /
   (qtyEnMano + qtyRecibida)`. No se mueve cuando el stock se consume o caduca. Es el estándar
   contable y es **estable ante recálculo de períodos pasados** — requisito heredado de
   `food-cost-service.ts:29-32` y de `pnl_snapshots`. Descarta la semántica actual (H3.2, H3.3).
2. **Lotes sin `unitCost` no participan del promedio, y se cuentan.** Un lote de transferencia o de
   conteo (H5) no es una compra: no aporta información de precio. Se excluye del WAC y se expone en
   un contador, siguiendo el principio de `plan-pnl-real.md` ("escalera explícita, nunca fallback
   silencioso"). `food-cost-service` ya tiene el patrón: `uncostedLines`.
3. **El alcance del costo es configuración del tenant, no un supuesto nuestro** (H4).
   Nueva columna `companies.costing_scope`: `'COMPANY'` (el insumo tiene un costo único para el
   grupo — compra centralizada) | `'BRANCH'` (cada sucursal tiene el suyo — compra descentralizada).
   **Solo a nivel company: no admite override por sucursal**, porque el alcance describe cómo se
   relacionan las sucursales entre sí; que una sola lo cambie no significa nada. Default `'COMPANY'`,
   que es el comportamiento actual y el caso del restaurante de una ubicación.

   La pregunta que ve el dueño no es "¿alcance de costeo?" sino **"¿cada sucursal negocia sus propios
   precios con proveedores?"** — eso sí lo sabe responder. La traducción a `COMPANY`/`BRANCH` es
   nuestra, no suya.
4. **Se almacena siempre al grano más fino; la config resuelve en la LECTURA.** El costo se persiste
   por `(item_id, branch_id)` **sin importar** el `costing_scope`; lo que la config decide es cómo se
   resuelve al leer:
   - `scope = 'BRANCH'` → se lee la fila de esa sucursal
   - `scope = 'COMPANY'` → se lee el agregado ponderado de todas las sucursales de la company

   Consecuencia importante: **cambiar el setting es instantáneo y no destructivo.** No hay backfill,
   ni migración de datos, ni pérdida de histórico cuando un tenant crece de una sucursal a cinco y
   cambia de opinión. Guardar al grano grueso y "desagregar después" no tiene vuelta atrás; esto sí.

   Esto convierte a **CP12 en cimiento, no en trabajo diferido**: no se puede ofrecer la opción
   `BRANCH` sin filas por sucursal. Ver el cambio de fase abajo.
5. **Una sola función resuelve la config; ningún servicio la reimplementa.** Hoy la escalera
   sucursal → company → default está escrita dos veces (`costing-service.ts:29-44` y
   `food-cost-service.ts:123-134`) y ya divergen en el manejo del sentinel `'LAST_PRICE'` (H8).
   Agregar un segundo eje de configuración a dos implementaciones distintas garantiza que se
   separen. `CP2b` centraliza método + alcance en un solo resolvedor y los servicios lo consumen.
6. **Lo que NO es configuración.** Cada flag es un camino de código que hay que sostener y una
   decisión que le pasamos a alguien que muchas veces tampoco la sabe. Se quedan como decisión fija:
   - la semántica WAC (AD-1) — es norma contable, no preferencia; ofrecer dos motores de costeo es
     sostenerlos para siempre y pedirle a un restaurantero que elija un método contable
   - el trato de lotes sin costo (AD-2) — es corrección, no gusto
   - la base de ponderación (Q2, resuelta abajo) — se deriva de la decisión P2 de `plan-pnl-real.md`

   El único eje genuinamente dependiente del negocio del cliente es el alcance (AD-3).
7. **El backfill es un script idempotente con `--dry-run` por defecto**, no una migración. El
   cálculo depende de datos que pueden estar sucios; tiene que poder correrse, revisarse y repetirse.
8. **`CostingService.getVarianceReport` se borra, no se arregla.** El reporte nuevo vive en su propio
   servicio, sin efectos de escritura, sobre el motor de `RecipeService` (H7). El método deprecado no
   tiene llamadas: no hay período de compatibilidad que respetar.
9. **CP2 no se mergea sin CP4.** Arreglar el escritor sin cerrar las vías que lo esquivan produce una
   columna que se llena a medias — peor que vacía, porque deja de ser obvio que falta.

## Dependency Graph

```
CP1 (ADR: semántica + ejes de config) ── bloquea todo
        │
CP12 (schema: inventory_item_costs + companies.costing_scope) ── cimiento
        │
CP2b (resolvedor único de config: método + alcance)
        │
        ├── CP2 (arreglar el escritor) ──┬── CP4 (cerrar bypasses) ──┐
        │                                │                           │
        ├── CP3 (script de backfill) ────┘                           │
        │                                                            │
        └────────────────── CP5 (verificación: 2 métodos × 2 alcances) ←┘
                                     │
                    ┌────────────────┴────────────────┐
                    │                                 │
        CP6 (entrada pública read-only        CP9 (UI de config de costeo:
             en RecipeService)                  método + alcance + sentinel)
                    │
        CP7 (costing-variance-service)
                    │
        CP8 (API /costing/variance) ── CP10 (UI del reporte)
                    │
        CP11 (borrar getVarianceReport)
```

CP12 estaba fuera de v1 en la primera versión de este plan. Modelar el alcance como config
(AD-3) lo vuelve el cimiento: **no se puede ofrecer la opción `BRANCH` sin filas por sucursal.**
Se conserva el ID para no renumerar; el grafo manda sobre el número.

## Task List

### Fase 0 — Decidir antes de escribir (bloqueante)

- [ ] **CP1**: ADR en `docs/` con: semántica WAC de compra (AD-1), trato de lotes sin costo (AD-2),
      **el alcance como eje de configuración del tenant** (AD-3/AD-4), y — igual de importante — la
      lista de lo que deliberadamente **no** es configurable y por qué (AD-6). Sin esto, CP2 y CP3
      pueden implementar semánticas distintas de la misma columna.

### Fase 1 — Modelar la config y calcular bien

- [ ] **CP12**: Migración de schema *(promovida desde "fuera de v1" — AD-4)*:
      - tabla `inventory_item_costs (item_id, branch_id, average_cost, last_cost, uncosted_lots,
        updated_at)`, PK `(item_id, branch_id)`
      - `companies.costing_scope text default 'COMPANY'` en `schema/core.ts` junto a `costing_method`
      - `inventory_items.average_cost` / `last_cost` quedan como **caché de lectura del agregado de
        company**, no como fuente de verdad — o se retiran, según lo que CP2b decida (Q5)
- [ ] **CP2b**: `lib/services/costing-config.ts` — **un solo** resolvedor de configuración de costeo
      que devuelve `{ method, scope }` para un `(companyId, branchId)`, con la escalera sucursal →
      company → default. Sustituye las dos implementaciones divergentes de `costing-service.ts:29-44`
      y `food-cost-service.ts:123-134` (H8), y normaliza el sentinel `'LAST_PRICE'` (AD-5).
- [ ] **CP2**: Reescribir `InventoryService.recordMovement` rama `RECEIVING`
      (`inventory-service.ts:130-160`):
      - `ORDER BY received_at DESC, id DESC` determinista para `lastCost` (H3.1)
      - WAC móvil incremental en vez de recomputar sobre lotes `AVAILABLE` (H3.2, H3.3)
      - escribe **siempre** la fila `(item_id, branch_id)` de `inventory_item_costs`, sin importar el
        `costing_scope` (AD-4). El alcance no se consulta aquí: es decisión de lectura.
      - `WHERE unit_cost IS NOT NULL` explícito y contador de lotes excluidos (AD-2)
- [ ] **CP3**: `scripts/backfill-average-cost.ts` — replay cronológico por `received_at` sobre
      `inventory_batches`, ponderando por `initial_quantity`. Idempotente, `--dry-run` por defecto,
      `--apply` explícito. Reporta ítems sin lotes costeados y no los toca.
- [ ] **CP4**: Cerrar las vías que esquivan el escritor:
      - `scripts/seed-04-inventory.ts:182,233-234` → recalcular al final del seed (llamar al mismo
        backfill de CP3, no duplicar la fórmula)
      - `inventory-service.ts:608-618` (transferencia) → propagar `sourceBatch.unitCost` al lote
        destino; si el origen no tiene costo, dejarlo `NULL` y que CP2 lo cuente
      - `inventory-service.ts:711-719` (lote `SC-`) y `theoretical-consumption-service.ts:125`
        (dummy) → confirmar por escrito que quedan `NULL` a propósito

### Checkpoint A — El promedio existe y es defendible

- [ ] `inventory_item_costs` poblada para los 30 ítems × sus sucursales (hoy: 0 promedios)
- [ ] Correr el backfill dos veces seguidas no cambia ningún valor (idempotencia)
- [ ] Recibir el mismo lote dos veces por la ruta `/api/inventory/receiving` mueve el promedio de
      forma predecible por la fórmula de AD-1, verificado a mano en una hoja
- [ ] Consumir stock (`USAGE`) **no** mueve el promedio — regresión de H3.2
- [ ] Ningún servicio resuelve método ni alcance por su cuenta: solo vía CP2b (`grep` de
      `costingMethod ===` no debe dar resultados fuera de `costing-config.ts`)
- [ ] `npx tsc --noEmit` limpio y `pnpm run build` verde

### Fase 2 — Que la configuración se note

- [ ] **CP5**: `scripts/verify-costing-config.ts` — recorre **las cuatro combinaciones**
      (`LAST_COST`/`AVERAGE_COST` × `COMPANY`/`BRANCH`) sobre el mismo período y exige que
      produzcan números distintos donde los datos dicen que deben serlo. Es la prueba de
      diferenciación de `plan-pnl-real.md` aplicada a los dos ejes de configuración.

### Checkpoint B — La configuración por fin significa algo

- [ ] `AVERAGE_COST` vs `LAST_COST` dan food cost **distinto** (H6: con 29.4% de dispersión entre
      lotes, debe diferir de forma visible)
- [ ] `scope = BRANCH` vs `scope = COMPANY` dan food cost distinto en el ítem multi-sucursal
- [ ] **Cambiar `costing_scope` de ida y vuelta devuelve exactamente los números originales** — la
      prueba de que el almacenamiento fino de AD-4 hace la config no destructiva
- [ ] `usedCostFallback` = `false` para ítems con lotes costeados; `true` solo donde CP2 contó lotes
      sin costo, y la `note` lo dice

### Fase 3 — Reconstruir el reporte de varianza

- [ ] **CP6**: Entrada pública **de solo lectura** en `RecipeService` sobre `loadGraph` +
      `computeCost` (hoy ambos `private`, y el único público escribe — H7). Sin `db.update`.
- [ ] **CP7**: `lib/services/costing-variance-service.ts` — carga el grafo una vez, corre
      `computeCost` con `LAST_COST` y con `AVERAGE_COST`, resta. Sin escrituras, sin N+1.
- [ ] **CP8**: `app/api/inventory/costing/variance/route.ts` — patrón de
      `app/api/inventory/costing/config/route.ts`, con `requireTenant` + permiso `inventory:read`.
- [ ] **CP9**: UI de configuración de costeo en `app/dashboard/inventory/costing/page.tsx` + PATCH
      en `app/api/inventory/costing/config/route.ts`, con los **dos ejes**:
      - método por company y override por sucursal (`handoffs/phase-2-variance-report.md:76-94`)
      - alcance a nivel company, redactado en lenguaje de negocio: *"¿cada sucursal negocia sus
        propios precios con proveedores?"* → `BRANCH`; *"compramos centralizado para el grupo"* →
        `COMPANY` (AD-3). Con texto de ayuda que diga qué cambia en el P&L.

      Sin esto no hay forma de poner una company en `AVERAGE_COST` ni de declarar el alcance desde la
      app — el setting existiría solo en la base.
- [ ] **CP10**: `app/dashboard/inventory/costing/variance/page.tsx` — tabla, resaltado sobre 5 puntos
      porcentuales, selector de sucursal (`useBranch()`).
- [ ] **CP11**: Borrar `CostingService.getVarianceReport` (`costing-service.ts:168-205`) y su
      comentario `@deprecated`; actualizar la fila **P4** de `docs/plan-pnl-real.md:312` y la
      referencia en `food-cost-service.ts:22-23` apuntando a este plan.

### Checkpoint C — Completo

- [ ] Al menos una receta muestra `variance ≠ 0` con datos reales (H6 lo predice)
- [ ] El reporte no ejecuta ningún `UPDATE` — verificable con `list_slow_queries` o un log
- [ ] Una company sin `average_cost` capturado muestra varianza cero **con nota explicando por qué**,
      no un cero mudo
- [ ] `handoffs/phase-2-variance-report.md` cerrado o borrado

## Risks and Mitigations

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Llenar el promedio cambia el food cost del P&L de sucursales ya en `AVERAGE_COST` sin aviso | **Alto** — el número que el dueño vio ayer cambia hoy sin explicación | Hoy nadie está en `AVERAGE_COST` (H1): la ventana está abierta. CP1→CP5 debe cerrar **antes** de que CP9 dé la UI para activarlo |
| CP2 sin CP4: el promedio se llena a medias y deja de ser obvio que falta | Alto | AD-9: no se mergean por separado |
| `last_cost` no determinista (H3.1) ya está en producción y sostiene todo el costeo | Alto | CP2 lo arregla en la misma tarea; no esperar a la Fase 3 |
| **La config se agrega a dos resolvedores divergentes y se separan más** (H8) | Alto | CP2b es prerrequisito de CP2: un solo resolvedor antes de meter el segundo eje. Checkpoint A lo verifica con `grep` |
| **Duplicar el eje de config duplica la superficie de prueba** (2 métodos × 2 alcances) | Medio | CP5 recorre las 4 combinaciones explícitamente. Es el precio de AD-3 y está presupuestado |
| **El cliente elige mal el alcance porque no entiende la pregunta** | Medio | AD-3: la UI pregunta por el hecho de negocio ("¿cada sucursal negocia sus precios?"), no por el concepto contable. Default `COMPANY` = comportamiento actual |
| Transferencias inyectan stock sin costo y arrastran el WAC | Medio | AD-2 los excluye y los cuenta; CP4 propaga el costo del lote origen |
| El backfill escribe valores malos sobre datos sucios | Medio | CP3 es `--dry-run` por defecto e idempotente: se revisa antes de aplicar |
| Recalcular un período pasado da otro número | Medio | AD-1 (WAC de compra) lo elimina por construcción; `pnl_snapshots` es el segundo cinturón |
| Un tenant cambia `costing_scope` y pierde histórico | Medio | AD-4: se almacena siempre por sucursal, el alcance solo resuelve en lectura. Checkpoint B prueba el viaje de ida y vuelta |
| CP6 expone el grafo y alguien lo usa para escribir | Bajo | La entrada nueva es explícitamente read-only; `calculateRecipeCost` sigue siendo el camino de escritura |

## Open Questions

**Ninguna pregunta bloquea el arranque.** Las dos que bloqueaban en la primera versión de este plan
se resolvieron modelando el alcance como configuración del tenant (AD-3) en vez de intentar
adivinarlo:

- ~~**Q1**: ¿algún cliente opera con precios distintos por sucursal?~~ → **Resuelta por AD-3.** No es
  nuestra decisión ni hace falta saberla de antemano: es config por tenant, con default `COMPANY`.
- ~~**Q2**: ¿ponderar por lo comprado o por lo recibido tras merma?~~ → **Resuelta: lo comprado.**
  Se deriva de la decisión P2 de `plan-pnl-real.md` (la merma es un renglón propio); si el peso ya
  descuenta merma, el costo la absorbe dos veces. No es preferencia del cliente (AD-6).
- **Q3 (no bloquea):** ¿`standard_cost` (`schema.ts:698`, hoy sin uso) entra como tercera columna de
  comparación en el reporte? El handoff lo sugiere como opcional. Recomendación: no en v1 — dos
  números reales valen más que tres, uno de ellos vacío.
- **Q4 (no bloquea):** ¿el reporte de varianza se congela en `pnl_snapshots` junto al food cost, o se
  calcula al vuelo? Con AD-1 el número es estable, así que al vuelo alcanza.
- **Q5 (no bloquea, decide CP12):** ¿`inventory_items.average_cost` / `last_cost` se conservan como
  caché del agregado de company, o se retiran y todo lee de `inventory_item_costs`? Conservarlas
  evita tocar `recipe-service`, `executive-report-service` y las 4 rutas de inventario que las leen
  hoy; retirarlas elimina la posibilidad de que queden desincronizadas. Recomendación: conservarlas
  como caché en v1, con un comentario que diga que la fuente de verdad es la tabla nueva.

## Definition of Done (todas las tareas)

- `npx tsc --noEmit` limpio y `pnpm run build` verde.
- Dinero en centavos (integer). Todo scoping por `companyId`/`branchId`.
- Migraciones con `pnpm db:generate` (nunca `db:push` sin verificar `.env`).
- Ningún método de lectura ejecuta `UPDATE` — el defecto original que motivó este plan.
- Ningún renglón nuevo se muestra sin `source` + `note`.
- Ningún servicio resuelve método ni alcance por su cuenta: todo pasa por `costing-config.ts` (CP2b).
- Toda configuración nueva de tenant tiene default = comportamiento actual, para que actualizar el
  código nunca cambie por sí solo un número que el cliente ya vio.
- Verificación por script `npx tsx scripts/verify-*.ts` (el repo no tiene runner de unit tests).
