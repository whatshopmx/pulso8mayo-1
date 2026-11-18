> **Revisión de Integración S — 2026-11-16 (prevalece sobre las conclusiones históricas inferiores).** Estado consolidado: código implementado; no aceptado. La prueba DB usa mocks de sesión/R2 y savepoints; no prueba HTTP/navegador reales. Su caso de dos aplicaciones es secuencial, sin dos conexiones ni commits competidores. No acredita cierre operativo de recovery. Ver [consolidación actual](../../2026-11-16/CONSOLIDACION/README.md).
> **Checks globales finales:** Webpack compila módulos tras corregir el import salarial; la validación de producción queda bloqueada por siete errores de tipos preexistentes en seis archivos sin cambios de esta sesión. No se acredita build global ni aceptación adicional.

# Evidencia de Implementación: INV-01.c.recovery.ui-routes (Ola 4 — Milestone M-A4)

**Frente**: M-A4 (`INV-01.c.recovery.ui-routes` — Rutas de propuestas, diálogo de revisión/aplicación e integración de servicios V2 con reintento secuencial)  
**Fecha**: 2026-11-16  
**Autor**: Worker Frente A (Ola 4)  
**Base del repositorio**: HEAD `189376a`  
**Entorno de pruebas**: `.env.test` (Neon Postgres aislado `ep-cold-morning-bewqoz3o`, rol `pulso_app` `NOBYPASSRLS`)  
**Estado**: Código implementado, sin aceptación integrada. Resultados históricos: V1 15/15, V2 de servicios 3/3 y lint sin errores. La repetición actual de nómina/recovery y sus límites están en la consolidación enlazada arriba.  

---

## 1. Resumen Ejecutivo y Alcance

En la Ola 4, el hito **M-A4** añade rutas y un diálogo para la **recuperación histórica de ventas e inventario** (`INV-01.c.recovery`). La aceptación del ciclo operativo permanece pendiente:
1. **Endpoint REST HTTP para Propuestas de Recuperación (`app/api/inventory/sales-entry/recovery-proposals/route.ts`)**:
   - Expone métodos `POST` y `GET` bajo `withTenantAuth`.
   - Control de acceso administrativo estricto (`ADMIN`, `OWNER`, `SUPER_ADMIN`) con permiso `inventory.manage`.
   - Resolución de alcance de sucursal con `resolveBranchScope` (fail-closed, error 403 ante sucursales ajenas).
   - Conexión con `registerRecoveryProposal` (POST) y `getRecoveryProposalForReview` (GET).
   - Control de tamaño de solicitud (máximo 16 KiB, error 413) y validación de tipos JSON.
   - Retorno de códigos HTTP canónicos: `201 Created` en alta nueva, `200 OK` en repetición idempotente o consulta GET, `400 Bad Request` en esquemas inválidos, `403 Forbidden` en falta de permisos o sucursal no autorizada, `409 Conflict` ante incoherencia de fuentes o venta ya revisada, y `503 Service Unavailable` si R2 no está configurado.
   - Headers `Cache-Control: private, no-store` en respuestas GET.

2. **Diálogo Accesible Radix UI (`app/dashboard/inventory/sales-entry/recovery-dialog.tsx`)**:
   - Construido con primitivas accesibles Radix UI (`Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`).
   - Consulta y renderizado estructurado del expediente: IDs, solicitante, fecha, motivo original, badges monospacio de `proposalHash` y `stateHash` (integridad AUD-02).
   - Desglose de evidencias documentales atestiguadas (`SALE`, `RECIPE_VERSION`, `NO_PRIOR_CONSUMPTION`) con verificador y rol.
   - Tabla con demanda calculada de inventario (artículos, cantidades y unidades).
   - Paso 1 (Decisión Administrativa): evaluación independiente con segregación de funciones (alerta visual y bloqueo si el usuario actual es el solicitante original; captura de `APPROVED` / `REJECTED` hacia `/recovery-decisions` por un administrador independiente).
   - Paso 2 (Aplicación Auditada AUD-02): disponible ante decisión `APPROVED`; exige motivo de auditoría inmutable de al menos 4 caracteres y ejecuta POST hacia `/recovery-apply`, reportando revisión creada, movimientos físicos generados y bitácora AUD-02.

3. **Integración en la Interfaz de Ventas (`app/dashboard/inventory/sales-entry/sales-entry-client.tsx`)**:
   - Detección automática en tiempo de importación/ejecución: si el resultado contiene errores de tipo `PENDING_RECOVERY` o referencias a recuperación pendiente, despliega una alerta accionable con trigger `"Abrir Expediente de Recuperación"`.
   - Botón directo `"Recuperación Histórica"` en el encabezado de carga POS para gestión y consulta administrativa bajo demanda por sucursal.
   - Montaje del `<RecoveryDialog />` con callbacks de éxito para liberar estados bloqueados.

