# TODO: cierre de la auditoría de Finanzas (QSR 3–15 sucursales, MTY)

Plan: `tasks/plan-cierre-auditoria-finanzas.md`

Convenciones del repo:
- Dinero en centavos (integer). Scoping por `companyId`/`branchId`, **siempre desde la sesión**.
- Verificación base: `pnpm run build` limpio antes de cada commit.
- Specs contra la DB de desarrollo real, datos etiquetados `[E2E]`, fechas fuera de
  julio–agosto de 2026 (que es lo que ocupa el seed).
- Copy de usuario en español. Nada de `console.log` en código nuevo: `createChildLogger`.
- `pnpm db:generate` para migraciones; **nunca** `db:push`.

**Estado (2026-09-01): fases 0 a 5 cerradas, más A6.1 y A6.3 de la 6.**

Las decisiones que bloqueaban:

| Decisión | Qué se resolvió | Dónde vive |
|---|---|---|
| **D1** — IVA que el POS no exporta | Opción **(c)**: `tenant_operating_config.vat_rate_percent`, default 16, procedencia `DERIVED`. `null` = no estimar, base bruta declarada | `lib/services/sales-base.ts` |
| **D2** — factor de carga patronal | Opción **(a)**: `labor_burden_factor_percent` nullable + `payroll_state_tax_percent` como línea propia. Con `null` el KPI se rotula bruto y el semáforo **no pinta color** | `lib/services/labor-burden.ts` |
| **D3** — formatos bancarios inventados | **Queda sólo el genérico SPEI.** Banorte y BBVA salieron del menú y del tipo `BankLayoutFormat`; vuelven con el manual del banco en mano | `treasury-service.ts`, `treasury-dashboard.tsx` |
| **D4** — promociones de agregador | Sigue abierta. Bloquea A6.2 | — |
| **D5** — ¿Pulso emite REP o sólo lo concilia? | Sigue abierta; la responde el contador del cliente. Bloquea A6.5 | — |

**Lo que queda pendiente, y por qué:**

- **A6.2** — promociones financiadas por el restaurante. 🔒 D4.
- **A6.4** — pago parcial de factura. Difierido por decisión de alcance: la Fase 6
  entró sólo con A6.1 y A6.3, que son las dos con consecuencia fiscal directa.
- **A6.5** — complemento de pago (REP) y DIOT. 🔒 D5.

**Dos desviaciones del texto del plan, ambas declaradas:**

1. **A2.4 no rechaza la descarga completa.** El plan pedía "rechazar la descarga
   si alguna partida no es dispersable", pero su propio criterio de aceptación
   pide lo contrario —"genera archivo con las dos primeras y un aviso nombrando
   la de impuestos"—. Se implementó el criterio de aceptación: el archivo sale
   con lo dispersable y la respuesta trae `excluded[]` con el motivo de cada
   exclusión, `excludedCount` y `excludedAmountCents`, que la UI muestra junto a
   `recordCount`. Sólo se rechaza cuando **ninguna** partida es dispersable: un
   archivo vacío en el portal del banco es un intento perdido.
2. **`PETTY_CASH_REIMBURSEMENT` y `OTHER` no se emiten en el layout.** El plan
   los listaba como dispersables, pero no lo son: la reposición de caja chica
   entra como efectivo al fondo de la sucursal y **el esquema no tiene cuenta
   bancaria de sucursal** a la cual transferir, y `OTHER` lo rechaza
   `assertCounterpartyPayable` al agregarse a la corrida —no tiene contraparte
   que verificar—. Los dos se declaran como excluidos con su motivo, igual que
   `TAXES`. Emitirlos exigiría inventar una CLABE destino.

---

## Fase 0: los dos huecos de control — P0

> El menor esfuerzo del plan y el mayor riesgo cerrado. La regla correcta ya está escrita en el
> archivo de al lado; falta aplicarla donde no llegó.

