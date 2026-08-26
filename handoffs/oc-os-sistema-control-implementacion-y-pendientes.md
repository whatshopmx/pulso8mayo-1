# Handoff — Sistema de Control OC/OS (finzasordenes.md): Phases 1–5 parciales · Tasks 1–10 COMPLETAS · siguiente Task 11

**Fecha de última sesión:** 2026-08-26 (quinta sesión del plan — Task 10)
**Repositorio:** `C:/Users/david/pulso29` — Pulso HORECA (Next.js 16 App Router + Turbopack, React 19, TypeScript strict:false, Drizzle + Neon Postgres, better-auth, react-query, Tailwind v4, Radix/shadcn)
**Documento fuente del negocio:** `finzasordenes.md` (raíz del repo) — Órdenes de Compra/Servicio, matriz de autorización §4, controles multi-sucursal, folios sin saltos §6, KPIs gerenciales.
**Plan de trabajo:** `tasks/plan-ordenes-oc-os.md` · checklist ejecutiva: `tasks/todo-ordenes-oc-os.md` · este archivo es la **fuente de verdad para continuidad**.

## ⚠️ Contexto crítico antes de empezar

1. **Hay un workstream PARALELO activo en este repo** (inventario/temperaturas "Task 1a–1e", plan `tasks/plan-loteprod-gaps.md`, migración `drizzle/0064_closed_shen.sql`, `loteprod.md`). NO tocar sus archivos ni sus migraciones. Si `.next/lock` está tomado al hacer `pnpm run build`, es otro build corriendo: esperar con loop de 10 s en vez de matar procesos.
2. **Commits de este plan (en main, todos aplicados):**
| Commit | Contenido |
|---|---|
| `973c34b` | Task 1 — esquema OS/matriz/centros/presupuestos (migración `0061`) |
| `47187c7` | Task 2 — generador de folios transaccional (`0062`: folio_counters + branches.code) |
| `5299cf8` | Tasks 3+4 — matriz de autorización + presupuesto/tope emergencias (`0063`: emergency_purchase_cap_cents) |
| `7aa9b80` | Task 5a — API service-orders CRUD + submit transaccional |
| `41bcae3` | Task 5b — quotes/evidence/conformity + transiciones operativas |
| `95d1c2c` | Task 6 — APIs aprobaciones/matriz/cost-centers/budgets + integración OC |
| `f4fee9b` | fix e2e — validador de matriz: traslapes con secuencias distintas son LEGALES |
| `9f83b59` | Task 7 — UI service-orders (lista + detalle estado×rol + sidebar "Control") |
| `65becfa` | docs — plan Phase 4-bis (R1–R5) |
| `4828d85` | R1–R3 — OS bajo Equipos (`equipment/compliance/service-orders`) + origen normativo complianceServiceId + Generar OS/Ver OS desde Servicios Normativos |
| `9f0e756` | docs — R1-R3 |
| `6fd6403` | R4–R5 — bandeja "Autorizaciones" + editor "Matriz" como tabs de Finanzas › Control Interno |
| `7599d7a`,`6beec50`,`91e122c`,`aedccbb` | docs de seguimiento |

**Estado al cierre:** ✅ **Tasks 1–10 COMPLETAS** (Phases 1–4, Phase 4-bis R1–R5, y de la Phase 5 el Task 10). El flujo normativo→OS→autorización→presupuesto→KPIs está entregado de punta a punta.
**Siguiente paso concreto:** **Task 11** — job Inngest mensual (`lib/inngest/functions/control-monthly-report.ts`). Luego Phase 6 (contratos, Tasks 12–15) y Phase 7 (KPIs extendidos).

### ⚠️ Task 10 vive en una rama, no en main

Los commits del Task 10 están en **`feat/oc-os-task10-kpis`** (bifurcada de `main` en `1ad6f24`), no en `main`: cuando se implementó, el working tree estaba en la rama del workstream paralelo de inventario y mezclarlos habría ensuciado ambas historias. **Falta hacer merge a `main`.**

| Commit | Contenido |
|---|---|
| `1f00cf6` | Task 10 fase 1 — ejecución presupuestal, desviación y % de emergencias |
| `2f35c37` | Task 10 fase 2 — comparativo de precios entre sucursales y ranking de proveedores |
| `677e480` | Task 10 fase 3 — food cost real vs. teórico y gasto operativo % |

Y estos dos, del Task 9, sí están en `main`:

