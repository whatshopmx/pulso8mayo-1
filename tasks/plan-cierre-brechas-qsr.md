# Implementation Plan: Cierre de brechas QSR (egresos + producción/FEFO)

Auditoría origen: artifact "Brechas de Egresos y FEFO" (26 ago 2026).
Checklist vivo: `tasks/todo-cierre-brechas-qsr.md`.
Documentos de negocio: `finzasordenes.md` (Egresos v1.0) y el manual de Producción/FEFO v2.0.

## Overview

Cerrar los huecos entre los dos manuales operativos y el código. La auditoría mapeó 23
secciones: 7 cubiertas, 13 parciales, 3 ausentes. El plan las ataca en cinco fases ordenadas
por dependencia real, no por tamaño: primero se desbloquea la base (migraciones), luego la
verdad del consumo, luego la trazabilidad, luego el amarre documental, y al final los módulos
que exigen tablas y UI nuevas.

## Hallazgos de planeación (verificados contra el código, no contra el documento)

Tres correcciones a la hoja de ruta inicial. Las tres cambian el trabajo:

1. **El variance report ya existe** — `ReportsService.getVarianceReport` (`reports-service.ts:26`),
   con ruta `app/api/inventory/reports/variance/route.ts` y pantalla en
   `app/dashboard/inventory/reports/page.tsx`. No hay que construirlo: hay que corregirle la
   fórmula. El homónimo de `costing-service.ts:150-205` es basura sin llamadores y se borra.

2. **El "consumo real" del reporte es teórico disfrazado.** Al ingerir una venta,
   `TheoreticalConsumptionService.consume` explota la receta y descuenta lotes por FEFO
   escribiendo movimientos `USAGE` (`theoretical-consumption-service.ts:88`). El reporte
   calcula el real como *la suma de todos los movimientos negativos*, así que:

   ```
   real ≈ (misma explosión de receta) + WASTE + TRANSFER saliente + ajustes
   varianza = real − teórico ≈ merma + transferencias
   ```

   El reporte **no puede detectar robo ni porción generosa**, que son las dos cosas para las
   que el §10 dice que existe. La fórmula del manual toma el real del conteo físico
   (inicial + compras − final), que es exactamente lo que ya calcula
   `InventoryReportsService.getUsageReport`. Ahí está el arreglo.

3. **La ingesta de venta por platillo ya tiene vía y UI.** `sales-ingest-service.ts` +
   `sales-ingest-pure.ts` (CSV, mapeo, `guessMapping`, errores por fila sin abortar el lote),
   `pos_mapping_templates`, `app/api/sales/cuts/upload`, `app/dashboard/sales/mapping`.
   No es una integración por construir: es una vía por operar. `sales_entries` tiene 1 fila.

Además, bloqueo de infraestructura: **13 migraciones aplicadas sin fila en
`drizzle.__drizzle_migrations`** (0032, 0035, 0037, 0038, 0039, 0041, 0043, 0050, 0051, 0052,
0054, 0055, 0056). Sus objetos existen en la base — verificado columna por columna — pero 12
de las 13 no tienen `IF NOT EXISTS`, así que el próximo `pnpm db:migrate` intentará
re-ejecutarlas, fallará con "already exists" y abortará. **Casi toda tarea de este plan
necesita una migración**, así que esto va primero.

## Architecture Decisions

- **AD-1 · El consumo real sale del conteo físico, no de los movimientos.** El variance report
  toma `actual` de `InventoryReportsService.getUsageReport` (inicial + compras − final sobre
  `inventory_snapshots`/`stock_counts`). Es la única fuente que no está contaminada por la
  propia explosión de receta.
- **AD-2 · La merma se resta, no se cuenta como varianza.** `varianza = teórico − real − merma`
  del §9.2, con la merma tomada de `inventory_waste` excluyendo `STAFF`/`COURTESY` (misma
  convención que `WasteReport.trueWasteLossCents`).
