# Plan: cierre de la auditoría de Finanzas (perfil QSR 3–15 sucursales, MTY)

> **Estado: cerrado el 2026-09-01.** Fases 0–5 completas, más A6.1 y A6.3 de la
> fase 6. Quedan abiertas A6.2 (🔒 D4), A6.4 (diferida por alcance) y A6.5 (🔒 D5).
> El detalle de lo verificado, las migraciones aplicadas y las dos desviaciones
> declaradas están al final de `tasks/todo-cierre-auditoria-finanzas.md`.
>
> Origen: auditoría de lectura de código del 2026-09-01 sobre `app/dashboard/finance`
> (13 pantallas, 38 rutas API, 13 servicios). 15 hallazgos, F1–F15.
> Reporte publicado: https://claude.ai/code/artifact/9e752612-227d-471e-994c-2fb46b5478c6
> TODO: `tasks/todo-cierre-auditoria-finanzas.md`

## Overview

El módulo calcula bien y opera mal. La capa de cálculo —P&L, food cost, labor cost— declara la
procedencia de cada cifra y prefiere decir "no sé" antes que inventar una constante; ese es el
activo y no se toca. Lo que falla es la capa donde el dinero se mueve y la capa donde se controla
quién lo mueve:

- **Flujo de efectivo:** nunca proyecta entradas. `inflowBasis` está fijado al literal `"NONE"`,
  así que la pregunta que justifica el módulo —¿me alcanza?— contesta "Sin estimar" para todo
  inquilino, tenga seis meses de cortes o ninguno.
- **Tesorería:** el archivo de dispersión lleva la CLABE enmascarada y sólo emite 1 de los 5
  tipos de partida. La función que descifra la cuenta para este uso exacto **ya existe y no la
  llama nadie**.
- **Control:** la segregación de funciones se aplica al aprobar un gasto pero no al pagarlo, y la
  doble firma de una corrida se salta pasando de `DRAFT` a `COMPLETED` en un `PATCH`.

Este plan cierra los 15 hallazgos en seis fases, ordenadas por costo de dejarlo roto.

## Estado del código relevante (2026-09-01, `main` @ `fb021c5`)

Tres cosas que cambian el tamaño del trabajo y conviene tener presentes antes de estimar:

| Hallazgo | Lo que ya está construido | Lo que falta |
|---|---|---|
| F1 — flujo sin entradas | `InflowBasis`, `historyDays`, `avgDailyInflowCents`, el copy de los tres casos en `cash-flow-calendar.tsx:519-525` y todo el gating de la UI | La estimación misma, y leer el historial **hacia atrás** en vez de dentro de la ventana proyectada |
| F2 — layout sin CLABE | `getVerifiedBankAccountForPayment` (`supplier-bank-account-service.ts:545`), documentada como *"el insumo del layout bancario (paso 7)"* | **Cero llamadores.** El layout nunca se cableó a ella |
| F3 — doble firma | El enum `payment_run_status` ya describe la máquina completa: `DRAFT → PENDING_APPROVAL → APPROVED → PROCESSING → COMPLETED / CANCELLED` | La validación de transición. `updatePaymentRunStatus` acepta cualquier valor del enum |

Dos hallazgos crecieron al mirarlos de cerca:

- **F2 es de 4 tipos, no de 2.** `payment_run_item_type` tiene cinco valores; el layout sólo emite
  `INVOICE`. `PAYROLL`, `PETTY_CASH_REIMBURSEMENT` y `OTHER` se aceptan en la corrida y se
  descartan en silencio. `TAXES` sí queda fuera legítimamente (se paga por línea de captura al
  SAT/IMSS, no por SPEI — el propio servicio lo comenta).
- **F2 + F10 son la misma tarea.** El comentario de `getVerifiedBankAccountForPayment` advierte
  *"no debe alcanzar una respuesta HTTP"*, y la ruta del layout devuelve el archivo como
  `content` dentro del JSON, autorizada con `reports:read` — que GERENTE tiene. Meter la CLABE en
  claro sin cambiar la autorización convierte un archivo inútil en una fuga de datos bancarios de
  todos los proveedores del grupo. **Van en el mismo commit o en ninguno.**

## Architecture Decisions

- **AD1 — El historial de ventas se lee en su propia ventana.** Hoy la consulta de ventas usa
  `startDateStr`/`endDateStr`, que son la ventana *proyectada* (hoy → hoy+29). Se separa en
  `lookbackStart`/`lookbackEnd` (hoy−N → ayer). Es la causa raíz de F1: aunque `inflowBasis`
  dejara de estar fijado, la consulta seguiría devolviendo cero.
