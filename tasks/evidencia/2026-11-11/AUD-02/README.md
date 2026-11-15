# AUD-02 — Hacer obligatoria la auditoría crítica

**ID:** `AUD-02`  
**Tipo/Tamaño:** I / M  
**Estado:** Código implementado; V1 y V2 comprobadas  
**Fecha:** 2026-11-15  
**Propietario:** Frente C (Auditoría / Evidencia / Excepciones)  
**Base:** HEAD `35c5dcf3d05a4b991d60e7d8c1f10f22b433e12c` más cambios locales del árbol de trabajo  

---

## 1. Resumen y Alcance

Se implementa el contrato de auditoría crítica transaccional conforme a `plans/2026-11-11-plan-implementacion-faltantes.md` (sección 4, ticket AUD-02) y `tasks/2026-11-15-investigacion-y-sesiones-faltantes.md`:

1. **Catálogo formal de acciones y callers críticos (`CRITICAL_AUDIT_CATALOG`)**:
   - Clasificación explícita de operaciones que mutan stock físico, condiciones laborales/salariales, estatus de excepciones o balances contables/financieros.
   - En todas estas operaciones:
     - El motivo (`reason`) es estrictamente obligatorio (no nulo, no vacío, longitud mínima >= 4 caracteres).
     - La auditoría debe ejecutarse en la **misma transacción** Postgres que la mutación de negocio (`executor !== db`).
     - Si la inserción en la bitácora falla, el error propaga y revierte atómicamente la mutación de negocio (rollback sin efectos parciales).
2. **Publicación de contratos para Frentes A3 y D**:
   - **Frente A (A3 / Ventas y Stock)**: `AuditService.logCriticalInventoryAction`, `AuditService.withAuditTransaction`, y soporte para acciones críticas como `SALE_RECOVERY_APPLY`, `SALE_VOID`, `WASTE`, `ADJUSTMENT`, `BATCH`, `TRANSFER`.
   - **Frente D (Finanzas y Contabilidad)**: `logCriticalDataAccess` en `lib/security/audit.ts` para `FINANCIAL_CLOSE` (FIN-02.a), `DEPOSIT_CORRECTION` (BAN-06.b), y aprobaciones `APPROVAL_*` (APR-01).
3. **Preservación de usos no críticos existentes**:
   - Acciones de consulta/lectura (`VIEW`, `READ`) y mutaciones ordinarias de catálogo (`ITEM`, `SUPPLIER`, `PAYEE`) conservan compatibilidad completa hacia atrás: motivo opcional y ejecución best-effort (sin obligar a transacción ni romper handlers existentes).
4. **Primer caller crítico acotado**:
   - `app/api/inventory/waste/[id]/approval/route.ts` migrado a auditoría atómica transaccional:
     - `APPROVE` ahora descuenta inventario (`FOR UPDATE`), inserta movimiento en `inventory_movements`, aprueba la merma y registra `inventory_audit_log` en la **misma transacción**.
     - `REJECT` exige motivo de rechazo y actualiza estatus con auditoría atómica en transacción.
     - Si la bitácora falla en cualquiera de las dos rutas, la transacción se aborta y ni el inventario ni el estatus de la merma cambian.

---

## 2. Inventario Canónico de Acciones Críticas (`CRITICAL_AUDIT_CATALOG`)

