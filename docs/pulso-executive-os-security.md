# Pulso Executive OS — Seguridad, Privacidad y Cumplimiento

> **Capa transversal ausente del `pulso-executive-os-v2.md`.**
>
> Pulso toca nómina, CFDI, cuentas bancarias (CLABE), datos personales de empleados (CURP, RFC, NSS) y proyecciones financieras de grupos restauranteros. Para un producto posicionado como "director ejecutivo digital", la seguridad no puede quedar implícita. Este documento cubre los cuatro pilares que la v1 y la v2 omitieron: **control de acceso granular auditado, cifrado en reposo, cumplimiento LFPDPPP y aislamiento sucursal propia vs franquiciada**.

---

## Índice

1. [Inventario del Estado Actual (verificado en código)](#1-inventario-del-estado-actual)
2. [Modelo de Amenazas](#2-modelo-de-amenazas)
3. [Análisis de Brechas (Gap Analysis)](#3-análisis-de-brechas)
4. [Arquitectura de Seguridad: 4 Pilares](#4-arquitectura-de-seguridad-4-pilares)
5. [Pilar 1 — Control de Acceso Granular y Auditado](#5-pilar-1--control-de-acceso-granular-y-auditado)
6. [Pilar 2 — Cifrado de Datos Financieros y PII en Reposo](#6-pilar-2--cifrado-de-datos-financieros-y-pii-en-reposo)
7. [Pilar 3 — Cumplimiento LFPDPPP](#7-pilar-3--cumplimiento-lfpdppp)
8. [Pilar 4 — Aislamiento entre Sucursales Propias y Franquiciadas](#8-pilar-4--aislamiento-entre-sucursales-propias-y-franquiciadas)
9. [Auditoría y Observabilidad de Seguridad](#9-auditoría-y-observabilidad-de-seguridad)
10. [Integración en los Sprints (cross-cutting)](#10-integración-en-los-sprints-cross-cutting)
11. [Schema Nuevo Requerido](#11-schema-nuevo-requerido)
12. [Riesgos y Mitigaciones](#12-riesgos-y-mitigaciones)
13. [Métricas de Éxito](#13-métricas-de-éxito)

---

## 1. Inventario del Estado Actual

### 1.1 Lo que existe (verificado)

| Componente | Ubicación | Estado |
|---|---|---|
| Roles (7) | `lib/db/schema/auth.ts:5` → `pgEnum('role', ['SUPER_ADMIN','OWNER','ADMIN','GERENTE','SUPERVISOR','EMPLEADO','READONLY'])` | ✅ Enum en DB |
| Matriz RBAC | `lib/permissions.ts` → `PERMISSIONS` (8 recursos × 5 acciones), `hasPermission`, `canManageRole`, `ROLES_HIERARCHY` | ✅ Pero **gruesa** — sin scoping por branch |
| Guards de ruta | `lib/rbac/require-role.ts` → `requireRole`, `requireRoleApi`, `requireManagementRole` | ✅ Existen |
| Contexto de tenant | `lib/tenant-context.ts` → `getCurrentTenant()` (lee cookie `pulso_selected_branch`, header `x-pulso-tenant-id`, valida contra `session.companyId`) | ⚠️ **Solo 3 call sites** en todo el codebase |
| Permisos de empleado | `lib/rbac/employee-permissions.ts` (añade rol `HR`) | ✅ Permisos granulares de empleado |
| Audit log de empleados | `lib/db/schema.ts:1538` → `employeeAuditLogs` con `isSensitive`, `requiresApproval`, `approvedBy`, `retentionUntil`, `ipAddress`, `userAgent`, `oldValue`/`newValue` | ⚠️ **Solo empleados** — sin audit log financiero |
| UI de audit | `components/finance/audit-log-table.tsx` | ✅ Componente existe |
| Auth | `lib/auth.ts`, `lib/auth-config.ts`, `lib/auth-client.ts` (better-auth, session-based) | ✅ |

### 1.2 Lo que NO existe (verificado — gaps críticos)

| Gap | Verificación | Impacto |
|---|---|---|
| **Cifrado en reposo de PII/financieros** | `rg "encrypt\|decrypt\|cipher\|pgp" lib/db/schema/` → 0 coincidencias | CURP, RFC, NSS, CLABE, `cardNumber`, `dateOfBirth`, `personalEmail`, `personalPhone`, `address`, `salaryHistory` — **todo en plaintext** |
| **Marca de propiedad de sucursal (propia vs franquiciada)** | `branches` schema (`lib/db/schema/core.ts:21`) **no tiene** `ownershipType`/`isFranchise`/`franchiseeId`/`franchiseAgreement` | La "dimensión 7: franquiciadas" del diseño no tiene implementación técnica — un franquiciatario podría ver datos de otra sucursal |
| **Scoping de branch en queries** | `getCurrentTenant()` solo se invoca en 3 archivos | GERENTE con `users: ['read']` puede leer **todos** los empleados de la empresa, no solo los de su sucursal |
| **Audit log financiero general** | Solo `employeeAuditLogs` existe; sin `financialAuditLogs` o `dataAccessLogs` | Quién consultó CLABE, CFDI, cash flow, nómina — **no se registra** |
| **LFPDPPP: clasificación de datos** | `rg "lfpd\|PII\|proteccion.*datos\|consent\|ARCO" lib/` → 0 | Sin categorización de datos sensibles, sin registro de consentimiento, sin workflow de derechos ARCO |
| **Política de retención de datos** | `employeeAuditLogs.retentionUntil` existe pero **no se aplica** en otros datos | Sin borrado automático de PII al terminar relación laboral (Art. 16 LFPDPPP: "supresión... una vez que hayan dejado de ser necesarios") |
| **Máscara/redacción en UI/API** | `cardNumber` (comentario dice "Last 4 digits for display") pero el campo almacena el completo | Sin redacción de CLABE/CURP/RFC/NSS en respuestas API |
| **Row-Level Security (RLS) en Postgres** | Sin `pgRLS`/`enableRowLevelSecurity` en schema | Si se compromete la conexión DB (leak de `DATABASE_URL`), todo accesible |
| **Key management** | Sin gestión de claves — `BETTER_AUTH_SECRET` es lo único secreto | Cualquier cifrado nuevo necesita KMS desde el día 1 |

---

## 2. Modelo de Amenazas

### 2.1 Actores y motivaciones

| Actor | Motivación | Superficie en Pulso |
|---|---|---|
| **Franquiciatario curioso/malicioso** | Ver ventas, nómina o márgenes de otras sucursales (propias del grupo o de otros franquiciatarios) | Falta de scoping por `ownershipType` — el GERENTE de una franquicia hereda permisos de lectura company-wide |
| **Empleado interno** | Ver salarios de compañeros, CLABE de compañeros, datos de clientes | `EMPLEADO` con `users: ['read']` + sin filtro de branch |
| **Atacante externo (leak de `DATABASE_URL`)** | Exfiltrar PII y financieros para fraude/targeted phishing | Sin RLS, sin cifrado de columnas — una API key comprometida = todo |
| **Insider con acceso DB (dev/contractor)** | same | Igual |
| **Compromiso de sesión del OWNER** | Manipular nómina, aprobar pagos fraudulentos, exfiltrar CFDI | Sesión de OWNER = control total sin 2FA reportado, sin approval workflow para pagos críticos |
| **Subpoena / auditoría regulatoria** | INAI revisa cumplimiento LFPDPPP | Sin registro de consentimiento, sin workflow ARCO, datos retuvados indefinidamente |

### 2.2 Datos sensibles inventariados (en `lib/db/schema.ts`)

| Dato | Tabla:campo | Clasificación LFPDPPP | Crítico |
|---|---|---|---|
| CURP | `employees.curp` | Sensible (Art. 3-VII LFPDPPP: datos que por sí solos permitan identificar) | ✅ |
| RFC | `employees.rfc` | Sensible financiero | ✅ |
| NSS (IMSS) | `employees.nss` | Sensible | ✅ |
| CLABE bancaria | `employees.clabe` | Financiero sensible | ✅ |
| Número de tarjeta | `employees.cardNumber` | Financiero sensible | ✅ (comenta "last 4" pero almacena completo) |
| Salario | `employees.baseSalary/monthly/weeklySalary`, `salaryHistory.*` | Sensible | ✅ |
| Fecha nacimiento | `employees.dateOfBirth` | Personal | ✅ |
| Contacto personal | `employees.personalEmail`, `personalPhone`, `emergencyContact*` | Personal | ✅ |
| Domicilio | `employees.address` (jsonb), `city`, `state`, `zipCode` | Personal | ✅ |
| RFC emisor/receptor CFDI | `cfdiInvoices/rfcEmisor`, `rfcReceptor` (línea 2432) | Financiero | ✅ |
| Cash flow proyectado | `corporateTwins.projectedCashFlowCents` (nuevo en v2) | Estratégico | ✅ |
| Saldo bancario | Derivado de `cashFlowService` | Financiero | ✅ |

---

## 3. Análisis de Brechas (Gap Analysis)

### Brecha 1 — RBAC granular por branch (actualmente company-wide)

**Hoy:** `PERMISSIONS['GERENTE'].users = ['read','create','update']` le permite leer **todos** los usuarios de la empresa, sin importar la branch asignada. `branches: ['read','update']` es idéntico.

**Necesario:** ABAC (Attribute-Based Access Control) — la decisión combina `role` + `branchId` del actor + `ownershipType` del recurso + `isSensitive` del campo.

```typescript
// OBJETIVO
hasPermission(userRole, resource, action, { branchId, dataClassification })
// GERENTE solo puede leer users de SU branchId
// EMPLEADO nunca puede leer salaryHistory de nadie
// Cualquiera sin flag financiero no ve CLABE aunque tenga read
```

### Brecha 2 — Cifrado en reposo inexistente

**Hoy:** todos los campos sensibles son `text()` plaintext. Una API key comprometida (`DATABASE_URL`) expone **todo** el PII y financiero.

**Necesario:** cifrado a nivel de columna para datos clasificados "Sensible" o "Financiero sensible" (ver §6).

### Brecha 3 — Sin audit log financiero

**Hoy:** `employeeAuditLogs` cubre acciones de empleado (CRUD de salario, contrato, documento). **No hay registro de quién consultó** CLABE, cash flow, CFDI, nómina.

**Necesario:** `dataAccessLogs` general — captura SELECT/VIEW de datos sensibles, no solo mutaciones.

### Brecha 4 — Sucursales propias vs franquiciadas sin distinción

**Hoy:** `branches` no tiene `ownershipType`. La "dimensión 7: franquiciadas" del diseño estratégico no existe técnicamente.

**Necesario:** modelo de ownership + RLS por `companyOwnershipScope` (ver §8).

### Brecha 5 — Sin cumplimiento LFPDPPP

**Hoy:** cero rastros de clasificación de datos, consentimiento, retención, ARCO.

**Necesario:** los 4 elementos del §7.

---

## 4. Arquitectura de Seguridad: 4 Pilares

```
┌─────────────────────────────────────────────────────────────┐
│                    PILAR 1: ACCESO                            │
│   ABAC: role + branchId + ownershipType + classification     │
│   Guards en Server Components + API routes + Inngest steps   │
│   2FA obligatorio para OWNER/ADMIN/HR                        │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│                    PILAR 2: CIFRADO                          │
│   Column-level encryption (pgcrypto) para PII/financiero    │
│   KMS: env KEK + per-tenant DEK rotation                    │
│   Redacción automática en API layer (masking middleware)    │
│   TLS en tránsito (Neon) + RLS en DB (defensa en profundidad)│
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│                    PILAR 3: LFPDPPP                          │
│   Data classification tags en schema                        │
│   Consent registry + ARCO workflow (Inngest)                │
│   Retención automática (Art. 16): borrado tras cese         │
│   Aviso de privacidad versionado                            │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│                    PILAR 4: AISLAMIENTO                      │
│   branches.ownershipType ('OWNED' | 'FRANCHISE')            │
│   Franchisee = sub-tenant con su propia companyId-scoped view│
│   RLS policies por ownershipScope                            │
│   Cross-branch aggregation respeta franquiciatario-propietario│
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Pilar 1 — Control de Acceso Granular y Auditado

### 5.1 Evolución RBAC → ABAC

**Archivo a modificar:** `lib/permissions.ts` + nuevo `lib/rbac/abac.ts`

```typescript
// lib/rbac/abac.ts
export interface AccessContext {
  userRole: Role;
  userBranchId?: string | null;
  userCompanyId: string;
  resourceOwnershipType?: 'OWNED' | 'FRANCHISE';
  dataClassification?: 'PUBLIC' | 'INTERNAL' | 'PERSONAL' | 'SENSITIVE' | 'FINANCIAL';
}

export interface AccessDecision {
  allowed: boolean;
  redactFields?: string[];   // campos a enmascarar aunque se permita el read
  reason?: string;
}

export function evaluateAccess(
  resource: Resource,
  action: Action,
  ctx: AccessContext,
  target?: { branchId?: string; companyId?: string; ownershipType?: 'OWNED' | 'FRANCHISE' }
): AccessDecision {
  // 1. RBAC base (matriz existente)
  if (!hasPermission(ctx.userRole, resource, action)) {
    return { allowed: false, reason: 'role-not-permitted' };
  }

  // 2. Branch scoping — GERENTE/SUPERVISOR/EMPLEADO solo su branchId
  const branchScopedRoles: Role[] = ['GERENTE', 'SUPERVISOR', 'EMPLEADO'];
  if (branchScopedRoles.includes(ctx.userRole) && target?.branchId) {
    if (target.branchId !== ctx.userBranchId) {
      return { allowed: false, reason: 'branch-out-of-scope' };
    }
  }

  // 3. Data classification gate — SENSITIVE/FINANCIAL requiere rol mínimo HR/ADMIN/OWNER
  const sensitiveGates: Record<Role, boolean> = {
    'SUPER_ADMIN': true, 'OWNER': true, 'ADMIN': true, 'HR': true,
    'GERENTE': false, 'SUPERVISOR': false, 'EMPLEADO': false, 'READONLY': false,
  };
  if (ctx.dataClassification === 'SENSITIVE' || ctx.dataClassification === 'FINANCIAL') {
    if (!sensitiveGates[ctx.userRole]) {
      return { allowed: false, reason: 'insensitive-data-gate' };
    }
  }

  // 4. Franchise isolation (Pilar 4)
  if (target?.ownershipType === 'FRANCHISE' && ctx.userRole !== 'OWNER' && ctx.userRole !== 'SUPER_ADMIN') {
    // Un GERENTE de sucursal propia no ve datos de franquicia
    // (a menos que sea el franquiciatario dueño de esa branch)
    // Ver Pilar 4 para reglas completas
  }

  return { allowed: true };
}

// Helper para API routes — reemplaza requireRoleApi
export async function requirePermissionApi(
  resource: Resource,
  action: Action,
  opts?: { targetBranchId?: string; classification?: DataClassification }
): Promise<AuthContext> {
  const { session, userRole, user } = await requireRoleApi([]); // reusar auth existente
  const ctx: AccessContext = {
    userRole, userBranchId: user.branchId, userCompanyId: user.companyId!,
    dataClassification: opts?.classification,
  };
  const decision = evaluateAccess(resource, action, ctx, { branchId: opts?.targetBranchId });
  if (!decision.allowed) throw ApiError.forbidden(decision.reason);
  return { session, user, decision };
}
```

### 5.2 Adopción incremental (no big-bang)

**No reescribir las 84 servicios a la vez.** Estrategia:

1. **Sprint Sec-1:** introducir `evaluateAccess` + `requirePermissionApi`. Mantener `requireRoleApi` como wrapper que llama a `evaluateAccess` sin scoping (decisiones `allowed` preservan comportamiento actual).
2. **Rollout por dominio:** empezar por rutas financieras (`/api/finance/*`, `/api/payroll/*`, `/api/cfdi/*`) → migrar a `requirePermissionApi` con `classification: 'FINANCIAL'`.
3. **Segundo:** rutas de empleados (`/api/employees/*`) con `classification: 'SENSITIVE'`.
4. **Tercero:** el resto.

### 5.3 2FA para roles privilegiados

better-auth soporta `twoFactor`. Activar obligatorio para:
- `OWNER`, `ADMIN`, `HR`, `SUPER_ADMIN`

Configuración en `lib/auth-config.ts`:
```typescript
export const auth = betterAuth({
  // ... existente
  twoFactor: {
    enabled: true,
    requiredForRoles: ['OWNER', 'ADMIN', 'HR', 'SUPER_ADMIN'],
    plugin: twoFactorTOTP,
  },
});
```

Sin 2FA, OWNER no puede acceder a `/api/executive/reason` ni aprobar pagos.

### 5.4 Approval workflow para pagos críticos

**Nuevo:** `paymentApprovals` — pagos > umbral (configurable, ej. $50,000 MXN) requieren doble aprobación (OWNER + ADMIN, o OWNER + CFO si existe). Pattern análogo a `employeeAuditLogs.requiresApproval`.

---

## 6. Pilar 2 — Cifrado de Datos Financieros y PII en Reposo

### 6.1 Estrategia de cifrado a nivel de columna (pgcrypto)

Postgres ya tiene `pgcrypto`. Neon lo soporta. Plan:

```sql
-- Habilitar extensión (one-time, vía migration)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

**Cifrar columnas sensibles con `pgp_sym_encrypt` / `pgp_sym_decrypt`:**

```typescript
// lib/services/crypto/column-cipher.ts
import { sql } from "drizzle-orm";

// KEK (Key Encryption Key) deriva de env var; DEK (Data Encryption Key) por tenant
// En la práctica Neon soporta esto; ver §6.3
export const ENCRYPTED_PREFIX = "enc::";

export function encryptColumn(value: string): string {
  // App-layer encryption con DEK derivado del tenant
  // Persistir como "enc::<ciphertext>" para distinguir plaintext legacy
}

export function decryptColumn(value: string): string {
  if (!value.startsWith(ENCRYPTED_PREFIX)) return value; // legacy plaintext
  // decrypt
}
```

**Columnas objetivo (verificado en `lib/db/schema.ts:1383-1417`):**

| Tabla | Columna | Clasificación |
|---|---|---|
| `employees` | `curp`, `rfc`, `nss` | SENSIBLE |
| `employees` | `clabe`, `cardNumber` | FINANCIAL |
| `employees` | `dateOfBirth`, `personalEmail`, `personalPhone` | PERSONAL |
| `employees` | `emergencyContactPhone`, `emergencyContactEmail` | PERSONAL |
| `employees` | `address` (jsonb, cifrar whole) | PERSONAL |
| `employees` | `bankName` | FINANCIAL |
| `salaryHistory` | `previousSalary`, `newSalary` | FINANCIAL |
| `cfdiInvoices` | `rfcEmisor`, `rfcReceptor` | FINANCIAL |
| `corporateTwins` (nuevo v2) | `projectedCashFlowCents`, `upcomingObligationsCents` | FINANCIAL |

**Migración de datos existentes:**
- Backfill job (Inngest) que lee plaintext → cifra → persiste con prefijo `enc::`.
- Durante la transición, `decryptColumn` acepta ambos formatos.
- Después del backfill, bloquear escritura plaintext a nivel de app (middleware de Drizzle).

### 6.2 Redacción automática (masking) en API/UI

**Nuevo:** middleware de serialización que enmascara datos sensibles según `AccessDecision.redactFields`.

```typescript
// lib/rbac/masking.ts
export const FIELD_MASKERS = {
  clabe: (v: string) => v ? `****${v.slice(-4)}` : v,        // CLABE → ****1234
  cardNumber: (v: string) => v ? `****${v.slice(-4)}` : v,
  curp: (v: string) => v ? `${v.slice(0,4)}***${v.slice(-2)}` : v,
  rfc: (v: string) => v ? `${v.slice(0,4)}***${v.slice(-3)}` : v,
  nss: (v: string) => v ? `***${v.slice(-4)}` : v,
  personalEmail: (v: string) => v ? `${v[0]}***@${v.split('@')[1]}` : v,
  personalPhone: (v: string) => v ? `***${v.slice(-4)}` : v,
} as const;

export function maskSensitive(obj: any, decision: AccessDecision): any {
  if (!decision.redactFields) return obj;
  // Aplicar maskers a los campos listados en redactFields
}
```

El resultado: GERENTE puede ver el perfil de un empleado de su sucursal pero **ve `****1234` en CLABE**, no el completo.

### 6.3 Key Management (KMS)

**Sin KMS no hay cifrado.** Plan por capas:

```
KEK (Key Encryption Key) ── env var PULSO_KEK, rotada cada 90 días
   │
   └─ DEK per-tenant ── almacenado cifrado en tabla `tenant_keys`
        │
        └─ Cifra columnas sensibles
```

- **KEK:** variable de entorno, nunca en DB.
- **DEK:** por `companyId`, persistido cifrado (`pgp_sym_encrypt(dek, :kek)`) en tabla nueva `tenant_keys`. Rotación anual.
- **Access:** solo `SuperAdmin` y PoC de `Inngest` descifran el DEK en runtime.
- **Neon Note:** Neon cifra el volumen en reposo (disco), pero **no columnas** — hay que hacerlo en la app.

### 6.4 Row-Level Security (RLS) en Postgres — defensa en profundidad

Aunque el scoping en la app previene la mayoría de accesos indebidos, RLS en Postgres protege contra el caso de leak de `DATABASE_URL`:

```sql
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY branch_scope_employees ON employees
  USING (
    company_id = current_setting('app.current_company_id')::uuid
    AND (
      current_setting('app.current_role') IN ('OWNER','SUPER_ADMIN','ADMIN','HR')
      OR branch_id::text = current_setting('app.current_branch_id')
    )
  );
```

**Session variables** seteadas en el pool de conexión (`SET app.current_company_id = ...`). Esto requiere un middleware de Drizzle que setee las GUCs en cada transacción.

⚠️ **Costo:** RLS añade latencia y complejidad de debugging. Recomendado **post-Sprint Sec-2** tras estabilizar el cifrado de columnas.

---

## 7. Pilar 3 — Cumplimiento LFPDPPP

Ley Federal de Protección de Datos Personales en Posesión de los Particulares (México). Regula a Pulso como **responsable** del tratamiento de datos de empleados.

### 7.1 Clasificación de datos (taggear el schema)

**Nuevo:** `DataClassification` type + metadata en cada columna sensible.

```typescript
// lib/db/schema/classification.ts
export type DataClassification = 'PUBLIC' | 'INTERNAL' | 'PERSONAL' | 'SENSITIVE' | 'FINANCIAL';

// Metadata declarativa — Fields can opt into classification
export const SENSITIVE_FIELDS = {
  employees: ['curp', 'rfc', 'nss', 'dateOfBirth', 'personalEmail', 'personalPhone',
              'address', 'emergencyContactPhone', 'emergencyContactEmail', 'clabe', 'cardNumber'],
  salaryHistory: ['previousSalary', 'newSalary'],
  cfdiInvoices: ['rfcEmisor', 'rfcReceptor'],
} as const;
```

Usado por: `evaluateAccess` (Pilar 1), `masking` (Pilar 2), audit log (§9), retención (§7.3).

### 7.2 Registro de consentimiento + Aviso de Privacidad

**Nuevas tablas:**

```typescript
export const dataConsents = pgTable("data_consents", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  privacyNoticeVersion: text("privacy_notice_version").notNull(),  // "v1.0", "v2.0"
  consentType: text("consent_type").notNull(),  // 'EMPLOYMENT' | 'PAYROLL' | 'MONITORING'
  grantedAt: timestamp("granted_at").defaultNow().notNull(),
  revokedAt: timestamp("revoked_at"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  proofDocumentId: uuid("proof_document_id"),  // referencia a evidencia firmada
});

export const privacyNotices = pgTable("privacy_notices", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
  version: text("version").notNull().unique(),
  companyId: uuid("company_id"),  // null = default del sistema
  contentUrl: text("content_url").notNull(),  // R2/stored PDF
  publishedAt: timestamp("published_at").defaultNow().notNull(),
  active: boolean("active").default(true).notNull(),
});
```

Nuevo aviso de privacidad debe versionarse; empleados existentes deben re-consentir al subir versión (Inngest dispara notificación).

### 7.3 Derechos ARCO (Acceso, Rectificación, Cancelación, Oposición)

**Nuevo:** workflow Inngest + tabla `arcoRequests`.

```typescript
export const arcoRequests = pgTable("arco_requests", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
  userId: uuid("user_id").notNull(),
  companyId: uuid("company_id").notNull(),
  requestType: text("request_type").notNull(),  // 'ACCESS' | 'RECTIFY' | 'CANCEL' | 'OPPOSE'
  description: text("description"),
  status: text("status").default('PENDING').notNull(),  // PENDING|IN_REVIEW|FULFILLED|REJECTED
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  fulfilledAt: timestamp("fulfilled_at"),
  fulfilledBy: text("fulfilled_by"),
  responseDocumentId: uuid("response_document_id"),
});
```

- **ACCESS:** export de todos los datos personales del usuario (Inngest job genera PDF/ZIP).
- **RECTIFY:** el usuario edita su perfil; queda en `employeeAuditLogs` con `isSensitive=true`.
- **CANCEL:** soft-delete con `retentionUntil` (LFT obliga retención de ciertos docs por años; no se borra todo).
- **OPPOSE:** marca al usuario para exclusión de ciertos tratamientos.

**SLA LFPDPPP:** 20 días hábiles para responder (Art. 32). Inngest cron recuerda a HR en día 15 si no hay respuesta.

### 7.4 Retención automática (Art. 16 LFPDPPP)

> "Los datos personales deberán suprimirse cuando hayan dejado de ser necesarios para la finalidad que justificó su tratamiento."

**Nueva función Inngest:** `cron-data-retention.ts` (diaria):

```typescript
// lib/inngest/functions/cron-data-retention.ts
export const dataRetention = inngest.createFunction(
  { id: "data-retention-check", cron: "0 3 * * *" },  // 3AM diario
  async ({ step }) => {
    // 1. Empleados dados de baja hace > X meses:
    //    - Cifrado de columnas PII (mantener datos laborales para LFT/IMSS)
    //    - Reducción a "datos mínimos requeridos por ley" (RFC, período laboral, salario)
    //    - Sustracción de CURP, NSS (tras período de retención IMSS), contactos personales
    // 2. Audit logs tras retentionUntil → archive/delete
    // 3. Documentos de empleado con expiración → marcar para borrado
  }
);
```

**Tensión legal-resuelta:** LFPDPPP pide supresión, LFT/IMSS pide retención (IMSS: documentos 5 años tras baja). La función aplica **retención mínima legal** y suprime el resto. Documentar en el Aviso de Privacidad.

---

## 8. Pilar 4 — Aislamiento entre Sucursales Propias y Franquiciadas

### 8.1 El problema concreto

**Hoy (verificado):** `branches` no tiene `ownershipType`. Un GERENTE de franquicia con `users: ['read']` puede leer empleados de otra sucursal. La "dimensión 7: franquiciadas" del diseño no tieneSingle barrera técnica.

**Riesgo real:** un franquiciatario ve los márgenes, nómina o inventario de otra franquicia o de las sucursales propias del grupo — información competitivamente sensible que destruye la relación franquiciante-franquiciatario.

### 8.2 Modelo de ownership

**Modificar `lib/db/schema/core.ts` (branches):**

```typescript
export const branchOwnershipEnum = pgEnum("branch_ownership", ['OWNED', 'FRANCHISE']);

export const branches = pgTable("branches", {
  // ... existente
  ownershipType: branchOwnershipEnum("ownership_type").default('OWNED').notNull(),
  franchiseeUserId: text("franchisee_user_id"),  // si FRANCHISE, el userId del franquiciatario responsable
  franchiseAgreementRef: text("franchise_agreement_ref"),  // ID externo del contrato
  franchiseRoyaltyPercent: integer("franchise_royalty_percent"), // configuración comercial
}, (table) => ({
  // ... existente
}));
```

### 8.3 Reglas de visibilidad (matriz)

| Actor | ¿Ve sucursal OWNED del grupo? | ¿Ve su sucursal FRANCHISE? | ¿Ve sucursal FRANCHISE ajena? | ¿Ve otra sucursal OWNED del grupo? |
|---|---|---|---|---|
| `OWNER` (grupo) | ✅ Todo | ✅ Todo | ✅ Todo | ✅ Todo |
| `SUPER_ADMIN` | ✅ Todo | ✅ Todo | ✅ Todo | ✅ Todo |
| `ADMIN` (HQ) | ✅ Todo | ✅ Todo | ✅ Todo | ✅ Todo |
| `HR` | ✅ Todo | ⚠️ Solo nómina/compliance, NO márgenes | ❌ | ⚠í Same |
| `GERENTE` sucursal OWNED | ✅ Solo SU branch | ❌ | ❌ | ❌ |
| `GERENTE` franquicia | ❌ (no ve OWNED) | ✅ Solo SU branch | ❌ | ❌ |
| `EMPLEADO` | ✅ Solo SU branch | ✅ Solo SU branch | ❌ | ❌ |

### 8.4 Implementación técnica: `ownershipScope` en `AccessContext`

```typescript
// Extender AccessContext (ver §5.1)
export interface AccessContext {
  // ... ya definido
  ownershipScope: {
    canSeeOwned: boolean;
    canSeeFranchise: 'NONE' | 'OWN_BRANCH_ONLY' | 'ALL';
  };
}

// Helper para queries cross-branch (CrossBranchService va a necesitar esto)
export function branchVisibilityFilter(
  ctx: AccessContext,
  branches: { id: string; ownershipType: 'OWNED'|'FRANCHISE'; franchiseeUserId?: string | null }[]
): string[] {
  // Retorna ids de branches visibles para el actor
  return branches
    .filter(b => {
      if (ctx.userRole === 'OWNER' || ctx.userRole === 'SUPER_ADMIN') return true;
      if (ctx.userRole === 'ADMIN') return true;
      if (b.ownershipType === 'OWNED' && !ctx.ownershipScope.canSeeOwned) return false;
      if (b.ownershipType === 'FRANCHISE') {
        if (ctx.ownershipScope.canSeeFranchise === 'NONE') return false;
        if (ctx.ownershipScope.canSeeFranchise === 'OWN_BRANCH_ONLY') return b.franchiseeUserId === ctx.userId;
      }
      // GERENTE/EMPLEADO solo su branch
      return b.id === ctx.userBranchId;
    })
    .map(b => b.id);
}
```

**CrossBranchService** (8 agregadores con cache) — todos deben aplicar el filtro `branchVisibilityFilter` antes de agregar. Esto es el punto de modificación clave para el aislamiento.

### 8.5 Caso especial: agregados del grupo (Executive Twin)

El `ExecutiveTwinEngine` (del v2) agrega todas las branches para calcular `groupHealth`. En modo franquicia:
- El OWNER del grupo ve el aggregate completo (incl. franquiciadas).
- Un franquiciatario ve solo su sucursal + agregados del grupo que excluyan al detalle de otras franquicias.
- HR ve agregados de cumplimiento a nivel grupo pero **no** desglose financiero por franquicia.

Solución: `ExecutiveTwinEngine.recalculate` produce **dos proyecciones** — `groupWide` (OWNER) y `franchiseScoped` (franquiciatario). La API `/api/executive/twin` filtra según `AccessContext`.

### 8.6 RLS para franquicias (defensa en profundidad)

```sql
CREATE POLICY franchise_isolation ON employees
  USING (
    -- OWNER/ADMIN/SUPER_ADMIN ven todo
    (current_setting('app.current_role') IN ('OWNER','SUPER_ADMIN','ADMIN'))
    OR
    -- Si la branch es FRANCHISE, solo el franquiciatario o el grupo
    (
      EXISTS (
        SELECT 1 FROM branches b
        WHERE b.id = employees.branch_id
        AND (
          b.ownership_type = 'OWNED'
          OR b.franchisee_user_id = current_setting('app.current_user_id')::text
        )
      )
    )
  );
```

---

## 9. Auditoría y Observabilidad de Seguridad

### 9.1 Audit log general (no solo empleados)

**Nuevo:** `dataAccessLogs` — captura tanto mutaciones como SELECTs de datos sensibles.

```typescript
export const dataAccessLogs = pgTable("data_access_logs", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
  userId: text("user_id").notNull(),          // actor
  companyId: uuid("company_id").notNull(),
  branchId: uuid("branch_id"),

  // Qué
  action: text("action").notNull(),           // 'READ' | 'EXPORT' | 'UPDATE' | 'DELETE' | 'APPROVE'
  resource: text("resource").notNull(),        // 'employees.clabe' | 'corporate_twins' | 'cfdi_invoices'
  resourceId: text("resource_id"),

  // Contexto
  accessDecision: jsonb("access_decision"),    // snapshot del AccessDecision (incl. reason si deny)
  redactedFields: text("redacted_fields"),     // qué se enmascaró
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  performedAt: timestamp("performed_at").defaultNow().notNull(),

  // Retención
  retentionUntil: timestamp("retention_until"),
});
```

### 9.2 Hook automático en API layer

Middleware de Next.js (o wrapper de route handlers) que:
1. Captura toda request a `/api/employees/*`, `/api/finance/*`, `/api/executive/*`, `/api/cfdi/*`.
2. Registra el `AccessDecision` (incluso denies — attack signal).
3. Loggea `redactedFields` para evidencia de masking aplicado.

### 9.3 Alertas de seguridad (Inngest)

- **Bulk export por usuario no-admin** → alerta al OWNER (posible exfiltración).
- ** múltples denies 403 de mismo IP en 1 hora** → alerta (ataque de fuerza bruta).
- **Acceso a CLABE fuera de horario laboral** → alerta (insider).
- **Login de OWNER desde nueva ubicación** → confirmación por email.

### 9.4 Extender `employeeAuditLogs` existente

El esquema actual (línea 1538) ya es bueno para mutaciones de empleados. **No duplicarlo** — unificarlo con `dataAccessLogs` semánticamente (`employeeAuditLogs.action = 'UPDATE'` ↔ `dataAccessLogs.action = 'UPDATE'`). Considerar view unificada `auditUnified` o mantener tablas separadas pero UI consolidada.

---

## 10. Integración en los Sprints (cross-cutting)

La seguridad **no es un Sprint aparte** — se entrelaza con los sprints del v2. Si se hace al final, cada servicio se habrá escrito sin scoping y la migración será costosísima.

### Tabla de responsabilidad

| Sprint v2 | Tarea de seguridad obligatoria | Pillares |
|---|---|---|
| **Sprint Sec-0** (pre-Sprint 1, 0.5 sem) | Clasificar datos (`SENSITIVE_FIELDS`), `branches.ownershipType` migration, schema `dataAccessLogs`/`dataConsents`/`arcoRequests`/`tenant_keys` | 1,2,3,4 |
| **Sprint 1** | `evaluateAccess` + `requirePermissionApi` introducidos; `ExecutiveTwinEngine.recalculate` usa `branchVisibilityFilter`; KEK/DEK scaffold; `cfdiInvoices`, `corporateTwins.projectedCashFlowCents` marcados FINANCIAL | 1,2,4 |
| **Sprint 2** |迁移 `/api/finance/*`, `/api/payroll/*` a `requirePermissionApi` con `classification: 'FINANCIAL'`; column cipher para `clabe`, `cardNumber`, `salaryHistory`; `masking` middleware en esas rutas | 1,2 |
| **Sprint 3** | 2FA obligatorio OWNER/ADMIN/HR; approval workflow para pagos > umbral; `cron-data-retention` (LFPDPPP Art. 16); ARCO workflow | 1,3 |
| **Sprint 4** | `/api/executive/*` todas con `requirePermissionApi`; `morningBrief` entrega respeta scope de franquiciatario; `decisionFeed` ítems heredan redacción | 1,4 |
| **Sprint 5** | Feature flag por tier **no afecta compliance** — LFPDPPP y cifrado aplican a TODOS los tiers (no negociable). Tier solo afecta `auto_recommendations`, `api_access`, etc. | — |
| **Sprint 6** | AssessmentService evalúa postura de seguridad del cliente como parte del Executive Operating Assessment | 1,2,3 |

### 10.1 Cambios concretos en el v2 que el plan de seguridad exige

1. **`branches` migration** (Sprint Sec-0): añadir `ownershipType`, `franchiseeUserId`, `franchiseAgreementRef`. `db:generate` + `migrate` (NUNCA `push`), backfill `OWNED` default.
2. **`corporateTwins` migration** (Sprint 1 del v2): añadir además `dataClassification: 'FINANCIAL'` para las columnas monetarias — aunque sea metadata Drizzle (comment/`.sensitive()`).
3. **`ExecutiveTwinEngine.recalculate`** (v2 §6.2): debe producir `groupWide` y `franchiseScoped`. El wrapper `recalculateCorporateTwin` debe preservar el trigger de Inngest **y** respetar ownership.
4. **`CrossBranchService`** (8 agregadores): todos los métodos añaden `branchVisibilityFilter(ctx, branches)` antes de aggregate. Descachear por `companyId + ownershipScope` (no solo por `companyId`).
5. **`IdentityService.reasonAbout`** (v2 §8.6): la pregunta y la respuesta se loggean en `dataAccessLogs` (contenido estratégico — considerado FINANCIAL/SENSITIVE según contexto).

---

## 11. Schema Nuevo Requerido

Resumen de migraciones DB nuevas que el plan de seguridad obliga:

```typescript
// lib/db/schema/security.ts (NUEVO)

// Pilar 1
export const paymentApprovals = pgTable("payment_approvals", { ... });  // §5.4

// Pilar 2
export const tenantKeys = pgTable("tenant_keys", {
  companyId: uuid("company_id").primaryKey().references(() => companies.id),
  encryptedDek: text("encrypted_dek").notNull(),  // pgp_sym_encrypt(dek, :kek)
  dekVersion: integer("dek_version").default(1).notNull(),
  rotatedAt: timestamp("rotated_at").defaultNow().notNull(),
});

// Pilar 3
export const dataConsents = pgTable("data_consents", { ... });        // §7.2
export const privacyNotices = pgTable("privacy_notices", { ... });    // §7.2
export const arcoRequests = pgTable("arco_requests", { ... });       // §7.3

// Auditoría
export const dataAccessLogs = pgTable("data_access_logs", { ... });   // §9.1

// Modify existing
// branches: + ownershipType, franchiseeUserId, franchiseAgreementRef
// employees: column cipher (modificar Drizzle definitions con custom type)
// corporateTwins (v2): marcar campos FINANCIAL
```

**Funciones Inngest nuevas:**
- `cron-data-retention.ts` (diaria 3AM) — Pilar 3
- `cron-consent-reminder.ts` (semanal) — recuerda a empleados sin consentimiento vigente
- `arco-fulfill.ts` (event-driven) — genera export de datos para ACCESS requests

---

## 12. Riesgos y Mitigaciones

### 12.1 Rendimiento del cifrado

**Riesgo:** `pgp_sym_decrypt` en cada SELECT de empleados degrada latencia en dashboards cacheados.
**Mitigación:** cache de carga transparente (clave en memoria por 5min), descifrar solo en la capa de serialización API (no en queries internas), índices en columnas **no** cifradas (ej. `companyId`, `branchId` siguen plaintext).

### 12.2 Migración brownfield de cifrado

**Riesgo:** backfill de millones de registros con cifrado — tiempo de downtime.
**Mitigación:** backfill en lotes vía Inngest (`step.run` por chunks de 1000), sin downtime. Formato `enc::<ciphertext>` permite coexistencia legacy/cifrado. Bloquear escritura plaintext solo tras verificar 100% backfill.

### 12.3 Adopción incompleta de `getCurrentTenant`

**Riesgo:** migrar de `requireRoleApi` (sin scoping) a `requirePermissionApi` (con scoping) en 84 servicios es gradual; durante la transición, rutas no migradas quedan sin protección de scoping.
**Mitigación:** inventario de rutas (`rg "app/api/.+/route.ts"`) + lista de chequeo; fail-closed default: cualquier ruta nueva sin `requirePermissionApi` falla en CI (lint rule).

### 12.4 Tensión LFPDPPP vs LFT/IMSS retention

**Riesgo:** LFPDPPP pide supresión, LFT pide retención 5 años. Contradicción.
**Mitigación:** definición clara en Aviso de Privacidad de "datos mínimos requeridos por ley" (RFC, período, salario) vs "datos prescindibles" (CURP tras IMSS, contactos personales). `cron-data-retention` solo suprime lo prescindible. Documentar decisión en ADR.

### 12.5 Complejidad de ABAC

**Risk:** `evaluateAccess` con 4 dimensiones (role+branch+class+ownership) es difícil de testear.
**Mitigación:** tabla de tests exhaustiva con todos los actores × recursos × classifications × ownershipTypes (matriz de ~500 casos). Suite de tests unitarios en `lib/rbac/abac.test.ts`.

### 12.6 RLS sin session vars → bypass

**Riesgo:** RLS depende de `current_setting('app.current_company_id')`; si una query olvida setear la GUC, RLS se bypassa (postgres default es `SET row_security = off` para superusuarios; además sin GUC, la policy puede evaluar a vacío).
**Mitigación:** middleware de pool de conexión Drizzle que **siempre** setea las GUCs; test que falla si una query ejecuta sin GUC; no usar superuser para la app en prod.

### 12.7 Cifrado no evita abuso por admin autenticado

**Riesgo:** cifrado en reposo no protege contra ADMIN autenticado que abusa de su acceso.
**Mitigación:** Pilar 1 (gates de classification), audit log (Pillar §9), 2FA, approval workflows para mutaciones críticas. El cifrado es defensa contra leak externo; ABAC+audit es defensa contra insider.

---

## 13. Métricas de Éxito

### Seguridad
- [ ] 100% de columnas `SENSITIVE`/`FINANCIAL` cifradas en reposo (verificable con query de columnas plaintext)
- [ ] 100% de rutas `/api/employees/*`, `/api/finance/*`, `/api/executive/*` usando `requirePermissionApi`
- [ ] Cero rutas nuevas (post-Sprint Sec-0) sin guard —.fail-closed CI lint rule
- [ ] `getCurrentTenant` / `requirePermissionApi` invocado en >90% de API routes (medible con rg)
- [ ] 2FA obligatorio activo para OWNER/ADMIN/HR (no existe login sin 2FA para esos roles)
- [ ] Test suite ABAC cubre matriz de visibilidad `ownershipType × role × classification` (>95% pass)

### Cumplimiento LFPDPPP
- [ ] Aviso de Privacidad versionado y todos los empleados activos con `dataConsents` vigente
- [ ] Workflow ARCO responde en <20 días hábiles (medido por `arcoRequests.fulfilledAt - requestedAt`)
- [ ] `cron-data-retention` ejecuta diariamente sin errores, baja PII prescindible tras plazo legal
- [ ] Auditoría INAI-ready: dado un `userId`, exportar todos sus datos + consentimientos + audit logs en <5 min

### Aislamiento franquicias
- [ ] GERENTE de franquicia NO puede leer employees/ventas/nómina de otras sucursales (test E2E)
- [ ] `branches.ownershipType` backfillado al 100% (verificable: `SELECT count(*) WHERE ownership_type IS NULL = 0`)
- [ ] `CrossBranchService.getAllBranches*` aplica `branchVisibilityFilter` (test unitario)
- [ ] `ExecutiveTwin` API entrega `franchiseScoped` a franquiciatarios (test E2E)

### Auditoría
- [ ] `dataAccessLogs` captura 100% de READ de datos `SENSITIVE`/`FINANCIAL`
- [ ] UI `audit-log-table.tsx` extendida para mostrar `dataAccessLogs` (no solo `employeeAuditLogs`)
- [ ] Alertas de seguridad (bulk export / denies / fuera de horario) activas en Inngest

---

## Apéndice: Orden de ejecución recomendado

```
Sprint Sec-0 (0.5 sem)  ─ PRE-REQUISITO
├── Clasificación de datos (SENSITIVE_FIELDS)
├── branches.ownershipType + backfill OWNED
├── Schema: tenant_keys, dataAccessLogs, dataConsents, privacyNotices, arcoRequests
├── db:generate + migrate (NUNCA push)
└── KEK setup en env

Sprint 1 (v2) ─ entrelazado
├── ExecutiveTwinEngine usa branchVisibilityFilter
├── corporateTwins.projectedCashFlowCents marcado FINANCIAL
├── tenant_keys populated (DEK por companyId)
└── evaluateAccess + requirePermissionApi introducidos

Sprint 2 (v2) ─ rutas financieras migradas
├── /api/finance/*, /api/payroll/* → requirePermissionApi(classification: FINANCIAL)
├── Column cipher: employees.clabe, cardNumber, salaryHistory
├── masking middleware en esas rutas
└── CrossBranchService.* aplican branchVisibilityFilter

Sprint 3 (v2) ─ compliance y 2FA
├── 2FA obligatorio OWNER/ADMIN/HR
├── paymentApprovals workflow
├── cron-data-retention (Art. 16)
├── ARCO workflow + Inngest arco-fulfill
└── Aviso de Privacidad versionado + dataConsents onboarding

Sprint 4 (v2) ─ executive endpoints cerrados
├── /api/executive/* todos con requirePermissionApi
├── morningBrief entrega respeta franchiseScoped
├── decisionFeed hereda redacción
└── dataAccessLogs en reasonAbout

Sprint 5-6 (v2) ─ nota: compliance no es opcional por tier
└── AssessmentService evalúa postura de seguridad como parte de Assessment
```

> **Veredicto:** la seguridad es **pre-requisito**, no un add-on. Sin Sprint Sec-0, cualquier engine construido en Sprint 2-3 acumulará deuda de acceso que será caro de corregir. Cifrar `branches` y `employees` después de que los 8 engines lean esos datos plaintext es una migración de backfill que toca todos los servicios — mejor empezar mañana.