# Todo — Fase 1: Contrapartes (payees) para gastos operativos

Plan: `tasks/plan-payees-contrapartes.md` · Handoff: `tasks/handoff-payees-contrapartes.md` (fuente de verdad)

## Task 1: Esquema — tabla `payees` + `operatingExpenses.payeeId`
- [x] Definir `payees` en `lib/db/schema.ts` (companyId, name, taxId, contactName, email, phone, active, timestamps)
- [x] Índice único `(companyId, lower(name))`
- [x] `operating_expenses.payee_id` nullable con FK a `payees.id`
- [x] `pnpm db:generate` → migración `0045_*.sql` (aplicada)
- [x] `pnpm run build` limpio

## Task 2: `payee-service.ts` + API `/api/finance/payees`
- [x] Servicio: list (búsqueda), create, deactivate — tenant-scoped
- [x] POST audita con `AuditService` (enum `PAYEE` agregado, migración 0046)
- [x] POST rechaza vacío y duplicado con 400 legible (case-insensitive, + catch 23505)
- [x] GET filtra por empresa/active/search
- [x] 401 sin sesión (via `requireTenant`/`requireAuth`)
- [x] `pnpm run build` limpio
- [x] Verificado en runtime (script de capa de datos): crear, duplicar (400), listar, buscar

## Task 3: Gastos — payeeId en POST, payeeName en GET
- [x] `createExpenseSchema` acepta `payeeId` opcional (uuid)
- [x] Servicio valida que el payee exista y sea de la misma empresa (400, sin leak)
- [x] `getOperatingExpenses` leftJoin a `payees` → `payeeId` + `payeeName`
- [x] Sin regresión: gasto sin `payeeId` se crea igual
- [x] `pnpm run build` limpio

## ✅ Checkpoint: capa de datos (Tasks 1-3)
- [x] Migración aplicada y ambiente servible (0045 + 0046)
- [x] API: crear payee → gasto con payee → GET devuelve `payeeName` (verificado en runtime)
- [x] Revisión del modelo (A1/A2) — ver §8 del handoff (decisiones abiertas)

## Task 4: CxP — agrupar por contraparte real
- [x] leftJoin `payees` en `accounts-payable-service.ts`
- [x] `counterparty = payeeName ?? category`
- [x] Llave de agrupación `payee:<id>` / `label:<categoría>`
- [x] `payeeId` opcional en `PayableItem` y `CounterpartyTotal`
- [x] Buckets, orden y `missingDueDateCount` intactos
- [x] `pnpm run build` limpio

## Task 5: ExpenseForm — Select "A quién le pagas" + creación rápida
- [x] Cargar payees activos desde `/api/finance/payees`
- [x] Select opcional + "+ Nueva contraparte" (nombre, RFC opcional)
- [x] Al crear al vuelo, queda seleccionada — ⚠️ ver fix Radix §4.1 del handoff
- [x] Reset del estado al abrir/cerrar diálogo
- [x] Gastos casuales siguen sin requerir payee
- [x] `pnpm run build` limpio

## Task 6: Tabla de gastos + página catálogo + enlace portada
- [x] Columna "Contraparte" en `expenses/page.tsx` (`payeeName` o "—")
- [x] `/dashboard/finance/payees`: lista, crear, dar de baja (lógica, con confirmación)
- [x] Baja lógica no toca gastos históricos (verificado)
- [x] Enlace en `SUBSECTIONS` de la portada
- [x] `pnpm run build` limpio

## Task 7: Payables — copy y encabezados honestos
- [x] "Por proveedor" → "Por contraparte" (donde sea gasto operativo)
- [x] Descripción del agrupamiento actualizada
- [x] `pnpm run build` limpio

## ✅ Checkpoint: superficies (Tasks 4-7)
- [x] Flujo validado en runtime (crear payee → gasto con payee → CxP agrupada)
- [x] Sin regresión visual en CxP para facturas — run E2E completo 27/27 (incl. recepcion-workflow + payees)
- [x] Revisión humana del diff antes del commit

## Task 8: E2E — `payee.spec.ts`
- [x] Crear contraparte → gasto con payee → CxP agrupada por contraparte (4/4 verdes en run completo)
- [x] Gasto casual → agrupado por categoría (pasó en run completo)
- [x] Catálogo: crear + baja lógica (pasó en run completo)
- [x] Helpers de limpieza en `tests/support/db.ts`
- [x] `pnpm test:e2e tests/payee.spec.ts` → **4/4 passed** (2026-08-10, re-corrido tras run abortado)
- [x] `gasto-evidencia.spec.ts` → **2/2 passed** (regresión del form OK)

## ✅ Checkpoint: completa
- [x] Todas las acceptance criteria cumplidas (suite completa **27/27 passed** — 2.4m)
- [x] `pnpm run build` limpio (verificado de nuevo antes del commit)
- [x] `npx tsc --noEmit` limpio (exit 0)
- [x] Datos residuales de test: **0** (afterAll limpia; verificado contra la base)
- [x] Commit separado del trabajo ajeno de facturas (solo archivos de §5 "de esta tarea")

---

## Fuera de alcance (decisiones pendientes, ver Open Questions del plan)
- [ ] Fase 2: generalizar CLABE a `payees` (requiere aprobación explícita)
- [ ] Fase 3: `suppliers` como payees especializados (`kind='SUPPLIER'`)
- [ ] Polish XS: mostrar `payeeName` en Flujo de Caja y Control Interno