| Dominio | Entidad (`entityType`) | Acción (`action`) | Motivo | Transacción | Descripción operativa |
|---|---|---|---|---|---|
| `INVENTORY` | `WASTE` | `CREATE` | Obligatorio | Obligatoria | Registro de merma/desecho que destruye stock físico |
| `INVENTORY` | `WASTE` | `UPDATE` | Obligatorio | Obligatoria | Aprobación o rechazo administrativo de merma |
| `INVENTORY` | `ADJUSTMENT` | `CREATE` | Obligatorio | Obligatoria | Ajuste manual de stock por varianza o conteo |
| `INVENTORY` | `ADJUSTMENT` | `UPDATE` | Obligatorio | Obligatoria | Corrección de ajuste de inventario |
| `INVENTORY` | `BATCH` | `UPDATE` | Obligatorio | Obligatoria | Inmovilización, cuarentena, reserva o liberación de lote |
| `INVENTORY` | `TRANSFER` | `CREATE` | Obligatorio | Obligatoria | Traspaso de inventario entre sucursales |
| `INVENTORY` | `TRANSFER` | `UPDATE` | Obligatorio | Obligatoria | Modificación o cancelación de traspaso |
| `INVENTORY` | `SALE_RECOVERY_APPLY` | `CREATE` | Obligatorio | Obligatoria | A3: Aplicación auditada de recuperación histórica sobre stock |
| `INVENTORY` | `SALE_VOID` | `CREATE` | Obligatorio | Obligatoria | Anulación de venta y reversa de consumo de stock |
| `LABOR` | `SALARY` | `CREATE` | Obligatorio | Obligatoria | Asignación de salario o contrato salarial inicial |
| `LABOR` | `SALARY` | `UPDATE` | Obligatorio | Obligatoria | Modificación de salario o deducciones (NOM-01) |
| `LABOR` | `SALARY` | `DELETE` | Obligatorio | Obligatoria | Baja o anulación de esquema salarial |
| `LABOR` | `CONTRACT` | `UPDATE` | Obligatorio | Obligatoria | Modificación de condiciones contractuales |
| `LABOR` | `CONTRACT` | `DELETE` | Obligatorio | Obligatoria | Rescisión o terminación contractual |
| `LABOR` | `PROFILE` | `DELETE` | Obligatorio | Obligatoria | Baja definitiva de colaborador |
| `LABOR` | `IMSS_MOVEMENT` | `CREATE` | Obligatorio | Obligatoria | Movimiento afiliatorio ante IMSS |
| `LABOR` | `IMSS_MOVEMENT` | `UPDATE` | Obligatorio | Obligatoria | Actualización o acuse de movimiento IMSS |
| `SECURITY` | `EXCEPTION` | `UPDATE` | Obligatorio | Obligatoria | Override, resolución manual o reapertura de excepción |
| `FINANCE` | `FINANCIAL_CLOSE` | `UPDATE` | Obligatorio | Obligatoria | FIN-02.a: Cierre o reapertura de período financiero |
| `FINANCE` | `FINANCIAL_CLOSE` | `APPROVE` | Obligatorio | Obligatoria | Aprobación de cierre contable y congelamiento de P&L |
| `FINANCE` | `DEPOSIT_CORRECTION` | `UPDATE` | Obligatorio | Obligatoria | BAN-06.b: Corrección auditada de depósito contabilizado |
| `FINANCE` | `DEPOSIT_CORRECTION` | `DELETE` | Obligatorio | Obligatoria | Reversa de depósito contabilizado |
| `FINANCE` | `APPROVAL_PURCHASE` | `APPROVE` | Obligatorio | Obligatoria | APR-01: Aprobación de orden de compra |
| `FINANCE` | `APPROVAL_INVOICE` | `APPROVE` | Obligatorio | Obligatoria | APR-01: Aprobación de factura de proveedor |
| `FINANCE` | `APPROVAL_EXPENSE` | `APPROVE` | Obligatorio | Obligatoria | APR-01: Aprobación de gasto operativo |
| `FINANCE` | `APPROVAL_PAYMENT` | `APPROVE` | Obligatorio | Obligatoria | APR-01: Aprobación de solicitud/dispersión de pago |
| `FINANCE` | `APPROVAL_PAYROLL` | `APPROVE` | Obligatorio | Obligatoria | APR-01: Aprobación de nómina timbrada |

---

## 3. Archivos Involucrados (Límite estricto: 5 archivos)

1. `lib/services/audit-service.ts`:
   - Definición de errores tipados (`AuditValidationError`).
   - Catálogo canónico `CRITICAL_AUDIT_CATALOG`, clasificadores `isCriticalInventoryAction`, `isCriticalEmployeeAction`.
   - Validadores de motivo `validateAuditReason` y transacción `assertTransactionExecutor`.
   - Métodos `logCriticalInventoryAction`, `logCriticalEmployeeAction`, `withAuditTransaction`.
   - Delegación inteligente en `logInventoryAction` y `logEmployeeAction` preservando compatibilidad no crítica.
2. `lib/security/audit.ts`:
   - Interfaz `LogCriticalDataAccessInput`.
   - Función `logCriticalDataAccess`: validación de motivo y transacción, inserción en `dataAccessLogs` con propagación de fallos para rollback atómico de operaciones financieras.
   - Preservación de `logDataAccess` best-effort para rutas de guardia.
3. `app/api/inventory/waste/[id]/approval/route.ts` (Primer caller crítico acotado):
   - Migración de `APPROVE` y `REJECT` a transacciones atómicas con `logCriticalInventoryAction`.
   - Exigencia de motivo en rechazo (mínimo 4 caracteres).
   - Movimiento de auditoría dentro de `db.transaction(tx)`.
4. `tests/unit/audit/audit-02.test.ts` (Prueba focal AUD-02):
   - Suite completa con base de datos Postgres real en memoria (`@electric-sql/pglite`).
   - 19 pruebas focales cubriendo normal, vacío, error, permisos/empresa/sucursal, idempotencia y reversión atómica ante fallo simulado por trigger en bitácora.
5. `tasks/evidencia/2026-11-11/AUD-02/README.md` (Este documento).

---

## 4. Ejecución y Resultados de Pruebas

### 4.1. Suite Focal AUD-02 (`tests/unit/audit/audit-02.test.ts`)

```powershell
pnpm test:unit tests/unit/audit/audit-02.test.ts
```

**Resultado:** Exit code 0, **19/19 pruebas pasadas**:
- `AUD-02: Catálogo e Invariantes de Auditoría Crítica`:
  - `el catálogo formal contiene los 4 dominios y todas las operaciones críticas declaradas` (PASSED)
  - `isCriticalInventoryAction clasifica correctamente acciones de stock` (PASSED)
  - `isCriticalEmployeeAction clasifica correctamente acciones laborales y de excepción` (PASSED)
