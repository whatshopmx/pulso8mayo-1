import { WorkflowExecutionService } from "@/lib/services/workflow-execution-service";
import { WorkflowStepper } from "@/components/execution/workflow-stepper";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

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
