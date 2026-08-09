
import { WorkflowStepper } from "@/components/execution/workflow-stepper";
import { SmartLinkService } from "@/lib/services/smart-link-service";
import { WorkflowExecutionService } from "@/lib/services/workflow-execution-service";
import { notFound } from "next/navigation";

interface PageProps {
    params: Promise<{
        token: string;
    }>;
}

export default async function PublicWorkflowPage(props: PageProps) {
    const params = await props.params;
    const { token } = params;

    // Server-side validation
    const linkData = await SmartLinkService.validateSmartLink(token);

    if (!linkData) {
        return notFound();
    }

    // Plan 5.5: registrar la apertura (usedAt = primera vez, el enlace no es de
    // un solo uso). Best-effort: un fallo aquí no debe tumbar la página.
    try {
        await SmartLinkService.recordOpen(token);
    } catch (error) {
        console.error("Error recording smart link open:", error);
    }

    const execution = await WorkflowExecutionService.getExecution(linkData.instance.id);

    if (!execution || !execution.template) {
        return notFound();
    }

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
            <header className="bg-white dark:bg-gray-900 border-b p-4 sticky top-0 z-10">
                <div className="max-w-md mx-auto flex items-center justify-between">
                    <h1 className="font-semibold text-lg">{execution.template.name}</h1>
                    <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full dark:bg-blue-900/30 dark:text-blue-300">
                        {linkData.instance.status}
                    </span>
                </div>
            </header>

            <main className="flex-1">
                <WorkflowStepper
                    instance={execution}
                    steps={execution.template.steps as any[]} // TODO: Fix type
                    existingSteps={execution.steps}
                    token={token}
                />
            </main>
        </div>
    );
}
