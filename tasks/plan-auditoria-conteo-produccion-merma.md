# Implementation Plan: Auditoría de calidad — conteo, producción y merma

## Overview

`tasks/plan-conteo-produccion-merma.md` está implementado y commiteado: 17 tareas, ~2 400 líneas,
7 servicios nuevos, 2 tablas, 7 specs E2E, migraciones 0037/0047/0048/0049. Este plan **no añade
funcionalidad**: audita si lo construido se sostiene fuera del entorno de pruebas.

La investigación estática encontró nueve observaciones, ordenadas aquí por lo que rompen. La primera
es de otra categoría que el resto: si se confirma, **la feature completa no corre en producción**
aunque los 37 specs estén verdes.

Cada tarea sigue la misma forma: **primero una prueba que falla y demuestra el defecto, después el
arreglo.** Ninguna observación se da por cierta hasta que existe el test rojo — son hipótesis leídas
del código, no bugs confirmados en ejecución.

### Observaciones que originan este plan

| # | Observación | Evidencia | Severidad |
|---|---|---|---|
| **O-1** | Los 4 extractores se disparan con `void` después de responder al cliente. El deploy es Vercel (`vercel.json`) y no hay un solo `waitUntil` en el repo. En serverless la invocación puede congelarse al devolver la respuesta: los extractores podrían **no ejecutarse nunca en producción**, mientras en local (proceso persistente) siempre terminan. **Radio acotado:** el conteo clásico 80/20 **no** está expuesto — `stock-count-service.ts:353` hace `await extractStockCountFromInstance(...)` dentro del request. Los expuestos son los 4 `void`: conteo por template dinámico, merma, producción y recepción | `workflow-execution-service.ts:636-661` vs `stock-count-service.ts:352-357` | **Crítica** |
| **O-2** | Todas las fechas se sellan en UTC en un producto mexicano. El cron es `"0 5 * * *"` sin `TZ=` (= 23:00 hora local del día **anterior**), y tanto `countDate` como `snapshotDate` salen de `toISOString().slice(0,10)`. Un conteo cerrado a las 18:01 local se sella con la fecha de mañana; `buildSnapshot` cruza por `countDate = snapshotDate` y no lo encuentra → `countedStock` NULL → `variance` NULL. **El conteo de cierre, que es el caso normal en restaurantes, no produciría varianza.** El repo ya tiene `localDateString(at, timeZone)` y `companies.timezone`, y `generate-morning-brief.ts:34` ya usa `TZ=America/Mexico_City` | `cron-inventory-snapshot.ts:22`, `inventory-snapshot-service.ts:38-44`, `stock-count-from-workflow.ts` (`countDate`), vs `lib/workflows/today.ts:104` | **Alta** |
| **O-3** | `expandRecipeLeaves` cachea por `recipeId` hojas **ya escaladas** por `quantityNeeded`. Dos recetas que compartan una sub-receta con cantidades distintas: la segunda recibe las cantidades de la primera → descuento de insumos incorrecto. Los specs producen una sola receta, por eso no lo ven | `production-from-workflow.ts:55-95` | **Alta** |
| **O-4** | AD-4 del plan original prohibió la idempotencia por `notes LIKE` y exigió índice único. Se cumplió en `stock_counts` e `inventory_snapshots`, pero **3 de 4 rutas siguen con el hack**: producción, merma manual y merma por varianza. Además el check-then-insert no es atómico: dos reintentos concurrentes duplican | `production-from-workflow.ts:145`, `merma-from-workflow.ts:155`, `stock-count-from-workflow.ts:326` | Media |
| **O-5** | `production_ingredients.actual_quantity` **y** `expected_quantity` siguen `integer`. `actualQuantity` se redondea explícito (`Math.round`); `expectedQuantity` llega sin redondear a una columna entera, así que Postgres lo redondea igual. **Para cualquier insumo bajo 0.5 unidades — 0.35 kg de queso, 0.2 L de crema, 30 g de especia — ambas columnas registran `0`**, mientras el lote se descuenta el valor exacto y `totalCost` se calcula sobre el valor exacto: la fila queda como "consumió 0 kg, costó $12". No es deriva por redondeo, es el registro de consumo destruido para la mayoría de las líneas de receta de un restaurante — y `production_ingredients` es lo que leen el costeo de recetas y el análisis de varianza. (`inventory_batches` ya es `numeric(12,4)` desde la migración `0051` — OQ-2 se resolvió después y el todo quedó desactualizado) | `production-service.ts:150-151`, `production-from-workflow.ts:223` | **Alta** |
| **O-6** | `resolveDynamicSteps` no tiene tope de expansión. La ruta que generaliza sí lo tenía — existe `tests/limite-30-skus.spec.ts`. Una compañía con 300 ítems etiquetados genera 300 pasos en el stepper | `dynamic-steps.ts:150-200` | Media |
| **O-7** | 17 `console.*` en los archivos nuevos; CLAUDE.md exige `createChildLogger`. Sin logs estructurados no hay forma de detectar O-1 ni O-4 en producción | `dynamic-steps.ts`, los 3 `*-from-workflow.ts` | Media |
| **O-8** | `DynamicResolveContext.branchId` se acepta y nunca se usa; `buildSnapshot` filtra `stock_counts` sólo por `branchId`, sin `companyId` | `dynamic-steps.ts:17`, `inventory-snapshot-service.ts:78-88` | Baja |
| **O-9** | `inventory_snapshots` escribe una fila por (ítem alto valor × sucursal × día) **incluso con stock 0 y sin conteo**. 15 sucursales × 100 SKUs × 365 días ≈ 550 k filas/año sin política de retención | `inventory-snapshot-service.ts:100-110` | Baja |

