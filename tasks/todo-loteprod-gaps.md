# Todo: Cierre de Gaps loteprod.md ↔ Módulo Inventario

Plan completo: `tasks/plan-loteprod-gaps.md`
Origen: investigación 2026-08-25 de `loteprod.md` contra `app/dashboard/inventory/`

## Pre-requisitos (completados)

- [x] Etiqueta FIFO→FEFO en `expirations/page.tsx`
- [x] `shipTransfer` asigna lotes vía `allocateFEFO`; falla sin stock; hereda lote primario
- [x] `unitConversions.factor` → `numeric(12,6)` (migración `0064_closed_shen.sql`) + seeds

## Phase 1: Quick wins de seguridad y control

- [x] **Task 1:** Validación de temperatura por tipo de almacenamiento en recepción
  (congelado ≤ -18°C, refrigerado 0–4°C; fuera de rango = QUARANTINED + incidente)
  — DONE: `receiving-temperature.ts` + test (14 casos), migración `0065_blushing_ronan.sql`
  (`inventory_items.storage_type`), cableada en `receiving-service.ts` (QUARANTINED + incidente
  automático), UI en `receiving-workflow.tsx` / `product-form.tsx`. Commits `fbcd8b1`, `8b9fbaf`.
- [x] **Task 2:** Alertas escalonadas caducidad: ≤48h gerente / ≤24h urgente / vencido =
  bloqueo FEFO + merma obligatoria (sin re-notificar)
  — DONE: nuevo `lib/services/expiration-alert-service.ts` (clasificador puro
  `classifyExpirationWindow` H48/H24/EXPIRED + `processExpirationCutoffs()` que marca lotes
  vencidos status=EXPIRED — quedan fuera del allocator FEFO que filtra AVAILABLE — y notifica
  una sola vez por (lote, ventana)); tabla `inventory_expiration_alerts` con único
  `(batch_id, window)` como idempotencia anti-spam del cron 6h (migración
  `0066_sudden_stepford_cuckoos.sql`, aplicada en dev); paso nuevo
  `process-expiration-cutoffs` en `cron-stock-check.ts`; `expiredWastePendingCount` en
  `/api/inventory/dashboard`; tarjeta condicional "Merma Obligatoria Pendiente" en
  `dashboard-kpis.tsx`; test con 10 casos (`__tests__/expiration-alert.test.ts`).
  Verificación: unit 360 passed · build OK · migración aplicada.
- [x] **Task 3:** Tope mensual + aprobación de mermas STAFF/COURTESY
  (`approvalStatus/approvedBy`; rechazada no descuenta inventario)
  — DONE: `inventory_waste` += `approval_status/approved_by/approved_at` +
  `companies.courtesy_waste_monthly_cap_cents` (migración **`0068_new_ben_grimm.sql`** generada por
  drizzle — la 0067 manual se eliminó porque duplicaba DDL sin snapshot y rompía el journal;
  aplicada y verificada en dev); lógica pura en `lib/inventory/waste-approval.ts` (12 tests) con
  `roleIsAtLeast` fail-closed; POST waste difiere descuento/movimiento para PENDING_APPROVAL; nuevo
  endpoint `POST /api/inventory/waste/[id]/approval` (GERENTE+ acotado a sucursal; sobre tope exige
  ADMIN+; aprobar descuenta lote FOR UPDATE en tx); criterio único de KPIs en
  `lib/inventory/waste-kpi.ts` (`wasteLossEligible`) aplicado en
  dashboard/executive/predictive/knowledge/reports + summary del historial; UI: columna Estado,
  aprobar/rechazar en detalle sheet (`useWasteApprovalAction`), toast "enviada a aprobación" en el
  form, tarjeta ADMIN+ para el tope en la página.
  Decisión open question #1: tope = monto fijo mensual por empresa.
  Verificación: tsc exit 0 · unit 372 passed · lint 0 errores · build OK · migrate exit 0 ·
  flujo E2E verificado vía API con sesiones de demo (COURTESY→PENDING sin baja ni movimiento;
  GERENTE aprueba→lote descontado + movement USAGE "Cortesía a Cliente"; KPI excluye cortesía de
  trueWaste pero la suma a totalLoss; EMPLEADO→403 FORBIDDEN_ROLE; GERENTE sobre tope→403
  CAP_EXCEEDED_ELEVATED_REQUIRED; ADMIN sobre tope→aprueba; REJECT→sin efecto en stock).
  Commits: `f5d42b7` (feat Task 3) · `fd8f7c2` (fix migración 0068). Handoff original:
  `handoffs/loteprod-task3-handover.md` (superado).

