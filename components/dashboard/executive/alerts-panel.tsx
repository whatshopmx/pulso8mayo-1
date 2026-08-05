/**
 * Alerts Panel — Executive Dashboard
 *
 * Scalable alerts grouped by severity level (Crítica, Advertencia, Info)
 * across 3 to 15+ branches to prevent visual clutter.
 *
 * Server Component.
 */

import Link from "next/link";
import { CrossBranchService } from "@/lib/services/cross-branch-service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Clock,
  FileWarning,
  ShieldAlert,
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
} from "lucide-react";

interface FlattenedAlert {
  id: string;
  branchId: string;
  branchName: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  icon: React.ElementType;
}

export async function AlertsPanel({ companyId }: { companyId: string }) {
  const [compliance, incidentes, docExpirations] = await Promise.all([
    CrossBranchService.getAllBranchesCompliance(companyId),
    CrossBranchService.getAllBranchesIncidentesActivos(companyId),
    CrossBranchService.getDocumentExpirations(companyId),
  ]);

  const items: FlattenedAlert[] = [];

  for (const b of compliance) {
    // Critical incidents
    const inc = incidentes.find((i) => i.branchId === b.branchId);
    if (inc && inc.activeIncidents > 0) {
      items.push({
        id: `inc-${b.branchId}`,
        branchId: b.branchId,
        branchName: b.branchName,
        severity: "critical",
        title: `${inc.activeIncidents} incidentes activos`,
        detail: inc.criticalCount + inc.fatalCount > 0 ? `${inc.criticalCount + inc.fatalCount} críticos` : "Revisión requerida",
        icon: AlertOctagon,
      });
    }

    // Low compliance score (<80%)
    if (b.totalWorkflows > 0 && b.avgScore < 80) {
      items.push({
        id: `score-${b.branchId}`,
        branchId: b.branchId,
        branchName: b.branchName,
        severity: "critical",
        title: `Score bajo: ${Math.round(b.avgScore)}%`,
        detail: "Cumplimiento NOM-251 bajo umbral",
        icon: ShieldAlert,
      });
    }

    // Overdue workflows
    if (b.overdueWorkflows > 0) {
      items.push({
        id: `overdue-${b.branchId}`,
        branchId: b.branchId,
        branchName: b.branchName,
        severity: "warning",
        title: `${b.overdueWorkflows} tareas vencidas`,
        detail: "Workflows sin completar",
        icon: Clock,
      });
    }

    // Expiring documents
    const docs = docExpirations.find((d) => d.branchId === b.branchId);
    if (docs && (docs.expiringCount > 0 || docs.expiredCount > 0)) {
      const parts: string[] = [];
      if (docs.expiredCount > 0) parts.push(`${docs.expiredCount} vencidos`);
      if (docs.expiringCount > 0) parts.push(`${docs.expiringCount} por vencer`);
      items.push({
        id: `doc-${b.branchId}`,
        branchId: b.branchId,
        branchName: b.branchName,
        severity: docs.expiredCount > 0 ? "warning" : "info",
        title: `Docs: ${parts.join(", ")}`,
        detail: "Permisos / certificados",
        icon: FileWarning,
      });
    }
  }

  const criticals = items.filter((i) => i.severity === "critical");
  const warnings = items.filter((i) => i.severity === "warning");
  const infos = items.filter((i) => i.severity === "info");

  if (items.length === 0) {
    return (
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            Alertas del Grupo
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            ✅ Operación estable. Sin alertas activas en ninguna sucursal.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border">
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          Alertas ({items.length})
        </CardTitle>
        <div className="flex items-center gap-1.5">
          {criticals.length > 0 && (
            <Badge variant="destructive" className="text-xs">
              {criticals.length} críticas
            </Badge>
          )}
          {warnings.length > 0 && (
            <Badge variant="outline" className="text-xs border-amber-500/50 text-amber-700 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-950/30">
              {warnings.length} adv.
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 max-h-[380px] overflow-y-auto pr-1">
        {/* Critical group */}
        {criticals.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-destructive flex items-center gap-1">
              <AlertOctagon className="h-3.5 w-3.5" />
              Atención Inmediata ({criticals.length})
            </p>
            <div className="space-y-1.5">
              {criticals.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-2 rounded-lg bg-red-50/50 dark:bg-red-950/20 border border-red-200/50 dark:border-red-900/30 text-xs"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Icon className="h-4 w-4 text-destructive shrink-0" />
                      <div className="truncate">
                        <Link
                          href={`/dashboard/branches?branchId=${item.branchId}`}
                          className="font-semibold text-foreground hover:underline mr-1.5"
                        >
                          {item.branchName}:
                        </Link>
                        <span className="text-foreground">{item.title}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Warnings group */}
        {warnings.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              Pendientes Operativos ({warnings.length})
            </p>
            <div className="space-y-1.5">
              {warnings.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-2 rounded-lg bg-amber-50/40 dark:bg-amber-950/20 border border-amber-200/40 dark:border-amber-900/30 text-xs"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Icon className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                      <div className="truncate">
                        <Link
                          href={`/dashboard/branches?branchId=${item.branchId}`}
                          className="font-semibold text-foreground hover:underline mr-1.5"
                        >
                          {item.branchName}:
                        </Link>
                        <span className="text-muted-foreground">{item.title}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Info group */}
        {infos.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <FileWarning className="h-3.5 w-3.5" />
              Informativas ({infos.length})
            </p>
            <div className="space-y-1.5">
              {infos.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-2 rounded-lg bg-muted/40 border border-border text-xs"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="truncate">
                        <Link
                          href={`/dashboard/branches?branchId=${item.branchId}`}
                          className="font-semibold text-foreground hover:underline mr-1.5"
                        >
                          {item.branchName}:
                        </Link>
                        <span className="text-muted-foreground">{item.title}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