| Commit | Contenido |
|---|---|
| `b44f598` | Task 9 — UI de Presupuestos (grid mensual sucursales×centros, captura ADMIN+) |
| `38b194c` | docs — handover v2 |

---

## 1. Qué construye este plan (resumen)

Sistema documental-financiero OC/OS: Órdenes de Servicio como módulo independiente con evidencia y conformidad, matriz de autorización configurable por monto, presupuesto mensual sucursal×centro×partida, folios `OC/OS-[SUC]-[AÑO]-[N]` sin saltos, tope mensual de emergencias, dashboard de KPIs. Fases: datos→servicios→APIs→UI→KPIs/job→contratos recurrentes→KPIs extendidos.

## 2. Decisiones de arquitectura (VINCULANTES — no re-abrir)

1. **OS es módulo independiente**: FK opcional a equipos/servicios normativos; no se integra forzadamente a equipment.
2. **Matriz en BD** (`approval_matrix_rules`), seed perezoso con la default del doc §4 al primer `resolveApprovalChain`.
3. **Presupuesto por sucursal×centro×mes** (`branch_budgets`, unique triple). Validación en submit; docs sin costCenterId no se atribuyen.
4. **Folio real SOLO en submit** (borradores llevan `DRAFT-*`): cancelar borrador no deja hueco. Contador transaccional `INSERT..ON CONFLICT DO UPDATE RETURNING`.
5. **TRES capas de autorización coexisten sin unificarse**: (a) `approvalMatrixRules` SOLO OC/OS; (b) gastos sueltos → `expenseAuthorizationRules`+A16; (c) OC/OS no lee A16 ni umbrales del operating-config.
6. **Tope de emergencias** en `tenant_operating_config.emergencyPurchaseCapCents` (NULL=sin tope), editable desde la UI del operating-config existente. Cuenta OC EMERGENCIA **y** OS urgency=EMERGENCIA.
12. **Matriz default = bandas DISJUNTAS** ($0–5k GERENTE/1q · $5,001–25k ADMIN/2q · $25,001–100k OWNER/3q · >100k OWNER/3q) → cadenas de 1 nivel por monto. **Cadenas multi-nivel se configuran con reglas TRASLAPADAS y secuencias distintas** (ej. GERENTE seq1 [0,∞] + ADMIN seq2 [0,∞]) — el validador lo soporta desde `f4fee9b` (traslape+misma secuencia=ERROR; traslape con secuencias distintas=apilado legítimo; huecos=advertencia).
13. **Mes de atribución presupuestal = mes de `created_at` del documento** (misma base que `getCommitted` usa para los demás docs).

## 3. LO QUE YA ESTÁ IMPLEMENTADO (mapa rápido)

### Datos (migraciones 0061–0063 aplicadas, sin drops)
`lib/db/schema/service-orders.ts`: enums (service_order_type/urgency/status, purchase_type, approval_doc_type, approval_request_status, evidence_type) · tablas `service_orders`, `service_order_quotes`, `service_order_evidence`, `approval_matrix_rules`, `approval_requests`, `cost_centers`, `branch_budgets`, `folio_counters` · columnas nuevas en `purchase_orders` (`purchase_type`, `cost_center_id`, `folio_year`, `folio_sequence`) y `branches.code`.

