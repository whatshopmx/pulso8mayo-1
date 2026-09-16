# Handoff — Equipos para grupo restaurantero (T02–T04)

> **Fuente de verdad** para continuar esta tarea en una sesión nueva.
> Fecha: 2026-09-16. Plan: `tasks/plan-qeuipos-grupo-resturantero.md`.
> Checklist vivo: `tasks/todo-qeuipos-grupo-resturantero.md` (T02 y T03 ya marcadas con evidencia).

## 1. Estado en una frase

**T02 y T03 completas y verificadas; T04 con el código completo y tsc/lint limpios, pero sin su spec (`tests/equipment-relations.spec.ts`), sin evidencia registrada y con casillas pendientes; el build (≈6 min) pasó con los cambios de T02 y hay que re-correrlo para cubrir T03+T04.**

Suite unitaria completa después de T04: **639 passed / 1 skipped / 1 todo**. `npx tsc --noEmit` limpio (exit 0). ESLint focalizado en los archivos tocados: 0 errores (sólo advertencias preexistentes de `no-explicit-any` en `equipment-service.ts`).

## 2. Estado por tarea

| Tarea | Estado | Notas |
|---|---|---|
| T02 Listar inventario con alcance | ✅ Hecha | 24/24 unit. Casillas y evidencia ya en el todo. |
| T03 Expediente y recursos por ID | ✅ Hecha | 10/10 casos de servicio contra BD real; grupo HTTP del spec pendiente de servidor. |
| T04 Referencias de OS y servicios | 🔶 Código listo | Falta el spec, la evidencia y las casillas. |
| Checkpoint C01 (tras T03) | 🔶 Parcial | Tests + lint ✓; **build sin re-correr desde que entraron T03/T04**; recorrido pendiente. |
| T05–T08 | ⬜ Pendientes | C02 va después de T06. |

## 3. Verificaciones hechas (evidencia)

- T02: `pnpm test:unit lib/services/__tests__/equipment-scope.test.ts` → **24 tests ok** (adaptador puro + WHERE real con `PgDialect.sqlToQuery` + el `GET` real con `@/lib/db` y `@/lib/tenant-context` simulados).
- T03 (servicio, BD real): config temporal de Playwright (creada y **borrada** después) → `pnpm exec playwright test --config=tmp-probe-pw.config.ts --grep-invert "las rutas HTTP" tests/equipment-isolation.spec.ts` → **10 passed** en 45 s.
- T03 (rutas): sonda vitest temporal (borrada) → **6/6**: 404 con cuerpo idéntico para id ajeno e inexistente, 403 de otra sucursal (GERENTE), 401 sin sesión, y PUT/DELETE sin una sola escritura.
- T03 (servicio, sonda tsx temporal, borrada) → **23/23** contra la BD, incluyendo el camino válido (editar, cerrar mantenimiento, dar de baja lo propio).
- `pnpm test:unit` completo → **639 passed** tras T02, T03 y T04 (645 cuando las sondas temporales estaban dentro; la diferencia son las 6 de la sonda de rutas).
- `npx tsc --noEmit` → limpio después de T03 y de nuevo después de T04.
- `next build` → **pasó** (5.6 min, "Compiled successfully", tabla de 407 rutas completa) con los cambios de **T02 nada más**; T03/T04 aún sin build (ver §6.3).
- BD de desarrollo alcanzable vía `.env` (`DATABASE_URL`, Neon) — verificado con siembras y limpiezas.

## 4. Lo que quedó hecho, por tarea

### T02 — listado con alcance (✅)

- `lib/equipment/scope.ts` (**nuevo**): adaptador puro del alcance — `resolveEquipmentScope(role, branchIdSesion, pedida)`, `scopeCoversBranch`, `assertScopeCoversBranch`. `NONE` jamás es "todas"; el `trim` evita la sucursal fantasma con `?branchId=%20`.
- `lib/services/equipment-service.ts`: `getEquipmentByBranch` → **`getEquipmentByScope({companyId, scope, filters})`**; `companyId` siempre en el `WHERE`; `NONE` → `[]` **sin tocar la base** (convención de `app/api/expenses/route.ts`).
- `app/api/equipment/route.ts` GET: `requireAuth()` + `requireTenant()`; intención = `?branchId` ?? `tenant.branchId`; `assertBranchOfCompany` sólo cuando la sucursal vino del query (la de la sesión ya es de la empresa por construcción). Responde **arreglo plano** (no `{items, scope}`) para no romper a `use-equipment.ts`, `maintenance-form.tsx` y la pantalla de equipos — rotular el alcance es trabajo de T10/T30.
- `lib/services/__tests__/equipment-scope.test.ts` (24 tests).

