# Plan de Implementación: Módulo Unificado de Proveedores / Contrapartes

## Overview

El sistema tiene 4 entidades separadas que modelan "a quién le pagamos" (`suppliers`, `service_providers`, `payees`, strings sueltos), sin fuente de verdad unificada. Esto impide: (1) tener CxP por proveedor de servicio, (2) cruzar gastos operativos con facturas SAT, (3) trazabilidad del proveedor en Órdenes de Servicio.

**Estado actual real:**
- `payees` (gastos operativos) → tabla, API y pantalla **ya existen**. Faltan: edición de contacto completo, enlace a CxP por contraparte
- `service_providers` (equipo/compliance) → catálogo completo, pero las **OS no referencian al proveedor con FK real** — usan `suppliers.id` (inventario) o string libre
- `suppliers` (inventario/OC) → modelo robusto con CLABE bancaria, pero no tiene `payeeId` para cerrar el ciclo CxP
- El schema ya documenta el plan de unificación en líneas 3200-3213

## Decisiones de arquitectura

- **No fusionar las tablas**: `suppliers`, `service_providers` y `payees` tienen atributos muy distintos. La unificación es de *referencias*, no de *entidades*.
- **`service_orders.supplierId` → redirigir a `service_providers`**: La FK huérfana actual apunta semánticamente a un proveedor de servicio. Se añade columna `serviceProviderId` con FK real, manteniendo `supplierId` como legacy.
- **Fase C (puente suppliers ↔ payees) requiere migración de schema**: No hacer en paralelo con cambios de UI.
- **El `ExpenseForm` ya tiene quick-create de payees en línea**: Lo que falta es edición completa.

---

## Fase A — Completar el catálogo de Contrapartes (payees)

### Task A1: API PATCH para actualizar contraparte

**Description:** Agregar handler `PATCH` a `app/api/finance/payees/[id]/route.ts` y función `updatePayee()` en `payee-service.ts`. Solo actualiza campos de contacto, nunca el `name`.

**Acceptance criteria:**
- [ ] `PATCH /api/finance/payees/:id` con body `{ taxId?, contactName?, email?, phone? }` devuelve payee actualizado
- [ ] Verifica que el payee pertenezca al tenant antes de actualizar
- [ ] Registra en `AuditService` con `action: "UPDATE"`, `entityType: "PAYEE"`
- [ ] Intento a payee ajeno → 404

**Verification:**
- [ ] `pnpm run build` sin errores
- [ ] Manual: PATCH con datos válidos → 200; id ajeno → 404

**Dependencies:** None

**Files likely touched:**
- `app/api/finance/payees/[id]/route.ts`
- `lib/services/payee-service.ts`

**Estimated scope:** S (2 files)

---

### Task A2: Dialog de edición completa en pantalla payees

**Description:** La pantalla actual solo permite crear (nombre + RFC) y dar de baja. Agregar dialog de edición con `contactName`, `email`, `phone`, `taxId`. El nombre NO es editable.

**Acceptance criteria:**
- [ ] Botón "Editar" por fila abre dialog pre-rellenado
- [ ] Permite actualizar `taxId`, `contactName`, `email`, `phone`
- [ ] Campo `name` visible pero deshabilitado con tooltip explicativo
- [ ] Al guardar, la tabla se actualiza sin recarga completa

**Verification:**
- [ ] Build pasa
- [ ] Manual: crear → editar teléfono → verificar cambio en tabla

**Dependencies:** A1

**Files likely touched:**
- `app/dashboard/finance/payees/page.tsx`

**Estimated scope:** S (1 file)

---

### Task A3: Filtro por payee en pantalla de gastos

**Description:** En tabla de payees, agregar acción "Ver gastos" que navega a `/dashboard/finance/expenses?payeeId=<id>`. La página de expenses filtra por `payeeId` cuando el parámetro está presente.

**Acceptance criteria:**
- [ ] Botón/ícono por fila en payees → navega a expenses con filtro
- [ ] `GET /api/expenses?payeeId=<id>` filtra correctamente (tenant-scoped)
- [ ] Banner en expenses: "Filtrando por contraparte: [nombre]" con botón para limpiar filtro
- [ ] `payeeId` inexistente → lista vacía, no error

**Verification:**
- [ ] Build pasa
- [ ] Manual: desde payees → "Ver gastos" → lista filtrada correcta

**Dependencies:** None (independiente de A1/A2)

**Files likely touched:**
- `app/dashboard/finance/payees/page.tsx`
- `app/dashboard/finance/expenses/page.tsx`
- `app/api/expenses/route.ts`