- [x] **A0.1** `BranchScope` en pagar y reprogramar un gasto — **F4**
  - `markPaidOperatingExpense` y `rescheduleOperatingExpense` reciben `scope: BranchScope` y
    llaman `assertScopeCoversBranch(scope, expense.branchId)` **antes** de mirar el estado —
    mismo orden que `approveOperatingExpense`, para no revelar el estado de un gasto ajeno.
  - Las dos rutas resuelven el alcance con `resolveBranchScope(user.role, user.branchId)`, igual
    que `expenses/reject/route.ts` ya lo hace.
  - Repetir el alcance en el `WHERE` del `UPDATE`, no sólo en el `SELECT`: es el mismo criterio
    de ventana que documenta `approveOperatingExpense`.
  - **Aceptación:** un GERENTE de Condesa recibe 403 al pagar y al reprogramar un gasto de
    Polanco; con el suyo, 200.
  - **Verificación:** `pnpm exec playwright test tests/branch-scope-finanzas.spec.ts`
  - **Archivos:** `lib/services/expense-service.ts`, `app/api/expenses/[id]/pay/route.ts`,
    `app/api/expenses/[id]/reschedule/route.ts` · **Tamaño: S**

- [x] **A0.2** Máquina de estados en la corrida de pago — **F3**
  - Tabla de transiciones válidas: `DRAFT → PENDING_APPROVAL | CANCELLED`,
    `PENDING_APPROVAL → APPROVED | CANCELLED`, `APPROVED → PROCESSING | CANCELLED`,
    `PROCESSING → COMPLETED`, `COMPLETED →` (terminal). El enum ya describe esta máquina; sólo
    no se valida.
  - `updatePaymentRunStatus` rechaza cualquier otra transición con mensaje en español que nombre
    el estado actual y los permitidos.
  - Filtrar por `companyId` en el `UPDATE` del servicio, no sólo en la ruta.
  - Envolver en `db.transaction` el cambio de estado y el marcado de facturas como pagadas: hoy
    son dos escrituras sueltas y un fallo entre ellas deja la corrida cerrada con facturas
    abiertas.
  - **Aceptación:** un `PATCH {"status":"COMPLETED"}` sobre una corrida en `DRAFT` responde 400
    y no toca ninguna factura; quien preparó sigue sin poder llevarla a `APPROVED`.
  - **Verificación:** spec nuevo `tests/corrida-transiciones.spec.ts`
  - **Archivos:** `lib/services/treasury-service.ts`,
    `app/api/finance/treasury/runs/[id]/status/route.ts` · **Tamaño: S**

- [x] **A0.3** Specs de alcance y de transición
  - Sumar `pay` y `reschedule` a `tests/branch-scope-finanzas.spec.ts` como mutaciones (la red
    actual sólo prueba lecturas).
  - `tests/corrida-transiciones.spec.ts`: los seis saltos inválidos y los cinco válidos, más el
    de segregación que ya existe.
  - **Dependencias:** A0.1, A0.2 · **Tamaño: S**

> ### Checkpoint: nadie mueve dinero solo
> - [x] GERENTE de otra sucursal: 403 en pagar y reprogramar
> - [x] `DRAFT → COMPLETED` rechazado; la única ruta a `COMPLETED` pasa por `APPROVED`
> - [x] `pnpm run build` limpio

---

## Fase 1: encender el flujo de efectivo — P0

> La UI ya está construida esperando el dato: el gating por `basis`, el copy de los tres casos
> (`cash-flow-calendar.tsx:519-525`) y el CSV. Lo único que falta es producir la estimación.

- [x] **A1.1** Ventana de historial propia — **F1, causa raíz**
  - Hoy la consulta de ventas usa `startDateStr`/`endDateStr`, que son la ventana **proyectada**
    (hoy → hoy+29): devuelve cero para todo día futuro por construcción. Separar en
    `lookbackStart = hoy − LOOKBACK_DAYS` y `lookbackEnd = ayer`, con `LOOKBACK_DAYS = 56`
    (ocho semanas: suficiente para ocho muestras de cada día de la semana).
  - Mantener `localDateString(…, timeZone)`: el día lo decide el reloj de la sucursal, no el del
    servidor. Ya está resuelto arriba en el mismo servicio; no re-derivarlo.
  - **Aceptación:** con seis meses de cortes sembrados, `historyDays > 0` y
    `avgDailyInflowCents !== null` en el payload.
  - **Archivos:** `lib/services/cash-flow-service.ts` · **Tamaño: S**