### T03 — expediente y recursos por ID (✅)

Patrón tomado de `expense-service.ts:52`: **404** para lo que no existe *en esta empresa* (id inexistente, mal escrito o de otra empresa —mismo mensaje, para no confirmar qué existe fuera—); **403** para lo que es de la empresa pero está fuera del alcance (otra sucursal, o rol acotado sin sucursal asignada).

- `getEquipmentById(equipmentId, companyId)` — la empresa entró al `WHERE`.
- **`getEquipmentInScope({equipmentId, companyId, scope})`** — la guarda del expediente (404/403). La consumen las tres rutas de `[id]` y las de `warranty`/`maintenance`.
- `getEquipmentWithDetails(equipment: EquipmentRow)` — ahora recibe la **fila ya cargada** (antes re-consultaba por `id` sin empresa); sus 3 sub-consultas (garantías, historial, programación) llevan `companyId`.
- `updateEquipment(equipmentId, companyId, data, updatedBy)` y `deleteEquipment(equipmentId, companyId, updatedBy)` — `companyId` en el `WHERE` de la escritura (defensa aunque el llamador se salte la guarda).
- `getWarrantiesByEquipment(equipmentId, companyId)` y `getMaintenanceHistory(equipmentId, companyId, limit?)` — empresa en el `WHERE` además de la guarda previa.
- **`getMaintenanceInScope({maintenanceId, equipmentId, companyId, scope})`** — guarda nueva del cierre: el `maintenanceId` llegaba por el **cuerpo** del PUT y se cerraba mantenimiento de otra empresa (el cierre arrastraba además `lastMaintenanceDate` del equipo ajeno). El `equipmentId` del URL va en el `WHERE`: no se cierra un registro colgándolo de otro equipo.
- `completeMaintenance(maintenanceId, companyId, data, updatedBy)` — empresa en los **dos** `WHERE` (registro y equipo).
- Rutas `[id]`, `[id]/warranty`, `[id]/maintenance`: `requireAuth()` + `resolveEquipmentScope(...)` + guarda **antes** de leer/validar el cuerpo; en el POST de maintenance el `equipmentId/companyId/branchId` salen del equipo validado, no del cuerpo.
- `tests/equipment-isolation.spec.ts`: 10 casos de servicio (sin servidor) + 5 de HTTP (requieren `next dev`).

### T04 — referencias de OS y servicios (🔶 código listo, falta spec)

- `lib/services/service-order-service.ts`:
  - `assertOrderInScope(scope, order)` (línea ~214): la semántica 404/403 de T03 aplicada a OS; `NONE` niega.
  - `assertEquipmentInOrderBranch(equipmentId, companyId, branchId)` (~288): el equipo debe ser de la empresa **y de la sucursal de la orden**. Consulta vía `equipmentService.getEquipmentById` (el preditado de empresa vive en el adaptador de T03).
  - `validateReferences` (~303) ahora valida `equipmentId` además de branch/supplier/serviceProvider/costCenter/complianceService — era la única FK del payload sin mirar.
  - `createDraft` pasa `equipmentId` a `validateReferences` (crear y actualizar quedan cubiertos).
  - **Firmas con alcance** (exigidas por el criterio 3): `getOrderDetail(companyId, id, scope)` (~113), `updateDraft(id, patch, companyId, scope)` (~399), `transitionOrder(companyId, orderId, action, opts, scope)` (~659). Ojo: `opts` dejó de ser opcional-posicional — pásale `undefined` si no hay fecha.
