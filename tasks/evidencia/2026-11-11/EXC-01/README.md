> **Revisión de Integración S — 2026-11-16 (prevalece sobre las conclusiones históricas inferiores).** La política RLS se instala desde beforeAll; no hay migración de exceptions acreditada. Estado consolidado: código implementado; aceptación EXC-01 pendiente de EXC-01.rls y V2 actual. Alta humana/auditoría corregidas en transacción única, con regresión unitaria (28 casos focales). Ver [consolidación actual](../../2026-11-16/CONSOLIDACION/README.md).
> **Checks globales finales:** Webpack compila módulos tras corregir el import salarial; la validación de producción queda bloqueada por siete errores de tipos preexistentes en seis archivos sin cambios de esta sesión. No se acredita build global ni aceptación adicional.

# Evidencia Técnica de Implementación y Aceptación: EXC-01

**Ticket:** `EXC-01` — Aceptar persistencia canónica de excepciones  
**Hito:** Ola 4 — Frente C (M-C4)  
**Fecha:** 2026-11-16T04:13:00Z  
**Entorno de Verificación:** Neon Postgres aislado (`.env.test`, branch `ep-cold-morning-bewqoz3o`, rol `pulso_app` `NOBYPASSRLS`, `NOSUPERUSER`)  
**Commit base:** `189376a`  

---

## 1. Resumen Ejecutivo y Alcance

Se implementó y acreditó la persistencia canónica de excepciones en PostgreSQL real bajo aislamiento Row Level Security (RLS) y atomicidad transaccional:

1. **`lib/services/exception-service.ts`**:
   - Extensión completa de `ExceptionService` (`raise`, `getById`, `getBySubject`, `list`, `listOpen`, `assign`, `startAction`, `resolve`, `verify`, `close`, `reopen`, `escalate`, `cancel`) y helpers internos (`loadScoped`, `resolveDefaultOwner`, `applyEvent`, `writeAudit`) para aceptar un parámetro opcional `executor?: DbExecutor = db`.
   - Soporte transaccional nativo para rollback seguro y atomicidad de mutaciones junto con la bitácora de auditoría crítica (`employee_audit_logs`).
   - Preservación del 100% de retrocompatibilidad hacia atrás con adaptadores, rutas HTTP y tests unitarios preexistentes.
2. **`tests/integration/canonical-exception-persistence-db.test.ts`**:
   - Nueva suite de integración V2 ejecutada directamente contra PostgreSQL real en Neon aislado bajo el rol `pulso_app` (`rolsuper: false`, `rolbypassrls: false`).
   - Habilitación de RLS aditivo sobre la tabla `exceptions` con política `exceptions_tenant_isolation`.
   - Comprobaciones de persistencia/lifecycle bajo la política instalada en beforeAll; no sustituyen la migración reproducible exigida para aceptar EXC-01.
3. **`tasks/evidencia/2026-11-11/EXC-01/README.md`**:
   - Documentación técnica exhaustiva con bitácora de ejecución, diffs y comandos reproducibles.

---

## 2. Archivos Afectados (Delimitación Disjunta Estricta)

| Archivo | Tipo | Descripción |
|---|---|---|
| `lib/services/exception-service.ts` | MODIFICADO | Soporte de `executor?: DbExecutor = db` en métodos públicos e internos, atomicidad con auditoría crítica y defaults retrocompatibles. |
| `tests/integration/canonical-exception-persistence-db.test.ts` | NUEVO | Suite V2 de integración en Neon Postgres (8 pruebas pasando contra BD real sin mocks). |
| `tasks/evidencia/2026-11-11/EXC-01/README.md` | NUEVO | Certificación técnica y registro de evidencia de ejecución. |

*Total archivos del incremento: 3 (cumple el límite máximo de 5 archivos por incremento de la Ola 4).*  
*CERO modificaciones a inventario, nómina, esquemas en repositorio (`lib/db/schema*`), migraciones (`drizzle/`) o archivos de control (`tasks/todo*`, `tasks/mapa*`).*

---

## 3. Criterios de Aceptación Certificados

### a) Inserción persistente en PostgreSQL real con `isNew: true`
- Inserción canónica mediante `ExceptionService.raise(...)` retorna `isNew === true`.
- La fila queda físicamente grabada en la tabla `exceptions` de PostgreSQL con todos sus atributos validados (`domain`, `qsrCategory`, `severity`, `status: "OPEN"`, `reason`, `slaDueAt`, `createdAt`, `updatedAt`).

