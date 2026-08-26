# Handover — Sistema de Control OC/OS: estado y próximos pasos sugeridos

> **Documento de entrega** para retomar el plan `tasks/plan-ordenes-oc-os.md` en una sesión nueva.
> La **fuente de verdad técnica completa** es `handoffs/oc-os-sistema-control-implementacion-y-pendientes.md`
> (mapa de servicios/APIs/UI, decisiones vinculantes #1–13, gotchas #1–18, datos demo).
> Este documento resume el estado y detalla **qué sigue y cómo**, en orden sugerido de ejecución.

---

## 1. Estado al cierre (2026-08-26)

| Fase | Estado | Evidencia |
|---|---|---|
| Phase 1 — Datos (Tasks 1–2) | ✅ | migraciones `0061`–`0063` sin drops · folios sin saltos verificados |
| Phase 2 — Servicios (Tasks 3–4) | ✅ | matriz de autorización + presupuesto/tope emergencias |
| Phase 3 — APIs (Tasks 5–6) | ✅ | OS CRUD+submit transaccional, quotes/evidence/conformity, approval-requests/matrix/cost-centers/budgets, integración OC |
| Checkpoint E2E vía API | ✅ | OS→submit→multi-nivel→conformidad→CLOSED; OC con folio nuevo; `findFolioGaps` limpio |
| Task 7 — UI de OS | ✅ | lista + detalle estado×rol |
| **Phase 4-bis — Re-integración (R1–R5)** | ✅ | OS bajo Equipos › Servicios Normativos; bandeja Autorizaciones + editor Matriz como tabs de Finanzas › Control Interno |

**Commits del plan (main):** `973c34b` → `47187c7` → `5299cf8` → `7aa9b80` → `41bcae3` → `95d1c2c` → `9f83b59` → `4828d85` (R1-R3) → `6fd6403` (R4-R5). Docs: `7599d7a`, `65becfa`, `9f0e756`, `381bac5`.

**Calidad:** 360 tests unitarios OK · `pnpm run build` exit 0 · lint 0 errores en archivos del plan.
**Pendiente de revisión visual manual:** interacción fina del diálogo "Generar OS" pre-llenado y los tabs nuevos (agent_browser roto ambas sesiones — gotcha #10 del handoff técnico).

---

## 2. Próximos pasos sugeridos (en orden)

### Paso 1 — Task 9: UI de Presupuestos (~Medium) ← EMPEZAR AQUÍ

**Archivo:** `app/dashboard/budgets/page.tsx` (nuevo) · **APIs ya existen, no tocar backend.**

Contrato del API ya implementado:
- `GET /api/budgets?month=YYYY-MM[&branchId=]` → `{ month, rows: [{ branchId, branchName, branchCode, costCenterId, costCenterCode, costCenterName, accountingLine, budgeted, committed, available, alert }] }` — grid completo sucursales×centros activos; `alert: true` cuando comprometido ≥90% del presupuestado. El alcance de sucursal fija (GERENTE/SUPERVISOR) lo impone el servidor.
- `PUT /api/budgets` body `{ branchId, costCenterId, month, amount /* centavos */ }` — upsert, **solo ADMIN+** (403 para el resto).

Implementación sugerida:
1. Selector de mes (`<Input type="month">` o dos flechas ‹ ›) que re-dispara la query.
2. Grid editable: filas = sucursales, columnas = centros de costo (o tabla larga si hay muchos; decidir viendo datos demo: hoy 2 sucursales × pocos centros).
3. **Patrón borrador derivado** (gotcha #15): celdas editables solo para ADMIN+, guardado explícito por celda o botón "Guardar" por fila; pesos↔centavos con `Math.round(parseFloat*100)`; celdas no-ADMIN muestran valor + barra.
4. Barra consumo vs presupuestado por celda/fila (reutilizar el patrón `BudgetHint` de `components/service-orders/approval-inbox.tsx`); color ámbar cuando `alert === true`.
5. Estados loading/error/empty con `EmptyState` de `@/components/ui/empty-state` + retry.
6. Hooks: agregar `useBudgets(month)` y `useSaveBudget()` a `hooks/queries/use-service-orders.ts` (o nuevo archivo `use-budgets.ts`) + exportar en `hooks/queries/index.ts`.
7. **Decisión abierta:** ubicación en sidebar. Candidatos: sección Finanzas ("Presupuestos") o Equipos. Recomendación: Finanzas, junto a Gastos Operativos — es captura administrativa financiera.

**Criterio de aceptación:** captura guarda y se refleja al recargar; consumo de OC/OS aprobadas aparece como `committed`; alerta ≥90% visible.

### Paso 2 — Checkpoint core (Phase 4 completa)

- [ ] Flujo demo end-to-end por UI: Servicios Normativos → Generar OS → submit → autorizar en Finanzas › Control Interno → programar/ejecutar → evidencias → conformidad → CLOSED.
- [ ] Capturar presupuesto del mes en /dashboard/budgets y ver cómo el submit de una OS nueva lo respeta.
- [ ] `pnpm run build && pnpm test:unit` verdes.

⚠️ Este checkpoint requiere dev server arriba y revisión manual del navegador (agent_browser roto). Pedir al usuario el recorrido o usar curl para la parte API.

### Paso 3 — Task 10: Dashboard KPIs gerenciales (~Large)

**Archivos:** `app/api/reports/control/route.ts` + `app/dashboard/reports/control/page.tsx`.

Claves antes de empezar:
- **Metas/semáforos desde `tenant_operating_config`** (decisión #10): `foodCostTargetPercent`, `laborCostTargetPercent`, etc. Defaults en `DEFAULT_FINANCIAL_TARGETS` (`lib/**/financial-kpi-types`). NO hardcodear metas.
- Patrón visual: Recharts como `app/dashboard/inventory/reports/executive`.
- Filtro mes/sucursal obligatorio.

KPIs del plan (cada uno con query propia scoping por empresa):
1. Food cost % real vs teórico por sucursal (recipes/sales-entry) — ⚠️ open question: validar calidad de datos primero.
2. Gasto operativo % (OS/ventas) y presupuesto vs ejecutado por partida (usar `getCommittedByPair`).
3. Comparativo de precios por insumo entre sucursales.
4. Ranking proveedores (cumplimiento + monto).
5. % compras emergencia (meta <5%) — fuente: `service_orders.urgency='EMERGENCIA'` + `purchase_orders.purchase_type='EMERGENCIA'` del mes.
6. Desviación presupuestal mensual (budgets vs committed).

Sugerencia de subdivisión: endpoint único `/api/reports/control?month&branchId` que devuelve todas las secciones (una query por KPI dentro), UI con cards + gráficos; así se evita N rutas.

### Paso 4 — Task 11: Job Inngest mensual (~Small)

**Archivo:** `lib/inngest/functions/control-monthly-report.ts` — las funciones se registran exportándolas del módulo `lib/inngest/functions` (verificar el barrel/index de esa carpeta; `app/api/inngest/route.ts` hace `import * as cronFunctions`).

Contenido:
- Cron `0 6 1 * *` (día 1 de cada mes, 06:00).
- Desviaciones presupuestales del mes cerrado (`branch_budgets` vs committed).
- Auditoría de folios: `findFolioGaps(companyId)` (ya existe en `lib/services/folio-generator.ts`).
- Contratos por vencer ≤90 días (depende de Task 12 — si Phase 6 aún no existe, dejar hook/comment).
- % emergencias fuera de meta (<5%).
- Notificación vía `NotificationDispatcher` a OWNER/ADMIN.

Verificación: `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest` con `INNGEST_DEV=1` y disparo manual desde la UI local.

### Paso 5 — Phase 6: Contratos y recurrentes (Tasks 12→13→14, 15 tras 13)

Orden estricto: 12 (tabla) → 13 (servicio+API) → 14 (domiciliados) y 15 (UI) puede ir tras 13.

- **Task 12:** tabla `supplierContracts` en `lib/db/schema/service-orders.ts` (o módulo `contracts.ts`). Campos según plan. Migración con `pnpm db:generate` + **revisar SQL antes de aplicar** (nunca db:push). OJO: el workstream paralelo usa migraciones nuevas también (0064, 0067…) — regenerar sobre el estado más reciente del repo.
- **Task 13:** CRUD `app/api/contracts/**` (ADMIN+ escribir); flag REQUIERE_INVESTIGACION si factura vs contrato >10%; alerta renovación ≤90 días 1 vez/mes (idempotente por contrato/mes).
- **Task 14:** esperado vs cargos reales del mes desde `cfdiRecibidos`/expenses del payee; alertas desviación/cargo ausente/suscripción huérfana.
- **Task 15:** `app/dashboard/contracts/page.tsx` con badges vigencia (verde/ámbar ≤90d/rojo vencido).

Tesorería/corridas de pago: **fuera de alcance** (delegada a plan-payees, decisión #8).

### Paso 6 — Phase 7: KPIs extendidos (amplían Task 10)

Cumplimiento proveedor (`receivingReports.createdAt` vs `purchaseOrders.expectedDeliveryDate`) · días de inventario (kardex) · % egresos sin documento origen <2% · % correctivo vs preventivo <40% · contratos vencidos=0.
**Excluidos explícitamente** (no re-abrir): comparativo kWh, auditorías físicas sorpresa, par levels.

### Paso 7 — Cierre (Phase 8)

- [ ] `pnpm run build && pnpm run lint` verdes · suite unitaria completa.
- [ ] Demo end-to-end con datos sembrados (sección 4).
- [ ] Actualizar handoff técnico + marcar plan/todo completos.

---

## 3. Decisiones vinculantes (no re-abrir)

Resumen — detalle completo en handoff técnico §2:
1. OS módulo independiente; FK opcional a equipos/servicios normativos.
2. Matriz en BD con seed perezoso; default = bandas disjuntas de 1 nivel; multi-nivel = reglas traslapadas con secuencias distintas.
3. Presupuesto sucursal×centro×mes; validación al submit; mes de atribución = `created_at` del documento.
4. Folio real SOLO en submit (borradores `DRAFT-*`); contador atómico sin saltos.
5. Tres capas de autorización coexisten sin unificarse (matriz OC/OS ≠ A16 gastos sueltos).
6. Tope emergencias en `tenant_operating_config.emergencyPurchaseCapCents` (NULL = sin tope); cuenta OC EMERGENCIA + OS urgencia EMERGENCIA.
7. KPIs leen metas del operating-config, no hardcodeadas.
8. Tesorería fuera de alcance (hook de expectativa de pago únicamente).

---

## 4. Datos demo (BD actual)

- Usuarios password **`123456`**: maria@pulso.mx ADMIN · juan@pulso.mx GERENTE (fijo Condesa) · ana@pulso.mx SUPERVISOR (fija Polanco) · carlos@pulso.mx SUPER_ADMIN.
- COMPANY `a1b2c3d4-e5f6-7890-abcd-ef1234567890` · Condesa code CDMX01 · Polanco code PLNC01 · CostCenter MANT.
- Documentos vivos: OS-CDMX01-2026-0001 CLOSED · OS-PLNC01-2026-0001/0002 APPROVED · OS-emergencia 0003 **APPROVED** (aprobada en e2e de R4; era PENDING) · OC-CDMX01-2026-0001 APPROVED · 1 draft + 1 cancelada.
- Presupuestos mes corriente: CDMX01 $50,000 · PLNC01 $20,000 (centro MANT).
- Matriz OS restaurada a la default de 4 bandas tras pruebas R5.

---

## 5. Gotchas críticos (top 8 — lista completa en handoff técnico §6)

1. `ApiError(mensaje, statusCode)` — mensaje PRIMERO; mapear con `isApiError`.
2. Dinero SIEMPRE centavos integer · meses "YYYY-MM" · rangos matriz inclusivos.
3. Migraciones solo `pnpm db:generate` + revisar SQL + `pnpm db:migrate`; NUNCA db:push. El workstream paralelo agrega migraciones — regenerar tarde, no temprano.
4. `pnpm run build` con dev server arriba corrompe la salida SSR del dev (shell flight vacío) → verificar UI contra `PORT=3100 npx next start` efímero y matarlo.
5. Radix Tabs no monta contenido inactivo; gates ADMIN+ dependen de `useSession()` post-hidratación → invisibles en SSR.
6. Validar TODAS las FKs opcionales en `validateReferences` — si falta una, Postgres explota 500 en vez de 400 accionable.
7. Prefill en diálogos: estado derivado, no useEffect+setState (warning react-hooks).
8. Tests vitest solo lógica pura; TS strict:false no hace narrowing por negación (`if (v.ok === false)`, no `if (!v.ok)`).

---

## 6. Comandos rápidos

```bash
pnpm test:unit                                   # 360 tests
pnpm run build                                   # juzgar por exit code (warning labor/documents preexistente e inocuo)
pnpm run dev                                     # dev server :3000 (INNGEST_DEV=1 para Task 11)
PORT=3100 npx next start                         # server prod efímero para verificación UI post-build
source scratch/e2e-helpers.sh                    # login/api/check helpers e2e (BASE localhost:3000)
npx tsx scratch/check-folio-gaps.ts              # auditoría de folios
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest   # Task 11
```

## 7. Open questions heredados

1. ¿Conformidad con firma digital real o basta registro userId+timestamp? (actual: registro simple nombre+fecha)
2. Contrato firmado para >$100K (doc §4): sin campo aún → resolver en Phase 6 (contracts).
3. Calidad de datos recipes/sales-entry para food cost teórico — validar ANTES de invertir en ese KPI de Task 10.
4. Ubicación en sidebar de "Presupuestos" (Task 9) — recomendación: Finanzas.
