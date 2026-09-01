# Implementation Plan: Facturas y contrapartes — cerrar la cadena de "a quién le debo"

> **Escrito contra el código, no contra el diseño** (2026-08-31). Cada afirmación de este
> documento se verificó archivo por archivo; las que resultaron falsas durante la auditoría
> quedan anotadas en § Premisas descartadas.

## Overview

El módulo de finanzas tiene cuatro entidades de contraparte y dos tablas de factura que no se
conocen entre sí. El síntoma que se ve desde la UI es "no aparecen las facturas de los payees ni
de las órdenes de servicio". La causa raíz es más profunda y de distinta naturaleza en cada caso:

1. **Un bypass abierto en tesorería (P0).** `addItemToRun` valida CLABE verificada **solo** para
   `itemType === 'INVOICE'` y **solo** si la factura trae `supplierId`. Los otros cuatro tipos del
   enum entran al lote de pago sin ninguna validación, y la API los acepta directo del cliente.
   Toda la máquina antifraude de la Fase 1 de `plan-finance-module-gaps.md` se rodea con un
   `itemType` distinto.
2. **El payee no es pagable.** `payees` es la contraparte universal del módulo, pero no puede
   tener cuenta bancaria (`supplier_bank_accounts.supplier_id` es `NOT NULL`) ni existe un tipo
   de partida de pago para un gasto. La renta y la luz — los gastos operativos más grandes según
   el propio comentario del esquema — no pueden pagarse desde el sistema.
3. **Dos tablas de CFDI sin FK entre ellas.** `invoices` (subida manual, 3-way match) y
   `cfdi_recibidos` (buzón SAT) modelan el mismo comprobante y no se referencian. El mismo UUID
   fiscal puede existir en las dos como filas independientes: exactamente el duplicado que el
   control de "detección de duplicados por UUID" existe para prevenir.
4. **La orden de servicio no llega a CxP.** `service_orders` tiene `amount` y
   `serviceProviderId`, pero CxP solo lee `invoices` y `operating_expenses`. Una OS de $30,000 a
   un proveedor de mantenimiento es invisible para cuentas por pagar, para el flujo de efectivo y
   para el lote de pago.
5. **Un campo huérfano y un matcher con corte prematuro.** `operating_expenses.invoice_id` existe
   y el servicio lo acepta, pero ningún formulario lo llena. Y `conciliarContraparte` se corta al
   encontrar proveedor: si el RFC emisor es de un `supplier` pero el monto no cuadra con ninguna
   OC, nunca intenta gastos.

Los gaps se ordenan por daño, no por cercanía al síntoma. El síntoma que reportó el usuario
(gaps 2 a 5) se atiende en las fases 2 a 5; el gap 1 no se ve desde la UI y es el único que
puede sacar dinero hoy.

## Estado verificado del módulo

Lo que **ya existe** y no hay que construir:

| Capacidad | Dónde vive | Nota |
|---|---|---|
| 3-way match completo (OC ↔ recepción ↔ factura) | `lib/services/invoice-matching-service.ts` (537 líneas) | Con notas de crédito, reclamaciones y aprobación de excepción |
| Factura ↔ orden de compra | `lib/db/schema.ts:2888` (`invoices.purchase_order_id`) | Más `receiving_report_id`; el enlace mejor construido del módulo |
| Buzón fiscal SAT | `lib/services/cfdi-recibidos-service.ts`, `app/api/fiscal/cfdi-recibidos/sync` | Descarga masiva vía FiscalAPI, upsert idempotente por UUID |
| Conciliación CFDI → proveedor/payee | `cfdi-recibidos-service.ts:120` (`conciliarContraparte`) | Por `taxId` del emisor + monto ±$0.01 |
| Contraparte universal `payees` | `lib/db/schema.ts:3213` | Con índice antifragmentación `(companyId, lower(name))` |
| Puente `suppliers` → `payees` | `lib/db/schema.ts:808` (`suppliers.payee_id`) | Ya implementado por `plan-proveedores-unificados.md` |
| `service_orders.service_provider_id` | `lib/db/schema/service-orders.ts:82` | FK real a `service_providers`, ya implementada |
| CxP agrupada por contraparte real | `accounts-payable-service.ts:94-119` | `invoices` vía `suppliers.payeeId`, gastos vía `operatingExpenses.payeeId` |
| Verificación de titularidad de CLABE | `supplier-bank-account-service.ts` + `[id]/verify` | F1.1 de `plan-finance-module-gaps.md`, ya commiteada |
| Cifrado y HMAC de CLABE | `lib/db/schema.ts:846-861` | AES-256-GCM con DEK por tenant; HMAC para detectar cuenta compartida |

