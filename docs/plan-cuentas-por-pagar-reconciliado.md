# Cuentas por pagar y control de tesorería — plan reconciliado con el esquema real

> Este documento **reemplaza** al spec original de "Cuentas por pagar, autorización
> por umbral y control de tesorería" como plan de implementación. Conserva su
> tesis y su orden de fases; corrige los nombres de tablas, elimina duplicados
> contra lo ya construido, y resuelve las decisiones que el spec dejaba abiertas.
>
> El spec original se escribió sin el esquema actual a la vista. Seguido al pie
> de la letra habría creado un esquema paralelo al que ya existe.

---

## 0. La tesis no cambia

El producto es la **capa de autorización**, no la ejecución del pago.

```
Gerente / compras  → captura documento (con evidencia)      [prepara]
Sistema            → 3-way match + umbral + CLABE verificada [controla]
Dueño / tesorería  → aprueba el lote                         [autoriza]
Banco              → ejecuta (layout o API)                  [libera]
```

Y el control antifraude principal no es la factura falsa: es **cambiarle la
CLABE a un proveedor real**.

---

## 1. Correcciones de nomenclatura

El spec referencia entidades que no existen con ese nombre:

| Spec original | En este repo |
|---|---|
| `tenants(id)` | `companies(id)` |
| `sucursales(id)` | `branches(id)` |
| `proveedores` | `suppliers` (ya existe) |
| `operating_expenses(id)` | `operating_expenses` ✅ correcto |
| `receiving_reports(id)` | `receiving_reports` ✅ correcto |

**Decisión: tablas nuevas en inglés**, como el resto del núcleo financiero
(`suppliers`, `invoices`, `operating_expenses`, `receiving_reports`). El repo
tiene alguna excepción en español (`propinas`), pero la convención dominante en
finanzas es inglés y mezclar idiomas dentro del mismo módulo hace que las joins
se lean mal.

---

## 2. Qué ya existe y no debe duplicarse

### 2.1 `suppliers` — no crear `proveedores`

Ya tiene `name`, `taxId` (RFC), `contactName`, `email`, `phone`, `active`,
`matchTolerancePercent` y `paymentTermsDays`. Cubre §1.1 completo.

**Acción:** ninguna. Usar `suppliers` tal cual.

### 2.2 `expense_authorization_rules` — extender, no crear `reglas_autorizacion`

Existente (`schema.ts:2757`):

```
companyId, branchId, minAmount, maxAmount, approverRole
```

Le faltan dos columnas del spec §3.1:

```
requiresDoubleSignature  boolean NOT NULL DEFAULT false
sortOrder                integer NOT NULL DEFAULT 0   -- resolver traslapes
```

**Decisión: extender.** Crear `reglas_autorizacion` al lado dejaría dos matrices
de umbral compitiendo, y `expense_authorization_rules` ya es la que consulta el
flujo de aprobación de gastos.

**Nota:** su `approverRole` guarda `'DIRECTOR_OPS'`, que **no existe** en el enum
de `users.role` (`SUPER_ADMIN | OWNER | ADMIN | GERENTE | SUPERVISOR | EMPLEADO |
READONLY`). Hay que decidir si se agrega el rol al enum o si `DIRECTOR_OPS` se
mapea a `ADMIN`. Hoy una regla que exija `DIRECTOR_OPS` no la puede satisfacer
nadie.

### 2.3 `payment_approvals` — completar, no crear `aprobaciones_pago`

Existe en `lib/db/schema/security.ts:92`, creada por la migración `0028`, y
documentada en `docs/pulso-executive-os-security.md` §5.4 como el mecanismo de
doble aprobación para pagos sobre umbral.

**Tiene cero consumidores en el código.** Es diseño intencional que nunca se
cableó.

```
companyId, branchId, amountCents, currency,
paymentRef (text opaco), paymentRefType ('PAYROLL'|'INVOICE'|'MANUAL'),
status (PENDING|APPROVED|REJECTED|EXECUTED),
requestedBy, approvedBy, secondApprovedBy,
requestedAt, approvedAt, executedAt, notes
```

Comparada con `aprobaciones_pago` del spec §3.2, son **dos cosas distintas**:

- `payment_approvals` = **una fila por pago que requiere autorización**, con
  ciclo de vida mutable.
- `aprobaciones_pago` = **una fila por decisión** (append-only; dos filas para
  doble firma), con el rol congelado y la regla aplicada.

El spec exige explícitamente *"Nunca hacer UPDATE ni DELETE sobre esta tabla —
solo INSERT"*. `payment_approvals` no puede cumplirlo: llenar `approvedBy` y
después `secondApprovedBy` **es** un UPDATE.

**Decisión: las dos, con roles separados.**

1. `payment_approvals` se queda como el **sobre de autorización** (qué se está
   autorizando, por cuánto, en qué estado). Se le agrega `'PAYABLE'` a
   `paymentRefType`.
2. Se crea `payment_approval_events` como la **bitácora append-only** que pide
   §3.2, con lo que a `payment_approvals` le falta y no puede tener:

```sql
payment_approval_events (
  id, companyId,
  paymentApprovalId  → payment_approvals(id),
  payableId          → payables(id),
  decidedBy          → users(id),
  roleAtDecision     text NOT NULL,   -- congelado, no FK viva
  decision           text NOT NULL CHECK (decision IN ('APPROVED','REJECTED')),
  comment            text,
  appliedRuleId      → expense_authorization_rules(id),
  createdAt          timestamptz NOT NULL DEFAULT now()
)
```

