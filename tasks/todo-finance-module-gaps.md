# TODO: Finance Module — Gap Closure

Plan: `tasks/plan-finance-module-gaps.md` (revisión 2)

Convenciones del repo:
- Dinero en centavos (integer). Scoping por `companyId`/`branchId`, siempre desde la sesión.
- Verificación base: `pnpm run build` limpio.
- Specs contra la DB de desarrollo real. Datos etiquetados `[E2E]`.
- Copy de usuario en español; `messages/es.json` es la fuente.

**Orden recomendado:** Fase 1 primero (desbloquea tesorería). Fases 2 y 3 en paralelo después.
Fases 4 y 5 **no se empiezan** hasta cerrar D1 y D2 del plan.

---

## Fase 1: Verificación de titularidad de CLABE (P0) — ✅ IMPLEMENTADA

> **Estado (2026-08-31).** F1.1, F1.2 y F1.3 hechas y verificadas. Commits
> `017b1b9` (servicio + ruta) y `0192cb2` (UI + specs) en la rama
> `feat/finance-clabe-verification`. Entregado:
>
> | Pieza | Dónde quedó |
> |---|---|
> | `verifySupplierBankAccount` + `VerifyResult` | `lib/services/supplier-bank-account-service.ts` |
> | `POST .../supplier-bank-accounts/[id]/verify` | ruta nueva, molde de `[id]/reject` |
> | `POST .../supplier-bank-accounts/evidence` | subida del CEP, ruta nueva |
> | `ClabeVerificationDialog` | `components/finance/clabe-verification-dialog.tsx` |
> | Botón + motivo de bloqueo en la tabla | `app/dashboard/finance/supplier-bank-accounts/page.tsx` |
> | 3 casos de servicio + 1 de UI | `tests/clabe-verificacion*.spec.ts` |
> | Fixture y limpieza `[E2E]` | `tests/support/db.ts` |
>
> **Cuidado con las líneas citadas abajo: ya no son las de hoy.** Mientras esta fase se
> implementaba, el tracker `todo-facturas-contrapartes.md` refactorizó
> `TreasuryService.addItemToRun` a firma por objeto con `companyId` obligatorio
> (`{ paymentRunId, companyId, itemType, referenceId, amountCents?, notes? }`) y movió el
> bloqueo por CLABE a `assertCounterpartyPayable`. `tests/clabe-verificacion.spec.ts` ya está
> adaptado a la firma nueva. El diagnóstico de abajo sigue siendo correcto en el fondo; los
> números de línea no.

> **Por qué es P0.** `treasury-service.addItemToRun` (línea 123) exige que la cuenta del
> proveedor esté en `VERIFIED` y activa antes de meter una factura a un lote de pago. Pero
> `supplier-bank-account-service.ts` solo exporta `registerSupplierBankAccount` (que siempre
> inserta en `PENDING_VERIFICATION`, línea 252), `rejectSupplierBankAccount` y
> `getVerifiedBankAccountForPayment`. **No existe ninguna función que ponga una cuenta en
> `VERIFIED`.** El único lugar del repo que escribe ese estado es `scripts/seed-01-foundation.ts:507`.
> En una instalación real ninguna factura puede entrar jamás a un lote de pago.
>
> **No hace falta migración.** Las columnas ya existen (`lib/db/schema.ts:884-889`) con el
> comentario `// --- Verificación de titularidad (el paso 3 llena esto; aquí solo vive) ---`.

- [x] **F1.1** `verifySupplierBankAccount` + ruta `POST /api/finance/supplier-bank-accounts/[id]/verify`
  - **Descripción:** La contraparte de `rejectSupplierBankAccount`. El tesorero manda $0.01 por
    SPEI desde su portal bancario, obtiene el CEP de Banxico, lo sube, y captura el nombre del
    titular que aparece ahí. El servicio compara ese nombre contra `accountHolderName` (el que
    declaró el proveedor al capturarse) y escribe `status = VERIFIED` con
    `verificationMethod = 'MANUAL_CEP'`, `verifiedAt`, `verifiedBy` y `verificationEvidenceUrl`.
    La comparación es asistida, no automática: el sistema muestra ambos nombres y su similitud,
    la persona confirma. Un fuzzy match que apruebe solo se puede engañar con "Servicios
    Gastronómicos SA" vs "Servicios Gastronomicos SAPI", que es exactamente el ataque.
  - **Acceptance criteria:**
    - [x] `verifySupplierBankAccount({ companyId, accountId, verifiedBy, holderNameFromCep, evidenceUrl })`
    - [x] Solo aplica a cuentas en `PENDING_VERIFICATION` y `active` — otra cosa es 404/400 claro
    - [x] **Segregación:** `verifiedBy !== registeredBy` o se rechaza. El esquema ya lo anticipa
          (`registered_by`: *"Quién capturó. El verificador tiene que ser alguien distinto."*).
          Mensaje explícito: quién capturó y por qué no puede verificar
    - [x] `evidenceUrl` obligatorio — sin CEP no hay verificación, igual que `reason` es
          obligatorio en `reject`
    - [x] La respuesta nunca incluye la CLABE en claro (usar `SAFE_COLUMNS`, como `reject`)
    - [x] La ruta usa `requirePermissionApi("settings", "update", { classification: "FINANCIAL", audit: {...} })`,
          igual que `[id]/reject/route.ts`
  - **No estaba en el criterio y hubo que hacerlo:** verificar **desplaza** a la cuenta verificada
    vigente del proveedor (baja lógica, en la misma transacción). El índice único parcial
    `supplier_bank_accounts_one_verified_active` no admite dos cuentas verificadas activas por
    proveedor, así que sin esto la primera verificación de un *cambio* de CLABE reventaba con un
    error de constraint. `verificationEvidenceUrl` guarda la llave durable de R2, no la URL
    presignada: ésta expira en una hora y el CEP tiene que seguir ahí cuando alguien audite.
  - **Verification:** Script tsx: registrar cuenta → verificar con el mismo usuario → error de
    segregación. Verificar con otro usuario → `VERIFIED` con timestamp y evidencia.
  - **Dependencies:** None
  - **Files:** `lib/services/supplier-bank-account-service.ts` (junto a `rejectSupplierBankAccount`,
    línea 295), `app/api/finance/supplier-bank-accounts/[id]/verify/route.ts` (new)
  - **Scope:** S