## Architecture Decisions

### A1. El pagable de un payee es un **gasto**, no una factura

`operating_expenses` ya tiene `payee_id`, `due_date`, `paid_at`, `status`, y ya está en CxP
(`accounts-payable-service.ts:117`) y en el flujo de efectivo (`cash-flow-service.ts:456`). El
documento por pagar de un payee **ya existe**; lo que falta es que tesorería lo pueda tomar.

Agregar `invoices.payee_id` sería crear un segundo camino para deberle a la misma contraparte, y
`invoices` está construida alrededor del 3-way match de mercancía (líneas de SKU, recepción,
reclamaciones). La renta no tiene recepción física ni SKU.

**Decisión: `EXPENSE` como nuevo valor de `payment_run_item_type`.** No se toca `invoices`.

### A2. La validación de contraparte se centraliza, no se copia

Hoy la regla "la contraparte tiene cuenta verificada y activa" vive inline en `addItemToRun`
(`treasury-service.ts:123`), acoplada a `supplierBankAccounts.supplierId`. Agregar payees
copiando ese bloque garantiza que la próxima contraparte lo copie mal.

Va una función única `assertCounterpartyPayable(itemType, referenceId)` que resuelve la
contraparte del documento y exige cuenta verificada, sea supplier o payee. Los tipos sin
contraparte bancaria (`PAYROLL`, `TAXES`) declaran explícitamente que no la requieren — pero
declaran, no caen por default.

**Ningún `itemType` puede pasar por omisión.** Un `switch` exhaustivo con `default: throw` es lo
que convierte "agregamos un tipo nuevo" en un error de compilación en vez de un agujero.

### A3. Cuentas bancarias: generalizar la tabla, no duplicarla

`supplier_bank_accounts` es la tabla más sensible del repo: CLABE cifrada con AES-256-GCM,
HMAC determinista por tenant para detectar cuentas compartidas, máquina de verificación por CEP.
Crear `payee_bank_accounts` en paralelo duplicaría toda esa criptografía y **rompería la señal de
fraude más útil que tiene**: "dos contrapartes comparten CLABE" deja de detectarse en cuanto las
contrapartes viven en dos tablas.

**Decisión:** `supplier_id` pasa a nullable, se agrega `payee_id` nullable, con CHECK de que
exactamente uno esté presente. El índice HMAC se mantiene por `(company_id, clabe_hmac)` para que
la detección de cuenta compartida cruce ambos tipos de contraparte.

**No se renombra la tabla.** El nombre queda mal, pero un rename de esta tabla toca el servicio,
las rutas, la UI, los seeds y las migraciones a cambio de cero comportamiento. Se documenta en el
esquema y se deja.

### A4. Las dos tablas de CFDI se enlazan, no se fusionan

`invoices` y `cfdi_recibidos` tienen dueños y ciclos de vida distintos: una la sube un humano con
el XML completo y sus líneas para el 3-way match; la otra la baja un cron del buzón SAT con solo
metadata. Fusionarlas obliga a que la fila del buzón cargue columnas de línea que nunca va a
tener, y a que el uploader manual pase por el estado de conciliación del buzón.

