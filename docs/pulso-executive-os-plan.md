# Pulso Executive OS — Plan de Implementación

> **De "software para restaurantes" a "Directorio Ejecutivo Digital"**
>
> Este documento es el puente entre la visión estratégica (`pulso-diseno-grupo-restaurantero.md`) y lo que ya está construido en el sistema. No duplica el diseño — mapea qué existe, qué falta, y cómo construirlo incrementalmente.

---

## Índice

1. [Resumen Ejecutivo](#1-resumen-ejecutivo)
2. [Inventario de lo Construido](#2-inventario-de-lo-construido)
3. [Gap Analysis: Lo que Falta](#3-gap-analysis)
4. [Roadmap por Sprints](#4-roadmap-por-sprints)
5. [Plan Detallado: Sprint 1 — Foundation](#5-sprint-1)
6. [Plan Detallado: Sprint 2 — Intelligence Engines](#6-sprint-2)
7. [Plan Detallado: Sprint 3 — AI & Morning Brief](#7-sprint-3)
8. [Plan Detallado: Sprint 4 — Executive Experience](#8-sprint-4)
9. [Plan Detallado: Sprint 5 — Business Model & Tiering](#9-sprint-5)
10. [Plan Detallado: Sprint 6 — Professional Services](#10-sprint-6)
11. [Arquitectura Objetivo](#11-arquitectura-objetivo)
12. [Métricas de Éxito](#12-métricas-de-éxito)

---

## 1. Resumen Ejecutivo

### La tesis

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

### Lo que ya existe

El sistema actual tiene ~80% de la **infraestructura de datos** y ~40% de la **capa de inteligencia**. Tenemos:

- ✅ Multi-tenant (`companies` = RestaurantGroup, `branches` = Location)
- ✅ Operational Twin por sucursal con 9 dimensiones
- ✅ Corporate Twin básico
- ✅ Event Bus (`domainEvents`)
- ✅ Workflow Engine completo con AI verification
- ✅ WhatsApp integration (Wasender)
- ✅ Inngest para cron jobs y funciones durables
- ✅ +84 servicios de negocio
- ✅ Executive Summary dashboard

### Lo que falta

- ❌ **Executive Twin enriquecido** — el Corporate Twin actual tiene 3 campos. Necesita +10 dimensiones de inteligencia ejecutiva.
- ❌ **8 Intelligence Engines unificados** — los datos están, pero fragmentados en servicios independientes.
- ❌ **Morning Brief Generator** — el producto estrella descrito en la visión.
- ❌ **AI Reasoning Layer** — pasamos de "responder preguntas" a "razonar causalmente".
- ❌ **Priority & Recommendation Engine** — traducción de datos a decisiones.
- ❌ **Executive Decision Feed** — interfaz unificada para el dueño.
- ❌ **Tiering/Business Model** — sistema de licenciamiento por nivel.

---

## 2. Inventario de lo Construido

### 2.1 Schema (tablas que ya existen)

| Tabla | Propósito | Estado |
|---|---|---|
| `companies` | RestaurantGroup aggregate root | ✅ Listo |
| `branches` | Location aggregate | ✅ Listo |
| `operational_twins` | Operational Twin por sucursal (9 dimensiones) | ✅ Listo |
| `corporate_twins` | Corporate Twin básico | ⚠️ Básico — necesita enriquecerse |
| `domain_events` | Event Bus | ✅ Listo |
| `workflow_instances`, `workflow_assignments`, `workflow_templates` | Workflow Engine | ✅ Listo |
| `inventory_items`, `inventory_movements`, `inventory_alerts` | Inventario | ✅ Listo |
| `shift_sessions`, `shift_templates` | Laboral | ✅ Listo |
| `incidents` | Incidentes | ✅ Listo |
| `kpi_definitions`, `kpi_values`, `kpi_alerts` | KPIs | ✅ Listo |
| `sales_entries`, `sales_uploads` | Ventas/POS | ✅ Listo |
| `expenses`, `petty_cash_entries` | Gastos | ✅ Listo |
| `purchase_orders`, `suppliers` | Compras | ✅ Listo |
| `equipment`, `maintenance_logs` | Equipamiento | ✅ Listo |
| `recipes`, `production_results`, `production_ingredients` | Recetas | ✅ Listo |
| `temperature_logs` | Temperaturas | ✅ Listo |
| `tenant_config`, `tenant_operating_config` | Configuración operativa | ✅ Listo |

### 2.2 Servicios existentes (84 archivos)

**Core:**
- `operational-twin-engine.ts` — Recalcula Operational Twin + Corporate Twin
- `domain-event-service.ts` — Emite y procesa domain events
- `tenant-config-service.ts` + `tenant-operating-config-service.ts` — Modelo operativo

**Intelligence (fragmentada):**
- `executive-report-service.ts` — KPIs financieros por sucursal (food cost, COGS, revenue, shrinkage, fill rate, etc.)
- `intelligence-service.ts` — Q&A con OpenAI usando datos del sistema
- `insight-generator-service.ts` — Genera insights (FOOD_COST_CHANGE, WASTE_SPIKE, PRICE_INCREASE, STOCKOUT_RISK, CONSUMPTION_TREND)
- `forecast-service.ts` — Predicción de demanda por receta (WMA, simple average)
- `knowledge-service.ts` — Knowledge graph de inventario
- `predictive-scoring-service.ts` — Scoring predictivo
- `analytics-service.ts` — Executive Summary (alerts, compliance, labor, costs)
- `kpi-service.ts` + `kpi-calculator.ts` — Definición y cálculo de KPIs
- `financial-kpi-service.ts` — KPIs financieros específicos

**Operations:**
- `workflow-execution-service.ts`, `workflow-assignment-service.ts`, `workflow-schedule-service.ts`, `workflow-template-service.ts`, `workflow-trigger-service.ts`
- `compliance-alert-service.ts`, `ComplianceReportService.ts`
- `inventory-service.ts`, `stock-alert-service.ts`, `stock-count-service.ts`, `suggested-order-service.ts`
- `shift-service.ts`, `shift-service-extended.ts`, `shift-validation-service.ts`, `shift-approval-service.ts`, `shift-workflow-service.ts`, `shift-template-service.ts`
- `employee-service.ts`, `employee-document-service.ts`, `labor-calculator.ts`
- `equipment-service.ts`, `incident-engine.ts`, `escalation-service.ts`
- `purchase-order-service.ts`, `supplier-claim-service.ts`

**Finance:**
- `cash-flow-service.ts`, `pnl-service.ts`, `expense-service.ts`, `petty-cash-service.ts`
- `sales-ingestion-service.ts`, `sales-analytics-service.ts`
- `invoice-matching-service.ts`, `cfdi-parser.ts`
- `costing-service.ts`, `recipe-service.ts`, `production-service.ts`

**Notifications:**
- `notification-service.ts`, `notification-dispatcher.ts`, `whatsapp-notification-service.ts`, `whatsapp-service.ts`, `email-service.ts`

**Inngest Functions:**
- 11 cron jobs: scheduled workflows, overdue checks, daily reminders, inventory checks, compliance alerts, document expiration, break reminders

### 2.3 UI Components existentes

- `components/dashboard/executive-summary.tsx` — Server Component con KPIs
- `components/dashboard/executive-summary-cost-chart.tsx` — Gráfica de tendencias
- `components/dashboard/daily-executions-chart.tsx` — Ejecuciones diarias
- `components/inventory/executive-dashboard.tsx` — Dashboard ejecutivo de inventario
- `components/analytics/kpi-builder.tsx` — Builder de KPIs

---

## 3. Gap Analysis: Lo que Falta para Pulso Executive OS

### 3.1 Executive Twin — De 3 campos a 10 dimensiones

```typescript
// ACTUAL (corporate_twins)
{
  healthScore,        // promedio simple
  driftScore,         // 100 - healthScore
  marginLeakageScore, // suma de leakage
  networkState        // { branchCount, bestPerforming, lowestPerforming, sharedRisks }
}

// OBJETIVO (ExecutiveTwin)
{
  groupHealth,         // score compuesto 0-100
  projectedCashFlow,   // proyección 14-30 días
  operationalRisk,     // riesgo operativo agregado
  complianceRisk,      // riesgo de compliance/auditoría
  expansionReadiness,  // capacidad de absorber nueva sucursal
  executionCapacity,   // capacidad de ejecución del grupo
  knowledgeIndex,      // índice de conocimiento acumulado
  financialHealth,     // salud financiera (liquidez, burn rate)
  peopleRisk,          // riesgo de rotación/burnout
  brandConsistency,    // consistencia de marca entre sucursales
}
```

### 3.2 8 Intelligence Engines — De datos fragmentados a motores unificados

| Engine | Servicios existentes | Gap |
|---|---|---|
| **1. Operations Intelligence** | `operational-twin-engine`, workflow services | Unificar en un solo engine con output: health, drift, execution score, priorities |
| **2. Finance Intelligence** | `cash-flow`, `pnl`, `financial-kpi`, `forecast` | Unificar + projected cash flow 14d + upcoming obligations + liquidity risk |
| **3. Procurement Intelligence** | `suggested-order`, `purchase-order`, `stock-alert` | Unificar + negotiation opportunities + transfer recommendations + waste patterns |
| **4. Workforce Intelligence** | `shift-*`, `labor-calculator`, `overtime-alert` | Unificar + capacity + burnout risk + staffing risk + training needs |
| **5. Brand Intelligence** | `compliance-alert`, `recipe-service`, `quality` checks | **Nuevo**: brand compliance score, brand drift, consistency index, store ranking |
| **6. Compliance Intelligence** | `ComplianceReportService`, `compliance-alert`, `civil-protection` | Unificar + risk prediction + expiring docs + inspection readiness score |
| **7. Maintenance Intelligence** | `equipment-service` | Unificar + preventive maintenance + failure prediction + repair priority |
| **8. Knowledge Intelligence** | `knowledge-service`, `insight-generator` | Unificar + playbooks + lessons learned + best practices + auto SOP updates |

### 3.3 Morning Brief — No existe

El "Morning Brief" es EL producto. Debe generarse automáticamente a las 7:00 AM vía Inngest:

```
Good Morning David.

Group Health:     91/100
Cash Available:   $1.82M
Cash 14d Proj:    $684,000
Operational Risk: Medium
Brand Risk:       Low
Compliance:       97%

Today's Priorities:
1. Move inventory Valle → Cumbres. Savings: $18,400
2. Repair freezer Centro. Risk: High
3. Approve payroll. Due tomorrow
4. 3 permits expire in 7 days
5. San Pedro created better opening process. Recommend rollout
```

### 3.4 AI Layer — De Q&A a razonamiento causal

Actual: `IntelligenceService.answerQuestion()` — busca keywords y devuelve datos.

Objetivo: AI que razona con contexto completo del Executive Twin + todos los engines:
- "Which decision produces the highest EBITDA improvement this week?"
- "If I delay purchasing until Friday, what operational risks increase?"
- "Which manager deserves recognition?"

### 3.5 Business Model / Tiering — No existe

Se necesita:
- Tabla `subscription_tiers` (Foundation, Growth, Executive)
- Feature flags por tier
- Límites de sucursales por tier
- Billing automático

### 3.6 Professional Services — No existe

Workflows para:
- Executive Operating Assessment
- Pulso OS Design
- Digital Twin Onboarding
- Executive Success Program

---

## 4. Roadmap por Sprints

```
Sprint 1 (2-3 semanas)
FOUNDATION
├── Enriquecer Executive Twin schema
├── Executive Twin Engine (recalculate)
├── Unificar Event Bus con domain events existentes
├── Evidence Store unificado
└── Base de los 8 Engines (interfaces + contratos)

Sprint 2 (3-4 semanas)
INTELLIGENCE ENGINES
├── Operations Intelligence Engine
├── Finance Intelligence Engine (cash flow projection 14d)
├── Procurement Intelligence Engine
├── Workforce Intelligence Engine
└── Brand Intelligence Engine

Sprint 3 (3-4 semanas)
AI + MORNING BRIEF
├── Compliance Intelligence Engine
├── Maintenance Intelligence Engine
├── Knowledge Intelligence Engine
├── Morning Brief Generator (Inngest cron 7AM)
├── AI Reasoning Layer (causal, multi-context)
└── Priority & Recommendation Engine

Sprint 4 (2-3 semanas)
EXECUTIVE EXPERIENCE
├── CEO Dashboard completo
├── Daily Brief UI
├── Decision Feed
├── Alerts Executive View
└── Mobile Executive View

Sprint 5 (2-3 semanas)
BUSINESS MODEL
├── Subscription tiers schema
├── Feature flags por tier
├── Billing integration
├── Tier migration flow
└── Usage analytics

Sprint 6 (2-3 semanas)
PROFESSIONAL SERVICES
├── Assessment workflow
├── OS Design workflow
├── Digital Twin Onboarding wizard
├── Executive Success Program dashboard
└── Client-facing deliverables
```

---

## 5. Sprint 1 — Foundation

### 5.1 Enriquecer `corporateTwins` schema

**Archivo:** `lib/db/schema/operational-twin.ts`

Agregar al schema de `corporateTwins`:

```typescript
export const corporateTwins = pgTable("corporate_twins", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey().notNull(),
  companyId: uuid("company_id").notNull().references(() => companies.id),

  // --- YA EXISTEN ---
  healthScore: integer("health_score").default(100).notNull(),
  driftScore: integer("drift_score").default(0).notNull(),
  marginLeakageScore: integer("margin_leakage_score").default(0).notNull(),
  networkState: jsonb("network_state").default(sql`'{}'::jsonb`).notNull(),

  // --- NUEVOS: Executive Dimensions ---
  // Financial
  projectedCashFlowCents: bigint("projected_cash_flow_cents", { mode: "number" }).default(0).notNull(),
  liquidityRisk: integer("liquidity_risk").default(0).notNull(),        // 0-100
  upcomingObligationsCents: bigint("upcoming_obligations_cents", { mode: "number" }).default(0).notNull(),

  // Risk
  operationalRisk: integer("operational_risk").default(0).notNull(),    // 0-100
  complianceRisk: integer("compliance_risk").default(0).notNull(),      // 0-100
  peopleRisk: integer("people_risk").default(0).notNull(),              // 0-100

  // Growth
  expansionReadiness: integer("expansion_readiness").default(0).notNull(), // 0-100
  executionCapacity: integer("execution_capacity").default(0).notNull(),   // 0-100
  brandConsistency: integer("brand_consistency").default(0).notNull(),     // 0-100

  // Knowledge
  knowledgeIndex: integer("knowledge_index").default(0).notNull(),      // 0-100
  playbookCount: integer("playbook_count").default(0).notNull(),
  bestPracticesCount: integer("best_practices_count").default(0).notNull(),

  // State
  executiveState: jsonb("executive_state").default(sql`'{}'::jsonb`).notNull(),

  lastUpdated: timestamp("last_updated").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  uniqueCompanyTwin: uniqueIndex("unique_company_twin").on(table.companyId),
}));
```

### 5.2 Executive Twin Engine

**Archivo nuevo:** `lib/services/executive-twin-engine.ts`

Este servicio reemplaza/extiende la función actual `recalculateCorporateTwin` en `operational-twin-engine.ts`:

```typescript
export class ExecutiveTwinEngine {

  static async recalculate(companyId: string): Promise<ExecutiveTwin> {
    // 1. Obtener todos los Operational Twins de las sucursales
    // 2. Calcular cada dimensión ejecutiva:
    //    - projectedCashFlow: sumar cash flow de todas las sucursales
    //    - liquidityRisk: upcoming obligations / available cash
    //    - operationalRisk: drift scores agregados
    //    - complianceRisk: compliance scores + expiring docs
    //    - peopleRisk: rotación + burnout signals
    //    - expansionReadiness: execution capacity + financial health
    //    - executionCapacity: completion rates agregados
    //    - brandConsistency: desviación estándar de quality scores
    //    - knowledgeIndex: playbooks + best practices + SOPs
    // 3. Persistir en corporateTwins
    // 4. Emitir ExecutiveTwinUpdated event
  }

  static async getProjectedCashFlow(companyId: string, days: number = 14) {
    // Calcular flujo de caja proyectado para los próximos N días
  }

  static async getUpcomingObligations(companyId: string) {
    // Pagos próximos: nómina, proveedores, rentas, servicios
  }
}
```

### 5.3 Unificar Event Bus

**Archivo a modificar:** `lib/services/domain-event-service.ts`

Ya existe `domainEvents` table y `emitDomainEvent`. Extender:

```typescript
export type DomainEventType =
  // Operacionales
  | 'WORKFLOW_COMPLETED' | 'WORKFLOW_OVERDUE' | 'WORKFLOW_ASSIGNED'
  | 'INCIDENT_CREATED' | 'INCIDENT_RESOLVED' | 'INCIDENT_ESCALATED'
  // Inventario
  | 'STOCK_LOW' | 'STOCK_CRITICAL' | 'WASTE_DETECTED'
  | 'PURCHASE_ORDER_CREATED' | 'RECEPTION_COMPLETED'
  // Laboral
  | 'SHIFT_STARTED' | 'SHIFT_COMPLETED' | 'NO_SHOW'
  | 'OVERTIME_THRESHOLD' | 'ATTENDANCE_ISSUE'
  // Financiero
  | 'SALE_RECORDED' | 'EXPENSE_RECORDED' | 'PAYMENT_EXECUTED'
  | 'CASH_FLOW_UPDATED' | 'BUDGET_EXCEEDED'
  // Compliance
  | 'COMPLIANCE_SCORE_CHANGED' | 'DOCUMENT_EXPIRING' | 'AUDIT_DUE'
  // Executive
  | 'EXECUTIVE_TWIN_UPDATED' | 'MORNING_BRIEF_GENERATED'
  | 'RISK_THRESHOLD_BREACHED' | 'EXPANSION_OPPORTUNITY';
```

### 5.4 Evidence Store Unificado

**Archivo nuevo:** `lib/services/evidence-store.ts`

Unificar el almacenamiento de evidencia (fotos, archivos, voice notes) que actualmente está disperso:

```typescript
export class EvidenceStore {
  // Unificar: workflow evidence + incident evidence + document uploads
  // Agregar metadatos AI: transcripción, clasificación, verificación
  // Cross-referenciar con domain events
}
```

### 5.5 Interfaces base de los 8 Engines

**Archivo nuevo:** `lib/services/intelligence/engine-interface.ts`

```typescript
export interface IntelligenceEngine<TInput, TOutput> {
  readonly engineId: string;
  readonly engineName: string;

  /** Analiza el estado actual y produce inteligencia */
  analyze(input: TInput): Promise<TOutput>;

  /** Devuelve el último output cacheado */
  getLatest(companyId: string): Promise<TOutput | null>;

  /** Recalcula y persiste */
  refresh(companyId: string): Promise<TOutput>;
}

export interface EngineOutput {
  score: number;           // 0-100
  confidence: number;      // 0-100
  insights: string[];      // hallazgos accionables
  priorities: Priority[];  // acciones recomendadas
  risks: Risk[];           // riesgos detectados
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

---

## 6. Sprint 2 — Intelligence Engines

### 6.1 Operations Intelligence Engine

**Archivo nuevo:** `lib/services/intelligence/operations-engine.ts`

Inputs:
- Workflow completion rates, overdue patterns
- Opening/closing execution times
- Incident frequency and resolution times
- Audit scores
- Service metrics (from sales data)

Outputs:
- `OperationalHealth` — score compuesto
- `OperationalDrift` — qué tanto se desvía cada sucursal del estándar
- `ExecutionScore` — por sucursal y global
- `Priorities` — tareas críticas, cuellos de botella
- `BenchmarkComparison` — sucursal vs sucursal

**Reusa:** `operational-twin-engine.ts`, `workflow-assignment-service.ts`, `incident-engine.ts`, `escalation-service.ts`

### 6.2 Finance Intelligence Engine

**Archivo nuevo:** `lib/services/intelligence/finance-engine.ts`

Inputs:
- Ventas (salesEntries, salesUploads)
- Gastos (expenses, pettyCash)
- Caja y bancos (cashFlow)
- Proveedores y cuentas por pagar (purchaseOrders)
- Nómina (laborCalculator)
- Obligaciones fiscales (CFDI, SAT)
- Rentas y servicios

Outputs:
- `ProjectedCashFlow` — 7, 14, 30 días
- `CashBurn` — tasa diaria/semanal
- `UpcomingObligations` — pagos próximos
- `LiquidityRisk` — score 0-100
- `RecommendedPayments` — priorización de pagos
- `PnLSummary` — por sucursal y consolidado

**Reusa:** `cash-flow-service.ts`, `pnl-service.ts`, `expense-service.ts`, `financial-kpi-service.ts`, `forecast-service.ts`

### 6.3 Procurement Intelligence Engine

**Archivo nuevo:** `lib/services/intelligence/procurement-engine.ts`

Inputs:
- Compras (purchaseOrders, purchaseOrderItems)
- Consumo (theoreticalConsumption, inventoryMovements)
- Inventario (inventoryItems, stockCounts)
- Transferencias (inventoryMovements type=TRANSFER)
- Proveedores (suppliers, supplierClaims)

Outputs:
- `PurchaseRecommendations` — qué comprar, cuánto, cuándo
- `NegotiationOpportunities` — proveedores con volumen para negociar
- `TransferRecommendations` — mover stock entre sucursales
- `ShortageRisks` — productos en riesgo de faltante
- `WastePatterns` — patrones de merma por producto/sucursal

**Reusa:** `suggested-order-service.ts`, `purchase-order-service.ts`, `stock-alert-service.ts`, `theoretical-consumption-service.ts`

### 6.4 Workforce Intelligence Engine

**Archivo nuevo:** `lib/services/intelligence/workforce-engine.ts`

Inputs:
- Asistencia (shiftSessions)
- Rotación (employee history)
- Horas extra (overtime)
- Capacitación (employeeDocuments, onboarding)
- Incidentes laborales (incidents type=EMPLOYEE)

Outputs:
- `OperationalCapacity` — personas vs necesidad operativa
- `BurnoutRisk` — empleados en riesgo
- `StaffingRisk` — riesgo de falta de personal
- `TrainingNeeds` — gaps de capacitación
- `RetentionRisk` — riesgo de rotación por sucursal

**Reusa:** `shift-service.ts`, `labor-calculator.ts`, `overtime-alert-service.ts`, `employee-service.ts`, `break-management-service.ts`

### 6.5 Brand Intelligence Engine

**Archivo nuevo:** `lib/services/intelligence/brand-engine.ts`

Inputs:
- Fotos de evidencia (evidenceStore)
- Auditorías de calidad (compliance scores)
- Recetas estándar (recipes)
- Presentación (quality checks)
- Uniformes y limpieza (workflows de apertura/cierre)

Outputs:
- `BrandCompliance` — score de consistencia
- `BrandDrift` — sucursales desviándose del estándar
- `ConsistencyIndex` — índice compuesto
- `StoreRanking` — ranking visual/operativo
- `BestPracticeReference` — sucursal de referencia para clonar

**Reusa:** `recipe-service.ts`, `compliance-alert-service.ts`, `evidence-store.ts`

---

## 7. Sprint 3 — AI & Morning Brief

### 7.1 Compliance Intelligence Engine

**Archivo nuevo:** `lib/services/intelligence/compliance-engine.ts`

Inputs:
- NOM-251, NOM-035, LFT, IMSS, Protección Civil
- Checklists, documentos, bitácoras

Outputs:
- `ComplianceRisk` — score 0-100
- `ExpiringDocuments` — documentos próximos a vencer
- `InspectionReadiness` — qué tan listo está para auditoría
- `RegulatoryCalendar` — próximas obligaciones

**Reusa:** `ComplianceReportService.ts`, `compliance-alert-service.ts`, `civil-protection-service.ts`, `employee-document-service.ts`

### 7.2 Maintenance Intelligence Engine

**Archivo nuevo:** `lib/services/intelligence/maintenance-engine.ts`

Inputs:
- Equipos (equipment)
- Fallas (maintenanceLogs)
- Temperaturas (temperatureLogs)
- Uso (productionResults)

Outputs:
- `PreventiveSchedule` — mantenimientos próximos
- `FailurePrediction` — equipos en riesgo
- `RepairPriority` — orden de reparación

**Reusa:** `equipment-service.ts`

### 7.3 Knowledge Intelligence Engine

**Archivo nuevo:** `lib/services/intelligence/knowledge-engine.ts`

Inputs:
- Todos los eventos del sistema
- Workflows completados, incidentes resueltos
- Mejores prácticas detectadas
- Variaciones entre sucursales

Outputs:
- `Playbooks` — procedimientos destilados
- `Recommendations` — qué funciona mejor
- `LessonsLearned` — incidentes + resolución
- `BestPractices` — sucursal ejemplar por área
- `AutoSOPUpdates` — sugerencias de mejora a playbooks

**Reusa:** `knowledge-service.ts`, `insight-generator-service.ts`, `cross-branch-service.ts`

### 7.4 Morning Brief Generator

**Archivo nuevo:** `lib/services/morning-brief-generator.ts`

```typescript
export interface MorningBrief {
  greeting: string;                    // "Good Morning David."
  generatedAt: Date;                   // 7:00 AM timestamp
  groupHealth: number;                 // 0-100
  cashAvailable: string;               // formatted
  projectedCash14d: string;            // formatted
  operationalRisk: 'Low' | 'Medium' | 'High' | 'Critical';
  brandRisk: 'Low' | 'Medium' | 'High' | 'Critical';
  complianceScore: number;             // 0-100
  todayPriorities: BriefPriority[];    // top 5
  yesterdaySummary: BriefSummary;
  alertsRequiringAttention: BriefAlert[];
}

export interface BriefPriority {
  rank: number;
  title: string;
  description: string;
  impact: string;                      // e.g. "Estimated savings $18,400"
  riskLevel: 'Low' | 'Medium' | 'High';
  actionUrl?: string;
}
```

**Inngest function:** `lib/inngest/functions/generate-morning-brief.ts`

```typescript
// Cron: 0 7 * * * (todos los días 7:00 AM, timezone local)
export const generateMorningBrief = inngest.createFunction(
  {
    id: "generate-morning-brief",
    cron: "0 7 * * *",
  },
  async ({ event, step }) => {
    // 1. Recalcular todos los twins (operational + executive)
    // 2. Ejecutar los 8 engines
    // 3. Generar el brief con AI
    // 4. Enviar al owner vía WhatsApp + Email + In-App
    // 5. Guardar en tabla morning_briefs
  }
);
```

### 7.5 AI Reasoning Layer

**Archivo a modificar:** `lib/services/intelligence-service.ts`

Evolucionar de keyword-matching Q&A a razonamiento causal con contexto completo:

```typescript
export class IntelligenceService {
  // NUEVO: Razonamiento ejecutivo con contexto completo
  static async reasonAbout(params: {
    question: string;
    companyId: string;
  }): Promise<ReasoningResult> {
    // 1. Cargar Executive Twin completo
    // 2. Cargar outputs de los 8 engines
    // 3. Cargar datos relevantes de sucursales
    // 4. Construir prompt con contexto estructurado
    // 5. Llamar a OpenAI con function calling para:
    //    - Análisis causal
    //    - Simulaciones contra fácticas
    //    - Recomendaciones priorizadas
    // 6. Devolver respuesta estructurada con fuentes
  }
}
```

### 7.6 Priority & Recommendation Engine

**Archivo nuevo:** `lib/services/priority-engine.ts`

```typescript
export class PriorityEngine {
  /** Consolida prioridades de todos los engines */
  static async calculatePriorities(companyId: string): Promise<PrioritizedAction[]> {
    // 1. Recolectar todos los risks y priorities de los 8 engines
    // 2. Normalizar impacto financiero (cents)
    // 3. Ponderar por urgencia × impacto × probabilidad
    // 4. Ordenar por score compuesto
    // 5. Retornar top 10 con justificación
  }

  /** Calcula qué decisión produce el mayor impacto en EBITDA */
  static async compareDecisions(
    companyId: string,
    decisions: DecisionOption[]
  ): Promise<DecisionAnalysis> {}
}
```

---

## 8. Sprint 4 — Executive Experience

### 8.1 CEO Dashboard

**Archivo nuevo:** `app/dashboard/executive/page.tsx`

```
┌────────────────────────────────────────────────┐
│  PULSO EXECUTIVE OS                    [Perfil] │
│  Grupo Taquería El Parián · 5 sucursales        │
├────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌────────────────┐  │
│  │ Group    │ │ Cash     │ │ Operational    │  │
│  │ Health   │ │ Avail.   │ │ Risk           │  │
│  │  91/100  │ │ $1.82M   │ │ Medium 🟡      │  │
│  └──────────┘ └──────────┘ └────────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌────────────────┐  │
│  │ Brand    │ │Compliance│ │ Expansion       │  │
│  │ Risk Low │ │   97%    │ │ Readiness 72    │  │
│  └──────────┘ └──────────┘ └────────────────┘  │
├────────────────────────────────────────────────┤
│  TODAY'S PRIORITIES                            │
│  ┌────────────────────────────────────────────┐│
│  │ 1. Move inventory Valle → Cumbres  $18.4K ││
│  │ 2. Repair freezer Centro           HIGH   ││
│  │ 3. Approve payroll                 DUE    ││
│  │ 4. 3 permits expire in 7 days      MED    ││
│  │ 5. Rollout new opening process     LOW    ││
│  └────────────────────────────────────────────┘│
├────────────────────────────────────────────────┤
│  SUCURSALES                                    │
│  Centro 92 | San Pedro 97 | Valle 78⚠️         │
│  Cumbres 91 | Contry 65🔴                      │
├────────────────────────────────────────────────┤
│  PROJECTED CASH FLOW (14 days)                 │
│  [Gráfica de barras]                           │
└────────────────────────────────────────────────┘
```

### 8.2 Daily Brief UI

**Archivo nuevo:** `components/dashboard/morning-brief.tsx`

Componente que muestra el brief del día, con:
- Fecha y hora de generación
- Todos los KPIs ejecutivos
- Prioridades accionables (con links)
- Resumen del día anterior

### 8.3 Decision Feed

**Archivo nuevo:** `components/dashboard/decision-feed.tsx`

```typescript
// Feed cronológico de decisiones que requieren atención del dueño:
// - Aprobaciones pendientes
// - Alertas críticas no resueltas
// - Recomendaciones de los engines
// - Cambios significativos en KPIs
```

### 8.4 API Routes necesarias

```
GET  /api/executive/twin           → Executive Twin completo
GET  /api/executive/brief/latest   → Último Morning Brief
GET  /api/executive/brief/history  → Historial de briefs
GET  /api/executive/priorities     → Prioridades consolidadas
GET  /api/executive/cashflow       → Proyección de cash flow
POST /api/executive/reason         → AI Reasoning (pregunta)
GET  /api/executive/feed           → Decision Feed
POST /api/executive/refresh        → Forzar refresh de todos los engines
```

---

## 9. Sprint 5 — Business Model & Tiering

### 9.1 Schema de Tiers

**Archivo nuevo:** `lib/db/schema/subscription.ts`

```typescript
export const subscriptionTiers = pgTable("subscription_tiers", {
  id: uuid("id").default(sql`gen_random_uuid()`).primaryKey(),
  name: text("name").notNull(),            // Foundation, Growth, Executive
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

### 9.2 Feature Flags

```typescript
// lib/services/tier-service.ts
export const TIER_FEATURES = {
  FOUNDATION: [
    'operational_twin',
    'workflows',
    'evidence_store',
    'dashboard',
    'alerts',
    'morning_brief',
    'basic_ai',
  ],
  GROWTH: [
    // Foundation +
    'executive_twin',
    'cash_flow_intelligence',
    'brand_intelligence',
    'procurement_intelligence',
    'knowledge_engine',
    'benchmarking',
    'auto_recommendations',
  ],
  EXECUTIVE: [
    // Growth +
    'full_executive_committee',
    'risk_prediction',
    'financial_planning',
    'expansion_simulations',
    'api_access',
    'erp_integrations',
    'ai_copilot',
    'weekly_executive_meeting',
  ],
} as const;
```

---

## 10. Sprint 6 — Professional Services

### 10.1 Workflows de Servicios Profesionales

Crear templates de workflow para cada servicio:

```
templates/professional-services/
├── executive-assessment.json     # Executive Operating Assessment
├── os-design.json                # Pulso OS Design
├── digital-twin-onboarding.json  # Digital Twin Onboarding
└── executive-success.json        # Executive Success Program
```

### 10.2 Assessment Engine

**Archivo nuevo:** `lib/services/assessment-service.ts`

```typescript
export class AssessmentService {
  static async startAssessment(companyId: string): Promise<Assessment>
  static async evaluateBranch(branchId: string): Promise<BranchDiagnostic>
  static async generateReport(assessmentId: string): Promise<AssessmentReport>
}

export interface BranchDiagnostic {
  operationalMaturity: number;     // 0-100
  processMapping: Record<string, ProcessMaturity>;
  risks: IdentifiedRisk[];
  quickWins: QuickWin[];
}
```

### 10.3 Digital Twin Onboarding Wizard

Extender `tenant-operating-config-service.ts` con un wizard paso a paso:

1. Conectar POS → configurar mapeo de columnas
2. Conectar bancos → importar estados de cuenta
3. Conectar contabilidad → mapear cuentas contables
4. Conectar nómina → importar plantilla
5. Conectar inventario → catálogo inicial
6. Conectar WhatsApp → configurar números
7. (Futuro) Conectar sensores → temperatura IoT

---

## 11. Arquitectura Objetivo

### Estructura de archivos propuesta

```
lib/
├── services/
│   ├── intelligence/                    # NUEVO: 8 Engines
│   │   ├── engine-interface.ts          # Interfaz base
│   │   ├── operations-engine.ts
│   │   ├── finance-engine.ts
│   │   ├── procurement-engine.ts
│   │   ├── workforce-engine.ts
│   │   ├── brand-engine.ts
│   │   ├── compliance-engine.ts
│   │   ├── maintenance-engine.ts
│   │   └── knowledge-engine.ts
│   ├── executive-twin-engine.ts         # NUEVO: Executive Twin
│   ├── morning-brief-generator.ts       # NUEVO: Morning Brief
│   ├── priority-engine.ts              # NUEVO: Priority Engine
│   ├── evidence-store.ts               # NUEVO: Evidence unificado
│   ├── tier-service.ts                 # NUEVO: Tiers
│   ├── assessment-service.ts           # NUEVO: Professional Services
│   ├── operational-twin-engine.ts      # EXISTE: modificar
│   ├── intelligence-service.ts         # EXISTE: extender
│   └── ... (84 servicios existentes)

├── db/schema/
│   ├── operational-twin.ts             # MODIFICAR: enriquecer corporateTwins
│   ├── subscription.ts                 # NUEVO: tiers y subscriptions
│   └── ... (schemas existentes)

├── inngest/functions/
│   ├── generate-morning-brief.ts       # NUEVO: cron 7AM
│   ├── recalculate-executive-twin.ts   # NUEVO: refresh periódico
│   ├── run-intelligence-engines.ts     # NUEVO: orquestador
│   └── ... (11 funciones existentes)

app/
├── api/executive/                      # NUEVO: API Executive
│   ├── twin/route.ts
│   ├── brief/route.ts
│   ├── priorities/route.ts
│   ├── cashflow/route.ts
│   ├── reason/route.ts
│   ├── feed/route.ts
│   └── refresh/route.ts
├── dashboard/executive/                # NUEVO: CEO Dashboard
│   └── page.tsx
└── ... (rutas existentes)

components/dashboard/
├── morning-brief.tsx                    # NUEVO
├── decision-feed.tsx                    # NUEVO
├── executive-twin-card.tsx              # NUEVO
├── cash-flow-projection.tsx             # NUEVO
├── executive-summary.tsx                # EXISTE: mejorar
└── ... (componentes existentes)
```

### Data Flow

```
┌─────────────────────────────────────────────────────────┐
│                   EVENT BUS (domainEvents)               │
│  Todos los cambios en el sistema emiten eventos          │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              INNGEST ORCHESTRATOR                        │
│  ┌──────────────────────────────────────────────────┐   │
│  │ Cada 5 min: recalcular Operational Twins        │   │
│  │ Cada 15 min: recalcular Executive Twin           │   │
│  │ Cada hora: ejecutar Intelligence Engines         │   │
│  │ 7:00 AM: generar Morning Brief                   │   │
│  └──────────────────────────────────────────────────┘   │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              INTELLIGENCE LAYER                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │Operations│ │ Finance  │ │Procurement│ │Workforce │  │
│  │ Engine   │ │ Engine   │ │ Engine   │ │ Engine   │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │ Brand    │ │Compliance│ │Mainten.  │ │Knowledge │  │
│  │ Engine   │ │ Engine   │ │ Engine   │ │ Engine   │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              PRIORITY & RECOMMENDATION ENGINE            │
│  Consolida outputs → ordena por impacto × urgencia       │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              MORNING BRIEF GENERATOR                     │
│  Template + AI → Brief en español → WhatsApp/Email/App   │
└─────────────────────────────────────────────────────────┘
```

---

## 12. Métricas de Éxito

### Técnicas
- [ ] Executive Twin se recalcula en <30s para grupos de 15 sucursales
- [ ] Morning Brief se genera y entrega antes de 7:05 AM
- [ ] 8 engines producen outputs con >80% confidence score
- [ ] AI Reasoning responde en <10s con contexto completo
- [ ] API Executive responde en <500ms (cacheado)
- [ ] 0 regresiones en funcionalidad existente

### Producto
- [ ] Dueño puede leer su Morning Brief en <2 minutos
- [ ] Prioridades incluyen impacto financiero estimado
- [ ] Decision Feed muestra solo lo que requiere acción del dueño
- [ ] Dashboard ejecutivo funciona en tablet y desktop
- [ ] Tiering permite activar/desactivar features sin deploy

### Negocio
- [ ] Demo del Executive OS se puede hacer con datos reales del cliente
- [ ] Assessment inicial se completa en <2 semanas
- [ ] Onboarding de sucursal nueva toma <1 semana
- [ ] Cliente puede migrar de tier sin intervención manual

---

## Apéndice: Mapeo de Archivos Existentes → Nuevos

| Existente | Acción | Nuevo/Modificado |
|---|---|---|
| `lib/db/schema/operational-twin.ts` | Modificar | Agregar 12 columnas a `corporateTwins` |
| `lib/services/operational-twin-engine.ts` | Extender | Extraer lógica de corporate twin a `executive-twin-engine.ts` |
| `lib/services/domain-event-service.ts` | Extender | Agregar nuevos event types |
| `lib/services/intelligence-service.ts` | Reescribir | Razonamiento causal + multi-contexto |
| `lib/services/insight-generator-service.ts` | Extender | Tipos de insight ejecutivos |
| `lib/services/forecast-service.ts` | Reusar | Finance Engine lo consume tal cual |
| `lib/services/analytics-service.ts` | Extender | Métricas ejecutivas adicionales |
| `lib/services/cash-flow-service.ts` | Reusar | Finance Engine lo consume |
| `lib/services/pnl-service.ts` | Reusar | Finance Engine lo consume |
| `lib/services/knowledge-service.ts` | Extender | Knowledge Engine lo expande |
| `components/dashboard/executive-summary.tsx` | Mejorar | Más KPIs ejecutivos |
| `lib/inngest/functions/` | Agregar | 3 nuevas funciones + modificar existentes |
| `app/api/inventory/reports/executive/route.ts` | Referencia | Mismo patrón para API executive |

---

> **Siguiente paso:** Empezar Sprint 1 con la migración de `corporateTwins` schema y el `ExecutiveTwinEngine`. El plan está diseñado para que cada sprint produzca valor demostrable — no es necesario completar los 6 sprints para tener un Executive OS funcional. Con Sprint 1+2 ya se tiene el 80% del valor ejecutivo.