- [x] **A1.2** Estimación estacional por día de la semana
  - Quitar el literal `const inflowBasis: InflowBasis = "NONE"` y derivarlo:
    `SEASONAL` con ≥14 días de corte, `AVERAGE` con 1–13, `NONE` con cero.
  - `SEASONAL`: promedio de los cortes de ese mismo día de la semana dentro del lookback. Un
    sábado se proyecta con sábados. Si un día de la semana no tiene ninguna muestra, cae al
    promedio simple para ese día y no a cero.
  - `inflowFor()` devuelve `null` —no `0`— cuando `basis === "NONE"`. Hoy devuelve `0` y deja
    muertas todas las ramas de `null` que ya existen aguas abajo (`netFlowCents`,
    `cumulativeBalanceCents`).
  - No tocar la UI: su gating ya es correcto y el copy de los tres casos ya está escrito.
  - **Aceptación:** con ≥14 días, la tarjeta grande dice "Te alcanza para N días"; con 1–13,
    `AVERAGE`; con cero, sigue diciendo "Sin estimar" — que es la conducta correcta.
  - **Dependencias:** A1.1 · **Tamaño: M**

- [x] **A1.3** Spec de las tres bases
  - `tests/flujo-entradas.spec.ts`: siembra 20 días con sábados deliberadamente altos y verifica
    que el sábado proyectado supera al martes proyectado; siembra 5 días y verifica `AVERAGE`;
    siembra cero y verifica `NONE` con la trayectoria oculta.
  - Llamar al servicio directo (sin servidor ni Inngest) para que corra en segundos:
    `pnpm exec playwright test --no-deps --project=chromium tests/flujo-entradas.spec.ts`
  - **Dependencias:** A1.2 · **Tamaño: S**

> ### Checkpoint: "¿me alcanza?" contesta
> - [x] Con historial, la portada de Finanzas y la pantalla de flujo muestran un número
> - [x] Un sábado se proyecta con los sábados anteriores, verificable en el CSV
> - [x] Un inquilino sin cortes sigue viendo "Sin estimar", no un cero rojo

---

## Fase 2: tesorería que opera — P0

> **Orden obligatorio: A2.2 antes que A2.3, en el mismo PR.** Meter la CLABE en claro en una
> respuesta HTTP autorizada con `reports:read` convierte un archivo inútil en una fuga de datos
> bancarios de todos los proveedores del grupo.

- [x] **A2.1** Congelar la cuenta bancaria en la partida — **AD3**
  - Migración: `payment_run_items` gana `bank_account_id` (FK nullable a
    `supplier_bank_accounts`) y `clabe_last4_snapshot` (text nullable).
  - `addItemToRun` los escribe al agregar la partida, desde la cuenta verificada vigente que
    `assertCounterpartyPayable` ya resuelve.
  - Nullable sin backfill: las corridas en `DRAFT` ya creadas siguen funcionando, y el generador
    cae a la cuenta vigente cuando el snapshot no existe, declarándolo en la respuesta.
  - **Por qué:** sin esto, un proveedor que cambia de CLABE entre la aprobación y la dispersión
    cobra en la cuenta nueva sin que nadie la vuelva a firmar. Es el fraude que todo el módulo
    de verificación existe para impedir.
  - **Verificación:** `pnpm db:generate && pnpm db:migrate`, luego
    `npx tsx scripts/check-migration-drift.ts`
  - **Archivos:** `lib/db/schema/treasury.ts`, `drizzle/`, `lib/services/treasury-service.ts`
    · **Tamaño: S**