- **AD-3 · El lote hijo hereda, no clona.** La producción emite un `inventory_batches` propio
  con caducidad calculada y referencia a los lotes consumidos. Se sigue el patrón ya probado
  en transferencias (`inventory-service.ts:696-735`), no uno nuevo.
- **AD-4 · Taxonomías aditivas.** `abcClass` se agrega como columna nueva y `isHighValue` se
  mantiene derivado (`abcClass = 'A'`), porque tiene consumidores vivos: conteo dirigido y el
  límite del onboarding. Nada de migrar el booleano en sitio.
- **AD-5 · Migraciones sin drops.** Todas las de este plan son aditivas y con `IF NOT EXISTS`
  donde el generador lo permita, para no repetir el problema que arrastra el journal.
- **AD-6 · Cada fase deja el sistema funcionando.** Las tareas son cortes verticales: schema +
  servicio + API + UI de una capacidad, no "todo el schema" y luego "toda la UI".

## Dependency graph

```text
Task 0 · journal reparado
    │  (toda migración depende de esto)
    ├──────────────────────────────┬──────────────────────┬─────────────────┐
    ▼                              ▼                      ▼                 ▼
Fase 1 · verdad del consumo   Fase 2 · trazabilidad   Fase 3 · amarre   Fase 4 · taxonomías
    │                              │                      │                 │
 T1 fuente física              T5 migración lote      T8 OS en 3 vías   T10 motivos merma
 T2 restar merma               T6 emitir lote hijo    T9 cotiz. OC      T11 abcClass
 T3 semáforos                  T7 recall por lote                       T12 topes caja chica
 T4 brecha food cost                                                    T13 retención en ficha
    │                                                                        │
    └────────────────────────────┬───────────────────────────────────────────┘
                                 ▼
                        Fase 5 · módulos nuevos
              T14-16 contratos · T17-18 corrida · T19-21 prep list · T22 provisiones
```

Las fases 1–4 son independientes entre sí una vez hecha Task 0: se pueden paralelizar.
Dentro de cada fase el orden es estricto.

---

## Phase 0: Desbloqueo de migraciones

### Task 0: Reparar el journal de migraciones

**Description:** Registrar como aplicadas las 13 migraciones cuyos objetos ya existen en la
base pero que no tienen fila en `drizzle.__drizzle_migrations`. Sin esto ninguna migración
nueva de este plan se puede aplicar. `scripts/repair-migration-journal.ts` ya hace exactamente
esto; solo tiene la lista vieja (0012–0020) en `TAGS_TO_MARK`.

**Acceptance criteria:**
- [ ] `TAGS_TO_MARK` contiene los 13 tags y el script documenta por qué (aplicadas a mano)
- [ ] El script es idempotente: correrlo dos veces no duplica filas
- [ ] Antes de insertar, verifica que el objeto principal de cada migración exista; si falta, aborta sin escribir

**Verification:**
- [ ] `npx tsx scripts/check-migration-drift.ts` sin cambios respecto a hoy
- [ ] `npx tsx scratch/drift-journal-check.ts` reporta 0 sin constancia
- [ ] `pnpm db:migrate` corre y no aplica nada (no-op limpio)

**Dependencies:** Ninguna. **Requiere OK humano explícito** — escribe en la base compartida.
**Files:** `scripts/repair-migration-journal.ts`
**Scope:** S

**Checkpoint Fase 0:** `pnpm db:migrate` es no-op. A partir de aquí las migraciones fluyen.

---

## Phase 1: La verdad del consumo

### Task 1: Consumo real desde el conteo físico

**Description:** Cambiar la fuente de `actualQty` en el variance report: hoy suma todos los
movimientos negativos, que incluyen la propia explosión de receta que genera el teórico
(ver hallazgo 2). Pasar a `InventoryReportsService.getUsageReport` — inicial + compras − final
sobre el periodo — que es la fórmula del §9.2 y la única independiente del teórico.

