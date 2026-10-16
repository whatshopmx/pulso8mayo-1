"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkflowExecutor, WorkflowExecutionData } from "@/components/workflow/workflow-executor";
import { toast } from "sonner";
import { retryWorkflowCompletionEffects } from "@/app/actions/workflow-completion-recovery";

export default function WorkflowExecutionPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [execution, setExecution] = React.useState<WorkflowExecutionData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshError, setRefreshError] = React.useState(false);

  React.useEffect(() => {
    if (execution?.status !== 'COMPLETED' || !['pending', 'processing'].includes(execution.completionEffectsStatus ?? '')) return;
    const controller = new AbortController();
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/workflows/executions/${params.id}`, { signal: controller.signal });
        if (!response.ok) throw new Error('No se pudo actualizar el procesamiento');
        const data = await response.json();
        if (!controller.signal.aborted) { setExecution(data); setRefreshError(false); }
      } catch { if (!controller.signal.aborted) setRefreshError(true); }
    }, 5000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [params.id, execution?.status, execution?.completionEffectsStatus]);

  React.useEffect(() => {
    const fetchExecution = async () => {
      try {
        const response = await fetch(`/api/workflows/executions/${params.id}`);
        
        if (!response.ok) {
          throw new Error('Failed to fetch workflow execution');
        }

        const data = await response.json();
        setExecution(data);
      } catch (err: any) {
        setError(err.message || 'Unknown error occurred');
        toast.error('Error loading workflow execution', {
          description: err.message,
        });
      } finally {
        setLoading(false);
      }
    };

    if (params.id) {
      fetchExecution();
    }
  }, [params.id]);

  const handleStepComplete = async (stepId: string, result: any) => {
    // Refresh execution data
    try {
      const response = await fetch(`/api/workflows/executions/${params.id}`);
      if (response.ok) {
        const data = await response.json();
        setExecution(data);
      }
    } catch (error) {
      console.error('Failed to refresh execution:', error);
    }
  };

  const handleComplete = async () => {
    try {
      const checkRes = await fetch(`/api/inventory/stock-count/${params.id}`);
      if (checkRes.ok) {
        router.push(`/dashboard/inventory/stock-count/${params.id}/results`);
        return;
      }
    } catch {}
    toast.success('Workflow completado exitosamente');
    router.push('/dashboard/workflows');
  };

  const handleRetryEffects = async () => {
    await retryWorkflowCompletionEffects({ instanceId: params.id });
    setExecution(previous => previous ? { ...previous, completionEffectsStatus: 'pending' } : previous);
    toast.success('Recuperación programada');
  };

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

  if (error || !execution) {
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
          Ejecución ID: {execution.id}
        </div>
      </div>

      {refreshError && <p role="alert" className="text-sm text-destructive">No se pudo actualizar el procesamiento. Reintentaremos automáticamente.</p>}
      <WorkflowExecutor
        execution={execution}
        onStepComplete={handleStepComplete}
        onComplete={handleComplete}
        onRetryEffects={execution.canRetryCompletionEffects ? handleRetryEffects : undefined}
      />
    </div>
  );
}
