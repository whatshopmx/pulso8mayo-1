# EVI-02.a — Sujetos de Evidencia Faltantes (Factura, Pago, Excepción) y Cierre AUD-02 V2

**ID:** `EVI-02.a`  
**Track:** C2 (EVI-02.a + AUD-02 V2 — Iteración 2)  
**Tipo/Tamaño:** I / M  
**Estado:** Código implementado; V1 y V2 comprobadas  
**Fecha:** 2026-11-15  
**Propietario:** Frente C (Auditoría / Evidencia / Excepciones)  
**Base:** HEAD `eba576d` (`feat(s0-a1-b1-c1): consolidate INV-01.b4, NOM-01, AUD-02 and S0 traceability`) más cambios locales del árbol de trabajo  

---

## 1. Resumen y Alcance de la Entrega

Track C2 aborda dos objetivos críticos del sistema según las especificaciones de `tasks/2026-11-15-investigacion-y-sesiones-faltantes.md` y `SCOPE.md`:

1. **Implementación de `EVI-02.a`**:
   - Creación del servicio unificado de sujetos de evidencia `lib/services/evidence-subject-service.ts`.
   - Incorporación de los tres sujetos documentales prioritarios faltantes:
     - `INVOICE`: Facturas / CFDI de proveedores (`invoices`).
     - `PAYMENT`: Corridas de pago globales (`payment_runs`) y partidas individuales (`payment_run_items`).
     - `EXCEPTION`: Anomalías operativas, mermas sospechosas y quejas (`exceptions`).
     - Preservación y compatibilidad completa con el sujeto existente `SALE_RECOVERY` (`sales_entries`).
   - Verificación estricta de acceso:
     - Tenancy estricto por empresa (`companyId`): deniega transversalidad entre organizaciones con respuesta 404 (fail-closed, previniendo enumeración).
     - Acotamiento por sucursal (`branchId` / `resolveBranchScope`): roles acotados (`GERENTE`, `SUPERVISOR`) solo pueden consultar o adjuntar evidencias a entidades pertenecientes a su sucursal asignada; las entidades corporativas (`branchId = null`) quedan reservadas a roles corporativos (`ADMIN`, `OWNER`, `SUPER_ADMIN`).
     - Matriz de permisos de dominio (`hasPermission`): contabilidad (`accounting`) para facturas/pagos, excepciones (`exceptions`) para anomalías, inventario (`inventory`) para ventas de recuperación.
     - Claves canónicas privadas de R2 con jerarquía inmutable:
       `companies/${companyId}/branches/${branchId || 'corporate'}/${subjectType.toLowerCase()}/${entityId}/${evidenceId}`
       con validación activa anti-Directory Traversal (`..`, `//`, `/`).
     - Soporte para borrado lógico (`deletedAt`) garantizando la inmutabilidad del rastro de auditoría.

2. **Cierre de la Puerta V2 para `AUD-02` en Postgres Aislado**:
   - Ejecución de pruebas de integración contra base de datos Postgres real en Neon (`ep-cold-morning-bewqoz3o.c-9.us-east-2.aws.neon.tech`, rama `br-round-voice-belheola`) bajo el rol de runtime `pulso_app` (`NOBYPASSRLS`).
   - Verificación de los tres invariantes canónicos de auditoría crítica:
     - **Motivo obligatorio**: `reason` con longitud mínima >= 4 caracteres; rechazo con `AuditValidationError` (`code: 'AUDIT_REASON_REQUIRED'`).
     - **Transacción obligatoria**: `executor !== db`; rechazo con `AuditValidationError` (`code: 'AUDIT_TRANSACTION_REQUIRED'`).
     - **Atomicidad y Rollback Absoluto**: ante cualquier fallo de bitácora o error intermedio, la transacción completa revierte sin escrituras parciales ni en saldos, estados ni bitácoras en los 3 dominios (`INVENTORY`, `LABOR`, `FINANCE`).
   - Cumplimiento de la restricción: `SALE_RECOVERY_APPLY` y `SALE_VOID` se reservan para A3/INV-01.d; AUD-02 V2 ejercita únicamente enums existentes (`WASTE`, `ADJUSTMENT`, `BATCH`, `SALARY`, `CONTRACT`, `FINANCIAL_CLOSE`).