## Architecture Decisions

- **AD-A1 — Cada tarea entrega test rojo antes que arreglo.** Las nueve observaciones salen de lectura
  estática. *Rationale:* la suite pasó 37/37 con estos defectos presentes; sin una prueba que falle
  primero, no hay evidencia de que el arreglo arregla algo ni de que el defecto era real.

- **AD-A2 — O-1 se resuelve moviendo los extractores a Inngest, no a `waitUntil`.** El repo ya sirve
  ~30 funciones Inngest con reintentos y trazas. *Rationale:* `waitUntil` sólo alarga la vida del
  proceso — sigue sin reintentos, sin visibilidad y sin cola. Inngest cierra O-1 **y** el riesgo R-5
  del plan original (fallos que mueren en un `console.error`) de una vez. Coste: un evento nuevo y una
  función de despacho.

- **AD-A3 — La fecha operativa es la de la zona horaria de la compañía, no UTC.** `companies.timezone`
  ya existe con default `America/Mexico_City`, y `localDateString` ya está escrito. *Rationale:* no
  inventar una segunda convención de fechas; la de `cash-flow-service` y `morning-brief` es la del repo.

- **AD-A4 — La idempotencia se unifica en columna + índice único, cerrando AD-4.** `production_results`
  e `inventory_waste` reciben `workflow_instance_id` con único parcial. *Rationale:* es la decisión que
  el plan original ya tomó y que la implementación cumplió a medias; dejar dos mecanismos conviviendo
  es peor que cualquiera de los dos.

- **AD-A6 — `production_ingredients` se migra a `numeric(12,4)` dentro de este plan (OQ-A2 decidida).**
  *Rationale:* al verificar O-5 resultó que no es un redondeo tolerable sino la pérdida total del
  registro para insumos bajo 0.5 unidades. No es una decisión que dependa de medir. La migración `0051`
  ya hizo exactamente este movimiento sobre `inventory_batches` con `USING ... ::numeric` y lleva meses
  en producción: el patrón está probado y el riesgo es conocido.

- **AD-A7 — Ningún backfill antes de A9 (OQ-A3 decidida).** *Rationale:* tres de las cuatro guardas de
  idempotencia son el `notes LIKE` con check-then-insert no atómico. Un backfill masivo es el peor input
  posible para una guarda así — la vía más directa a duplicar el histórico completo.

- **AD-A5 — Auditar no es reescribir.** Fuera de alcance: rediseñar el resolver, tocar
  `applyStockCountAdjustments`, reprocesar producción en automático. *Rationale:* el plan audita 2 400
  líneas ya en producción; ampliar el alcance convierte la auditoría en una segunda implementación sin red.

## Dependency Graph