### Servicios (`lib/services/`)
- `folio-generator.ts`: `formatFolio`, `parseFolio` (regex anclada; descarta DRAFT-*), `draftFolio()`, `nextFolio({companyId,branchId,docType,tx?})` (lanza ApiError 400 accionable si la sucursal no tiene code), `findFolioGaps(companyId)` (auditoría §6).
- `approval-matrix-service.ts`: puros `matchesRange`/`defaultMatrixRules`/`buildChain`/`nextPendingLevel`/`denyApproval` (ROLE|SELF|NOT_CURRENT_LEVEL)/`validateMatrixRules` · BD `resolveApprovalChain` (seed perezoso), `replaceMatrixRules` (PUT transaccional), `createApprovalRequests({...tx?})`, `approveRequest(id,actorId,actorRole,companyId?)`, `rejectRequest(...,reason,companyId?)` (al aprobar último nivel cierra el doc; rechazo lo manda a REJECTED de inmediato), **`listApprovalInbox`** (bandeja actionable: nivel mínimo pendiente + rol suficiente + excluye SELF + filtro sucursal opcional; enriquecida con folio/monto/tipo/sucursal/centro).
- `budget-service.ts`: puros `computeBudgetStatus`/`evaluateEmergencyCap` · BD `getBudget`, `getCommitted` (OS_COMMITTING_STATUSES=APPROVED..CLOSED; OC=APPROVED|SENT|PARTIALLY_RECEIVED|CLOSED), `checkBudgetAvailability`, `validateEmergencyCap`, **`getCommittedByPair`** (bulk 2 queries para grids/bandeja), **`getEmergencyCapUsage`**.
- `service-order-service.ts`: `listOrders` (filtros status/type/branch, paginación, joins nombres) · `getOrderDetail` (order enriquecida con branchName/Code, costCenterCode/Name, supplierName + quotes + evidence + approvals por nivel) · `createDraft` (valida FKs contra la empresa) · `updateDraft` (solo DRAFT) · `submitOrder` (**UNA tx**: cadena→cotizaciones ≥ max(minQuotes)→presupuesto o tope emergencia→`nextFolio({tx})`→UPDATE condicional `WHERE status='DRAFT'`(0 filas=409 y rollback devuelve el consecutivo)→approvals→PENDING_APPROVAL) · `transitionOrder` (schedule/start/complete/cancel con guard pura `actionTransitionError`) · `addQuote` (solo DRAFT) · `addEvidence` (bloqueada solo en terminales) · `signConformity` (GERENTE+ y PENDING_CONFORMITY→CLOSED+signedBy/At+completedAt; guard pura `conformityDenial` distingue ROLE→403/STATUS→409).
- Tests: `folio-generator.test.ts` (12) · `approval-matrix-service.test.ts` (23+) · `budget-service.test.ts` (12) · `service-order-workflow.test.ts` (10 guardias puras).

### APIs
```
app/api/service-orders/route.ts              GET lista · POST borrador
app/api/service-orders/[id]/route.ts         GET detalle · PATCH solo-DRAFT · PATCH {action:schedule|start|complete|cancel}
app/api/service-orders/[id]/submit/route.ts  POST submit (matriz+presupuesto+folio en 1 tx)
app/api/service-orders/[id]/quotes/route.ts   POST (solo DRAFT)
app/api/service-orders/[id]/evidence/route.ts POST ANTES|DESPUES
app/api/service-orders/[id]/conformity/route.ts POST GERENTE+ PENDING_CONFORMITY→CLOSED
app/api/approval-requests/route.ts            GET bandeja (items con budget/emergency enriquecidos)
app/api/approval-requests/[id]/approve|reject POST (denial ROLE/SELF→403, NOT_CURRENT_LEVEL→409; reject exige reason≥3)
app/api/approval-matrix/route.ts              GET ?docType · PUT reemplaza matriz (ADMIN+, validateMatrixRules)
app/api/cost-centers/route.ts                 GET · POST ADMIN+ (unique company+code→409)
app/api/budgets/route.ts                      GET grid mensual (budgeted/committed/available/alert≥90%) · PUT upsert ADMIN+
```
⚠️ `app/api/approvals/` YA EXISTE (turnos RH, ShiftApprovalService) — la bandeja OC/OS vive en `app/api/approval-requests/`. NO colisionar.
**Integración OC** (Task 6): `purchase-order-service.submitForApproval(id,userId,companyId?)` exige DRAFT+total>0+purchaseType asignado → cadena 'OC' → presupuesto/emergencia → TX folio real `OC-[SUC]-...`(+folioYear/folioSequence)+approvals. `approvePO/rejectPO` lanzan 409 si hay requests PENDING (usar bandeja). PATCH de PO acepta `purchaseType`/`costCenterId`; GET scoped por tenant. Retrocompatible: OC ya enviadas antes de la matriz no pasan por ella.

