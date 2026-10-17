# PHASE -1 — Security Gate

> Estado: **cerrado** en lo que el gate exige. `-1.4` (RLS) queda como plan
> ejecutable, no aplicado — ver `PHASE--1-RLS-PLAN.md` y la justificación abajo.

## Gate checklist

| Requisito | Estado | Evidencia |
|---|---|---|
| `payroll/run` protegido | ✅ | `app/api/payroll/run/route.ts` |
| Notification endpoints protegidos | ✅ | `app/api/notifications/{dispatch,process}/route.ts` |
| Doble aprobación funcional | ✅ | `lib/treasury/disbursement-policy.ts` + `treasury-service.updatePaymentRunStatus` |
| Permission tests verdes | ✅ | 119 archivos / 1471 tests (`pnpm test:unit`) |
| Tenant isolation tests verdes | ✅ (unit) | `lib/rbac/__tests__/*`; los E2E de aislamiento requieren DB+server |

---

## S-1 · Autorización de nómina

**Hallazgo:** `POST /api/payroll/run` autenticaba (`requireTenant` + `requireAuth`)
pero no autorizaba. Cualquier usuario con `companyId` podía ejecutar la nómina y
timbrar CFDI.

**Cambio:** el guard pasa a `requirePermissionApi("reports", "manage", { classification: "FINANCIAL", audit })`.
Reutiliza el primitive ABAC existente (`lib/rbac/abac.ts`).

| Regla | Resultado |
|---|---|
| `ADMIN` / `OWNER` / `SUPER_ADMIN` | permitido |
| `GERENTE` | denegado (`reports:manage` no está en su fila) |
| `SUPERVISOR` / `EMPLEADO` / `READONLY` | denegado |
| `tenantId` / `userId` | de la sesión (`ctx`), nunca del cuerpo |
| Auditoría | `data_access_logs` (allow **y** deny) |

Archivos: `app/api/payroll/run/route.ts`, `app/api/payroll/validate/route.ts`,
`app/api/payroll/route.ts`.
Test: `lib/rbac/__tests__/payroll-authorization.test.ts`.

## S-2 · Endpoints de notificación

**Hallazgo:** `/api/notifications/dispatch` y `/api/notifications/process` sin
autenticación. `dispatch` no tenía llamadores en el repo; el único llamador de
`process` era `lib/whatsapp/notification-queue.ts`, a su vez sin llamadores.

**Cambio:**
- `process`: exige firma HMAC de QStash mediante `lib/api/internal-auth.ts`
  (`verifyQstashSignature`, **falla cerrado**). Reutiliza el `Receiver` del SDK.
- `dispatch`: exige `settings:manage` (ADMIN+) vía ABAC; auditado.

Archivos: `lib/api/internal-auth.ts`, `app/api/notifications/process/route.ts`,
`app/api/notifications/dispatch/route.ts`.
Test: `lib/api/__tests__/internal-auth.test.ts`.

> Nota Phase 7: ambos endpoints quedan como candidatos a retiro (sin llamadores
> internos). Se protegen ahora para no dejar superficie abierta mientras se
> confirma que no hay colas QStash externas apuntándoles.

## S-3 · Doble firma de pagos

**Hallazgo:** `payment_approvals` (migración 0028) existía desde Sec-0 sin writer
ni reader. Una corrida se aprobaba con una sola persona distinta al preparador,
sin importar el monto.

**Cambio:** `updatePaymentRunStatus` ahora exige **dos firmas distintas** cuando
`payment_runs.totalAmountCents >= tenant_operating_config.doubleApprovalThresholdCents`
(default $10,000 MXN, configurable).

| Paso | Comportamiento |
|---|---|
| Monto < umbral | una firma (distinta del preparador) — sin cambio |
| Monto ≥ umbral, 1ª firma | se persiste en `payment_approvals` (`PENDING`, `approvedBy`) y la corrida **sigue** `PENDING_APPROVAL` |
| Monto ≥ umbral, 2ª firma (otro usuario) | `secondApprovedBy` + `status=APPROVED`, y la corrida pasa a `APPROVED` **en la misma transacción** |
| Mismo usuario firma dos veces | denegado |
| Preparador | nunca firma |

La lógica pura vive en `lib/treasury/disbursement-policy.ts`
(`requiereDobleFirma`, `evaluarFirmaPago`); el servicio solo la aplica.
Test: `lib/treasury/__tests__/dual-approval.test.ts`.

**Compatibilidad:** `seedPaymentRun` usa `totalAmountCents=0` por default, así que
los E2E de la máquina de estados (`tests/corrida-transiciones.spec.ts`) no cruzan
el umbral y conservan su comportamiento.

## S-4 · RLS (plan, no aplicado)

Ver `PHASE--1-RLS-PLAN.md`. **No se habilitó RLS**: el repo no tiene contexto de
sesión DB (`set_config('app.current_company_id', ...)`) y un pool compartido, así
que activarlo sin ese mecanismo bloquearía todas las consultas. El gate de Phase
-1 no lo exige; se ejecuta como fase propia con prueba en staging.

---

## Definition of Done de esta fase

- [x] Ningún cambio deja tests rojos: `pnpm test:unit` → 1471 passed.
- [x] `npx tsc --noEmit` limpio.
- [x] `npx eslint` sobre lo tocado: 0 errores (solo warnings preexistentes).
- [x] Cada control reutiliza una primitive existente (ABAC, QStash Receiver,
      `payment_approvals`, `tenant_operating_config`); no se creó modelo paralelo.
- [x] Cada control escribe evidencia (data_access_logs / payment_approvals).