**Acceptance criteria:**
- [ ] `actualQty` proviene del conteo físico del periodo, no de `inventory_movements`
- [ ] Cuando el periodo no tiene conteo inicial o final, la fila devuelve `null` y una nota accionable — nunca 0, que se leería como "no consumimos"
- [ ] El teórico sigue saliendo de `sales_entries` × BOM, sin cambios
- [ ] `accumulateTheoretical` deja de ser N+1: las recetas y los ingredientes se cargan en lote

**Verification:**
- [ ] Test unitario con conteo inicial/final y ventas conocidas: la varianza da el número esperado a mano
- [ ] Test del caso sin conteo: devuelve `null`, no 0
- [ ] `pnpm run build`

**Dependencies:** Task 0
**Files:** `lib/services/reports-service.ts`, `lib/services/reports-service.test.ts`, `lib/services/inventory-reports-service.ts` (solo si hay que exponer el desglose)
**Scope:** M

### Task 2: Restar la merma y excluir transferencias

**Description:** Aplicar la fórmula completa `varianza = teórico − real − merma registrada`.
Hoy la merma llega al real como movimiento `WASTE` y aparece como si fuera varianza, y una
transferencia saliente infla el consumo de la sucursal que envía.

**Acceptance criteria:**
- [ ] La merma con causa se resta y se muestra como columna propia, no disuelta en la varianza
- [ ] `STAFF` y `COURTESY` se excluyen de la merma (consumo, no pérdida — misma convención que `WasteReport.trueWasteLossCents`)
- [ ] Las salidas por `TRANSFER` no cuentan como consumo de la sucursal origen
- [ ] La varianza en dinero se recalcula sobre la fórmula nueva

**Verification:**
- [ ] Test: una merma registrada de 5 kg deja la varianza en 0, no en +5
- [ ] Test: una transferencia saliente de 10 kg no mueve la varianza
- [ ] `pnpm run build`

**Dependencies:** Task 1
**Files:** `lib/services/reports-service.ts`, `lib/services/reports-service.test.ts`
**Scope:** S

### Task 3: Semáforos del §9.2 y retiro del homónimo muerto

**Description:** Pintar los tres tramos que el manual define (<1.5% correcto, 1.5–3% revisar,
>3% investigación inmediata) en el tipo de retorno y en la pantalla, siguiendo el patrón de
`SemaphoreStatus` que ya usan los KPIs de control. Aparte, borrar
`CostingService.getVarianceReport` (`costing-service.ts:150-205`): devuelve `variance: 0` fijo,
compara un valor consigo mismo y escribe en `recipes` en un bucle N+1 dentro de lo que aparenta
ser una lectura. No tiene llamadores.

**Acceptance criteria:**
- [ ] `VarianceReportRow` expone `status: SemaphoreStatus | null` con los umbrales del §9.2
- [ ] La pantalla muestra el semáforo y ordena por impacto en dinero (ya lo hace el servicio)
- [ ] `CostingService.getVarianceReport` eliminado; `grep` no encuentra llamadores
- [ ] El comentario de `food-cost-service.ts:22` que lo referencia queda actualizado

**Verification:**
- [ ] `npx tsc --noEmit` limpio tras el borrado
- [ ] `pnpm run build`
- [ ] Recorrido manual: la pantalla de reportes pinta los tres colores con datos sembrados

**Dependencies:** Task 2
**Files:** `lib/services/reports-service.ts`, `lib/services/costing-service.ts`, `lib/services/food-cost-service.ts`, `app/dashboard/inventory/reports/page.tsx`
**Scope:** M

### Task 4: Brecha food cost real vs teórico en el reporte de control

**Description:** `control-kpi-service.ts` ya deja el hueco preparado: devuelve un `KpiMetric`
con `source: "NO_DATA"` y una nota que explica que falta el teórico. Conectarlo al cálculo real
ahora que existe, y encender el semáforo de brecha < 2 puntos del §17 / §12.