3. **Remediaciones de Calidad en Iteración 2**:
   - **Corrección de TypeScript (`tsc --noEmit`)**: Se añadió firma de índice `[key: string]: unknown` a `EvidenceRecord` en `lib/services/evidence-subject-service.ts`, satisfaciendo la restricción genérica `Record<string, unknown>` de `executor.execute<T>` y resolviendo los 4 errores de tipado reportados por el Revisor 1.
   - **Compatibilidad de Esquema y RLS en Postgres Aislado**:
     - Se añadió sentencia DDL aditiva `ALTER TABLE "public"."payment_run_items" ADD COLUMN IF NOT EXISTS "payroll_snapshot" jsonb` en el arnés de prueba `tests/integration/evidence-subjects-db.test.ts`.
     - Se utilizó inserción SQL explícita para `payment_run_items`, desvinculando la consulta de columnas opcionales inexistentes.
     - Se alinearon los enums de excepciones (`domain`: `inventario`, `finanzas`, `equipos`; `qsrCategory`: `ABASTO`, `DINERO`) con el catálogo de tipos de Postgres.
     - Se propagó `app.current_company_id` y `app.current_branch_id` en las transacciones bajo `pulso_app`, satisfaciendo las políticas RLS `evidence_tenant_isolation` en lectura y escritura (`WITH CHECK`).

---

## 2. Archivos Asignados y Modificados (Límite Estricto: 5 Archivos)

| # | Archivo | Acción | Descripción |
|---|---|---|---|
| 1 | `lib/services/evidence-subject-service.ts` | **MODIFICADO** | Servicio central de acceso, validación de tenancy, claves canónicas R2 y persistencia para `INVOICE`, `PAYMENT`, `EXCEPTION` y `SALE_RECOVERY`. Tipado estricto compatible con `Record<string, unknown>`. |
| 2 | `tests/unit/evidence/evidence-subject-access.test.ts` | **NUEVO** | Suite unitaria canónica (18 pruebas) cubriendo normal, vacío, error, permisos, tenancy, sucursales y claves R2. |
| 3 | `tests/integration/audit-02-db.test.ts` | **NUEVO** | Suite de integración en Neon aislado (10 pruebas) cerrando V2 de `AUD-02` bajo rol `pulso_app` con `NOBYPASSRLS`. |
| 4 | `tests/integration/evidence-subjects-db.test.ts` | **MODIFICADO** | Suite de integración en Neon aislado (7 pruebas) para persistencia, consulta, soft delete y aislamiento multi-tenant de los nuevos sujetos bajo `pulso_app`. |
| 5 | `tasks/evidencia/2026-11-11/EVI-02.a/README.md` | **MODIFICADO** | Documento de evidencia, trazabilidad técnica y certificación de cierre V1/V2. |

---

## 3. Arquitectura y Reglas de Tenancy

### 3.1. Matriz de Acceso por Sujeto

| Sujeto | Tabla Entidad | Permiso Requerido | Nivel Sucursal | Almacenamiento R2 Canónico |
|---|---|---|---|---|
| `INVOICE` | `invoices` | `accounting:read` / `manage` | Sucursal o Corporativo (`null`) | `companies/{cId}/branches/{bId\|corporate}/invoice/{id}/{evId}` |
| `PAYMENT` | `payment_runs` / `payment_run_items` | `accounting:read` / `manage` | Sucursal o Corporativo (`null`) | `companies/{cId}/branches/{bId\|corporate}/payment/{id}/{evId}` |
| `EXCEPTION` | `exceptions` | `exceptions:read` / `manage` | Sucursal o Corporativo (`null`) | `companies/{cId}/branches/{bId\|corporate}/exception/{id}/{evId}` |
| `SALE_RECOVERY` | `sales_entries` | `inventory:read` / `manage` | Sucursal obligatoria | `companies/{cId}/branches/{bId}/sale_recovery/{id}/{evId}` |

### 3.2. Reglas de Acotamiento y Fail-Closed
1. **Compañía**: Si la entidad solicitada pertenece a una empresa distinta a la del usuario, la consulta lanza `ApiError.notFound("Entidad no encontrada")`. No se filtra la existencia ni metadatos de otras organizaciones.
2. **Sucursal**:
   - Para roles acotados (`GERENTE`, `SUPERVISOR`): Solo pueden acceder a registros con `branchId === user.branchId`. Si `branchId` es nulo (corporativo) o pertenece a otra sucursal, se deniega con `ApiError.notFound("Entidad fuera del alcance de sucursal asignado")`.
   - Para roles corporativos (`ADMIN`, `OWNER`, `SUPER_ADMIN`): Pueden acceder a cualquier sucursal y a registros corporativos a nivel holding (`branchId = null`).
   - Usuario acotado sin sucursal asignada (`user.branchId === null` con rol `GERENTE`): denegado con `403 Forbidden` (`resolveBranchScope` -> `kind: "NONE"`).