- **AD2 — La procedencia de las entradas se declara, no se asume.** `SEASONAL` con ≥14 días de
  corte, `AVERAGE` con ≥1, `NONE` con cero. Es la misma escalera que ya usan food cost y labor
  cost, y el copy de los tres casos ya está escrito en la UI.
- **AD3 — La cuenta bancaria se congela en la partida.** `payment_run_items` gana
  `bank_account_id` y `clabe_last4_snapshot`, escritos al agregar la partida. Sin esto, un
  proveedor que cambia de CLABE entre la aprobación y la dispersión cobra en la cuenta nueva sin
  que nadie la vuelva a firmar — que es exactamente el fraude que el módulo de verificación
  existe para impedir.
- **AD4 — Generar un archivo bancario es una operación de tesorería, no la lectura de un
  reporte.** Sale de `requirePermissionApi("reports","read")` y pasa a exigir rol de gate
  (SUPER_ADMIN / OWNER / ADMIN), corrida en `APPROVED` o posterior, y registro en
  `data_access_logs`.
- **AD5 — Los porcentajes se calculan sobre venta neta cuando el dato existe, y se etiquetan
  cuando no.** No se aplica un divisor de 1.16 en silencio. Ver D1.
- **AD6 — La carga patronal es un factor configurable, no un cálculo de IMSS.** Calcular SBC,
  topes UMA y ramas de seguro es un módulo entero. Un factor por tenant más el 3% de ISN de Nuevo
  León pone el número en el mismo orden de magnitud que el objetivo contra el que se compara, y
  se declara `DERIVED`. Ver D2.
- **AD7 — Caja chica no se convierte en gasto operativo.** Se agrega desde
  `petty_cash_transactions` como renglón propio del P&L. Duplicar cada salida como fila en
  `operating_expenses` la metería a la cola de autorización, que es justo lo que la caja chica
  existe para evitar.

## Fases

### Fase 0 — Los dos huecos de control (F3, F4) · P0

La regla correcta ya está escrita en el archivo de al lado. Es el trabajo más barato del plan y
el que cierra el riesgo más caro.

- [x] **A0.1** `BranchScope` en `markPaidOperatingExpense` y `rescheduleOperatingExpense`
- [x] **A0.2** Máquina de estados en `updatePaymentRunStatus`
- [x] **A0.3** Specs de alcance y de transición

#### Checkpoint: nadie mueve dinero solo
- [x] Un GERENTE de otra sucursal recibe 403 al pagar y al reprogramar
- [x] `DRAFT → COMPLETED` se rechaza; la única ruta a `COMPLETED` pasa por `APPROVED`
- [x] Quien preparó la corrida no la puede llevar a `APPROVED` ni saltarse el estado
- [x] `pnpm run build` limpio

### Fase 1 — Encender el flujo de efectivo (F1) · P0

La mayor razón valor/esfuerzo del módulo: la UI ya está construida esperando el dato.

- [x] **A1.1** Ventana de historial propia (AD1)
- [x] **A1.2** Estimación estacional por día de la semana, con `AVERAGE` como escalón (AD2)
- [x] **A1.3** Spec: tres bases de procedencia y la trayectoria de saldo

#### Checkpoint: "¿me alcanza?" contesta
- [x] Con ≥14 días de corte, la tarjeta dice "Te alcanza para N días" y no "Sin estimar"
- [x] Con 1–13 días, `AVERAGE` y el copy correspondiente
- [x] Sin cortes, `NONE` — se sigue sin dibujar la trayectoria, que es la conducta correcta
- [x] Un sábado se proyecta con los sábados anteriores, verificable en el CSV de la pantalla

### Fase 2 — Tesorería que opera (F2, F10, F13) · P0

- [x] **A2.1** Congelar la cuenta en la partida (AD3, migración)
- [x] **A2.2** Autorización y auditoría del layout (AD4) — **antes** de A2.3
- [x] **A2.3** CLABE en claro, escape de CSV y referencia única por partida
- [x] **A2.4** Emitir `PAYROLL`, `PETTY_CASH_REIMBURSEMENT` y `OTHER`; rechazar la descarga si
      alguna partida no es dispersable
- [x] **A2.5** Consulta agregada en lugar del bucle N+1
- [x] **A2.6** Reducir a un solo formato honesto — **bloqueada por D3**