```
A1 evidencia O-1 ──► A2 extractores a Inngest ──┐
                                                 ├──► Checkpoint 0 (bloqueante)
A3 spec fecha local ──► A4 fix TZ ───────────────┘
                                                 │
A5 spec sub-receta ──► A6 fix cache ─────────────┤──► Checkpoint 2
A7 daño en datos ──► A7b migrar a numeric ───────┘
                                                 │
A8 spec doble completado ──► A9 único + columna ─┤──► Checkpoint 3
                                                 │       │
A10 tope expansión ─┐                            │       └──► (backfill: plan aparte,
A11 logger          ├──► A12 scoping + retención ┴──► CP4        nunca antes de A9)
```

## Task List

### Phase 0 — ¿Corre esto en producción? (fail fast)

- [ ] **A1 — Probar si los extractores sobreviven a la respuesta HTTP.**
  Instrumentar temporalmente los 4 extractores con un log de entrada y de salida que incluya
  `instanceId` y duración, desplegar a preview, completar una instancia de cada tipo y leer los logs de
  Vercel. Si sólo aparece la entrada (o ninguna línea), O-1 está confirmada.
  - **Criterios de aceptación:**
    - [ ] Existe evidencia en logs de preview de si `extract*` llega a su línea final tras responder
    - [ ] El resultado (confirmada / descartada) queda escrito en el todo con el enlace al log
  - **Verificación:** despliegue a preview + una instancia completada por extractor
  - **Deps:** ninguna · **Archivos:** los 4 `*-from-workflow.ts` (instrumentación temporal) · **Tamaño:** S

- [ ] **A2 — Extractores a Inngest (sólo si A1 confirma O-1).**
  Evento `workflow/instance.completed` en `lib/inngest/events.ts`; función despachadora nueva que llama
  a los 4 extractores con `step.run` por extractor (fallo aislado, reintento independiente).
  `workflow-execution-service.ts` pasa de 4 `void import()` a un `inngest.send`.
  - **Criterios de aceptación:**
    - [ ] Completar una instancia emite el evento y los extractores corren en la función Inngest
    - [ ] Un extractor que lanza no impide que los otros tres terminen
    - [ ] El fallo queda visible como run fallido, no como `console.error` perdido (cierra R-5)
  - **Verificación:** `INNGEST_DEV=1 pnpm run dev` + dev server de Inngest; `pnpm exec playwright test tests/conteo-dinamico.spec.ts tests/produccion-diaria.spec.ts` siguen verdes
  - **Deps:** A1 · **Archivos:** `lib/inngest/events.ts`, `lib/inngest/functions/workflow-extractors.ts` (nuevo), `lib/inngest/functions/index.ts`, `lib/services/workflow-execution-service.ts` · **Tamaño:** M

### Checkpoint 0 — bloqueante
- [ ] `pnpm run build` limpio
- [ ] Los 6 specs de la feature siguen verdes
- [ ] **Decisión humana:** si A1 descarta O-1, A2 se cancela y se documenta por qué
- [ ] Si A1 confirma O-1, revisar con humano **antes** de seguir: implica que la feature nunca corrió en producción y hay datos faltantes que reprocesar (ver OQ-A3)

### Phase 1 — La fecha operativa

- [ ] **A3 — Spec que demuestra la pérdida del conteo de cierre.**
  `tests/conteo-fecha-local.spec.ts`: completar un conteo con `completedAt` a las 18:30 hora de Ciudad
  de México (≥ 00:00 UTC) y correr `buildSnapshot` del mismo día operativo. Hoy debe **fallar**:
  `countedStock` sale NULL.
  - **Criterios de aceptación:**
    - [ ] El spec falla contra el código actual por la razón esperada, no por otra
    - [ ] Cubre también el borde inverso: 00:30 local (= 06:30 UTC, mismo día en ambas zonas) sigue bien
  - **Verificación:** `pnpm exec playwright test tests/conteo-fecha-local.spec.ts` → rojo
  - **Deps:** ninguna · **Archivos:** `tests/conteo-fecha-local.spec.ts` (nuevo), `tests/support/db.ts` · **Tamaño:** S