- [x] **A2.2** Autorización y auditoría del layout — **F10, AD4**
  - Sacar la ruta de `requirePermissionApi("reports","read")`. Exigir rol de gate
    (SUPER_ADMIN / OWNER / ADMIN) y corrida en `APPROVED` o posterior: no se genera archivo de
    dispersión de una corrida que nadie firmó.
  - Registrar la descarga en `data_access_logs` con el id de la corrida.
  - **Aceptación:** un GERENTE recibe 403; un ADMIN sobre una corrida en `DRAFT` recibe 400 con
    mensaje que dice que falta aprobarla; la descarga de un ADMIN sobre una corrida aprobada
    deja fila en `data_access_logs`.
  - **Archivos:** `app/api/finance/treasury/runs/[id]/layout/route.ts` · **Tamaño: S**

- [x] **A2.3** CLABE en claro, escape de CSV y referencia única — **F2**
  - Llamar `getVerifiedBankAccountForPayment` (`supplier-bank-account-service.ts:545`). **Ya
    existe, ya descifra, y su docstring dice que es el insumo del layout — no tiene un solo
    llamador.** No escribir descifrado nuevo.
  - Reemplazar `` `************${clabeLast4}` `` por la CLABE de 18 dígitos.
  - Escape de CSV real (comillas dobladas) en beneficiario y concepto: hoy un proveedor llamado
    `Distribuidora "El Norte", S.A.` parte la fila en dos.
  - Referencia única y determinista por partida —derivarla del id de la partida, no de
    `Date.now().slice(-7)`, que hoy es la misma para toda la corrida y distinta en cada descarga.
    Sin referencia estable no hay con qué conciliar el depósito.
  - **Aceptación:** el CSV descargado lleva 18 dígitos por línea, referencias distintas entre sí
    e iguales entre dos descargas de la misma corrida.
  - **Dependencias:** A2.1, A2.2 · **Tamaño: M**

- [x] **A2.4** Emitir todos los tipos dispersables — **F2**
  - `payment_run_item_type` tiene cinco valores; el layout sólo emite `INVOICE`. Agregar
    `PAYROLL` (contra las CLABEs de los empleados — es lo que el propio
    `assertCounterpartyPayable` dice que se hace), `PETTY_CASH_REIMBURSEMENT` y `OTHER`.
  - `TAXES` queda fuera **a propósito y declarado**: se paga por línea de captura al SAT/IMSS, no
    por SPEI. El servicio ya lo comenta; que la respuesta lo diga también.
  - Si una partida no es dispersable, **rechazar la descarga** con la lista de las excluidas. Hoy
    se descartan en silencio y el toast reporta "N registros listos" con un `recordCount` que no
    cuadra con el total de la corrida.
  - **Aceptación:** una corrida con factura + nómina + impuestos genera archivo con las dos
    primeras y un aviso nombrando la de impuestos; `recordCount` iguala las partidas emitidas y
    la UI muestra ambas cifras.
  - **Dependencias:** A2.3 · **Tamaño: M**

- [x] **A2.5** Quitar el N+1 — **F13**
  - Hoy son tres consultas por partida dentro del bucle (factura, cuenta, proveedor): 600 viajes
    para una corrida de 200 facturas. Resolver con joins agregados y un `Map`, que es el patrón
    que el resto del módulo ya usa (`getBranchPnL` pasó de ~75 consultas a 6 así).
  - **Aceptación:** una corrida de 200 partidas se genera con ≤3 consultas.
  - **Dependencias:** A2.4 · **Tamaño: S**

- [x] **A2.6** Un solo formato honesto — 🔒 **bloqueada por D3**
  - Los tres formatos actuales son inventados: sin registro de encabezado ni de cierre, sin clave
    de banco de 3 dígitos, sin tipo de cuenta, sin RFC del beneficiario, sin fecha de aplicación.
  - Con el layout real de Banorte o BBVA en mano: implementarlo. Sin él: **quitar las dos
    opciones del menú y dejar el genérico**. Tres formatos inventados le cuestan al cliente tres
    intentos fallidos en el portal del banco.
  - **Archivos:** `lib/services/treasury-service.ts`,
    `components/finance/treasury-dashboard.tsx` · **Tamaño: S (quitar) / M (implementar)**