### UI (Task 7 + Phase 4-bis R1–R3)
- `hooks/queries/use-service-orders.ts` (+exportado en index.ts): `useServiceOrders/useServiceOrder/useCreateServiceOrder/useUpdateServiceOrder/useTransitionServiceOrder/useSubmitServiceOrder/useAddQuote/useAddEvidence/useSignConformity/useApproveRequest()/useRejectRequest()`(sin id param; reciben requestId)/`useCostCenters`. `useServiceOrders` acepta `complianceServiceId`.
- `components/service-orders/create-order-dialog.tsx`: diálogo compartido de creación; exporta `TYPE_LABELS`; props `{open, onClose, prefill?, onCreated?}` — prefill `{complianceServiceId, branchId, type?, scope?}` aplicado vía **estado derivado** (overrides nullables, sin useEffect); sin `onCreated` navega al detalle.
- `app/dashboard/equipment/compliance/service-orders/page.tsx`: lista con filtros estado/tipo, paginación, badges, soporta `?complianceServiceId=` (badge "quitar filtro").
- `app/dashboard/equipment/compliance/service-orders/[id]/page.tsx`: detalle con acciones estado×rol (aprobar/rechazar solo nivel corriente + `roleIsAtLeast` client-side + excluye creador), timeline "En turno", galería ANTES/DESPUES con `usePhotoUpload` (R2 presignado `/api/upload`), QuoteDialog (file o URL), EditDraftDialog.
- `app/dashboard/equipment/compliance/page.tsx`: acciones por fila "Generar OS" (abre el dialog con prefill) y "Ver OS" (link a la lista filtrada).
- `components/service-orders/approval-inbox.tsx` (R4): bandeja Autorizaciones — cards por documento con monto, barra presupuesto (ámbar ≤10% disponible) o cap emergencias, Aprobar/Rechazar(motivo); loading/error/empty con EmptyState de `ui/empty-state`.
- `components/service-orders/approval-matrix-editor.tsx` (R5): editor de matriz OC/OS — filas editables pesos↔centavos, rol, cotiz., secuencia, activa; patrón borrador derivado; warnings de huecos como Alert ámbar no bloqueante; errores inline vía toast con mensaje del API.
- `app/dashboard/finance/control-interno/page.tsx`: tabs Bitácora · Excepciones · **Autorizaciones** (badge = `useApprovalInbox().total`) · **Matriz de Autorización** (solo ADMIN+, gate client-side con `roleIsAtLeast`).
- Sidebar `components/app-sidebar.tsx`: **sin sección "Control"**; ítem "Órdenes de Servicio" bajo sección Equipos. Presupuestos (Task 9) falta decidir ubicación en sidebar.
### KPIs de control (Task 10 — rama `feat/oc-os-task10-kpis`)
- `lib/services/control-kpi-types.ts`: **contrato puro, sin runtime de servidor** (mismo criterio que `financial-kpi-types`, para que la página importe los tipos sin arrastrar Drizzle al bundle). Puras cubiertas por 32 tests: `computeBudgetExecution` · `aggregateBudgetExecution` · `computeEmergencyShare` · `computePriceSpread` · `withSupplierShare` · `computeFoodCostGap` · `computeOperatingExpenseRatio`. Metas en `DEFAULT_CONTROL_TARGETS` (emergencias 5/10%, presupuesto ámbar ≥90%, dispersión de precio 5/10%).
- `lib/services/control-kpi-service.ts`: `getControlReport({companyId, month, branchId})`. Reutiliza `getCommittedByPair` y las constantes `*_COMMITTING_STATUSES` de `budget-service`, y delega el food cost real a `calculateFinancialKPIs`. `getCommitmentTotals` devuelve **OS y OC por separado** (el gasto operativo del doc §E es Gastos OS / Ventas; el % de emergencias usa el combinado).
- `GET /api/reports/control?month=YYYY-MM&branchId=` — **GERENTE+**; el pin de sucursal del tenant manda sobre el `branchId` pedido, igual que `/api/budgets`.
- `hooks/queries/use-control-report.ts` (+barrel) · `app/dashboard/reports/control/page.tsx` · sidebar Finanzas › "Control Gerencial".
- Sondeos reutilizables: `scratch/probe-control-report.ts` (reporte completo por mes, acepta el mes como argv), `scratch/probe-precios-proveedores.ts` (auditoría SQL de precios/proveedores), `scratch/probe-foodcost.ts`, `scratch/e2e-control-kpis.sh` (matriz de roles por HTTP).

**Decisiones de lectura de datos (no re-abrir):**
- Gasto comprometido contra un centro **sin presupuesto capturado** → `unbudgeted: true` + semáforo CRITICAL, nunca 0% ni 100%: no hubo techo contra el cual medir y ése es el hallazgo.
- Denominador del % de emergencias **incluye documentos sin centro de costo** (sí son gasto); por eso ese total es mayor que el "comprometido" del grid de presupuestos. La UI lo explica en la tarjeta.
- Comparativo de precios: promedio **ponderado por cantidad**, dispersión contra la sucursal **más barata** (el ahorro recuperable), y **se apaga si el alcance es una sola sucursal** — un GERENTE no debe ver precios ajenos.
- Ranking de proveedores: excluye documentos sin proveedor asignado en vez de agregar una fila "(sin proveedor)" sobre la que nadie puede actuar.
- Sin ventas capturadas, food cost y gasto operativo devuelven `null`, **nunca 0%**.

