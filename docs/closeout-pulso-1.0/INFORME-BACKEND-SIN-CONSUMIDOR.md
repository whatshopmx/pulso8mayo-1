# Informe — Backend sin consumidor (Pulso)

**Generado:** 2026-10-17
**Alcance:** análisis estático de `app/`, `components/`, `lib/`, `hooks/`, `scripts/`, `tests/`
**Script reproducible:** `scripts/audit-backend-consumers.mjs` (`node scripts/audit-backend-consumers.mjs [--json]`)
**Snapshot:** `HEAD` en movimiento — hay otra sesión commiteando Phase 0 en paralelo. Re-ejecutar el script al cerrar esa fase.

---

## 1. Resumen ejecutivo

| Medición | Valor |
|---|---|
| Servicios en `lib/services` | **191** |
| — importados directamente por el frontend | 38 (20%) |
| — alcanzables sólo vía ruta API | ~86 (45%) |
| — **huérfanos** (ni frontend ni API) | **67 (35%)** |
| Rutas API | **371** |
| — referenciadas por el frontend | 286 (77%) |
| — sin ninguna referencia estática | **69 (19%)** |
| — de esas, infra/externo esperado | 9 |
| — **candidatas a sin consumidor** | **60** |

**Hallazgo central:** ~1 de cada 3 servicios y ~1 de cada 5 rutas no tienen consumidor detectable. Una parte es backend-only legítimo (cron/Inngest), pero hay **código muerto confirmado, features implementadas y testeadas nunca cableadas, y endpoints que duplican lógica ya consumida por otra vía**.

---

## 2. Metodología y límites

**Qué mide:** para cada servicio, si su nombre aparece como import en algún archivo; para cada ruta, si su URL aparece como literal (con `*` en segmentos dinámicos/`${}`) en algún archivo.

**Límites (importante para no borrar algo vivo):**
1. Es **estático**, no prueba ejecución.
2. Un servicio usado por inyección/registro con clave string no se detecta (poco probable aquí).
3. Una ruta llamada con base dinámica (`apiFetch(var)` sin el path literal) no se detecta.
4. Rutas externas (webhooks, Inngest, WebSocket, smart links públicos) **no** aparecen referenciadas a propósito: se marcan por patrón y se excluyen de "candidatos".
5. **Snapshot**: Phase 0 se está implementando en paralelo; los conteos cambian entre ejecuciones.

**Receta para confirmar antes de borrar una ruta** (ver §8).

---

## 3. Tier 1 — Servicios (alta confianza)

### 3.A Código muerto — **0 consumidores** (ni producción ni tests)

| Servicio | Qué es | Acción recomendada | Prioridad |
|---|---|---|---|
| `lib/services/evidence-store.ts` | Fachada de evidencia común | **Reemplazar** por la tabla/almacén canónico de Phase 0.2 (H01). No conservar el `Map`. | Alta |
| `lib/services/compliance/payroll-calculator.ts` | Calculadora de nómina | **Decidir**: reutilizar en pre-nómina real (H03) o eliminar. Hoy no entra al timbrado. | Alta |
| `lib/services/break-management-service.ts` | Gestión de breaks | Cablear a People/Workforce o eliminar | Media |
| `lib/services/whatsapp-notification-service.ts` | Notificación WhatsApp | Superado por `NotificationDispatcher` → **eliminar** | Baja |
| `lib/services/compliance/imss-parser.ts` | Parser IMSS | Cablear al flujo IMSS (T22) o eliminar | Media |
| `lib/services/intelligence/engine-interface.ts` | Interfaz de engines | Contrato sin uso → eliminar o adoptar en los engines | Baja |

### 3.B Implementadas y testeadas, pero **sólo las usan tests**

| Servicio | Test que la cubre | Acción |
|---|---|---|
| `lib/services/ai-severance-calculator.ts` | `lib/__tests__/labor-reforms-batch3.test.ts` | Cablear a RH/Nómina o eliminar |
| `lib/services/compliance/ley-silla-service.ts` | `lib/__tests__/labor-reforms-2026.test.ts` | Cablear (obligación legal) o eliminar |
| `lib/services/mental-health-leave-service.ts` | `lib/__tests__/labor-reforms-batch2.test.ts` | Cablear a People/incidencias |
| `lib/services/off-hours-event-service.ts` | `lib/__tests__/labor-reforms-batch3.test.ts` | Cablear a alertas o eliminar |

> Estas cuatro son **reformas laborales 2026**: se pagaron (implementación + tests) y **no llegan a ningún usuario**. Decisión de producto, no técnica.

### 3.C Sólo cron/Inngest — backend-only **por diseño** (no es un bug)

`advanced-alert-service`, `break-reminder-service`, `cfdi-revalidation-service`, `compliance-alert-service`, `email-service`, `forecast-service`, `insight-generator-service`, `intelligence/{brand,compliance,finance,operations,procurement}-engine`, `inventory-snapshot-service`, `kpi-calculator`, `merma-from-workflow`, `operational-twin-engine`, `performance-reminder-service`, **`production-from-workflow`**, **`stock-count-from-workflow`**.

