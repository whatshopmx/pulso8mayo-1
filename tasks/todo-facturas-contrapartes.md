 # TODO: Facturas y contrapartes — cerrar la cadena de "a quién le debo"

Plan: `tasks/plan-facturas-contrapartes.md`

Convenciones del repo:
- Dinero en centavos (integer). Scoping por `companyId`/`branchId`, siempre desde la sesión.
- Verificación base: `pnpm run build` limpio.
- Specs contra la DB de desarrollo real. Datos etiquetados `[E2E]`.
- Copy de usuario en español; `messages/es.json` es la fuente.
- Última migración aplicada: `0078_blue_peter_parker.sql`.

**Orden recomendado:** Fase 1 primero y sola (es un agujero abierto). Fase 2 después de que
cierre F1.2 de `todo-finance-module-gaps.md` y de resolver D3. Fases 3, 4 y 5 en paralelo.

---

## Fase 1: Cerrar el bypass de tesorería (P0)

> **Por qué es P0.** `TreasuryService.addItemToRun` (`treasury-service.ts:103`) valida cuenta
> CLABE verificada dentro de `if (itemType === 'INVOICE')` y, adentro, dentro de
> `if (invoice.supplierId)` (línea 123). El enum tiene cinco valores
> (`schema/treasury.ts:71`): `INVOICE`, `PAYROLL`, `TAXES`, `PETTY_CASH_REIMBURSEMENT`, `OTHER`.
> `TAXES`, `PETTY_CASH_REIMBURSEMENT` y `OTHER` **no se validan en absoluto** — ni siquiera se
> comprueba que el `referenceId` exista o sea del tenant. Y `app/api/finance/treasury/runs/[id]/items/route.ts:10`
> acepta `z.enum(paymentRunItemTypeEnum.enumValues)` directo del cliente.
>
> Es decir: `POST` con `{ itemType: "OTHER", referenceId: <cualquier uuid>, amountCents: <lo que sea> }`
> entra al lote de pago. Toda la Fase 1 de `plan-finance-module-gaps.md` — la verificación de
> titularidad por CEP, la segregación de funciones, el bloqueo de tesorería — se rodea cambiando
> una cadena en el body.
>
> La UI hoy solo manda `INVOICE` y `PAYROLL`, así que no hay explotación en curso. Pero el
> control es de API, no de UI, y en cuanto la Fase 2 agregue `EXPENSE` la superficie crece.

- [ ] **G1.1** `assertCounterpartyPayable` — validación exhaustiva por `itemType`
  - **Descripción:** Extraer la regla de contraparte de `addItemToRun` a una función única que
    resuelve, para cada tipo de partida, quién es la contraparte y si tiene cuenta verificada.
    Un `switch` **exhaustivo** sobre `paymentRunItemTypeEnum.enumValues` con `default: throw` —
    el punto no es cubrir los cinco tipos de hoy, es que agregar el sexto sin declarar su regla
    reviente en build en vez de abrir un hueco callado.
    Los tipos que legítimamente no tienen contraparte bancaria en Pulso (`PAYROLL` paga por
    layout de nómina, `TAXES` por línea de captura) **declaran** que no la requieren; no caen
    por omisión.
  - **Acceptance criteria:**
    - [ ] `INVOICE` → contraparte vía `invoices.supplierId`; **si es null, se rechaza** (hoy pasa)
    - [ ] `PAYROLL` → valida que la corrida exista y sea del tenant; sin contraparte bancaria
    - [ ] `TAXES` → sin contraparte bancaria, pero con `referenceId` verificable o nota obligatoria
    - [ ] `PETTY_CASH_REIMBURSEMENT` → contraparte = payee del reembolso; exige cuenta verificada
    - [ ] `OTHER` → **rechazado** salvo que se declare qué es; un cajón de sastre en un lote de
          pago es el bypass, no un caso de uso
    - [ ] `default:` con `never` exhaustivo — un valor nuevo del enum no compila sin su regla
    - [ ] El mensaje de rechazo nombra la contraparte y qué falta, igual que el actual
          (`treasury-service.ts:135`)
  - **Verification:** Script tsx: intentar agregar cada `itemType` con contraparte sin verificar
    → los cinco rechazados con mensaje propio. Con contraparte verificada → aceptados.
  - **Dependencies:** None
  - **Files:** `lib/services/treasury-service.ts`
  - **Scope:** M

