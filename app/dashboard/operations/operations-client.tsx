"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { OperationsTabs } from "@/components/dashboard/operations/operations-tabs";
import { useBranch } from "@/lib/branch-context";
import { TemperatureMonitor } from "@/components/dashboard/operations/temperature-monitor";

export default function OperationsClient() {
  const searchParams = useSearchParams();
  // Branch scope now flows from the header BranchScopeControl (AD-1): the
  // cookie ("all" => null) replaces the retired ?branch= URL param.
  const { selectedBranchId } = useBranch();
  const branchId = selectedBranchId ?? "all";
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const [recentWorkflows, setRecentWorkflows] = useState<any[]>([]);

  const period = (() => {
    if (!startDate) return "30d";
    const now = new Date();
    const start = new Date(startDate);
    const diffDays = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 1) return "7d";
    if (diffDays <= 8) return "7d";
    if (diffDays <= 32) return "30d";
    return "90d";
  })();

  useEffect(() => {
    fetch('/api/reports/stats?days=30')
      .then(res => res.json())
      .then(data => {
        setRecentWorkflows(data.activeWorkflows || []);
      })
      .catch(() => {});
  }, [branchId]);

  return (
    <div className="flex flex-col gap-4 p-8">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h2 className="text-3xl font-bold tracking-tight">Panel de Operaciones</h2>
      </div>
      <TemperatureMonitor period={period} branchId={branchId} />
      <OperationsTabs recentWorkflows={recentWorkflows} period={period} branchId={branchId} />
    </div>
  );
}
