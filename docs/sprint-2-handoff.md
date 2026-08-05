# Handoff — Sprint 2 (continuación en sesión nueva)

> **Audiencia:** el próximo agente que arranque en una sesión sin historial.
> **Meta del documento:** cargar todo el contexto necesario para ejecutar
> Sprint 2 sin re-descubrirlo. Léelo completo antes de tocar código.

---

## 0. Cómo arrancar

1. Lee `AGENTS.md` (reglas del repo: pnpm, drizzle, Inngest, multi-tenant,
   `db:push` es peligroso, etc.).
2. Lee este doc.
3. Lee los dos planes fuente (solo las secciones citadas):
   - `docs/pulso-executive-os-v2.md` §7 (Sprint 2 — Intelligence Engines I)
   - `docs/pulso-executive-os-security.md` §10 (fila "Sprint 2") y §6 (Pilar 2 cifrado)
4. `git log --oneline -15` para ver los commits de Sprint Sec-0 + Sprint 1.
5. Arranca con el **Track A Task 1** (OperationsEngine) o **Track B Task 1**
   (migrar `/api/finance/cash-flow` a `requirePermissionApi`) — ambos son
   independientes y paralelos.

---

## 1. Estado actual (lo que YA está hecho — no rehacer)

### Sprint Sec-0 — prerequisito de seguridad (commiteado)
Commits: `a154304` (docs), `feat(security): Sprint Sec-0 — 4-pillar security scaffolding`.

- `lib/db/schema/security.ts` — tablas `tenant_keys`, `data_access_logs`,
  `data_consents`, `privacy_notices`, `arco_requests`, `payment_approvals`.
- `lib/db/schema/classification.ts` — mapas declarativos `SENSITIVE_FIELDS`,
  `FINANCIAL_FIELDS`, `ENCRYPTED_FIELDS`, `classifyField()`,
  `SENSITIVE_GATE_ROLES` (Sprint 3 añadirá `HR`).
- `lib/db/schema/core.ts` — `branches.ownershipType` (enum `OWNED`/`FRANCHISE`),
  `franchiseeUserId`, `franchiseAgreementRef`, `franchiseRoyaltyPercent`.
- `lib/security/kek.ts` — `resolveKek()` fail-closed (env `PULSO_KEK`, en
  producción lanza si falta o es < 32 chars; dev usa KEK desechable).
- Migración `drizzle/0028_melted_reavers.sql` (crea tablas + alter branches).

### Sprint 1 — Foundation + entrelazado de seguridad (commiteado)
Commits: `9d9f9c9` → `f19d414` (12 commits, uno por slice).

