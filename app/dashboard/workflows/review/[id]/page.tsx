"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2, ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkflowReview, WorkflowReviewData } from "@/components/workflow/workflow-review";
import { resolveStepDefinitions } from "@/lib/workflows/step-definitions";
import { toast } from "sonner";

export default function WorkflowReviewPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [workflow, setWorkflow] = React.useState<WorkflowReviewData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Extraída fuera del efecto para que "Reintentar" pueda re-ejecutar la
  // misma carga; un fallo de fetch no debe dejar la página en un callejón
  // sin salida (heuristic 9: no retry).
  const fetchWorkflow = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch execution details
      const response = await fetch(`/api/workflows/executions/${params.id}`);

      if (!response.ok) {
        throw new Error('Failed to fetch workflow');
      }

      const execution = await response.json();

      // La instancia guarda la respuesta; la plantilla, la pregunta. Unirlas es
      // lo que convierte "Step <uuid>" en un paso legible — ver
      // `lib/workflows/step-definitions.ts`.
      const reviewData: WorkflowReviewData = {
        id: execution.id,
        templateName: execution.template?.name || 'Plantilla desconocida',
        assigneeName: execution.assignee?.name || null,
        branchName: execution.branch?.name || null,
        status: execution.status,
        score: execution.score,
        createdAt: execution.createdAt,
        completedAt: execution.completedAt,
        reviewStatus: execution.reviewStatus ?? null,
        reviewComment: execution.reviewComment ?? null,
        reviewedAt: execution.reviewedAt ?? null,
        steps: resolveStepDefinitions(execution.template?.steps, execution.steps ?? []),
      };

      setWorkflow(reviewData);
    } catch (err: any) {
      setError(err.message || 'Unknown error occurred');
      toast.error('Error loading workflow', {
        description: err.message,
      });
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  React.useEffect(() => {
    if (params.id) {
      fetchWorkflow();
    }
  }, [fetchWorkflow]);

  // El servidor ya redacta sus errores en español; los propagamos tal cual en
  // vez de inventar un mensaje genérico. WorkflowReview los muestra en el toast.
  const submitReview = async (
    workflowId: string,
    reviewStatus: 'APPROVED' | 'REJECTED',
    comment: string,
  ) => {
    const response = await fetch(`/api/workflows/executions/${workflowId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewStatus, reviewComment: comment }),
    });

    if (!response.ok) {
      const message = await response
        .json()
        .then((body) => body?.error)
        .catch(() => null);
      throw new Error(message || 'No pudimos guardar la revisión. Vuelve a intentarlo.');
    }

    // Volvemos al historial señalando la fila revisada, para que el revisor
    // vea el resultado de su acción en lugar de buscarla en la tabla.
    router.push(`/dashboard/workflows/history?revisada=${workflowId}`);
  };

  const handleApprove = (workflowId: string, comment: string) =>
    submitReview(workflowId, 'APPROVED', comment);

  const handleReject = (workflowId: string, comment: string) =>
    submitReview(workflowId, 'REJECTED', comment);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Cargando workflow...</p>
        </div>
      </div>
    );
  }

  if (error || !workflow) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Volver
          </Button>
        </div>
        <div className="text-center py-12">
          <p className="text-destructive text-lg">{error || 'Workflow no encontrado'}</p>
          <Button variant="outline" onClick={fetchWorkflow} className="mt-4">
            <RefreshCw className="h-4 w-4 mr-2" />
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Volver
        </Button>
        <div className="text-sm text-muted-foreground">
          Revisión de Workflow
        </div>
      </div>

      <WorkflowReview
        workflow={workflow}
        onApprove={handleApprove}
        onReject={handleReject}
      />
    </div>
  );
}
