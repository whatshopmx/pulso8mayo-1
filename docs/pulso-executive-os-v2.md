# Pulso Executive OS — Plan de Implementación v2

> **Versión corregida y contrastada contra el código real.**
>
> La v1 (`pulso-executive-os-plan.md`) subestimaba lo construido (CEO Dashboard ya existe, 24 funciones Inngest no 11, CrossBranchService con 8 agregadores cacheados) y trataba los 8 Intelligence Engines como construcciones desde cero cuando la mayoría deben ser **fachadas de orquestación** sobre servicios vivos. Este documento corrige el inventario, rebalancea los sprints y añade los riesgos de migración brownfield que la v1 omitía.

---

## Índice

1. [Resumen Ejecutivo](#1-resumen-ejecutivo)
2. [Inventario Real de lo Construido](#2-inventario-real-de-lo-construido)
3. [Principio Rector: Engines como Orquestación, no Recálculo](#3-principio-rector)
4. [Gap Analysis: Lo que Realmente Falta](#4-gap-analysis)
5. [Roadmap por Sprints (rebalanceado)](#5-roadmap-por-sprints)
6. [Sprint 1 — Foundation](#6-sprint-1--foundation)
7. [Sprint 2 — Intelligence Engines I (facade layer)](#7-sprint-2--intelligence-engines-i)
8. [Sprint 3 — Intelligence Engines II + Morning Brief + AI](#8-sprint-3--intelligence-engines-ii--morning-brief--ai)
9. [Sprint 4 — Executive Experience (recortado)](#9-sprint-4--executive-experience)
10. [Sprint 5 — Business Model & Tiering](#10-sprint-5--business-model--tiering)
11. [Sprint 6 — Professional Services](#11-sprint-6--professional-services)
12. [Arquitectura Objetivo](#12-arquitectura-objetivo)
13. [Riesgos y Mitigaciones](#13-riesgos-y-mitigaciones)
14. [Métricas de Éxito](#14-métricas-de-éxito)
15. [Apéndice: Mapeo Real Existente → Nuevo](#15-apéndice-mapeo-real)

---

## 1. Resumen Ejecutivo

### La tesis (sin cambios — es correcta)

Pulso es una **capa de inteligencia ejecutiva** que vive encima de todos los sistemas operativos del grupo restaurantero. No compite con ERPs, checklists o POS — compite contra el costo de construir un equipo ejecutivo de alto nivel.

```
               OWNER / CEO
                    │
        Executive Intelligence Layer   ← PULSO EXECUTIVE OS
                    │
────────────────────────────────────────
Operations Twin  │  Finance Twin  │  People Twin  │  ...
────────────────────────────────────────
Events · Evidence · External Systems
────────────────────────────────────────
POS · WhatsApp · Inventory · Photos · Accounting · Bank · Payroll
```

### Corrección al diagnóstico de la v1

| Afirmación v1 | Realidad verificada en código |
|---|---|
| "~40% de la capa de inteligencia" | **Subestimado.** Existen `ExecutiveReportService` (9 KPIs financieros por sucursal), `analytics-service.getExecutiveSummary` (ExecutiveSummaryData con alerts, branch overview, cost trends, compliance), `CrossBranchService` (8 agregadores con `unstable_cache` 5min TTL), `ForecastService.calculateAll`, `insight-generator-service` (5 tipos de insight), `BenchmarkingInsights` UI. La capa de inteligencia está ~55-60% construida, fragmentada. |
| "CEO Dashboard — NUEVO (Sprint 4)" | **Ya existe** `app/dashboard/executive/page.tsx` con 6 componentes ejecutivos funcionando. |
| "11 cron jobs de Inngest" | **24 archivos** en `lib/inngest/functions/`, **18 con `cron:`**. |
| "Brand Intelligence — nuevo" | `BranchRanking`, `BenchmarkingInsights`, `CrossBranchService.getBenchmarking` ya lo hacen. Es **reuso + normalización**, no nuevo. |
| "Unificar Event Bus con domain events existentes" | `domain-event-service.ts` usa `eventType: string` libre; **no existe** el tipo union `DomainEventType`. La acción correcta es **introducirlo y migrar emisores**, no "extender". |

### Lo que realmente falta (verificado)

- ❌ **Executive Twin enriquecido** — `corporateTwins` solo tiene `healthScore`, `driftScore`, `marginLeakageScore`, `networkState`. Faltan +12 dimensiones ejecutivas.
- ❌ **Capa de orquestación de los 8 engines** — los servicios existen pero **no hay un contrato unificado** (`IntelligenceEngine` interface) ni un consolidador de outputs.
- ❌ **Morning Brief Generator** — no existe; pero `weekly-insights.ts` ya prueba el patrón cron 7AM + WhatsApp.
- ❌ **AI Reasoning Layer** — `IntelligenceService` tiene **un solo método** (`answerQuestion`), keyword-matching. Sin razonamiento causal.
- ❌ **Priority & Recommendation Engine** — no existe consolidador de prioridades.
- ❌ **Decision Feed** + **Morning Brief UI** — no existen como componentes.
- ❌ **Tiering/Business Model** — no existe `subscription.ts` ni `tier-service.ts`.
- ❌ **Professional Services workflows** — no existen.

---

## 2. Inventario Real de lo Construido

### 2.1 Schema (verificado con `codegraph_node`)

| Tabla | Archivo | Estado |
|---|---|---|
| `companies` | `lib/db/schema/core.ts` | ✅ Listo (RestaurantGroup aggregate root) |
| `branches` | `lib/db/schema/core.ts` | ✅ Listo (Location aggregate) |
| `operationalTwins` | `lib/db/schema/operational-twin.ts` | ✅ Listo (9 dimensiones) |
| `corporateTwins` | `lib/db/schema/operational-twin.ts:44` | ⚠️ **Solo 4 campos** — necesita enriquecerse |
| `domainEvents` | `lib/db/schema` | ✅ Listo (ledger inmutable) |
| `workflowInstances/Assignments/Templates` | `lib/db/schema` | ✅ Listo |
| `inventoryItems/Movements/Alerts` | `lib/db/schema` | ✅ Listo |
| `shiftSessions/Templates` | `lib/db/schema` | ✅ Listo |
| `incidents` | `lib/db/schema` | ✅ Listo |
| `kpiDefinitions/Values/Alerts` | `lib/db/schema` | ✅ Listo |
| `salesEntries/Uploads`, `expenses`, `pettyCashEntries` | `lib/db/schema` | ✅ Listo |
| `purchaseOrders`, `suppliers` | `lib/db/schema` | ✅ Listo |
| `equipment`, `maintenanceLogs` | `lib/db/schema/equipment.ts` | ✅ Listo |
| `recipes`, `productionResults/Ingredients` | `lib/db/schema` | ✅ Listo |
| `temperatureLogs` | `lib/db/schema` | ✅ Listo |
| `tenantConfig`, `tenantOperatingConfig` | `lib/db/schema` | ✅ Listo |
| `subscriptionTiers`, `companySubscriptions` | — | ❌ **No existen** (Sprint 5) |

### 2.2 Servicios existentes (84 archivos en `lib/services/` — verificado)

**Core / Twins:**
- `operational-twin-engine.ts` — exporta `recalculateTwin(branchId)` y `recalculateCorporateTwin(companyId)` (este último **solo invoca `db`**, sin lógica de motor — callees verificados: 1, `db`)
- `domain-event-service.ts` — `emitDomainEvent({ companyId, branchId, eventType: string, payload })`. Persiste a `domainEvents` + envía `domain/event.emitted` a Inngest.
- `tenant-config-service.ts` + `tenant-operating-config-service.ts`

**Intelligence (fragmentada — reusar, no recalcular):**
- `executive-report-service.ts` — `ExecutiveReportService.getReport()` + 9 cálculos privados: `calcRevenue`, `calcCOGS`, `getRecipeCost`, `calcEndStockValue`, `calcWasteTotal`, `calcFillRate`, `calcCountAccuracy`…
- `intelligence-service.ts` — **clase con 1 método** `answerQuestion({ question, companyId, branchId? })`
- `insight-generator-service.ts` — tipos `FOOD_COST_CHANGE | WASTE_SPIKE | PRICE_INCREASE | STOCKOUT_RISK | CONSUMPTION_TREND`
- `forecast-service.ts` — `ForecastService.calculate` + `calculateAll(companyId)` (WMA, simple average)
- `knowledge-service.ts` — Knowledge graph de inventario
- `predictive-scoring-service.ts`
- `analytics-service.ts` — `getExecutiveSummary` devuelve `ExecutiveSummaryData` con `alerts`, `branchOverview`, `costTrends`, `compliance`
- `kpi-service.ts` + `kpi-calculator.ts`
- `financial-kpi-service.ts` — `calculateFinancialKPIs(filter)`
- `cross-branch-service.ts` — **8 agregadores con `unstable_cache` 5min TTL**: `getAllBranchesCompliance`, `getAllBranchesMerma`, `getAllBranchesIncidentesActivos`, `getAllBranchesLaborMetrics`, `getDocumentExpirations`, `getComplianceTrend`, `getBenchmarking`, más `getAllBranches`

**Operations / Finance / Notifications:** (84 en total — lista completa en v1, verificada como correcta)

### 2.3 Inngest (24 funciones, 18 con cron — verificado)

- `operational-twin.ts` — **dos handlers clave** que cualquier refactor del Corporate Twin debe preservar:
  - `processDomainEvent` (trigger `domain/event.emitted`) → llama `recalculateTwin(branchId)` + envía `corporate/twin.recalculate`
  - `processCorporateTwinUpdate` (trigger `corporate/twin.recalculate`) → llama `recalculateCorporateTwin(companyId)`
- `weekly-insights.ts` — **cron `0 7 * * 1`** (lunes 7AM). Patrón de referencia para el Morning Brief diario.
- 16 crons adicionales: `cron-execute-schedules`, `cron-check-overdue`, `cron-inventory-checks`, `cron-compliance-alerts`, `cron-stock-check`, `cron-kpi-snapshots`, `cron-forecast-calculation`, `cron-scheduled-reports`, `cron-document-expiration-check`, `cron-break-reminders`, `cron-workflow-reminders`, `cron-overdue-workflows`, `cron-sales-cut-reminder`, `check-financial-alerts`, `cron-advanced-alerts`, `imss-alerts`
- `incident-escalation.ts`, `labor-workflows.ts`, `workflow-executor.ts`, `announcement-broadcast.ts`

### 2.4 UI Components ejecutivos existentes (la v1 los omitió)

**`app/dashboard/executive/page.tsx` — YA IMPLEMENTADO** (Server Component con `auth.api.getSession`, redirect `/onboarding` si no hay `companyId`):
- `components/dashboard/executive/kpi-hero-cards.tsx`
- `components/dashboard/executive/branch-ranking.tsx`
- `components/dashboard/executive/alerts-panel.tsx`
- `components/dashboard/executive/predictions-panel.tsx`
- `components/dashboard/executive/benchmarking-insights.tsx`
- `components/dashboard/executive/compliance-trend-chart.tsx`
- `components/finance/pnl-branch-table.tsx` (incluido en la página)
- `components/finance/cash-flow-calendar.tsx` (existe, reutilizable para Finance Engine UI)

**Otros componentes relevantes:**
- `components/dashboard/executive-summary.tsx` + `executive-summary-cost-chart.tsx` + `daily-executions-chart.tsx`
- `components/inventory/executive-dashboard.tsx`
- `components/analytics/kpi-builder.tsx`
- `components/shared/skeletons.tsx` — `KpiCardsSkeleton`, `ChartSkeleton` (patrón de Suspense a respetar)

---

## 3. Principio Rector

> **Los 8 Intelligence Engines NO recalculan. Orquestan.**

La v1 proponía cada engine con su propio `analyze()` que lee la DB y calcula scores. Eso **duplica lógica que ya vive** en `ExecutiveReportService`, `financial-kpi-service`, `analytics-service`, `forecast-service`, `cross-branch-service`. El resultado predecible: KPIs que divergen entre el dashboard existente y los engines.

**Regla obligatoria para todo engine nuevo:**

```typescript
// ❌ MAL — recalcula desde la DB
class FinanceEngine {
  async analyze(companyId) {
    const sales = await db.select()...  // duplica sales-ingestion-service
    const cogs = await ...               // duplica executive-report-service.calcCOGS
  }
}

// ✅ BIEN — fachada que delega y normaliza
class FinanceEngine {
  async analyze(companyId): Promise<EngineOutput> {
    const [kpis, cashFlow, forecast, obligations] = await Promise.all([
      ExecutiveReportService.getReport({ companyId, period: "30d" }),
      CashFlowService.getProjection(companyId, 14),
      ForecastService.calculateAll(companyId),
      this.getUpcomingObligations(companyId),  // <- solo esto es net-new
    ]);
    return this.toEngineOutput({ kpis, cashFlow, forecast, obligations });
  }
}
```

Esto garantiza:
1. **Una sola fuente de verdad** por métrica (el servicio que ya la calcula).
2. **Cero divergencia** entre el dashboard existente y los engines.
3. **Código netamente nuevo** = solo el pegamento (`toEngineOutput`, consolidación, nuevos cálculos faltantes como `liquidityRisk`, `upcomingObligations`).
4. **Migración incremental** — un engine a la vez, sin tocar servicios vivos.

---

## 4. Gap Analysis: Lo que Realmente Falta

### 4.1 Executive Twin — de 4 campos a 10 dimensiones

```typescript
// ACTUAL (lib/db/schema/operational-twin.ts:44) — verificado
{
  healthScore,        // integer, default 100
  driftScore,         // integer, default 0
  marginLeakageScore, // integer, default 0
  networkState,       // jsonb
}

// OBJETIVO — agregar 12 columnas
{
  // existentes...
  projectedCashFlowCents,        // bigint, default 0
  liquidityRisk,                 // integer 0-100
  upcomingObligationsCents,      // bigint, default 0
  operationalRisk,               // integer 0-100
  complianceRisk,                // integer 0-100
  peopleRisk,                    // integer 0-100
  expansionReadiness,            // integer 0-100
  executionCapacity,             // integer 0-100
  brandConsistency,              // integer 0-100
  knowledgeIndex,                // integer 0-100
  playbookCount,                 // integer
  bestPracticesCount,            // integer
  executiveState,                // jsonb
}
```

### 4.2 8 Engines — clasificados por esfuerzo real

| Engine | Servicios existentes a delegar | Esfuerzo neto |
|---|---|---|
| **Operations** | `operational-twin-engine`, `cross-branch-service` (compliance/incidentes/labor), `analytics-service` | **Bajo** — fachada |
| **Finance** | `executive-report-service`, `cash-flow-service`, `pnl-service`, `financial-kpi-service`, `forecast-service` | **Bajo** — fachada + nuevo `upcomingObligations`, `liquidityRisk` |
| **Procurement** | `suggested-order-service`, `purchase-order-service`, `stock-alert-service` | **Medio** — falta `transferRecommendations`, `wastePatterns` (usar `inventoryWaste` de CrossBranch) |
| **Workforce** | `shift-service*`, `labor-calculator`, `overtime-alert-service`, `break-management-service`, `cross-branch-service.getAllBranchesLaborMetrics` | **Medio** — falta `burnoutRisk`, `retentionRisk` |
| **Brand** | `branch-ranking.tsx`, `benchmarking-insights.tsx`, `CrossBranchService.getBenchmarking`, `recipe-service`, `compliance-alert-service` | **Bajo** — normalizar a `EngineOutput` |
| **Compliance** | `ComplianceReportService`, `compliance-alert-service`, `civil-protection-service`, `employee-document-service`, `cross-branch-service.getDocumentExpirations` | **Bajo** — fachada |
| **Maintenance** | `equipment-service` | **Alto** — falta `failurePrediction`, `repairPriority` (sin data histórica suficiente hoy) |
| **Knowledge** | `knowledge-service`, `insight-generator-service`, `cross-branch-service` | **Alto** — playbooks/lessons learned son net-new |

### 4.3 Morning Brief — no existe, pero el patrón sí

`weekly-insights.ts` (cron `0 7 * * 1`) ya demuestra: cron 7AM + agregación + entrega. El Morning Brief **diario** es replicar ese patrón con los 8 engines como input.

### 4.4 AI Layer — de 1 método a razonamiento

`IntelligenceService.answerQuestion` (único método). Objetivo: añadir `reasonAbout({ question, companyId })` que carga Executive Twin + outputs de los 8 engines y usa function calling para análisis causal.

### 4.5 Tiering + Professional Services — no existen (confirmado)

`lib/services/tier-service.ts` y `lib/db/schema/subscription.ts` ausentes. `lib/services/assessment-service.ts` ausente.

---

## 5. Roadmap por Sprints

```
Sprint 1 (2-3 sem)  FOUNDATION
├── Migración segura de corporateTwins (+12 cols) ← db:generate + migrate, NO push
├── ExecutiveTwinEngine (extiende, NO reemplaza — preserva callers de Inngest)
├── Introducir tipo union DomainEventType + migrar emisores
├── IntelligenceEngine interface + EngineOutput/Priority/Risk
└── evidence-store.ts (unificar evidencia dispersa)

Sprint 2 (3-4 sem)  ENGINES I (fachadas — bajo esfuerzo)
├── OperationsEngine  (delega cross-branch + analytics)
├── FinanceEngine     (delega executive-report + cashflow + forecast)
├── BrandEngine       (delega cross-branch.getBenchmarking + branch-ranking)
├── ComplianceEngine  (delega ComplianceReportService + getDocumentExpirations)
└── ProcurementEngine (delega + nuevo transfer/waste)

Sprint 3 (3-4 sem)  ENGINES II + MORNING BRIEF + AI
├── WorkforceEngine
├── MaintenanceEngine (con escopo reducido — sin failurePrediction hasta tener data)
├── KnowledgeEngine (con escopo reducido — playbooks manuales primero)
├── PriorityEngine (consolidador)
├── MorningBriefGenerator (cron 0 7 * * * — replica weekly-insights)
└── IntelligenceService.reasonAbout (causal)

Sprint 4 (1-2 sem)  EXECUTIVE EXPERIENCE — RECORTADO
├── Morning Brief UI component (nuevo)
├── Decision Feed component (nuevo)
├── Executive Twin card integrado al dashboard existente
└── API /api/executive/* (twin, brief, priorities, cashflow, reason, feed)
    (NO recrear /dashboard/executive — YA EXISTE)

Sprint 5 (2-3 sem)  BUSINESS MODEL
├── subscription.ts schema
├── tier-service.ts + feature flags
├── Billing integration
└── Tier migration flow

Sprint 6 (2-3 sem)  PROFESSIONAL SERVICES
├── assessment-service.ts
├── templates/professional-services/*
└── Digital Twin Onboarding wizard (extiende tenant-operating-config-service)
```

**Cambio clave vs v1:** Sprint 4 pasa de "2-3 semanas construyendo CEO Dashboard" a "1-2 semanas añadiendo 2 componentes + API", porque el dashboard ya vive.

---

## 6. Sprint 1 — Foundation

### 6.1 Migración segura de `corporateTwins` (+12 columnas)

**Archivo:** `lib/db/schema/operational-twin.ts` (modificar el bloque que empieza en línea 44)

```typescript
export const corporateTwins = pgTable("corporate_twins", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  companyId: uuid("company_id").notNull().references(() => companies.id),

  // --- EXISTENTES (no tocar) ---
  healthScore: integer("health_score").default(100).notNull(),
  driftScore: integer("drift_score").default(0).notNull(),
  marginLeakageScore: integer("margin_leakage_score").default(0).notNull(),
  networkState: jsonb("network_state").default(sql`'{}'::jsonb`).notNull(),

  // --- NUEVOS: Executive Dimensions ---
  projectedCashFlowCents: bigint("projected_cash_flow_cents", { mode: "number" }).default(0).notNull(),
  liquidityRisk: integer("liquidity_risk").default(0).notNull(),
  upcomingObligationsCents: bigint("upcoming_obligations_cents", { mode: "number" }).default(0).notNull(),
  operationalRisk: integer("operational_risk").default(0).notNull(),
  complianceRisk: integer("compliance_risk").default(0).notNull(),
  peopleRisk: integer("people_risk").default(0).notNull(),
  expansionReadiness: integer("expansion_readiness").default(0).notNull(),
  executionCapacity: integer("execution_capacity").default(0).notNull(),
  brandConsistency: integer("brand_consistency").default(0).notNull(),
  knowledgeIndex: integer("knowledge_index").default(0).notNull(),
  playbookCount: integer("playbook_count").default(0).notNull(),
  bestPracticesCount: integer("best_practices_count").default(0).notNull(),
  executiveState: jsonb("executive_state").default(sql`'{}'::jsonb`).notNull(),

  lastUpdated: timestamp("last_updated").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  uniqueCompanyTwin: uniqueIndex("unique_company_twin").on(table.companyId),
}));
```

### ⚠️ Procedimiento de migración (brownfield safety)

El AGENTS.md advierte: **`drizzle-kit push` puede dropear tablas**. Para añadir columnas a una tabla existente con datos:

```bash
# 1. Generar migration SQL (no push)
pnpm db:generate

# 2. Inspeccionar el SQL generado — debe ser solo ALTER TABLE ADD COLUMN
#    Si ves DROP TABLE, detente y revisa el schema diff
cat drizzle/*/0000_*.sql

# 3. Aplicar migration
pnpm db:migrate

# 4. Verificar contra .env antes (DATABASE_URL apunta a prod?)
#    Recomendado: probar en Neon branch primero
```

**NUNCA `pnpm db:push`** para esta migración.

### 6.2 ExecutiveTwinEngine — extender, NO reemplazar

**Archivo nuevo:** `lib/services/executive-twin-engine.ts`

**Constraint crítica:** `recalculateCorporateTwin` está invocada por el Inngest handler `processCorporateTwinUpdate` (trigger `corporate/twin.recalculate`) en `lib/inngest/functions/operational-twin.ts`. **No eliminar** esa función. Estrategia:

```typescript
// lib/services/executive-twin-engine.ts
export class ExecutiveTwinEngine {
  static async recalculate(companyId: string) {
    // 1. Leer todos los operationalTwins de las branches
    // 2. Delegar a servicios existentes:
    //    - cross-branch-service.getAllBranchesCompliance → complianceRisk
    //    - cross-branch-service.getAllBranchesIncidentesActivos → operationalRisk
    //    - cross-branch-service.getAllBranchesLaborMetrics → peopleRisk
    //    - executive-report-service.getReport → financialHealth base
    //    - forecast-service.calculateAll → projectedCashFlow input
    // 3. Calcular net-new: liquidityRisk, upcomingObligations, expansionReadiness
    // 4. Persistir las 12 columnas nuevas (NO sobrescribir las 4 existentes
    //    salvo healthScore/driftScore que sí se recalculan)
    // 5. Emitir EXECUTIVE_TWIN_UPDATED event
  }
}
```

**Wrapper de retrocompatibilidad** en `operational-twin-engine.ts`:

```typescript
// PRESERVAR — Inngest la invoca
export async function recalculateCorporateTwin(companyId: string): Promise<any> {
  return ExecutiveTwinEngine.recalculate(companyId);
}
```

### 6.3 Introducir `DomainEventType` (no "extender")

**Archivo:** `lib/services/domain-event-service.ts`

La v1 decía "extender" pero **no existe** el tipo. Es **introducción + migración**:

```typescript
export type DomainEventType =
  // Existentes (auditar emisores actuales y normalizar)
  | 'WORKFLOW_COMPLETED' | 'WORKFLOW_OVERDUE' | 'WORKFLOW_ASSIGNED'
  | 'INCIDENT_CREATED' | 'INCIDENT_RESOLVED' | 'INCIDENT_ESCALATED'
  | 'STOCK_LOW' | 'STOCK_CRITICAL' | 'WASTE_DETECTED'
  | 'PURCHASE_ORDER_CREATED' | 'RECEPTION_COMPLETED'
  | 'SHIFT_STARTED' | 'SHIFT_COMPLETED' | 'NO_SHOW'
  | 'OVERTIME_THRESHOLD' | 'ATTENDANCE_ISSUE'
  | 'SALE_RECORDED' | 'EXPENSE_RECORDED' | 'PAYMENT_EXECUTED'
  | 'CASH_FLOW_UPDATED' | 'BUDGET_EXCEEDED'
  | 'COMPLIANCE_SCORE_CHANGED' | 'DOCUMENT_EXPIRING' | 'AUDIT_DUE'
  // Nuevos — Executive layer
  | 'EXECUTIVE_TWIN_UPDATED' | 'MORNING_BRIEF_GENERATED'
  | 'RISK_THRESHOLD_BREACHED' | 'EXPANSION_OPPORTUNITY';

export interface EmitDomainEventInput {
  companyId: string;
  branchId: string;
  eventType: DomainEventType;  // <- antes: string
  payload: Record<string, any>;
}
```

**Migración:** auditar todos los `emitDomainEvent({` call sites (codegraph_callers) y restringir strings al union. Fase de compat: aceptar `string` con warning durante 1 sprint, luego forzar.

### 6.4 Evidence Store unificado

**Archivo nuevo:** `lib/services/evidence-store.ts` — unifica evidencia de workflows + incidentes + document uploads. Agrega metadatos AI (transcripción, clasificación, verificación) y cross-reference con `domainEvents`. Net-new.

### 6.5 Interfaces base de los 8 Engines

**Archivo nuevo:** `lib/services/intelligence/engine-interface.ts`

```typescript
export interface IntelligenceEngine<TInput, TOutput extends EngineOutput> {
  readonly engineId: string;
  readonly engineName: string;
  analyze(input: TInput): Promise<TOutput>;
  getLatest(companyId: string): Promise<TOutput | null>;
  refresh(companyId: string): Promise<TOutput>;
}

export interface EngineOutput {
  score: number;           // 0-100
  confidence: number;      // 0-100
  insights: string[];
  priorities: Priority[];
  risks: Risk[];
  generatedAt: Date;
}

export interface Priority {
  id: string;
  title: string;
  description: string;
  impact: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  estimatedSavingsCents?: number;
  actionUrl?: string;
  deadline?: Date;
}

export interface Risk {
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  probability: number;     // 0-1
  impactCents: number;
  mitigation: string;
}
```

**Persistencia de outputs:** tabla nueva `engine_outputs` (companyId, engineId, output jsonb, generatedAt) o reutilizar `executiveState` jsonb en `corporateTwins`. Recomendado: tabla separada para histórico.

---

## 7. Sprint 2 — Intelligence Engines I

### 7.1 OperationsEngine

**Archivo nuevo:** `lib/services/intelligence/operations-engine.ts`

**Delega (no recalcula):**
- `CrossBranchService.getAllBranchesCompliance` → executionCapacity, completion rates
- `CrossBranchService.getAllBranchesIncidentesActivos` → operationalRisk
- `analytics-service.getExecutiveSummary` → alerts, branchOverview
- `operational-twin-engine.recalculateTwin` (per branch) → health/drift

**Net-new:** `BenchmarkComparison` estructurado (ya existe en UI, normalizar a `EngineOutput`).

### 7.2 FinanceEngine

**Archivo nuevo:** `lib/services/intelligence/finance-engine.ts`

**Delega:**
- `ExecutiveReportService.getReport` → food cost, COGS, revenue, shrinkage, fill rate
- `CashFlowService.getProjection(companyId, 14)` → projectedCashFlow
- `ForecastService.calculateAll` → demanda proyectada
- `financial-kpi-service.calculateFinancialKPIs` → KPIs financieros
- `pnl-service` → P&L consolidado

**Net-new (cálculos ausentes hoy):**
- `getUpcomingObligations(companyId)` — nómina, proveedores, rentas, servicios, impuestos
- `liquidityRisk` score — upcoming obligations / available cash
- `RecommendedPayments` — priorización

### 7.3 BrandEngine

**Archivo nuevo:** `lib/services/intelligence/brand-engine.ts`

**Delega (la v1 decía "nuevo" — es reuso):**
- `CrossBranchService.getBenchmarking` → MetricRanking por dimensión
- `BranchRanking` component data → store ranking
- `CrossBranchService.getAllBranchesCompliance` → brand consistency base
- `recipe-service` → standard compliance
- `compliance-alert-service` → quality checks

**Net-new:** `BrandDrift` (desviación estándar de quality scores entre sucursales), `BestPracticeReference` (sucursal ejemplar por área).

### 7.4 ComplianceEngine

**Archivo nuevo:** `lib/services/intelligence/compliance-engine.ts`

**Delega:**
- `ComplianceReportService` → NOM-251, NOM-035, LFT, IMSS
- `compliance-alert-service` → alerts activos
- `civil-protection-service` → protección civil
- `employee-document-service` → documentos
- `CrossBranchService.getDocumentExpirations` → expiring docs

**Net-new:** `InspectionReadiness` score, `RegulatoryCalendar`.

### 7.5 ProcurementEngine

**Archivo nuevo:** `lib/services/intelligence/procurement-engine.ts`

**Delega:**
- `suggested-order-service` → purchase recommendations
- `purchase-order-service` → POs activos
- `stock-alert-service` → shortage risks
- `CrossBranchService.getAllBranchesMerma` → waste patterns (la data ya está aggregada)

**Net-new:** `TransferRecommendations` (mover stock entre sucursales — requiere comparar inventario cross-branch), `NegotiationOpportunities` (volumen por proveedor).

---

## 8. Sprint 3 — Intelligence Engines II + Morning Brief + AI

### 8.1 WorkforceEngine

**Delega:** `shift-service*` (6 servicios), `labor-calculator`, `overtime-alert-service`, `break-management-service`, `CrossBranchService.getAllBranchesLaborMetrics`.

**Net-new:** `BurnoutRisk` (horas extra acumuladas + días sin descanso), `RetentionRisk` (rotación histórica por sucursal), `TrainingNeeds` (gaps de docs).

### 8.2 MaintenanceEngine — escopo reducido

**Delega:** `equipment-service`, `maintenanceLogs`, `temperatureLogs`, `productionResults`.

**⚠️ Escopo realista:** `FailurePrediction` requiere data histórica suficiente de fallas. **Hoy no la hay.** Sprint 3 entrega solo `PreventiveSchedule` (basado en intervalos manuales) + `RepairPriority` (basado en incidentes activos). `FailurePrediction` pospuesto a Sprint 7+ cuando haya telemetría suficiente.

### 8.3 KnowledgeEngine — escopo reducido

**Delega:** `knowledge-service`, `insight-generator-service` (5 tipos de insight), `CrossBranchService`.

**⚠️ Escopo realista:** playbooks auto-generados + lessons learned automáticos requieren NLP sobre incidentes resueltos. **Sprint 3 entrega playbooks manuales** (CRUD) + insights existentes normalizados a `EngineOutput`. `AutoSOPUpdates` pospuesto.

### 8.4 PriorityEngine (consolidador)

**Archivo nuevo:** `lib/services/priority-engine.ts`

```typescript
export class PriorityEngine {
  static async calculatePriorities(companyId: string): Promise<PrioritizedAction[]> {
    // 1. Recolectar priorities+risks de los 8 engines (getLatest)
    // 2. Normalizar impacto financiero a cents
    // 3. Score = urgencia × impacto × probabilidad
    // 4. Top 10 con justificación + actionUrl
  }

  static async compareDecisions(
    companyId: string,
    decisions: DecisionOption[]
  ): Promise<DecisionAnalysis> {}
}
```

### 8.5 MorningBriefGenerator

**Archivo nuevo:** `lib/services/morning-brief-generator.ts` + `lib/inngest/functions/generate-morning-brief.ts`

**Patrón de referencia:** `lib/inngest/functions/weekly-insights.ts` (cron `0 7 * * 1`) ya prueba cron 7AM + agregación + entrega WhatsApp.

```typescript
// lib/inngest/functions/generate-morning-brief.ts
export const generateMorningBrief = inngest.createFunction(
  { id: "generate-morning-brief", cron: "0 7 * * *" },  // diario 7AM
  async ({ event, step }) => {
    // 1. step.run: ExecutiveTwinEngine.recalculate(companyId)
    // 2. step.run: refresh 8 engines (Promise.all)
    // 3. step.run: PriorityEngine.calculatePriorities(companyId)
    // 4. step.ai: generar brief en español con contexto estructurado
    // 5. step.run: persistir morning_briefs table (nueva)
    // 6. step.run: enviar WhatsApp + Email + In-App (replicar weekly-insights delivery)
  }
);
```

**Tabla nueva:** `morning_briefs` (id, companyId, brief jsonb, generatedAt, deliveredAt).

### 8.6 IntelligenceService.reasonAbout — extender, no reescribir

**Archivo:** `lib/services/intelligence-service.ts` (añadir método, **preservar** `answerQuestion` para compat)

```typescript
export class IntelligenceService {
  // EXISTENTE — preservar
  static async answerQuestion(params): Promise<InsightAnswer> { ... }

  // NUEVO
  static async reasonAbout(params: {
    question: string;
    companyId: string;
  }): Promise<ReasoningResult> {
    // 1. Cargar ExecutiveTwin (12 dimensiones)
    // 2. Cargar getLatest() de los 8 engines
    // 3. Cargar PriorityEngine.calculatePriorities
    // 4. Prompt estructurado + function calling OpenAI
    // 5. Devolver ReasoningResult con fuentes (engineId + score)
  }
}
```

---

## 9. Sprint 4 — Executive Experience (recortado)

### 9.1 NO recrear el CEO Dashboard — ya existe

`app/dashboard/executive/page.tsx` está implementado con 6 componentes. **Sprint 4 añade, no construye desde cero:**

### 9.2 Componentes nuevos

- `components/dashboard/morning-brief.tsx` — render del brief del día con KPIs ejecutivos + prioridades accionables (con `actionUrl`) + resumen del día anterior. Suspense con `KpiCardsSkeleton`.
- `components/dashboard/decision-feed.tsx` — feed cronológico de aprobaciones pendientes, alertas críticas no resueltas, recomendaciones de engines, cambios significativos en KPIs.
- `components/dashboard/executive-twin-card.tsx` — tarjeta con las 12 dimensiones (puede integrarse en `kpi-hero-cards.tsx` o ser sección nueva).

### 9.3 Integración al dashboard existente

Modificar `app/dashboard/executive/page.tsx` para añadir secciones:
- Sección 0: `<MorningBrief companyId={companyId} />` (arriba del todo)
- Sección nueva: `<DecisionFeed companyId={companyId} />`
- Ampliar `kpi-hero-cards.tsx` con dimensiones ejecutivas del Executive Twin

### 9.4 API Routes

```
GET  /api/executive/twin           → Executive Twin completo (12 dims)
GET  /api/executive/brief/latest   → Último Morning Brief
GET  /api/executive/brief/history  → Historial de briefs
GET  /api/executive/priorities     → PriorityEngine output
GET  /api/executive/cashflow       → FinanceEngine projected cash flow
POST /api/executive/reason         → IntelligenceService.reasonAbout
GET  /api/executive/feed           → Decision Feed items
POST /api/executive/refresh        → Forzar refresh de los 8 engines
```

**Patrón de referencia:** `app/api/inventory/reports/executive/route.ts` (mismo estilo de route handler con auth + companyId + cache).

---

## 10. Sprint 5 — Business Model & Tiering

### 10.1 Schema

**Archivo nuevo:** `lib/db/schema/subscription.ts`

```typescript
export const subscriptionTiers = pgTable("subscription_tiers", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  monthlyPriceCents: integer("monthly_price_cents").notNull(),
  maxBranches: integer("max_branches").notNull(),
  features: jsonb("features").default(sql`'[]'::jsonb`).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  active: boolean("active").default(true).notNull(),
});

export const companySubscriptions = pgTable("company_subscriptions", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  tierId: uuid("tier_id").notNull().references(() => subscriptionTiers.id),
  status: text("status").default("ACTIVE").notNull(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
  autoRenew: boolean("auto_renew").default(true).notNull(),
});
```

Exportar en `lib/db/schema/index.ts`.

### 10.2 TierService + feature flags

**Archivo nuevo:** `lib/services/tier-service.ts`

```typescript
export const TIER_FEATURES = {
  FOUNDATION: ['operational_twin','workflows','evidence_store','dashboard','alerts','morning_brief','basic_ai'],
  GROWTH: [/* Foundation + */ 'executive_twin','cash_flow_intelligence','brand_intelligence','procurement_intelligence','knowledge_engine','benchmarking','auto_recommendations'],
  EXECUTIVE: [/* Growth + */ 'full_executive_committee','risk_prediction','financial_planning','expansion_simulations','api_access','erp_integrations','ai_copilot','weekly_executive_meeting'],
} as const;

export class TierService {
  static async getCompanyTier(companyId): Promise<Tier>
  static async hasFeature(companyId, feature): Promise<boolean>  // gate UI/API
  static async upgrade(companyId, tierSlug): Promise<void>
}
```

**Aplicación de gates:** envolver las nuevas API routes (`/api/executive/*`) y componentes con `TierService.hasFeature` checks.

---

## 11. Sprint 6 — Professional Services

### 11.1 Workflows de servicios profesionales

```
templates/professional-services/
├── executive-assessment.json
├── os-design.json
├── digital-twin-onboarding.json
└── executive-success.json
```

### 11.2 AssessmentService

**Archivo nuevo:** `lib/services/assessment-service.ts`

```typescript
export class AssessmentService {
  static async startAssessment(companyId: string): Promise<Assessment>
  static async evaluateBranch(branchId: string): Promise<BranchDiagnostic>
  static async generateReport(assessmentId: string): Promise<AssessmentReport>
}
```

`BranchDiagnostic` reusa `CrossBranchService.getAllBranches*` para los quick wins.

### 11.3 Digital Twin Onboarding Wizard

**Extender** `tenant-operating-config-service.ts` (no reemplazar). Pasos: POS → bancos → contabilidad → nómina → inventario → WhatsApp → (futuro) sensores IoT.

---

## 12. Arquitectura Objetivo

### Estructura de archivos (delta vs actual)

```
lib/
├── services/
│   ├── intelligence/                    # NUEVO
│   │   ├── engine-interface.ts
│   │   ├── operations-engine.ts         # fachada → cross-branch + analytics
│   │   ├── finance-engine.ts            # fachada → executive-report + cashflow + forecast
│   │   ├── procurement-engine.ts        # fachada + transfer/waste net-new
│   │   ├── workforce-engine.ts          # fachada → shift* + labor-calculator
│   │   ├── brand-engine.ts              # fachada → cross-branch.getBenchmarking
│   │   ├── compliance-engine.ts         # fachada → ComplianceReportService
│   │   ├── maintenance-engine.ts        # fachada → equipment-service (escopo reducido)
│   │   └── knowledge-engine.ts          # fachada → knowledge + insights (escopo reducido)
│   ├── executive-twin-engine.ts         # NUEVO (recalculateCorporateTwin = wrapper)
│   ├── morning-brief-generator.ts       # NUEVO
│   ├── priority-engine.ts               # NUEVO (consolidador)
│   ├── evidence-store.ts                # NUEVO
│   ├── tier-service.ts                  # NUEVO
│   ├── assessment-service.ts            # NUEVO
│   ├── operational-twin-engine.ts       # EXISTE — wrapper retrocompat
│   ├── intelligence-service.ts          # EXISTE — añadir reasonAbout
│   └── ... (84 servicios — sin tocar)

lib/db/schema/
├── operational-twin.ts                  # MODIFICAR (+12 cols, migrate no push)
├── subscription.ts                      # NUEVO
├── morning-briefs.ts                    # NUEVO (tabla briefs)
├── engine-outputs.ts                    # NUEVO (histórico de engines)
└── index.ts                             # MODIFICAR (exportar nuevos)

lib/inngest/functions/
├── generate-morning-brief.ts            # NUEVO (cron 0 7 * * * — replica weekly-insights)
├── run-intelligence-engines.ts          # NUEVO (orquestador horario)
├── operational-twin.ts                  # EXISTE — PRESERVAR (invoca recalculateCorporateTwin)
└── ... (24 funciones — sin tocar)

app/
├── api/executive/                       # NUEVO
│   ├── twin/route.ts
│   ├── brief/route.ts
│   ├── priorities/route.ts
│   ├── cashflow/route.ts
│   ├── reason/route.ts
│   ├── feed/route.ts
│   └── refresh/route.ts
├── dashboard/executive/page.tsx         # EXISTE — añadir secciones MorningBrief + DecisionFeed
└── ...

components/dashboard/
├── morning-brief.tsx                    # NUEVO
├── decision-feed.tsx                    # NUEVO
├── executive-twin-card.tsx              # NUEVO
├── executive/                           # EXISTE (6 componentes) — sin tocar
└── ...
```

### Data Flow

```
┌─────────────────────────────────────────────────────────┐
│  EVENT BUS (domainEvents + DomainEventType union)        │
│  Emisores migrados a union; EXECUTIVE_TWIN_UPDATED nuevo │
└────────────────────┬────────────────────────────────────┘
                     │ domain/event.emitted
                     ▼
┌─────────────────────────────────────────────────────────┐
│  INNGEST (24 funcs existentes + 2 nuevas)                │
│  operational-twin.ts: recalculateTwin → corporate/...    │
│  operational-twin.ts: recalculateCorporateTwin (wrapper) │
│  generate-morning-brief.ts: cron 0 7 * * *               │
│  run-intelligence-engines.ts: cada hora                  │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  INTELLIGENCE LAYER (FACHADAS — delegan a servicios)     │
│  Operations │ Finance │ Procurement │ Workforce          │
│  Brand │ Compliance │ Maintenance │ Knowledge            │
│  Cada engine: servicios existentes → EngineOutput        │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  Priority & Recommendation Engine (consolidador)         │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  Morning Brief Generator (template + AI)                 │
│  → WhatsApp + Email + In-App (patrón weekly-insights)    │
│  → morning_briefs table                                 │
└─────────────────────────────────────────────────────────┘
```

---

## 13. Riesgos y Mitigaciones

### 13.1 Migración brownfield de schema

**Riesgo:** `drizzle-kit push` dropea tablas (advertencia explícita en AGENTS.md).
**Mitigación:** `pnpm db:generate` + inspeccionar SQL + `pnpm db:migrate`. Probar en Neon branch primero. **Nunca `push`** para añadir columnas a `corporateTwins`.

### 13.2 Ruptura de Inngest handlers

**Riesgo:** mover `recalculateCorporateTwin` a `ExecutiveTwinEngine` sin preservar la función original rompe `processCorporateTwinUpdate` (trigger `corporate/twin.recalculate`).
**Mitigación:** mantener wrapper en `operational-twin-engine.ts` que delega a `ExecutiveTwinEngine.recalculate`. Auditoría con `codegraph_callers` antes de cualquier renombrado.

### 13.3 Divergencia de KPIs

**Riesgo:** si los engines recalculan métricas que ya calculan servicios vivos (`executive-report-service`, `financial-kpi-service`), el dashboard existente y los engines mostrarán valores distintos.
**Mitigación:** Principio Rector §3 — engines son fachadas, delegan, no recalculan. Un solo fuente de verdad por métrica.

### 13.4 `DomainEventType` migration

**Riesgo:** cambiar `eventType: string` a union rompe call sites existentes con strings arbitrarios.
**Mitigación:** fase de compat — aceptar `DomainEventType | string` con warning 1 sprint, auditar con `codegraph_callers(emitDomainEvent)`, luego forzar union.

### 13.5 Maintenance & Knowledge engines sin data suficiente

**Riesgo:** `FailurePrediction` y `AutoSOPUpdates` requieren telemetría/NLP sobre data histórica que hoy no existe.
**Mitigación:** escopo reducido en Sprint 3 (PreventiveSchedule manual + playbooks CRUD). Posponer ML a Sprint 7+ con data acumulada.

### 13.6 Morning Brief a las 7AM en timezone correcto

**Riesgo:** Inngest cron `0 7 * * *` se interpreta en UTC por defecto.
**Mitigación:** configurar timezone en el cliente Inngest o usar `cron: { schedule: "0 7 * * *", timezone: "America/Mexico_City" }` (verificar soporte SDK v4). `weekly-insights.ts` ya tiene el patrón — replicar su config.

### 13.7 Performance — recalculo de 15 sucursales

**Riesgo:** métrica objetivo (<30s para 15 sucursales) puede romperse si `ExecutiveTwinEngine.recalculate` hace N queries secuenciales.
**Mitigación:** `Promise.all` sobre los delegados (CrossBranchService ya usa `unstable_cache` 5min). Cache de `engine_outputs` con TTL 15min.

---

## 14. Métricas de Éxito

### Técnicas
- [ ] Migración de `corporateTwins` aplicada sin data loss (verificar row count antes/después)
- [ ] `recalculateCorporateTwin` wrapper preserva el trigger `corporate/twin.recalculate` (test E2E Inngest)
- [ ] Executive Twin se recalcula en <30s para 15 sucursales (con `Promise.all` + cache)
- [ ] Morning Brief se genera y entrega antes de 7:05 AM America/Mexico_City
- [ ] 8 engines producen `EngineOutput` con `confidence > 80`
- [ ] `IntelligenceService.reasonAbout` responde en <10s con contexto completo
- [ ] API `/api/executive/*` responde en <500ms (cacheado)
- [ ] **Cero divergencia** entre KPIs del dashboard existente y outputs de engines (mismo servicio fuente)
- [ ] 0 regresiones en los 24 Inngest functions existentes

### Producto
- [ ] Dueño lee su Morning Brief en <2 minutos
- [ ] Prioridades incluyen `estimatedSavingsCents`
- [ ] Decision Feed muestra solo lo que requiere acción del owner
- [ ] Dashboard ejecutivo funciona en tablet y desktop (ya lo hace — mantener)
- [ ] Tiering activa/desactiva features sin deploy (`TierService.hasFeature` gate)

### Negocio
- [ ] Demo del Executive OS con datos reales del cliente
- [ ] Assessment inicial en <2 semanas
- [ ] Onboarding de sucursal nueva en <1 semana
- [ ] Migración de tier sin intervención manual

---

## 15. Apéndice: Mapeo Real

| Existente (verificado) | Acción | Nuevo/Modificado |
|---|---|---|
| `lib/db/schema/operational-twin.ts:44` (`corporateTwins`, 4 campos) | Modificar (+12 cols) | Migración `db:generate` + `migrate` |
| `lib/services/operational-twin-engine.ts:316` (`recalculateCorporateTwin`) | **Preservar como wrapper** | Delega a `executive-twin-engine.ts` |
| `lib/inngest/functions/operational-twin.ts` (`processCorporateTwinUpdate`) | **No tocar** | Sigue invocando el wrapper |
| `lib/services/domain-event-service.ts` (`eventType: string`) | Introducir union | Migrar emisores con `codegraph_callers` |
| `lib/services/intelligence-service.ts` (1 método) | Añadir `reasonAbout` | Preservar `answerQuestion` |
| `lib/services/executive-report-service.ts` (9 cálculos) | **Reusar tal cual** | FinanceEngine lo delega |
| `lib/services/financial-kpi-service.ts` | **Reusar** | FinanceEngine lo delega |
| `lib/services/forecast-service.ts` (`calculateAll`) | **Reusar** | FinanceEngine lo delega |
| `lib/services/cash-flow-service.ts` | **Reusar** | FinanceEngine lo delega |
| `lib/services/cross-branch-service.ts` (8 agregadores cacheados) | **Reusar** | Operations/Brand/Compliance/Workforce delegan |
| `lib/services/analytics-service.ts` (`getExecutiveSummary`) | **Reusar** | OperationsEngine lo delega |
| `lib/services/insight-generator-service.ts` (5 tipos) | **Reusar** | KnowledgeEngine lo delega |
| `lib/services/knowledge-service.ts` | Extender | KnowledgeEngine expande |
| `lib/inngest/functions/weekly-insights.ts` (cron `0 7 * * 1`) | **Patrón de referencia** | Replicar en `generate-morning-brief.ts` |
| `app/dashboard/executive/page.tsx` (YA EXISTE) | **Añadir secciones** | MorningBrief + DecisionFeed |
| `components/dashboard/executive/*` (6 componentes) | **No tocar** | — |
| `components/finance/cash-flow-calendar.tsx` | **Reusar** | FinanceEngine UI |
| `app/api/inventory/reports/executive/route.ts` | **Patrón de referencia** | Mismo estilo para `/api/executive/*` |

---

> **Siguiente paso recomendado:** Sprint 1 — migración de `corporateTwins` (+12 columnas) con `db:generate` + `migrate`, introducir `DomainEventType`, y crear `engine-interface.ts`. Con Sprint 1+2 se obtiene el 80% del valor ejecutivo porque los engines son fachadas sobre servicios que ya calculan casi todo.
>
> **Antes de empezar:** auditar `codegraph_callers(recalculateCorporateTwin)` y `codegraph_callers(emitDomainEvent)` para tener el mapa completo de sitios a preservar/migrar.
