"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkflowReview, WorkflowReviewData } from "@/components/workflow/workflow-review";
import { toast } from "sonner";

export default function WorkflowReviewPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [workflow, setWorkflow] = React.useState<WorkflowReviewData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const fetchWorkflow = async () => {
      try {
        // Fetch execution details
        const response = await fetch(`/api/workflows/executions/${params.id}`);
        
        if (!response.ok) {
          throw new Error('Failed to fetch workflow');
        }

        const execution = await response.json();

        // Transform to review format
        const reviewData: WorkflowReviewData = {
          id: execution.id,
          templateName: execution.template?.name || 'Unknown Template',
          assigneeName: execution.assignee?.name || null,
          branchName: execution.branch?.name || null,
          status: execution.status,
          score: execution.score,
          createdAt: execution.createdAt,
          completedAt: execution.completedAt,
          reviewStatus: execution.reviewStatus ?? null,
          reviewComment: execution.reviewComment ?? null,
          reviewedAt: execution.reviewedAt ?? null,
          steps: execution.steps.map((step: any) => ({
            id: step.id,
            stepId: step.stepId,
            title: step.title || `Step ${step.stepId}`,
            type: step.type || 'TEXT',
            status: step.status,
            value: step.value,
            evidenceUrl: step.evidenceUrl,
            aiAnalysis: step.aiAnalysis,
            comment: step.comment,
            completedAt: step.completedAt,
          })),
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
    };

    if (params.id) {
      fetchWorkflow();
    }
  }, [params.id]);

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
          <p className="text-red-500 text-lg">{error || 'Workflow not found'}</p>
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
