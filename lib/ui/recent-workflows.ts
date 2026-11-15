import type { WorkflowInstance } from "@/components/dashboard/recent-workflows-table";

export async function loadRecentWorkflows(branchId: string, days: string, signal: AbortSignal): Promise<WorkflowInstance[]> {
  const params = new URLSearchParams({ days });
  if (branchId !== "all") params.set("branchId", branchId);
  const response = await fetch(`/api/reports/stats?${params}`, { signal });
  if (!response.ok) throw new Error("No se pudo cargar la actividad. Vuelve a intentarlo.");
  const data = await response.json();
  if (!Array.isArray(data.activeWorkflows)) throw new Error("La actividad recibida no es válida. Vuelve a intentarlo.");
  return data.activeWorkflows.map((row: Record<string, unknown>) => {
    if (!row || typeof row.id !== "string" || typeof (row.templateName ?? row.title) !== "string") {
      throw new Error("La actividad recibida no es válida. Vuelve a intentarlo.");
    }
    const timestamp = row.updatedAt ?? row.createdAt;
    const date = typeof timestamp === "string" ? new Date(timestamp) : null;
    return {
      id: row.id, templateName: String(row.templateName ?? row.title),
      status: typeof row.status === "string" ? row.status : null,
      score: typeof row.score === "number" ? row.score : null,
      assigneeName: typeof row.assigneeName === "string" ? row.assigneeName : null,
      updatedAt: date && Number.isFinite(date.getTime()) ? date : null,
    };
  });
}