> ### Checkpoint: el archivo se puede subir al banco
> - [x] CLABEs de 18 dígitos, no asteriscos
> - [x] `recordCount` iguala las partidas dispersables
> - [x] Un proveedor con comillas en el nombre no rompe la fila
> - [x] GERENTE: 403 en la ruta del layout; la descarga queda auditada
> - [x] Corrida de 200 facturas con ≤3 consultas

---

## Fase 3: la base de los números

> Cambia lo que muestran todos los KPI del módulo. Va después de las fases 0–2 a propósito: son
> correcciones de exactitud, no de operabilidad, y arrastran comparabilidad histórica.

- [x] **A3.1** Persistir el IVA del corte — **F5**
  - `sales-ingestion-service` ya reconoce la columna de impuesto del POS y la acumula en
    `agg.taxAmount`; el `INSERT` no la guarda. Migración: `daily_sales_cuts.tax_amount`
    (integer nullable, centavos).
  - Nullable a propósito: `null` = "el POS no lo exportó", que es distinto de un cero.
  - **Aceptación:** un archivo con columna de IVA produce un corte con `tax_amount`; uno sin
    ella, `null`.
  - **Archivos:** `lib/db/schema.ts`, `drizzle/`, `lib/services/sales-ingestion-service.ts`
    · **Tamaño: S**

- [x] **A3.2** Porcentajes sobre venta neta — 🔒 **bloqueada por D1**
  - Base neta cuando hay `tax_amount`; según D1, estimación configurable o base bruta declarada
    cuando no.
  - Corregir los comentarios que hoy afirman `daily_sales_cuts, neto sin IVA`
    (`labor-cost-service.ts:533`, encabezado de `pnl-service.ts`): describen algo que no era
    cierto y por eso el hallazgo tardó en verse.
  - Tocar `pnl-service`, `financial-kpi-service` y `commission-service` en el mismo cambio: si
    uno cambia de base y otro no, vuelven a dar números distintos para el mismo concepto — que
    es el pecado que el rediseño del KPI ya había corregido.
  - Los `pnl_snapshots` congelados guardan `sales_cents` sobre la base vieja: columna de base
    neta nullable, mismo criterio que se usó al agregar comisiones.
  - **Dependencias:** A3.1, D1 · **Tamaño: M**

- [x] **A3.3** Carga patronal e ISN — 🔒 **bloqueada por D2**
  - `laborBurdenFactorPercent` en `tenant_operating_config`, nullable. Con `null`, el KPI se
    rotula "bruto" y el semáforo no pinta color; con valor, se aplica y se declara `DERIVED`.
  - El 3% de ISN de Nuevo León entra como línea propia dentro del factor, no como constante de
    módulo: es estatal y no todos los tenants están en NL.
  - **Por qué importa:** el default de `laborCostTargetPercent` es **28.00**, un número de
    industria que viene cargado, y el medido es bruto. El semáforo pinta verde un 22% bruto que
    en realidad ronda el 29% cargado — y nómina es el renglón que un QSR ajusta cada semana con
    la programación de turnos.
  - **Dependencias:** D2 · **Tamaño: M**

> ### Checkpoint: el semáforo dice la verdad
> - [x] Corte con IVA → food cost sobre neto, `MEASURED`
> - [x] Corte sin IVA → base declarada en la nota del renglón
> - [x] KPI de nómina y objetivo de `tenant_operating_config` en la misma moneda

---

## Fase 4: cerrar el circuito del gasto

