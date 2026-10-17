# PULSO 1.0 CLOSEOUT — Status

Tracker del plan de cierre. Se actualiza al final de cada fase; **no se avanza de
gate sin el anterior verde**.

Regla de ejecución por fase: inspeccionar → reutilizar → no modelo paralelo →
migración solo si hace falta → writer y reader productivos → permisos →
tenant-isolation test → workflow/E2E test → docs → siguiente gate.

---

## Progreso

| Fase | Alcance | Estado |
|---|---|---|
| **-1** | Security Gate | ✅ **CERRADO** (RLS como plan) |
| **0** | Control Core (Exception + Evidence + Audit) | 🟡 En curso — 0.1 backend hecho (schema, RBAC, lifecycle, servicio, adaptadores, sync, API); falta UI, 0.2 Evidence y 0.3 Audit |
| **1** | Loop de dinero (AP→Payment→Settlement, Approval Engine) | ⬜ Pendiente |
| **2** | Management Finance (Cost Centers, P&L, Budget) | ⬜ Pendiente |
| **3** | Workforce / Pre-payroll | ⬜ Pendiente |
| **4** | Producción e Inventario (consolidación) | ⬜ Pendiente |
| **5** | Banco y Conciliación | ⬜ Pendiente |
| **6** | Owner / Management View | ⬜ Pendiente |
| **7** | Cleanup & Hardening | ⬜ Pendiente |
| **8** | Final E2E Certification | ⬜ Pendiente |
| — | **PULSO-1.0 freeze** | ⬜ Pendiente |

---

## PHASE -1 — Security Gate ✅

| Item | Estado | Archivos |
|---|---|---|
| S-1 `payroll/run` con autorización | ✅ | `app/api/payroll/{run,validate,route}.ts` |
| S-2 endpoints de notificación protegidos | ✅ | `app/api/notifications/*`, `lib/api/internal-auth.ts` |
| S-3 doble firma de pagos | ✅ | `lib/treasury/disbursement-policy.ts`, `lib/services/treasury-service.ts` |
| S-4 RLS | 📄 Plan | `PHASE--1-RLS-PLAN.md` |

Detalle: `PHASE--1-SECURITY-GATE.md`.

**Verificación:**
- `npx tsc --noEmit` → limpio.
- `npx vitest run` → 119 archivos / **1471 tests passed**, 0 fallos.
- `npx eslint` (lo tocado) → 0 errores.

**Pendiente para cerrar del todo antes de tocar más dinero (no bloquea Phase 0):**
- E2E de aislamiento con RLS (requiere staging + rol `pulso_app`).
- Confirmar que no hay colas QStash externas apuntando a `/api/notifications/process`
  antes de retirar el shim (Phase 7).

---

## Próxima fase: Phase 0 — Control Core

Orden recomendado por el plan y por el grafo de dependencias de la auditoría:

1. **Epic 0.1 Canonical Exception** (P0) — tabla `exceptions` + lifecycle
   (`OPEN→ASSIGNED→IN_ACTION→RESOLVED→VERIFIED→CLOSED` + `REOPENED/ESCALATED/CANCELLED`),
   adaptadores idempotentes desde incidents / inventory alerts / compliance alerts /
   equipment alerts / cash variance / invoice discrepancy, API + UI de feed.
2. **Epic 0.2 Canonical Evidence** (P0) — tabla `evidence` genérica referenciable
   (workflow step, incident, exception, expense, invoice, approval, payment,
   receiving), con backfill desde `workflow_instance_steps.evidenceUrl`.
3. **Epic 0.3 Audit Trail** — lectura unificada + evidencia `who/what/when/before/after/reason`.

**Gate 0:** una factura con discrepancia produce una `exception` con owner, SLA,
acción, evidencia, resolución, verificación y cierre.

> Phase 0 es P0 porque **todo** el resto usa `exception` como salida de anomalía y
> `evidence` como prueba. Phase 1 (loop de dinero) depende de ambos.