| Task | Archivo | Qué hace |
|---|---|---|
| T1 | `lib/db/schema/operational-twin.ts` (+ `drizzle/0029`) | `corporateTwins` +13 cols ejecutivas (cash, obligations, 6 risks, 4 capabilities, executiveState jsonb). Defaults seguros. |
| T2 | `lib/services/intelligence/types.ts` | Contratos tipo: `ExecutiveTwin`, `ExecutiveState`, `CashFlowDay`, `Obligation`, `EngineOutput`, `Priority`, `Risk`, `IntelligenceEngine<TInput,TOutput>`, `MorningBrief`, `BriefPriority`, `BriefSection`, `EngineId`. **Type-only.** |
| T3 | `lib/inngest/events.ts` + `lib/services/domain-event-service.ts` | `DomainEventType` union (~18 eventos: operativos + ejecutivos + financieros + compliance). 10 nuevos Inngest trigger types (`executive/twin.updated`, `cashflow/updated`, …). `emitDomainEvent` acepta `DomainEventType | (string & {})` — legacy strings siguen compilando. |
| Sec | `lib/rbac/abac.ts` | `AccessContext`, `evaluateAccess()` (4 ejes: role⊕branch⊕classification⊕ownership), `buildOwnershipScope()` (matriz §8.3), `requirePermissionApi()` (guard de API), `buildAccessContext()`. **Adoptado en 0 rutas salvo** `/api/executive/twin*`. |
| Sec | `lib/rbac/branch-visibility.ts` | `branchVisibilityFilter(ctx, branches)` — chokepoint único para franquicias. `canSeeBranch()`. |
| T4 | `lib/services/executive-twin-engine.ts` | `ExecutiveTwinEngine.recalculate(companyId, ctx?)` — 10 dimensiones heurísticas, **wraps** `recalculateCorporateTwin` (NO reemplaza), persiste `corporate_twins`, emite `executive/twin.updated`. Con `ctx` devuelve twin scoped (rama franquicia, NO persistido). `getLatest()`, `getProjectedCashFlow(14)`, `getUpcomingObligations(30)`. |
| T6+T8 | `lib/inngest/functions/recalculate-executive-twin.ts` + `operational-twin.ts` | Inngest cron `*/15 * * * *` + event `executive/twin.recalculate`. `processCorporateTwinUpdate` delega a `ExecutiveTwinEngine.recalculate` (el export `recalculateCorporateTwin` se conserva). |
| T7 | `app/api/executive/twin/route.ts` + `twin/refresh/route.ts` | GET (latest) + POST (refresh forzado). **Primera ruta `/api/executive/*` con `requirePermissionApi`** (guard `reports:read` / `reports:manage`). |
| T5 | `lib/services/intelligence/engine-interface.ts` + `lib/services/evidence-store.ts` | Re-export del `IntelligenceEngine` + `EvidenceStore` (unifica evidencia, AI metadata: transcription/classification/verificationResult). Registro in-process; tabla diferida al primer consumidor durable (Rule 0). |
| T9 | `components/dashboard/executive/kpi-hero-cards.tsx` | 6 cards del twin (Group Health, Cash Available, Op Risk, Compliance, Brand, People Risk). Grid 3-col, waiting card cuando no hay twin. |
| T10 | `components/dashboard/executive/cash-flow-projection.tsx` + `app/dashboard/executive/page.tsx` | Recharts BarChart 14 días desde `twin.executiveState.cashFlowProjection`. Verde ≥0, rojo <0. |
| Sec | `lib/security/dek.ts` + `lib/security/column-cipher.ts` | `DekService` (ensureDek/getDek/rotateDek/hasDek), `encryptColumnWithDek`/`decryptColumnWithDek` (AES-256-GCM), prefijo `enc::` para coexistencia legacy. **Round-trip verificado**, ningún campo lo usa aún. |

### Verificación que YA corre limpia
- `npx tsc --noEmit` → sin output (clean).
- `pnpm run build` → ✓ 317/317 páginas, Turbopack 2.7min.
- `npx eslint <archivos nuevos>` → sin errores nuevos.
- Round-trip del column cipher: 5/5 muestras (prefijo, round-trip, IV aleatorio, passthrough legacy).

### Migraciones pendientes de aplicar (operator)
`drizzle/0028_melted_reavers.sql` (Sec-0) y `drizzle/0029_vengeful_scarlet_spider.sql` (Sprint 1)
NO se han aplicado a la DB. Quienes inningen Sprint 2 deben correr
`pnpm db:migrate` (NUNCA `db:push`) antes de validar nada que lea columnas nuevas.

### Deuda técnica conocida (NO tocar en Sprint 2 salvo que lo bloquea)
- `lib/services/domain-event-service.ts` línea ~44: `Record<string, any>` —
  eslint `no-explicit-any` **pre-existente**, fuera de scope.
- 2 commits sin conexión con Sprint 1 quedaron sin commitear a propósito
  (renames en `app/api/workflows/smart-links/corte-caja/route.ts` y
  `lib/inngest/functions/check-financial-alerts.ts`) — scope discipline.

---

## 2. Sprint 2 — DUAL-TRACK (esto es lo que toca ahora)

⚠️ **Naming collision importante:** el plan v2 y el plan de seguridad llaman
"Sprint 2" a cosas distintas. **Son dos tracks paralelos, no secuenciales.**
La seguridad es *cross-cutting* (docs/security §10), no un sprint aparte.

- **Track A — v2 §7:** construir los 5 intelligence engines (Operations, Finance,
  Brand, Compliance, Procurement) como fachadas que delegan a servicios
  existentes y normalizan a `EngineOutput`.
- **Track B — security §10 fila Sprint 2:** migrar rutas financieras a
  `requirePermissionApi(classification: 'FINANCIAL')`, adoptar el column
  cipher en `employees.clabe/card_number` + `salary_history.*`, y añadir el
  masking middleware en esas rutas.