**Acceptance criteria:**
- [ ] `theoretical` deja de ser `NO_DATA` cuando hay ventas por platillo en el mes
- [ ] `gapPoints` usa `computeFoodCostGap` (ya existe) y enciende el semáforo a >2 puntos
- [ ] Sin ventas por platillo, la nota actual se conserva intacta — no se inventa un 0%

**Verification:**
- [ ] Test unitario de `control-kpi-types` para el semáforo de brecha
- [ ] Recorrido manual en `app/dashboard/reports/control` con y sin ventas sembradas
- [ ] `pnpm run build`

**Dependencies:** Task 2
**Files:** `lib/services/control-kpi-service.ts`, `lib/services/control-kpi-types.ts`, `lib/services/control-kpi-types.test.ts`, `app/dashboard/reports/control/page.tsx`
**Scope:** M

**Checkpoint Fase 1:**
- [ ] Con ventas sembradas, el variance report da un número verificable a mano
- [ ] Una merma registrada baja la varianza en vez de subirla
- [ ] `pnpm run build && pnpm run lint` verdes
- [ ] **Revisión humana antes de seguir** — es el cálculo del que cuelga el control de costos

---

## Phase 2: Trazabilidad y recall

### Task 5: Migración del lote de producción

**Description:** Agregar a `inventory_batches` lo que necesita un lote nacido de producción:
referencia a los lotes consumidos y marca de origen. Migración aditiva, sin drops.

**Acceptance criteria:**
- [ ] `parent_batch_ids` (uuid[] o tabla puente) y `origin` ('RECEIVING' | 'PRODUCTION' | 'TRANSFER') agregados como nullable
- [ ] Los lotes existentes quedan válidos sin backfill
- [ ] Migración generada con `pnpm db:generate`, revisada a mano, sin ningún DROP

**Verification:**
- [ ] `pnpm db:migrate` aplica limpio
- [ ] `npx tsx scratch/drift-objects.ts` confirma columnas presentes

**Dependencies:** Task 0
**Files:** `lib/db/schema.ts`, `drizzle/00XX_*.sql`
**Scope:** S

### Task 6: Emitir el lote hijo al registrar producción

**Description:** Resolver el `TODO` de `production-service.ts:181`. Al registrar producción,
crear el lote del producto terminado con caducidad calculada desde la vida útil del ítem y
referencia a los lotes consumidos. Es la pieza que rompe la cadena del §5.5 y la que hace
posible el modelo de cocina central del §11.

**Acceptance criteria:**
- [ ] Cada producción registrada crea exactamente un `inventory_batches` del producto, dentro de la misma transacción que descuenta los insumos
- [ ] La caducidad sale de `typicalShelfLifeDays` del ítem producido; sin ese dato, el lote se crea sin caducidad y se registra la razón
- [ ] `parent_batch_ids` guarda los lotes realmente consumidos (los que devolvió FEFO)
- [ ] Idempotente: reprocesar la misma instancia de workflow no crea un segundo lote (el único de `production_results` ya corta)

**Verification:**
- [ ] Test de integración: producir una sub-receta deja el lote hijo con los padres correctos
- [ ] Test de idempotencia: dos ejecuciones del extractor → un solo lote
- [ ] `pnpm exec playwright test --no-deps --project=chromium tests/extractor-idempotente.spec.ts`

**Dependencies:** Task 5
**Files:** `lib/services/production-service.ts`, `lib/services/production-from-workflow.ts`, `lib/services/production-service.test.ts`
**Scope:** M

### Task 7: Consulta de recall por lote

**Description:** La pregunta del §5.5 en una pantalla: dado un lote de proveedor, qué
sub-recetas lo heredaron, a qué sucursales viajó y en qué productos terminó. Recorre hacia
abajo `parent_batch_ids` y los movimientos de transferencia.

**Acceptance criteria:**
- [ ] Búsqueda por número de lote o por SKU + proveedor devuelve el árbol completo de descendientes
- [ ] El resultado incluye sucursales alcanzadas y lotes hijos con su estado (disponible, consumido, mermado)
- [ ] Alcance por empresa siempre desde la sesión; `GERENTE`/`SUPERVISOR` ven solo su sucursal vía `enforceBranchScope`
- [ ] La consulta responde en menos de 2 s sobre el dataset sembrado