- [ ] **A4 — Fecha operativa por zona horaria de la compañía.**
  `countDate` y `snapshotDate` pasan a `localDateString(at, company.timezone)`. El cron adopta
  `TZ=America/Mexico_City` y una hora posterior al cierre real. Ver OQ-A1: hay que decidir qué día sella
  una corrida de madrugada.
  - **Criterios de aceptación:**
    - [ ] A3 pasa a verde
    - [ ] `snapshot-idempotente.spec.ts` sigue verde
    - [ ] Ninguna fecha del flujo se deriva ya de `toISOString().slice(0,10)`
  - **Verificación:** `pnpm exec playwright test tests/conteo-fecha-local.spec.ts tests/snapshot-idempotente.spec.ts`; `pnpm run build`
  - **Deps:** A3, OQ-A1 · **Archivos:** `lib/services/stock-count-from-workflow.ts`, `lib/services/inventory-snapshot-service.ts`, `lib/inngest/functions/cron-inventory-snapshot.ts` · **Tamaño:** M

### Checkpoint 1
- [ ] `pnpm run build` limpio; los 7 specs de la feature verdes
- [ ] Manual: un conteo cerrado a las 19:00 hora local aparece en el snapshot de **ese** día
- [ ] Verificar si hay filas de `stock_counts` / `inventory_snapshots` ya selladas con la fecha equivocada y decidir si se corrigen

### Phase 2 — El cálculo del consumo

- [ ] **A5 — Spec que demuestra el cache envenenado de sub-recetas.**
  `tests/subreceta-compartida.spec.ts`: dos recetas activas que comparten una sub-receta con cantidades
  distintas, producidas en la misma instancia. Hoy debe fallar: la segunda descuenta las cantidades de
  la primera.
  - **Criterios de aceptación:**
    - [ ] El spec falla contra el código actual con la diferencia numérica exacta esperada
    - [ ] Asegura además que el orden de las recetas en el mapa no cambia el resultado
  - **Verificación:** `pnpm exec playwright test tests/subreceta-compartida.spec.ts` → rojo
  - **Deps:** ninguna · **Archivos:** `tests/subreceta-compartida.spec.ts` (nuevo), `tests/support/db.ts` · **Tamaño:** S

- [ ] **A6 — Cachear hojas sin escalar y escalar en el punto de uso.**
  El cache guarda la expansión por unidad de `baseYield`; el escalado por `quantityNeeded` se aplica al
  leerlo. Elimina la dependencia entre la cantidad de la primera llamada y las siguientes.
  - **Criterios de aceptación:**
    - [ ] A5 pasa a verde
    - [ ] `produccion-diaria.spec.ts`, `consumo-fefo.spec.ts` y `lote-insuficiente.spec.ts` siguen verdes
    - [ ] La recursión de sub-recetas sigue aplicando `yieldPercent` una sola vez por nivel
  - **Verificación:** `pnpm exec playwright test tests/subreceta-compartida.spec.ts tests/produccion-diaria.spec.ts tests/consumo-fefo.spec.ts tests/lote-insuficiente.spec.ts`
  - **Deps:** A5 · **Archivos:** `lib/services/production-from-workflow.ts` · **Tamaño:** S

- [ ] **A7 — Evaluar el daño ya causado en `production_ingredients`.**
  El defecto está confirmado por lectura (AD-A6), así que esto **no** decide si migrar: mide cuántas
  filas existentes ya están corruptas. Consulta sobre `production_ingredients` contando filas con
  `actual_quantity = 0` y `total_cost > 0` — la firma exacta de un insumo fraccionario perdido — y
  spec `tests/redondeo-ingredientes.spec.ts` que fija el comportamiento actual antes de cambiarlo.
  - **Criterios de aceptación:**
    - [ ] Cifra medida de filas ya afectadas en la base real, por compañía
    - [ ] El spec demuestra que 0.35 kg registra `0` en `actual_quantity` y `expected_quantity`
    - [ ] Queda escrito si las filas corruptas se pueden reconstruir (`total_cost / unit_cost`) o no
  - **Verificación:** `pnpm exec playwright test tests/redondeo-ingredientes.spec.ts`
  - **Deps:** ninguna · **Archivos:** `tests/redondeo-ingredientes.spec.ts` (nuevo) · **Tamaño:** S