- [ ] **G1.2** Validar existencia y pertenencia al tenant del `referenceId`
  - **Descripción:** Hoy `addItemToRun` no recibe `companyId` y no lo verifica en ninguna rama.
    Una factura de otra empresa con su `id` conocido entra al lote. La firma pasa a recibir el
    tenant de la sesión y cada rama resuelve su referencia con `companyId` en el `where`.
  - **Acceptance criteria:**
    - [ ] La firma incluye `companyId`, tomado de la sesión en la ruta, nunca del body
    - [ ] `referenceId` inexistente → 404 con mensaje claro
    - [ ] `referenceId` de otra empresa → mismo 404, sin filtrar que existe
    - [ ] El `amountCents` del body se **ignora** para facturas y gastos: se lee del documento.
          Un monto que viene del cliente en un lote de pago es dinero declarado por quien paga
    - [ ] El lote y la partida quedan en la misma transacción que la actualización de
          `totalAmountCents` (hoy son dos escrituras sueltas, líneas 152-170)
  - **Verification:** Script tsx cross-tenant: partida de la empresa B rechazada desde la A.
    Body con `amountCents` inflado → se persiste el monto del documento, no el del body.
  - **Dependencies:** G1.1
  - **Files:** `lib/services/treasury-service.ts`,
    `app/api/finance/treasury/runs/[id]/items/route.ts`
  - **Scope:** M

- [ ] **G1.3** Spec del bypass
  - **Descripción:** El valor de la fase es negativo — que algo *no* se pueda hacer. El spec
    prueba cada camino de evasión explícitamente, porque una regresión aquí es silenciosa.
  - **Acceptance criteria:**
    - [ ] Un caso por `itemType`, todos rechazados sin contraparte verificada
    - [ ] Factura con `supplierId` null rechazada
    - [ ] `referenceId` cross-tenant rechazado
    - [ ] `amountCents` del body distinto al del documento → se persiste el del documento
    - [ ] Datos `[E2E]`, limpiados por `tests/support/db.ts`
  - **Verification:** `pnpm exec playwright test tests/tesoreria-bypass.spec.ts`
  - **Dependencies:** G1.1, G1.2
  - **Files:** `tests/tesoreria-bypass.spec.ts` (new), `tests/support/db.ts`
  - **Scope:** S

### ☑ Checkpoint: no se puede rodear la CLABE (after G1.1–G1.3)
- [ ] Ningún `itemType` entra al lote sin una regla declarada explícitamente
- [ ] `referenceId` de otra empresa rechazado
- [ ] Agregar un valor al enum sin su regla **no compila**
- [ ] Revisar que no haya partidas `OTHER`/`TAXES` en lotes abiertos antes de shipear
- [ ] `pnpm run build` limpio

---

## Fase 2: El payee se puede pagar

> **Es la "Fase 2" de `plan-payees-contrapartes.md`**, marcada ahí como *"requiere aprobación
> explícita"* (`todo-payees-contrapartes.md:84`). Este tracker la ejecuta.
>
> **El problema:** `supplier_bank_accounts.supplier_id` es `NOT NULL` referenciando `suppliers`
> (`schema.ts:844`). `suppliers` es 100% una entidad de inventario — 3-way match, SKUs,
> reclamaciones de mercancía. La renta, la luz y el contador viven en `payees` y por lo tanto **no
> pueden tener cuenta bancaria**. El puente existente va en el sentido contrario
> (`suppliers.payee_id`, `schema.ts:808`): sirve para que una factura de mercancía se agrupe por
> contraparte, no para que un payee puro cobre.
>
> ⚠️ **Depende de F1.2 de `todo-finance-module-gaps.md`** (el diálogo de verificación de CLABE).
> Generalizar la tabla mientras la UI de verificación está a medias deja las dos cosas a medias.
>
> ⚠️ **Depende de D3** del plan: quién puede registrarle CLABE a un payee. Hoy cualquiera que
> capture un gasto puede crear un payee con el quick-create del formulario. Si registrar cuenta
> hereda ese permiso, la segregación de la Fase 1 de CLABE se pierde por la puerta de atrás.

