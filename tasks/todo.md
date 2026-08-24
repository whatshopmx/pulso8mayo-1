# Todo: Estrategia de Pruebas Pulso HORECA

> Fuente: `tasks/plan.md`. Los dos hallazgos de seguridad del doc original ya están
> corregidos en el código — Phase 0 escribe las regresiones, no los fixes.

## Phase 0: Regresiones de seguridad

- [x] Task 1: Regresión webhook WhatsApp autenticado (`tests/api/whatsapp-webhook-auth.spec.ts`) — 6 tests ✓
- [x] Task 2: Regresión tenant-desde-sesión en employees/[id]/* (`tests/api/employees-tenant-isolation.spec.ts`) — 12 tests ✓

## Phase 1: Fundación

- [ ] Task 3: Vitest + fast-check + config base (excluye `.worktrees/`, TZ=UTC)
- [ ] Task 4: `.github/workflows/ci.yml` (lint + build + test:unit)

### Checkpoint
- [ ] build/lint/unitarias verdes localmente y en CI

## Phase 2: Capa 01 — Unitarias lógica pura

- [ ] Task 5: Fechas/zonas horarias (`lib/workflows/today.ts`) × 3 zonas de México
- [ ] Task 6: LFT horas extra y descansos (`lib/labor-validation.ts`)
- [ ] Task 7: RBAC/ABAC/masking (branch-scope, permissions, abac, masking)
- [ ] Task 8: parseMoneyToCents + rate-limiter
- [ ] Task 9: Propinas con property-based (fast-check)

### Checkpoint
- [ ] Suite unitaria <30 s, casos borde cubiertos

## Phase 3: Capa 03 — Contrato API

- [ ] Task 10: Barrido 401 sin sesión — primero clasificación exploratoria de rutas sin guardia → aprobación humana → fixture congelado
- [ ] Task 11: Sobre `{ success, data | error }` + método no permitido → 405

## Phase 4: Capa 04 — Aislamiento multi-tenant

- [ ] Task 12: Barrido IDOR (communications + employees) con control positivo
- [ ] Task 13: Cruce entre sucursales GERENTE/SUPERVISOR por dominio
- [ ] Task 14: Exportaciones CSV/PDF y evidencias R2 sin fuga entre empresas

### Checkpoint
- [ ] Barridos pasan; revisar con humano antes de la capa de BD efímera

## Phase 5: Capa 02 — Base efímera

- [ ] Task 15: Postgres efímero por corrida — DECIDIDO: ramas de Neon (Docker no disponible) + workers > 1 + check drift
- [ ] Task 16: Transacciones/idempotencia sobre BD efímera (extractores, payroll, recepciones)

## Phase 6: Capa 06 — Inngest (@inngest/test)

- [ ] Task 17: Setup + whatsapp-router (número desconocido, baja, multimedia, sin match)
- [ ] Task 18: Idempotencia extractores y snapshots KPI bajo replay
- [ ] Task 19: Crons por zona horaria + escalamiento desde tenant_operating_config

## Phase 7: Capa 07 — Recorridos E2E

- [ ] Task 20: Onboarding completo
- [ ] Task 21: Empleado vía WhatsApp + AI verify (>85% / <85%)
- [ ] Task 22: Cierre de turno (faltante/sobrante)
- [ ] Task 23: Ciclo de compra (OC → CFDI → 3-way)
- [ ] Task 24: Nómina IMSS + incidentes
- [ ] Task 25: Recorrido por rol (6 roles sin 403 ni redirect loop)

## Phase 8: No funcionales (continuo)

- [ ] Task 26: Presupuesto p95 en endpoints de agregados
- [ ] Task 27: axe-core en pantallas críticas
- [ ] Task 28: i18n sweep (messages/es.json)

## Decisiones tomadas (2026-08-24)

- [x] Base efímera: ramas de Neon (Docker no disponible en el entorno; driver WebSocket del repo)
- [x] Excepciones del barrido 401: clasificación exploratoria → aprobación humana → fixture
- [x] E2E nocturno: GitHub Actions scheduled workflow
