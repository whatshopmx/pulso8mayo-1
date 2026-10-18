# Integración de Servicios Huérfanos Reformas LFT 2026-2030

## Contexto (por qué)

Los 4 servicios de reformas LFT creados el 2025-09-15 son calculadoras puras que **nadie consume**:

| Servicio | Estado actual | Valor bloqueado |
|---|---|---|
| `lib/services/compliance/ley-silla-service.ts` | Puro, sin BD ni API | Evaluación RIT/bipedestación no visible en compliance |
| `lib/services/off-hours-event-service.ts` | Puro; eventos se descartan al terminar el request | +50% y descanso compensatorio 30d sin seguimiento ni recordatorio |
| `lib/services/mental-health-leave-service.ts` | Puro | Licencias 7d/año no registrables ni conectadas a nómina |
| `lib/services/ai-severance-calculator.ts` | Puro (input manual) | Prima AI (+2 meses) no se aplica en cálculo de finiquito |

Patrón de referencia (funciona en producción): `nom035-service.ts` → tabla `nom035ActionPlans` → `app/api/compliance/nom-035/*` → `app/dashboard/compliance/*` → `NotificationDispatcher`.

Principio: **los servicios existentes quedan como motores de cálculo puros e inviolados** (los 16 tests de reformas deben seguir pasando). La integración agrega capa de persistencia, rutas API multi-tenant y UI — no reescribe lógica legal.

## Tasks

- [ ] Task 1: Crear `lib/db/schema/reforms-2026.ts` con 4 tablas: `offHoursEvents` (status compensatorio enum, chosenRestDate, expiryDate), `mentalHealthLeaves` (requestDate, returnDate, daysUsed, daysRemaining), `leySillaAssessments` (jobRole, standingRiskType, hoursStandingPerShift, complianceStatus), `severanceCalculations` (audit log: inputs, resultado, isAiReplacement, createdBy). Exportar desde `lib/db/schema/index.ts` y `lib/db/schema.ts`. → Verify: `pnpm db:generate` produce migración sin DROP de tablas existentes; `pnpm tsc --noEmit`.
- [ ] Task 2: Agregar métodos de persistencia a los 4 servicios (ej. `OffHoursEventService.persistEvent`, `getPendingEvents`, `selectCompensatoryRestDate` → UPDATE real). Los cálculos puros existentes NO cambian de firma. Scope: `companyId`/`branchId` obligatorio en cada query. → Verify: tests nuevos en `lib/__tests__/orphan-services-integration.test.ts` con DB mock.
- [ ] Task 3: Rutas API con `getSession()` + tenant check (`lib/tenant-context.ts`):
  - `app/api/compliance/ley-silla/route.ts` — GET lista evaluaciones, POST `evaluateRoleCompliance` + persistir.
  - `app/api/labor/off-hours/route.ts` — GET eventos por sucursal, POST agendar; `PATCH` con eventDate en body para `selectCompensatoryRestDate`.
  - `app/api/employees/mental-health-leave/route.ts` — GET saldo (días usados/7), POST solicitar licencia.
  - `app/api/labor/severance/route.ts` — POST calcular (solo rol admin/RH), GET historial de auditoría.
  → Verify: `lib/__tests__/orphan-services-routes.test.ts` cubre happy path + 401 sin sesión + 403 cross-tenant.
- [ ] Task 4: Conectar severance a finiquito real: en `app/api/employees/lifecycle/route.ts` (offboarding), si el motivo es reducción por automatización, llamar `AISeveranceCalculator.calculateSeverance` con datos del empleado y persistir en `severanceCalculations`; persistir `AIService.logAiTransparencyEvent` a la vez. `severancePay` del body pasa a tener breakdown desglosado. → Verify: test de lifecycle con `isAiReplacement: true` produce prima de 60 días SDI.
- [ ] Task 5: UI en dashboard compliance:
  - `app/dashboard/compliance/ley-silla/page.tsx` — evaluaciones por puesto/sucursal con badge de incumplimiento.
  - Panel en `app/dashboard/compliance/overtime/page.tsx` — eventos fuera de jornada pendientes de seleccionar descanso compensatorio (tabla con expiración).
  - Widget en página RH existente — saldo de licencias de salud mental por sucursal.
  - Panel en `app/dashboard/compliance/payroll` — calculadora de finiquito con prima AI (solo RH/admin).
  → Verify: `pnpm run build` limpio; revisar manual con dev server que cada página carga con companyId de sesión.
- [ ] Task 6: Recordatorios Inngest — extender el cron `0 * * * *` de overdue con: eventos fuera de jornada sin descanso elegido a 15/25 días de vencer, y licencias de salud mental por vencer. Canal: `NotificationDispatcher` (in-app + WhatsApp si hora crítica). → Verify: `npx inngest-cli@latest dev` dispara y crea notificación en dev DB.
- [ ] Task 7: Suite integral + cierre. Corregir el registro histórico en `reformas-laborales-2026.md` (Task 10 decía "75/75" pero había solo 16 pruebas). Total esperado al cierre: 16 existentes + ~12 nuevas ≈ 28 pruebas de reformas, contadas y documentadas con el número real. → Verify: `pnpm test:unit` y `pnpm run build` 100% limpios antes de cerrar.

## Orde de ejecución

1 → 2 → 3 (paralelizable con 4) → 5 → 6 → 7. Task 4 depende de 1-2; no requiere 3.

## Done When
- [ ] Ningún servicio de reformas queda sin consumidor de producción (rutas API o UI).
- [ ] Todos los cálculos legales persisten con `companyId` y son recuperables.
- [ ] Rubro evidenciado: build limpio, suite unit verde, y el archivo de reformas actualizado con el conteo real de pruebas.
