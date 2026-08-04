/**
 * ComplianceEngine — Sprint 2 Track A Task 4 (v2 §7).
 *
 * Facade over the EXISTING compliance/civil-protection/document aggregators. It
 * does NOT generate NOM reports (the `ComplianceReportService` generators mint
 * PDFs/Excel — too heavy for a 6-hourly engine pass and they are per-branch).
 * Instead it derives the compliance state from lighter aggregators:
 *
 *   - CrossBranchService.getAllBranchesCompliance → NOM-251 operational
 *     completion (complianceRate) + avg quality score.
 *   - CrossBranchService.getDocumentExpirations → expiring/expired employee
 *     documents (LFT/IMSS document currency).
 *   - EmployeeDocumentService.getMissingRequiredDocuments → count of missing
 *     mandatory employee documents (CONTRACT/ID/TAX_ID/BANK_INFO).
 *   - compliance_alerts (ACTIVE) grouped by complianceType → NOM-251 /
 *     NOM-035 / LABOR_LAW status.
 *   - civil-protection-service.getCivilProtectionKpis → simulacros, extintores,
 *     rutas de evacuación (NOM-002 / protección civil).
 *
 * Net-new (normalized to EngineOutput):
 *   - `inspectionReadiness`: 0–100 composite — how ready the group is for an
 *     unannounced inspection (regulator or licitativo).
 *   - `regulatoryCalendar`: upcoming compliance deadlines (expired/expiring
 *     documents, expired extinguishers, overdue workflows) the executive must
 *     not miss.
 *
 * Scope-aware via ctx?: AccessContext + branchVisibilityFilter (Pilar 4);
 * refresh() caches into corporate_twins.executive_state.engineSnapshots.compliance.
 *
 * Source: docs/pulso-executive-os-v2.md §7, docs/pulso-executive-os-security.md §10.
 */
import { db } from "@/lib/db";
import { branches, complianceAlerts } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { CrossBranchService } from "@/lib/services/cross-branch-service";
import { EmployeeDocumentService } from "@/lib/services/employee-document-service";
import { getCivilProtectionKpis } from "@/lib/services/civil-protection-service";
import { ExecutiveTwinEngine } from "@/lib/services/executive-twin-engine";
import { branchVisibilityFilter } from "@/lib/rbac/branch-visibility";
import type { AccessContext } from "@/lib/rbac/abac";
import type {
  EngineOutput,
  IntelligenceEngine,
  Priority,
  Risk,
} from "./types";

const CLAMP = (n: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, Math.round(n)));

export interface RegulatoryDeadline {
  date: string; // ISO date
  label: string;
  /** 'NOM-251' | 'NOM-035' | 'LABOR_LAW' | 'IMSS' | 'CIVIL_PROTECTION' | 'DOCUMENT' */
  type: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  branchId?: string;
  branchName?: string;
}

export interface ComplianceDomainStatus {
  /** Compliance alert type / domain key (NOM-251, NOM-035, LABOR_LAW). */
  domain: string;
  activeAlerts: number;
  status: "OK" | "WATCH" | "AT_RISK";
}

export interface ComplianceEngineOutput extends EngineOutput {
  complianceRisk: number;
  inspectionReadiness: number;
  nom251Completion: number;
  domainStatus: ComplianceDomainStatus[];
  documentExpirations: { expiring: number; expired: number };
  missingRequiredDocuments: number;
  regulatoryCalendar: RegulatoryDeadline[];
}

export interface ComplianceEngineInput {
  companyId: string;
  ctx?: AccessContext;
}

export const ComplianceEngine: IntelligenceEngine<
  ComplianceEngineInput,
  ComplianceEngineOutput
