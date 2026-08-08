/**
 * MorningBriefService — el "momento CEO" de las 7:00 AM.
 *
 * Fuente: docs/pulso-executive-os-v2.md §8.5 y §9.2.
 *
 * El brief es un documento DERIVADO, no una consulta ad-hoc: el cron
 * `generate-morning-brief` lo calcula una vez al día y lo persiste en
 * `morning_briefs`; el dashboard solo lee la última fila. Esto lo hace
 * determinista (dos personas ven el mismo brief), cacheable, y mantiene el
 * render de la página fuera del camino de los cálculos pesados.
 *
 * Reutiliza los tipos `MorningBrief` / `BriefPriority` / `BriefSection` que ya
 * existían en `lib/services/intelligence/types.ts` desde el Sprint 1 — no se
 * redefine el contrato.
 *
 * Degradación: si un engine todavía no corrió, su snapshot falta y el brief se
 * genera igual con los KPIs reales del twin. Un grupo recién onboardeado debe
 * recibir su brief aunque los 5 engines estén vacíos.
 */
import { db } from "@/lib/db";
import { morningBriefs } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { ExecutiveTwinEngine } from "./executive-twin-engine";
import { CrossBranchService } from "./cross-branch-service";
import type {
  MorningBrief,
  BriefPriority,
  BriefSection,
  ExecutiveTwin,
  EngineId,
  EngineOutput,
  ImpactLevel,
} from "./intelligence/types";

/** Zona del grupo — los briefs se fechan en hora local, no en UTC. */
const GROUP_TIMEZONE = "America/Mexico_City";