- `app/api/service-orders/[id]/route.ts`: GET y PATCH resuelven `resolveBranchScope(user.role, user.branchId ?? null, tenant.branchId ?? null)` y lo pasan al servicio (la sucursal activa de la app manda sobre el query, igual que en el listado). Este archivo **no estaba en la lista prevista** de T04, pero el criterio 3 lo exige — anotarlo en la evidencia al cerrar la tarea.
- `lib/services/equipment-service.ts` — `createComplianceService` (~678): valida `assertBranchOfCompany(companyId, branchId)` y que el `providerId` sea de la empresa **antes** de insertar. Hasta T04 el `branchId` y el `providerId` del cuerpo se insertaban tal cual.
- **`app/api/service-orders/route.ts` y `app/api/compliance-services/route.ts` NO necesitaron cambios**: toda la validación vive en los servicios (el presupuesto de 5 archivos se respeta).
- Alcance cubierto en OS: lectura (`getOrderDetail`), transición (`transitionOrder`) y edición de borrador (`updateDraft`). **Quedan fuera a propósito** (tienen tarea propia): `addQuote` / `addEvidence` / `linkInvoice` / `signConformity` (sub-rutas de `[id]`; T18/T22/T23) y `recordComplianceService` (sin llamador en rutas hoy).

## 5. Convenciones que T05+ debe respetar

- `companyId` sale de la sesión y entra a **todo** `WHERE`. El alcance (ALL/BRANCH/NONE) se resuelve con `resolveBranchScope` / `resolveEquipmentScope`; una sucursal pedida por query/cuerpo se valida con `assertBranchOfCompany` **antes** de llegar al servicio.
- Por ID: primero carga acotada por empresa → **404** con mensaje único; luego la guarda de alcance → **403**. Nunca 403 para "no existe": distinguirlos le confirma a quien prueba ids qué existe fuera.
- `NONE` → `[]` en listas (sin emitir consulta) y 403 en por-ID. Nunca "sin filtro".
- Las escrituras llevan `companyId` en su propio `WHERE`, aunque el llamador ya haya pasado la guarda.
- Estilos de respuesta por familia: equipos usa `ApiHandler.success/error` (`{success, data}`); service-orders usa `NextResponse.json` + `isApiError`. Respeta el estilo de cada familia.
- **Contrato de fechas roto (hallazgo para T05, no tocar antes):** el POST de `/api/equipment` acepta `z.string()`, el PUT de `[id]` exige `z.string().datetime()` en `purchaseDate/nextMaintenanceDate/lastMaintenanceDate`, y el formulario manda `YYYY-MM-DD` desde `<Input type="date">`. Reconectar el formulario al PUT sin unificar esto devuelve 400 al primer cambio de fecha.
- `tests/` está excluido del `tsconfig.json`; los specs Playwright importan con `../lib/...` y resuelven `@/` vía tsconfig paths (funciona: `equipment-isolation.spec.ts` importa `equipmentService`).
- Diseño: Geist, superficies tonales sin sombras, rojo acotado (ver `PRODUCT.md` / `DESIGN.md`).

## 6. Pendiente inmediato (en orden)

### 6.1 Spec de T04 — `tests/equipment-relations.spec.ts` (Playwright, mismo formato que `equipment-isolation.spec.ts`)

Siembra con `sql` de `tests/support/db.ts` + `E2E_TAG` (limpieza en `afterEach`):
- empresas A/B → `INSERT INTO companies (name)`; sucursales A1/A2/B1 → `branches(company_id, name)`.
- equipos → `branch_equipments(company_id, branch_id, name, equipment_code, type='REFRIGERATOR', created_by=USER_SUPER_ADMIN)`.
- proveedores → `suppliers(company_id, name)`; `service_providers(company_id, name, services, created_by)` — **`services` es jsonb NOT NULL** (p. ej. `'["FUMIGATION"]'::jsonb`).
- **órdenes: crearlas con `createDraft(...)` del servicio** (genera folio único `DRAFT-*`; `service_orders.folio` es UNIQUE, no la siembres a mano salvo la orden `APPROVED` para transiciones, con folio `E2E-...` único).
- servicios periódicos → `branch_compliance_services(company_id, branch_id, service_type='FUMIGATION', service_name, frequency='MONTHLY', created_by)`.