### Checkpoint Phase 1
- [x] tsc limpio* · build pasa · migraciones aplican en dev (*2 errores preexistentes de otro
  workstream en `app/dashboard/service-orders/`; los archivos tocados no reportan errores)
- [x] Flujos verificados manualmente — doble corrida de `processExpirationCutoffs()` contra la BD
  de dev con lotes sembrados en las ventanas H48 y H24 (las que dependen del único
  `(batch_id, window)`, porque el lote sigue AVAILABLE y el cron lo reencuentra): una sola fila
  por (lote, ventana), 2ª corrida con `notificationsSent = 0` y `alreadyNotified = 2`. También se
  observó la ruta de vencidos sobre datos reales de dev: 18 lotes → `markedExpired: 18` en la 1ª
  corrida y 0 en la 2ª (quedan EXPIRED y salen del candidato). Se verificó el servicio, no el
  wrapper de Inngest, que es una sola línea sobre él en `cron-stock-check.ts`.

## Phase 2: Núcleo de producción diaria

- [x] **Task 4:** Hold times — esquema y captura
  (`recipes.holdTimeMinutes`, `production_results.expires_at`, enum merma HOLD_TIME)
  — DONE: migración **`0069_freezing_mathemanic.sql`** (aplicada en dev) con los 3 valores de
  enum de Tasks 4 y 11 en un solo `ALTER TYPE` — el riesgo anotado en el plan no se materializó,
  drizzle-kit los aplica sin problema. `production-service.recordProduction` deriva `expires_at`
  de la receta usando `now()` del **servidor**, no el reloj del proceso: `production_date` usa el
  default `now()` y mezclar relojes en una máquina con huso local (Windows en CST) haría nacer el
  vencimiento corrido varias horas. Captura de minutos en la ficha técnica
  (`recipes/page.tsx` + validadores + POST/PUT). Verificación: receta con holdTime=30 →
  `expires_at − production_date = 30.0000 min` exacto; receta sin hold time produce con
  `expires_at` null (`tests/tmp-verify/hold-time-produccion.ts`).