/** Fecha ISO (yyyy-mm-dd) en la zona del grupo. */
export function groupDateISO(date = new Date()): string {
  // en-CA formatea como yyyy-mm-dd, que es exactamente el ISO date que se
  // guarda en `morning_briefs.brief_date`.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: GROUP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

const MXN = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

function pesos(cents: number): string {
  return MXN.format(Math.round(cents / 100));
}

/** Riesgo 0–100 → nivel de impacto para ordenar prioridades. */
function riskToImpact(risk: number): ImpactLevel {
  if (risk >= 75) return "CRITICAL";
  if (risk >= 50) return "HIGH";
  if (risk >= 25) return "MEDIUM";
  return "LOW";
}

const IMPACT_RANK: Record<ImpactLevel, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

export interface BriefRow {
  id: string;
  companyId: string;
  briefDate: string;
  brief: MorningBrief;
  twinSnapshot: Record<string, unknown>;
  generatedAt: Date;
  deliveredAt: Date | null;
}

export const MorningBriefService = {
  /**
   * Construye el brief del día y lo persiste (UPSERT por (compañía, fecha), de
   * modo que un reintento de Inngest lo regenera en vez de duplicarlo).
   */
  async generate(companyId: string, date = new Date()): Promise<BriefRow | null> {
    const twin = await ExecutiveTwinEngine.getLatest(companyId);
    if (!twin) return null;

    const briefDate = groupDateISO(date);
    const [compliance, incidents, merma] = await Promise.all([
      CrossBranchService.getAllBranchesCompliance(companyId).catch(() => []),
      CrossBranchService.getAllBranchesIncidentesActivos(companyId).catch(() => []),
      CrossBranchService.getAllBranchesMerma(companyId).catch(() => []),
    ]);

    const snapshots = twin.executiveState?.engineSnapshots ?? {};
    const priorities = buildPriorities(twin, snapshots);
    const sections = buildSections(twin, compliance, incidents, merma);
    const headline = buildHeadline(twin, priorities);

    const brief: MorningBrief = {
      id: "", // se rellena con el id de la fila al persistir
      companyId,
      date: briefDate,
      headline,
      priorities,
      sections,
      twinSnapshot: {
        healthScore: twin.healthScore,
        operationalRisk: twin.operationalRisk,
        complianceRisk: twin.complianceRisk,
        liquidityRisk: twin.liquidityRisk,
      },
      generatedAt: new Date(),
      deliveredAt: null,
    };

    const [row] = await db
      .insert(morningBriefs)
      .values({
        companyId,
        briefDate,
        brief: brief as unknown as Record<string, unknown>,
        twinSnapshot: {
          healthScore: twin.healthScore,
          driftScore: twin.driftScore,
          operationalRisk: twin.operationalRisk,
          complianceRisk: twin.complianceRisk,
          peopleRisk: twin.peopleRisk,
          liquidityRisk: twin.liquidityRisk,
          executionCapacity: twin.executionCapacity,
          brandConsistency: twin.brandConsistency,
          playbookCount: twin.playbookCount,
          projectedCashFlowCents: twin.projectedCashFlowCents,
          upcomingObligationsCents: twin.upcomingObligationsCents,
        },
        generatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [morningBriefs.companyId, morningBriefs.briefDate],
        set: {
          brief: brief as unknown as Record<string, unknown>,
          generatedAt: new Date(),
        },
      })
      .returning();

    if (!row) return null;
    return toBriefRow(row);
  },

  async getLatest(companyId: string): Promise<BriefRow | null> {
    const [row] = await db
      .select()
      .from(morningBriefs)
      .where(eq(morningBriefs.companyId, companyId))
      .orderBy(desc(morningBriefs.briefDate))
      .limit(1);
    return row ? toBriefRow(row) : null;
  },

  /** Brief de una fecha concreta (yyyy-mm-dd), para el "vs ayer". */
  async getByDate(companyId: string, briefDate: string): Promise<BriefRow | null> {
    const [row] = await db
      .select()
      .from(morningBriefs)
      .where(
        and(
          eq(morningBriefs.companyId, companyId),
          eq(morningBriefs.briefDate, briefDate),
        ),
      )
      .limit(1);
    return row ? toBriefRow(row) : null;
  },

  async getHistory(companyId: string, limit = 14): Promise<BriefRow[]> {
    const rows = await db
      .select()
      .from(morningBriefs)
      .where(eq(morningBriefs.companyId, companyId))
      .orderBy(desc(morningBriefs.briefDate))
      .limit(Math.min(limit, 90));
    return rows.map(toBriefRow);
  },

  async markDelivered(briefId: string): Promise<void> {
    await db
      .update(morningBriefs)
      .set({ deliveredAt: new Date() })
      .where(eq(morningBriefs.id, briefId));
  },

  /**
   * Feed de decisiones: prioridades consolidadas de todos los engines, sin el
   * recorte a 3 que hace el brief. Se calcula en caliente sobre los snapshots
   * ya cacheados en el twin, así que no golpea servicios pesados.
   */
  async getDecisionFeed(companyId: string, limit = 20) {
    const twin = await ExecutiveTwinEngine.getLatest(companyId);
    if (!twin) return [];

    const snapshots = twin.executiveState?.engineSnapshots ?? {};
    const items = Object.entries(snapshots).flatMap(([engineId, output]) => {
      if (!output) return [];
      return (output.priorities ?? []).map((p) => ({
        id: `${engineId}:${p.id}`,
        engineId: engineId as EngineId,
        engineScore: output.score,
        confidence: output.confidence,
        title: p.title,
        description: p.description,
        impact: p.impact,
        estimatedSavingsCents: p.estimatedSavingsCents ?? null,
        actionUrl: p.actionUrl ?? null,
        generatedAt: output.generatedAt,
      }));
    });

    return items
      .sort((a, b) => IMPACT_RANK[b.impact] - IMPACT_RANK[a.impact])
      .slice(0, limit);
  },
} as const;

// ── internals ───────────────────────────────────────────────────────────────

function toBriefRow(row: typeof morningBriefs.$inferSelect): BriefRow {
  const brief = (row.brief ?? {}) as unknown as MorningBrief;
  return {
    id: row.id,
    companyId: row.companyId,
    briefDate: row.briefDate,
    // El id del brief se conoce hasta que la fila existe; se rellena al leer
    // para que el consumidor siempre tenga un id utilizable.
    brief: { ...brief, id: row.id },
    twinSnapshot: (row.twinSnapshot ?? {}) as Record<string, unknown>,
    generatedAt: row.generatedAt,
    deliveredAt: row.deliveredAt,
  };
}

/**
 * Las 3 prioridades del día.
 *
 * Preferencia: prioridades reales de los engines. Si ningún engine ha corrido,
 * se derivan de las dimensiones del twin — el dueño ve algo accionable desde el
 * primer día en vez de una tarjeta vacía.
 */
function buildPriorities(
  twin: ExecutiveTwin,
  snapshots: Partial<Record<EngineId, EngineOutput>>,
): BriefPriority[] {
  const fromEngines = Object.entries(snapshots).flatMap(([engineId, output]) =>
    (output?.priorities ?? []).map((p) => ({
      engineId,
      title: p.title,
      why: p.description,
      recommendedAction: p.description,
      impact: p.impact,
      estimatedSavingsCents: p.estimatedSavingsCents,
      actionUrl: p.actionUrl,
      deadline: p.deadline,
    })),
  );

  const candidates = fromEngines.length > 0
    ? fromEngines
    : derivedPriorities(twin);

  return candidates
    .sort((a, b) => IMPACT_RANK[b.impact] - IMPACT_RANK[a.impact])
    .slice(0, 3)
    .map((p, i) => ({
      rank: i + 1,
      title: p.title,
      why: p.why,
      recommendedAction: p.recommendedAction,
      impact: p.impact,
      estimatedSavingsCents: p.estimatedSavingsCents,
      actionUrl: p.actionUrl,
      deadline: p.deadline,
    }));
}

/** Heurística de respaldo cuando aún no hay snapshots de engines. */
function derivedPriorities(twin: ExecutiveTwin): Omit<BriefPriority, "rank">[] {
  const out: Omit<BriefPriority, "rank">[] = [];

  if (twin.liquidityRisk >= 25) {
    out.push({
      title: "Revisar liquidez de los próximos 14 días",
      why: `Riesgo de liquidez en ${twin.liquidityRisk}/100 con ${pesos(
        twin.upcomingObligationsCents,
      )} en obligaciones próximas.`,
      recommendedAction:
        "Abre la proyección de flujo y confirma qué pagos pueden reprogramarse.",
      impact: riskToImpact(twin.liquidityRisk),
      actionUrl: "/dashboard/finance/cash-flow",
    });
  }

  if (twin.complianceRisk >= 25) {
    out.push({
      title: "Cerrar brechas de cumplimiento",
      why: `Riesgo de cumplimiento en ${twin.complianceRisk}/100.`,
      recommendedAction:
        "Revisa las sucursales con checklists vencidos y reasigna responsables.",
      impact: riskToImpact(twin.complianceRisk),
      actionUrl: "/dashboard/compliance",
    });
  }

  if (twin.operationalRisk >= 25) {
    out.push({
      title: "Atender la ejecución operativa",
      why: `Riesgo operativo en ${twin.operationalRisk}/100 con capacidad de ejecución de ${twin.executionCapacity}/100.`,
      recommendedAction:
        "Revisa el ranking de sucursales y ataca primero la de menor cumplimiento.",
      impact: riskToImpact(twin.operationalRisk),
      actionUrl: "/dashboard/executive",
    });
  }

  if (twin.peopleRisk >= 25) {
    out.push({
      title: "Revisar riesgo de personal",
      why: `Riesgo de personal en ${twin.peopleRisk}/100.`,
      recommendedAction: "Revisa ausencias, retardos y documentos por vencer.",
      impact: riskToImpact(twin.peopleRisk),
      actionUrl: "/dashboard/team",
    });
  }

  if (out.length === 0) {
    out.push({
      title: "Sin riesgos altos: consolidar el estándar",
      why: `Salud del grupo en ${twin.healthScore}/100 y ningún riesgo por encima de 25.`,
      recommendedAction:
        twin.playbookCount === 0
          ? "Publica tu primer playbook corporativo para fijar el estándar del grupo."
          : "Revisa el benchmarking y replica la práctica de la mejor sucursal.",
      impact: "LOW",
      actionUrl:
        twin.playbookCount === 0
          ? "/dashboard/company/playbooks"
          : "/dashboard/executive",
    });
  }

  return out;
}

function buildSections(
  twin: ExecutiveTwin,
  compliance: { branchName: string; completionRate: number }[],
  incidents: { branchName: string; activeIncidents: number; criticalCount: number }[],
  merma: { branchName: string; totalLossCents: number }[],
): BriefSection[] {
  const sections: BriefSection[] = [];

  const avgCompliance = compliance.length
    ? Math.round(
        compliance.reduce((s, c) => s + c.completionRate, 0) / compliance.length,
      )
    : 0;
  const worst = [...compliance].sort((a, b) => a.completionRate - b.completionRate)[0];

  sections.push({
    id: "operaciones",
    title: "Operaciones",
    body: compliance.length
      ? `Cumplimiento promedio del grupo en ${avgCompliance}%. La sucursal más rezagada es ${worst.branchName} con ${Math.round(worst.completionRate)}%.`
      : "Aún no hay ejecuciones de workflows registradas para medir cumplimiento.",
    metrics: [
      { label: "Cumplimiento promedio", value: `${avgCompliance}%` },
      { label: "Capacidad de ejecución", value: `${twin.executionCapacity}/100` },
      { label: "Sucursales medidas", value: String(compliance.length) },
    ],
  });

  const totalIncidents = incidents.reduce((s, i) => s + i.activeIncidents, 0);
  const criticals = incidents.reduce((s, i) => s + i.criticalCount, 0);

  sections.push({
    id: "riesgo",
    title: "Riesgo y cumplimiento",
    body:
      totalIncidents === 0
        ? "Sin incidentes activos en el grupo."
        : `${totalIncidents} incidentes activos, ${criticals} de ellos críticos.`,
    metrics: [
      { label: "Riesgo operativo", value: `${twin.operationalRisk}/100` },
      { label: "Riesgo de cumplimiento", value: `${twin.complianceRisk}/100` },
      { label: "Riesgo de personal", value: `${twin.peopleRisk}/100` },
    ],
  });

  const totalMerma = merma.reduce((s, m) => s + m.totalLossCents, 0);

  sections.push({
    id: "liquidez",
    title: "Dinero",
    body: `Flujo proyectado de ${pesos(twin.projectedCashFlowCents)} frente a ${pesos(
      twin.upcomingObligationsCents,
    )} en obligaciones próximas. Merma acumulada del periodo: ${pesos(totalMerma)}.`,
    metrics: [
      { label: "Riesgo de liquidez", value: `${twin.liquidityRisk}/100` },
      { label: "Flujo proyectado", value: pesos(twin.projectedCashFlowCents) },
      { label: "Merma", value: pesos(totalMerma) },
    ],
  });

  return sections;
}

function buildHeadline(twin: ExecutiveTwin, priorities: BriefPriority[]): string {
  const critical = priorities.filter((p) => p.impact === "CRITICAL").length;
  const high = priorities.filter((p) => p.impact === "HIGH").length;

  if (critical > 0) {
    return `Atención: ${critical} asunto${critical > 1 ? "s" : ""} crítico${critical > 1 ? "s" : ""} hoy. Salud del grupo ${twin.healthScore}/100.`;
  }
  if (high > 0) {
    return `Día con ${high} prioridad${high > 1 ? "es" : ""} alta${high > 1 ? "s" : ""}. Salud del grupo ${twin.healthScore}/100.`;
  }
  return `Día estable. Salud del grupo ${twin.healthScore}/100.`;
}
