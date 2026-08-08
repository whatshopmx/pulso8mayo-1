import OpenAI from 'openai';
import { db } from '@/lib/db';
import { companies, branches } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { KnowledgeService } from './knowledge-service';
import { ExecutiveReportService, type BranchKPI } from './executive-report-service';
import { ExecutiveTwinEngine } from './executive-twin-engine';
import { TierService } from './tier-service';
import type {
  EngineId,
  EngineOutput,
  ExecutiveTwin,
  ImpactLevel,
} from './intelligence/types';

let openai: OpenAI | null = null;
function getClient(): OpenAI {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

function systemPrompt(): string {
  return `Eres Pulso Intelligence, el asistente de inteligencia de inventario para restaurantes.
Respondes preguntas sobre inventario en español, usando datos reales del sistema.
Siempre basas tus respuestas en los datos proporcionados. Si no sabes algo, dilo.
Usa un tono profesional pero accesible. Incluye números concretos cuando sea posible.`;
}

export interface InsightAnswer {
  answer: string;
  data?: Record<string, unknown>;
  sources?: string[];
}

export class IntelligenceService {
  static async answerQuestion(params: {
    question: string;
    companyId: string;
    branchId?: string;
  }): Promise<InsightAnswer> {
    const { question, companyId, branchId } = params;
    const context: string[] = [];
    const sources: string[] = [];

    const company = await db.query.companies.findFirst({
      where: eq(companies.id, companyId),
    });
    if (company) {
      context.push(`Compañía: ${company.name}`);
    }

    if (branchId) {
      const branch = await db.query.branches.findFirst({
        where: eq(branches.id, branchId),
      });
      if (branch) {
        context.push(`Sucursal: ${branch.name}`);
        sources.push(`branch:${branch.id}`);
      }
    }

    const questionLower = question.toLowerCase();

    if (questionLower.includes('food cost') || questionLower.includes('costo de comida') || questionLower.includes('foodcost')) {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);

      try {
        const report = await ExecutiveReportService.getReport(companyId, startDate, endDate, branchId);
        context.push(`Food Cost %: ${report.consolidated.foodCostPercent}%`);
        context.push(`COGS: $${(report.consolidated.cogsCents / 100).toFixed(2)}`);
        context.push(`Revenue: $${(report.consolidated.revenueCents / 100).toFixed(2)}`);
        context.push(`Inventory Turnover: ${report.consolidated.inventoryTurnover}`);
        context.push(`Stock Days: ${report.consolidated.stockDays}`);
        context.push(`Shrinkage %: ${report.consolidated.shrinkagePercent}%`);
        context.push(`Fill Rate: ${report.consolidated.fillRate}%`);

        if (report.byBranch.length > 1) {
          const branchData = report.byBranch.map(b =>
            `${b.branchName}: Food Cost ${b.foodCostPercent}%, COGS $${(b.cogsCents / 100).toFixed(2)}`
          ).join('; ');
          context.push(`Por sucursal: ${branchData}`);
        }
        sources.push('ExecutiveReportService');
      } catch (e) {
        context.push('Error al obtener reporte ejecutivo');
      }
    }

    if (questionLower.includes('consumo') || questionLower.includes('consumption') || questionLower.includes('tendencia') || questionLower.includes('trend')) {
      try {
        const companyBranches = branchId
          ? [{ id: branchId }]
          : await db.select({ id: branches.id }).from(branches).where(eq(branches.companyId, companyId));

        let itemData: string[] = [];
        for (const b of companyBranches) {
          const insights = await KnowledgeService.getInsights(companyId, b.id);
          const topItems = insights.slice(0, 10);
          for (const item of topItems) {
            itemData.push(
              `${item.itemName}: consumo diario ${item.avgDailyConsumption ?? 'N/A'}, tendencia ${item.consumptionTrend ?? 0}%, merma ${item.avgWastePercent != null ? (item.avgWastePercent / 100).toFixed(1) : 'N/A'}%`
            );
          }
          sources.push(`KnowledgeService:${b.id}`);
        }
        if (itemData.length > 0) {
          context.push(`Datos de consumo (top 10 items): ${itemData.join('; ')}`);
        }
      } catch (e) {
        context.push('Error al obtener datos de consumo');
      }
    }

    if (questionLower.includes('merma') || questionLower.includes('waste') || questionLower.includes('desperdicio')) {
      try {
        const companyBranches = branchId
          ? [{ id: branchId }]
          : await db.select({ id: branches.id }).from(branches).where(eq(branches.companyId, companyId));

        let wasteItems: string[] = [];
        for (const b of companyBranches) {
          const insights = await KnowledgeService.getInsights(companyId, b.id);
          const topWaste = insights
            .filter(i => i.avgWastePercent != null && i.avgWastePercent > 0)
            .slice(0, 5);
          for (const item of topWaste) {
            wasteItems.push(
              `${item.itemName}: ${(item.avgWastePercent! / 100).toFixed(1)}% merma, pérdida $${(item.totalWasteLoss ?? 0) / 100}`
            );
          }
        }
        if (wasteItems.length > 0) {
          context.push(`Items con mayor merma: ${wasteItems.join('; ')}`);
        }
      } catch (e) {
        context.push('Error al obtener datos de merma');
      }
    }

    if (context.length <= 2) {
      try {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
        const report = await ExecutiveReportService.getReport(companyId, startDate, endDate, branchId);
        context.push(`Resumen rápido — Food Cost: ${report.consolidated.foodCostPercent}%, Fill Rate: ${report.consolidated.fillRate}%`);
        sources.push('ExecutiveReportService');
      } catch (e) {
        context.push('No hay datos de inventario disponibles para responder.');
      }
    }

    const userMessage = `Contexto actual del inventario:\n${context.join('\n')}\n\nPregunta del usuario: ${question}\n\nResponde en español de manera clara y profesional, usando los datos proporcionados.`;

    try {
      const response = await getClient().chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt() },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 500,
        temperature: 0.3,
      });

      return {
        answer: response.choices[0]?.message?.content ?? 'Lo siento, no pude generar una respuesta.',
        data: { context },
        sources: [...new Set(sources)],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        answer: `Error al consultar la IA: ${message}`,
        sources: [],
      };
    }
  }

  /**
   * Razonamiento ejecutivo sobre el Executive Twin — T14 de gaps avanzados.
   *
   * A diferencia de `answerQuestion` (que razona sobre inventario y arma su
   * contexto con consultas ad-hoc), `reasonAbout` parte del twin ya calculado y
   * de los snapshots de engines cacheados en `executive_state.engineSnapshots`.
   * Eso lo hace barato — no reejecuta ningún engine — y auditable: cada
   * respuesta viene con sus fuentes (`engineId` + score + confianza).
   *
   * Degradación en tres niveles, siempre devolviendo una respuesta útil:
   *  1. Sin twin todavía → resumen heurístico de "aún no hay lectura del grupo".
   *  2. Sin la feature `ai_copilot` del tier → resumen heurístico determinista.
   *  3. Con feature pero sin `OPENAI_API_KEY` o con error del proveedor →
   *     el mismo resumen heurístico, marcando `degradedReason`.
   *
   * `answerQuestion` no se toca: son dos superficies distintas.
   */
  static async reasonAbout(params: {
    question: string;
    companyId: string;
  }): Promise<ReasonedAnswer> {
    const { question, companyId } = params;

    const twin = await ExecutiveTwinEngine.getLatest(companyId);
    if (!twin) {
      return {
        question,
        answer:
          'Todavía no hay una lectura del grupo. El gemelo ejecutivo se calcula con el cron de recálculo; ' +
          'en cuanto exista la primera lectura, esta respuesta se apoyará en datos reales.',
        mode: 'heuristic',
        degraded: true,
        degradedReason: 'no_twin',
        sources: [],
        keyFacts: [],
        priorities: [],
        twinSnapshot: {},
        generatedAt: new Date().toISOString(),
      };
    }

    const snapshots = twin.executiveState?.engineSnapshots ?? {};
    const sources = buildReasoningSources(twin, snapshots);
    const priorities = collectEnginePriorities(snapshots);
    const keyFacts = buildTwinFacts(twin);
    const twinSnapshot = twinDimensions(twin);

    const base = {
      question,
      sources,
      keyFacts,
      priorities,
      twinSnapshot,
      generatedAt: new Date().toISOString(),
    };

    const gate = await TierService.getFeatureGate(companyId, REASONING_FEATURE);
    if (!gate.allowed) {
      return {
        ...base,
        answer: heuristicAnswer(question, twin, keyFacts, priorities),
        mode: 'heuristic',
        degraded: true,
        degradedReason: gate.reason,
      };
    }

    if (!process.env.OPENAI_API_KEY) {
      return {
        ...base,
        answer: heuristicAnswer(question, twin, keyFacts, priorities),
        mode: 'heuristic',
        degraded: true,
        degradedReason: 'missing_api_key',
      };
    }

    const engineContext = sources
      .map(
        (s) =>
          `- ${s.label} (${s.engineId}): score ${s.score}/100, confianza ${s.confidence}/100.` +
          (s.insights.length ? ` Hallazgos: ${s.insights.join('; ')}` : ''),
      )
      .join('\n');

    const priorityContext = priorities
      .map((p) => `- [${p.impact}] ${p.title} — ${p.description} (fuente: ${p.engineId})`)
      .join('\n');

    const userMessage = [
      'Estado del grupo (gemelo ejecutivo):',
      keyFacts.map((f) => `- ${f}`).join('\n'),
      '',
      engineContext ? `Lecturas de engines:\n${engineContext}` : 'Lecturas de engines: ninguna todavía.',
      '',
      priorityContext ? `Prioridades detectadas:\n${priorityContext}` : 'Prioridades detectadas: ninguna.',
      '',
      `Pregunta del director: ${question}`,
      '',
      'Responde en español, máximo 6 frases. Cita los números que uses y no inventes datos ' +
        'que no estén arriba. Cierra con una recomendación concreta.',
    ].join('\n');

    try {
      const response = await getClient().chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: reasoningSystemPrompt() },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 600,
        temperature: 0.2,
      });

      const answer = response.choices[0]?.message?.content?.trim();
      if (!answer) {
        return {
          ...base,
          answer: heuristicAnswer(question, twin, keyFacts, priorities),
          mode: 'heuristic',
          degraded: true,
          degradedReason: 'empty_completion',
        };
      }

      return { ...base, answer, mode: 'llm', degraded: false, degradedReason: null };
    } catch (error: unknown) {
      // El proveedor cayó: la respuesta heurística sigue siendo mejor que un 500.
      return {
        ...base,
        answer: heuristicAnswer(question, twin, keyFacts, priorities),
        mode: 'heuristic',
        degraded: true,
        degradedReason: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// ── reasonAbout: contratos y helpers ────────────────────────────────────────

/** Feature del tier que habilita el razonamiento con LLM. */
const REASONING_FEATURE = 'ai_copilot';

export interface ReasoningSource {
  engineId: EngineId;
  label: string;
  score: number;
  confidence: number;
  insights: string[];
  generatedAt: string | null;
}

export interface ReasoningPriority {
  engineId: EngineId;
  title: string;
  description: string;
  impact: ImpactLevel;
  estimatedSavingsCents: number | null;
  actionUrl: string | null;
}

export interface ReasonedAnswer {
  question: string;
  answer: string;
  /** `llm` = razonado con el proveedor; `heuristic` = resumen determinista. */
  mode: 'llm' | 'heuristic';
  degraded: boolean;
  /** Motivo de la degradación (gate del tier, falta de API key, error). */
  degradedReason: string | null;
  sources: ReasoningSource[];
  keyFacts: string[];
  priorities: ReasoningPriority[];
  twinSnapshot: Record<string, number>;
  generatedAt: string;
}

const ENGINE_LABELS: Record<EngineId, string> = {
  operations: 'Operaciones',
  finance: 'Finanzas',
  compliance: 'Cumplimiento',
  workforce: 'Personal',
  maintenance: 'Mantenimiento',
  brand: 'Marca',
  knowledge: 'Conocimiento',
  procurement: 'Compras e inventario',
};

const REASONING_IMPACT_RANK: Record<ImpactLevel, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

function reasoningSystemPrompt(): string {
  return `Eres el copiloto ejecutivo de Pulso para un grupo restaurantero.
Razonas sobre el estado consolidado del grupo (gemelo ejecutivo) y las lecturas de los engines.
Solo usas los datos que se te entregan; si un dato no está, lo dices en vez de inventarlo.
Hablas al dueño u operador en español, directo y sin jerga, priorizando dinero y riesgo.`;
}

function twinDimensions(twin: ExecutiveTwin): Record<string, number> {
  return {
    healthScore: twin.healthScore,
    driftScore: twin.driftScore,
    operationalRisk: twin.operationalRisk,
    complianceRisk: twin.complianceRisk,
    peopleRisk: twin.peopleRisk,
    liquidityRisk: twin.liquidityRisk,
    executionCapacity: twin.executionCapacity,
    brandConsistency: twin.brandConsistency,
    knowledgeIndex: twin.knowledgeIndex,
    expansionReadiness: twin.expansionReadiness,
    playbookCount: twin.playbookCount,
    projectedCashFlowCents: twin.projectedCashFlowCents,
    upcomingObligationsCents: twin.upcomingObligationsCents,
  };
}

function reasoningPesos(cents: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100));
}