- [x] **Task 5:** Hold times — ciclo de vencimiento en línea
  (cron, notificación a turno, merma idempotente A9, dashboard "por vencer")
  — DONE: migración **`0072_nosy_bloodstrike.sql`** (aplicada en dev): `production_results` +=
  `hold_alert_notified_at / discarded_at / discarded_quantity / discarded_by` + índice parcial
  `production_results_hold_pending_idx`; `inventory_waste` += `production_result_id` con **único
  parcial** (idempotencia A9 del descarte) y `item_id` pasa a **nullable** — la merma de retención
  es de producto TERMINADO, que no existe como `inventory_items` (la producción descuenta insumos
  y no crea lote de salida); exigir un insumo obligaba a inventar uno falso.
  Lógica pura en `lib/inventory/hold-time.ts` (26 tests): clasificación OK/EXPIRING/EXPIRED,
  gracia del cierre automático, prorrateo del costo (redondeo una sola vez, A7) y validación del
  descarte. Servicio `lib/services/hold-time-service.ts` con los tres caminos: (1) el cron avisa
  al turno —sesión `shift_sessions` ACTIVE, con caída a gerencia de la sucursal— una sola vez por
  tanda vía claim atómico `UPDATE ... WHERE hold_alert_notified_at IS NULL RETURNING`;
  (2) el turno confirma cuánto se tiró → merma `origin='hold_time'`, y **cantidad 0 es respuesta
  válida** ("venció en el sistema pero se vendió": cierra la tanda sin merma); (3) pasada la
  gracia de 180 min el cron la cierra completa con `origin='hold_time_auto'` (§7 21:00 exige que
  la merma quede registrada; sin esto la varianza del día se queda corta justo cuando la línea
  estuvo desatendida). La merma HOLD_TIME **no** toca lotes ni `inventory_movements`: es pérdida
  de costo, no movimiento de stock.
  Cron `cron-hold-times.ts` cada **15 min, no horario** — desviación deliberada del plan: los hold
  times del manual van de 7 a 30 min y con un cron horario el aviso llegaba hasta 59 min tarde,
  que es exactamente lo que §6.4 quiere evitar.
  API `GET/POST /api/inventory/production/hold-time` (tablero + confirmación, códigos estables en
  `details.code`); UI: pestaña "En línea" en producción (`hold-time-board.tsx`, refresco de 30 s,
  montada sólo con la pestaña abierta) y tarjeta "Producto en Línea" en el dashboard con los dos
  números que pide el plan (por vencer vs vencidos sin tirar).
  **Bug de reloj encontrado por la verificación** (y por qué el servicio se ve así): `db.execute`
  devuelve el timestamp como STRING y `new Date(str)` lo lee como hora local, mientras Drizzle lee
  la columna como UTC — 6 horas de desfase, con las que el cron daba por vencida hasta una tanda
  con 15 min por delante. El `now` se pide ahora como una columna más del mismo select,
  `sql`now()::timestamp`.mapWith(productionResults.expiresAt)`, así el marco coincide por
  construcción. `sql<Date>` no basta: es una promesa de TypeScript, no una conversión.
  Verificación: `tests/tmp-verify/hold-time-ciclo.ts` — 14 asserts en verde contra dev (aviso
  idempotente en 2ª corrida, cierre automático sin duplicar merma, prorrateo 10000¢/20 = 500¢/u,
  confirmación parcial 4 de 10 = 2000¢, cantidad 0 sin merma, ALREADY_DISCARDED / NOT_EXPIRED /
  OVER_QUANTITY / RESULT_NOT_FOUND cross-tenant) · tsc exit 0 · unit 419 passed · lint 0 errores.
- [ ] **Task 6:** Prep list por estación/turno/hora límite
  (columnas nuevas en `production_orders`, vista agrupada con checkbox, lote FEFO visible,
  completar dispara producción real) — dividir 6a datos / 6b UI si excede 5 archivos
- [ ] **Task 7:** Pars por franja horaria batch cooking
  (`recipe_par_slots`, sugeridor par − stock listo hoy, integración a panel de sugerencias) —
  dividir 7a datos / 7b UI

### Checkpoint Phase 2
- [ ] Flujo E2E: forecast → prep list → producir FEFO → hold time vence → merma HOLD_TIME →
  varianza del día
- [ ] Revisión con humano antes de Phase 3

## Phase 3: Gobernanza y control

- [ ] **Task 8:** Versionado de fichas técnicas
  (`recipe_versions` snapshot jsonb, archivado automático al editar, historial con costo)
- [ ] **Task 9:** Clasificación ABC + frecuencias de conteo
  (`abc_class` A/B/C, clasificador 80/15/5 por consumo 90d, cron mensual, filtros en conteo)
- [ ] **Task 10:** Auditoría sorpresa trimestral
  (cron trimestral → workflow por sucursal con muestra aleatoria ABC, evidencia foto,
  % cumplimiento a KPI corporativo)

### Checkpoint Phase 3
- [ ] 9/9 gaps originales cerrados y trazados a sección del manual
- [ ] Tests nuevos pasan · build limpio · migraciones en staging


## Phase 4: Segunda pasada del manual — brechas puntuales

> Auditoría 2026-08-26: comparación completa `loteprod.md` (16 secciones) ↔ plan. Los gaps que
> quedaban fuera se incorporaron al plan como Phases 4 y 5 (Tasks 11–20).