- [ ] **A7b — Migrar `production_ingredients` a `numeric(12,4)` (AD-A6).**
  `expected_quantity` y `actual_quantity` a `numeric(12,4)`, mismo patrón que la migración `0051` sobre
  `inventory_batches` (`USING ... ::numeric`). Retirar el `Math.round` de `production-service.ts:150`;
  `total_cost` ya usa el valor exacto y no cambia. Revisar los lectores de costo de producción.
  - **Criterios de aceptación:**
    - [ ] A7 pasa a verde con el valor exacto: 0.35 registra `0.3500`, no `0`
    - [ ] Cero `Math.round` en la ruta de escritura de `production_ingredients`
    - [ ] `produccion-diaria.spec.ts`, `consumo-fefo.spec.ts` y `lote-insuficiente.spec.ts` siguen verdes
    - [ ] La migración generada no contiene `DROP` y castea sin perder las filas existentes
  - **Verificación:** `pnpm db:generate` + revisión del SQL; `pnpm exec playwright test tests/redondeo-ingredientes.spec.ts tests/produccion-diaria.spec.ts tests/consumo-fefo.spec.ts tests/lote-insuficiente.spec.ts`; `pnpm run build`
  - **Deps:** A7 · **Archivos:** `lib/db/schema.ts`, `drizzle/00XX_*.sql`, `lib/services/production-service.ts`, `lib/services/production-from-workflow.ts` · **Tamaño:** M

### Checkpoint 2
- [ ] `pnpm run build` limpio; specs de producción verdes
- [ ] Migración de A7b revisada, sin `DROP`
- [ ] El daño histórico de A7 está cuantificado y hay decisión sobre si se reconstruyen las filas en `0`
- [ ] **Revisar con humano antes de Phase 3**

### Phase 3 — Idempotencia real

- [ ] **A8 — Spec de doble procesamiento concurrente.**
  `tests/extractor-idempotente.spec.ts`: disparar dos veces el mismo extractor de producción y de merma
  **sin esperar entre llamadas**. Con el check-then-insert por `notes LIKE`, ambas deben pasar el chequeo
  y duplicar.
  - **Criterios de aceptación:**
    - [ ] El spec demuestra la duplicación en producción y en merma manual
    - [ ] Cubre también la merma por varianza de `stock-count-from-workflow`
  - **Verificación:** `pnpm exec playwright test tests/extractor-idempotente.spec.ts` → rojo
  - **Deps:** ninguna · **Archivos:** `tests/extractor-idempotente.spec.ts` (nuevo), `tests/support/db.ts` · **Tamaño:** M

- [ ] **A9 — `workflow_instance_id` + único parcial, retirando `notes LIKE` (cierra AD-4).**
  Columna nueva en `production_results` e `inventory_waste` con índice único parcial; los tres
  extractores pasan a `onConflictDoNothing`. La merma por varianza necesita distinguir su origen del de
  la merma manual en la misma instancia — probablemente único compuesto con el motivo de origen.
  - **Criterios de aceptación:**
    - [ ] A8 pasa a verde: la segunda escritura concurrente no crea fila
    - [ ] Cero ocurrencias del marcador `instance:` como mecanismo de idempotencia en `lib/services/`
    - [ ] La migración generada no contiene `DROP` y las filas existentes sin la columna siguen válidas
  - **Verificación:** `pnpm db:generate` + revisión del SQL; `pnpm exec playwright test tests/extractor-idempotente.spec.ts tests/merma-manual.spec.ts tests/merma-automatica.spec.ts tests/produccion-diaria.spec.ts`
  - **Deps:** A8 · **Archivos:** `lib/db/schema.ts`, `drizzle/00XX_*.sql`, `lib/services/production-from-workflow.ts`, `lib/services/merma-from-workflow.ts`, `lib/services/stock-count-from-workflow.ts` · **Tamaño:** M

### Checkpoint 3
- [ ] `pnpm run build` limpio; migración revisada sin `DROP`
- [ ] Todos los specs de la feature verdes
- [ ] Un único mecanismo de idempotencia en los 4 extractores

### Phase 4 — Robustez y observabilidad