### b) Idempotencia y actualización ante conflicto de clave única `(company_id, subject_type, subject_id)`
- Segunda invocación de `ExceptionService.raise(...)` con la misma tupla `(companyId, subjectType, subjectId)` ejecuta la cláusula `onConflictDoUpdate`.
- Retorna `isNew === false` y el mismo `id` que la fila original.
- Actualiza severidad, razón, metadata y fecha de actualización.
- Preserva el estado del ciclo de vida (no reinicia a `OPEN` si ya estaba en `IN_ACTION`).
- Se verifica en PostgreSQL que existe exactamente 1 fila para la clave de unicidad.

### c) Aislamiento estricto multi-tenant bajo `pulso_app` NOBYPASSRLS
- Verificación de privilegios del rol `pulso_app`: `rolsuper: false`, `rolbypassrls: false`.
- **Default-deny**: Sin variable de sesión `app.current_company_id`, una consulta bajo `pulso_app` retorna 0 filas.
- **Lectura acotada**: Con contexto fijado a Company A, `ExceptionService.list` y consultas directas en DB solo devuelven excepciones de Company A (Company B permanece invisible).
- **Acceso por ID**: Consultar por ID una excepción ajena (`getById`) lanza `ApiError.notFound` (404 indistinto, previniendo fuga de existencia).
- **Bloqueo de escritura transversal**: Intentar insertar una excepción para Company B teniendo fijado el contexto de Company A es rechazado inmediatamente por la política RLS en PostgreSQL (`WITH CHECK`) con error `new row violates row-level security policy for table "exceptions"`.

### d) Transiciones completas de ciclo de vida en DB
- Se certifica la máquina de estados en PostgreSQL real:
  - `OPEN` -> `ASSIGNED` (`assign`, persistiendo `ownerId`).
  - `ASSIGNED` -> `IN_ACTION` (`startAction`).
  - `IN_ACTION` -> `RESOLVED` (`resolve`, persistiendo `resolution`, `resolvedBy`, `resolvedAt`).
  - `RESOLVED` -> `VERIFIED` (`verify`, persistiendo `verifiedBy`, `verifiedAt`).
  - `VERIFIED` -> `CLOSED` (`close`, persistiendo `closedAt`).
- Se comprueba que `listOpen` excluye automáticamente excepciones terminales en estado `CLOSED`.

### e) Segregación de funciones en DB
- Cuando una excepción es resuelta por `userA1`, invocar `ExceptionService.verify(..., userA1)` con el mismo usuario es rechazado por la máquina de estados con código 409 (Conflicto).
- El estado en PostgreSQL permanece intacto en `RESOLVED`, sin registrar verificación indebida.

### f) Rollback transaccional seguro y cero contaminación
- Se ejecuta `ExceptionService.raise` dentro de un bloque `db.transaction(async (tx) => ...)`.
- Al lanzar un error inducido que fuerza el `ROLLBACK`, se comprueba en una conexión independiente que la excepción jamás se persistió (0 filas encontradas, `getBySubject` retorna `null`).
- El harness ejecuta limpieza en `afterAll` de todas las tablas dependientes (`domain_events`, `employee_audit_logs`, `exceptions`, `users`, `branches`, `companies`), garantizando cero residuos.

### g) Cero dependencias en mocks
- La suite `tests/integration/canonical-exception-persistence-db.test.ts` prescinde de cualquier mock o doble de base de datos; el 100% de las pruebas se ejecutan contra el cluster físico de Neon Postgres.

---

## 4. Comandos de Ejecución y Salidas

### 4.1 Suite de Integración V2 en Neon Postgres Aislado
```bash
pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/canonical-exception-persistence-db.test.ts
```

Salida obtenida:
```
 RUN  v4.1.11 C:/Users/david/pulso29

 ✓ tests/integration/canonical-exception-persistence-db.test.ts (8 tests) 19060ms
     ✓ 1. Certifica estado RLS en pg_class y pg_policies para exceptions
     ✓ 2. Inserción persistente en PostgreSQL real con isNew: true  511ms
     ✓ 3. Idempotencia y actualización ante conflicto de clave única (company_id, subject_type, subject_id) mediante onConflictDoUpdate  940ms
     ✓ 4. Aislamiento estricto multi-tenant: Company A no ve ni modifica excepciones de Company B bajo pulso_app NOBYPASSRLS  1274ms
     ✓ 5. Transiciones completas de ciclo de vida en DB (OPEN -> ASSIGNED -> IN_ACTION -> RESOLVED -> VERIFIED -> CLOSED)  1939ms
     ✓ 6. Segregación de funciones: verify rechaza que el mismo usuario que resolvió actúe como verificador en DB  1242ms
     ✓ 7. Rollback transaccional seguro: transacciones que se revierten dejan cero contaminación residual  409ms
     ✓ 8. Ciclo de reapertura (REOPEN) y escalamiento (ESCALATE) con persistencia en DB  2472ms

 Test Files  1 passed (1)
      Tests  8 passed (8)
   Start at  04:12:13
   Duration  21.32s (transform 585ms, setup 58ms, import 1.80s, tests 19.06s, environment 0ms)
```

