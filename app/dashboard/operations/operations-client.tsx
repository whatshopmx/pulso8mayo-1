"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { OperationsTabs } from "@/components/dashboard/operations/operations-tabs";
import { useBranch } from "@/lib/branch-context";
import { loadRecentWorkflows } from "@/lib/ui/recent-workflows";
import type { WorkflowInstance } from "@/components/dashboard/recent-workflows-table";

export default function OperationsClient() {
  const searchParams = useSearchParams();
  // Branch scope now flows from the header BranchScopeControl (AD-1): the
  // cookie ("all" => null) replaces the retired ?branch= URL param.
  const { selectedBranchId } = useBranch();
  const branchId = selectedBranchId ?? "all";
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const [attempt, setAttempt] = useState(0);
  const [activity, setActivity] = useState<{ key: string; data: WorkflowInstance[]; error: string | null }>({ key: "", data: [], error: null });

  const period = (() => {
    if (!startDate) return "30d";
    const now = endDate ? new Date(endDate) : new Date();
    const start = new Date(startDate);
    const diffDays = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 1) return "7d";
    if (diffDays <= 8) return "7d";
    if (diffDays <= 32) return "30d";
    return "90d";
  })();

  const requestKey = `${branchId}:${period}:${attempt}`;
  useEffect(() => {
    const controller = new AbortController();
    loadRecentWorkflows(branchId, period.replace("d", ""), controller.signal)
      .then(data => { if (!controller.signal.aborted) setActivity({ key: requestKey, data, error: null }); })
      .catch(() => { if (!controller.signal.aborted) setActivity({ key: requestKey, data: [], error: "No se pudo cargar la actividad. Comprueba tu conexión y vuelve a intentarlo." }); });
    return () => controller.abort();
  }, [branchId, period, requestKey]);

  return (
    <div className="flex flex-col gap-4 p-8">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h2 className="text-3xl font-bold tracking-tight">Panel de Operaciones</h2>
      </div>
      <OperationsTabs recentWorkflows={activity.key === requestKey ? activity.data : []} period={period} branchId={branchId}
        activityLoading={activity.key !== requestKey} activityError={activity.key === requestKey ? activity.error : null}
        onActivityRetry={() => setAttempt(value => value + 1)} />
    </div>
  );
}