**Decisión:** `cfdi_recibidos.invoice_id` nullable con FK a `invoices`, más deduplicación por UUID
fiscal en las dos direcciones de ingesta. Una factura subida a mano que después aparece en el
buzón se ancla a la fila existente en vez de crear una segunda verdad.

### A5. La OS entra a CxP por su propio camino, sin inventarle una factura

Una orden de servicio autorizada con monto **ya es** un compromiso de pago. No hace falta que
alguien capture una factura para que aparezca en "a quién le debo" — hace falta que CxP la lea.
`accounts-payable-service` gana una tercera fuente, igual que ya tiene dos.

El puente de contraparte va `service_providers.payee_id`, simétrico a `suppliers.payee_id` que ya
existe (`schema.ts:808`). Así las tres entidades de contraparte convergen en `payees` y CxP
agrupa por beneficiario real sin casos especiales.

### A6. `operating_expenses.invoice_id` se conserva; el duplicado es el otro

Hay dos formas de ligar un gasto a un comprobante: `operating_expenses.invoice_id → invoices` y
`cfdi_recibidos.matched_expense_id → operating_expenses`. Son direcciones opuestas del mismo
enlace y no hay razón para tener las dos.

Se conserva `operating_expenses.invoice_id` — apunta a la tabla que tesorería paga y que CxP lee.
`matched_expense_id` se conserva **solo** como resultado del matcher automático del buzón, y su
efecto pasa a ser escribir el enlace canónico, no ser un enlace paralelo.

## Fases

Las fases 1 y 2 son secuenciales (la 2 depende de la infraestructura de validación de la 1).
Las fases 3, 4 y 5 son independientes entre sí y de las dos primeras.

### Fase 1 — Cerrar el bypass de tesorería (P0)

- [ ] **G1.1** `assertCounterpartyPayable` — validación exhaustiva por `itemType`
- [ ] **G1.2** Validar existencia y pertenencia al tenant del `referenceId`
- [ ] **G1.3** Spec del bypass: cada `itemType` sin contraparte verificada es rechazado

#### Checkpoint: no se puede rodear la CLABE
- [ ] Ningún `itemType` entra al lote sin pasar por una regla declarada explícitamente
- [ ] Un `referenceId` de otra empresa se rechaza, no se inserta
- [ ] Agregar un valor al enum sin declarar su regla **no compila**

### Fase 2 — El payee se puede pagar

- [ ] **G2.1** Migración: `payee_id` en `supplier_bank_accounts`, `supplier_id` nullable + CHECK
- [ ] **G2.2** Servicio de cuentas bancarias genérico por contraparte
- [ ] **G2.3** UI de CLABE acepta payees además de proveedores
- [ ] **G2.4** `EXPENSE` en `payment_run_item_type` + gastos aprobados visibles en tesorería

#### Checkpoint: se le puede pagar a la renta
- [ ] Un payee sin fila en `suppliers` registra CLABE y la verifica por CEP
- [ ] Dos contrapartes con la misma CLABE se detectan aunque una sea supplier y la otra payee
- [ ] Un gasto aprobado con payee de CLABE verificada entra a un lote de pago
- [ ] Un gasto con payee **sin** CLABE verificada es rechazado con el mismo mensaje que una factura

### Fase 3 — Una sola verdad por UUID fiscal

- [ ] **G3.1** `cfdi_recibidos.invoice_id` + FK
- [ ] **G3.2** Dedupe bidireccional por UUID en las dos rutas de ingesta
- [ ] **G3.3** Fix del corte prematuro en `conciliarContraparte`
- [ ] **G3.4** El dashboard fiscal muestra el enlace a la factura y su estado de 3-way match

#### Checkpoint: sin doble verdad
- [ ] Subir el XML de un CFDI que ya está en el buzón ancla, no duplica
- [ ] Bajar del buzón un CFDI ya subido a mano ancla, no duplica
- [ ] Factura de proveedor registrado que corresponde a un gasto concilia (hoy no)