Los dos tracks se tocan en **FinanceEngine + rutas financieras**: el engine
que lee datos financieros debe hacerlo a través de rutas ya migradas (Track B)
para que el ABAC+masking quede abajo, no arriba. **Recomendado: Track B
antes que FinanceEngine.** (Ver §5 orden sugerido.)

---

## 3. Track A — Intelligence Engines I (v2 §7)

### Contrato que TODOS los engines deben implementar
```ts
// lib/services/intelligence/types.ts (YA existe — Sprint 1 Task 2)
export interface IntelligenceEngine<TInput, TOutput extends EngineOutput> {
  readonly engineId: EngineId;     // 'operations'|'finance'|'brand'|'compliance'|'expansion'|'knowledge'|...
  readonly engineName: string;
  analyze(input: TInput): Promise<TOutput>;
  getLatest(companyId: string): Promise<TOutput | null>;
  refresh(companyId: string): Promise<TOutput>;
}
export interface EngineOutput {
  score: number; confidence: number; insights: string[];
  priorities: Priority[]; risks: Risk[]; generatedAt: Date;
}
```
`EngineId` ya incluye `'operations'|'finance'|'brand'|'compliance'|'expansion'|'knowledge'`
(Sprint 1). Si necesitas `'labor'|'inventory'|'maintenance'` añádelos al union
**type-only** en `types.ts` — no hay runtime que cambiar.

### Reglas de los engines (v2 §7 "facade layer" + §6.3)
- **Delegan, no recalculan.** Cada engine llama a los servicios existentes y
  los normaliza a `EngineOutput`. Poco código net-new.
- **Persistencia de outputs:** el plan dice "tabla nueva `engine_outputs` **o**
  reusar `corporate_twins.executive_state`". Decisión: para Sprint 2, cachear
  dentro de `executiveState.engineSnapshots[engineId]` (ya tipado en
  `ExecutiveState`). Crear tabla `engine_outputs` sólo si un engine necesita
  histórico (postergar a menos que un consumer lo pida — Rule 0).
- **Scope-aware:** todos los engines que agreguen cross-branch deben aceptar
  `ctx?: AccessContext` y filtrar con `branchVisibilityFilter()` (Pilar 4).

### Track A — Task 1: OperationsEngine
- **Archivo nuevo:** `lib/services/intelligence/operations-engine.ts`
- **engineId:** `'operations'`
- **Delega a:**
  - `CrossBranchService.getAllBranchesCompliance` → executionCapacity, completion
  - `CrossBranchService.getAllBranchesIncidentesActivos` → operationalRisk
  - `analytics-service.getExecutiveSummary` → alerts, branchOverview
  - `operational-twin-engine.recalculateTwin(branchId)` → health/drift per branch
- **Net-new:** `BenchmarkComparison` estructurado (ya existe en UI
  `benchmarking-insights.tsx` — normalizar a `EngineOutput`).
- **Verificación:** `analyze({companyId})` returns `EngineOutput` con `score`,
  `confidence`, `insights` no vacíos. `refresh(companyId)` persiste snapshot
  en `corporateTwins.executiveState.engineSnapshots.operations`.

### Track A — Task 2: FinanceEngine ⚠️ depende de Track B
- **Archivo nuevo:** `lib/services/intelligence/finance-engine.ts`
- **engineId:** `'finance'`
- **Delega a:**
  - `lib/services/executive-report-service.ts` → food cost, COGS, revenue, shrinkage, fill rate
  - `lib/services/cash-flow-service.ts` `getCashFlowProjection(companyId, 14)` → projectedCashFlow
  - `lib/services/forecast-service.ts` `ForecastService.calculateAll` → demanda
  - `lib/services/financial-kpi-service.ts` → KPIs
  - `lib/services/pnl-service.ts` → P&L consolidado
- **Net-new:**
  - `getUpcomingObligations(companyId)` → nómina, proveedores, rentas, servicios, impuestos
  - `liquidityRisk` score (upcoming obligations / available cash)
  - `RecommendedPayments` — priorización
- ⚠️ Las rutas `/api/finance/*` deben estar ya migradas a
  `requirePermissionApi(..., { classification: 'FINANCIAL' })` (Track B) para
  que este engine lea datos sin bypassear ABAC. Si Track B no está hecho, el
  engine puede llamar a los servicios directamente, pero **marcarlo como TODO
  de seguridad** y no exponer el engine por una ruta pública sin guard.