**Estimated scope:** M (3 files)

---

### Checkpoint A — Contrapartes completas
- [ ] `pnpm run build` sin errores
- [ ] Flujo: crear → editar contacto → ver gastos filtrados
- [ ] Revisar con el usuario antes de continuar a Fase B

---

## Fase B — Vincular Proveedores de Servicio a Órdenes de Servicio

### Task B1: Schema — columna `serviceProviderId` en `service_orders`

**Description:** Añadir columna `service_provider_id uuid REFERENCES service_providers(id)` nullable a `service_orders`. Mantener `supplierId` como legacy sin borrar.

**Acceptance criteria:**
- [ ] Columna `serviceProviderId` nullable en `serviceOrders` schema Drizzle
- [ ] `pnpm db:generate` produce migración correcta (ADD COLUMN sin DROP)
- [ ] `service-order-service.ts` expone `serviceProviderId` en `listOrders` y `getOrderDetail`

**Verification:**
- [ ] `pnpm db:generate` sin errores
- [ ] `pnpm run build` sin errores de tipos

**Dependencies:** None

**Files likely touched:**
- `lib/db/schema/service-orders.ts`
- `lib/services/service-order-service.ts`
- `drizzle/` (migración generada)

**Estimated scope:** S (2-3 files + migración)

---

### Task B2: Propagar `providerId` de compliance al crear OS

**Description:** Al crear OS con `complianceServiceId`, leer el `providerId` del `branchComplianceService` y asignarlo como `serviceProviderId`. Selector de proveedor editable en el form de OS.

**Acceptance criteria:**
- [ ] OS creada con `complianceServiceId` hereda `serviceProviderId` del servicio normativo si existe
- [ ] Selector de proveedor en `CreateOrderDialog` busca en `GET /api/equipment/providers`
- [ ] Si el servicio no tiene `providerId`, la OS se crea igual con `serviceProviderId = null`

**Verification:**
- [ ] Build pasa
- [ ] Manual: compliance → "Generar OS" → proveedor pre-llenado

**Dependencies:** B1

**Files likely touched:**
- `lib/services/service-order-service.ts`
- `components/service-orders/create-order-dialog.tsx`
- `app/api/service-orders/route.ts`

**Estimated scope:** M (3-4 files)

---

### Task B3: Mostrar proveedor de servicio en lista y detalle de OS

**Description:** Actualizar vistas de OS para mostrar `serviceProviderId → service_providers.name` con link a su perfil. Fallback a `suppliers.name` para registros legacy.

**Acceptance criteria:**
- [ ] Lista OS: columna "Proveedor" = `service_providers.name` || `suppliers.name` || "—"
- [ ] Detalle OS: card de proveedor con nombre, teléfono, email y link "Ver perfil"
- [ ] Link navega a `equipment/providers` (filtrado por nombre)

**Verification:**
- [ ] Build pasa
- [ ] Manual: OS con proveedor asignado → nombre y link correctos

**Dependencies:** B1, B2

**Files likely touched:**
- `lib/services/service-order-service.ts`
- Componentes de lista/detalle OS en `components/service-orders/`

**Estimated scope:** M (3-4 files)

---

### Checkpoint B — OS trazables a proveedor
- [ ] Build limpio
- [ ] Flujo: compliance → OS → proveedor propagado → visible en detalle
- [ ] Revisar con el usuario antes de Fase C

---

## Fase C — Puente `suppliers` ↔ `payees` para OC/CxP

### Task C1: Schema — `payeeId` en tabla `suppliers`

**Description:** Añadir `payee_id uuid REFERENCES payees(id)` nullable a `suppliers`. Solo additive — no rompe nada existente.

**Acceptance criteria:**
- [ ] Columna `payeeId` nullable en `suppliers`
- [ ] Migración ADD COLUMN limpia
- [ ] `purchase-order-service.ts` compila sin cambios

**Verification:**
- [ ] `pnpm db:generate` correcto; `pnpm run build` sin errores

**Dependencies:** None

**Files likely touched:**
- `lib/db/schema.ts` (sección suppliers)
- `drizzle/` (migración)

**Estimated scope:** XS (1 archivo + migración)

---

### Task C2: UI — vincular supplier → payee en catálogo de inventario

**Description:** En `inventory/suppliers`, agregar campo "Contraparte de pago" para vincular el supplier con un payee. El `PATCH /api/inventory/suppliers/:id` acepta `payeeId`.

