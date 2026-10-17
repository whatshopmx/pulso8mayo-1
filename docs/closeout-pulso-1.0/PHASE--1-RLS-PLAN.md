# PHASE -1.4 — RLS Plan (company_id)

> **No aplicado todavía.** Este documento es el plan ejecutable. Habilitar RLS
> requiere primero el mecanismo de contexto de sesión descrito abajo; sin él,
> toda consulta del pool quedaría bloqueada.

## 1. Por qué no se puede activar hoy

| Hecho verificado | Evidencia |
|---|---|
| No hay `set_config`/`SET LOCAL`/`app.current_*` en el código | `rg set_config\|SET LOCAL lib app` → 0 |
| El cliente es un **pool global compartido** | `lib/db/index.ts` |
| No hay wrapper transaccional por request | solo `db.transaction(...)` puntual (25 usos) |
| No existen políticas RLS | `rg "CREATE POLICY\|ENABLE ROW" drizzle/*.sql` → 0 |

Con un pool compartido, `SET` a nivel de sesión contamina la conexión para el
siguiente request. La forma correcta es `SET LOCAL` **dentro de una transacción**
(se revierte al terminar), con el rol de conexión sujeto a RLS.

## 2. Mecanismo requerido (prerequisito)

1. **Rol de aplicación sin BYPASSRLS.** La conexión no debe ser dueña de las
   tablas ni superusuario. Neon permite crear un rol `pulso_app` con
   `GRANT SELECT, INSERT, UPDATE, DELETE` y sin ownership.
2. **Helper transaccional por request** (a crear cuando se aplique):

```ts
// lib/db/tenant-db.ts (a crear en la fase de ejecución)
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * Ejecuta `fn` dentro de una transacción con el tenant fijado a nivel de sesión.
 * `set_config(..., true)` = SET LOCAL: se revierte al cerrar la transacción, así
 * que la conexión vuelve al pool sin contexto y el siguiente request fija el suyo.
 */
export async function withTenantDb<T>(
  companyId: string,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_company_id', ${companyId}, true)`);
    return fn(tx);
  });
}
```

3. **Regla de ruta:** todo handler autenticado usa `withTenantDb(auth.tenantId, ...)`
   para las tablas sujetas a RLS. Las consultas sin contexto fallan cerradas
   (0 filas), no abiertas.

## 3. Batch 1 — tablas sensibles (las del plan)

| Tabla | Columna de tenant | Nota |
|---|---|---|
| `employees` / `employee_profiles` | `company_id` vía `users` | PII; `employee_profiles` no tiene `company_id` → policy por `user_id IN (select id from users where company_id = ...)` |
| `payroll_runs` | `company_id` | |
| `payroll_payslips` | vía `payroll_runs` | |
| `payment_runs` | `company_id` | |
| `payment_run_items` | vía `payment_runs` | |
| `payment_approvals` | `company_id` | |
| `invoices` | `company_id` | |
| `invoice_lines` | vía `invoices` | |
| `operating_expenses` | `company_id` | |
| `supplier_bank_accounts` | `company_id` | CLABE cifrada |
| `payee_bank_accounts` | `company_id` | CLABE cifrada |
| `bank_accounts` (nueva) | `company_id` | al crearse en Phase 5 |
| `bank_transactions` (nueva) | `company_id` | al crearse en Phase 5 |

## 4. Migración tipo (plantilla, NO aplicada)

```sql
-- 1) Rol de aplicación sin ownership ni BYPASSRLS (una vez, fuera de migración).
--    CREATE ROLE pulso_app LOGIN PASSWORD '...' NOBYPASSRLS;
--    GRANT USAGE ON SCHEMA public TO pulso_app;
--    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pulso_app;

-- 2) Para cada tabla del batch:
ALTER TABLE "payroll_runs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payroll_runs_tenant_isolation" ON "payroll_runs"
  USING ("company_id" = current_setting('app.current_company_id', true)::uuid)
  WITH CHECK ("company_id" = current_setting('app.current_company_id', true)::uuid);

-- 3) Tabla hija sin company_id propio (ej. invoice_lines): policy por EXISTS.
ALTER TABLE "invoice_lines" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoice_lines_tenant_isolation" ON "invoice_lines"
  USING (EXISTS (
    SELECT 1 FROM "invoices" i
    WHERE i.id = "invoice_lines"."invoice_id"
      AND i."company_id" = current_setting('app.current_company_id', true)::uuid
  ));
```

`current_setting('app.current_company_id', true)` devuelve NULL si no se fijó; la
comparación resulta NULL → la fila no pasa → **falla cerrado**.

## 5. Rollout por fases (sin big bang)

1. **Prerequisito:** crear `withTenantDb` y migrar los handlers de Batch 1.
2. **Staging:** crear rol `pulso_app`, aplicar migración de policies, correr E2E
   (`tests/frontera-tenant-sucursal.spec.ts`, `tests/api/employees-tenant-isolation.spec.ts`).
3. **Observabilidad:** contar filas-fuera-de-contexto (si una ruta olvida
   `withTenantDb`, devuelve 0 filas → visible en tests, no en producción).
4. **Producción:** aplicar por tabla, empezando por las de solo lectura.
5. **Batch 2:** resto de tablas con `company_id`.

## 6. Riesgos

| Riesgo | Mitigación |
|---|---|
| Una ruta olvida `withTenantDb` → 0 filas | Tests de aislamiento + monitoreo de respuestas vacías |
| `FORCE ROW LEVEL SECURITY` no puesto → el dueño ignora policies | Usar rol no-dueño; verificar con un test que lee sin contexto y espera 0 |
| Inngest/scripts sin request context | Pasar `companyId` explícito y envolver en `withTenantDb` |
| Rendimiento (policy por fila) | Índice en `company_id` (ya existe en la mayoría) |

## 7. Criterio de aceptación de la fase RLS

- [ ] Una sesión de la empresa A no puede leer ni escribir una fila de B en ninguna tabla del Batch 1, ni por API ni por consulta directa.
- [ ] Sin `app.current_company_id`, toda tabla del Batch 1 devuelve 0 filas.
- [ ] Los E2E de aislamiento existentes pasan con RLS activo.