- [ ] **G2.1** Migración: `payee_id` en `supplier_bank_accounts`
  - **Descripción:** `supplier_id` pasa a nullable, se agrega `payee_id` nullable con FK a
    `payees`, más CHECK de que exactamente uno esté presente. **No se toca** el cifrado, el HMAC,
    ni ninguna columna de verificación — la migración es puramente de referencia.
    El índice único parcial de "una sola cuenta verificada activa por contraparte" tiene que
    cubrir las dos columnas; hoy está sobre `supplier_id`.
  - **Acceptance criteria:**
    - [ ] `supplier_id` nullable; `payee_id` nullable con FK a `payees.id`
    - [ ] `CHECK ((supplier_id IS NOT NULL) <> (payee_id IS NOT NULL))` — exactamente una
    - [ ] Verificar antes de aplicar: `SELECT count(*) FROM supplier_bank_accounts WHERE supplier_id IS NULL`
          debe dar 0, o el CHECK falla al crearse
    - [ ] El índice único parcial de cuenta verificada activa se replica para `payee_id`
    - [ ] El índice HMAC sigue siendo por `(company_id, clabe_hmac)` — la señal "dos contrapartes
          comparten CLABE" tiene que cruzar suppliers y payees, o se pierde justo al ampliarse
    - [ ] Migración aditiva, sin drops. Comentario en el esquema explicando por qué el nombre de
          la tabla ya no corresponde y por qué no se renombra
  - **Verification:** Revisar el SQL generado a mano antes de aplicar. `pnpm db:generate` →
    inspección → `pnpm db:migrate`. Confirmar que las filas existentes siguen legibles y que
    `getVerifiedBankAccountForPayment` sigue devolviendo lo mismo.
  - **Dependencies:** F1.2 de `todo-finance-module-gaps.md`
  - **Files:** `lib/db/schema.ts` (`supplierBankAccounts`, línea 841), `drizzle/0079_*.sql`
  - **Scope:** M

- [ ] **G2.2** Servicio de cuentas bancarias por contraparte
  - **Descripción:** `registerSupplierBankAccount`, `verifySupplierBankAccount`,
    `rejectSupplierBankAccount` y `getVerifiedBankAccountForPayment` pasan a aceptar una
    contraparte discriminada `{ kind: 'SUPPLIER' | 'PAYEE', id }` en vez de `supplierId` suelto.
    La lógica de cifrado, HMAC, segregación de funciones y máquina de estados **no cambia**.
  - **Acceptance criteria:**
    - [ ] Todas las funciones exportadas aceptan la contraparte discriminada
    - [ ] La validación de pertenencia al tenant aplica igual a payees que a suppliers
    - [ ] `SAFE_COLUMNS` (`supplier-bank-account-service.ts:79`) incluye `payeeId` y sigue sin
          exponer la CLABE en claro
    - [ ] La detección de CLABE duplicada por HMAC reporta la contraparte con su tipo:
          *"esta CLABE ya está registrada para el payee X"*
    - [ ] La segregación `verifiedBy !== registeredBy` aplica igual
    - [ ] Sin regresión: las llamadas existentes con supplier siguen funcionando
  - **Verification:** Script tsx: registrar cuenta a un payee → verificar con otro usuario →
    `VERIFIED`. Registrar la misma CLABE en un supplier → detectado como duplicada.
  - **Dependencies:** G2.1
  - **Files:** `lib/services/supplier-bank-account-service.ts`,
    `app/api/finance/supplier-bank-accounts/**`
  - **Scope:** M