- Patrones UI aprendidos: `PageHeader` usa prop **`actions?: ReactNode`** (NO `action`/badge string) · `EmptyState` usa **`action={{label, onClick|href}}`** (no nodo) · rol client-side: `useSession()` + `roleIsAtLeast(user.role, required)` (lib/permissions es puro, importable en cliente) · dinero input pesos → `Math.round(parseFloat*100)`.

## 4. DATOS DEMO EN BD (para desarrollar/pruebas)

- Usuarios (password **`123456`**, seeds `scripts/seed-passwords.ts`): carlos@pulso.mx SUPER_ADMIN(Roma) · maria@pulso.mx ADMIN(Condesa, alcance empresa) · juan@pulso.mx GERENTE(**fijo Condesa**) · ana@pulso.mx SUPERVISOR(**fija Polanco**) · pedro/luisa/roberto EMPLEADO · diana READONLY.
- COMPANY_ID `a1b2c3d4-e5f6-7890-abcd-ef1234567890` · Branches: Condesa=`b1000001-...-0001` code **CDMX01**, Polanco=`…0002` code **PLNC01**, Roma=`…0003` sin code · CostCenter MANT=`b805b372-65d3-4c0f-9dbe-19ef903cbce4`.
- Presupuestos mes corriente: CDMX01 $50,000 · PLNC01 $20,000.
- Documentos vivos: OS1 `OS-CDMX01-2026-0001` CLOSED · OS2 `OS-PLNC01-2026-0001` APPROVED · OS3 `OS-PLNC01-2026-0002` APPROVED · OS-emergencia `OS-PLNC01-2026-0003` PENDING_APPROVAL · OC `OC-CDMX01-2026-0001` APPROVED · 1 draft Condesa + 1 cancelada.
- Login API: `POST /api/auth/sign-in/email {"email","password"}` con cookie jar.

## 5. TAREAS PENDIENTES (marcar aquí Y en plan/todo al avanzar + commit)

### Checkpoints Foundation/Business/APIs ✅ · Phase 4 UI: Tasks 7, 8, 9 ✅ · Phase 4-bis: R1–R5 ✅ COMPLETA

### Phase 4 — COMPLETA
- [x] **Task 8** — entregado por R4/R5 como tabs de Finanzas › Control Interno (la ubicación original `company/approval-matrix` se descartó al reintegrar superficies).
- [x] **Task 9 — `app/dashboard/budgets/page.tsx`** (commit `b44f598`): grid mensual sucursales×centros, captura ADMIN+, barra de consumo, alerta ≥90%. Sidebar: Finanzas › Presupuestos.
### Phase 5
- [x] **Task 10 — Dashboard KPIs** (rama `feat/oc-os-task10-kpis`): `lib/services/control-kpi-types.ts` (contrato puro sin runtime de servidor, 32 tests) + `control-kpi-service.ts` + `GET /api/reports/control?month&branchId` (GERENTE+) + `app/dashboard/reports/control/page.tsx` + sidebar Finanzas › "Control Gerencial". Entregado: ejecución presupuestal y desviación por partida · % emergencias vs meta <5% · comparativo de precios entre sucursales · ranking de proveedores por monto · gasto operativo % · food cost real. **Sin Recharts**: los KPIs son escalares y comparativos de pocas filas; tablas + barras de consumo comunican mejor que gráficas aquí.
- [ ] **Task 11 — Job Inngest mensual** ← SIGUIENTE `lib/inngest/functions/control-monthly-report.ts`: desviaciones, `findFolioGaps`, contratos por vencer ≤90 días (Phase 6), domiciliados desviados → `NotificationDispatcher` a OWNER/ADMIN. Cron `0 6 1 * *` (o similar). Registrar en `app/api/inngest/route.ts`.