#### Checkpoint: el archivo se puede subir al banco
- [x] El CSV lleva CLABEs de 18 dígitos, no asteriscos
- [x] `recordCount` iguala el número de partidas dispersables de la corrida
- [x] Un proveedor con comillas en el nombre no rompe la fila
- [x] Un GERENTE recibe 403 en la ruta del layout; la descarga queda en `data_access_logs`
- [x] Una corrida de 200 facturas se genera con ≤3 consultas

### Fase 3 — La base de los números (F5, F6)

Cambia lo que muestran todos los KPI del módulo. Va después de las fases 0–2 a propósito: son
correcciones de exactitud, no de operabilidad, y arrastran una decisión de comparabilidad
histórica (ver Riesgos).

- [x] **A3.1** Persistir `tax_amount` en `daily_sales_cuts` (migración)
- [x] **A3.2** Venta neta como base de los porcentajes, con procedencia — **bloqueada por D1**
- [x] **A3.3** Factor de carga patronal + ISN de Nuevo León (AD6) — **bloqueada por D2**

#### Checkpoint: el semáforo dice la verdad
- [x] Un corte con IVA capturado produce food cost sobre neto, etiquetado `MEASURED`
- [x] Un corte sin IVA mantiene la base bruta y lo declara en la nota del renglón
- [x] El labor cost del KPI y el objetivo de `tenant_operating_config` hablan la misma moneda

### Fase 4 — Cerrar el circuito del gasto (F7, F8)

- [x] **A4.1** `payment_method`, `tax_amount` y `paid_by` en `operating_expenses` (migración)
- [x] **A4.2** Caja chica como renglón del P&L y consumo de presupuesto (AD7)
- [x] **A4.3** Regla de deducibilidad: efectivo > $2,000 MXN (LISR 27-III)

#### Checkpoint: el gasto es auditable
- [x] "Pagado por" sale de una llave foránea, no de texto concatenado en `approvalNotes`
- [x] La salida de caja chica aparece en el P&L de su sucursal y consume su centro de costo
- [x] Un gasto de $3,000 marcado como efectivo genera excepción en Control Interno

### Fase 5 — Control interno que detecta (F9, F11, F12)

- [x] **A5.1** Filtro de período y cota en `detectViolations`
- [x] **A5.2** Quitar el carve-out `minAmount > 0` de `SELF_APPROVAL`
- [x] **A5.3** Regla de fraccionamiento
- [x] **A5.4** Regla de pago duplicado
- [x] **A5.5** Extender `branch-scope-finanzas.spec.ts` a las 7 superficies fuera de la red
- [x] **A5.6** Migrar las 7 rutas del `requireAuth` legacy

#### Checkpoint: la excepción vale lo que cuesta
- [x] La pantalla carga con un año de gastos sembrados sin degradarse
- [x] Tres gastos de $4,000 el mismo día, misma contraparte, mismo centro de costo → hallazgo
- [x] `RUTAS` del spec de alcance cubre tesorería, caja chica, comisiones y las mutaciones de gasto

### Fase 6 — Producto (F14, F15)

No es deuda técnica; es alcance que el cliente pide o no. Se deja explícito para que la decisión
sea consciente y no un olvido.

- [x] **A6.1** Comisiones: IVA sobre la comisión y tarifa por sucursal
- [ ] **A6.2** Promociones financiadas por el restaurante — **bloqueada por D4**
- [x] **A6.3** Revalidar vigencia de CFDI ya conciliados
- [ ] **A6.4** Pago parcial de factura
- [ ] **A6.5** Complemento de pago (REP) y DIOT — **bloqueada por D5**

### Checkpoint: Complete
- [x] `pnpm run build && pnpm run lint` limpios
- [x] Cada fase con al menos un spec de Playwright
- [x] Recorrido manual: capturar corte → ver flujo → armar corrida → aprobar con segunda firma →
      descargar layout → marcar pagado, con dos sesiones de distinto rol

## Decisiones — resueltas y pendientes

> **Resueltas al cerrar (2026-09-01):**
>
> - **D1 → (c).** `tenant_operating_config.vat_rate_percent`, default `16.00`,
>   procedencia `DERIVED`. `null` apaga la estimación y los porcentajes se
>   calculan sobre base bruta **declarada en la nota del renglón**. La
>   resolución vive en `lib/services/sales-base.ts` y la comparten P&L, KPI
>   financiero y costo laboral, para que no vuelvan a discrepar en el divisor.
> - **D2 → (a).** `labor_burden_factor_percent` nullable más
>   `payroll_state_tax_percent` como línea propia (el ISN es estatal: NL 3%,
>   CDMX 4%, Jalisco 2%). Con `null` el KPI se rotula bruto y **el semáforo no
>   pinta color**, porque comparar un bruto contra un objetivo cargado no dice
>   nada. `lib/services/labor-burden.ts`.
> - **D3 → sólo el genérico.** No se consiguió el layout real de ningún banco,
>   así que Banorte y BBVA salieron del menú de Tesorería y del tipo
>   `BankLayoutFormat`; un `?format=BANORTE_TXT` recibe 400 con la lista de los
>   válidos. Vuelven cuando exista el manual contra el cual implementarlos.
>
> **Siguen abiertas:** D4 (bloquea A6.2) y D5 (la responde el contador del
> cliente; bloquea A6.5).