- [ ] **A10 — Tope de expansión en `resolveDynamicSteps`.**
  Límite configurable con el mismo valor que ya respeta el conteo (ver `tests/limite-30-skus.spec.ts`),
  y comportamiento explícito cuando el filtro no coincide con nada — hoy el paso se descarta en silencio
  y la instancia puede quedar sin pasos.
  - **Criterios de aceptación:**
    - [ ] Un filtro que coincide con más entidades que el tope expande sólo hasta el tope y lo registra
    - [ ] Una instancia que quedaría sin pasos falla de forma visible en vez de crearse vacía
    - [ ] `limite-30-skus.spec.ts` sigue verde
  - **Verificación:** `pnpm exec playwright test tests/limite-30-skus.spec.ts tests/conteo-dinamico.spec.ts`
  - **Deps:** ninguna · **Archivos:** `lib/workflows/dynamic-steps.ts`, `tests/conteo-dinamico.spec.ts` · **Tamaño:** S

- [ ] **A11 — `createChildLogger` en lugar de `console.*`.**
  Los 17 `console.*` de los 4 archivos nuevos pasan a logger con `instanceId`, `companyId` y `branchId`
  como campos estructurados, no interpolados en el mensaje.
  - **Criterios de aceptación:**
    - [ ] Cero `console.` en `dynamic-steps.ts` y los tres `*-from-workflow.ts`
    - [ ] Cada log de error lleva `instanceId` como campo consultable
  - **Verificación:** `grep -c "console\." lib/workflows/dynamic-steps.ts lib/services/*-from-workflow.ts` → 0; `pnpm run build`
  - **Deps:** A2 (para no reescribir logs que van a moverse) · **Archivos:** `lib/workflows/dynamic-steps.ts`, los 3 `*-from-workflow.ts` · **Tamaño:** S

- [ ] **A12 — Scoping por `companyId` y retención de snapshots.**
  `buildSnapshot` filtra `stock_counts` también por `companyId`; se elimina o se usa
  `DynamicResolveContext.branchId`; se decide si el snapshot omite ítems sin stock ni conteo y si hay
  purga de filas antiguas.
  - **Criterios de aceptación:**
    - [ ] Ninguna query del flujo cruza compañías aunque reciba un `branchId` ajeno
    - [ ] `branchId` en el resolver se usa o desaparece de la firma
    - [ ] La política de retención queda escrita (aunque la decisión sea "ninguna, por ahora")
  - **Verificación:** `pnpm exec playwright test tests/snapshot-idempotente.spec.ts`; `pnpm run build`
  - **Deps:** ninguna · **Archivos:** `lib/services/inventory-snapshot-service.ts`, `lib/workflows/dynamic-steps.ts` · **Tamaño:** S

### Checkpoint 4 — Completo
- [ ] `pnpm run build` limpio; `pnpm lint` sin errores nuevos respecto al baseline
- [ ] Suite completa `pnpm test:e2e` verde, incluidos los 4 specs nuevos de auditoría
- [ ] Las nueve observaciones tienen veredicto: confirmada y arreglada, confirmada y diferida con razón, o descartada
- [ ] `tasks/todo-conteo-produccion-merma.md` actualizado: OQ-2 quedó resuelta por la migración `0051` y sigue marcada como abierta
- [ ] Listo para review

## Risks and Mitigations

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| RA-1 | A1 confirma O-1: la feature nunca corrió en producción y hay meses de instancias completadas sin extraer | **Alto** | Checkpoint 0 es bloqueante y explícitamente humano. El reproceso masivo es un plan aparte, no una tarea de este (OQ-A3) |
| RA-2 | Mover los extractores a Inngest (A2) cambia el momento en que aparecen los datos: dejan de ser inmediatos tras completar | Medio | Los specs E2E esperan por la fila, no por el instante. Verificar que el retraso no rompe la UI que lee `stock_counts` justo después de completar |
| RA-3 | A4 cambia la fecha de filas ya escritas: reportes históricos de varianza se mueven de día | Medio | No se reescribe el pasado; se documenta la fecha de corte. Checkpoint 1 obliga a mirar los datos existentes antes de decidir |
| RA-4 | A9 añade columnas a `inventory_waste`, que leen 6 servicios de analítica | Medio | Columna nullable con índice único **parcial**: las filas existentes y las capturas manuales no se ven afectadas |
| RA-5 | Los specs comparten la base de desarrollo (`workers: 1`) y los nuevos de concurrencia (A8) son los más propensos a dejar basura | Bajo | Patrón `[E2E]` + limpieza en `tests/support/db.ts`, igual que los 7 specs existentes |
| RA-6 | La auditoría se convierte en una reimplementación | Medio | AD-A5 fija lo que está fuera de alcance. Cualquier hallazgo nuevo se anota como observación, no se arregla dentro de este plan |

