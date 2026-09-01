# Implementation Plan: Finance Module — Gap Closure

> **Revisión 2 (2026-08-31).** La versión 1 de este plan se escribió contra el diseño, no contra
> el código. Una auditoría posterior encontró que **la Fase 2 completa ya estaba implementada**,
> que dos fases apoyaban su diseño en datos que no existen, y que el gap más caro estaba
> clasificado como el menos urgente. Este documento es la versión corregida; las premisas que
> resultaron falsas quedan anotadas al final para no volver a proponerlas.

## Overview

Auditando el módulo de finanzas contra el código real (no contra el diseño), los submódulos
existentes son de verdad y están terminados: P&L con procedencia por renglón, snapshots
congelables, arqueo de caja con ledger de eventos, presupuestos con topes de emergencia,
tesorería con lotes de pago, costeo recursivo de recetas. Lo que queda son cinco huecos reales,
más pequeños que lo que decía la versión 1 de este plan.

Los gaps se ordenan por daño operativo, no por número de fase:

1. **Bloqueo funcional (P0)** — ninguna cuenta bancaria de proveedor puede llegar a `VERIFIED`,
   y tesorería exige `VERIFIED` para pagar. En una instalación real no se puede pagar a nadie.
2. **Gaps limpios** — dashboard de costo laboral, patrón de faltantes, presupuesto en gastos.
3. **Gaps bloqueados por una decisión de datos** — comisiones/TPV y cierre de período. No se
   pueden empezar hasta resolver de dónde sale el dato de origen (§ Decisiones pendientes).

Fuera de alcance de este plan (tienen tracker propio): autorizaciones de gastos, lote y recall
de producción, provisiones laborales, bugs del `LaborCalculator`, segregación de funciones,
empaquetado por tier. Ver § Overlap.

## Estado verificado del módulo

Lo que **ya existe** y no hay que construir — verificado archivo por archivo:

| Capacidad | Dónde vive | Nota |
|---|---|---|
| P&L con procedencia por renglón | `lib/services/pnl-types.ts:65`, `pnl-service.ts` | `MEASURED` / `CONTRACT_ONLY` / `SECTOR_DEFAULT` / `NO_DATA` |
| Congelado de P&L por período | `lib/services/pnl-snapshot-service.ts:35` | `freezePnLPeriod`, idempotente, conserva `source` |
| Sub-recetas en el esquema | `lib/db/schema.ts:2750` (`recipe_items.is_sub_recipe`) | `item_id` apunta a `recipes` cuando el flag está activo |
| Costeo recursivo de sub-recetas | `lib/services/costing-service.ts:99` | Con yield por línea y método de costeo por sucursal |
| Detección de ciclos en recetas | `lib/services/recipe-service.ts:109` (`wouldCreateCycle`) | DFS sobre el grafo del tenant, se corre antes de persistir |
| Simulación de cambio de precio | `lib/services/recipe-service.ts` (`simulateIngredientCostChange`) | Devuelve las recetas afectadas con food cost antes/después |
| Alerta de alza de costo de insumo | `lib/services/stock-alert-service.ts:316`, llamada desde `receiving-service.ts:249` | Umbral fijo en 10% |
| Presupuestos con topes de emergencia | `lib/services/budget-service.ts` | Cableado a OC, OS y approval-requests — **no a gastos** |
| Arqueo de caja + ledger de eventos | `lib/services/cash-variance-alert-service.ts:74` | Emite `CashVarianceDetected` por cada varianza |
| Costo laboral por sucursal | `lib/services/labor-cost-service.ts:247` | Con `source` tags; deliberadamente NO usa `LaborCalculator` |
| Targets de costo laboral | `app/api/company/operating-config/route.ts:108` | `laborCostTargetPercent`, `laborCostWarnPercent` |
| Bloqueo de pago sin CLABE verificada | `lib/services/treasury-service.ts:123` | Exige `status = VERIFIED` y `active` |
| Columnas de verificación de CLABE | `lib/db/schema.ts:884-889` | `verified_at/by`, `verification_method`, `verification_evidence_url` |

## Architecture Decisions

- **CLABE: solo falta el eslabón de escritura.** El esquema ya trae las columnas de verificación
  y el comentario que las acompaña dice explícitamente "el paso 3 llena esto; aquí solo vive".
  La ruta `[id]/reject` existe y sirve de molde exacto. F1 no necesita migración.
- **Segregación en la verificación:** `registered_by` existe con el comentario "el verificador
  tiene que ser alguien distinto". La regla se hace cumplir en el servicio, no en la UI.