### Track A — Task 3: BrandEngine
- **Archivo nuevo:** `lib/services/intelligence/brand-engine.ts`
- **engineId:** `'brand'`
- **Delega a:** `CrossBranchService.getBenchmarking`, `getAllBranchesCompliance`,
  `lib/services/recipe-service.ts` (standard compliance),
  `lib/services/compliance-alert-service.ts` (quality checks).
- **Net-new:** `BrandDrift` (desviación estándar de quality scores entre
  sucursales), `BestPracticeReference` (la sucursal ejemplar por área).

### Track A — Task 4: ComplianceEngine
- **Archivo nuevo:** `lib/services/intelligence/compliance-engine.ts`
- **engineId:** `'compliance'`
- **Delega a:** `lib/services/ComplianceReportService.ts` (NOM-251, NOM-035,
  LFT, IMSS), `compliance-alert-service`, `lib/services/civil-protection-service.ts`,
  `lib/services/employee-document-service.ts`, `CrossBranchService.getDocumentExpirations`.
- **Net-new:** `InspectionReadiness` score, `RegulatoryCalendar`.

### Track A — Task 5: ProcurementEngine
- **Archivo nuevo:** `lib/services/intelligence/procurement-engine.ts`
- **engineId:** `'expansion'`? No — usar un nuevo `EngineId` `'procurement'`
  (añádelo al union type-only). consultarlo con el plan. (El plan v2 lo lista
  como ProcurementEngine pero `EngineId` no lo trae; añadir es 1 línea.)
- **Delega a:** `lib/services/suggested-order-service.ts`,
  `lib/services/purchase-order-service.ts`, `lib/services/stock-alert-service.ts`,
  `CrossBranchService.getAllBranchesMerma`.
- **Net-new:** `TransferRecommendations` (mover stock cross-branch — requiere
  comparar inventarios), `NegotiationOpportunities` (volumen por proveedor).

### Persistencia / refresco de engines
- **Cron:** añade un Inngest `refresh-engines` (cron `0 */6 * * *`) que llame
  `refresh(companyId)` para cada engine de cada company. Modelo: copia
  `lib/inngest/functions/recalculate-executive-twin.ts` (Sprint 1 Task 6).
- **Snapshot:** tras `refresh`, escribir el `EngineOutput` en
  `corporateTwins.executiveState.engineSnapshots[engineId]` vía
  `ExecutiveTwinEngine` (puede exponer un helper `setEngineSnapshot`).

### Aceptación Track A
- [ ] Los 5 archivos engine existen e implementan `IntelligenceEngine`.
- [ ] Cada uno produce `EngineOutput` con `confidence > 0` en una company con datos.
- [ ] `npx tsc --noEmit` clean; `pnpm run build` verde; `pnpm run lint` sin
  errores nuevos.
- [ ] Snapshots visibles en `corporateTwins.executiveState.engineSnapshots`.

---

## 4. Track B — Migración de seguridad (security §10 fila Sprint 2)

### Track B — Task 1: migrar rutas financieras a `requirePermissionApi`
**Rutas a migrar (todas bajo `app/api/finance/` + `app/api/payroll/`):**
```
app/api/finance/cash-flow/route.ts
app/api/finance/control-interno/audit-log/route.ts
app/api/finance/control-interno/excepciones/route.ts
app/api/finance/fiscal/timbrar-nomina/route.ts
app/api/finance/fiscal/validate-invoice/route.ts
app/api/finance/kpis/route.ts
app/api/finance/pnl/route.ts
app/api/payroll/export/route.ts
```

⚠️ **Gotcha crítico:** estas rutas **NO** usan `requireRoleApi` hoy. Usan
`requireTenant()` de `lib/tenant-context.ts` (que devuelve `{id, userId,
branchId}` sin rol). La migración debe **combinar** ambos: el nuevo guard
ABAC **junto con** el scoped tenant id. Patrón sugerido:
```ts
const { ctx, decision } = await requirePermissionApi('reports', 'read', {
  classification: 'FINANCIAL',
});
// ctx.userCompanyId es el tenant scoped (igual que tenant.id).
```
`requirePermissionApi` ya reusa `requireRoleApi` internamente y obtiene
`companyId` de la sesión, así que `requireTenant` queda redundante para estas
rutas — pero **verifica** que el `companyId` coincide antes de eliminar la
 llamada a `requireTenant` (puede haber lógica de cookie de branch active).
 Recomendación segura: wrapper que llame ambos y compare.

