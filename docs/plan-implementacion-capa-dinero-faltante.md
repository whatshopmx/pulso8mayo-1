# Estado real + plan de lo faltante — Capa de retención de dinero

Auditoría realizada el 2025-08-05 sobre la rama `feat/capa-dinero` (HEAD `f0a34ea`).
El plan original (`docs/plan-implementacion-capa-dinero.md`) ya está **~90% implementado**.
Lo que sigue es cerrar QA, commitear y verificar la base.

---

## ✅ Lo que YA está implementado

| Fase | Estado | Evidencia en código |
|------|--------|---------------------|
| **0 — Base/migración** | ✅ Hecho | Rama `feat/capa-dinero`. Migraciones una por feature: `drizzle/0031` (evidencia), `0032` (arqueo), `0033` (agregadores), `0034` (alto valor). **No usar `db:push`.** |
| **1 — `evidenceUrl`** | ✅ **Commiteado** | `f0a34ea` + `2dd611b`. Schema (`schema.ts:2665`), `app/api/expenses/route.ts` acepta `evidenceUrl`, `app/api/expenses/evidence/route.ts` (upload), `components/finance/expense-form.tsx` (campo foto con `uploadToR2`). |
| **2 — Arqueo cierre turno** | ✅ Implementado (sin commit) | Schema `cashCountedCents`/`depositedCents` (0032). Smart Link `corte-caja/route.ts`: campos `arqueo`/`deposito` + **validación obligatoria** si `efectivo > 0`. Template `templates/finanzas/corte-caja.json`: paso "🧮 Arqueo" + "Depósito". `app/api/sales/cuts/route.ts`: schema + validación + persistencia. Dashboard `app/dashboard/sales/page.tsx`: columna "Arqueo/Dif." (verde si 0, roja si ≠0, faltante/sobrante) + alerta por sucursal. Ingesta POS deja null (no rompe). |
| **3 — Desglose por agregador** | ✅ Implementado (sin commit) | Schema `aggregatorSales` jsonb (0033). Smart Link: `buildAggregatorSales()`. `lib/services/pos-column-aliases.ts`: `matchAggregatorLabel()` (rappi/uber/didi/pedidosya/justo/sindelantal/mercadopago). `sales-ingestion-service.ts`: acumula por agregador en ambos builders y escribe el jsonb. Dashboard: tabla "Conciliación por Agregador" con input de liquidación → varianza. |
| **4 — `isHighValue` + 30 SKUs** | ✅ Implementado (sin commit) | Schema `is_high_value` (0034). API `products/route.ts` + `[id]/route.ts`: `MAX_HIGH_VALUE_SKUS = 30` con rechazo al item 31. `stock-count-service.ts`/`route.ts`: filtro por defecto `isHighValue=true`, toggle "ver todos". Dashboard inventario: `HighValueSkusSection` + API `app/api/inventory/high-value/` (último conteo por SKU). `product-form.tsx` + `app/actions/inventory.ts`: checkbox. |
| **5 — Recepción → `receivingReports`** | ✅ Implementado (sin commit) | Refactor: cuerpo de la ruta movido a `lib/services/receiving-service.ts` (`processReceiving`); `route.ts` quedó delgado. Nuevo `lib/services/receiving-from-workflow.ts` (extractor desde instancias `tpl-recepcion-mercancia-v2`: pasos, evidencia, resuelve supplier por nombre). Enganche fire-and-forget en `workflow-execution-service.ts:444` al marcar COMPLETED. Varianza por proveedor: `app/api/inventory/supplier-variance/` + `SupplierVarianceCard` en dashboard proveedores. Conciliación CFDI 3-way ya visible en `app/dashboard/inventory/invoices/page.tsx` (precio/cantidad rojas + reporte de discrepancias). |

---

## ❌ Lo que NO está implementado / pendiente

### Bloqueante 0 — Build ROJO (cambio NO relacionado en el working tree)

`pnpm run build` falla en `lib/services/kpi-calculator.ts:238`:

```
Type error: Property 'companyId' does not exist on type ... workflow_instances
```

- **Causa:** el working tree mezcla un refactor de tenant-scoping **ajeno a capa-dinero** (kpi-calculator, emergency-departure, labor, branch-ranking-client). Ese refactor usa `eq(workflowInstances.companyId, ...)` pero `workflow_instances` **no tiene columna `companyId`** (solo `branchId`, schema.ts:58).
- **Opciones:** (a) corregir usando `inArray(workflowInstances.branchId, companyBranches(companyId))` como hacen los otros helpers; o (b) **descartar esos cambios del working tree** si no son del alcance y commitear solo capa-dinero.
- **Decisión requerida:** confirmar si ese refactor de kpi/labor se queda o se revierte. Sin esto, no hay QA posible.

### 1. Verificar que las migraciones se aplicaron (db:migrate)

- `0031/0032/0033/0034` están **generadas** en `drizzle/` y registradas en `_journal.json` (idx 31-34), pero **no se verificó que la base apunte a la base correcta ni que `db:migrate` haya corrido**.
- Acción: revisar `.env` (`DATABASE_URL` correcta) → `pnpm db:migrate` → confirmar columnas en la base.

### 2. Fase 6 QA — pendiente completa

- [ ] **Build verde** (tras resolver Bloqueante 0).
- [ ] **`pnpm run lint`** sin errores.
- [ ] **E2E**: la carpeta `tests/` está **vacía** (no hay specs). Crear al menos:
  - Corte con arqueo con diferencia (efectivo 1,000 / arqueo 980 → −20 en dashboard).
  - Gasto con foto (evidencia subida y `evidence_url` persistido).
  - Conteo semanal filtrado por alto valor + toggle "ver todos".
  - Límite 30 SKUs (rechazo del item 31).
  - Workflow de recepción → `receiving_reports` con discrepancia.
- [ ] **Smoke manual del Smart Link** desde el celular (flujo del cajero: arqueo obligatorio cuando hay efectivo).
- [ ] **`PROJECT_CONTEXT.md`**: actualizar con el estado de las 5 features (hoy solo menciona fases antiguas).

### 3. Commit y cierre

- [ ] Commitear las fases 2-5 (hoy todo vive en el working tree, sin commits).
- [ ] Revisar archivos ajenos mezclados (kpi/labor/emergency-departure) — separarlos o confirmar.
- [ ] Merge `feat/capa-dinero` → `main` tras QA verde.

---

## Plan de ejecución (orden sugerido)

1. **Resolver Bloqueante 0** — decidir (a) fix tenant-scoping de kpi-calculator o (b) revertir cambios ajenos. *(~0.5-1h)*
2. **Verificar base** — `.env` → `pnpm db:migrate` → inspección de columnas. *(~15min)*
3. **Build + lint** — `pnpm run build` y `pnpm run lint` hasta verde. *(~45min)*
4. **E2E** — escribir specs Playwright de los 5 escenarios clave y correrlos. *(~1-2d)*
5. **Smoke del Smart Link** — prueba manual desde móvil (arqueo obligatorio, foto del corte). *(~30min)*
6. **Documentación** — actualizar `PROJECT_CONTEXT.md`. *(~15min)*
7. **Commit + merge** — commits por fase, merge a `main`. *(~30min)*

**Riesgos:** el único bloqueante real es el build (kpi-calculator). El resto es verificación y QA.