### Fase 4 — La orden de servicio entra a cuentas por pagar

- [ ] **G4.1** `service_providers.payee_id` + puente
- [ ] **G4.2** CxP lee órdenes de servicio autorizadas como tercera fuente
- [ ] **G4.3** El matcher del buzón intenta órdenes de servicio
- [ ] **G4.4** OS pagable desde tesorería con la validación de la Fase 1

#### Checkpoint: la OS es dinero visible
- [ ] Una OS autorizada de $30,000 aparece en CxP con el nombre del proveedor de servicio
- [ ] Aparece en el flujo de efectivo proyectado por su fecha programada
- [ ] Un CFDI del proveedor de servicio con ese monto concilia contra la OS

### Fase 5 — Cerrar el enlace gasto ↔ comprobante

- [ ] **G5.1** Captura de comprobante fiscal en el formulario de gasto
- [ ] **G5.2** El matcher del buzón escribe el enlace canónico
- [ ] **G5.3** Alerta de gasto sin comprobante por encima de umbral

#### Checkpoint: el gasto tiene respaldo
- [ ] Un gasto puede ligarse a un CFDI desde el formulario, sin salir de la pantalla
- [ ] El match automático del buzón deja el gasto ligado, no solo marcado
- [ ] Los gastos deducibles sin CFDI son visibles como lista, no como ausencia

### Checkpoint: Complete
- [ ] `pnpm run build && pnpm run lint` limpios
- [ ] Cada fase con al menos un spec de Playwright
- [ ] Recorrido manual end-to-end

## Decisiones pendientes

**D1 — ¿Qué hace `EXPENSE` en el lote con un gasto ya pagado en efectivo?**
`operating_expenses` tiene `paid_at`, que hoy se llena cuando alguien registra que se pagó — sin
pasar por tesorería. Un gasto puede llegar a tesorería ya pagado. Opciones: (a) filtrar por
`paid_at IS NULL` al listar candidatos, que es barato y correcto para el flujo normal; (b) darle
al gasto su propia máquina de estados de pago como tiene `invoices` (`payment_status`), que es
más limpio pero toca el formulario, la lista y CxP.

Recomendación: **(a) en la Fase 2, (b) solo si aparece el caso de pago parcial.** El comentario de
`invoice_payment_status` en `schema.ts:2881` ya documenta por qué el pago parcial es un módulo y
no una columna; el mismo argumento aplica aquí.

**D2 — ¿La OS pagable requiere conformidad firmada?**
`service_orders` tiene `conformity_signed_by` / `conformity_signed_at`. Es el equivalente
funcional del 3-way match: la evidencia de que el servicio efectivamente se prestó. Si CxP incluye
OS **sin** conformidad, se está proyectando como deuda algo que quizá no se ejecutó; si las
excluye, el proveedor que factura por adelantado queda fuera.

Recomendación: **incluirlas en CxP con la conformidad como columna visible**, y exigir conformidad
firmada para entrar al lote de pago — el mismo patrón que `matchStatus` en facturas, donde CxP la
muestra y tesorería la exige.

**D3 — ¿Quién puede dar de alta la CLABE de un payee?**
El diseño del módulo dice "admin, tesorería (nunca gerente)" para CLABE de proveedor. Los payees
los puede crear hoy cualquiera que capture un gasto, con el quick-create del formulario
(`plan-payees-contrapartes.md` A5). Crear la contraparte y registrarle CLABE no pueden tener el
mismo permiso, o la segregación de la Fase 1 de CLABE se pierde por la puerta de atrás.

Recomendación: **crear payee sigue abierto; registrar cuenta bancaria hereda el permiso de
proveedor.** Sin decisión, la Fase 2 no debe shipear G2.3.

## Risks and Mitigations