- [ ] **G2.3** UI de CLABE acepta payees
  - **Descripción:** `/dashboard/finance/supplier-bank-accounts` hoy lista contrapartes desde
    `/api/inventory/suppliers`. Pasa a listar suppliers **y** payees, con el tipo visible en la
    fila — el tesorero necesita distinguir "Distribuidora de Carnes" de "Inmobiliaria del Norte"
    aunque ambas cobren.
  - **Acceptance criteria:**
    - [ ] El selector de contraparte incluye payees activos, etiquetados por tipo
    - [ ] El diálogo de verificación por CEP (F1.2) funciona igual para payee
    - [ ] La lista muestra el tipo de contraparte como columna
    - [ ] El permiso de registrar cuenta es el de D3, **no** el de crear payee
    - [ ] Copy en español, en `messages/es.json`
  - **Verification:** Manual: registrar CLABE a un payee sembrado, verificarla por CEP
  - **Dependencies:** G2.2, **D3 resuelta**
  - **Files:** `app/dashboard/finance/supplier-bank-accounts/page.tsx`,
    `components/finance/clabe-verification-dialog.tsx`
  - **Scope:** M

- [ ] **G2.4** `EXPENSE` en el lote de pago
  - **Descripción:** Nuevo valor del enum `payment_run_item_type`. Tesorería lista gastos
    aprobados, no pagados, con payee de CLABE verificada — el equivalente de
    `getUnpaidMatchedInvoices` para el mundo de gastos. La regla de contraparte se declara en el
    `switch` de G1.1, que por ser exhaustivo **obliga** a declararla.
    Ver **D1**: por ahora se filtra `paid_at IS NULL`; no se le agrega máquina de estados de pago
    a `operating_expenses`.
  - **Acceptance criteria:**
    - [ ] `EXPENSE` agregado al enum + migración
    - [ ] `getUnpaidApprovedExpenses(companyId, branchId?)` — solo `status` aprobado y
          `paid_at IS NULL`
    - [ ] La regla de contraparte para `EXPENSE` declarada en `assertCounterpartyPayable`
    - [ ] Gasto con payee sin CLABE verificada → rechazado con el mismo mensaje que una factura
    - [ ] Gasto **sin** payee (taxi, hielo) no aparece como candidato — no hay a quién transferir
    - [ ] La UI de tesorería muestra gastos y facturas en secciones distintas, no revueltos
    - [ ] Cerrar el lote marca `paid_at` en el gasto
  - **Verification:** Sembrar payee con CLABE verificada + gasto aprobado de $12,000 → aparece en
    tesorería, entra al lote, y al cerrar queda con `paid_at`. Con CLABE `PENDING` → rechazado.
  - **Dependencies:** G2.2, G1.1
  - **Files:** `lib/db/schema/treasury.ts`, `drizzle/`, `lib/services/treasury-service.ts`,
    `app/dashboard/finance/treasury/page.tsx`
  - **Scope:** M

### ☑ Checkpoint: se le puede pagar a la renta (after G2.1–G2.4)
- [ ] Un payee sin fila en `suppliers` registra CLABE y la verifica por CEP
- [ ] Dos contrapartes con la misma CLABE se detectan aunque una sea supplier y la otra payee
- [ ] Un gasto aprobado con payee de CLABE verificada entra a un lote de pago
- [ ] Un gasto con payee sin verificar es rechazado con el mismo mensaje que una factura
- [ ] `pnpm run build` limpio

---

## Fase 3: Una sola verdad por UUID fiscal

> **El problema:** hay dos tablas para el mismo comprobante y no se referencian.
> `invoices` (`schema.ts:2888`) la escribe `app/api/inventory/invoices/upload` con el XML
> completo, sus líneas y el 3-way match. `cfdi_recibidos` (`schema.ts:3254`) la escribe el cron
> del buzón SAT vía FiscalAPI, solo con metadata. Cada una tiene su propio campo único
> (`invoices.uuid`, `cfdi_recibidos.invoice_uuid`) pero **no hay FK ni dedupe entre tablas**:
> el mismo folio fiscal existe dos veces, como dos filas sin relación.
>
> Es exactamente el control de "detección de duplicados por UUID fiscal" que el diseño del módulo
> pide para no pagar dos veces la misma factura — roto por la propia arquitectura de ingesta.