## Decisiones pendientes

**D1 — ¿Qué se hace cuando el POS no exporta el IVA? (bloquea A3.2)**
`sales-ingestion-service` ya reconoce la columna de impuesto y la acumula; sólo hay que
persistirla (A3.1). El problema es el corte que llega sin ella, y los ~históricos que ya están
guardados sin desglose.

- **(a) Base bruta declarada.** Sin `tax_amount`, el % se sigue calculando sobre el total y el
  renglón dice "base con IVA". Honesto, consistente con la doctrina del módulo, y deja al dueño
  comparando dos períodos con bases distintas si a mitad de camino empieza a exportar el IVA.
- **(b) Divisor sectorial 1.16 etiquetado `DERIVED`.** Todo período comparable. Asume que toda la
  venta es alimento preparado al 16%, lo cual es cierto para un QSR pero no para un tenant que
  venda abarrote o tenga sucursal en franja fronteriza.
- **(c) Tasa de IVA configurable por tenant**, con `null` = no estimar (cae en (a)).

Recomendación: **(c) con default 16 y procedencia `DERIVED`**. Da comparabilidad sin inventar,
y el tenant que no quiera la estimación la apaga. `null` es la conducta de (a).

**D2 — ¿De dónde sale el factor de carga patronal? (bloquea A3.3)**
El default de `laborCostTargetPercent` es **28.00**, que es un número de industria y viene
cargado. El medido es bruto. La comparación está torcida desde el default.

- **(a) `laborBurdenFactorPercent` en `tenant_operating_config`**, default `null`. Con `null` el
  KPI se rotula "bruto" y el semáforo no pinta color. Con valor, se aplica y se declara `DERIVED`.
- **(b) Cálculo real de IMSS** desde `employee_contracts` (SBC, topes UMA, ramas). Correcto y
  caro; es un módulo, no una tarea.
- **(c) Bajar el default del objetivo a un número bruto (~22%)** y documentar que es bruto.
  Gratis, pero rompe a todo tenant que ya capturó su objetivo.

Recomendación: **(a)**, con el 3% de ISN de Nuevo León como línea propia dentro del factor
—es estatal y no todos los tenants están en NL, así que no puede ser constante de módulo.

**D3 — ¿Se sostienen los formatos Banorte y BBVA? (bloquea A2.6)**
Los tres formatos actuales son inventados: sin registro de encabezado ni de cierre, sin clave de
banco, sin tipo de cuenta, sin RFC del beneficiario, sin fecha de aplicación. Hace falta el
layout real de al menos un banco —el manual de "Pago a terceros" de Banorte o el de BBVA Net
Cash— para implementarlo bien.

Si no se consigue el documento: **dejar sólo el genérico y quitar las otras dos opciones del
menú**. Tres formatos inventados le cuestan al cliente tres intentos fallidos en el portal del
banco; uno honesto le cuesta uno.

**D4 — ¿Cómo entran las promociones de agregador? (bloquea A6.2)**
En campaña, el 2x1 que financia el restaurante pesa más que la comisión. No hay tabla donde
viva. Es la misma disyuntiva de D1 en `plan-finance-module-gaps.md`: tarifa calculada vs.
captura de la liquidación del agregador. La captura de liquidación resuelve promociones y
comisión medida de una sola vez, y es la opción (c) que aquel plan dejó para "después si el
cliente lo pide". Este hallazgo es la razón para pedirlo.

**D5 — ¿Pulso emite REP o sólo lo concilia? (bloquea A6.5)**
Emitir complemento de pago obliga a timbrar por cada pago a proveedor en PPD y a tener el CSD
del cliente cargado. Conciliar el REP que el proveedor emite es leerlo del buzón, que ya se
descarga. Son alcances muy distintos y la respuesta la da el contador del cliente, no el código.

