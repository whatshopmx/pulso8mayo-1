import OpenAI from 'openai';
import { db } from '@/lib/db';
import { companies, branches } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { KnowledgeService } from './knowledge-service';
import { ExecutiveReportService, type BranchKPI } from './executive-report-service';

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
}