- [ ] **G3.1** `cfdi_recibidos.invoice_id`
  - **Descripción:** Columna nullable con FK a `invoices.id`. Nullable a propósito: la mayoría de
    los CFDI del buzón nunca se van a subir a mano (la luz, el teléfono), y forzar una fila en
    `invoices` para cada uno metería comprobantes sin líneas ni recepción a la tabla del 3-way
    match. Null significa "solo existe en el buzón", que es un estado legítimo.
  - **Acceptance criteria:**
    - [ ] Migración aditiva con FK
    - [ ] Comentario en el esquema explicando qué significa null y por qué no se fusionan
    - [ ] `pnpm run build` limpio
  - **Dependencies:** None
  - **Files:** `lib/db/schema.ts` (`cfdiRecibidos`), `drizzle/`
  - **Scope:** S

- [ ] **G3.2** Dedupe bidireccional por UUID
  - **Descripción:** Las dos rutas de ingesta consultan la otra tabla antes de insertar.
    Al subir un XML cuyo UUID ya está en el buzón: se crea la fila en `invoices` (necesaria para
    el 3-way match) y se ancla `cfdi_recibidos.invoice_id`. Al bajar del buzón un UUID que ya
    está en `invoices`: se ancla en vez de dejarlo `SIN_MATCH`, y se marca `CONCILIADA`.
  - **Acceptance criteria:**
    - [ ] Upload de XML con UUID ya en buzón → ancla, no duplica, y avisa en la respuesta
    - [ ] Sync de buzón con UUID ya en `invoices` → ancla y marca `CONCILIADA`
    - [ ] El anclaje es idempotente: re-sincronizar la misma ventana no cambia nada
    - [ ] Un CFDI anclado hereda del `invoices` su proveedor y OC, sin recalcular el matcher
    - [ ] El resumen de `persistirYConciliar` cuenta los anclados aparte de los conciliados
  - **Verification:** Script tsx en las dos direcciones; correr el sync dos veces y confirmar
    que el segundo no muta nada.
  - **Dependencies:** G3.1
  - **Files:** `lib/services/cfdi-recibidos-service.ts`,
    `app/api/inventory/invoices/upload/route.ts`
  - **Scope:** M

- [ ] **G3.3** Fix del corte prematuro en `conciliarContraparte`
  - **Descripción:** `cfdi-recibidos-service.ts:120` busca proveedor por RFC; si lo encuentra,
    intenta OCs y **retorna pase lo que pase** (línea ~148). Solo si *no* hay proveedor intenta
    payees y gastos. Consecuencia: una factura de un proveedor registrado que corresponde a un
    gasto operativo — no a una OC — nunca concilia, aunque el gasto exista con el monto exacto.
    Con `suppliers.payee_id` ya en el esquema, el proveedor también puede tener gastos a su
    nombre, así que el caso no es teórico.
  - **Acceptance criteria:**
    - [ ] La cascada continúa: proveedor → OC → **gasto del payee ligado al proveedor** → payee
          directo → gasto del payee
    - [ ] Se conserva la contraparte encontrada aunque no cuadre ningún documento
          (`conciliada: false` con `supplierId` poblado, como hoy)
    - [ ] La tolerancia de ±$0.01 no cambia
    - [ ] Un caso de prueba por rama de la cascada
  - **Verification:** Script tsx con proveedor + gasto del mismo monto y ninguna OC que cuadre →
    concilia contra el gasto (hoy no).
  - **Dependencies:** None
  - **Files:** `lib/services/cfdi-recibidos-service.ts`
  - **Scope:** S

- [ ] **G3.4** El dashboard fiscal muestra el enlace
  - **Descripción:** En `/dashboard/finance/fiscal`, un CFDI anclado muestra su factura y el
    estado del 3-way match. Un CFDI del buzón sin factura muestra "solo buzón", que es distinto
    de "sin match".
  - **Acceptance criteria:**
    - [ ] Columna de factura ligada con enlace a `/dashboard/inventory/invoices`
    - [ ] Estado de 3-way match visible cuando hay factura
    - [ ] "Solo buzón" ≠ "sin match": son dos estados distintos y se ven distinto
    - [ ] Respeta el alcance de sucursal del rol
  - **Verification:** Manual con un CFDI anclado y otro solo de buzón
  - **Dependencies:** G3.2
  - **Files:** `app/dashboard/finance/fiscal/page.tsx`,
    `lib/services/cfdi-recibidos-service.ts` (lectura del dashboard, línea ~199)
  - **Scope:** S