- [x] **F1.2** Diálogo de verificación en la UI de proveedores
  - **Descripción:** En `/dashboard/finance/supplier-bank-accounts`, las cuentas en
    `PENDING_VERIFICATION` ganan un botón "Verificar titularidad" junto al de rechazar que ya
    existe. El diálogo explica el procedimiento (mandar $0.01, bajar el CEP, subirlo), pide el
    archivo y el nombre del titular tal como aparece en el CEP, y muestra lado a lado el nombre
    declarado vs el capturado antes de dejar confirmar.
  - **Acceptance criteria:**
    - [x] Botón visible solo en cuentas `PENDING_VERIFICATION` y activas
    - [x] El diálogo muestra los pasos del procedimiento — el tesorero no debería tener que
          adivinar qué es un CEP
    - [x] Carga de archivo a R2 vía el flujo de evidencia existente
          (`POST /api/finance/supplier-bank-accounts/evidence`, con el fallback `local://` de
          `/api/expenses/evidence`). Ruta propia y no la de gastos: el permiso es
          `settings:update` clasificado FINANCIAL, y un CEP archivado bajo `expense-evidence` es
          invisible el día que alguien audite por qué se autorizó una cuenta
    - [x] Los dos nombres se muestran juntos antes del botón de confirmar; si no coinciden
          visiblemente, el botón primario es "Rechazar", no "Verificar"
    - [x] Al capturista de esa cuenta la UI le muestra el botón deshabilitado con el motivo,
          no un error después de intentarlo
  - **Verification:** Manual en `/dashboard/finance/supplier-bank-accounts` con una cuenta
    sembrada en `PENDING_VERIFICATION`
  - **Dependencies:** F1.1
  - **Files:** `app/dashboard/finance/supplier-bank-accounts/page.tsx`,
    `components/finance/clabe-verification-dialog.tsx` (new)
  - **Scope:** M

- [x] **F1.3** Spec del desbloqueo end-to-end
  - **Descripción:** El valor de la fase no es "se puede verificar", es "se puede pagar". El spec
    prueba la cadena completa: proveedor con factura conciliada + cuenta `PENDING` → la factura
    NO aparece en tesorería → se verifica la cuenta → la factura SÍ aparece y se puede agregar
    a un lote.
  - **Acceptance criteria:**
    - [~] Con cuenta `PENDING`: `addItemToRun` la rechaza con mensaje claro. **La primera mitad
          del criterio era falsa contra el código:** `getUnpaidMatchedInvoices` filtra por
          `match_status` y `payment_status` y no mira la cuenta bancaria, así que sí devuelve la
          factura. Y debe seguir haciéndolo: esconderle al tesorero una factura legítima porque
          falta verificar la CLABE le quita el aviso que necesita para ir a verificarla. El punto
          donde la regla se impone es `addItemToRun`, y es ahí donde el spec afirma
    - [x] Tras verificar: la factura aparece y entra al lote
    - [x] Cuenta `REJECTED` se comporta como `PENDING` (no paga) — y tampoco se puede resucitar
          verificándola
    - [x] Datos `[E2E]`, limpiados por `tests/support/db.ts`
    - [x] *(extra)* Verificar una cuenta nueva desplaza a la vigente sin dejar al proveedor sin
          cuenta pagable en ningún instante
  - **Verification:** `pnpm exec playwright test tests/clabe-verificacion.spec.ts`
  - **Dependencies:** F1.1
  - **Files:** `tests/clabe-verificacion.spec.ts` (new), `tests/support/db.ts`
  - **Scope:** S

### ☑ Checkpoint: se puede pagar (after F1.1–F1.3)
- [x] Una cuenta capturada hoy llega a `VERIFIED` sin tocar la base a mano
- [x] Quien capturó no puede verificar su propia captura
- [x] Factura de proveedor con CLABE verificada entra al lote de pago
- [x] `tests/clabe-verificacion.spec.ts` — 3 casos verdes sin servidor ni Inngest:
      `pnpm exec playwright test --no-deps --project=chromium tests/clabe-verificacion.spec.ts`.
      **Pendiente de volver a correr** tras el refactor de `addItemToRun` que llegó de otro
      tracker: el spec ya está adaptado a la firma nueva pero todavía no se ejecutó verde con ella
- [x] `tests/clabe-verificacion-ui.spec.ts` — verde contra un build (`npm run start`)
- [~] `pnpm run build` limpio — **corriendo la confirmación final.** Pasó (exit 0) con todo el
      código de F1 escrito; dos corridas posteriores fallaron y la causa **no era el código**:
      `Failed to compile — .next/dev/types/routes.d.ts:556 Unexpected keyword or identifier`,
      con el texto partido a media palabra (`ayoutRoute`). Es un archivo **generado por
      `next dev`**, y el `webServer` de Playwright lo estaba reescribiendo mientras `next build`
      lo tipaba. Es exactamente la trampa que documenta CLAUDE.md: `next dev` / `next start` y
      `next build` comparten `.next`. Receta: apagar todo servidor, `rm -rf .next`, y construir
      solo. `npx tsc --noEmit` sobre todo el proyecto —que no lee `.next`— estuvo limpio en todo
      momento
