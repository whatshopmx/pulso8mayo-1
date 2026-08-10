# Implementation Plan: Fase 1 — Contrapartes (payees) para gastos operativos

## Overview

**El problema (diagnóstico verificado en código, 2026-08):** el módulo de finanzas modeló
"a quién le pagamos" con la entidad `suppliers`, que en el esquema es 100% una entidad de
inventario (3-way match, `supplier_items`, `supplier_claims`, `invoices` ligados a OC/recepción).
Las consecuencias:

1. `operating_expenses` no tiene contraparte: solo `category` + `description`. El "a quién"
   (arrendador, CFE, gas, contador) queda enterrado en la descripción.
2. `supplier_bank_accounts.supplier_id NOT NULL → suppliers` y la pantalla de CLABE lista
   `/api/inventory/suppliers`: la renta (suele ser el mayor costo fijo operativo) **no puede
   tener cuenta bancaria** y queda fuera de todo flujo de tesorería futuro.
3. CxP (`accounts-payable-service.ts`) agrupa gastos operativos por **categoría**
   (`counterparty: row.category`), así que la tabla "Por proveedor" responde "RENTA" en vez
   de "Inmobiliaria X".

**Esta fase arregla la raíz sin tocar la máquina antifraude de CLABE (que está bien):
introduce la entidad `payees` (contraparte/beneficiario) y la conecta a los gastos
operativos y a la CxP.** Es la Fase 1 del plan de 3 fases:

- **Fase 1 (esta):** `payees` + `operating_expenses.payee_id` + gasto captura beneficiario +
  CxP agrupa por contraparte real.
- **Fase 2 (pendiente de decisión):** generalizar las cuentas bancarias (CLABE) para que viva en
  `payees`, no en `suppliers`. La ingeniería de `supplier-bank-account-service.ts` se reusa tal cual.
- **Fase 3 (pendiente de decisión):** dato maestra única — `suppliers` pasa a ser una contraparte
  especializada (`suppliers.payee_id` FK), RFC/CLABE viven una sola vez.

## Architecture Decisions

### A1. `payees` es la contraparte, límite por empresa

```ts
export const payees = pgTable("payees", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  taxId: text("tax_id"),                       // RFC — opcional: plomero/ferretería no emiten CFDI
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  active: boolean("active").default(true).notNull(), // baja lógica, igual que suppliers
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Antifragmentación: "CFE" y "Comisión Federal de Electricidad" son la misma contraparte.
  payeesCompanyNameUnique: uniqueIndex("payees_company_name_unique").on(
    table.companyId, sql`lower(${table.name})`
  ),
}));
```

**Sin `kind` en esta fase** (YAGNI): `kind='SUPPLIER'` entra en Fase 3 cuando los suppliers se
vuelvan payees. Agregar una columna con default es una migración trivial.

### A2. `operating_expenses.payee_id` NULLABLE

Los gastos casuales (taxi, hielo, plomero) no tienen contraparte recurrente y **no deben forzar
crear un catálogo**. `payee_id` opcional; los que lo tienen son los que alimentan "a quién le
debo" y (en Fase 2) el flujo de CLABE/lote.

### A3. CxP: agrupar por contraparte, caer a categoría

En `accounts-payable-service.ts`: `counterparty = payeeName ?? category`; llave de agrupación
`payee:<id>` cuando hay payee, `label:<categoría>` cuando no (comportamiento actual).
El campo `supplierId` del item queda `null` — el filtro `supplierId` de `/api/finance/payables`
sigue aplicando solo a facturas de mercancía (mezclar "supplier y payee" en un filtro es la
decisión de Fase 3).

### A4. API: mismo patrón que la superficie de captura existente

`/api/finance/payees` (GET listado+búsqueda, POST create) con `requireTenant` + `requireAuth`
de `lib/tenant-context.ts`, igual que `/api/expenses`. Audit con `AuditService` al crear
(patrón de `/api/inventory/suppliers`). `POST /api/expenses` acepta `payeeId` opcional y el
**servicio** valida que el payee sea de la misma empresa (patrón de ownership de
`supplier-bank-account-service.ts`, no confiar en el cliente).

### A5. UI sin fricción

- Form de gasto: Select "A quién le pagas" (opcional) + botón "+ Nueva contraparte" con
  mini-form (nombre obligatorio, RFC opcional) que hace POST a `/api/finance/payees` y la
  selecciona. Un select obligatorio mataría la captura de gastos casuales.
- Página catálogo `/dashboard/finance/payees` (lista, crear, dar de baja) enlazada desde la
  portada, siguiendo el patrón de la página de suppliers de inventario.
- Los gastos viejos sin payee muestran "—" en la columna Contraparte. **Nada se muta retroactivamente.**

### A6. Piso de tipos

El proyecto compila con `strict: false`: seguir el patrón documentado en el repo para uniones
discriminadas (`=== false` explícito en vez de negación, y aplanar la unión en el cliente).
Ver `supplier-bank-accounts/page.tsx` y `clabe.ts` — no introducir narrowing frágil.

## Task List

### Task 1: Esquema — tabla `payees` + `operatingExpenses.payeeId`