### ☑ Checkpoint: sin doble verdad (after G3.1–G3.4)
- [ ] Subir el XML de un CFDI que ya está en el buzón ancla, no duplica
- [ ] Bajar del buzón un CFDI ya subido a mano ancla, no duplica
- [ ] Factura de proveedor registrado que corresponde a un gasto concilia
- [ ] `pnpm run build` limpio

---

## Fase 4: La orden de servicio entra a cuentas por pagar

> **El problema:** `service_orders` (`schema/service-orders.ts:61`) tiene `amount`,
> `service_provider_id`, `cost_center_id`, `scheduled_date` y firma de conformidad — todo lo que
> hace falta para ser un compromiso de pago. Pero `accounts-payable-service.ts` solo lee
> `invoices` (línea 94) y `operating_expenses` (línea 117). Una OS autorizada de $30,000 al
> proveedor de mantenimiento **no existe** para cuentas por pagar, ni para el flujo de efectivo,
> ni para el lote de pago.
>
> Y `service_providers` (`schema/equipment.ts:335`) tiene `taxId` pero **no** `payee_id` — es la
> única de las tres entidades de contraparte que no llegó al puente que
> `plan-proveedores-unificados.md` construyó para `suppliers`.
>
> ⚠️ **Depende de D2**: si la OS entra a CxP con o sin conformidad firmada.

- [ ] **G4.1** `service_providers.payee_id`
  - **Descripción:** Puente simétrico al `suppliers.payee_id` que ya existe (`schema.ts:808`).
    Nullable, con acción de vinculación en el catálogo — el mismo patrón que la Task C2 de
    `plan-proveedores-unificados.md`, que ya está implementada para suppliers y sirve de molde.
  - **Acceptance criteria:**
    - [ ] Columna nullable con FK a `payees.id` + migración aditiva
    - [ ] Acción "vincular contraparte" en el catálogo de proveedores de servicio
    - [ ] Sugerencia automática por RFC cuando `service_providers.tax_id` coincide con un payee —
          sugerencia, no vinculación automática: dos RFC iguales pueden ser un error de captura
    - [ ] Proveedor sin payee vinculado sigue funcionando en todo lo demás
  - **Dependencies:** None
  - **Files:** `lib/db/schema/equipment.ts`, `drizzle/`,
    `app/dashboard/equipment/compliance/service-orders/`
  - **Scope:** S

- [ ] **G4.2** CxP lee órdenes de servicio
  - **Descripción:** Tercera fuente en `accounts-payable-service.ts`, con el mismo shape de
    `PayableItem` que ya usan facturas y gastos. Vencimiento por `scheduled_date`; contraparte
    por `service_providers.payee_id`, cayendo al nombre del proveedor cuando no hay payee — el
    mismo fallback `payeeName ?? label` que ya usan los gastos.
  - **Acceptance criteria:**
    - [ ] OS autorizadas y no pagadas aparecen como `PayableItem`
    - [ ] Agrupan por contraparte real cuando hay payee vinculado
    - [ ] Conformidad firmada visible en el item (**D2**)
    - [ ] Los buckets de vencimiento y `missingDueDateCount` incluyen OS sin regresión
    - [ ] OS sin monto no aparece — no se estima
    - [ ] Aparecen también en el flujo de efectivo proyectado (`cash-flow-service.ts`)
  - **Verification:** Sembrar OS autorizada de $30,000 con proveedor vinculado a payee → aparece
    en CxP agrupada por contraparte y en el flujo por su `scheduled_date`.
  - **Dependencies:** G4.1
  - **Files:** `lib/services/accounts-payable-service.ts`,
    `lib/services/accounts-payable-types.ts`, `lib/services/cash-flow-service.ts`
  - **Scope:** M