- [x] **Task 11:** Causas de merma faltantes `PREPARATION` + `CUSTOMER_RETURN` (§8.1)
  — DONE en la misma migración `0069` que el `HOLD_TIME` de Task 4. `inventory_waste` +=
  `recipe_id / processed_quantity / expected_quantity / yield_flagged`; lógica pura en
  `lib/inventory/waste-yield.ts` (11 tests): esperado = procesado × (1 − rendimiento), no marca si
  se rindió de más ni si el excedente es ruido de báscula (< 0.5 u), marca sobre 20% de
  desviación. El POST de mermas valida receta/insumo con código estable `PREPARATION_INVALID`.
  De paso se eliminaron DOS mapas duplicados de motivos (el del formulario, al que ya se le había
  caído COURTESY, y el del reporte operativo): ambos salen ahora de `waste-labels.ts`, así que los
  7 tipos del manual aparecen en captura, historial, detalle y reporte.
  Verificación por API con sesión de demo (`tests/tmp-verify/merma-preparacion-api.ts`):
  dentro de lo esperado → `expected 1.0000, flagged false`; desviada → `flagged true`;
  receta con motivo ajeno / sin cantidad procesada / insumo fuera de la receta → 400
  `PREPARATION_INVALID`. build OK · tsc limpio · 383 unit tests.
- [ ] **Task 12:** Metas de merma por categoría + investigación obligatoria (§8.4)
  (proteínas 2–4%, vegetales 5–8%, empaque 1–2%, abarrotes 0.5–1%; configurables por empresa)
- [ ] **Task 13:** Umbrales de varianza con semáforo (§9.3/§10)
  (<1.5% ok · 1.5–3% investigar · >3% investigar a fondo; tarea de investigación al rojo)
- [ ] **Task 14:** Par levels de insumos calculados por tipo de almacenamiento (§4)
  (uso diario × días de cobertura + seguridad; usa `storageType`/`typicalShelfLifeDays` de T1)
- [ ] **Task 15:** Etiqueta de producto preparado + código de colores por vida útil (§5.3)
  — parcial: el semáforo 🔴 hoy/vencido · 🟡 1–2 d ya está en `/dashboard/inventory/lotes`;
  falta la etiqueta imprimible (prep/caduca/lote origen/elaboró)
- [ ] **Task 16:** Ajustes manuales al forecast: clima/promoción/quincena/evento (§6.1)
  — confirmado: `ForecastService` solo expone `calculate`/`calculateAll`, sin overrides
- [ ] **Task 17:** KPIs faltantes del §12 + ranking corporativo (§15)
  (días de inventario perecederos · exactitud de forecast ±10% · cumplimiento de etiquetado)

### Checkpoint Phase 4
- [ ] build limpio · migraciones aplicadas · KPIs del §12 calculan sobre datos reales de dev
- [ ] Revisión con humano antes de Phase 5

## Phase 5: Cocina central y trazabilidad

> Solo aplica a tenants con `foodProduction = COCINA_CENTRAL | MIXTO`. **Decisión pendiente
> (open question 8):** si no hay cliente con este modelo, sacar la fase del plan activo y
> quedarse con Task 20 acotada a producción en sucursal.

- [ ] **Task 18:** Consolidación de demanda D-2 y plan de producción central (§11.2 pasos 1–2)
- [ ] **Task 19:** Lotes de producción central con herencia de lote origen + distribución y
  recepción contra orden de transferencia con temperatura (§11.2 pasos 3–5)
- [ ] **Task 20:** Trazabilidad y recall extremo a extremo (§5.5)
  — verificado: cero matches de recall/traceability en servicios y UI

### Checkpoint Complete (ampliado)
- [ ] 9 gaps originales + brechas de la segunda pasada cerrados y trazados al manual
- [ ] Tests nuevos pasan · build limpio · migraciones en staging
- [ ] Docs actualizadas (`PROJECT_CONTEXT.md`, `docs/admin-guide.md`)

## Fuera del plan pero cerrado sobre la marcha (§4 del manual)

Salieron de una revisión del usuario, no del informe original:

- [x] **Condiciones de pago a proveedor** — `suppliers.payment_terms_days` existía (0 = contado) y
  alimentaba el vencimiento de las facturas, pero NADIE podía capturarlo: el zod de la API no lo
  aceptaba y la UI no lo mostraba, así que todos los proveedores estaban en contado por default.
  `updateSupplierPaymentTerms()` llevaba escrita sin un solo llamador y **tronaba al ejecutarse**
  (`operator is not unique: date + unknown` — parámetro sin tipo entre `date + integer` y
  `date + interval`); va con `::integer`. Nueva forma de pago: enum propio
  `supplier_payment_method` alineado a c_FormaPago del SAT (no se reusó el `payment_method` de
  nómina, que tiene PAYROLL_CARD). Migración `0070`. Vocabulario en
  `lib/inventory/supplier-payment.ts`.