- [x] `npx tsc --noEmit` limpio sobre todo el proyecto, con todos los archivos de F1

---

## Fase 2: Dashboard de costo laboral — ✅ IMPLEMENTADA

> **Estado (2026-08-31).** F2.1 y F2.2 hechas. Entregado:
>
> | Pieza | Dónde quedó |
> |---|---|
> | `BranchLaborRatio` / `LaborCostReport` / `LaborCostSource` | `lib/services/labor-cost-types.ts` (nuevo, sin deps de runtime) |
> | `getLaborCostRatioByBranch` (costo × venta × sucursal) | `lib/services/labor-cost-service.ts` |
> | `GET /api/finance/labor-cost` | `app/api/finance/labor-cost/route.ts` |
> | `LaborCostTable` | `components/finance/labor-cost-table.tsx` |
> | Página + enlace en el índice de finanzas | `app/dashboard/finance/labor-cost/page.tsx`, `app/dashboard/finance/page.tsx` |
>
> **Dos desviaciones respecto al plan, ambas deliberadas:**
>
> 1. **El cálculo no vive en la ruta.** El plan la describía como "ruta delgada sobre
>    `getLaborCostByBranch`", pero ese servicio no conoce las ventas ni los nombres de
>    sucursal, y el ratio los necesita. El cruce quedó en `getLaborCostRatioByBranch`, dentro
>    del servicio, para no meter SQL en la ruta (convención de CLAUDE.md). Las ventas se leen
>    de `daily_sales_cuts` igual que el P&L, para que los dos tableros no discrepen en el
>    denominador.
> 2. **`resolveBranchScope`, no `enforceBranchScope`.** El segundo devuelve `null` tanto para
>    "ve toda la empresa" como para "está acotado pero no tiene sucursal asignada", y ese
>    segundo caso le mostraría la nómina del grupo entero a un GERENTE sin sucursal. Mismo
>    criterio que `/api/finance/pnl`, que ya había migrado por esta razón.
>
> Tampoco pasa por `pnl-service`: el P&L colapsa `CONTRACT_ONLY` en `DERIVED` y sustituye la
> nómina faltante por la constante sectorial. Las dos cosas borran justo la distinción que
> esta pantalla existe para mostrar.

> `labor-cost-service.getLaborCostByBranch` (línea 247) ya existe, con el mismo contrato de
> procedencia que el P&L (`MEASURED` / `CONTRACT_ONLY` / `SECTOR_DEFAULT` / `NO_DATA`). Los
> targets ya están en operating-config. Lo único que falta es exponerlo.
>
> **No incluye alerta de horas extra.** Esa depende de `LaborCalculator`, que hoy clasifica el
> turno completo como horas extra y devuelve cero horas ordinarias siempre
> (`labor-calculator.ts:277`). Ver PL4 de `plan-pnl-real.md`; construir la alerta sobre ese
> cálculo sería propagar el bug a WhatsApp.

- [x] **F2.1** `GET /api/finance/labor-cost`
  - **Descripción:** Ruta delgada sobre `getLaborCostByBranch`. Params: `from`, `to`, `branchId`
    opcional. Devuelve el arreglo de sucursales con costo, venta, ratio, `source` y el target
    del tenant para que el cliente no tenga que pedirlo aparte.
  - **Acceptance criteria:**
    - [x] `withTenantAuth` — `companyId` de la sesión, nunca del query
    - [x] Alcance de sucursal para `GERENTE` y `SUPERVISOR`: ven su sucursal, aunque pidan otra
          (con `resolveBranchScope`, fail-closed — ver desviación 2 arriba)
    - [x] Respuesta en el envelope `{ success, data }`
    - [x] Incluye `laborCostTargetPercent` y `laborCostWarnPercent` del tenant
    - [x] Rango sin datos devuelve las sucursales con `source: NO_DATA`, no un arreglo vacío
  - **Verification:** `curl` autenticado contra un rango con datos y otro sin datos
  - **Dependencies:** None
  - **Files:** `app/api/finance/labor-cost/route.ts` (new)
  - **Scope:** S

- [x] **F2.2** Página `/dashboard/finance/labor-cost`
  - **Descripción:** Tabla comparativa de sucursales: costo laboral, venta, ratio, y desviación
    contra el target. Semáforo con los umbrales del tenant, no con constantes locales. Cada
    renglón muestra su procedencia igual que el P&L — un ratio calculado sobre contrato y otro
    calculado sobre asistencia real no valen lo mismo y la UI no debe igualarlos.
  - **Acceptance criteria:**
    - [x] Accesible en `/dashboard/finance/labor-cost`, enlazada desde el índice de finanzas
    - [x] Semáforo: verde ≤ `laborCostTargetPercent`, amarillo hasta `laborCostWarnPercent`,
          rojo arriba
    - [x] Badge de procedencia por sucursal; `NO_DATA` se ve como vacío, no como 0%
    - [x] Selector de rango de fechas coherente con el resto de `/dashboard/finance`
    - [x] Respeta el alcance de sucursal del rol
  - **Verification:** Manual con 3 sucursales sembradas, una de ellas sin registros de asistencia
  - **Dependencies:** F2.1
  - **Files:** `app/dashboard/finance/labor-cost/page.tsx` (new),
    `components/finance/labor-cost-table.tsx` (new)
  - **Scope:** M

