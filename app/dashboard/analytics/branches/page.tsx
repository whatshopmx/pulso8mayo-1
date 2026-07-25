"use client";

import * as React from "react";
import { PageHeader, PageContainer } from "@/components/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BranchComparisonChart } from "@/components/analytics/branch-comparison-chart";
import { BranchRankingTable } from "@/components/analytics/branch-ranking-table";
import { BranchPerformanceScoreCard } from "@/components/analytics/branch-performance-score-card";
import { Store, Filter } from "lucide-react";

interface BranchData {
  branchId: string;
  branchName: string;
  workflowMetrics: { completionRate: number };
  complianceScore: number;
  assignmentMetrics: { completionRate: number };
  performanceIndex: number;
}

export default function BranchPerformancePage() {
  const [period, setPeriod] = React.useState("30d");
  const [branches, setBranches] = React.useState<BranchData[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    setLoading(true);
    fetch(`/api/analytics/branch-performance?period=${period}`)
      .then((res) => res.json())
      .then((data) => {
        setBranches(data.branches || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [period]);

  return (
    <PageContainer>
      <PageHeader
        title="Performance por Sucursal"
        description="Comparativa de rendimiento entre sucursales"
        icon={Store}
        actions={
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">7 días</SelectItem>
                <SelectItem value="30d">30 días</SelectItem>
                <SelectItem value="90d">90 días</SelectItem>
                <SelectItem value="ytd">YTD</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />

      {/* Score Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {loading
          ? Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-6">
                  <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                    Cargando...
                  </div>
                </CardContent>
              </Card>
            ))
          : branches.map((branch) => (
              <BranchPerformanceScoreCard
                key={branch.branchId}
                branchId={branch.branchId}
                branchName={branch.branchName}
                performanceIndex={branch.performanceIndex}
                dimensions={[
                  {
                    label: "Tareas",
                    value: branch.workflowMetrics.completionRate,
                    maxValue: 100,
                  },
                  {
                    label: "Cumplimiento",
                    value: branch.complianceScore,
                    maxValue: 100,
                  },
                  {
                    label: "Asignaciones",
                    value: branch.assignmentMetrics.completionRate,
                    maxValue: 100,
                  },
                ]}
              />
            ))}
      </div>

      {/* Chart + Ranking */}
      <div className="grid gap-4 md:grid-cols-2 mt-6">
        <BranchComparisonChart period={period} />
        <BranchRankingTable period={period} />
      </div>
    </PageContainer>
  );
}