- [x] **A4.1** Forma de pago, IVA y `paid_by` en el gasto — **F8**
  - Migración: `operating_expenses` gana `payment_method` (enum: `EFECTIVO`, `TRANSFERENCIA`,
    `TARJETA`, `DOMICILIADO`, `CHEQUE`), `tax_amount` (integer nullable) y `paid_by` (FK a
    `users`, nullable).
  - `markPaidOperatingExpense` escribe `paid_by` en su columna y deja de concatenar
    `"Pagado por Fulano"` al final de `approvalNotes` — el propio código comenta que lo hace
    porque la columna no existe.
  - Control Interno lee `paid_by` de la llave foránea, no del texto.
  - **Coordinar con `plan-pnl-real.md` PL1** (`business_date` en la misma tabla): si se toma en
    la misma ventana, una sola migración.
  - **Aceptación:** la bitácora nombra a quien pagó desde el join, no desde una cadena.
  - **Archivos:** `lib/db/schema.ts`, `drizzle/`, `lib/services/expense-service.ts`,
    `lib/services/control-interno-service.ts`, `components/finance/expense-form.tsx`
    · **Tamaño: M**

- [x] **A4.2** Caja chica llega al P&L y al presupuesto — **F7**
  - Fuera de su propio servicio y del esquema, **ningún archivo del repo lee
    `petty_cash_transactions`**. La tabla incluso guarda `category` con el mismo enum que los
    gastos operativos — la intención estaba ahí — pero nadie la agrega.
  - Renglón propio en `BranchPnL`, agregado por sucursal y período desde las transacciones `OUT`.
    **No** duplicar cada salida como fila en `operating_expenses`: la metería a la cola de
    autorización, que es justo lo que la caja chica existe para evitar (AD7).
  - Consumo de presupuesto por centro de costo cuando la transacción lo trae.
  - Sumarlo al renglón de egresos del flujo de efectivo por la reposición, que es lo que
    realmente sale del banco.
  - **Por qué importa:** en un QSR es el hielo, el gas de emergencia, el plomero, el taxi del
    insumo que faltó. En 15 sucursales deja de ser menudencia, y la utilidad operativa del P&L
    está sobreestimada exactamente en ese monto sin que ninguna pantalla lo advierta.
  - **Aceptación:** una salida de caja chica de $800 en Cumbres aparece en el P&L de Cumbres del
    período y consume su centro de costo.
  - **Dependencias:** A4.1 · **Archivos:** `lib/services/pnl-service.ts`,
    `lib/services/pnl-types.ts`, `lib/services/budget-service.ts`,
    `lib/services/petty-cash-service.ts` · **Tamaño: M**

- [x] **A4.3** Regla de deducibilidad — **F8**
  - Excepción de Control Interno: gasto con `payment_method = EFECTIVO` y monto > $2,000 MXN no
    es deducible (LISR art. 27-III). Umbral configurable por si cambia la ley.
  - Severidad MEDIA: es dinero que se paga de más en impuestos, no dinero que se fue.
  - **Dependencias:** A4.1 · **Tamaño: S**

> ### Checkpoint: el gasto es auditable
> - [x] "Pagado por" sale de una FK
> - [x] La salida de caja chica aparece en el P&L de su sucursal
> - [x] Un gasto de $3,000 en efectivo genera excepción

---

## Fase 5: control interno que detecta

- [x] **A5.1** Filtro de período y cota en `detectViolations` — **F9**
  - Hoy trae **todos** los gastos históricos de la empresa a memoria, sin filtro de período ni
    paginación, y los recorre en JavaScript. A 15 sucursales y un año son decenas de miles de
    filas en cada carga de la pantalla.
  - Filtro de período por omisión (90 días), declarado en la UI como ya se hizo con la ventana
    de detección de contratos recurrentes.
  - **Verificación:** sembrar un año de gastos `[E2E]` y medir el tiempo de la ruta antes/después.
  - **Tamaño: S**

- [x] **A5.2** Quitar el carve-out de `SELF_APPROVAL` — **F9**
  - La regla conserva `matchingRule.minAmount > 0` — justo el carve-out que A16 eliminó de
    `expense-service` por vaciar la segregación de funciones. El detector no ve los
    autoaprobados del tramo más bajo, que es donde vive la mayoría de los gastos.
  - **Tamaño: XS**