function buildTwinFacts(twin: ExecutiveTwin): string[] {
  return [
    `Salud del grupo: ${twin.healthScore}/100 (deriva ${twin.driftScore}/100).`,
    `Riesgos — operativo ${twin.operationalRisk}/100, cumplimiento ${twin.complianceRisk}/100, personal ${twin.peopleRisk}/100, liquidez ${twin.liquidityRisk}/100.`,
    `Capacidad de ejecución ${twin.executionCapacity}/100, consistencia de marca ${twin.brandConsistency}/100.`,
    `Flujo proyectado ${reasoningPesos(twin.projectedCashFlowCents)} frente a ${reasoningPesos(twin.upcomingObligationsCents)} en obligaciones próximas.`,
    `Playbooks corporativos activos: ${twin.playbookCount}.`,
    `Última lectura del gemelo: ${twin.lastUpdated instanceof Date ? twin.lastUpdated.toISOString() : String(twin.lastUpdated)}.`,
  ];
}

function buildReasoningSources(
  twin: ExecutiveTwin,
  snapshots: Partial<Record<EngineId, EngineOutput>>,
): ReasoningSource[] {
  return Object.entries(snapshots)
    .flatMap(([engineId, output]) => {
      if (!output) return [];
      const id = engineId as EngineId;
      return [
        {
          engineId: id,
          label: ENGINE_LABELS[id] ?? id,
          score: output.score,
          confidence: output.confidence,
          insights: (output.insights ?? []).slice(0, 3),
          generatedAt:
            output.generatedAt instanceof Date
              ? output.generatedAt.toISOString()
              : (output.generatedAt as unknown as string | null) ?? null,
        },
      ];
    })
    .sort((a, b) => b.confidence - a.confidence);
}