- [ ] **G4.3** El matcher del buzón intenta órdenes de servicio
  - **Descripción:** `conciliarContraparte` gana una rama de OS, con `matched_service_order_id`
    en `cfdi_recibidos`. Es la cuarta rama de la cascada que G3.3 arregla; hacerla después evita
    tocar la misma función dos veces.
  - **Acceptance criteria:**
    - [ ] Columna `matched_service_order_id` + FK + migración
    - [ ] La cascada intenta OS por RFC del proveedor de servicio + monto ±$0.01
    - [ ] El dashboard fiscal muestra la OS conciliada igual que muestra la OC
  - **Dependencies:** G4.1, G3.3
  - **Files:** `lib/db/schema.ts` (`cfdiRecibidos`), `drizzle/`,
    `lib/services/cfdi-recibidos-service.ts`
  - **Scope:** S

- [ ] **G4.4** OS pagable desde tesorería
  - **Descripción:** `SERVICE_ORDER` como valor del enum de partidas, con su regla declarada en
    el `switch` exhaustivo de G1.1. Exige conformidad firmada y CLABE verificada del payee del
    proveedor de servicio (**D2**).
  - **Acceptance criteria:**
    - [ ] `SERVICE_ORDER` en el enum + migración
    - [ ] Regla declarada en `assertCounterpartyPayable`: conformidad firmada + CLABE verificada
    - [ ] OS sin conformidad firmada → rechazada con mensaje que dice qué falta
    - [ ] Proveedor de servicio sin payee vinculado → rechazado; el mensaje dice cómo vincularlo
    - [ ] Cerrar el lote marca la OS como pagada
  - **Verification:** OS con conformidad y CLABE verificada entra al lote; sin conformidad, no.
  - **Dependencies:** G4.2, G1.1, **D2 resuelta**
  - **Files:** `lib/db/schema/treasury.ts`, `lib/services/treasury-service.ts`,
    `app/dashboard/finance/treasury/page.tsx`
  - **Scope:** M

### ☑ Checkpoint: la OS es dinero visible (after G4.1–G4.4)
- [ ] Una OS autorizada de $30,000 aparece en CxP con el nombre del proveedor de servicio
- [ ] Aparece en el flujo de efectivo proyectado por su fecha programada
- [ ] Un CFDI del proveedor con ese monto concilia contra la OS
- [ ] `pnpm run build` limpio

---

## Fase 5: Cerrar el enlace gasto ↔ comprobante

> **El problema:** `operating_expenses.invoice_id` existe en el esquema (`schema.ts:3311`),
> `expense-service.ts:210` lo persiste y el zod de `app/api/expenses/route.ts:36` lo acepta —
> pero `components/finance/expense-form.tsx` **no tiene el campo**. Grep no encuentra ni
> `invoiceId` ni "factura" en el formulario. En la práctica la columna siempre es null.
>
> Y el único lugar que inserta en `invoices` es `/api/inventory/invoices/upload`, el flujo de
> mercancía, que nunca liga de vuelta a un gasto.

- [ ] **G5.1** Captura de comprobante en el formulario de gasto
  - **Descripción:** El formulario permite ligar el gasto a un CFDI ya en el sistema — buscando
    por UUID, RFC del emisor o monto entre los `cfdi_recibidos` del buzón sin conciliar. Ligarlo
    escribe el enlace canónico (`operating_expenses.invoice_id`, ver A6 del plan) y marca el CFDI
    como conciliado.
    **No sustituye a `evidence_url`**: la foto del ticket sigue siendo obligatoria para los
    gastos sin CFDI (hielo, ferretería, taxi, plomero), que son la mayoría en sucursal.
  - **Acceptance criteria:**
    - [ ] Buscador de CFDI del buzón por UUID, RFC o monto, filtrado al tenant
    - [ ] Al ligar, el CFDI queda `CONCILIADA` con `matched_expense_id`
    - [ ] Ligar un CFDI ya conciliado con otro gasto → rechazado con mensaje que nombra el gasto
    - [ ] El campo es opcional; los gastos sin CFDI se capturan igual que hoy
    - [ ] La foto del ticket sigue siendo obligatoria donde ya lo era
  - **Verification:** Manual: gasto de CFE ligado al CFDI del buzón; intentar ligar el mismo CFDI
    a un segundo gasto → rechazado.
  - **Dependencies:** G3.2
  - **Files:** `components/finance/expense-form.tsx`, `app/api/expenses/route.ts`,
    `lib/services/expense-service.ts`
  - **Scope:** M