**Verification:**
- [ ] Test: lote de proveedor → producción → transferencia a otra sucursal aparece completo
- [ ] Test RBAC: un `GERENTE` de otra sucursal no ve el rastro ajeno
- [ ] Recorrido manual desde la pantalla

**Dependencies:** Task 6
**Files:** `lib/services/traceability-service.ts` (nuevo), `app/api/inventory/traceability/route.ts` (nuevo), `app/dashboard/inventory/traceability/page.tsx` (nuevo)
**Scope:** M

**Checkpoint Fase 2:**
- [ ] Recorrido completo proveedor → lote → sub-receta → sucursal → producto, verificado a mano
- [ ] `pnpm run build && pnpm run lint` verdes

---

## Phase 3: Amarre documental

### Task 8: Órdenes de servicio dentro de la conciliación 3 vías

**Description:** Un CFDI de mantenimiento hoy entra a pagos sin amarre documental. Agregar
`service_order_id` a `invoices` y extender el conciliador para que, cuando exista, la tercera
vía sea la conformidad firmada más la evidencia de la OS, en lugar de la nota de recepción.

**Acceptance criteria:**
- [ ] `invoices.service_order_id` nullable, con FK y migración aditiva
- [ ] Una factura con OS solo llega a conciliada si la OS está en conformidad y tiene evidencia
- [ ] Se valida que OC y OS sean mutuamente excluyentes en la misma factura
- [ ] La discrepancia de monto contra el total de la OS levanta la misma bandera que ya existe para precio

**Verification:**
- [ ] Test: OS sin conformidad → factura no concilia, con motivo accionable
- [ ] Test: OS cerrada con evidencia → concilia
- [ ] `pnpm run build`

**Dependencies:** Task 0
**Files:** `lib/db/schema.ts`, `drizzle/00XX_*.sql`, `lib/services/invoice-matching-service.ts`, test correspondiente
**Scope:** M

### Task 9: Cotizaciones en órdenes de compra

**Description:** `approval_matrix_rules.minQuotes` ya se lee para OC y OS, y
`service-order-service.ts:430-439` lo hace cumplir; compras no puede porque no tiene dónde
guardar cotizaciones. Replicar el patrón de `service_order_quotes` cierra el §4.3 sin tocar la
matriz.

**Acceptance criteria:**
- [ ] Tabla `purchase_order_quotes` con la misma forma que `service_order_quotes` (proveedor, monto, archivo, notas)
- [ ] El submit de OC rechaza con 400 accionable si hay menos cotizaciones que el `minQuotes` de su tramo
- [ ] Subida de archivo a R2 reutilizando el flujo de OS, sin código nuevo de storage

**Verification:**
- [ ] Test: OC por encima del umbral con 1 cotización → 400 con el conteo requerido y el actual
- [ ] Test: con las cotizaciones necesarias → 200 y folio emitido
- [ ] `pnpm run build`

**Dependencies:** Task 0
**Files:** `lib/db/schema.ts`, `drizzle/00XX_*.sql`, `lib/services/purchase-order-service.ts`, `app/api/inventory/purchase-orders/*`, UI de OC
**Scope:** M

**Checkpoint Fase 3:**
- [ ] Ninguna factura de servicio concilia sin conformidad
- [ ] Ninguna OC sobre umbral se aprueba sin sus cotizaciones
- [ ] `pnpm run build && pnpm run lint` verdes

---

## Phase 4: Taxonomías y política operativa

### Task 10: Motivos de merma faltantes

**Description:** De los cinco tipos del §8.1, "retención vencida" y "falla de cadena de frío"
no tienen motivo propio y caen en `OTHER`/`QUALITY`, así que las metas por categoría del §8.3
no se pueden medir ni atribuir.