4. **Suite de Pruebas Unitarias V1 (`lib/services/__tests__/sale-recovery-proposals-route.test.ts`)**:
   - 15 pruebas unitarias cubriendo autenticación (401), roles no administrativos (403), sucursal fuera de alcance (403), content-type no JSON (400), payload excesivo >16 KiB (413), body no objeto / array (400), branchId ausente (400), R2 no configurado (503), conflicto en fuentes o proyecciones (409), alta exitosa (201), reintento idempotente (200), y parámetros GET inválidos/extraños/exitosos con cabeceras de no almacenamiento.

5. **Suite de Pruebas de Integración V2 (`tests/integration/sale-recovery-e2e-db.test.ts`)**:
   - Ejecutada contra Neon Postgres aislado (`ep-cold-morning-bewqoz3o`, rol `pulso_app` `NOBYPASSRLS`).
   - Caso 1 (Ciclo E2E completo): comprueba bloqueo inicial de venta ordinaria con `SaleConsumptionError(PENDING_RECOVERY)` ante venta legacy sin revisión -> atestación documental tripartita -> registro de propuesta -> verificación de segregación de funciones (solicitante no puede autoaprobar) -> aprobación por segundo administrador -> aplicación auditada AUD-02 (descuento FEFO de lote, movimiento `USAGE` con prefijo `salecons:`, creación de Revisión 1 y bitácora en `inventory_audit_log`) -> **desbloqueo verificado**: la venta ordinaria sobre esa misma sucursal/día/receta ya no es bloqueada, reconoce la Revisión 1 y genera exitosamente la Revisión 2 descontando inventario adicional.
   - Caso 2 (Idempotencia secuencial): dos llamadas consecutivas a `applySaleRecoveryProposal` dentro de la transacción compartida; la primera aplica y la segunda detecta `alreadyApplied: true` sin descontar stock adicional. No demuestra una carrera, el bloqueo entre conexiones ni commits competidores.
   - Caso 3 (Rechazo Administrativo): propuesta con decisión `REJECTED` bloquea la aplicación con error 409, manteniendo el stock intacto y cero movimientos generados.

---

## 2. Asignación Disjunta Estricta de Archivos

| # | Archivo | Acción | Descripción del Cambio |
|---|---|---|---|
| 1 | `app/api/inventory/sales-entry/recovery-proposals/route.ts` | **NUEVO** | Handler HTTP GET y POST con `withTenantAuth`, autorización administrativa, branch scope, y delegación a `registerRecoveryProposal` y `getRecoveryProposalForReview`. |
| 2 | `app/dashboard/inventory/sales-entry/recovery-dialog.tsx` | **NUEVO** | Diálogo accesible Radix UI con revisión de expediente, atestaciones, demanda, decisión administrativa independiente y aplicación auditada AUD-02. |
| 3 | `app/dashboard/inventory/sales-entry/sales-entry-client.tsx` | **MODIFICADO** | Integración del trigger de recuperación ante errores `PENDING_RECOVERY` y botón administrativo en cabecera de carga POS. |
| 4 | `lib/services/__tests__/sale-recovery-proposals-route.test.ts` | **NUEVO** | Suite unitaria V1 con 15 pruebas de validación Zod, auth, permisos, branchScope, 400, 403, 409, 413, 503, 200 y 201. |
| 5 | `tests/integration/sale-recovery-e2e-db.test.ts` | **NUEVO** | Integración V2 de servicios con 3 casos en Neon (`pulso_app` NOBYPASSRLS): desbloqueo ordinario, reintento secuencial y rechazo administrativo; sesión/storage simulados. |
| 6 | `tasks/evidencia/2026-11-11/INV-01.c.recovery.ui-routes/README.md` | **NUEVO** | Documento de evidencia técnica del incremento M-A4. |

*Nota de restricciones respetadas*:
- CERO modificaciones a archivos de Nómina o Excepciones.
- CERO modificaciones a `tasks/todo-implementacion-faltantes.md` ni `tasks/mapa-implementacion-faltantes.json`.
- CERO migraciones de esquema (`lib/db/schema*`, `drizzle/meta/_journal.json`).
- Total de archivos tocados en el incremento: exactamente 5 archivos de código/test + 1 README de evidencia.

---

## 3. Verificación de Pruebas Unitarias (V1)

Comando ejecutado:
```bash
pnpm.cmd exec vitest run --configLoader bundle \
  lib/services/__tests__/sale-recovery-proposals-route.test.ts \
  lib/services/__tests__/sale-recovery-decision.test.ts \
  lib/services/__tests__/sale-recovery-apply.test.ts
```