### ☑ Checkpoint: labor visible (after F2.1–F2.2)
- [x] Ratio costo laboral/venta por sucursal, con procedencia etiquetada
- [x] Semáforo contra el target del tenant, no contra una constante
- [x] `pnpm run build` limpio
- [x] Verificación manual con 3 sucursales (una sin asistencia capturada) — 14/14 checks

> **Verificación (2026-08-31).** Ejercitada contra la DB de desarrollo llamando a
> `getLaborCostRatioByBranch` directo (sin servidor ni Inngest). Las tres ramas de la escalera
> salen de cambiar sólo el rango de fechas: los 103 `shift_sessions` COMPLETED del seed están
> todos el 2026-08-28, así que cualquier otro rango con contratos vigentes ejercita
> `CONTRACT_ONLY` sin tocar los datos.
>
> | Escenario | Rango | Resultado |
> |---|---|---|
> | `MEASURED` | 2026-08-28 | Condesa 9.1%, Polanco 6.8%, Roma 8.9% — badge *Medido* |
> | `CONTRACT_ONLY` | 2026-08-01 → 08-20 | las 3 con badge *Plantilla*, cobertura 0%, horas extra 0 |
> | Sin cortes de venta | 2026-06-01 → 06-15 | venta y ratio en `null` → guion, **no 0%** |
> | `NO_DATA` | sucursal `[E2E]` sin contratos | badge *Sin datos*, ratio `null`, headcount 0, **presente en el arreglo** |
>
> El semáforo se pintó contra 18/22 (los valores reales de `tenant_operating_config` de la
> empresa demo), no contra el 28/32 por defecto: confirma que el objetivo sale del tenant.
>
> La sucursal `[E2E]` se creó y se borró; la DB quedó con las 3 sucursales originales.

---

## Fase 3: Presupuesto en gastos y patrón de faltantes

> **Corrección respecto a la versión 1.** `branchBudgets` **sí** está cableado — a órdenes de
> compra (`purchase-order-service.ts:565`), órdenes de servicio (`service-order-service.ts:510`)
> y approval-requests. `budget-service.ts` ya tiene `getBudget`, `getCommitted`,
> `checkBudgetAvailability`, topes de emergencia y sus tests. Lo que falta es el cableado con
> gastos, y el obstáculo real es de esquema: `branch_budgets` se llavea por `cost_center_id`
> (`schema/service-orders.ts:201`) y `operating_expenses` solo tiene `category`
> (`schema.ts:3307`). Sin resolver eso no hay "presupuesto por categoría" posible.

- [x] **F3.1** `cost_center_id` en `operating_expenses`
  - **Descripción:** Columna nullable con FK a `cost_centers`, más el selector en el formulario
    de gasto. Nullable a propósito: los gastos casuales que ya son nullable en `payee_id` por la
    misma razón (taxi, hielo, plomero) tampoco tienen centro de costo, y forzarlo haría que la
    gente elija cualquiera con tal de guardar. Un gasto sin centro de costo no consume
    presupuesto y se cuenta aparte.
  - **Acceptance criteria:**
    - [x] Migración aditiva con `pnpm db:generate` — sin drops, gastos existentes intactos
    - [x] Selector de centro de costo en el formulario, opcional y con opción de dejarlo vacío
    - [x] El listado de gastos permite filtrar por centro de costo
    - [x] `pnpm run build` limpio
  - **Verification:** Revisar el SQL generado; crear un gasto con y otro sin centro de costo
  - **Dependencies:** None
  - **Files:** `lib/db/schema.ts` (`operatingExpenses`, línea 3295), `drizzle/` (migración),
    `components/finance/expense-form.tsx`, `app/api/expenses/route.ts`
  - **Scope:** S

- [x] **F3.2** Consumo de presupuesto al crear o aprobar un gasto
  - **Descripción:** Reutilizar `checkBudgetAvailability(branchId, costCenterId, month, amount)`
    — la misma función que ya usan OC y OS, para que el presupuesto signifique lo mismo en los
    tres flujos. Al crear un gasto con centro de costo, se calcula el consumo del mes: ≥80%
    notifica WARNING, ≥100% notifica ALERT con el monto excedido. **No bloquea** — el gasto ya
    ocurrió, negarlo solo lo saca del sistema.
  - **Acceptance criteria:**
    - [x] Usa `checkBudgetAvailability` existente, no una segunda implementación
    - [x] ≥80% → notificación WARNING a ADMIN/GERENTE de esa sucursal
    - [x] ≥100% → notificación ALERT con el excedente en pesos
    - [x] Sin `branch_budgets` para ese (sucursal, centro de costo, mes): no notifica nada
    - [x] Gasto sin `cost_center_id`: no notifica, no rompe
    - [x] La notificación falla en silencio sin tumbar la creación del gasto (patrón de
          `checkCashVarianceAndAlertSafe`)
    - [x] El mes se deriva con la misma expresión que `budget-service` — no reinventar el
          `YYYY-MM` (ver `service-order-service.ts:373`)
  - **Verification:** Sembrar presupuesto de $50,000 en un centro de costo de Condesa. Gastos por
    $42,000 → WARNING al 84%. Otro por $10,000 → ALERT al 104%.
  - **Dependencies:** F3.1
  - **Files:** `lib/services/expense-service.ts`, `lib/services/budget-service.ts` (solo lectura)
  - **Scope:** M