`roleAtDecision` congelado es el punto: el rol del usuario puede cambiar después
y la bitácora debe reflejar el momento de la firma.

### 2.4 Ya construido en esta rama

- `suppliers.payment_terms_days` (migración 0039/0040) → es el insumo de
  `fecha_vencimiento` del spec §2.
- `invoices.due_date`, `payment_status`, `paid_at`, `paid_by`, `payment_notes`.
- `accounts-payable-service.ts` con antigüedad y `/dashboard/finance/payables`.

**Lo que sobrevive:** la vista de antigüedad y el vencimiento derivado de los
días de crédito. El spec no cubre el modelo de lectura y sigue siendo necesario.

**Lo que se revierte:** `markInvoicePaid` / `markExpensePaid`. Permitían que un
`GERENTE` marcara un CFDI como pagado de un clic, sin umbral, sin doble firma,
sin lote y sin conciliación — exactamente el control que §0 y §3 venden. Además
`invoices.payment_status` (`PENDING|PAID|CANCELLED`) colapsa la máquina de seis
estados y funde `EJECUTADO` con `CONCILIADO`, que §6 separa a propósito.

---

## 3. Un punto del spec que ya no aplica

§7 pide cerrar el TODO de verificación multi-tenant en `lib/tenant-context.ts:30`
antes de shipear el módulo.

**Ya está cerrado.** Hoy hay una verificación real:

```ts
if (headerTenantId !== session.user.companyId) {
  throw ApiError.forbidden("You do not have access to the requested tenant.");
}
```

Un bloqueante menos.

---

## 4. Decisión: materializar `payables`

El servicio actual calcula la unión de facturas y gastos **en tiempo de lectura**.
Eso sirve para una vista de antigüedad, pero **no puede sostener el módulo**: de
una vista calculada no se puede colgar estado por documento —membresía de lote,
CLABE congelada al cierre, bitácora de aprobaciones—.

**Decisión: materializar**, como propone el spec §2.

`invoices` y `operating_expenses` pasan a ser **orígenes**; `payables` es el
libro. Las FK opcionales por origen (`invoiceId`, `operatingExpenseId`,
`receivingReportId`) más `UNIQUE (companyId, cfdiUuid)` son lo que evita el doble
conteo — el spec ya lo tenía bien pensado.

El servicio de antigüedad se reescribe para leer de `payables` en vez de unir
dos tablas.

---

## 5. Lo genuinamente nuevo

Nada de esto existe en el repo:

- **`supplier_bank_accounts`** (§1.2). El único `clabe` del sistema está en
  `employee_profiles` (nómina); para proveedores no hay nada. Incluye el índice
  único parcial de "una sola CLABE verificada activa por proveedor".
- **Validación matemática de CLABE** — dígito verificador Banxico + banco
  registrado. Local, gratis, descarta typos. Siempre, antes de cualquier
  verificación de titularidad.
- **`VerificadorTitularidad`** con `VerificadorManual` en fase 1. La premisa del
  spec es correcta: en México no existe lookup de nombre por CLABE; el único
  mecanismo real es la prueba de centavo con el CEP de Banxico.
- **`payment_batches` + `payment_batch_items`** (§4), con congelado de cuenta y
  monto al cerrar.
- **Layout bancario** (§5), un solo banco.
- **Conciliación** (§6), manual en fase 1.

---

## 6. Orden de implementación corregido

1. **Revertir el pago de un clic.** CxP en solo lectura hasta que exista la
   autorización. *(Es un agujero de control abierto hoy.)*
2. `supplier_bank_accounts` + validación matemática de CLABE + reglas de cambio
   con notificación al dueño (reusar `notification-dispatcher`).
3. `VerificadorManual`: subir el CEP como evidencia, reusando `lib/r2-client.ts`
   y el patrón de evidencia de `operating_expenses.evidence_url`.
4. `payables` + captura desde `invoices`, `operating_expenses` y
   `receiving_reports`. Reescribir el servicio de antigüedad sobre esta tabla.
5. Extender `expense_authorization_rules` (+2 columnas) y **resolver
   `DIRECTOR_OPS`**; crear `payment_approval_events`; cablear
   `payment_approvals`; máquina de estados.
6. `payment_batches` + validaciones de inclusión.
7. Layout bancario (un banco).
8. Conciliación manual.

Cambio respecto del spec: el paso 1 del spec original (crear `proveedores`)
desaparece —ya existe— y en su lugar entra la reversión del pago de un clic, que
el spec no contemplaba porque no sabía que existía.

---

## 7. Lo que el spec no dimensiona

§8 pide 6 specs E2E. **`tests/` está vacío**: no hay ni infraestructura de
Playwright corriendo, y `docs/plan-implementacion-capa-dinero-faltante.md` ya lo
registraba como pendiente desde la fase anterior. Levantar el arnés es trabajo
aparte de escribir los 6 escenarios.

---

## 8. Lo que sigue sin decidirse

- **`DIRECTOR_OPS`**: ¿se agrega al enum `users.role` o se mapea a `ADMIN`?
  Bloquea el paso 5.
- **Banco del primer cliente**: define el único layout a construir (§5). Sin ese
  dato el paso 7 no arranca.
- **Quién es "tesorería"**: el spec lo trata como rol propio. Hoy no existe;
  habría que agregarlo al enum o tratarlo como `OWNER`/`ADMIN`.