**Description:** Agregar la tabla `payees` y la columna `payee_id` nullable en
`operating_expenses` con FK, según A1/A2. Generar la migración con `pnpm db:generate`.
No hay migración de datos: la columna nueva es nullable.

**Acceptance criteria:**
- [ ] `payees` queda definida con índice único por `(companyId, lower(name))`
- [ ] `operating_expenses.payee_id` nullable con FK a `payees.id`
- [ ] `pnpm db:generate` produce la migración `0045_*.sql` (o el número siguiente)

**Verification:** `pnpm run build` limpio; `pnpm db:generate` sin diff pendiente después de correr.

**Dependencies:** None

**Files likely touched:**
- `lib/db/schema.ts`
- `drizzle/0045_*.sql` (generado)

**Estimated scope:** Small (1-2 files)

### Task 2: `payee-service.ts` + `GET/POST /api/finance/payees`

**Description:** Servicio tenant-scoped (listado con búsqueda, create, deactivate) y ruta API
siguiendo A4. Rechazar duplicados por nombre con 400 legible (no constraint de Postgres).

**Acceptance criteria:**
- [ ] POST crea payee de la empresa del tenant y audita (`AuditService`)
- [ ] POST rechaza nombre vacío y duplicado (case-insensitive) con 400 explicativo
- [ ] GET filtra por empresa, respeta `active` y busca por `search` (nombre/RFC/contacto)
- [ ] Sin usuario autenticado → 401

**Verification:** `pnpm run build`; prueba manual con curl: crear, duplicar, listar, buscar.

**Dependencies:** Task 1

**Files likely touched:**
- `lib/services/payee-service.ts` (nuevo)
- `app/api/finance/payees/route.ts` (nuevo)

**Estimated scope:** Small (2 files)

### Task 3: Gastos — `payeeId` en POST y `payeeName` en GET

**Description:** `createExpenseSchema` acepta `payeeId` opcional (uuid). El servicio valida que
el payee exista y sea de la misma empresa (400 si no). `getOperatingExpenses` hace leftJoin a
`payees` y devuelve `payeeId` + `payeeName`.

**Acceptance criteria:**
- [ ] Crear gasto con `payeeId` válido lo persiste
- [ ] `payeeId` de otra empresa → 400 con mensaje claro (sin leak de datos)
- [ ] GET devuelve `payeeName` para cada gasto; gasto sin payee → `payeeName: null`
- [ ] Gastos sin `payeeId` siguen creándose igual que hoy (sin regresión)

**Verification:** `pnpm run build`; curl: gasto con/sin payee; payee cross-tenant rechazado.

**Dependencies:** Tasks 1, 2

**Files likely touched:**
- `lib/services/expense-service.ts`
- `app/api/expenses/route.ts`

**Estimated scope:** Small (2 files)

### Checkpoint: capa de datos (Tasks 1-3)

- [ ] Migración aplicada (el ambiente de desarrollo queda servible)
- [ ] Build limpio
- [ ] vía API: crear payee → crear gasto con ese payee → GET devuelve `payeeName`
- [ ] Revisión humana de la decisión de modelo antes de seguir (A1/A2)

### Task 4: CxP — agrupar por contraparte real

**Description:** En `accounts-payable-service.ts`, leftJoin `payees` en gastos; `counterparty`
pasa a `payeeName ?? category`; llave de agrupación `payee:<id>` vs `label:<category>`.
`PayableItem` y `CounterpartyTotal` ganan `payeeId` opcional.

**Acceptance criteria:**
- [ ] Gastos con payee se agrupan por contraparte real ("Inmobiliaria X", no "RENTA")
- [ ] Gastos casuales sin payee se agrupan por categoría (comportamiento actual)
- [ ] `missingDueDateCount`, buckets y orden por urgencia no cambian
- [ ] Filtro `supplierId` sigue omitiendo gastos (semántica de Factura, se documenta)

**Verification:** `pnpm run build`; prueba con datos: dos gastos al mismo payee suman en una fila.

**Dependencies:** Task 3

**Files likely touched:**
- `lib/services/accounts-payable-service.ts`
- `lib/services/accounts-payable-types.ts`

**Estimated scope:** Small-Medium (2 files)

### Task 5: ExpenseForm — Select "A quién le pagas" + creación rápida

**Description:** El form de gasto carga `/api/finance/payees` (solo activos). Select opcional +
botón "+ Nueva" con mini-form (nombre, RFC opcional) que POSTea y selecciona el payee creado.
Resetear el estado al cerrar el diálogo, como el resto del form.

**Acceptance criteria:**
- [ ] Se puede registrar un gasto indicando contraparte existente
- [ ] Se puede crear la contraparte al vuelo (un solo diálogo extra, no otra página)
- [ ] Un gasto casual se puede registrar sin tocar el select (sigue siendo opcional)
- [ ] El estado del nuevo campo se limpia al abrir/cerrar el diálogo

**Verification:** `pnpm run build`; manual en `/dashboard/finance/expenses`.

**Dependencies:** Tasks 2, 3

**Files likely touched:**
- `components/finance/expense-form.tsx`