- **Presupuesto en gastos: mapear, no duplicar.** `branch_budgets` se llavea por `cost_center_id`
  y `operating_expenses` solo tiene `category`. Se agrega `cost_center_id` nullable a
  `operating_expenses` en vez de inventar un segundo modelo de presupuesto por categoría. Un gasto
  sin centro de costo simplemente no consume presupuesto — no se adivina el mapeo.
- **Patrón de faltantes: leer el ledger, no re-derivar.** `CashVarianceDetected` ya guarda cada
  varianza con monto, dirección y turno. La detección consulta eventos de dominio.
- **Atribución del faltante por turno, no por persona.** `daily_sales_cuts` es por
  sucursal/fecha/turno y su único campo de usuario es `received_by` (quien subió el corte, no
  quien manejó la caja). El patrón se reporta por sucursal+turno. Atribuirlo a una persona
  requiere un campo de cajero que hoy no existe y que este plan no agrega.
- **Cierre financiero en tabla propia, no en `inventory_periods`.** `inventory_periods` es por
  sucursal, lo crea automáticamente `inventory-service.ts:238` al iniciar conteos y sus fechas
  las manda el ciclo de inventario. Sobrecargarlo acopla dos cierres con dueños y calendarios
  distintos. Va `financial_periods`, por company, mensual.
- **Comisiones: tarifa versionada, no derivación.** Ver § Decisiones pendientes — la derivación
  desde liquidación no es posible con los datos actuales.

## Fases

Las fases 1–3 son independientes entre sí y se pueden hacer en paralelo. Las fases 4 y 5 están
**bloqueadas** hasta cerrar su decisión de datos correspondiente.

### Fase 1 — Verificación de titularidad de CLABE (P0, desbloquea tesorería) — ✅ IMPLEMENTADA

Commits `017b1b9` y `0192cb2` en `feat/finance-clabe-verification`.

- [x] **F1.1** `verifySupplierBankAccount` en el servicio + ruta `[id]/verify`
- [x] **F1.2** Diálogo de verificación con carga de CEP en la UI de proveedores
- [x] **F1.3** Prueba end-to-end del desbloqueo: cuenta verificada → factura visible en tesorería

#### Checkpoint: se puede pagar
- [x] Una cuenta capturada hoy puede llegar a `VERIFIED` sin tocar la base a mano
- [x] Quien capturó no puede verificar su propia captura
- [x] Factura de proveedor con CLABE verificada aparece en el lote de pago
- [~] `pnpm run build` limpio — confirmación final en curso. Dos fallos intermedios fueron
      `.next` corrupto por un `next dev` de Playwright escribiendo mientras el build tipaba,
      no código de esta fase (ver el checkpoint del todo)

**Tres cosas que el plan no había previsto y sí hubo que resolver:**

1. **Verificar desplaza.** El índice único parcial `supplier_bank_accounts_one_verified_active`
   no admite dos cuentas verificadas activas por proveedor, así que la verificación da de baja
   a la vigente **en la misma transacción**. Sin esto, la primera verificación de un *cambio* de
   CLABE —el caso que la regla 4 del servicio considera EL evento de fraude— moría con un error
   de constraint. La baja es lógica y conserva `VERIFIED`: la cuenta anterior era legítima y su
   historial de pagos tiene que seguir explicándose.
2. **La evidencia se guarda como llave, no como URL.** `generatePresignedUrl` expira en una
   hora; el CEP tiene que seguir ahí cuando alguien audite el pago meses después. En
   `verification_evidence_url` va la llave durable de R2 (o el `local://` del fallback de dev).
   El resto del repo guarda la presignada en sus columnas `evidence_url` — aquí no, a propósito.
3. **El nombre del CEP vive en `notes`.** No hay columna para él y la fase decidió no migrar, así
   que la verificación agrega un renglón a la nota con el titular leído y el declarado. Es lo que
   permite reconstruir después por qué alguien dio la titularidad por buena. Si esto se vuelve
   consultable, ahí sí hace falta columna.

**Un criterio del plan resultó falso contra el código.** F1.3 pedía que
`getUnpaidMatchedInvoices` dejara de devolver la factura de un proveedor sin CLABE verificada.
No lo hace —filtra por `match_status` y `payment_status`— y no debería: esconderle al tesorero
una factura legítima le quita el aviso que lo manda a verificar la cuenta. El bloqueo vive donde
siempre vivió, en el camino de escritura de tesorería, y ahí es donde el spec lo afirma.

### Fase 2 — Dashboard de costo laboral

- [ ] **F2.1** `GET /api/finance/labor-cost` sobre `getLaborCostByBranch`
- [ ] **F2.2** Página `/dashboard/finance/labor-cost` con semáforo contra el target del tenant

#### Checkpoint: labor visible
- [ ] Ratio costo laboral/venta por sucursal, con procedencia etiquetada
- [ ] Sucursal sin datos muestra `NO_DATA`, no un cero engañoso