`resources` y `actions` disponibles: `lib/permissions.ts` — `Resource` =
`'users'|'companies'|'branches'|'workflows'|'inventory'|'reports'|'settings'|'billing'`,
`Action` = `'create'|'read'|'update'|'delete'|'manage'`. Para finanzas usa
`'reports', 'read'` (o `'manage'` si muta). para `timbrar-nomina` (acción
crítica) usa `'reports', 'manage'`.

### Track B — Task 2: column cipher en `employees` + `salary_history`
**Columnas a cifrar (docs §6.1):**
- `employees.clabe`, `card_number`, `bank_name` (FINANCIAL)
- `employees.curp`, `rfc`, `nss`, `date_of_birth`, `personal_email`,
  `personal_phone`, `address`, `emergency_contact_phone`,
  `emergency_contact_email` (SENSITIVE)
- `salary_history.previous_salary`, `new_salary` (FINANCIAL)

**Cómo adoptar:**
- En el código que escribe (servicios que insertan/update employees), antes de
  persistir: `await encryptColumn(companyId, plaintext)` (resuelve DEK solo).
- En el código que lee, al serializar para API/UI: `decryptColumn(companyId,
  row.col)` y aplicar `masking` (Task 3) antes de devolver.
- **Backfill:** crea Inngest `backfill-encrypt-employees.ts` (modelo:
  `incident-escalation.ts` o `weekly-insights.ts` — patrón chunked). Lee
  plaintext → cifra con `enc::` prefijo → actualiza en lotes de 1000 vía
  `step.run`. `decryptColumn` acepta ambos formatos así que conviven.
- **Prohíbe escritura plaintext** post-backfill con un check en el servicio
  (o middleware Drizzle) — no bloquees durante el backfill.

⚠️ **Pre-existente:** `employees.card_number` en `lib/db/schema.ts` comenta
"last 4 digits" pero **almacena el completo** (docs §1.2). No.css-validation
cambio de schema, sólo que el cipher lo cubre.

### Track B — Task 3: masking middleware en rutas migradas
- **Archivo nuevo:** `lib/rbac/masking.ts` (docs §6.2 lo firma).
- Maskers: `clabe → ****1234`, `card_number → ****1234`,
  `curp → ABCD***AB`, `rfc → ABCD***XYZ`, `nss → ***1234`,
  `personal_email → a***@domain`, `personal_phone → ***1234`.
- Aplicar según `AccessDecision.redactFields` (campos que `evaluateAccess`
  marca para enmascarar aunque se permita el read). Para Sprint 2, el
  `redactFields` puede ser sheurístico: si `classification === 'FINANCIAL'` y
  rol ∈ {GERENTE, SUPERVISOR, EMPLEADO, READONLY} → redactar. OWNER/ADMIN/SUPER
  _ADMIN ven plaintext. (Sprint 3 refinará con HR.)
- Hook: middleware o función `maskSensitive(obj, decision)` que las rutas
  migradas llamen antes de `ApiHandler.success`.

### Track B — Task 4: `dataAccessLogs` para rutas migradas
- Cada ruta migrada debe loggear el `AccessDecision` (incl. denies) en
  `data_access_logs` (tabla ya existe, Sec-0).
- Helper nuevo: `lib/security/audit.ts` con `logDataAccess({ userId,
  companyId, branchId, action, resource, resourceId, decision, redactedFields,
  req })` que inserta. El `req` da `ipAddress`/`userAgent`.
- No duplicar `employeeAuditLogs` (mutaciones de empleado ya cubiertas) —
  `dataAccessLogs` es para READ/EXPORT de datos clasificados (docs §9.1).

### Track B — Task 5 (opcional Sprint 2, recomendado post-Sprint-2): RLS
- docs §6.4. No meterse en Sprint 2 salvo que la migración de rutas pelig.
  Añade latencia y debugging complejo. Recomendado **post-Sprint 2** tras
  estabilizar el column cipher.