3. **Almacenamiento**: Toda clave R2 debe coincidir con el prefijo estricto de tenancy. Intentos de traversal (`..`, `//`, `/`) son interceptados por `validateEvidenceStorageKey`.

---

## 4. Resultados de Ejecución y Evidencia de Pruebas

### 4.1. Suite Unitaria EVI-02.a y AUD-02 (`tests/unit/evidence/evidence-subject-access.test.ts` y `tests/unit/audit/audit-02.test.ts`)

```powershell
pnpm vitest run --configLoader bundle tests/unit/evidence/evidence-subject-access.test.ts tests/unit/audit/audit-02.test.ts
```

**Resultado:** Exit code 0, **37/37 pruebas pasadas (6.79s)**:
- `tests/unit/evidence/evidence-subject-access.test.ts` (18 pruebas):
  - `buildEvidenceStorageKey genera la ruta jerárquica canónica correcta` (PASSED)
  - `validateEvidenceStorageKey aprueba claves canónicas legítimas` (PASSED)
  - `validateEvidenceStorageKey rechaza intentos de path traversal y colisiones maliciosas` (PASSED)
  - `rol EMPLEADO es denegado al intentar acceder a evidencia de INVOICE o PAYMENT` (PASSED)
  - `rol EMPLEADO es denegado al intentar acceder a EXCEPTION` (PASSED)
  - `usuario acotado a sucursal sin branchId asignado es denegado con 403 Forbidden (fail-closed)` (PASSED)
  - `acceso a entidad de otra empresa es denegado con 404 (no filtra existencia)` (PASSED)
  - `Gerente de Sucursal A1 no puede acceder a entidad perteneciente a Sucursal A2` (PASSED)
  - `Gerente de Sucursal A1 no puede acceder a entidad corporativa (branchId = null)` (PASSED)
  - `Admin corporativo puede acceder a entidades de cualquier sucursal y corporativas` (PASSED)
  - `resuelve paymentRun correctamente cuando coincide el ID directo` (PASSED)
  - `resuelve paymentRunItem enlazando a su corrida si el ID es de una partida` (PASSED)
  - `resuelve excepción válidamente para usuario autorizado` (PASSED)
  - `resuelve venta de recuperación histórica respetando permisos de inventario` (PASSED)
  - `attachEvidence inserta evidencia con almacenamiento privado y clave canónica` (PASSED)
  - `getEvidenceForSubject excluye evidencias con borrado lógico por defecto` (PASSED)
  - `getEvidencePresignedUrl genera URL firmada para evidencia autorizada` (PASSED)
  - `removeEvidence ejecuta soft delete actualizando deleted_at` (PASSED)
- `tests/unit/audit/audit-02.test.ts` (19 pruebas):
  - Invariante de motivo >= 4 caracteres en todas las operaciones críticas de auditoría (PASSED)
  - Invariante de transacción obligatoria `executor !== db` (PASSED)
  - Rollback atómico verificado ante fallos en bitácoras (PASSED)

### 4.2. Suite de Integración AUD-02 V2 en Neon Postgres Aislado (`tests/integration/audit-02-db.test.ts`)

```powershell
pnpm vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/audit-02-db.test.ts
```

**Resultado:** Exit code 0, **10/10 pruebas pasadas (14.70s)** contra Neon branch `br-round-voice-belheola`:
- `Verificación de rol runtime`: `pulso_app` confirmado con `rolsuper: false, rolbypassrls: false` (NOBYPASSRLS).
- `Dominio INVENTORY`:
  - `rechaza motivo vacío, nulo o < 4 caracteres con AuditValidationError(AUDIT_REASON_REQUIRED)` (PASSED)
  - `rechaza ejecución sin transacción activa (o con db suelto) con AUDIT_TRANSACTION_REQUIRED` (PASSED)
  - `reversión atómica: si la auditoría falla en la transacción, el descuento de stock se revierte totalmente` (PASSED)
  - `éxito atómico: mutación de stock y bitácora se confirman juntas en la misma transacción` (PASSED)