### Fase 3 — Presupuesto en gastos y patrón de faltantes

- [ ] **F3.1** `cost_center_id` en `operating_expenses` + captura en el formulario
- [ ] **F3.2** Consumo de presupuesto al crear gasto: aviso al 80%, marca al 100%
- [ ] **F3.3** Barra de consumo por centro de costo en el dashboard de gastos
- [ ] **F3.4** Detección de faltantes recurrentes por sucursal+turno sobre el ledger

#### Checkpoint: gastos con política
- [ ] Gasto con centro de costo consume presupuesto y avisa al 80%
- [ ] Sin `branch_budgets` configurados el sistema no inventa presupuestos ni alerta
- [ ] Faltantes recurrentes visibles como hallazgo, sin duplicar el hallazgo abierto

### Fase 4 — Comisiones por canal y conciliación TPV *(bloqueada: decisión D1)*

- [ ] **F4.1** Migración: `commission_cents`, `tpv_deposit_cents` en `daily_sales_cuts`
- [ ] **F4.2** Origen del dato de comisión según lo que se decida en D1
- [ ] **F4.3** Conciliación TPV: varianza tarjeta vs depósito de terminal
- [ ] **F4.4** Renglón de comisiones en el P&L + columna en `pnl_snapshots`

#### Checkpoint: ingresos completos
- [ ] Comisiones como renglón explícito del P&L, con desglose por canal
- [ ] Varianza TPV separada de la varianza de efectivo en el banner de diferencias
- [ ] El dueño puede responder "¿me conviene Rappi?" con margen por canal

### Fase 5 — Cierre de período financiero *(bloqueada: decisión D2)*

- [ ] **F5.1** `business_date` en `operating_expenses` *(es PL1 de `plan-pnl-real.md`)*
- [ ] **F5.2** Tabla `financial_periods` + servicio de cierre
- [ ] **F5.3** Rechazo de escrituras en período cerrado (gastos, cortes, recepciones)
- [ ] **F5.4** UI de cierre con resumen previo y confirmación escrita

#### Checkpoint: período cerrado
- [ ] Mes cerrado: gastos y cortes de ese mes rechazados por la API, no solo por la UI
- [ ] P&L del período congelado con su procedencia intacta

### Checkpoint: Complete
- [ ] `pnpm run build && pnpm run lint` limpios
- [ ] Cada fase con al menos un spec de Playwright
- [ ] Recorrido manual end-to-end

## Decisiones pendientes (bloquean fases 4 y 5)

**D1 — ¿De dónde sale el monto de la comisión?**
La versión 1 de este plan asumía derivarla de `daily_sales_cuts.aggregator_sales` restando neto
menos bruto. **Ese dato no existe:** `aggregator_sales` es `Record<string, number>`, un mapa
plano canal→centavos brutos (`app/api/sales/cuts/route.ts:68`,
`sales-ingestion-service.ts:483`). No hay monto neto en ninguna parte del sistema. Las opciones:

- **(a) Tarifa versionada por canal** — tabla o config `{ canal, tasaBps, vigenteDesde }`. La
  comisión se calcula, no se mide; el renglón del P&L se etiqueta `ESTIMATED`. Barato, y da
  el 80% del valor: el dueño ve el orden de magnitud de lo que le cuesta cada agregador.
- **(b) Cambiar la forma de `aggregator_sales` a `{ gross, net }` por canal** — la comisión se
  mide de verdad y el renglón es `MEASURED`, pero toca ingesta de POS, el smart link de corte de
  caja (`app/api/workflows/smart-links/corte-caja/route.ts:102`), la UI del corte y el desglose
  de `app/dashboard/sales/page.tsx:553`. Y depende de que el cliente suba la liquidación del
  agregador, que es un documento distinto del corte del POS.
- **(c) Captura manual de la liquidación** — pantalla aparte donde el administrativo captura lo
  que efectivamente depositó cada agregador. Más trabajo humano recurrente, dato real.

Recomendación: **(a) ahora, (c) después si el cliente lo pide**. (b) es el más caro y el que más
depende de que el cliente cambie su operación.

**D2 — ¿A qué se le llama "período cerrado"?**
`operating_expenses` no tiene fecha de negocio, solo `created_at`, `due_date` y `paid_at`
(`lib/db/schema.ts:3295`). Sin `business_date` no hay forma de decir a qué mes pertenece un
gasto, y por lo tanto no hay nada que congelar. F5.1 es exactamente PL1 de `plan-pnl-real.md`,
así que hay que decidir cuál de los dos trackers lo ejecuta antes de empezar la fase.