## Open Questions — las tres decididas 2026-08-20

- [x] **OQ-A1 — ¿Qué día operativo sella una corrida de madrugada? → D−1.**
  `buildSnapshot` no reconstruye historia: calcula `calculatedStock` del estado **vivo** de
  `inventory_batches`. Corriendo a las 4:00 locales, ese estado vivo *es* el cierre del día anterior;
  sellarlo con D le pega los números de ayer a un día que no ha pasado. Razón decisiva: tras A4 los
  conteos de cierre quedan con `countDate = D−1` y el snapshot cruza por `countDate = snapshotDate` —
  sólo D−1 hace que se encuentren, que es justo el bug O-2 que se está arreglando; elegir D lo
  reintroduciría por otra puerta. Implementación: cron `TZ=America/Mexico_City 0 4 * * *` (después del
  cierre más tardío, antes de que abra nadie) pasando D−1 explícito. `buildSnapshot(companyId,
  branchId, date?)` ya acepta la fecha: **cero cambios de firma**.
  ⚠️ Cualquier UI que diga "snapshot de hoy" mostrará el día anterior. Es correcto para un documento de
  cierre, pero se etiqueta "cierre del <fecha>", no "hoy".

- [x] **OQ-A2 — ¿Migrar `production_ingredients` a `numeric(12,4)`? → Sí, y no depende de medir.**
  Al verificar O-5 resultó peor de lo redactado: no es deriva por redondeo, es que todo insumo bajo 0.5
  unidades registra `0` en ambas columnas mientras el lote se descuenta exacto y el costo se calcula
  exacto. En un restaurante eso es la mayoría de las líneas de receta. Ver AD-A6. A7 deja de ser
  "medir para decidir" y pasa a ser evaluación de daño en datos existentes; la migración es A7b.

- [x] **OQ-A3 — ¿Reprocesar las instancias nunca extraídas? → Sí, acotado, y nunca antes de A9.**
  Se verificó cuál extractor mueve stock de verdad, que era de lo que dependía todo:
  | Extractor | ¿Mueve inventario? |
  |---|---|
  | producción | **Sí** — `recordProduction` descuenta `inventory_batches` |
  | conteo | No — sólo lee lotes; los ajustes siguen siendo exclusivos de `applyStockCountAdjustments` |
  | merma | No — lee lotes para resolver `batchId`, sólo inserta en `inventory_waste` |
  | recepción | No — `processReceiving` escribe reportes, ítems e incidencias; los lotes se crean después |

  Uno de cuatro es peligroso, no los cuatro. Conteo, merma y recepción se reprocesan sin riesgo y
  recuperan los registros perdidos. **Producción no se reprocesa jamás en automático**: descontaría
  lotes por movimientos de hace meses, stock que la realidad ya consumió y que algún ajuste de conteo
  posterior probablemente ya corrigió. Para producción, un reporte de instancias sin extraer y revisión
  humana. El orden es obligatorio (AD-A7): **A9 primero**, o el backfill duplica el histórico completo.
  El backfill en sí es un plan aparte, no una tarea de este.

## Notas de ejecución

- Nomenclatura: el skill sugiere `tasks/plan.md` / `tasks/todo.md`, pero esos archivos ya contienen
  trabajo vivo y sin relación (refactor de Inventory Movements y propinas → nómina). Se sigue la
  convención del repo, `plan-<slug>.md` / `todo-<slug>.md`.
- Migraciones con `pnpm db:generate`, nunca `db:push`. Última migración actual: `0053_demonic_viper.sql`.
- Revisar cada SQL generado antes de aplicar: si contiene `DROP`, no aplicar.
- Los specs corren en serie contra la base de desarrollo; correr contra build:
  `pnpm build && PLAYWRIGHT_WEB_SERVER_CMD="npm run start" pnpm test:e2e`.