**Acceptance criteria:**
- [ ] `inventory_waste_reason` incluye `RETENTION_EXPIRED` y `COLD_CHAIN_FAILURE`
- [ ] Las etiquetas en español salen de `lib/inventory/waste-labels.ts`, no hardcodeadas en la UI
- [ ] El reporte de merma por motivo agrupa los nuevos valores
- [ ] Las filas históricas no se tocan

**Verification:** test de etiquetas + recorrido manual del formulario de merma · `pnpm run build`
**Dependencies:** Task 0 · **Files:** `lib/db/schema.ts`, migración, `lib/inventory/waste-labels.ts`, UI de merma · **Scope:** S

### Task 11: Clasificación ABC aditiva

**Description:** Hoy la clasificación es un booleano `isHighValue`, que separa la A pero no
distingue B de C — y de esa distinción dependen las frecuencias de conteo del §9.1. Se agrega
`abcClass` como columna nueva; `isHighValue` se conserva derivado (AD-4) porque tiene
consumidores vivos.

**Acceptance criteria:**
- [ ] `inventory_items.abc_class` enum ('A','B','C') nullable
- [ ] Backfill: los `isHighValue = true` quedan en 'A'; el resto sin clasificar (null), no en 'C' por default
- [ ] Los consumidores actuales de `isHighValue` siguen funcionando sin cambios
- [ ] El filtro de conteo acepta clase además del booleano

**Verification:** test del backfill · `pnpm run build` · conteo dirigido sigue verde
**Dependencies:** Task 0 · **Files:** `lib/db/schema.ts`, migración, `lib/services/stock-count-service.ts`, UI de catálogo · **Scope:** S

### Task 12: Topes de caja chica

**Description:** Las dos reglas del §7.2 viven hoy en el documento y no en el código: máximo
por vale y tope mensual por sucursal, que son las que fuerzan el paso a OC/OS formal.

**Acceptance criteria:**
- [ ] `petty_cash_funds.max_voucher_amount` y `monthly_cap_amount` en centavos, nullable
- [ ] `registerOutflow` rechaza con mensaje accionable al superar el tope por vale
- [ ] El acumulado del mes se calcula sobre salidas, no sobre reposiciones, y rechaza al superar el tope mensual
- [ ] Fondos sin tope configurado se comportan como hoy

**Verification:** tests de los tres casos (bajo tope, sobre tope por vale, sobre tope mensual) · `pnpm run build`
**Dependencies:** Task 0 · **Files:** `lib/db/schema.ts`, migración, `lib/services/petty-cash-service.ts`, tests, UI de caja chica · **Scope:** S

### Task 13: Tiempo de retención en la ficha técnica

**Description:** `recipes` no tiene tiempo de retención en línea, que es el dato del que
depende la merma por retención del §8.1 y los pars por franja del §6.3. Se agrega junto con
los otros campos de ficha que faltan.

**Acceptance criteria:**
- [ ] `hold_time_minutes`, `prep_time_minutes` y `photo_url` en `recipes`, nullable
- [ ] El editor de recetas los captura y los muestra
- [ ] Sin el dato, nada se rompe: las recetas existentes siguen válidas

**Verification:** recorrido manual del editor · `pnpm run build`
**Dependencies:** Task 0 · **Files:** `lib/db/schema.ts`, migración, `lib/services/recipe-service.ts`, UI de recetas · **Scope:** S

**Checkpoint Fase 4:** `pnpm run build && pnpm run lint` verdes · recorrido manual de merma, catálogo, caja chica y recetas

---

## Phase 5: Módulos nuevos

Tareas de mayor tamaño. Cada una se desglosa en su propio plan al arrancarla; aquí queda el
alcance y la frontera.

### Task 14–16: Contratos recurrentes y domiciliados (§6)
- **T14** Tabla `supplier_contracts`: contraparte (`supplierId`/`payeeId`), centro de costo,
  partida, vigencia, escalación INPC, monto mensual esperado, día de cargo, método (domiciliado
  / corrida / transferencia). Migración aditiva. **S**