- [ ] **G5.2** El matcher del buzón escribe el enlace canónico
  - **Descripción:** Cuando `conciliarContraparte` encuentra un gasto, hoy solo escribe
    `cfdi_recibidos.matched_expense_id`. Pasa a escribir también
    `operating_expenses.invoice_id` — el enlace que CxP y tesorería leen. Sin esto, el match
    automático se ve en el dashboard fiscal y en ningún otro lado.
  - **Acceptance criteria:**
    - [ ] El match automático deja el gasto ligado, no solo marcado
    - [ ] No sobrescribe un enlace puesto a mano — el humano gana sobre el matcher
    - [ ] Idempotente: re-sincronizar no cambia enlaces existentes
  - **Verification:** Script tsx: sync con gasto que cuadra → el gasto queda ligado.
  - **Dependencies:** G5.1
  - **Files:** `lib/services/cfdi-recibidos-service.ts`
  - **Scope:** S

- [ ] **G5.3** Gastos sin comprobante fiscal, visibles
  - **Descripción:** Lista de gastos deducibles por encima de un umbral sin CFDI ligado. El
    valor no es la alerta, es el paquete: el contador pide justo esto cada mes y hoy sale de
    revisar fotos de tickets una por una.
  - **Acceptance criteria:**
    - [ ] Lista filtrable por sucursal y mes, con monto total sin respaldo
    - [ ] Umbral configurable por tenant; sin configurar, no molesta
    - [ ] Categorías donde el CFDI no aplica se excluyen — no se alerta de lo que no puede tener
          comprobante
    - [ ] Exportable, para que el contador lo reciba sin pedir capturas de pantalla
  - **Verification:** Manual con gastos con y sin CFDI ligado
  - **Dependencies:** G5.1
  - **Files:** `app/dashboard/finance/fiscal/page.tsx`, `lib/services/expense-service.ts`
  - **Scope:** M

### ☑ Checkpoint: el gasto tiene respaldo (after G5.1–G5.3)
- [ ] Un gasto se liga a un CFDI desde el formulario, sin salir de la pantalla
- [ ] El match automático del buzón deja el gasto ligado, no solo marcado
- [ ] Los gastos deducibles sin CFDI son una lista, no una ausencia
- [ ] `pnpm run build` limpio

---

### ☑ Checkpoint: Complete (after all phases)
- [ ] `pnpm run build && pnpm run lint` limpios
- [ ] Cada fase con al menos un spec de Playwright
- [ ] Recorrido manual end-to-end:
  - [ ] Ningún `itemType` entra a un lote de pago sin regla declarada
  - [ ] Payee con CLABE verificada por CEP → su gasto aprobado entra al lote
  - [ ] CFDI del buzón que ya se subió a mano queda anclado, no duplicado
  - [ ] OS autorizada aparece en CxP y en el flujo proyectado
  - [ ] Gasto de CFE ligado a su CFDI; los gastos sin comprobante, listados

---

## Notas de paralelización

- **Fase 1 va sola y primero.** Es un agujero abierto en la ruta de pago; las demás son enlaces
  faltantes. Además su `switch` exhaustivo es la infraestructura de la que cuelgan G2.4 y G4.4.
- **Fase 2 es la que más riesgo carga** — toca la tabla de CLABE cifrada. No empezar hasta que
  F1.2 de `todo-finance-module-gaps.md` esté cerrada y D3 resuelta.
- Fases 3, 4 y 5 son independientes entre sí; G4.3 se hace después de G3.3 solo para no tocar
  `conciliarContraparte` dos veces.
- Las migraciones (G2.1, G3.1, G4.1, G4.3, G2.4, G4.4) tocan tablas distintas y no chocan, pero
  se numeran secuencialmente a partir de `0079`.