Casos de servicio (sin servidor):
1. `createDraft` con `equipmentId` **ajeno** → 400 "El equipo indicado no pertenece a la empresa" y **cero filas** nuevas en `service_orders` (contar antes/después).
2. `createDraft` con equipo de **otra sucursal** de la misma empresa → 400 "…no pertenece a la sucursal de la orden".
3. `createDraft` válido con equipo propio → crea la orden (limpiar).
4. `createDraft` con `branchId` ajena → 400 (regresión de `assertBranchInCompany`); con `supplierId` ajeno → 400 (regresión).
5. `updateDraft` con `equipmentId` ajeno → 400 y la orden conserva su `equipmentId` original; `updateDraft` de una orden de otra sucursal con alcance BRANCH → 403 y sin cambios.
6. `getOrderDetail` con alcance BRANCH(A1) sobre orden de A2 → 403; con ALL → detalle completo (`order.branchId`, quotes/evidence vacíos).
7. `transitionOrder` con alcance que no cubre → 403 y el status no cambia; con alcance propio y orden `APPROVED` → `SCHEDULED`.
8. `createComplianceService` con `branchId` ajena → 400 (mensaje de `assertBranchOfCompany`) y sin fila; con `providerId` ajeno → 400 "El proveedor de servicio indicado no pertenece a la empresa" y sin fila; válido → fila.

Casos HTTP (con `next dev`): `POST /api/service-orders` con equipo ajeno → 400 y sin fila; `PATCH {action}` de una orden de otra sucursal → 403.

Para correr el bloque de servicio sin servidor: recrear la config temporal `tmp-probe-pw.config.ts` (testDir ./tests, 1 worker, sin webServer ni projects), correr `pnpm exec playwright test --config=tmp-probe-pw.config.ts --grep-invert "las rutas HTTP" tests/equipment-relations.spec.ts` y **borrar la config al terminar** (mismo patrón que T03).

Limpieza en `afterEach` (orden por FKs): `service_order_quotes`/`service_order_evidence` → `service_orders` → `branch_compliance_services` → `service_providers` → `suppliers` → equipos (warranties/alerts/schedules/history primero) → `branches` → `companies`.

### 6.2 Cerrar T04

Marcar las casillas de T04 en el todo + nota de evidencia (mencionar que `app/api/service-orders/[id]/route.ts` se añadió a lo previsto por el criterio 3 y que las 2 rutas previstas restantes no necesitaron cambios).

### 6.3 Checkpoint C01 y cierre del bloque

`pnpm test:unit` completo, lint focalizado y **`pnpm run build` con los cambios de T03/T04** (≈6 min; ver §7). Luego marcar las 3 casillas de C01 en el todo.

### 6.4 Siguiente bloque

T05 (identidad/centavos/fechas, ver hallazgo en §5) → T06 (programación ≠ ejecución) → T07, T08 → Checkpoint C02 (después de T06). Cada tarea lista sus 5 archivos en el todo.

### 6.5 Limpieza de logs

`tmp-build.txt` (build OK de la fase T02), `tmp-unit-all.txt` y `tmp-equip2.txt` (corridas unitarias) son evidencia en la raíz; borrarlos al cerrar el bloque.

## 7. Riesgos / notas de ambiente

- **RAM: 7.2 GB totales, ~1.1 GB libres.** El OOM previo de `next build` fue de **sistema**, no de código. Correr el build solo y en serie, con `$env:NODE_OPTIONS='--max-old-space-size=3072'` (el build exitoso usó 3072 y tardó 5.6 min). Nada pesado en paralelo.
- **No hay dev server en :3000** (verificado). El grupo HTTP de los specs exige levantarlo, y `playwright.config.ts` además arranca el Inngest dev server: en este equipo es arriesgado por memoria, por eso el bloque de servicio se corre con la config temporal sin `webServer`.
- Un `next start`/`next dev` **huérfano** en :3000 envenena la suite (`reuseExistingServer` lo reutiliza y sirve chunks viejos → `ChunkLoadError` que parece de tu cambio). Ver `tasks/handoff-inventory-waste.md` §7 antes de correr E2E con servidor.
- `strict: false` en tsconfig: validar siempre con `npx tsc --noEmit` antes de commitear.
- Base de desarrollo **Neon compartida**: todo dato de prueba con `E2E_TAG` y limpieza en `afterEach`. Sólo hay una empresa real sembrada (`COMPANY_ID` en `tests/support/constants.ts`); lo cross-tenant se siembra sintético (empresas/sucursales temporales) y se borra.
- `lib/equipment/scope.ts`: `assertScopeCoversBranch` la consume `equipment-service`; `scopeCoversBranch` (predicado puro) hoy sólo la usan sus tests — adoptarla en T12/T15 o retirarla si nadie la usa.
- Los `\`` (backticks) dentro de comandos PowerShell escapan: para sondas con SQL, escribir un script temporal en `scripts/tmp-*.ts` y borrarlo, no `tsx -e`.