- **T15** Servicio + API: alta, vigencia, conciliación factura-vs-contrato con umbral de
  investigación del 10%, alerta de renovación a 90 días vía `NotificationDispatcher`. **M**
- **T16** UI: lista con badges de vigencia, calendario de cargos, conciliación mensual del
  domiciliado (cargo esperado vs real) y detección de suscripciones huérfanas. **M**

### Task 17–18: Corrida de pagos (§10)
- **T17** Tabla `payment_runs` + renglones que apuntan a facturas, gastos y corridas de nómina;
  fecha, cuenta origen, estado, autorizador. Reutiliza `payment_approvals` para la doble firma. **M**
- **T18** UI de tesorería: el programa semanal de egresos como una sola pantalla, con el KPI de
  cumplimiento de corrida. **M**

### Task 19–21: Prep list generada y pars por franja (§6.2, §6.3)
- **T19** Campos de plan en `production_orders`: estación, turno, hora límite, lote FEFO
  sugerido. **S**
- **T20** Servicio que explota el forecast contra las fichas, resta lo preparado con vida útil
  vigente y emite la prep list por estación. Depende de Task 13. **M**
- **T21** Tabla `shift_pars` (producto × franja × sucursal) y comparativo contra lo producido. **M**

### Task 22: Provisiones de nómina (§9.3)
Cálculo mensual de aguinaldo proporcional, prima vacacional, PTU y finiquitos estimados, y su
reflejo en `pnl_snapshots` como costo devengado y no solo como desembolso. Hoy el P&L
subestima nómina entre 35 y 40 por ciento. **M**

**Checkpoint Complete:**
- [ ] `pnpm run build && pnpm run lint` verdes
- [ ] Suite e2e con el dev server de Inngest arriba
- [ ] Recorrido manual end-to-end de los dos manuales

---

## Risks and Mitigations

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Reparar el journal se hace sobre la base compartida | Alto | Verificar objeto por objeto antes de insertar; abortar si algo falta; OK humano explícito antes de correr |
| El descuento automático por venta y el conteo físico compiten por la misma verdad (ver Open Question 3) | Alto | Resolver la pregunta ANTES de Task 1: si el descuento se queda, el real debe venir del conteo o la varianza siempre dará ~merma |
| `sales_entries` sigue vacío y la Fase 1 se verifica contra la nada | Alto | Sembrar un mes de ventas por platillo antes de Task 1; la vía CSV ya existe y no requiere desarrollo |
| El lote hijo cambia el costeo de producto terminado | Medio | Task 6 no toca costeo: el lote hereda el costo ya calculado por `recordProduction` |
| Añadir valores a un enum de Postgres no es reversible en la misma transacción | Bajo | Migración propia, sin nada más dentro; documentar el rollback |
| `TheoreticalConsumptionService` crea lotes `DUMMY-NEG` cuando no hay stock | Medio | Fuera del alcance de este plan, pero anotado: ensucia el inventario y el recall de Task 7 los va a encontrar |

## Open Questions

1. **¿Por qué vía se opera la venta por platillo?** La de CSV con mapeo ya existe con UI
   (`app/dashboard/sales/mapping`). ¿Se programa esa como operación diaria, se conecta el POS,
   o se captura al cierre de turno? Bloquea la verificación de toda la Fase 1, no su código.
2. **¿Se corre la reparación del journal contra la base de desarrollo compartida?** Es escritura
   en `drizzle.__drizzle_migrations`; necesita OK explícito.
3. **¿`TheoreticalConsumptionService.consume` debe seguir descontando inventario?** Si el
   consumo real ha de salir del conteo físico (AD-1), el descuento automático por venta y el
   conteo compiten por la misma verdad: el inventario "real" ya viene rebajado por la receta.
   Las opciones son (a) conservar el descuento y tomar el real siempre del conteo, (b) dejar el
   descuento solo como proyección informativa sin escribir movimientos, o (c) marcar esos
   movimientos con un tipo propio para poder excluirlos. **Esta decisión define Task 1.**