- [x] **F3.3** Barra de consumo por centro de costo en el dashboard de gastos
  - **Descripción:** Indicador visual del consumo del mes por centro de costo, con la misma
    escala de color que la notificación. Incluye un renglón "sin clasificar" con el total de
    gastos sin centro de costo — si ese renglón crece, la cobertura del presupuesto se está
    volviendo ficción y hay que verlo.
  - **Acceptance criteria:**
    - [x] Barra por centro de costo con presupuesto, consumido y % 
    - [x] Renglón "sin clasificar" con monto y % del gasto total del mes
    - [x] Centros de costo sin presupuesto configurado se listan como "sin presupuesto", no como 0%
    - [x] Respeta el alcance de sucursal del rol
  - **Verification:** Manual con presupuestos sembrados y algunos gastos sin clasificar
  - **Dependencies:** F3.2
  - **Files:** `app/dashboard/finance/expenses/page.tsx`,
    `components/finance/budget-consumption-bar.tsx` (new)
  - **Scope:** M

- [x] **F3.4** Detección de faltantes recurrentes
  - **Descripción:** Un faltante de $80 en un turno es ruido; el mismo turno de la misma sucursal
    con faltantes chicos una y otra vez es un patrón. `checkCashVarianceAndAlert` ya emite
    `CashVarianceDetected` al ledger de eventos de dominio con monto, dirección y turno
    (`cash-variance-alert-service.ts:106`), así que la detección consulta eventos, no recalcula
    arqueos.
  - **Corrección respecto a la versión 1:** el criterio original decía "≥3 faltantes del mismo
    **usuario** en los últimos 30 turnos". **No es implementable:** `daily_sales_cuts` es por
    sucursal/fecha/turno y su único campo de usuario es `received_by` — quien subió el corte, no
    quien manejó la caja. El patrón se detecta por **sucursal + turno**. Atribuirlo a una persona
    requiere agregar un campo de cajero al corte, que es una tarea aparte y no está aquí.
  - **Acceptance criteria:**
    - [x] Consulta eventos `CashVarianceDetected` con `direction` de faltante
    - [x] Ventana de los últimos 30 cortes de esa (sucursal, turno) — no 30 días naturales
    - [x] Umbral: ≥3 faltantes en la ventana
    - [x] El hallazgo incluye sucursal, turno, cantidad de faltantes, monto acumulado y la fecha
          del corte más reciente
    - [x] No se duplica un hallazgo abierto idéntico (dedupe por sucursal + turno)
    - [x] Corre después de emitir el evento, sin bloquear el cierre del corte
  - **Verification:** Sembrar 4 cortes con faltante en el mismo turno de una sucursal → hallazgo.
    Con 2 → nada. Correr dos veces → un solo hallazgo.
  - **Dependencies:** None
  - **Files:** `lib/services/cash-variance-alert-service.ts`,
    `lib/services/control-interno-service.ts`
  - **Nota de diseño:** `control-interno-service` hoy **deriva** `Violation` en memoria desde
    gastos, con 4 tipos fijos y sin tabla de persistencia (`control-interno-service.ts:33`).
    Decidir al implementar: agregar un quinto tipo derivado (barato, se recalcula cada vez) o
    persistir hallazgos (permite marcar como atendido). Si el patrón de faltantes va a tener
    ciclo de vida —alguien lo investiga y lo cierra— hace falta persistirlo, y eso es una tabla
    nueva que no está presupuestada en esta tarea.
  - **Scope:** M

### ☑ Checkpoint: gastos con política (after F3.1–F3.4)
- [x] Gasto con centro de costo consume presupuesto y avisa al 80%
- [x] Sin presupuestos configurados el sistema no inventa alertas
- [x] El gasto sin clasificar es visible, no invisible
- [x] Faltantes recurrentes detectados por sucursal+turno, sin duplicar
- [x] `pnpm run build` limpio

> **Verificación (2026-09-01).** 15/15 checks contra la DB de desarrollo llamando a los
> servicios directo (sin servidor ni Inngest), con todo lo sembrado marcado `[E2E]` y borrado al
> final — la DB quedó con sus 3 sucursales y sin gastos, partidas ni cortes de prueba.
>
> | Escenario | Resultado |
> |---|---|
> | $42,000 sobre presupuesto de $50,000 | WARNING al 84% |
> | +$10,000 sobre lo anterior | ALERT al 104%, excedente $2,000 |
> | Otro gasto en la misma partida ya excedida | `sin-cruce-de-umbral` — **no repite el aviso** |
> | Partida sin `branch_budgets` del mes | `sin-presupuesto`, ninguna alerta inventada |
> | Gasto sin `cost_center_id` | `sin-centro-de-costo`, no notifica y no rompe |
> | Tablero: partida sin presupuesto | `budgetedCents`/`percent` en `null`, **no 0%** |
> | Tablero: sin clasificar | $1,500 = 2.6% del gasto del mes, con su renglón propio |
> | 4 cortes con faltante, mismo turno | 1 hallazgo: 4 faltantes, $800 acumulados, último 2026-08-28 |
> | 2 faltantes en otro turno | sin hallazgo (umbral 3) |
> | Los 4 cortes con faltante | **un solo** evento `RecurringShortageDetected` |
> | Volver a correr la detección | `duplicate`, no un segundo hallazgo |
> | `detectViolations` dos veces | un solo `RECURRING_SHORTAGE` |
> | 30 cortes cuadrados posteriores | el hallazgo se cierra solo — **la ventana es de cortes, no de días** |

### Estado de implementación (Fase 3)

**Desviaciones deliberadas del plan, y por qué:**