- [x] **Proveedor principal vs alterno por insumo** — `supplier_items.preference_rank`
  (1 = principal, 2+ = alternos, null = catálogo sin clasificar) con único parcial
  `(company_id, item_id) WHERE preference_rank = 1`: la regla vive en la BD, no en el servicio.
  `inventory_items.supplier_id` —lo que agrupa las OC del sugeridor— queda como ESPEJO del rango 1
  y se mueve en la misma transacción, para no tener dos respuestas a "¿a quién le compro esto?".
  Backfill en la migración `0071`: cada "proveedor preferido" ya capturado se volvió principal
  (30 insumos, 0 huérfanos) — sin eso el deploy habría dejado a todos sin principal y el sugeridor
  habría dejado de armar órdenes. Lógica de reordenamiento pura y probada
  (`lib/inventory/supplier-preference.ts`, 10 tests). UI: pestaña Proveedores en el detalle del
  insumo, con aviso explícito cuando no hay principal.

## Verificado que YA existe (no son gaps)

- §3.3 Rendimiento crudo→cocido: `yieldPercent` en recetas y líneas de receta
  (`schema.ts:370, 901, 2594`).
- §15 Temperatura de cámaras: tabla `temperature_logs` con equipo, umbrales min/max, foto e
  `isCompliant` (`schema.ts:981`) — T1 cubre recepción, esto cubre el monitoreo continuo.
- §7 Sugerencia de OC nocturna: `lib/services/suggested-order-service.ts`
  (reorden = consumo diario promedio × lead time + stock de seguridad).
- §4 Par mínimo/máximo: `inventoryItems.minLevel/maxLevel` (`schema.ts:868`) — existe el campo,
  falta el cálculo del manual (Task 14).
- §3.2 Sub-recetas con explosión en cascada · transfers documentados · alertas escalonadas
  (T2 done) · conteo ciego y frecuencias (T9) · POS auto-descuento vía fichas.

## Pendientes de verificar antes de abrir tarea

- **§5.2 Conciliación triple** recepción→pago (nota firmada habilita pago): probablemente ya
  cubierto por purchases/invoices.
- **§3.4 Explosión del POS a través de sub-recetas anidadas**: la investigación la dio por
  cubierta; confirmar el caso de anidamiento.

## Notas de ejecución

- Migrar SIEMPRE con `pnpm db:generate` + `pnpm db:migrate`. Jamás `db:push`.
- Descuentos/movimientos de stock solo vía `allocateFEFO()` en transacción.
- Cantidades: `numeric(12,4)` string en TS. Dinero: centavos integer.
- Idempotencia crons: patrón A9 (índice único parcial sobre `workflowInstanceId`).
- Notificaciones vía `NotificationDispatcher`, nunca Wasender directo.

## Open questions para resolver antes de la fase correspondiente

1. ~~Tope de cortesías: ¿monto fijo mensual o % de ventas?~~ ✅ Resuelta (Task 3): monto fijo mensual
   por empresa (`companies.courtesy_waste_monthly_cap_cents`, nullable = sin tope).
2. ¿Hold times también en sub-recetas madre? (→ Task 4)
3. Slots de pars: ¿fijos 11/14/17/20 o configurables? (propuesta: configurables con defaults)
   (→ Task 7)
4. Tamaño de muestra de auditoría sorpresa: ¿N SKUs o % catálogo? (→ Task 10)
5. Merma por preparación: ¿captura explícita o derivada de bruto vs `yieldPercent` al producir?
   (→ Task 11)
6. Metas de merma: ¿la categoría del benchmark es la categoría de insumo actual o hace falta un
   agrupador nuevo (proteínas/vegetales/lácteos/abarrotes)? (→ Task 12)
7. Ranking corporativo: ¿el gerente ve el ranking completo con nombres o solo su posición?
   (→ Task 17)
8. Cocina central: ¿hay cliente con ese modelo hoy? Si no, sacar Phase 5 del plan activo y dejar
   Task 20 acotada a producción en sucursal. (→ Phase 5)
9. Corte D-2: ¿hora fija configurable por empresa o cierre manual de la central? (→ Task 18)