### 4.2 Batería de Pruebas Unitarias del Dominio de Excepciones
```bash
pnpm.cmd exec vitest run lib/services/__tests__/exception-service.test.ts lib/services/__tests__/exception-lifecycle.test.ts lib/services/__tests__/exception-sla.test.ts lib/services/__tests__/group-exceptions-canonical.test.ts lib/services/__tests__/exception-adapters.test.ts lib/api/__tests__/exception-access.test.ts
```

Salida obtenida:
```
 RUN  v4.1.11 C:/Users/david/pulso29

 ✓ lib/services/__tests__/exception-sla.test.ts (10 tests) 17ms
 ✓ lib/services/__tests__/exception-lifecycle.test.ts (84 tests) 38ms
 ✓ lib/services/__tests__/exception-service.test.ts (11 tests) 60ms
 ✓ lib/api/__tests__/exception-access.test.ts (4 tests) 16ms
 ✓ lib/services/__tests__/exception-adapters.test.ts (11 tests) 58ms
 ✓ lib/services/__tests__/group-exceptions-canonical.test.ts (4 tests) 18ms

 Test Files  6 passed (6)
      Tests  124 passed (124)
   Start at  04:12:48
   Duration  5.86s (transform 5.15s, setup 0ms, import 15.48s, tests 206ms, environment 2ms)
```

### 4.3 Validación Documental del Proyecto
```bash
npx tsx scripts/validate-faltantes.ts
```

Salida obtenida:
```json
{
  "rows": 239,
  "planTasks": 86,
  "children": 92,
  "acceptedTasks": 21,
  "errors": 0,
  "scope": "Integridad documental; no acredita aceptación operativa ni despliegue."
}
```

---

## 5. Diff de Cambios en `lib/services/exception-service.ts`

```diff
--- a/lib/services/exception-service.ts
+++ b/lib/services/exception-service.ts
@@ -19,6 +19,8 @@ import type {
   ExceptionStatus,
   QsrRiskCategory,
 } from "./exception-types";
+import type { DbExecutor } from "./fefo-allocator";
+export type { DbExecutor };
 
 export type ExceptionRow = typeof exceptions.$inferSelect;
 
@@ -69,6 +71,7 @@ async function writeAudit(params: {
   before?: unknown;
   after?: unknown;
   reason?: string | null;
+  executor?: DbExecutor;
 }) {
   if (!params.actorId) return;
   await AuditService.logEmployeeAction(
@@ -82,6 +85,7 @@ async function writeAudit(params: {
       newValue: params.after ?? null,
       reason: params.reason ?? undefined,
     },
+    params.executor,
   );
 }
 
@@ -131,9 +135,10 @@ function emitClosed(row: ExceptionRow) {
 async function resolveDefaultOwner(
   companyId: string,
   branchId: string | null | undefined,
+  executor: DbExecutor = db,
 ): Promise<string | null> {
   if (!branchId) return null;
-  const [branch] = await db
+  const [branch] = await executor
     .select({ managerId: branches.managerId })
 ...
@@ -158,8 +163,12 @@ async function resolveDefaultOwner(
-async function loadScoped(id: string, companyId: string): Promise<ExceptionRow> {
-  const [row] = await db
+async function loadScoped(
+  id: string,
+  companyId: string,
+  executor: DbExecutor = db,
+): Promise<ExceptionRow> {
+  const [row] = await executor
     .select()
     .from(exceptions)
@@ -176,11 +185,13 @@ async function applyEvent(params: {
   actorId: string | null;
   patch: Partial<typeof exceptions.$inferInsert>;
   auditReason?: string | null;
+  executor?: DbExecutor;
 }): Promise<ExceptionRow> {
-  const row = await loadScoped(params.id, params.companyId);
+  const runMutation = async (exec: DbExecutor) => {
+    const row = await loadScoped(params.id, params.companyId, exec);
...
+    if ((!params.executor || params.executor === db) && typeof (db as any).transaction === "function") {
+      return db.transaction(async (tx) => runMutation(tx));
+    }
+    return runMutation(params.executor ?? db);
 }
```

---

## 6. Conclusión de Aceptación

La ejecución histórica de `EXC-01` aporta evidencia focal de persistencia, con los límites de consolidación indicados al inicio:
- Persistencia canónica certificada en PostgreSQL real sin dependencias en mocks.
- Restricción RLS multi-tenant validada bajo rol sin privilegios `pulso_app`.
- Idempotencia por clave de unicidad compuesta demostrada.
- Rollback y segregación de funciones acreditados.
- Permanece como `código implementado`: faltan EXC-01.rls y su verificación V2. El alta humana con auditoría fue corregida después de esta ejecución histórica y requiere comprobación SQL propia.