**D3 — ¿El umbral de alza de costo se vuelve configurable?**
`checkPriceIncrease` ya alerta, con 10% fijo. Volverlo configurable por tenant es una tarea de
media hora; agregarle la lista de platillos afectados es cablear `simulateIngredientCostChange`,
que ya devuelve exactamente eso. No está en ninguna fase porque no es un gap, es un pulido —
si se quiere, entra como apéndice de la Fase 3.

## Risks and Mitigations

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Ningún proveedor tiene CLABE verificable hoy | **Alto — bloquea pagos** | Fase 1 primero; validar contra datos de seed que el flujo completo corre |
| Verificador y capturista son la misma persona en grupos chicos | Medio | El servicio lo rechaza; el mensaje explica quién sí puede |
| `cost_center_id` nullable en gastos deja presupuestos con cobertura parcial | Medio | La barra de consumo muestra qué % del gasto del mes quedó sin clasificar |
| Comisión estimada por tarifa se lee como medida | Medio | Etiqueta `ESTIMATED` en el renglón, igual que el resto del P&L |
| El faltante recurrente señala una sucursal, no a una persona | Bajo | Se reporta como patrón de turno; la investigación la hace el gerente |
| Cerrar un período rompe ediciones legítimas en curso | Medio | Resumen previo obligatorio: qué queda pendiente antes de cerrar |

## Overlap con otros planes

| Gap | Tracker | Estado |
|---|---|---|
| UI de autorización de gastos (aprobación en lote) | `todo-gastos-autorizaciones.md` 3–13 | En progreso |
| Lote de producción + recall | `todo-cierre-brechas-qsr.md` 5–7 | Pendiente |
| Provisiones laborales (aguinaldo, PTU) | `todo-cierre-brechas-qsr.md` 22 | Pendiente |
| `LaborCalculator`: horas ordinarias, domingo, ventana semanal | `plan-pnl-real.md` PL4–PL5 | Pendiente — ver nota |
| `business_date` en gastos | `plan-pnl-real.md` PL1 | Pendiente — bloquea F5 |
| Segregación de funciones | `todo-fiscal-control-interno.md` T55 | Pendiente |
| Empaquetado por tier | `todo-fiscal-control-interno.md` T57 | Pendiente |

**Nota sobre `plan-pnl-real.md`:** ese plan referencia `tasks/todo-pnl-real.md`, que no existe,
y sus casillas siguen todas en `[ ]` aunque PL2 (procedencia en el P&L), PL14 y PL15 (snapshots)
ya están implementados. El tracker está desactualizado; conviene reconciliarlo antes de tomar
PL1 o PL4 como pendientes ciertos.

**Nota sobre `LaborCalculator`:** el bug es más grande de lo que dice PL4.
`calculateSessionOvertime` (`lib/services/labor-calculator.ts:277`) asigna el turno completo a
`diurnal`/`nocturnal` incluso cuando no hubo horas extra, y como
`regularMinutes = total − (diurnal + nocturnal + holiday)`, las horas ordinarias dan **siempre
cero**. En la rama con horas extra además hay doble conteo. El P&L está a salvo porque
`labor-cost-service` no lo consume (lo dice en su encabezado), pero `/api/reports/overtime` sí.
Cualquier alerta preventiva de horas extra tiene que esperar a PL4 — por eso no está en la
Fase 2 de este plan.

## Premisas descartadas (no volver a proponerlas)

De la versión 1 de este plan, verificadas como falsas contra el código:

- ~~"El P&L calcula una línea de Comisiones como fallback sector-default"~~ — `BranchPnL` no tiene
  renglón de comisiones. Sería nuevo, y también obliga a agregar columna en `pnl_snapshots`.
- ~~"`recipe_items` solo referencia insumos directos; agregar `recipe_id` + CHECK"~~ — las
  sub-recetas ya existen vía `is_sub_recipe`, con costeo recursivo, detección de ciclos y spec
  (`tests/subreceta-compartida.spec.ts`). Lo único que falta del criterio original es el límite
  de profundidad, que no ha causado problemas porque los ciclos ya se rechazan.
- ~~"Wire `branchBudgets` — el presupuesto no está conectado"~~ — sí lo está, a órdenes de compra,
  órdenes de servicio y approval-requests. Lo que falta es la conexión con gastos, y el obstáculo
  real es el choque `cost_center_id` vs `category`, que la versión 1 no vio.
- ~~"Extender `inventory_periods` para cerrar finanzas"~~ — es un período de inventario por
  sucursal, creado automáticamente. Mezclarlo con el cierre financiero acopla dos ciclos.
- ~~"F6.2: verificar que la validación de CLABE en tesorería funciona"~~ — funciona. El problema
  es el opuesto: funciona tan bien que sin F1 nadie puede pagar.
