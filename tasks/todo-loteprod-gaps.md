# Todo: Cierre de Gaps loteprod.md ↔ Módulo Inventario

Plan completo: `tasks/plan-loteprod-gaps.md`
Origen: investigación 2026-08-25 de `loteprod.md` contra `app/dashboard/inventory/`

## Pre-requisitos (completados)

- [x] Etiqueta FIFO→FEFO en `expirations/page.tsx`
- [x] `shipTransfer` asigna lotes vía `allocateFEFO`; falla sin stock; hereda lote primario
- [x] `unitConversions.factor` → `numeric(12,6)` (migración `0064_closed_shen.sql`) + seeds

## Phase 1: Quick wins de seguridad y control

- [x] **Task 1:** Validación de temperatura por tipo de almacenamiento en recepción
  (congelado ≤ -18°C, refrigerado 0–4°C; fuera de rango = QUARANTINED + incidente)
  — DONE: `receiving-temperature.ts` + test (14 casos), migración `0065_blushing_ronan.sql`
  (`inventory_items.storage_type`), cableada en `receiving-service.ts` (QUARANTINED + incidente
  automático), UI en `receiving-workflow.tsx` / `product-form.tsx`. Commits `fbcd8b1`, `8b9fbaf`.
- [x] **Task 2:** Alertas escalonadas caducidad: ≤48h gerente / ≤24h urgente / vencido =
  bloqueo FEFO + merma obligatoria (sin re-notificar)
  — DONE: nuevo `lib/services/expiration-alert-service.ts` (clasificador puro
  `classifyExpirationWindow` H48/H24/EXPIRED + `processExpirationCutoffs()` que marca lotes
  vencidos status=EXPIRED — quedan fuera del allocator FEFO que filtra AVAILABLE — y notifica
  una sola vez por (lote, ventana)); tabla `inventory_expiration_alerts` con único
  `(batch_id, window)` como idempotencia anti-spam del cron 6h (migración
  `0066_sudden_stepford_cuckoos.sql`, aplicada en dev); paso nuevo
  `process-expiration-cutoffs` en `cron-stock-check.ts`; `expiredWastePendingCount` en
  `/api/inventory/dashboard`; tarjeta condicional "Merma Obligatoria Pendiente" en
  `dashboard-kpis.tsx`; test con 10 casos (`__tests__/expiration-alert.test.ts`).
  Verificación: unit 360 passed · build OK · migración aplicada.
- [x] **Task 3:** Tope mensual + aprobación de mermas STAFF/COURTESY
  (`approvalStatus/approvedBy`; rechazada no descuenta inventario)
  — DONE (código): `inventory_waste` += `approval_status/approved_by/approved_at` +
  `companies.courtesy_waste_monthly_cap_cents` (migración manual `0067_waste_approval.sql` +
  journal idx 67); lógica pura en `lib/inventory/waste-approval.ts` (12 tests) con `roleIsAtLeast`
  fail-closed; POST waste difiere descuento/movimiento para PENDING_APPROVAL; nuevo endpoint
  `POST /api/inventory/waste/[id]/approval` (GERENTE+ acotado a sucursal; sobre tope exige ADMIN+;
  aprobar descuenta lote FOR UPDATE en tx); criterio único de KPIs en `lib/inventory/waste-kpi.ts`
  (`wasteLossEligible`) aplicado en dashboard/executive/predictive/knowledge/reports + summary del
  historial; UI: columna Estado, aprobar/rechazar en detalle sheet (`useWasteApprovalAction`),
  toast "enviada a aprobación" en el form, tarjeta ADMIN+ para el tope en la página.
  Decisión open question #1: tope = monto fijo mensual por empresa.
  Verificación: tsc exit 0 · unit 372 passed · lint 0 errores · **pendiente**: db:migrate 0067 en dev,
  `pnpm run build`, flujo manual E2E, commit selectivo → ver `handoffs/loteprod-task3-handover.md`.

### Checkpoint Phase 1
- [x] tsc limpio* · build pasa · migraciones aplican en dev (*2 errores preexistentes de otro
  workstream en `app/dashboard/service-orders/`; los archivos tocados no reportan errores)
- [ ] Flujos verificados manualmente (pendiente: corrida doble de cron con `INNGEST_DEV=1`
  para confirmar no-duplicación en vivo)

## Phase 2: Núcleo de producción diaria

- [ ] **Task 4:** Hold times — esquema y captura
  (`recipes.holdTimeMinutes`, `production_results.expires_at`, enum merma HOLD_TIME)
- [ ] **Task 5:** Hold times — ciclo de vencimiento en línea
  (cron horario, notificación a turno, merma idempotente A9, dashboard "por vencer")
- [ ] **Task 6:** Prep list por estación/turno/hora límite
  (columnas nuevas en `production_orders`, vista agrupada con checkbox, lote FEFO visible,
  completar dispara producción real) — dividir 6a datos / 6b UI si excede 5 archivos
- [ ] **Task 7:** Pars por franja horaria batch cooking
  (`recipe_par_slots`, sugeridor par − stock listo hoy, integración a panel de sugerencias) —
  dividir 7a datos / 7b UI

### Checkpoint Phase 2
- [ ] Flujo E2E: forecast → prep list → producir FEFO → hold time vence → merma HOLD_TIME →
  varianza del día
- [ ] Revisión con humano antes de Phase 3

## Phase 3: Gobernanza y control

- [ ] **Task 8:** Versionado de fichas técnicas
  (`recipe_versions` snapshot jsonb, archivado automático al editar, historial con costo)
- [ ] **Task 9:** Clasificación ABC + frecuencias de conteo
  (`abc_class` A/B/C, clasificador 80/15/5 por consumo 90d, cron mensual, filtros en conteo)
- [ ] **Task 10:** Auditoría sorpresa trimestral
  (cron trimestral → workflow por sucursal con muestra aleatoria ABC, evidencia foto,
  % cumplimiento a KPI corporativo)

### Checkpoint Complete
- [ ] 9/9 gaps cerrados y trazados a sección del manual
- [ ] Tests nuevos pasan · build limpio · migraciones en staging
- [ ] Docs actualizadas (`PROJECT_CONTEXT.md`, `docs/admin-guide.md`)

## Notas de ejecución

- Migrar SIEMPRE con `pnpm db:generate` + `pnpm db:migrate`. Jamás `db:push`.
- Descuentos/movimientos de stock solo vía `allocateFEFO()` en transacción.
- Cantidades: `numeric(12,4)` string en TS. Dinero: centavos integer.
- Idempotencia crons: patrón A9 (índice único parcial sobre `workflowInstanceId`).
- Notificaciones vía `NotificationDispatcher`, nunca Wasender directo.

## Open questions para resolver antes de la fase correspondiente

1. Tope de cortesías: ¿monto fijo mensual o % de ventas? (→ Task 3)
2. ¿Hold times también en sub-recetas madre? (→ Task 4)
3. Slots de pars: ¿fijos 11/14/17/20 o configurables? (propuesta: configurables con defaults)
   (→ Task 7)
4. Tamaño de muestra de auditoría sorpresa: ¿N SKUs o % catálogo? (→ Task 10)