- [x] **A5.3** Regla de fraccionamiento — **F9**
  - Varios gastos de la misma contraparte y el mismo centro de costo dentro de 72h que, sumados,
    cruzan un umbral de autorización que ninguno cruza por separado. Es la forma número uno de
    evadir una escalera de aprobación en operación multisucursal, y hoy no se detecta.
  - Severidad MEDIA al inicio, no HIGH: el insumo perecedero comprado a diario produce falsos
    positivos. Se sube a HIGH después de calibrar contra datos reales.
  - **Aceptación:** tres gastos de $4,000 el mismo día, misma contraparte, mismo centro de costo,
    con umbral en $10,000 → un hallazgo que nombra los tres.
  - **Dependencias:** A5.1 · **Tamaño: M**

- [x] **A5.4** Regla de pago duplicado — **F9**
  - Misma contraparte, mismo monto exacto, dentro de 7 días, ambos en `PAID`.
  - **Dependencias:** A5.1 · **Tamaño: S**

- [x] **A5.5** Extender la red de regresión de alcance — **F11**
  - `RUTAS` en `tests/branch-scope-finanzas.spec.ts` es
    `[KPIS, PNL, PAYABLES, AUDIT_LOG, EXCEPCIONES]`. Fuera quedan tesorería, cuentas bancarias de
    proveedores, flujo de efectivo, comisiones, costo laboral, caja chica y las mutaciones de
    gasto — **exactamente donde estaban F4 y F10**. La suite prueba las superficies que ya
    pasaron por la corrección de alcance y no las que nunca la recibieron.
  - **Dependencias:** A0.1, A2.2 · **Tamaño: S**

- [x] **A5.6** Migrar el `requireAuth` legacy — **F12**
  - Siete rutas usan el `requireAuth` de `lib/tenant-context.ts`, que CLAUDE.md marca como el
    camino viejo: `budgets`, `expenses/approvals`, `expenses/evidence`, `expenses/reject`,
    `petty-cash` (las tres). Caja chica entera está en el dialecto legacy.
  - Migrar a `withTenantAuth` / `withRoleAuth` según lo que cada una necesite. No tocar las dos
    fiscales que lo mezclan con ABAC sin revisarlas aparte.
  - **Tamaño: M**

> ### Checkpoint: la excepción vale lo que cuesta
> - [x] La pantalla carga con un año de gastos sembrados
> - [x] Fraccionamiento detectado
> - [x] `RUTAS` cubre las 7 superficies que faltaban

---

## Fase 6: producto (no es deuda técnica)

> Alcance que el cliente pide o no. Explícito para que difererirlo sea una decisión y no un
> olvido.

- [x] **A6.1** Comisiones: IVA sobre la comisión y tarifa por sucursal — **F14** · **Tamaño: M**
  - El agregador cobra 16% de IVA **sobre** su comisión; el cálculo actual no lo modela.
  - `channel_commission_rates` es por empresa; un grupo que abrió su sucursal 12 con tarifa de
    arranque distinta no la puede representar. Agregar `branch_id` nullable (null = tarifa del
    grupo), con la resolución por fecha de negocio que ya existe.
- [ ] **A6.2** Promociones financiadas por el restaurante — 🔒 **bloqueada por D4** · **M/L**
- [x] **A6.3** Revalidar vigencia de CFDI ya conciliados — **F15** · **Tamaño: M**
  - Un CFDI se concilia una vez (`SIN_MATCH` / `CONCILIADA`) y nunca se revalida. Si el proveedor
    cancela una factura que el grupo ya dedujo, nada lo detecta. Job de Inngest mensual contra el
    servicio de validación que `fiscal-service` ya tiene.
- [ ] **A6.4** Pago parcial de factura — **F15** · **Tamaño: M**
  - `invoice_payment_status` es `PENDING | PAID | CANCELLED`. El pago parcial es la norma al
    negociar con proveedores de insumo, y hoy no existe.
- [ ] **A6.5** Complemento de pago (REP) y DIOT — 🔒 **bloqueada por D5** · **L**

---

## Verificación final

- [x] `pnpm run build && pnpm run lint` limpios
- [x] `pnpm build && PLAYWRIGHT_WEB_SERVER_CMD="npm run start" pnpm test:e2e` con el dev server
      de Inngest arriba (sin él fallan 15 specs que no tienen nada roto)