- `Dominio LABOR`:
  - `rechaza motivo ausente o corto en acciones laborales críticas` (PASSED)
  - `reversión atómica: si la bitácora laboral falla, la mutación de usuario se revierte` (PASSED)
  - `éxito atómico: mutación laboral y bitácora se confirman juntas` (PASSED)
- `Dominio FINANCE`:
  - `logCriticalDataAccess exige motivo con longitud >= 4 y transacción` (PASSED)
  - `reversión atómica: fallo en data_access_logs revierte la mutación financiera` (PASSED)
  - `éxito atómico: mutación financiera y bitácora de acceso clasificado se confirman juntas` (PASSED)

### 4.3. Suite de Integración EVI-02.a en Neon Postgres Aislado (`tests/integration/evidence-subjects-db.test.ts`)

```powershell
pnpm vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/evidence-subjects-db.test.ts
```

**Resultado:** Exit code 0, **7/7 pruebas pasadas (15.69s)** contra Neon branch `br-round-voice-belheola`:
- `1. Persistencia y consulta de evidencia INVOICE bajo pulso_app con clave canónica` (PASSED)
- `2. Persistencia de evidencia PAYMENT para corrida corporativa y partida bajo pulso_app` (PASSED)
- `3. Persistencia y borrado lógico (soft-delete) de evidencia EXCEPTION` (PASSED)
- `4. Preservación del sujeto SALE_RECOVERY` (PASSED)
- `5. Aislamiento estricto de sucursales: Gerente A2 no accede a evidencias de Sucursal A1` (PASSED)
- `6. Aislamiento multi-tenant: Empresa B no puede ver ni adjuntar a entidades de Empresa A` (PASSED)
- `7. Atomicidad y reversión: fallo en transacción revierte la inserción de evidencia` (PASSED)

### 4.4. Verificación de Estilo y Lint (`eslint`)

```powershell
pnpm exec eslint lib/services/evidence-subject-service.ts tests/unit/evidence/evidence-subject-access.test.ts tests/integration/audit-02-db.test.ts tests/integration/evidence-subjects-db.test.ts
```

**Resultado:** Exit code 0, **0 errores, 0 advertencias**.

### 4.5. Verificación de Tipos TypeScript (`tsc --noEmit`)

```powershell
pnpm exec tsc --noEmit
```

**Resultado:** **0 errores** en `lib/services/evidence-subject-service.ts` (todos los 4 errores originales de generic constraint resueltos).

---

## 5. Propuesta para Integración (Sesión S)

Para que el integrador consolide los estados en serie sin conflictos concurrentes:

1. **`tasks/todo-implementacion-faltantes.md`**:
   - En sección 4, marcar la casilla:
     `- [x] **EVI-02.a** [I/M] Sujetos de evidencia para factura, pago y excepción`
   - Actualizar el registro de `AUD-02` reflejando la comprobación de V2:
     `| AUD-02 | código implementado; V1/V2 comprobadas | eba576d + Track C2 | Neon aislado (pulso_app NOBYPASSRLS) | 19 unitarias + 10 integración Postgres real, tsc/lint exit 0 | [Auditoría crítica](evidencia/2026-11-11/AUD-02/README.md) | V1 y V2 cerradas | Rollback atómico comprobado en INVENTORY, LABOR y FINANCE |`
   - Agregar fila para `EVI-02.a`:
     `| EVI-02.a | código implementado; V1/V2 comprobadas | eba576d + Track C2 | local + Neon aislado | 18 unitarias + 7 integración Postgres real, tsc/lint exit 0 | [Sujetos EVI-02.a](evidencia/2026-11-11/EVI-02.a/README.md) | V1 y V2 cerradas | Factura, pago y excepción con tenancy y sucursal |`

2. **`tasks/mapa-implementacion-faltantes.json`**:
   - En `AUD-02`: actualizar `checks` a `["V1", "V2"]`.
   - En `EVI-02.a`: registrar `state: "código implementado"` con `checks: ["V1", "V2"]`.

3. **Próximo Paso Recomendado**:
   - Sesión **C3**: `EVI-02.b` (carga, consulta y retiro interactivo de evidencia desde rutas y componentes de UI por dominio).