## 8. Archivos de esta sesión (toca / ajeno)

De esta tarea (T02–T04):

- `lib/equipment/scope.ts` (nuevo)
- `lib/services/equipment-service.ts`
- `lib/services/service-order-service.ts`
- `app/api/equipment/route.ts`
- `app/api/equipment/[id]/route.ts`
- `app/api/equipment/[id]/warranty/route.ts`
- `app/api/equipment/[id]/maintenance/route.ts`
- `app/api/service-orders/[id]/route.ts`
- `lib/services/__tests__/equipment-scope.test.ts` (nuevo)
- `tests/equipment-isolation.spec.ts` (nuevo)
- `tasks/todo-qeuipos-grupo-resturantero.md` (casillas + evidencia de T02/T03)
- `tasks/handoff-qeuipos-grupo-resturantero.md` (este archivo)

Ajenos en el working tree — **NO commitear juntos, otro stream los trae**:

`components/app-sidebar.tsx` (es T09 de este mismo plan, pero de otra sesión: coordinar antes de tocar), `app/api/group/exceptions/route.ts`, `app/api/group/branches-qsr/`, `app/api/group/live-pulse/`, `app/dashboard/analytics/**`, `app/dashboard/branches/**`, `app/dashboard/exceptions/page.tsx`, `app/dashboard/page.tsx`, `components/analytics/branch-performance-score-card.tsx`, `components/dashboard/live/`, `lib/services/cross-branch-service.ts`, `lib/services/group-exceptions-service.ts`, `lib/services/live-command-service.ts`, `lib/services/__tests__/{cross-branch-qsr,group-exceptions-service,live-command-service}.test.ts`, `scripts/seed-12-sales-pos.ts`, `tsconfig.json`, `tasks/plan.md`, `tasks/todo.md`.

## 9. Anclas de archivos (referencia rápida)

- Adaptador de alcance: `lib/equipment/scope.ts` — `resolveEquipmentScope` :35, `scopeCoversBranch` :45, `assertScopeCoversBranch` :70.
- Guardas de equipos: `lib/services/equipment-service.ts` — `getEquipmentById` :261, `getEquipmentInScope` :293, `getEquipmentWithDetails` :365, `getMaintenanceInScope` :536, `createComplianceService` :678.
- OS: `lib/services/service-order-service.ts` — `getOrderDetail` :113, `assertOrderInScope` :214, `assertEquipmentInOrderBranch` :288, `validateReferences` :303, `updateDraft` :399, `transitionOrder` :659. Rutas: `app/api/service-orders/route.ts` (GET/POST) y `app/api/service-orders/[id]/route.ts` (GET/PATCH: update + transiciones).
- Precedente del patrón 404/403 por alcance: `lib/services/expense-service.ts:52`.
- Alcance compartido: `lib/branch-scope.ts` (`resolveBranchScope`, `assertBranchOfCompany`, `isBranchScopedRole`).
- Sesión: `lib/tenant-context.ts` (`requireAuth` → `{user{role,branchId}}`, `requireTenant` → `{id,userId,branchId}`; la cookie de sucursal activa ya viene resuelta en `tenant.branchId`).
- Specs de referencia: `lib/services/__tests__/equipment-scope.test.ts` (arnés vitest con `mockDb` por tabla), `tests/equipment-isolation.spec.ts` (formato del spec de T04), `tests/frontera-tenant-sucursal.spec.ts`. Soporte: `tests/support/db.ts` (`sql`, `seedForeignTenant`, `seedTestBranch`, `deleteTestBranch`, `cleanupForeignTenant`), `tests/support/constants.ts` (`COMPANY_ID`, `BRANCH_CONDESA`, `USER_SUPER_ADMIN`, `E2E_TAG`).

## 10. Referencias

- Plan: `tasks/plan-qeuipos-grupo-resturantero.md` (base revisada, riesgos, decisiones pendientes).
- Propuesta de origen: `plans/2026-09-16-rediseno-equipos-grupo-restaurantero.md`.
- Contexto: `PROJECT_CONTEXT.md`; diseño: `PRODUCT.md` / `DESIGN.md`; reglas: `AGENTS.md`.