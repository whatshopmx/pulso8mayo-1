# TODO: Módulo Unificado de Proveedores / Contrapartes

Ver plan detallado en `tasks/plan-proveedores-unificados.md`

---

## Fase A — Contrapartes (payees) completas

- [ ] **A1** — API `PATCH /api/finance/payees/[id]` + `updatePayee()` en service
  - Files: `app/api/finance/payees/[id]/route.ts`, `lib/services/payee-service.ts`
  - Scope: S
- [ ] **A2** — Dialog de edición completa en `finance/payees/page.tsx` (usa A1)
  - Files: `app/dashboard/finance/payees/page.tsx`
  - Scope: S
- [ ] **A3** — Filtro `?payeeId=` en expenses + botón "Ver gastos" desde payees
  - Files: `app/dashboard/finance/payees/page.tsx`, `app/dashboard/finance/expenses/page.tsx`, `app/api/expenses/route.ts`
  - Scope: M

### Checkpoint A
- [ ] `pnpm run build` limpio
- [ ] Flujo: crear -> editar -> ver gastos filtrados

---

## Fase B — Órdenes de Servicio <-> service_providers

- [ ] **B1** — Schema: columna `serviceProviderId` nullable en `service_orders` + migración
  - Files: `lib/db/schema/service-orders.ts`, `lib/services/service-order-service.ts`, `drizzle/`
  - Scope: S
- [ ] **B2** — Propagar `providerId` de compliance al crear OS + selector en form (usa B1)
  - Files: `lib/services/service-order-service.ts`, `components/service-orders/create-order-dialog.tsx`, `app/api/service-orders/route.ts`
  - Scope: M
- [ ] **B3** — Mostrar `service_providers.name` en lista y detalle de OS (usa B1, B2)
  - Files: `lib/services/service-order-service.ts`, componentes de lista/detalle OS
  - Scope: M

### Checkpoint B
- [ ] Build limpio + migración aplicada
- [ ] Flujo: compliance -> OS -> proveedor propagado

---

## Fase C — suppliers <-> payees (puente OC -> CxP)

- [ ] **C1** — Schema: `payeeId` nullable en `suppliers` + migración
  - Files: `lib/db/schema.ts`, `drizzle/`
  - Scope: XS
- [ ] **C2** — UI vincular supplier -> payee en `inventory/suppliers` (usa C1)
  - Files: `app/dashboard/inventory/suppliers/page.tsx`, `components/inventory/supplier-list.tsx`, `app/api/inventory/suppliers/[id]/route.ts`
  - Scope: M
- [ ] **C3** — `accounts-payable-service` usa `supplier.payeeId` en CxP (usa C1, C2)
  - Files: `lib/services/accounts-payable-service.ts`, `app/dashboard/finance/payables/page.tsx`
  - Scope: M

### Checkpoint C
- [ ] Build limpio
- [ ] OC pagada -> CxP con nombre de proveedor real

---

## Fase D — Deprecar strings sueltos en compliance

- [ ] **D1** — Badge "Sin proveedor registrado" + vincular en `equipment/compliance`
  - Files: `app/dashboard/equipment/compliance/page.tsx`, `app/api/compliance-services/[id]/route.ts`
  - Scope: S
- [ ] **D2** — Propagar `serviceProviderId` al historial compliance al cerrar OS (usa B1, B2)
  - Files: `lib/services/service-order-service.ts`
  - Scope: S

### Checkpoint D (final)
- [ ] Build limpio
- [ ] Historial compliance trazable al catálogo de proveedores