> = {
  engineId: "compliance",
  engineName: "Compliance Engine",

  async analyze(input: ComplianceEngineInput): Promise<ComplianceEngineOutput> {
    const { companyId, ctx } = input;

    const allBranches = await db
      .select({
        id: branches.id,
        name: branches.name,
        ownershipType: branches.ownershipType,
        franchiseeUserId: branches.franchiseeUserId,
      })
      .from(branches)
      .where(eq(branches.companyId, companyId));

    const visibleBranchIds = ctx
      ? branchVisibilityFilter(
          ctx,
          allBranches.map((b) => ({
            id: b.id,
            ownershipType: (b.ownershipType ?? "OWNED") as "OWNED" | "FRANCHISE",
            franchiseeUserId: b.franchiseeUserId,
          })),
        )
      : allBranches.map((b) => b.id);

    const generatedAt = new Date();

    if (visibleBranchIds.length === 0) {
      return {
        score: 0,
        confidence: 0,
        insights: ["Sin sucursales visibles para evaluar cumplimiento."],
        priorities: [],
        risks: [],
        generatedAt,
        complianceRisk: 0,
        inspectionReadiness: 0,
        nom251Completion: 0,
        domainStatus: [],
        documentExpirations: { expiring: 0, expired: 0 },
        missingRequiredDocuments: 0,
        regulatoryCalendar: [],
      };
    }

    const [compliance, docExpirations, civilKpis, missingDocs, alertRows] =
      await Promise.all([
        CrossBranchService.getAllBranchesCompliance(companyId),
        CrossBranchService.getDocumentExpirations(companyId),
        // Civil-protection KPIs are company-wide (the helper accepts a single
        // branchId); for a multi-branch scope we read the group aggregate.
        visibleBranchIds.length === 1
          ? getCivilProtectionKpis(companyId, visibleBranchIds[0])
          : getCivilProtectionKpis(companyId),
        EmployeeDocumentService.getMissingRequiredDocuments(companyId),
        db
          .select({
            id: complianceAlerts.id,
            complianceType: complianceAlerts.complianceType,
            severity: complianceAlerts.severity,
            branchId: complianceAlerts.branchId,
          })
          .from(complianceAlerts)
          .where(
            and(
              eq(complianceAlerts.companyId, companyId),
              eq(complianceAlerts.status, "ACTIVE"),
              inArray(complianceAlerts.branchId, visibleBranchIds),
            ),
          ),
      ]);

    const complianceScoped = compliance.filter((c) =>
      visibleBranchIds.includes(c.branchId),
    );
    const docScoped = docExpirations.filter((d) =>
      visibleBranchIds.includes(d.branchId),
    );
    const alertScoped = alertRows;

    // NOM-251 operational completion (avg across scope).
    const nom251Completion =
      complianceScoped.length > 0
        ? Math.round(
            complianceScoped.reduce((a, c) => a + c.completionRate, 0) /
              complianceScoped.length,
          )
        : 0;
    const totalOverdue = complianceScoped.reduce(
      (a, c) => a + c.overdueWorkflows,
      0,
    );

    // Document currency (LFT/IMSS).
    const expiringDocs = docScoped.reduce((a, d) => a + d.expiringCount, 0);
    const expiredDocs = docScoped.reduce((a, d) => a + d.expiredCount, 0);

    // Domain status grouped by complianceType.
    const byType = new Map<string, number>();
    for (const a of alertScoped) {
      const key = a.complianceType ?? "OTHER";
      byType.set(key, (byType.get(key) ?? 0) + 1);
    }
    const domainStatus: ComplianceDomainStatus[] = [
      "NOM-251",
      "NOM-035",
      "LABOR_LAW",
      "IMSS",
    ].map((domain) => {
      const activeAlerts = byType.get(domain) ?? 0;
      return {
        domain,
        activeAlerts,
        status: activeAlerts === 0 ? "OK" : activeAlerts <= 2 ? "WATCH" : "AT_RISK",
      };
    });

    // CRITICAL and FATAL are the high-severity bands of the incident severity
    // enum (['CRITICAL','WARNING','FATAL'] — see lib/db/schema.ts).
    const highSeverityAlerts = alertScoped.filter(
      (a) => a.severity === "CRITICAL" || a.severity === "FATAL",
    ).length;

    // Civil-protection currency.
    const cpExpired = civilKpis.extinguishersExpired;
    const cpExpiring = civilKpis.extinguishersExpiringSoon;
    const exitsWithIssues = civilKpis.exitsWithIssues;

    // InspectionReadiness: weighted composite.
    //   40% NOM-251 completion, 20% documents current, 20% civil protection
    //   current, 20% low high-severity compliance alerts.
    const docCurrency = CLAMP(
      100 - (expiredDocs * 8 + expiringDocs * 3),
    );
    const cpCurrency = CLAMP(100 - (cpExpired * 10 + cpExpiring * 4 + exitsWithIssues * 3));
    const alertCurrency = CLAMP(100 - highSeverityAlerts * 12);
    const inspectionReadiness = CLAMP(
      nom251Completion * 0.4 +
        docCurrency * 0.2 +
        cpCurrency * 0.2 +
        alertCurrency * 0.2,
    );

    const complianceRisk = CLAMP(
      (100 - nom251Completion) * 0.5 +
        (expiredDocs + cpExpired) * 4 +
        highSeverityAlerts * 6 +
        Math.min(20, missingDocs.length),
    );

    // Regulatory calendar — upcoming deadlines (today = now).
    const now = new Date();
    const todayIso = now.toISOString();
    const regulatoryCalendar: RegulatoryDeadline[] = [];

    // Expired documents (immediate).
    if (expiredDocs > 0) {
      regulatoryCalendar.push({
        date: todayIso,
        label: `${expiredDocs} documento(s) laboral(es) vencido(s) — renovar (LFT/IMSS)`,
        type: "DOCUMENT",
        severity: expiredDocs > 3 ? "CRITICAL" : "HIGH",
      });
    }
    if (expiringDocs > 0) {
      const in7 = new Date(now.getTime() + 7 * 86400000).toISOString();
      regulatoryCalendar.push({
        date: in7,
        label: `${expiringDocs} documento(s) vencen en ≤7 días`,
        type: "DOCUMENT",
        severity: "MEDIUM",
      });
    }
    // Civil-protection expiring/extinguishers.
    if (cpExpired > 0) {
      regulatoryCalendar.push({
        date: todayIso,
        label: `${cpExpired} extintor(es) con inspección vencida (protección civil)`,
        type: "CIVIL_PROTECTION",
        severity: cpExpired > 2 ? "HIGH" : "MEDIUM",
      });
    }
    if (cpExpiring > 0) {
      const in30 = new Date(now.getTime() + 30 * 86400000).toISOString();
      regulatoryCalendar.push({
        date: in30,
        label: `${cpExpiring} extintor(es) vencen en ≤30 días`,
        type: "CIVIL_PROTECTION",
        severity: "LOW",
      });
    }
    // Overdue workflows (NOM-251 inspections).
    if (totalOverdue > 0) {
      regulatoryCalendar.push({
        date: todayIso,
        label: `${totalOverdue} workflow(s) de cumplimiento vencido(s) (NOM-251)`,
        type: "NOM-251",
        severity: totalOverdue > 5 ? "HIGH" : "MEDIUM",
      });
    }
    // Sort by date ascending.
    regulatoryCalendar.sort((a, b) => a.date.localeCompare(b.date));

    const confidence = CLAMP(
      Math.min(100, 40 + complianceScoped.length * 10 + alertScoped.length),
    );

    const insights: string[] = [];
    insights.push(
      `Inspection readiness del grupo: ${inspectionReadiness}/100 ` +
        `(NOM-251 ${nom251Completion}% completado).`,
    );
    const atRisk = domainStatus.filter((d) => d.status === "AT_RISK");
    if (atRisk.length > 0) {
      insights.push(
        `Dominios en riesgo: ${atRisk.map((d) => d.domain).join(", ")} ` +
          `(${atRisk.reduce((a, d) => a + d.activeAlerts, 0)} alerta(s) activa(s)).`,
      );
    } else {
      insights.push("Sin dominios de cumplimiento en riesgo.");
    }
    if (expiredDocs > 0 || cpExpired > 0) {
      insights.push(
        `${expiredDocs + cpExpired} vencimiento(s) crítico(s) requieren acción inmediata.`,
      );
    }
    if (missingDocs.length > 0) {
      insights.push(
        `${missingDocs.length} documento(s) obligatorio(s) faltante(s) en empleados.`,
      );
    }

    // Priorities.
    const priorities: Priority[] = [];
    if (expiredDocs > 0 || cpExpired > 0) {
      priorities.push({
        id: "compliance-expired-critical",
        title: "Cerrar vencimientos críticos",
        description: `${expiredDocs} doc(s) + ${cpExpired} extintor(es) vencido(s).`,
        impact: "CRITICAL",
      });
    }
    if (atRisk.length > 0) {
      priorities.push({
        id: "compliance-at-risk-domains",
        title: "Atender dominios de cumplimiento en riesgo",
        description: atRisk.map((d) => d.domain).join(", "),
        impact: "HIGH",
      });
    }
    if (missingDocs.length > 0) {
      priorities.push({
        id: "compliance-missing-docs",
        title: "Completar expedientes de empleados",
        description: `${missingDocs.length} documento(s) obligatorio(s) faltante(s).`,
        impact: "MEDIUM",
      });
    }

    // Risks.
    const risks: Risk[] = [];
    if (inspectionReadiness < 60) {
      risks.push({
        type: "inspection-readiness-low",
        severity: inspectionReadiness < 40 ? "CRITICAL" : "HIGH",
        probability: 0.8,
        impactCents: 0,
        mitigation:
          "Cerrar workflows vencidos, renovar documentos y extintores antes de la próxima auditoría.",
      });
    }

    return {
      score: inspectionReadiness,
      confidence,
      insights,
      priorities,
      risks,
      generatedAt,
      complianceRisk,
      inspectionReadiness,
      nom251Completion,
      domainStatus,
      documentExpirations: { expiring: expiringDocs, expired: expiredDocs },
      missingRequiredDocuments: missingDocs.length,
      regulatoryCalendar,
    };
  },

  async getLatest(companyId: string): Promise<ComplianceEngineOutput | null> {
    const twin = await ExecutiveTwinEngine.getLatest(companyId);
    const snap = twin?.executiveState?.engineSnapshots?.compliance;
    return (snap as ComplianceEngineOutput | undefined) ?? null;
  },

  async refresh(companyId: string): Promise<ComplianceEngineOutput> {
    const output = await this.analyze({ companyId });
    await ExecutiveTwinEngine.setEngineSnapshot(companyId, this.engineId, output);
    return output;
  },
} as const;