**Acción:** documentar en un registro de "jobs" y verificar que cada uno tiene su cron activo. Ninguno necesita UI, pero varios **sí alimentan pantallas** (p.ej. `kpi-calculator` → KPIs; `inventory-snapshot-service` → variación H13) y hoy no hay evidencia de que sus salidas se muestren.

### 3.D Sólo otros servicios (helpers internos) — 38

Mayoría son plumbing legítimo (`fefo-allocator`, `domain-event-service`, `sales-base`, `labor-burden`, `holiday-catalog`, `recurring-contract-projection`, `pnl-snapshot-service`, `payment-run-settlement`, adaptadores de excepción…).

**Acción:** sin acción salvo los **de negocio sin entry point**: `food-cost-service` (H11), `payment-run-settlement` (H17), `pnl-snapshot-service` (H10), `overtime-alert-service`/`shift-*` (H09/H03) — confirmar que su resultado se lee en alguna vista/reporte.

---

## 4. Tier 2 — Rutas API sin consumidor estático (60 candidatas)

### 4.A Infra/externo esperado — **NO borrar** (9)

`/api/inngest`, `/api/socket`, `/api/whatsapp/receive-photo`, `/api/notifications/dispatch`, `/api/external-reports/generate`, `/api/rate-limit-status`, `/api/smart-links/validate`, `/api/smart-links/execution/*`, `/api/smart-links/execution/*/step/*`.

**Acción:** documentar en un registro de endpoints internos/externos.

### 4.B Duplican lógica ya consumida por otra vía (redundancia, no necesariamente dead)

| Ruta | Ya se sirve por | Acción |
|---|---|---|
| `/api/executive/brief/{latest,history}`, `/api/executive/feed` | `app/dashboard/executive/page.tsx` importa `MorningBriefService`, `ExecutiveTwinEngine` directo | Decidir una sola vía (server component o API) y **eliminar la otra** |
| `/api/incidents` | `app/dashboard/incidents/page.tsx` consulta Drizzle directo | Idem |
| `/api/group/live-pulse` | feed de excepciones / executive | Idem |
| `/api/companies`, `/api/users/profile`, `/api/profile/notification-preferences` | páginas de perfil/company | Verificar |

### 4.C Analíticas sin pantalla (8)

`/api/analytics/{alert-resolution-time, incidents/compliance, inventory/stock-valuation, operations/stats, predictions, task-duration-by-type, trends, workflow-completion-trend}`.

**Acción:** o se montan en `app/dashboard/analytics/*`, o se eliminan. Hoy son cálculo sin destino.

### 4.D Reportes sin pantalla (4)

`/api/reports/{employee-analytics, incidents, labor-compliance, templates/*}`.
**Acción:** conectar a `app/dashboard/reports/*` o eliminar.

### 4.E Inventario con backend sin UI (7)

`/api/inventory/{costing/recipe/*, periods, purchase-orders/suggestions, reports/{cogs, par-level, usage, valuation, waste}}`.
**Acción:** son capacidades del módulo 13 que el reporte marca "por demostrar" → **cablearlas a UI es parte del cierre**, no borrarlas.

### 4.F People / cumplimiento sin UI (5)

`/api/overtime/requests/*/{approve,reject}` (H03), `/api/shifts/clock-out`, `/api/leave/types`, `/api/employees/documents/expiring`, `/api/compliance/nom-035/action-plan/*`.
**Acción:** aprobación de overtime y reloj de salida son flujos clave → cablear o eliminar.

### 4.G Otros a triaje (muestra)

`/api/ai/detect`, `/api/billing`, `/api/civil-protection/*` (3), `/api/communications*` (2), `/api/fiscal/cfdi-recibidos*` (2), `/api/kpi/{alerts,snapshots}`, `/api/workflow`, `/api/workflows/{assignments/*/reassign, init-stock-count, smart-links/upload-pos}`, `/api/approval-requests*` (3).

### 4.H Rutas referenciadas **sólo por tests** (5)

`/api/approval-matrix`, `/api/equipment/*/maintenance`, `/api/equipment/*/warranty`, `/api/incidents/*/escalate`, `/api/petty-cash/transactions` (más `/api/purchase-delegation`, `/api/service-orders`, `/api/whatsapp/webhook`, `/api/workflows/smart-links/corte-caja` según corte anterior).
**Acción:** tienen test pero ningún usuario → mismo triaje: cablear o eliminar.

---

## 5. Caso destacado — Excepciones canónicas (backend nuevo, frontend viejo)

A raíz de Phase 0.A/B (paralelo) se creó el backend canónico:

- `lib/db/schema/exceptions.ts`, `lib/services/exception-service.ts`, `exception-lifecycle.ts`, `exception-sla.ts`, `exception-types.ts`, `exception-adapters/*`.
- Rutas nuevas: `/api/exceptions`, `/api/exceptions/sync`, `/api/exceptions/*/{assign,start-action,resolve,verify,close,reopen,escalate,cancel}`.