### Phase 6 — Contratos y recurrentes
- [ ] **Task 12** tabla `supplierContracts` (payee/supplier nullable, scope, monto ¢, vigencia, escalación INPC bool, paymentMethod CORRIDA|DOMICILIADO|TRANSFERENCIA, día cargo, partida, urlContrato, activo) — migración SIN drops.
- [ ] **Task 13** CRUD `app/api/contracts/**` (ADMIN+ escribir); flag REQUIERE_INVESTIGACION si factura vs contrato >10%; alerta renovación ≤90 días 1 vez/mes.
- [ ] **Task 14** domiciliados: esperado vs cargos reales del mes (`cfdiRecibidos`/expenses del payee); alertas desviación/cargo ausente/suscripción huérfana.
- [ ] **Task 15** `app/dashboard/contracts/page.tsx` (badges vigencia verde/ámbar≤90d/rojo, calendario cargos, editor básico).

### Phase 7 — KPIs extendidos (amplían Task 10)
Cumplimiento proveedor (entregas vs expectedDeliveryDate) · días de inventario (kardex) · % egresos sin documento origen (<2%) · % correctivo vs preventivo (<40%) · contratos vencidos (0). Excluido: kWh, auditorías físicas, par levels.

### Checkpoint final
Flujo end-to-end demostrable + KPIs con datos demo + `pnpm run build && pnpm run lint` verdes.

## 6. Gotchas acumulados (leídos y sufridos en sesión)

1. **`ApiError(mensaje, statusCode)`** — mensaje PRIMERO. Mapear en rutas con `isApiError(error)` → `{error.message}, status statusCode` (hay ejemplos en todas las rutas nuevas).
2. **`db.transaction` funciona** porque driver `neon-serverless` + WebSocket. No cambiar a neon-http.
3. **Scripts tsx**: primera línea `import "dotenv/config";` (hoisting ESM). Alias `@/` funciona.
4. **Git Bash `/tmp` NO existe para Python de Windows**: archivos intermedios curl↔python usar rutas del proyecto (`scratch/...`).
5. **Build Turbopack**: tras editar barrel exports (`hooks/queries/index.ts`) puede quedar caché stale ("Export X doesn't exist") → `rm -rf .next/cache` y rebuild. El warning "Error loading document stats …/dashboard/labor/documents" es PREEXISTENTE e inocuo (juzgar por exit code).
6. **`.next/lock`**: builds paralelos (workstream paralelo o pipelines truncados) lo retienen → loop espera 10 s; nunca db:push; migraciones solo `pnpm db:generate` + revisar SQL + `pnpm db:migrate` (61-63 aplicadas; **0064 es del workstream paralelo**).
7. **Dinero SIEMPRE centavos integer · meses "YYYY-MM" · rangos matriz inclusivos**.
8. **Tests unitarios** vitest: solo lógica pura (`pnpm test:unit`, globs `lib/**/*.test.ts`, `tests/unit/**`). TS con `strict:false` NO hace narrowing por negación de discriminantes (`if (!v.ok)` falla) → usar `if (v.ok === false)` o `"error" in v`.
9. **Uploads R2**: `usePhotoUpload()` (components/shared) hace presign `/api/upload` + PUT; devuelve `{url,key,name}`. Sin R2 configurado fallará (fallback local pendiente de validar).
10. **agent_browser (tool) roto esta sesión** con "live daemon restore policy" aunque `doctor` pasa — verificar UI vía HTTP con cookie jar o pedir al usuario revisión manual.
11. **Bandeja y scoping**: GERENTE/SUPERVISOR ven solo su sucursal (tenant.branchId fijo); ADMIN/OWNER/SUPER_ADMIN ven toda la empresa salvo cookie de sucursal. Los requests de niveles futuros NO aparecen en la bandeja (solo nivel corriente).
12. **i18n**: UI en español, sin next-intl en estas páginas (convención del dashboard).
13. **Dev server lockea directorios en Windows**: `git mv app/dashboard/service-orders ...` falla con Permission denied si el dir está siendo watcheado por `next dev` (PID en puerto 3000). Solución: `git mv` archivo por archivo + `rmdir` del dir vacío — los archivos individuales sí se renombran.
14. **Validar TODAS las FKs opcionales en `validateReferences`**: si se agrega un campo nuevo al payload pero no a la llamada de validación, la FK inválida llega a Postgres y explota como 500 genérico en vez de 400 accionable (leído en e2e de R2).
15. **Prefill en diálogos reutilizados**: usar estado derivado (`override ?? prefill ?? default`) en vez de `useEffect` que haga setState — evita warning react-hooks/set-state-in-effect y renders en cascada.
16. **`pnpm run build` con el dev server arriba corrompe la salida del dev**: tras un build de producción, `next dev` sirve solo el shell flight (sin HTML SSR del contenido) — los checks curl de texto sobre páginas dev dan falsos negativos. Para verificar UI por HTTP con build reciente: levantar servidor de prod efímero (`PORT=3100 npx next start`), probar y matarlo (solo ese PID).
17. **Radix Tabs no monta TabsContent inactivos** (sin forceMount): el contenido solo se puede verificar activando el tab; en SSR solo se ven los triggers. El gate ADMIN+ del tab Matriz depende de `useSession()` → aparece post-hidratación, invisible para SSR.
18. **Hooks de react-query comparten cache por queryKey**: la página llama `useApprovalInbox()` para el badge y `<ApprovalInbox />` lo llama internamente — un solo fetch. Mismo patrón si Task 9 necesita conteo.

