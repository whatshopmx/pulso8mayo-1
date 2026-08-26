# Handoff — Sistema de Control OC/OS (finzasordenes.md): Phases 1–3 + Task 7 + Phase 4-bis R1–R3 completos · siguiente R4–R5

**Fecha de última sesión:** 2026-08-25 (cuarta sesión del plan)
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
| `7599d7a`,`6beec50`,`91e122c`,`aedccbb` | docs de seguimiento |

**Estado al cierre:** ✅ **Phase 1 (datos), Phase 2 (servicios), Phase 3 (APIs), Task 7 (UI) y Phase 4-bis R1–R3 completas.** Suite **360 tests unitarios pasan**, `pnpm run build` exit 0, lint 0 errores en archivos del plan. Working tree limpio salvo archivos del workstream paralelo (`tasks/plan.md`, `tasks/todo.md`, loteprod).
**Siguiente paso concreto:** **Phase 4-bis R4–R5** — bandeja "Autorizaciones" (tab de `finance/control-interno`) con hook `useApprovalInbox()` sobre GET `/api/approval-requests`, y editor "Matriz de Autorización" como otra tab (solo ADMIN+). Detalles en `tasks/plan-ordenes-oc-os.md` Phase 4-bis.

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
- Sidebar `components/app-sidebar.tsx`: **sin sección "Control"**; ítem "Órdenes de Servicio" bajo sección Equipos. Las bandejas/matriz van como tabs de Finanzas › Control Interno (R4/R5) y Presupuestos decidir ubicación al implementar Task 9.
- Patrones UI aprendidos: `PageHeader` usa prop **`actions?: ReactNode`** (NO `action`/badge string) · `EmptyState` usa **`action={{label, onClick|href}}`** (no nodo) · rol client-side: `useSession()` + `roleIsAtLeast(user.role, required)` (lib/permissions es puro, importable en cliente) · dinero input pesos → `Math.round(parseFloat*100)`.

## 4. DATOS DEMO EN BD (para desarrollar/pruebas)

- Usuarios (password **`123456`**, seeds `scripts/seed-passwords.ts`): carlos@pulso.mx SUPER_ADMIN(Roma) · maria@pulso.mx ADMIN(Condesa, alcance empresa) · juan@pulso.mx GERENTE(**fijo Condesa**) · ana@pulso.mx SUPERVISOR(**fija Polanco**) · pedro/luisa/roberto EMPLEADO · diana READONLY.
- COMPANY_ID `a1b2c3d4-e5f6-7890-abcd-ef1234567890` · Branches: Condesa=`b1000001-...-0001` code **CDMX01**, Polanco=`…0002` code **PLNC01**, Roma=`…0003` sin code · CostCenter MANT=`b805b372-65d3-4c0f-9dbe-19ef903cbce4`.
- Presupuestos mes corriente: CDMX01 $50,000 · PLNC01 $20,000.
- Documentos vivos: OS1 `OS-CDMX01-2026-0001` CLOSED · OS2 `OS-PLNC01-2026-0001` APPROVED · OS3 `OS-PLNC01-2026-0002` APPROVED · OS-emergencia `OS-PLNC01-2026-0003` PENDING_APPROVAL · OC `OC-CDMX01-2026-0001` APPROVED · 1 draft Condesa + 1 cancelada.
- Login API: `POST /api/auth/sign-in/email {"email","password"}` con cookie jar.

## 5. TAREAS PENDIENTES (marcar aquí Y en plan/todo al avanzar + commit)

### Checkpoints Foundation/Business/APIs ✅ · Phase 4 UI: Task 7 ✅ · Phase 4-bis: R1–R3 ✅

### Phase 4-bis (restante)
- [ ] **R4 — Bandeja "Autorizaciones" tab en Control Interno** ← SIGUIENTE
  - Componente `components/service-orders/approval-inbox.tsx`: hook `useApprovalInbox()` sobre GET `/api/approval-requests` (items ya vienen enriquecidos con `budget.available`, `emergency.cap/used`, folio, monto, nivel, rol requerido, tipo). Agrupar por documento; aprobar/rechazar (motivo) con los hooks existentes `useApproveRequest()`/`useRejectRequest({requestId, reason})`. Estados loading/error/empty con patrón EmptyState+retry.
  - Tab nueva en `finance/control-interno/page.tsx`. GERENTE/SUPERVISOR solo ven su sucursal (el API ya filtra); creador excluido (SELF ya viene filtrado).
- [ ] **R5 — Editor "Matriz de Autorización" tab en Control Interno**: tabla editable de reglas (pesos↔centavos, rol select de APPROVER_ROLES_HIERARCHY, minQuotes, sequence, active), PUT mostrando errores inline (traslape misma secuencia) y warnings de huecos como avisos no bloqueantes. Solo ADMIN+ (ocultar tab).
- [ ] **Task 9 — `app/dashboard/budgets/page.tsx`**: selector mes (`GET /api/budgets?month=YYYY-MM` ya devuelve grid completo sucursales×centros con `alert` ≥90%) + captura celda a celda con `PUT /api/budgets` (ADMIN+: ocultar/deshabilitar edición para el resto). Barra consumo vs presupuestado.
### Phase 5
- [ ] **Task 10 — Dashboard KPIs**: `app/dashboard/reports/control/page.tsx` + `app/api/reports/control/route.ts`. Food cost % real vs teórico (recipes/sales-entry), gasto operativo %, presupuesto vs ejecutado por partida (usar `getCommittedByPair`), comparativo precios por insumo entre sucursales, ranking proveedores, % emergencias (<5% meta), desviación presupuestal. **Metas desde `tenant_operating_config`** (decisión #10; defaults `DEFAULT_FINANCIAL_TARGETS` en financial-kpi-types). Patrón Recharts de reports/executive. Filtro mes/sucursal.
- [ ] **Task 11 — Job Inngest mensual** `lib/inngest/functions/control-monthly-report.ts`: desviaciones, `findFolioGaps`, contratos por vencer ≤90 días (Phase 6), domiciliados desviados → `NotificationDispatcher` a OWNER/ADMIN. Cron `0 6 1 * *` (o similar). Registrar en `app/api/inngest/route.ts`.

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

## 7. Open questions heredados
- ¿Conformidad con firma digital real o basta userId+timestamp? (implementación actual: registro simple nombre+fecha)
- Contrato firmado para >$100K (doc §4): sin campo aún → Phase 6 (contracts) probablemente.
- Calidad de datos recipes/sales-entry para food cost teórico antes de Task 10.

## 8. Comandos rápidos
```bash
pnpm test:unit                  # 360 tests (suite completa)
pnpm run build                  # juzgar por exit code (warning labor/documents preexistente)
npx tsx scratch/check-folio-gaps.ts          # auditoría findFolioGaps (empresa demo)
# helpers e2e con login por rol: scratch/e2e-helpers.sh (BASE localhost:3000; requiere dev server)
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest   # para Task 11
```