**Pero ningún consumidor las usa todavía:**
- `app/dashboard/exceptions/page.tsx` sigue haciendo `fetch("/api/group/exceptions")` (agregador legacy).
- No hay pantalla que llame a `/api/exceptions*`.

**Acción:** al cerrar Phase 0.B/0.C, cablear el feed a `/api/exceptions` (tarea 10–11 del plan) y actualizar `group-exceptions-service` (flag `EXCEPTIONS_CANONICAL_READ`). Coordinar con la sesión en curso para no colisionar.

---

## 6. Mapeo a los hallazgos del reporte de cumplimiento

| Hallazgo | Evidencia de "sin consumidor" | Implicación |
|---|---|---|
| **H01 Evidencia** | `evidence-store.ts` muerto (0 importadores) | No basta persistir: hay que **cablearlo** a gasto/factura/pago/excepción y a UI |
| **H03 Nómina** | `compliance/payroll-calculator.ts` muerto; `/api/overtime/requests/*/approve` sin UI | La pre-nómina real necesita consumir estas piezas o reemplazarlas |
| **H05/H12 Producción** | `production-from-workflow` sólo cron; `/api/inventory/costing/recipe/*` sin UI | Efectos de producción sin superficie de control |
| **H09 Auditoría/People** | `break-management-service`, `off-hours`, `ley-silla`, `mental-health` sin runtime | Controles implementados que no operan |
| **H10 Cierre financiero** | `pnl-snapshot-service`, `/api/finance/*` varios | Snapshots sin vista |
| **H13 Inventarios** | `/api/inventory/reports/*`, snapshots sólo cron | PAR/valuación/cogs "por demostrar" |
| **H17 Banca** | (no aplica: no hay backend) | Gap de backend, no de cableado |

---

## 7. Plan de acción (accionable)

| # | Acción | Ítems | Esfuerzo | Criterio de cierre |
|---|---|---|---|---|
| 1 | **Borrar código muerto confirmado** | `whatsapp-notification-service`, `intelligence/engine-interface` | S | `tsc` + tests verdes; sin referencias |
| 2 | **Decidir wire-vs-delete de reformas laborales** (test-only) | `ai-severance-calculator`, `ley-silla-service`, `mental-health-leave-service`, `off-hours-event-service` | M | Cada uno tiene ruta API + entrada en UI **o** se elimina con su test |
| 3 | **Resolver duplicación de vías** | `executive/*`, `incidents`, `group/live-pulse` | M | Una sola vía por capacidad; la otra eliminada |
| 4 | **Cablear capacidades de módulo con backend listo** | `/api/inventory/reports/*`, `/api/analytics/*`, `/api/reports/*` | L | Cada endpoint consumido por una página o eliminado |
| 5 | **Cablear flujos de People/tiempo** | `/api/overtime/requests/*`, `/api/shifts/clock-out`, `/api/leave/types` | M | UI de aprobación funciona E2E |
| 6 | **Cerrar H01/H03 con sus piezas huérfanas** | `evidence-store`, `compliance/payroll-calculator` | M | Evidencia cableada a 3 dominios; nómina consume asistencia real |
| 7 | **Registro de jobs y endpoints externos** | 19 cron-only + 9 externos | S | Documento `docs/closeout-pulso-1.0/REGISTRO-JOBS-Y-ENDPOINTS.md` |
| 8 | **Cablear excepciones canónicas (Phase 0)** | `/api/exceptions*` + UI | M | Feed consume canónico detrás del flag; Gate 0 pasa |

---

## 8. Receta de verificación antes de borrar (obligatoria)

1. **Re-ejecutar** `node scripts/audit-backend-consumers.mjs` tras el commit de Phase 0 en curso.
2. **Buscar base dinámica**: `rg -n "apiFetch|/api/\$\{|API_BASE|baseUrl" app components hooks`.
3. **Telemetría en runtime** (la prueba definitiva): revisar logs de acceso (Vercel/Neon/nginx) de 7–14 días y confirmar 0 hits para la ruta candidata.
4. **Buscar tests que la cubran**: si sólo hay tests, decidir wire-vs-delete con producto.
5. **Borrar en un PR aislado** por grupo (A/B/C), con `tsc` + suite verdes.

> **Regla:** no borrar nada de §4.E/§4.F (inventario y People) sin antes decidir si es "cablear": son parte del cierre de cumplimiento, no basura.

---

## 9. Anexo — reproducir

```bash
node scripts/audit-backend-consumers.mjs        # resumen
node scripts/audit-backend-consumers.mjs --json  # detalle completo
```

Salida esperada (snapshot 2026-10-17): servicios 191 (muertos 6, solo-tests 4, solo-cron 19, solo-servicios 38); rutas 371 (sin-front 85, sin-ninguna-ref 69 → 9 externas + 60 candidatas).
