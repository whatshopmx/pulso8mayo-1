# Auditoría de Tenant-Scoping y Autenticación — 2026-08-01

**Alcance:** 220 rutas en `app/api/`. Método: escaneo mecánico de patrones de auth (`getCurrentTenant`, `requireTenant`, `requireAuth`, `auth.api.getSession`, RBAC) + inspección manual de las rutas sin patrón.

**Contexto crítico:** No existe `middleware.ts` en el proyecto. **Cada endpoint debe protegerse a sí mismo.** No hay red de seguridad a nivel de framework.

---

## 🔴 Hallazgos críticos (sin autenticación, con acceso a datos multi-tenant)

Estos endpoints no verifican sesión. El `companyId`/`userId` llega como query param o en el body, por lo que **cualquier persona sin cuenta puede leer o modificar datos de cualquier grupo restaurantero**. Para el perfil cliente (grupo de 3–15 sucursales), una fuga de salarios o incidentes entre empresas destruye el producto.

| # | Endpoint | Riesgo |
|---|----------|--------|
| 1 | `users/[id]` (GET/PATCH/DELETE) | Leer, **modificar o borrar cualquier usuario** sin auth. Toma de control de cuentas. |
| 2 | `leave/requests` (GET/POST + approve/reject) | `approvedBy` viene en el body → **cualquiera aprueba/rechaza vacaciones suplantando al gerente**. |
| 3 | `employees/search` | PII de empleados (email personal, **rango salarial**) de cualquier empresa vía query param. |
| 4 | `employees/audit` | Bitácora de auditoría (incluye eventos `isSensitive`) de cualquier empresa. |
| 5 | `employees/lifecycle` | Crear onboarding/**offboarding (despidos)** de cualquier empresa. |
| 6 | `employees/documents/expiring` | Documentos de empleados (vencimientos) de cualquier empresa. |
| 7 | `incidents` (GET) | Lista **todos los incidentes de todos los tenants**, sin filtro de empresa. |
| 8 | `incidents/[id]/escalate` | Escalar cualquier incidente con `escalatedBy` arbitrario (corrupción de cadena de escalamiento). |
| 9 | `incidents/[id]/remediate` | Registrar remediación falsa — el código literalmente dice `true // Assume success`. |
| 10 | `leave/balances` | Leer/**modificar saldos de vacaciones** de cualquier empleado. |
| 11 | `leave/types` | CRUD de tipos de permiso de cualquier empresa. |
| 12 | `communications/announcements` | Publicar anuncios a nombre de cualquier empresa, **con envío de WhatsApp** a empleados. Vector de phishing interno. |
| 13 | `performance/criteria`, `performance/goals`, `performance/reviews` | Evaluaciones de desempeño de cualquier empresa (mismo patrón, revisión individual pendiente). |
| 14 | `analytics/employees`, `reports/employee-analytics` | Analytics y reportes de nómina/headcount de cualquier empresa. |
| 15 | `dashboard/ai-verifications` | Resultados de verificación AI sin filtro tenant. |
| 16 | `whatsapp/receive-photo` | Sin verificación de firma de webhook: **cualquiera puede enviar "evidencia fotográfica" suplantando el teléfono de un empleado** y contaminar workflows de cumplimiento NOM-251. |
| 17 | `workflow/route.ts` | Dispara eventos Inngest (incl. `shift/clock-in.requested` con `userId` arbitrario). Verificar si el handler valida sesión antes de `inngest.send()`. |

## 🟡 Por diseño pero requieren hardening

| Endpoint | Estado | Acción |
|----------|--------|--------|
| `workflows/public/[token]`, `smart-links/*` | Token-based (SmartLinkService valida). Diseño correcto. | Verificar expiración, un solo uso donde aplique, y rate limiting. |
| `join`, `join/info` | Flujo de invitación. | Verificar que el token de invitación sea de un solo uso y con expiración. |
| `whatsapp/webhook` | No revisado en esta pasada. | Verificar validación de firma de Wasender. |
| `inngest` | Debe validar `INNGEST_SIGNING_KEY`. | Verificar en producción. |
| `auth/[...all]` | Handler de better-auth. Correcto. | — |

## 🟠 Deuda en el patrón canónico

`lib/tenant-context.ts` → `getCurrentTenant()` acepta el header `x-pulso-tenant-id` con un `// TODO: Verify user has access to this tenant`. **Hoy ese header permite cambiar de tenant sin verificación.** Si algún proxy o cliente lo envía, hay salto de tenant. Prioridad alta aunque ningún frontend lo use todavía.

Además: solo 63 de 220 rutas importan `tenant-context`. El resto usa `requireAuth` u otros patrones (parcialmente correctos) o nada (esta auditoría).

---

## Plan de remediación

### Patrón recomendado (aplicar a los 17+ endpoints)

```ts
// lib/api/with-auth.ts
export function withTenantAuth(
  handler: (req: NextRequest, ctx: { user: AuthUser; tenantId: string }) => Promise<Response>
) {
  return async (req: NextRequest) => {
    const { user } = await requireAuth();          // 401 si no hay sesión
    const tenantId = user.companyId;
    if (!tenantId) throw ApiError.forbidden();      // 403 si no tiene empresa
    return handler(req, { user, tenantId });
  };
}
```

**Reglas duras:**
1. `tenantId` SIEMPRE de la sesión, nunca de query param ni body.
2. `userId`, `approvedBy`, `escalatedBy`, `createdBy` SIEMPRE de la sesión, nunca del body.
3. Filtrar por `branchId` según rol: gerente de sucursal solo su sucursal (`lib/rbac/require-role.ts` ya existe — usarlo).
4. Eliminar el TODO de `x-pulso-tenant-id` o verificar membresía antes de aceptarlo.

### Orden sugerido
1. **Bloque 1 (datos personales y cuentas):** `users/[id]`, `employees/search`, `employees/audit`, `employees/documents/expiring`, `analytics/employees`, `reports/employee-analytics`
2. **Bloque 2 (acciones destructivas/suplantación):** `leave/requests`, `leave/balances`, `leave/types`, `employees/lifecycle`, `incidents` (3 rutas), `performance/*`
3. **Bloque 3 (canales externos):** `communications/announcements`, `whatsapp/receive-photo` (firma), `workflow` (verificación), `tenant-context` TODO
4. **Verificación:** script que falle CI si un `route.ts` nuevo no contiene ningún patrón de auth ni está en allowlist de rutas públicas.