1. **Los gastos operativos ahora cuentan como presupuesto comprometido.** `getCommitted` sólo
   sumaba órdenes de compra y de servicio, así que cablear los gastos a `checkBudgetAvailability`
   tal cual habría dado siempre 0% de consumo por gastos. Se extendió `getCommitted` y
   `getCommittedByPair` con `EXPENSE_COMMITTING_STATUSES` (todo menos `REJECTED`: un gasto
   capturado ya ocurrió). Efecto lateral querido: el tope de OC y OS ahora ve también el gasto
   operativo, que es lo que pide el plan cuando dice que el presupuesto debe significar lo mismo
   en los tres flujos.
2. **El aviso se dispara al *cruzar* el umbral, no cada vez que se está arriba.** Se compara el
   consumo antes y después del gasto (el "antes" es el "después" menos el monto de este gasto, sin
   estado extra). Sin esto, el cuarto gasto del mes en una partida al 90% mandaría el mismo
   WhatsApp que el primero, y la gente dejaría de leerlos.
3. **Dos tipos de notificación nuevos** — `budget_threshold_reached` y
   `recurring_shortage_detected` — con su plantilla y su regla de ruteo. Reusar
   `cash_variance_detected` para el patrón habría mandado "Diferencia en Arqueo" con los campos de
   un corte suelto, que es justo lo que en un patrón no importa.
4. **El hallazgo de faltantes es derivado, no persistido** (la decisión que el plan dejaba
   abierta): quinto tipo de `Violation` en `control-interno-service`, recalculado en cada consulta.
   Persistirlo permitiría marcarlo como atendido y hace falta el día que tenga ciclo de vida, pero
   eso es una tabla nueva que esta tarea no presupuesta. Mientras tanto el hallazgo se cierra solo
   cuando los faltantes salen de la ventana de 30 cortes. El dedupe del aviso no necesita tabla:
   un hallazgo sigue abierto mientras el corte que lo disparó siga dentro de la ventana.
5. **`Violation.expenseId` pasó a `string | null`.** El patrón de faltantes es la única excepción
   que no nace de un gasto; ponerle el id de un corte en un campo llamado `expenseId` habría sido
   mentir en el tipo. El panel no renderizaba ese campo.

**Archivos tocados:** `lib/db/schema.ts`, `drizzle/0079_remarkable_la_nuit.sql` (aditiva, aplicada),
`lib/services/expense-service.ts`, `lib/services/budget-service.ts`,
`lib/services/cash-variance-alert-service.ts`, `lib/services/control-interno-service.ts`,
`lib/services/domain-event-service.ts`, `lib/services/notification-dispatcher.ts`,
`lib/notifications/notification-router.ts`, `app/api/expenses/route.ts`,
`app/api/expenses/budget-consumption/route.ts` (new), `components/finance/expense-form.tsx`,
`components/finance/budget-consumption-bar.tsx` (new), `components/finance/excepciones-panel.tsx`,
`app/dashboard/finance/expenses/page.tsx`.

---

## Fase 4: Comisiones por canal y conciliación TPV

> ⛔ **Bloqueada por la decisión D1 del plan.** La versión 1 de estas tareas asumía derivar la
> comisión de `daily_sales_cuts.aggregator_sales` restando neto menos bruto. Ese dato no existe:
> `aggregator_sales` es `Record<string, number>`, un mapa plano canal→centavos **brutos**
> (`app/api/sales/cuts/route.ts:68`, `sales-ingestion-service.ts:483`). No hay ningún monto neto
> en el sistema. Antes de empezar hay que elegir entre tarifa versionada (a), cambiar la forma
> del JSONB (b), o captura manual de la liquidación (c). Las tareas de abajo están escritas para
> la opción **(a)**, la recomendada; con (b) o (c) cambian F4.2 y su alcance.

- [ ] **F4.1** Migración: columnas de comisión y depósito de terminal
  - **Descripción:** `commission_cents integer` y `tpv_deposit_cents integer` en
    `daily_sales_cuts`, ambos nullable — null significa "no conciliado", que es distinto de cero.
  - **Acceptance criteria:**
    - [ ] Migración aditiva, sin drops
    - [ ] Las columnas quedan tras `pnpm db:migrate`
    - [ ] `pnpm run build` limpio
  - **Dependencies:** D1 resuelta
  - **Files:** `lib/db/schema.ts` (`dailySalesCuts`, línea 2806), `drizzle/`
  - **Scope:** S

- [ ] **F4.2** Tarifas de comisión por canal y su cálculo
  - **Descripción:** Configuración versionada `{ canal, tasaBps, vigenteDesde }` — bps y no
    porcentaje flotante porque las tarifas se negocian en puntos base y el redondeo importa
    cuando se multiplica por el volumen de un mes. Un corte se valúa con la tarifa vigente en su
    `businessDate`, no con la de hoy: recalcular meses pasados con la tarifa nueva mueve el
    histórico solo, que es el mismo problema que `pnl-snapshot-service` documenta para el food cost.
  - **Acceptance criteria:**
    - [ ] `getCommissionsByBranch(companyId, from, to)` → `{ canal, totalCommissionCents, tasaBps }[]`
    - [ ] Canales separados: mostrador, Rappi, Uber Eats, DiDi, TPV
    - [ ] Un canal sin tarifa configurada se omite — no se inventa una tasa de mercado
    - [ ] La tarifa se resuelve por la fecha del corte, no por la fecha de consulta
    - [ ] El resultado se marca `ESTIMATED`, nunca `MEASURED`: es un cálculo, no una medición
  - **Verification:** Script tsx con un corte de Rappi y tarifa conocida; el total se verifica a mano
  - **Dependencies:** F4.1
  - **Files:** `lib/services/commission-service.ts` (new), configuración de tarifas
  - **Scope:** M