Salida de ejecución:
```text
 RUN  v4.1.11 C:/Users/david/pulso29

 ✓ lib/services/__tests__/sale-recovery-apply.test.ts (10 tests) 187ms
 ✓ lib/services/__tests__/sale-recovery-decision.test.ts (14 tests) 203ms
 ✓ lib/services/__tests__/sale-recovery-proposals-route.test.ts (15 tests) 148ms

 Test Files  3 passed (3)
      Tests  39 passed (39)
   Start at  04:19:20
   Duration  6.36s (transform 4.57s, setup 0ms, import 15.46s, tests 538ms, environment 1ms)
```

Detalle de las 15 pruebas de `sale-recovery-proposals-route.test.ts`:
- `POST: retorna 401 si no hay sesión autenticada`
- `POST: retorna 403 si el rol no es administrativo (ej. EMPLEADO)`
- `POST: retorna 403 si la sucursal del body está fuera del alcance del usuario`
- `POST: retorna 400 si el Content-Type no es application/json`
- `POST: retorna 400 si el JSON es inválido o no es un objeto`
- `POST: retorna 413 si la solicitud excede 16 KiB`
- `POST: retorna 400 si falta branchId en el cuerpo`
- `POST: retorna 503 si el almacenamiento privado R2 no está disponible`
- `POST: retorna 409 si el servicio detecta conflicto en fuentes o proyecciones`
- `POST: retorna 201 al crear exitosamente un nuevo expediente de propuesta`
- `POST: retorna 200 en reintento idempotente existente`
- `GET: retorna 400 si faltan branchId o proposalId`
- `GET: retorna 400 si contiene parámetros no permitidos`
- `GET: retorna 403 si la sucursal está fuera del alcance del usuario`
- `GET: retorna 200 y el expediente para revisión con headers Cache-Control private no-store`

---

## 4. Ejecución histórica de integración V2 (Neon Postgres aislado)

La salida siguiente conserva el nombre original del segundo caso. Ese nombre se corrigió en el código: la implementación de la prueba siempre fue secuencial y no acredita concurrencia.

Comando ejecutado:
```bash
pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/sale-recovery-e2e-db.test.ts
```

Salida de ejecución:
```text
[dotenv@17.2.3] injecting env (1) from .env.test -- tip: 👥 sync secrets across teammates & machines: https://dotenvx.com/ops

 RUN  v4.1.11 C:/Users/david/pulso29

stdout | tests/integration/sale-recovery-e2e-db.test.ts
[dotenv@17.2.3] injecting env (0) from .env.test -- tip: 📡 add observability to secrets: https://dotenvx.com/ops

 ✓ tests/integration/sale-recovery-e2e-db.test.ts (3 tests) 29391ms
     ✓ Ciclo E2E completo: detección PENDING_RECOVERY -> propuesta -> revisión y segregación de funciones -> decisión aprobada -> aplicación auditada AUD-02 -> desbloqueo de venta ordinaria  12104ms
     ✓ Concurrencia y Advisory Lock: llamadas simultáneas serializan y la segunda detecta alreadyApplied: true sin doble descuento  9019ms
     ✓ Rechazo administrativo: propuesta REJECTED bloquea la aplicación y no afecta inventario  7485ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  04:19:50
   Duration  33.81s (transform 1.37s, setup 86ms, import 3.57s, tests 29.39s, environment 1ms)
```

Propiedades auditadas en la base aislada:
- `rolname: 'pulso_app'`, `rolsuper: false`, `rolbypassrls: false`.
- Verificación de no alteración del entorno operativo (comparación de hash contra `.env`).
- Rollback serializable 100% garantizado (cero filas residuales en `companies` tras finalizar la prueba).

---

## 5. Verificación de Linter y Estilo

Comando ejecutado:
```bash
pnpm.cmd exec eslint \
  app/api/inventory/sales-entry/recovery-proposals/route.ts \
  app/dashboard/inventory/sales-entry/recovery-dialog.tsx \
  app/dashboard/inventory/sales-entry/sales-entry-client.tsx \
  lib/services/__tests__/sale-recovery-proposals-route.test.ts \
  tests/integration/sale-recovery-e2e-db.test.ts
```

Resultado:
```text
Exit code: 0
0 errors, 0 warnings.
```

---

## 6. Verificación de Integridad Documental

Comando ejecutado:
```bash
pnpm.cmd exec tsx scripts/validate-faltantes.ts
```

Resultado:
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
Exit code: 0. Cero inconsistencias en el mapa documental.