| Riesgo | Impacto | Mitigación |
|---|---|---|
| La Fase 2 toca la tabla de CLABE cifrada | **Alto** | `supplier_id` pasa a nullable sin tocar cifrado, HMAC ni la máquina de verificación; migración aditiva, sin backfill |
| CHECK de "exactamente una contraparte" rechaza filas existentes | Alto | Todas las filas actuales tienen `supplier_id`; el CHECK se satisface por construcción. Verificar con `COUNT(*) WHERE supplier_id IS NULL` antes de aplicar |
| Cerrar el bypass rompe lotes de pago en curso | Medio | La validación aplica al insertar partidas, no a lotes ya cerrados; verificar que no haya partidas `OTHER`/`TAXES` vivas antes de shipear |
| El dedupe de UUID ancla dos comprobantes legítimamente distintos | Medio | El UUID fiscal SAT es único por comprobante por definición; si colisiona, el dato de origen ya está mal y hay que verlo, no silenciarlo |
| Meter OS a CxP infla la deuda proyectada con OS que no se ejecutaron | Medio | D2: conformidad visible en CxP y exigida en tesorería |
| El payee con CLABE se vuelve un catálogo paralelo de proveedores | Bajo | El puente a `payees` ya existe desde `suppliers` y ahora desde `service_providers`; la convergencia es hacia payee, no la divergencia |

## Overlap con otros planes

| Gap | Tracker | Estado |
|---|---|---|
| Verificación de titularidad de CLABE | `todo-finance-module-gaps.md` F1 | F1.1 commiteada, F1.2 en progreso — **la Fase 2 de este plan depende de que cierre** |
| CLABE generalizada a payees ("Fase 2" de payees) | `todo-payees-contrapartes.md:84` | Pendiente, marcado *"requiere aprobación explícita"* — **es G2.1–G2.3 de este plan** |
| `suppliers` como payees especializados ("Fase 3") | `todo-payees-contrapartes.md:85` | Pendiente — fuera de alcance aquí; este plan converge en `payees` sin fusionar entidades |
| `payeeName` en Flujo de Caja y Control Interno | `todo-payees-contrapartes.md:86` | Polish XS pendiente — se resuelve solo si se hace G4.2 |
| Unificación de proveedores / OS ↔ proveedor de servicio | `plan-proveedores-unificados.md` | **Completo** (69/69) — este plan construye encima, no lo repite |
| Autorizaciones de gasto por umbral | `todo-gastos-autorizaciones.md` | En progreso — G2.4 lee gastos aprobados, así que depende de que "aprobado" signifique algo |
| Control interno / segregación de funciones | `todo-fiscal-control-interno.md` T55 | Pendiente — D3 de este plan es un caso concreto de esa decisión |

## Premisas descartadas (no volver a proponerlas)

Verificadas como falsas durante la auditoría que originó este plan:

- ~~"Las órdenes de servicio no tienen FK real al proveedor"~~ — `service_orders.service_provider_id`
  existe (`schema/service-orders.ts:82`), la agregó `plan-proveedores-unificados.md` Fase B. Lo que
  falta no es la FK, es que CxP lea las OS y que el proveedor de servicio llegue a `payees`.
- ~~"Hay que agregar `payee_id` a `invoices` para que los payees tengan factura"~~ — el pagable del
  payee ya existe como `operating_expenses` con `payee_id`, `due_date` y presencia en CxP.
  Agregarlo a `invoices` crea dos caminos para la misma deuda. Ver A1.
- ~~"`suppliers` y `payees` están desconectados"~~ — `suppliers.payee_id` existe
  (`schema.ts:808`) y `accounts-payable-service.ts:96` ya lo usa para agrupar facturas por
  contraparte real.
- ~~"El gap más urgente es que no se ven las facturas de los payees"~~ — el gap más urgente es que
  `addItemToRun` deja pasar cuatro de cinco `itemType` sin validar nada. Ese no se ve desde la UI
  y es el único que puede sacar dinero hoy.