19. **Los archivos sin commitear del workstream paralelo te siguen al cambiar de rama.** Al bifurcar `feat/oc-os-task10-kpis` desde `main`, los untracked `components/inventory/prep-list-*.tsx` viajaron con el switch y rompieron el build (`Cannot find module '@/lib/inventory/prep-list'` — ese módulo solo existe en la rama de loteprod). Costó un build de 3.6 min. Antes de bifurcar, aparcar los untracked ajenos fuera del árbol.
20. **`git switch` se bloquea si un archivo sucio difiere entre las dos ramas.** Comprobar con `git diff --stat main HEAD -- <archivo>` antes de intentarlo; para los que difieran, `git stash push -- <pathspec>` acotado en vez de un stash global que arrastre trabajo ajeno.
21. **La verificación por HTTP no prueba que la página renderice.** Un `curl` a una ruta del dashboard devuelve 200 con solo el shell; el componente cliente y su fetch corren en el navegador. El MCP de chrome-devtools sí funciona en este entorno (`new_page` → `/sign-in` → `fill_form` → `take_screenshot` + `list_console_messages`) y ahí se detectó que `formatCurrency` imprimía `$-36,000.00` en vez de `-$36,000.00`, invisible para curl.
22. **La ruta de login es `/sign-in`**, no `/login` (`/login` da 404).
23. **El hook de diseño `impeccable` corre en cada Write/Edit** y marca tamaños de fuente fuera de la escala de `DESIGN.md` (p. ej. `text-[11px]` → usar `text-xs`). Vale la pena hacerle caso: es barato y evita deriva del sistema de diseño.

## 7. Open questions heredados
- ¿Conformidad con firma digital real o basta userId+timestamp? (implementación actual: registro simple nombre+fecha)
- Contrato firmado para >$100K (doc §4): sin campo aún → Phase 6 (contracts) probablemente.
- ~~Calidad de datos recipes/sales-entry para food cost teórico antes de Task 10.~~ **RESUELTO (Task 10, verificado contra la BD):** `sales_entries` tiene **1 fila en toda la tabla**. La ingesta de POS llena `daily_sales_cuts` con totales por turno/canal, no venta a nivel platillo — lo que el comentario de `food-cost-service.ts` ya documentaba. El food cost **teórico no es implementable hoy**; se expone como `NO_DATA` con una nota que nombra el dato faltante (armada contando `sales_entries` del mes en vivo, así que el texto se actualiza solo si la ingesta cambia). **No se rellenó con el real**: eso dejaría la brecha en 0 y escondería justo lo que el indicador busca (merma, robo, porciones fuera de receta). Desbloquea: ingesta de POS a nivel platillo.
- **NUEVA — meta de gasto operativo %:** el doc §E define la fórmula (Gastos OS / Ventas) pero no fija umbral, a diferencia del food cost (30/35) y las emergencias (<5%). El KPI se entrega **sin semáforo** en vez de inventar un número. Cuando el grupo acuerde su meta, entra en `ControlTargets` (`control-kpi-types.ts`).

## 8. Comandos rápidos
```bash
pnpm test:unit                  # 360 tests (suite completa)
pnpm run build                  # juzgar por exit code (warning labor/documents preexistente)
npx tsx scratch/check-folio-gaps.ts          # auditoría findFolioGaps (empresa demo)
# helpers e2e con login por rol: scratch/e2e-helpers.sh (BASE localhost:3000; requiere dev server)
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest   # para Task 11
```