### Aceptación Track B
- [ ] 8 rutas financieras migradas a `requirePermissionApi(classification:'FINANCIAL')`.
- [ ] Column cipher activo en `employees.{clabe,card_number,curp,...}` y `salary_history.*`.
- [ ] Backfill Inngest corre sin downtime (lotes 1000).
- [ ] `masking` middleware aplicado en rutas migradas: GERENTE ve `****1234`.
- [ ] `data_access_logs` captura READ de FINANCIAL en las rutas migradas.
- [ ] `npx tsc --noEmit` clean, `pnpm run build` verde, round-trip cipher OK.

---

## 5. Orden de ejecución sugerido

1. **Track B Task 1** (migrar 8 rutas financieras a `requirePermissionApi`).
2. **Track B Task 4** (`logDataAccess` + wired en esas rutas).
3. **Track A Task 1** OperationsEngine (no toca finanzas).
4. **Track A Task 3** BrandEngine.
5. **Track A Task 4** ComplianceEngine.
6. **Track B Task 2** column cipher (backfill en paralelo vía Inngest).
7. **Track B Task 3** masking middleware.
8. **Track A Task 2** FinanceEngine (ahora sobre rutas ya migradas).
9. **Track A Task 5** ProcurementEngine.
10. Inngest `refresh-engines` cron + helper `setEngineSnapshot` en `ExecutiveTwinEngine`.

**Tamaño por slice:** ~80–150 líneas/slice. Commit por slice. NUNCA mezcles
engine + migración de ruta en el mismo commit (Rule 1).

---

## 6. Guías y reglas del repo (no olvidar)

- **pnpm, no npm.** `db:push` es peligroso (puede dropear tablas) — usa
  `db:generate` + `db:migrate`.
- **Incremental:** cada slice debe dejar `tsc`/`build` verdes y commiteado.
  Ver skill `incremental-implementation` (en `.agents/skills/`).
- **Scope discipline:** no refactorices archivos adyacentes "while I'm here".
  Si lo notas, anótalo en un TODO y sigue. (Rule 0.5 de la skill.)
- **Wrap, don't break:** los engines son **fachadas** sobre servicios
  existentes — NO reemplazar `recalculateCorporateTwin`, `getCashFlowProjection`,
  etc. El contrato vivo (callers de Inngest) debe seguir funcionando.
- **TypeScript `strict: false`** (AGENTS.md) — algunos issues no salen en tsc.
  Validar con `npx tsc --noEmit` igual.
- **i18n:** `next-intl`, config en `./i18n/config.ts`. UI en español.
- **Playwright tests** se excluyen del build TS — corren aparte con
  `pnpm test:e2e`.
- **Inngest dev:** `INNGEST_DEV=1` para local. UI en
  `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest`.
- **better-auth**, session-based — siempre `getSession()` (o
  `requirePermissionApi` que ya lo envuelve).
- **Multi-tenant:** todo scoped por `companyId`. Usa `AccessContext` para
  branch scoping (no reintroducir lecturas company-wide en engines).

### Lint caveats conocidos
- `lib/services/domain-event-service.ts` lanza `no-explicit-any` en la línea
  ~44 (`Record<string, any>` predato a Sprint 1). **No lo tocas** salvo que
  Sprint 2 edite ese archivo — sería un refactor fuera de scope.

### Verificación por slice
```bash
npx tsc --noEmit                                    # type check
npx eslint <file-touched>                           # lint (targeted)
pnpm run build                                      # gate fuerte (Turbopack ~3min)
# Round-trip cipher (si tocas lib/security/*):
# ver commit b6225e9 para el script de verificación de 5 muestras
```
Después de un `pnpm run build` verde, **no lo repitas** sin haber cambiado
código desde (Rule de incremental-implementation: re-run añade info = 0).

---

## 7. Apéndice — dónde está cada cosa

### Docs fuente
- `docs/pulso-executive-os-v2.md` — plan v2 (sprints 1–6). Sprint 2 = §7.
- `docs/pulso-executive-os-security.md` — 4 pilares + §10 tabla cross-cutting.
- `docs/pulso-executive-os-plan.md` — puente estrategia↔implementación.
- `AGENTS.md` — reglas del repo.
- `tasks/todo.md` — checklist Sprint 1 completada (referencia de formato).