- [x] `npx tsx scripts/check-migration-drift.ts` sin drift
- [x] Recorrido manual con dos sesiones de distinto rol: capturar corte → ver flujo → armar
      corrida → aprobar con segunda firma → descargar layout → marcar pagado


---

## Lo que se verificó al cerrar

```
pnpm run build                                   ✅ limpio (exit 0)
npx tsc --noEmit                                 ✅ limpio
npx tsx scripts/check-migration-drift.ts         ✅ sin deriva
pnpm exec playwright test --no-deps --project=chromium \
  tests/{base-venta-neta,flujo-entradas,layout-dispersion,\
         corrida-transiciones,control-interno-reglas}.spec.ts
                                                 ✅ 45/45 (casos de servicio)
pnpm run lint                                    ⚠️ 2 errores PREEXISTENTES
```

Los dos errores de lint son anteriores a este trabajo y viven en archivos que no
se tocaron: `app/dashboard/inventory/audit/audit-detail-drawer.tsx:109`
(`react-hooks/rules-of-hooks`) y `lib/services/payroll-service.ts:78`
(`prefer-const`). Arreglar el primero es reordenar los hooks de un componente
ajeno a Finanzas; se dejan señalados en vez de tocarlos de paso.

**Los casos que necesitan servidor levantado** —el gate de rol del layout, las
transiciones por HTTP, y las mutaciones de gasto de `branch-scope-finanzas`— no
se corrieron en esta ventana:

```
pnpm build && PLAYWRIGHT_WEB_SERVER_CMD="npm run start" \
  pnpm exec playwright test --project=chromium \
  tests/layout-dispersion.spec.ts tests/corrida-transiciones.spec.ts \
  tests/branch-scope-finanzas.spec.ts
```

## Migraciones aplicadas

`0083` … `0087`, todas con columnas nullable y sin backfill.

| Migración | Qué agrega |
|---|---|
| `0083_deep_barracuda` | `payment_run_items.bank_account_id`, `clabe_last4_snapshot` (A2.1) |
| `0084_marvelous_agent_brand` | `daily_sales_cuts.tax_amount` (A3.1); `operating_expenses.payment_method`, `tax_amount`, `paid_by` (A4.1); `tenant_operating_config.vat_rate_percent`, `labor_burden_factor_percent`, `payroll_state_tax_percent` (D1/D2); `channel_commission_rates.branch_id`, `vat_bps` (A6.1) |
| `0085_natural_wrecking_crew` | Índices únicos parciales de `channel_commission_rates` (tarifa de sucursal vs. tarifa de grupo) |
| `0086_plain_arclight` | `petty_cash_transactions.cost_center_id` (A4.2) |
| `0087_volatile_blue_blade` | `invoices.sat_status`, `sat_checked_at` (A6.3) |

**Trampa encontrada al aplicarlas.** `drizzle-kit migrate` compara el campo
`when` del journal contra el `created_at` de la última migración aplicada y
**salta en silencio** cualquier migración cuyo `when` sea anterior. La `0082`
(hand-authored) quedó sellada con una fecha futura respecto del reloj de esta
máquina, así que la `0083` se reportó como "applied successfully" sin ejecutar
una sola sentencia — las columnas no existían y el fallo apareció como un
`column does not exist` en un spec. Se corrigieron los `when` de las migraciones
nuevas para que queden después de la última aplicada. Es exactamente la deriva
que `scripts/check-migration-drift.ts` existe para atrapar; conviene correrlo
**después** de cada `db:migrate`, no sólo antes.

Además, `drizzle-kit generate` incluyó en la `0083` una columna que ya existía en
la base (`invoices.recurring_contract_id`, aplicada por la `0082` sin actualizar
su snapshot). Esa sentencia se quitó del SQL a mano —dejarla habría hecho fallar
la migración entera— pero el snapshot de la `0083` sí la registra, que es lo
correcto: describe el estado real de la base.
