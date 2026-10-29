import { WorkflowExecutionService } from "@/lib/services/workflow-execution-service";
import { WorkflowStepper } from "@/components/execution/workflow-stepper";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { requireExecutionAccess, assertExecutionInScope } from '@/lib/workflows/execution-access';
import { isApiError } from "@/lib/api/error";

interface PageProps {
    params: Promise<{
        id: string;
    }>;
}

export default async function ExecuteWorkflowPage(props: PageProps) {
    const params = await props.params;

    // 1. Verify Session
    const session = await auth.api.getSession({
        headers: await headers()
    });

    if (!session?.user) {
        redirect("/sign-in");
    }

    // 2. Fetch Execution
    const execution = await WorkflowExecutionService.getExecution(params.id);

    if (!execution || !execution.template) {
        return notFound();
    }

    // RBAC-01: ejecutar exige `workflows:update`. La lectura basta para ver el
    // resultado, pero READONLY no debe recibir el stepper de captura.
    try {
        const actor = await requireExecutionAccess('update');
        await assertExecutionInScope(actor, execution);
    } catch (error) {
        if (isApiError(error) && error.statusCode === 403) {
            return (
                <div className="container mx-auto py-16">
                    <div className="mx-auto max-w-md rounded-xl border border-border bg-card p-6 text-center">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            403 · Acceso denegado
                        </p>
                        <h1 className="mt-2 text-lg font-bold text-foreground">
                            Tu rol no puede ejecutar workflows
                        </h1>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Solo los roles operativos pueden iniciar o continuar una ejecución.
                            Si necesitas consultar el resultado, pide acceso de lectura sobre el historial.
                        </p>
                    </div>
                </div>
            );
        }
        // Fuera de alcance o de otra empresa: 404, para no confirmar existencia.
        return notFound();
    }

    // 3. Render Stepper
    return (
        <div className="container mx-auto py-8">
            <h1 className="text-2xl font-bold mb-6 text-center">{execution.template.name}</h1>
            <WorkflowStepper
                instance={execution}
                steps={execution.template.steps as any[]} // TODO: Fix type
                existingSteps={execution.steps}
                executionId={execution.id}
            />
        </div>
    );
}