- [ ] **F4.3** Conciliación TPV
  - **Descripción:** Cuando el corte tiene `cardSales > 0`, se puede capturar el depósito real de
    la terminal. `tpvVariance = cardSales − tpvDepositCents − commissionCents`. Una varianza
    positiva pequeña es normal (comisión no contemplada); una negativa es alerta, pero no error:
    las terminales depositan con 1–2 días de rezago y el corte del día no cierra con el estado
    de cuenta del mismo día.
  - **Acceptance criteria:**
    - [ ] El formulario de corte captura el depósito de terminal
    - [ ] El banner de diferencias muestra la varianza TPV **separada** de la de efectivo —
          mezclarlas hace que un faltante de caja se esconda tras una comisión
    - [ ] Varianza negativa se marca como alerta con nota sobre el rezago típico
    - [ ] Corte sin depósito de terminal capturado no muestra varianza TPV (null ≠ 0)
  - **Verification:** Corte con $10,000 de tarjeta, $9,700 de depósito, $300 de comisión →
    varianza 0. Con $9,500 de depósito → varianza negativa visible como alerta.
  - **Dependencies:** F4.1, F4.2
  - **Files:** `app/api/sales/cuts/route.ts`, `app/dashboard/sales/page.tsx`,
    `lib/sales/cash-variance.ts`
  - **Scope:** M

- [ ] **F4.4** Renglón de comisiones en el P&L
  - **Descripción:** `BranchPnL` (`pnl-types.ts:65`) hoy tiene sales, foodCost, waste, labor,
    operatingExpenses y operatingProfit. **No hay renglón de comisiones** — la versión 1 de este
    todo decía que existía como fallback sectorial y era falso. Es un renglón nuevo, y como
    `pnl_snapshots` guarda columnas fijas (`pnl-snapshot-service.ts:50-60`), también necesita
    columna en esa tabla o los períodos congelados quedarán sin la línea.
  - **Acceptance criteria:**
    - [ ] `BranchPnL.commissions: PnLLine`, restando en el margen operativo
    - [ ] Columna `commission_cents` en `pnl_snapshots` + migración
    - [ ] Desglose por canal accesible desde la tabla (sub-fila o tooltip)
    - [ ] `source: ESTIMATED` con tarifa configurada, `NO_DATA` sin ella
    - [ ] `weakestLine` considera el renglón nuevo
    - [ ] Los snapshots ya congelados siguen leyéndose sin la columna (null, no cero)
  - **Verification:** P&L de una sucursal con tarifas configuradas muestra la línea con desglose;
    sin tarifas muestra `NO_DATA`. Congelar un período y releerlo conserva el valor.
  - **Dependencies:** F4.2
  - **Files:** `lib/services/pnl-types.ts`, `lib/services/pnl-service.ts`,
    `lib/services/pnl-snapshot-service.ts`, `lib/db/schema.ts` (`pnlSnapshots`),
    `components/finance/pnl-branch-table.tsx`
  - **Scope:** M

### ☑ Checkpoint: ingresos completos (after F4.1–F4.4)
- [ ] Comisiones como renglón explícito del P&L, etiquetado `ESTIMATED`
- [ ] Varianza TPV separada de la de efectivo
- [ ] Margen por canal responde "¿me conviene Rappi?"
- [ ] `pnpm run build` limpio

---

## Fase 5: Cierre de período financiero

> ⛔ **Bloqueada por la decisión D2 del plan.** `operating_expenses` no tiene fecha de negocio
> (`schema.ts:3295`: solo `created_at`, `due_date`, `paid_at`). Sin ella no se puede decir a qué
> mes pertenece un gasto y no hay nada que cerrar. F5.1 es literalmente PL1 de
> `plan-pnl-real.md`; hay que decidir cuál tracker lo ejecuta.
>
> **Corrección respecto a la versión 1:** no se extiende `inventory_periods`. Esa tabla es del
> ciclo de inventario, es por sucursal y la crea automáticamente `inventory-service.ts:238` al
> iniciar conteos, con fechas que manda el inventario. El cierre financiero es por company y
> mensual, lo dispara una persona distinta y en otro calendario. Va en tabla propia.

- [ ] **F5.1** `business_date` en `operating_expenses`
  - **Descripción:** Fecha a la que pertenece el gasto en la operación, distinta de cuándo se
    capturó. Es PL1 de `plan-pnl-real.md` — coordinar antes de duplicar el trabajo.
  - **Acceptance criteria:**
    - [ ] Columna `business_date date`, backfill desde `created_at` para los existentes
    - [ ] El formulario la captura, con `created_at` como default
    - [ ] El P&L filtra gastos por `business_date`, no por `created_at`
  - **Dependencies:** Coordinación con `plan-pnl-real.md`
  - **Files:** `lib/db/schema.ts`, `drizzle/`, `lib/services/pnl-service.ts`,
    `components/finance/expense-form.tsx`
  - **Scope:** S

