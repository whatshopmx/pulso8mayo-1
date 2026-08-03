/**
 * Alerts Panel — Executive Dashboard
 *
 * Cross-branch alerts grouped by branch: overdue workflows, low scores,
 * expiring documents, active critical incidents.
 *
 * Server Component.
 */

import { CrossBranchService } from "@/lib/services/cross-branch-service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Clock,
  FileWarning,
  ShieldAlert,
  AlertTriangle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BranchAlert {
  branchId: string;
  branchName: string;
  items: AlertItem[];
}

interface AlertItem {
  type: "overdue" | "low_score" | "critical_incident" | "expiring_docs";
  message: string;
  count?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export async function AlertsPanel({ companyId }: { companyId: string }) {
  const [compliance, incidentes, docExpirations] = await Promise.all([
    CrossBranchService.getAllBranchesCompliance(companyId),
    CrossBranchService.getAllBranchesIncidentesActivos(companyId),
    CrossBranchService.getDocumentExpirations(companyId),
  ]);

  const alerts: BranchAlert[] = [];

  for (const b of compliance) {
    const items: AlertItem[] = [];

    // Overdue workflows
    if (b.overdueWorkflows > 0) {
      items.push({
        type: "overdue",
        message: `${b.overdueWorkflows} tareas vencidas`,
        count: b.overdueWorkflows,
      });
    }

    // Low compliance score
    if (b.totalWorkflows > 0 && b.avgScore < 80) {
      items.push({
        type: "low_score",
        message: `Score bajo: ${Math.round(b.avgScore)}%`,
      });
    }

    // Critical incidents
    const inc = incidentes.find((i) => i.branchId === b.branchId);
    if (inc && inc.activeIncidents > 0) {
      items.push({
        type: "critical_incident",
        message: `${inc.activeIncidents} incidentes (${inc.criticalCount + inc.fatalCount} críticos)`,
        count: inc.activeIncidents,
      });
    }

    // Expiring documents
    const docs = docExpirations.find((d) => d.branchId === b.branchId);
    if (docs && (docs.expiringCount > 0 || docs.expiredCount > 0)) {
      const parts: string[] = [];
      if (docs.expiredCount > 0)
        parts.push(`${docs.expiredCount} vencidos`);
      if (docs.expiringCount > 0)
        parts.push(`${docs.expiringCount} por vencer`);
      items.push({
        type: "expiring_docs",
        message: `Docs: ${parts.join(", ")}`,
      });
    }

    if (items.length > 0) {
      alerts.push({
        branchId: b.branchId,
        branchName: b.branchName,
        items,
      });
    }
  }

  // Sort: branches with most critical items first
  alerts.sort((a, b) => {
    const aCrit = a.items.filter(
      (i) => i.type === "critical_incident" || i.type === "low_score",
    ).length;
    const bCrit = b.items.filter(
      (i) => i.type === "critical_incident" || i.type === "low_score",
    ).length;
    return bCrit - aCrit || b.items.length - a.items.length;
  });

  const iconMap: Record<AlertItem["type"], React.ElementType> = {
    overdue: Clock,
    low_score: ShieldAlert,
    critical_incident: AlertTriangle,
    expiring_docs: FileWarning,
  };

  const colorMap: Record<
    AlertItem["type"],
    "default" | "destructive" | "secondary" | "outline"
  > = {
    overdue: "default",
    low_score: "destructive",
    critical_incident: "destructive",
    expiring_docs: "secondary",
  };

  if (alerts.length === 0) {
    return (
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-lg">Alertas</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            ✅ Sin alertas activas en el grupo.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border border-l-4 border-l-amber-500">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          Alertas ({alerts.reduce((s, a) => s + a.items.length, 0)})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {alerts.map((alert) => (
          <div key={alert.branchId} className="space-y-1.5">
            <p className="text-sm font-semibold">{alert.branchName}</p>
            <div className="flex flex-wrap gap-1.5">
              {alert.items.map((item, idx) => {
                const Icon = iconMap[item.type];
                return (
                  <Badge
                    key={idx}
                    variant={colorMap[item.type]}
                    className="text-xs gap-1"
                  >
                    <Icon className="h-3 w-3" />
                    {item.message}
                  </Badge>
                );
              })}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