### Servicios existentes que los engines DELEGARÁN (todos verificados OK)
```
lib/services/executive-report-service.ts
lib/services/cash-flow-service.ts           # getCashFlowProjection(companyId, days)
lib/services/forecast-service.ts           # ForecastService.calculateAll
lib/services/financial-kpi-service.ts
lib/services/pnl-service.ts
lib/services/suggested-order-service.ts
lib/services/purchase-order-service.ts
lib/services/stock-alert-service.ts
lib/services/compliance-alert-service.ts
lib/services/civil-protection-service.ts
lib/services/employee-document-service.ts
lib/services/knowledge-service.ts
lib/services/insight-generator-service.ts
lib/services/recipe-service.ts
lib/services/analytics-service.ts          # getExecutiveSummary
lib/services/cross-branch-service.ts        # CrossBranchService.{getAllBranches*, getBenchmarking, getDocumentExpirations, getComplianceTrend}
lib/services/operational-twin-engine.ts     # recalculateTwin(branchId), recalculateCorporateTwin(companyId)
lib/services/executive-twin-engine.ts       # ExecutiveTwinEngine (Sprint 1)
```

### Capa de seguridad (Sprint Sec-0 + Sprint 1)
```
lib/db/schema/security.ts                   # tablas Pilar 1–3 + audit
lib/db/schema/classification.ts             # SENSITIVE/FINANCIAL maps
lib/security/kek.ts                         # resolveKek() fail-closed
lib/security/dek.ts                         # DekService.ensureDek/getDek/rotateDek
lib/security/column-cipher.ts               # encryptColumn/decryptColumn (AES-256-GCM)
lib/rbac/abac.ts                            # evaluateAccess, requirePermissionApi, AccessContext
lib/rbac/branch-visibility.ts               # branchVisibilityFilter (Pilar 4)
lib/rbac/require-role.ts                    # requireRoleApi (legacy, sigue como base)
lib/rbac/permissions.ts                     # PERMISSIONS matrix, hasPermission, Role/Resource/Action
lib/permissions.ts                          # ROLES_HIERARCHY, canManageRole  (¡ojo: difiere de rbac/permissions.ts!)
lib/tenant-context.ts                       # getCurrentTenant/requireTenant (lo que usan hoy las rutas finance)
```

### Patrón de guard para migrar rutas (Track B Task 1)
```ts
// ANTES (app/api/finance/cash-flow/route.ts)
const tenant = await requireTenant();
if (!tenant.id) throw ApiError.badRequest("No hay empresa seleccionada.");
// ...usa tenant.id como companyId

// DESPUÉS
import { requirePermissionApi } from "@/lib/rbac/abac";
const { ctx, decision } = await requirePermissionApi("reports", "read", {
  classification: "FINANCIAL",
});
const companyId = ctx.userCompanyId;            // ≡ tenant.id anterior
// opcional: comparar con cookie branch si la ruta la usa
```

### Patrón de Inngest function para engines (Track A refresco)
Copia de `lib/inngest/functions/recalculate-executive-twin.ts` (Sprint 1 Task 6).
Un Inngest `refresh-engines` con cron `0 */6 * * *` que por cada company
llame `engine.refresh(companyId)` para los 5 engines — cada uno en su `step.run`
para aislamiento de fallos.

---

## 8. Primer comando del próximo agente

```bash
cd C:/Users/david/pulso29
git log --oneline -15                 # confirmar que Sprint Sec-0 + Sprint 1 están commiteados
npx tsc --noEmit && echo "tsc OK"     # baseline limpio
cat tasks/todo.md | grep -A20 "Checkpoint: Sprint 1"  # ver el estado
pnpm db:migrate                        # ⚠️ aplicar 0028 + 0029 ANTES de validar nada que lea columnas nuevas
```

Si `db:migrate` falla (credenciales Neon, etc.), documenta el bloqueo y arranca
con Track A Task 1 (OperationsEngine) que no depende de columnas nuevas — sólo
de servicios existentes y `EngineOutput` (puro tipo).

** Bienvenido. Empieza por Track B Task 1 si quieres cerrar la deuda de
seguridad antes; empieza por Track A Task 1 si quieres ver valor ejecutivo
rápido. Ambos son válidos. **