- [ ] **F5.2** Tabla `financial_periods` y servicio de cierre
  - **Descripción:** Período mensual por company con `status` OPEN/CLOSED, `closedBy`, `closedAt`.
    Cerrar dispara `freezePnLPeriod` — que ya existe y es idempotente
    (`pnl-snapshot-service.ts:35`), así que reintentar un cierre a medias es seguro.
  - **Acceptance criteria:**
    - [ ] Tabla nueva, sin tocar `inventory_periods`
    - [ ] `closeFinancialPeriod(companyId, year, month, closedBy)` congela el P&L de todas las
          sucursales y marca el período
    - [ ] Solo ADMIN/SUPER_ADMIN
    - [ ] Idempotente: cerrar dos veces no duplica snapshots
    - [ ] `isPeriodClosed(companyId, date)` para que los guardias de F5.3 la consulten
  - **Dependencies:** F5.1
  - **Files:** `lib/db/schema/` (módulo nuevo), `lib/services/financial-period-service.ts` (new),
    `app/api/finance/periods/route.ts` (new)
  - **Scope:** M

- [ ] **F5.3** Rechazo de escrituras en período cerrado
  - **Descripción:** Guardia en las APIs que escriben datos con fecha: gastos, cortes de venta,
    recepciones. El rechazo va en el servicio, no solo en la UI — un período cerrado que solo
    esconde el botón no es un cierre.
  - **Acceptance criteria:**
    - [ ] Crear o editar un gasto con `business_date` en período cerrado → `ApiError.forbidden`
          con mensaje que nombra el período
    - [ ] Lo mismo para cortes (`business_date`) y recepciones
    - [ ] Un período abierto no cambia de comportamiento
    - [ ] El mensaje dice qué hacer: pedir a un ADMIN que abra un ajuste, no "operación inválida"
  - **Verification:** Cerrar agosto → gasto con fecha de agosto rechazado, uno de octubre pasa
  - **Dependencies:** F5.2
  - **Files:** `lib/services/expense-service.ts`, `app/api/sales/cuts/route.ts`,
    `lib/services/receiving-service.ts`
  - **Scope:** M

- [ ] **F5.4** UI de cierre de período
  - **Descripción:** Botón en `/dashboard/finance` con resumen previo obligatorio: gastos
    pendientes de aprobar, cortes sin arqueo, facturas sin conciliar. Cerrar con esos pendientes
    los congela como están, y la persona debe verlos antes de decidir.
  - **Acceptance criteria:**
    - [ ] Visible solo para ADMIN/SUPER_ADMIN
    - [ ] Resumen previo con los tres conteos y enlace a cada lista
    - [ ] Confirmación escribiendo "CERRAR" — no un click
    - [ ] El período cerrado aparece en la lista con quién y cuándo
    - [ ] No hay botón de reapertura (si se necesita, es una decisión de producto aparte)
  - **Verification:** Manual sobre un período de prueba con pendientes sembrados
  - **Dependencies:** F5.2, F5.3
  - **Files:** `app/dashboard/finance/page.tsx`,
    `components/finance/period-close-dialog.tsx` (new)
  - **Scope:** M

### ☑ Checkpoint: período cerrado (after F5.1–F5.4)
- [ ] Mes cerrado: gastos y cortes rechazados por la API, no solo ocultos en la UI
- [ ] P&L congelado con su procedencia intacta
- [ ] `pnpm run build` limpio

---

## Apéndice: pulidos de costeo (opcionales, no son gaps)

Sub-recetas, costeo recursivo y detección de ciclos **ya están implementados** — la Fase 2 de la
versión 1 de este todo estaba obsoleta antes de escribirse. Lo que queda son detalles:

- [ ] **A1** Umbral de alza de costo configurable por tenant
  - `stock-alert-service.ts:358` compara contra 10% fijo. Moverlo a `tenantOperatingConfig` con
    default 10% (no 15% — cambiar el default cambia el comportamiento de instalaciones vivas).
  - **Scope:** S

- [ ] **A2** Listar platillos afectados en la alerta de alza de costo
  - `recipe-service.simulateIngredientCostChange` ya devuelve las recetas afectadas con food cost
    antes y después. Cablearlo al mensaje de `checkPriceIncrease` (línea 393).
  - **Scope:** S

- [ ] **A3** Límite de profundidad en el costeo recursivo
  - `getRecipeCostDetail` (`costing-service.ts:99`) recurre sin tope. `wouldCreateCycle` ya
    impide ciclos al guardar, así que no hay recursión infinita — pero una cadena legítima de 8
    niveles hace 8 rondas de queries por platillo. Tope de 3 con error claro.
  - **Scope:** S

---

### ☑ Checkpoint: Complete (after all phases)
- [ ] `pnpm run build && pnpm run lint` limpios
- [ ] Cada fase con al menos un spec de Playwright
- [ ] Recorrido manual end-to-end:
  - [ ] Verificar una CLABE por CEP → la factura del proveedor entra al lote de pago
  - [ ] Dashboard de costo laboral con semáforo contra el target del tenant
  - [ ] Gasto que rebasa presupuesto → alerta; gasto sin clasificar visible aparte
  - [ ] Faltantes recurrentes visibles en control interno
  - [ ] *(si D1 resuelta)* P&L con comisiones por canal y varianza TPV
  - [ ] *(si D2 resuelta)* Cerrar período → escrituras rechazadas por la API

---

## Notas de paralelización

- **Fase 1 va sola y primero.** Es un bloqueo funcional de tesorería; las demás son mejoras.
- Fases 2 y 3 son independientes entre sí y de la 1 — se pueden repartir.
- Fases 4 y 5 no arrancan hasta cerrar D1 y D2. Empezarlas antes es construir sobre una premisa
  que ya falló una vez en este mismo plan.
- Las migraciones (F3.1, F4.1, F5.1, F5.2) tocan tablas distintas y no chocan entre sí.
- F5.1 se coordina con `plan-pnl-real.md` PL1 — es la misma tarea en dos trackers.