**Estimated scope:** Medium (1 archivo pesado)

### Task 6: Tabla de gastos — columna Contraparte + página catálogo + enlace portada

**Description:** Columna "Contraparte" en el listado (`payeeName` o "—"). Página
`/dashboard/finance/payees` (lista con búsqueda, crear, dar de baja con confirmación)
siguiendo el patrón de inventory/suppliers. Enlace en `SUBSECTIONS` de la portada.

**Acceptance criteria:**
- [ ] La tabla de gastos muestra la contraparte; gastos históricos sin payee muestran "—"
- [ ] El catálogo lista, crea y da de baja (lógica) payees; al dar de baja no se tocan gastos históricos
- [ ] La portada de Finanzas enlaza al catálogo de contrapartes

**Verification:** `pnpm run build`; navegación manual completa; el gasto de un payee dado de baja sigue visible.

**Dependencies:** Tasks 4, 5

**Files likely touched:**
- `app/dashboard/finance/expenses/page.tsx`
- `app/dashboard/finance/payees/page.tsx` (nuevo)
- `app/dashboard/finance/page.tsx`

**Estimated scope:** Medium (3 files)

### Task 7: Payables — copy y encabezados honestos

**Description:** El título de tarjeta y descripciones en `/dashboard/finance/payables` dejan de
llamar "Proveedor" a lo que ahora es "Contraparte". "Por proveedor" → "Por contraparte";
"Los gastos operativos se agrupan por categoría" → "se agrupan por contraparte; los gastos
casuales, por categoría".

**Acceptance criteria:**
- [ ] Ningún encabezado llama "Proveedor" a un gasto operativo
- [ ] El texto explica el agrupamiento nuevo sin que un auditor lo lea mal

**Verification:** `pnpm run build`; lectura de la página.

**Dependencies:** Task 4

**Files likely touched:**
- `app/dashboard/finance/payables/page.tsx`

**Estimated scope:** XS (1 file)

### Checkpoint: superficies (Tasks 4-7)

- [ ] Flujo completo en UI: crear contraparte → gasto con payee → CxP agrupada por contraparte
- [ ] Sin regresión visual en CxP para facturas (solo cambia el agrupamiento de gastos)
- [ ] Revisión humana antes de tests

### Task 8: E2E — `payee.spec.ts` y helpers

**Description:** Test Playwright: crear contraparte, registrar gasto con payee, verificar que CxP
lo agrupa por contraparte; y un gasto casual que sigue agrupándose por categoría. Helpers de
limpieza en `tests/support/db.ts` (borrar payees y gastos de test, patrón
`deleteTestExpenses`).

**Acceptance criteria:**
- [ ] `pnpm test:e2e -- --grep "contraparte"` pasa
- [ ] `gasto-evidencia.spec.ts` sigue pasando (el form funciona sin tocar el select nuevo — el
      campo es opcional y los `locator` existentes no cambian)

**Verification:** `pnpm test:e2e` (suites de finanzas).

**Dependencies:** Tasks 5, 6, 7

**Files likely touched:**
- `tests/payee.spec.ts` (nuevo)
- `tests/support/db.ts`
- `tests/support/constants.ts` (si hace falta un tag)

**Estimated scope:** Medium (2-3 files)

### Checkpoint: completa

- [ ] Todas las acceptance criteria de Tasks 1-8 cumplidas
- [ ] `pnpm run build` limpio
- [ ] `pnpm test:e2e` verde en finanzas
- [ ] Revisión humana del diff completo

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Migración sobre datos existentes | Low | `payee_id` nullable: no requiere backfill; gastos históricos siguen visibles con "—" |
| Fricción de captura (select obligatorio mata gastos casuales) | Medium | Payee opcional + creación al vuelo en el propio form (A5) |
| Duplicados de contraparte ("CFE" vs "Luz") | Medium | Índice único `(companyId, lower(name))` + búsqueda en el select |
| `strict: false` rompe narrowing de uniones | Low | Seguir el patrón `=== false` / aplanar uniones documentado en el repo |
| El filtro `supplierId` de CxP confunde suppliers con payees | Low | Se documenta que el filtro aplica a facturas; unificar es decisión de Fase 3 |
| Alcance crece hacia Fase 2 (CLABE) | Medium | Esta fase NO toca `supplier_bank_accounts`; se corta en el checkpoint de datos |

## Open Questions

- **¿Fase 2 arranca al cerrar esta?** Generalizar la CLABE para que viva en `payees`
  (renombrar `supplier_bank_accounts` → `payee_bank_accounts`, migrando suppliers existentes a
  payees con `kind`). Requiere aprobación explícita: toca el módulo más sensible del repo.
- **¿RFC obligatorio para contrapartes?** Propuesta: opcional en Fase 1 (hay gastos sin CFDI).
  Si el usuario quiere forzarlo para renta/servicios, se agrega una regla por categoría.
- **¿Mostrar contraparte en Flujo de Caja y Control Interno?** Es polish XS opcional (mostrar
  `payeeName` junto a la descripción en `cash-flow-calendar` y la bitácora). Fuera de alcance
  salvo que el usuario lo pida.