# Handover v2 — Control OC/OS: Task 9 (Presupuestos) implementado, siguientes pasos

> **Reemplaza a** `handoffs/oc-os-handover-proximos-pasos.md` (v1). La **fuente de verdad técnica completa**
> sigue siendo `handoffs/oc-os-sistema-control-implementacion-y-pendientes.md` (mapa servicios/APIs/UI,
> decisiones vinculantes #1–13, gotchas #1–18, datos demo).
> Este documento registra el cierre de Task 9 y detalla **qué sigue y cómo**, en orden de ejecución.

---

## 1. Estado al cierre (2026-08-25)

| Fase | Estado | Evidencia |
|---|---|---|
| Phases 1–3 + Task 7 + Phase 4-bis | ✅ | ver handover v1 §1 · commits `973c34b`→`6fd6403`, docs `7599d7a`/`65becfa`/`9f0e756`/`381bac5` |
| **Task 9 — UI de Presupuestos** | ✅ código / ⚠️ verificación pendiente | grid mensual sucursales×centros, hooks nuevos, sidebar Finanzas. Lint 0 errores en archivos del plan · 372 tests unitarios OK. **Build NO corrido** (dev server arriba, gotcha #4) |

### Task 9 — qué quedó implementado (SIN COMMITEAR)

| Archivo | Contenido |
|---|---|
| `hooks/queries/use-budgets.ts` | **Nuevo.** `useBudgets(month, branchId?)` → GET `/api/budgets?month&branchId`; `useSaveBudget()` → PUT por celda. QueryKey `["budgets", month, branchId]`. Tipos: `BudgetRow { branchId, branchName, branchCode, costCenterId, costCenterCode, costCenterName, accountingLine, budgeted, committed, available, alert }` (centavos) |
| `app/dashboard/budgets/page.tsx` | **Nuevo.** Header con navegación de mes (‹ › + `<Input type="month">`) · resumen del mes (presupuestado/comprometido/disponible + badge "N partida(s) ≥90%") · grid pivoteado filas=sucursales, columnas=centros de costo · celdas ADMIN+ editables con barra consumo; no-ADMIN solo lectura · guardado explícito **por fila** (PUT secuencial) · EmptyState loading/error/empty con retry |
| `hooks/queries/index.ts` | + `export { useBudgets, useSaveBudget } from "./use-budgets"` |
| `components/app-sidebar.tsx` | + icono `PiggyBank` y entrada **"Presupuestos" › `/dashboard/budgets`** en Finanzas, entre Gastos Operativos y Cuentas por Pagar (recomendación de ubicación del handover v1) |

**Decisiones de implementación tomadas (no re-abrir):**
- Borrador derivado sin `useEffect`: el estado `drafts` vive **dentro** de `<BudgetsTable key={month}:{branchId}>` — cambiar mes/sucursal descarta ediciones no guardadas por construcción.
- Validación de monto: regex `^\d+(\.\d+)?$` + `Math.round(parseFloat*100)`; inválido marca rojo y bloquea Guardar (vaciar NO borra presupuesto; usar 0 explícito).
- Scope: respeta el selector de sucursal del header (`useBranch()`) además del scope fijo por rol que impone el servidor.
- Alerta ≥90% ámbar con texto `sr-only` accesible; icono `AlertTriangle` (consistente con el repo, no `TriangleAlert`).

### ⚠️ Working tree compartido con workstream paralelo

Hay ~20 archivos modificados + untracked de un **workstream paralelo de mermas/waste** (`app/api/inventory/waste/**`, `lib/inventory/**`, migración `0067_waste_approval.sql`, etc.). **NO commitearlos junto al Task 9.**

Dos archivos tienen cambios mezclados de ambos streams:
- `hooks/queries/index.ts`: línea de waste (`useWasteApprovalAction`) + línea de budgets. Stagear solo el hunk de budgets con `git add -p`.
- `components/app-sidebar.tsx`: verificado que SOLO contiene cambios del Task 9 (PiggyBank + entrada Presupuestos).

Archivos exclusivos del Task 9 (stage directos): `app/dashboard/budgets/page.tsx`, `hooks/queries/use-budgets.ts`.

---

## 2. Próximos pasos sugeridos (en orden)

### Paso 0 — Cerrar Task 9 (~Small) ← EMPEZAR AQUÍ

1. [ ] Resolver dev server en :3000 (PID puede haber cambiado; era `22968`): pedir permiso para matarlo o esperar.
2. [ ] `pnpm run build` → exit 0 (gotcha #4: NUNCA con dev server arriba; warning labor/documents preexistente e inocuo).
3. [ ] Verificación UI contra `PORT=3100 npx next start` efímero y matarlo:
   - Login `maria@pulso.mx` / `123456` (ADMIN) → Finanzas › Presupuestos.
   - Captura guarda y se refleja al recargar · consumo de OC/OS aprobadas aparece como `committed` (barra) · alerta ≥90% visible si aplica.
   - Repetir como `juan@pulso.mx` (GERENTE, fijo Condesa): solo lectura + solo Condesa.
   - Cambio de mes descarta borradores no guardados.
4. [ ] Commit selectivo (ver §1 working tree): los 4 archivos del Task 9 + docs; actualizar plan/todo.

### Paso 1 — Checkpoint core (Phase 4 completa)

Igual que handover v1 §2-Paso 2: flujo demo end-to-end por UI (Servicios Normativos → Generar OS → submit → autorizar → ejecutar → conformidad → CLOSED), capturar presupuesto y verificar que el submit de una OS nueva lo respeta, build+tests verdes. Requiere navegador manual (agent_browser roto ambas sesiones).

### Paso 2 — Task 10: Dashboard KPIs gerenciales (~Large)

Sin cambios respecto a handover v1 §2-Paso 3. Resumen:
- `app/api/reports/control/route.ts` + `app/dashboard/reports/control/page.tsx`.
- Metas desde `tenant_operating_config` (decisión #10/#7) — defaults en `DEFAULT_FINANCIAL_TARGETS` (`lib/**/financial-kpi-types`). NO hardcodear.
- Endpoint único `/api/reports/control?month&branchId` con una query por KPI; UI Recharts como `inventory/reports/executive`.
- KPIs: food cost real vs teórico (⚠️ validar calidad de datos recipes/sales-entry ANTES), gasto operativo % y presupuesto vs ejecutado (`getCommittedByPair`), comparativo precios por insumo, ranking proveedores, % compras emergencia (<5%, fuentes `service_orders.urgency='EMERGENCIA'` + `purchase_orders.purchase_type='EMERGENCIA'`), desviación presupuestal (budgets vs committed — ahora también consumible desde la UI del Task 9).

### Paso 3 — Task 11: Job Inngest mensual (~Small)

Sin cambios: `lib/inngest/functions/control-monthly-report.ts`, cron `0 6 1 * *`, desviaciones presupuestales mes cerrado, `findFolioGaps`, contratos ≤90 días (hook/comment si Phase 6 no existe aún), % emergencias, notificación vía `NotificationDispatcher` a OWNER/ADMIN. Verificar con `npx inngest-cli@latest dev` + `INNGEST_DEV=1`.

### Paso 4 — Phase 6: Contratos y recurrentes (Tasks 12→13→14→15)

Orden 12→13→14 y 15 tras 13. Igual que handover v1 §2-Paso 5. Recordatorios críticos:
- Migraciones solo `db:generate` + revisar SQL + `db:migrate`. El paralelo ya tiene `0067_waste_approval.sql` en vuelo — **regenerar sobre el repo más reciente, tarde y no temprano**.
- REQUIERE_INVESTIGACION si factura vs contrato >10%; alerta renovación ≤90 días idempotente por contrato/mes.
- Tesorería fuera de alcance (decisión #8).

### Pasos 5–6 — Phase 7 (KPIs extendidos) y Phase 8 (cierre)

Sin cambios: ver handover v1 §2-Pasos 6 y 7. Excluidos explícitos no re-abrir: comparativo kWh, auditorías físicas sorpresa, par levels.

---

## 3. Decisiones vinculantes (resumen — detalle handoff técnico §2)

Se mantienen las 8 del handover v1 §3, más:

9. **Presupuestos UI**: guardado explícito por fila (no auto-save); borrador descartado al cambiar mes/sucursal; vaciar celda no elimina presupuesto (usar 0); ubicación Finanzas › "Presupuestos" (`/dashboard/budgets`).

---

## 4. Datos demo (BD actual — sin cambios desde v1)

- Usuarios password `123456`: maria@pulso.mx ADMIN · juan@pulso.mx GERENTE (Condesa) · ana@pulso.mx SUPERVISOR (Polanco) · carlos@pulso.mx SUPER_ADMIN.
- COMPANY `a1b2c3d4-e5f6-7890-abcd-ef1234567890` · Condesa CDMX01 · Polanco PLNC01 · CostCenter MANT.
- OS-CDMX01-2026-0001 CLOSED · OS-PLNC01-0001/0002 APPROVED · OS-emergencia 0003 APPROVED · OC-CDMX01-2026-0001 APPROVED.
- Presupuestos mes corriente: CDMX01 $50,000 · PLNC01 $20,000 (centro MANT) — visibles en la nueva página /dashboard/budgets.
- Matriz OS default de 4 bandas.

---

## 5. Gotchas (v1 top-8 siguen vigentes + 2 nuevos)

Los #1–#8 de `oc-os-handover-proximos-pasos.md` §5 aplican íntegros. Se agregan:

9. **`tsc --noEmit` de proyecto completo excede 300 s** en este repo (Windows, Next 16) — no usarlo como gate; usar eslint sobre archivos tocados + `pnpm test:unit` + `pnpm run build` (exit code).
10. **Estado de borradores en componentes keyed**: si un grid depende de `key={mes:sucursal}` para resetearse, el `useState` de los drafts debe vivir DENTRO del componente hijo keyed — una `key` en un div interno no resetea el estado del padre (bug detectado y corregido durante el Task 9).

---

## 6. Comandos rápidos

```bash
pnpm test:unit                                   # 372 tests
pnpm run lint                                    # ESLint
pnpm run build                                   # juzgar por exit code; NUNCA con dev server arriba
PORT=3100 npx next start                         # server prod efímero para verificación UI; matarlo después
source scratch/e2e-helpers.sh                    # login/api/check helpers e2e (BASE localhost:3000)
npx tsx scratch/check-folio-gaps.ts              # auditoría de folios
git add -p hooks/queries/index.ts                # stagear SOLO el hunk de budgets (mezcla con stream waste)
```

## 7. Open questions heredados (sin cambios)

1. ¿Conformidad con firma digital real o basta registro userId+timestamp?
2. Contrato firmado para >$100K — resolver en Phase 6.
3. Calidad de datos recipes/sales-entry para food cost teórico — validar antes de invertir en ese KPI.
4. ~~Ubicación sidebar Presupuestos~~ → resuelto: Finanzas (Task 9 implementado).