**Acceptance criteria:**
- [ ] Selector de payee en edición de supplier (búsqueda ILIKE, opción "crear nueva")
- [ ] Al vincular, guarda `payeeId` en el supplier
- [ ] Lista muestra "Contraparte: [nombre]" o "Sin vincular"

**Verification:**
- [ ] Build pasa
- [ ] Manual: editar proveedor → vincular payee → lista refleja vinculación

**Dependencies:** C1

**Files likely touched:**
- `app/dashboard/inventory/suppliers/page.tsx`
- `components/inventory/supplier-list.tsx`
- `app/api/inventory/suppliers/[id]/route.ts` (crear si no existe)

**Estimated scope:** M (3-4 files)

---

### Task C3: CxP lee `payeeId` del supplier en flujo de OC

**Description:** En `accounts-payable-service`, cuando se crea la entrada CxP de una OC, usar `supplier.payeeId` para agrupar por contraparte. Backward-compatible: si no hay `payeeId`, comportamiento actual.

**Acceptance criteria:**
- [ ] `accounts-payable-service` lee `supplier.payeeId` al generar CxP
- [ ] CxP de OC muestra nombre del payee vinculado en `finance/payables`
- [ ] OCs sin `payeeId` en su supplier funcionan igual que hoy

**Verification:**
- [ ] Build pasa
- [ ] Manual: OC con supplier vinculado → payables muestra nombre correcto

**Dependencies:** C1, C2

**Files likely touched:**
- `lib/services/accounts-payable-service.ts`
- `app/dashboard/finance/payables/page.tsx`

**Estimated scope:** M (2-3 files)

---

### Checkpoint C — CxP cerrada para OC
- [ ] Build limpio
- [ ] OC pagada → visible en CxP con nombre del proveedor real
- [ ] Revisar antes de Fase D

---

## Fase D — Deprecar strings sueltos en compliance

### Task D1: Badge "Sin proveedor registrado" y acción vincular en compliance

**Description:** En `equipment/compliance`, resaltar servicios con `providerName` pero sin `providerId`. Botón "Vincular" abre selector de `service_providers`.

**Acceptance criteria:**
- [ ] Badge naranja en filas con `providerId = null && providerName != null`
- [ ] Botón "Vincular" → selector de catálogo → guarda `providerId`
- [ ] Al vincular, badge desaparece

**Verification:**
- [ ] Build pasa
- [ ] Manual: servicio sin `providerId` → badge → vincular → badge desaparece

**Dependencies:** None (UI; schema ya tiene `providerId`)

**Files likely touched:**
- `app/dashboard/equipment/compliance/page.tsx`
- `app/api/compliance-services/[id]/route.ts`

**Estimated scope:** S (2 files)

---

### Task D2: Propagar `serviceProviderId` al historial de compliance al cerrar OS

**Description:** Al completar OS vinculada a `complianceServiceId`, copiar `serviceProviderId` de la OS a la entrada de `complianceServiceHistory`.

**Acceptance criteria:**
- [ ] Al cerrar OS con `complianceServiceId`, `complianceServiceHistory.providerId = os.serviceProviderId`
- [ ] Si OS sin `serviceProviderId`, usa `providerName` como fallback
- [ ] Historial muestra link "Ver proveedor" cuando tiene `providerId`

**Verification:**
- [ ] Build pasa
- [ ] Manual: completar OS normativa → historial compliance muestra proveedor vinculado

**Dependencies:** B1, B2

**Files likely touched:**
- `lib/services/service-order-service.ts`

**Estimated scope:** S (1 archivo)

---

### Checkpoint D — Plan completo
- [ ] Build limpio, tests pasan
- [ ] Ningún servicio normativo activo sin `providerId` sin indicador
- [ ] Historial compliance trazable al catálogo

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Migración service_orders en prod con datos live | Alto | Columna nullable, no destructiva. Usar `pnpm db:migrate` (no push) en horario bajo |
| `supplierId` legacy en OS apunta a inventario | Medio | Mantener columna; mostrar fallback en UI |
| Supplier vinculado a payee con RFC duplicado | Bajo | Validar por RFC en C2 antes de crear payee nuevo |
| `accounts-payable-service` es complejo (12KB) | Medio | C3 solo agrega lectura de `payeeId`; no toca lógica de aprobación |

## Open Questions

1. ¿El filtro "Ver gastos de esta contraparte" (A3) debe incluir OCs o solo gastos operativos?
2. ¿Los `service_providers` deben aparecer eventualmente en el catálogo de payees para cerrar su CxP también?
3. ¿Prioridad de fases? Recomiendo A → B → C → D. A y B pueden ir en paralelo si hay dos sesiones.