## Risks and Mitigations

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Poner la CLABE en claro en la respuesta del layout sin cambiar la autorización | **Alto — fuga de datos bancarios de todos los proveedores** | A2.2 va antes que A2.3, en el mismo PR. El checkpoint de la fase 2 lo verifica con sesión de GERENTE |
| Cambiar la base de ventas rompe la comparabilidad con `pnl_snapshots` congelados | **Alto** | Los snapshots guardan `sales_cents` plano. Precedente en el repo: la columna de comisiones se agregó nullable para que un snapshot viejo no afirmara cero. Aplicar el mismo criterio: columna de base neta nullable, y la gráfica de tendencia declara el cambio de base |
| La fase 1 hace que la pantalla de flujo pase de "Sin estimar" a un número, y el primer número que vea el dueño será el que juzgue | Medio | El copy de procedencia ya existe y explica de cuántos días de corte salió. No agregar bandas de color hasta tener ≥14 días |
| Congelar la cuenta bancaria en la partida rompe corridas en `DRAFT` ya creadas | Bajo | Columnas nullable; el generador cae a la cuenta verificada vigente cuando el snapshot no existe, y lo declara en la respuesta |
| La regla de fraccionamiento genera falsos positivos en insumo perecedero comprado a diario | Medio | Acotar a misma contraparte + mismo centro de costo + ventana de 72h, y severidad MEDIA, no HIGH. Se ajusta con datos reales antes de subirla a HIGH |
| Las migraciones de las fases 3 y 4 tocan tablas grandes | Medio | Columnas nullable sin backfill. `scripts/check-migration-drift.ts` antes y después |
| El factor de carga patronal se lee como cálculo de IMSS | Medio | Etiqueta `DERIVED` y nota al pie explícita, igual que el resto del módulo |

## Overlap con otros planes

| Tema | Tracker | Relación |
|---|---|---|
| Comisiones por canal (Fase 4, decisión D1) | `plan-finance-module-gaps.md` | A6.1 y A6.2 son la continuación. D4 de aquí responde a D1 de allá |
| Cierre de período financiero (Fase 5, decisión D2) | `plan-finance-module-gaps.md` | Bloqueado por `business_date` en gastos, que es PL1 de `plan-pnl-real.md`. **No lo toma este plan** |
| `business_date` en `operating_expenses` | `plan-pnl-real.md` PL1 | A4.1 agrega tres columnas a la misma tabla. Conviene ejecutarlas en la misma migración si PL1 se toma en la misma ventana |
| Contratos recurrentes de monto variable | `plan-gastos-recurrentes-variables.md` | Cerrado salvo estacionalidad (D2 de aquel plan). A1.2 no lo toca: proyecta entradas, no egresos |
| `LaborCalculator` con horas ordinarias en cero | `plan-pnl-real.md` PL4 | A3.3 **no** depende de él: `labor-cost-service` no consume `LaborCalculator`, lo dice en su encabezado |

## Premisas descartadas (verificadas contra el código)

- ~~"El layout necesita que se implemente el descifrado de CLABE"~~ —
  `getVerifiedBankAccountForPayment` ya lo hace, con el comentario que dice que es para esto.
  Falta la llamada, no la función.
- ~~"La segregación de funciones en gastos no está implementada"~~ — sí lo está en `approve` y
  `reject`, desde A16, con cerrojo optimista en el `WHERE`. Falta extenderla a `pay`.
- ~~"El P&L no escala a 15 sucursales"~~ — se agregó por `GROUP BY branch_id`: 6 consultas para
  toda la company. El N+1 que queda es sólo el del layout bancario (A2.5).
- ~~"Caja chica inventa saldos"~~ — se saneó: `getOrCreateFund` se eliminó, la apertura es
  explícita y hay scripts para los fondos fantasma ya escritos. Lo que falta es que la salida
  llegue al P&L.
- ~~"La ingesta de POS duplica ventas entre canales"~~ — el split es excluyente: o `SALON` +
  `DELIVERY`, o `TOTAL`. Nunca ambos desde el mismo archivo.

## Open Questions

- **D1–D5** arriba, con recomendación en cada una salvo D3 (necesita un documento externo) y D5
  (la responde el contador del cliente).
- ~~¿La Fase 6 entra en esta ventana o se difiere?~~ — **Respondida:** entraron
  A6.1 (IVA sobre la comisión + tarifa por sucursal) y A6.3 (revalidación mensual
  de CFDI ya conciliados), que son las dos con consecuencia fiscal directa. A6.4
  (pago parcial de factura) se difiere; A6.2 y A6.5 siguen bloqueadas.