function collectEnginePriorities(
  snapshots: Partial<Record<EngineId, EngineOutput>>,
): ReasoningPriority[] {
  return Object.entries(snapshots)
    .flatMap(([engineId, output]) =>
      (output?.priorities ?? []).map((p) => ({
        engineId: engineId as EngineId,
        title: p.title,
        description: p.description,
        impact: p.impact,
        estimatedSavingsCents: p.estimatedSavingsCents ?? null,
        actionUrl: p.actionUrl ?? null,
      })),
    )
    .sort((a, b) => REASONING_IMPACT_RANK[b.impact] - REASONING_IMPACT_RANK[a.impact])
    .slice(0, 8);
}

/**
 * Resumen determinista cuando no hay LLM disponible (tier sin `ai_copilot`,
 * sin API key, o el proveedor falló). No pretende responder la pregunta: expone
 * el estado real y la prioridad más alta, que es lo accionable.
 */
function heuristicAnswer(
  question: string,
  twin: ExecutiveTwin,
  keyFacts: string[],
  priorities: ReasoningPriority[],
): string {
  const riesgos: Array<[string, number]> = [
    ['liquidez', twin.liquidityRisk],
    ['cumplimiento', twin.complianceRisk],
    ['operación', twin.operationalRisk],
    ['personal', twin.peopleRisk],
  ];
  const [peorNombre, peorValor] = riesgos.sort((a, b) => b[1] - a[1])[0];

  const lineas = [
    `Sobre "${question.trim()}", esto es lo que dice el estado del grupo hoy:`,
    ...keyFacts.slice(0, 4).map((f) => `• ${f}`),
    peorValor >= 25
      ? `El frente más expuesto es ${peorNombre} (${peorValor}/100).`
      : `Ningún frente supera 25/100 de riesgo; el grupo está estable.`,
  ];

  if (priorities.length > 0) {
    const top = priorities[0];
    lineas.push(
      `Prioridad número uno (${top.impact}, ${ENGINE_LABELS[top.engineId] ?? top.engineId}): ${top.title} — ${top.description}`,
    );
  } else {
    lineas.push(
      twin.playbookCount === 0
        ? 'Sin prioridades de engines todavía. Publica tu primer playbook corporativo para fijar el estándar del grupo.'
        : 'Sin prioridades de engines todavía; revisa el benchmarking por sucursal.',
    );
  }

  return lineas.join('\n');
}