- `AUD-02: Exigencia Estricta de Motivo y Transacción`:
  - `logCriticalInventoryAction rechaza motivos vacíos, nulos o de solo espacios` (PASSED)
  - `logCriticalInventoryAction rechaza ejecución sin transacción activa (o con db suelto)` (PASSED)
  - `logCriticalEmployeeAction rechaza motivo inválido y ejecución sin transacción` (PASSED)
  - `logCriticalDataAccess rechaza motivo ausente o ejecución sin transacción` (PASSED)
- `AUD-02: Atomicidad y Reversión ante Fallo de Auditoría`:
  - `si la auditoría de inventario falla dentro de la transacción, la mutación de negocio se revierte completamente` (PASSED)
  - `si la auditoría de empleado falla, revierte la transacción laboral` (PASSED)
  - `si logCriticalDataAccess falla, revierte la mutación financiera` (PASSED)
- `AUD-02: Preservación de Usos No Críticos (Best-effort)`:
  - `logInventoryAction sobre entidades no críticas conserva semántica no transaccional` (PASSED)
  - `logEmployeeAction sobre acciones no críticas conserva semántica no transaccional` (PASSED)
  - `logDataAccess en modo guardia de lectura no lanza error si ocurre fallo de inserción` (PASSED)
- `AUD-02: Primer Caller Crítico Acotado (POST /api/inventory/waste/[id]/approval)`:
  - `Aprobación exitosa: muta lote, crea movimiento, aprueba merma y registra auditoría atómicamente` (PASSED)
  - `Rechazo exitoso: actualiza estatus a REJECTED con motivo obligatorio y no toca stock` (PASSED)
  - `Rechazo sin motivo es denegado con 400 Bad Request y no altera datos` (PASSED)
  - `Reversión Atómica: si la auditoría falla en la aprobación, se revierten merma, lote y movimientos` (PASSED)
  - `Alcance de sucursal: Gerente no puede aprobar merma de otra sucursal` (PASSED)
  - `Idempotencia: no permite volver a aprobar o rechazar una merma ya resuelta` (PASSED)

### 4.2. Prueba de No Regresión (`tests/unit/inventory/batch-access.test.ts`)

```powershell
pnpm test:unit tests/unit/inventory/batch-access.test.ts
```

**Resultado:** Exit code 0, **46/46 pruebas pasadas**.

### 4.3. Verificación de Tipos TypeScript (`tsc --noEmit`)

```powershell
pnpm exec tsc --noEmit
```

**Resultado:** Exit code 0, 0 errores.

### 4.4. Verificación de Estilo y Lint (`eslint`)

```powershell
pnpm exec eslint lib/services/audit-service.ts lib/security/audit.ts app/api/inventory/waste/[id]/approval/route.ts tests/unit/audit/audit-02.test.ts
```

**Resultado:** Exit code 0, 0 errores, 0 advertencias.

---

## 5. Propuesta para Integración (Sesión S)

Para que la sesión de integración consolide la documentación sin conflictos concurrentes:

1. **`tasks/todo-implementacion-faltantes.md`**:
   - Actualizar regla de sección 4:
     `- [x] **AUD-02** [I/M] Hacer obligatoria la auditoría crítica`
   - Agregar fila a la tabla de `Registro de ejecución`:
     `| AUD-02 | código implementado; V1/V2 comprobadas | 35c5dcf + diff C1 | local (PGlite) | 19 unitarias/integración focal, tsc/lint exit 0 | [Auditoría crítica](evidencia/2026-11-11/AUD-02/README.md) | fila 01.06 parcial | Espera integración con A3 (recovery.apply) y D (cierre financiero / depósitos) |`
2. **`tasks/mapa-implementacion-faltantes.json`**:
   - En `execution`, registrar:
     ```json
     "AUD-02": {
       "state": "código implementado",
       "evidence": [
         {
           "file": "tasks/evidencia/2026-11-11/AUD-02/README.md",
           "head": "35c5dcf3d05a4b991d60e7d8c1f10f22b433e12c",
           "environment": "local (PGlite)",
           "commands": [
             { "command": "pnpm test:unit tests/unit/audit/audit-02.test.ts", "exit": 0 },
             { "command": "pnpm exec tsc --noEmit", "exit": 0 },
             { "command": "pnpm exec eslint lib/services/audit-service.ts lib/security/audit.ts app/api/inventory/waste/[id]/approval/route.ts tests/unit/audit/audit-02.test.ts", "exit": 0 }
           ],
           "checks": ["V1", "V2"]
         }
       ]
     }
     ```
3. **Siguiente paso recomendado para Frente C**:
   - Sesión **C2**: `EVI-02.a` (añadir sujetos de evidencia faltantes para factura, pago y excepción con validación por entidad, empresa y sucursal).
