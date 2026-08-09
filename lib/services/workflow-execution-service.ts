import { db } from "@/lib/db";
import { workflowInstances, workflowInstanceSteps, workflowTemplates, users, companies } from "@/lib/db/schema";
import { WorkflowStep } from "@/lib/types/workflow";
import { eq, and, sql } from "drizzle-orm";
import { STOCK_COUNT_TEMPLATE_NAME, DEFAULT_CATEGORIES } from "./stock-count-service";
import { hasDynamicSteps, resolveDynamicSteps } from "@/lib/workflows/dynamic-steps";
import { templateLibrary } from "@/templates";

export type WorkflowReviewErrorCode =
    | "NOT_FOUND"
    | "FORBIDDEN"
    | "NOT_REVIEWABLE"
    | "ALREADY_REVIEWED"
    | "COMMENT_REQUIRED";

/** Error de revisión con mensaje ya redactado en español para el usuario. */
export class WorkflowReviewError extends Error {
    constructor(public code: WorkflowReviewErrorCode, message: string) {
        super(message);
        this.name = "WorkflowReviewError";
    }
}

export class WorkflowExecutionService {

    static async createExecution(templateId: string, branchId: string, assigneeId: string | null = null, sessionId: string | null = null, categoryValue?: string, companyId?: string) {
        // 1. Get Template
        const template = await db.query.workflowTemplates.findFirst({
            where: eq(workflowTemplates.id, templateId)
        });

        if (!template) {
            throw new Error("Workflow template not found");
        }

        let steps = template.steps as unknown as WorkflowStep[];

        // 2. If Stock Count template, generate dynamic product steps
        if (template.name === STOCK_COUNT_TEMPLATE_NAME) {
            const category = categoryValue || DEFAULT_CATEGORIES[0].value;
            const { StockCountService } = await import("./stock-count-service");
            const cid = companyId || (await db.query.users.findFirst({ where: eq(users.id, assigneeId || "") }))?.companyId || "";
            const products = await StockCountService.getProductsWithStock(cid, branchId, category);
            const templateSteps = template.steps as unknown as WorkflowStep[];
            steps = StockCountService.generateStockCountSteps(templateSteps, products, category);
        }

        // 2b. Expandir pasos dinámicos genéricos (metadata.dynamicSource).
        // Aditivo: no-op para el conteo de inventario, cuyos pasos ya vienen
        // resueltos por la rama de arriba y no declaran dynamicSource.
        if (hasDynamicSteps(steps)) {
            const cid = companyId
                || template.companyId
                || (await db.query.users.findFirst({ where: eq(users.id, assigneeId || "") }))?.companyId
                || "";
            steps = await resolveDynamicSteps(steps, { companyId: cid, branchId });
        }

        const instanceValues = {
            workflowTemplateId: template.id,
            branchId: branchId,
            assigneeId: assigneeId,
            sessionId: sessionId,
            status: 'PENDING',
            currentStepId: steps.length > 0 ? steps[0].id : null,
            score: 0,
            data: template.name === STOCK_COUNT_TEMPLATE_NAME ? {
                category: categoryValue || DEFAULT_CATEGORIES[0].value,
                productCount: steps.filter(s => s.id.startsWith("count-")).length,
                ...(() => {
                    const st = templateLibrary['conteo-inventario-v1'];
                    return {
                        ...(st?.aiConfig ? { aiConfig: st.aiConfig } : {}),
                        ...(st?.complianceConfig ? { complianceConfig: st.complianceConfig } : {}),
                        ...(st?.completionActions ? { completionActions: st.completionActions } : {}),
                    };
                })(),
            } : undefined
        };

        return await db.transaction(async (tx) => {
            const [instance] = await tx.insert(workflowInstances).values(instanceValues).returning();

            if (steps.length > 0) {
                await tx.insert(workflowInstanceSteps).values(
                    steps.map(step => {
                        const hasDirectFields = 'systemQuantity' in step;
                        const value = hasDirectFields
                            ? JSON.stringify({
                                systemQuantity: (step as any).systemQuantity,
                                itemId: (step as any).itemId,
                                inputValue: 'value' in step ? (step as any).value ?? null : null,
                            })
                            : step.metadata
                                ? JSON.stringify(step.metadata)
                                : null;
                        return {
                            instanceId: instance.id,
                            stepId: step.id,
                            status: 'PENDING',
                            value,
                        };
                    })
                );
            }

            return instance;
        });
    }

    static async getExecution(instanceId: string) {
        const instance = await db.query.workflowInstances.findFirst({
            where: eq(workflowInstances.id, instanceId),
        });

        if (!instance) return null;

        // Fetch steps separately if relations aren't set up perfectly or for clarity
        const steps = await db.query.workflowInstanceSteps.findMany({
            where: eq(workflowInstanceSteps.instanceId, instanceId)
        });

        // Fetch user if needed
        let assignee = null;
        if (instance.assigneeId) {
            assignee = await db.query.users.findFirst({
                where: eq(users.id, instance.assigneeId)
            });
        }

        // Fetch template
        const template = await db.query.workflowTemplates.findFirst({
            where: eq(workflowTemplates.id, instance.workflowTemplateId)
        });

        let isBlindCount = false;
        if (template && template.name === STOCK_COUNT_TEMPLATE_NAME && template.companyId) {
            const company = await db.query.companies.findFirst({
                where: eq(companies.id, template.companyId)
            });
            isBlindCount = company?.blindStockCount || false;
        }

        return {
            ...instance,
            templateId: instance.workflowTemplateId,
            assignedTo: instance.assigneeId,
            createdAt: instance.createdAt?.toISOString(),
            completedAt: instance.completedAt?.toISOString(),
            steps: steps.map(s => ({
                ...s,
                value: s.value as string || "",
                status: s.status as "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED",
                completedAt: s.completedAt?.toISOString()
            })),
            assignee,
            template,
            blindCount: isBlindCount
        };
    }

    /**
     * Aprueba o rechaza una ejecución ya completada.
     *
     * La revisión vive en `reviewStatus`, no en `status`: una ejecución aprobada
     * sigue siendo COMPLETED para el historial y los reportes de cumplimiento.
     *
     * Lanza WorkflowReviewError con un `code` que la ruta traduce a un HTTP
     * status; el mensaje ya viene en español y es apto para mostrarse al usuario.
     */
    static async reviewExecution(
        instanceId: string,
        data: { reviewStatus: 'APPROVED' | 'REJECTED'; reviewComment?: string },
        reviewer: { userId: string; companyId: string }
    ) {
        const instance = await db.query.workflowInstances.findFirst({
            where: eq(workflowInstances.id, instanceId),
        });

        if (!instance) {
            throw new WorkflowReviewError("NOT_FOUND", "No encontramos esta ejecución.");
        }

        // La ejecución pertenece a la empresa del revisor sólo a través de su
        // plantilla; workflow_instances no guarda company_id.
        const template = await db.query.workflowTemplates.findFirst({
            where: eq(workflowTemplates.id, instance.workflowTemplateId),
        });

        if (!template || template.companyId !== reviewer.companyId) {
            throw new WorkflowReviewError("FORBIDDEN", "No tienes acceso a esta ejecución.");
        }

        if (instance.status !== "COMPLETED") {
            throw new WorkflowReviewError(
                "NOT_REVIEWABLE",
                "Sólo puedes revisar ejecuciones completadas."
            );
        }

        if (instance.reviewStatus === "APPROVED" || instance.reviewStatus === "REJECTED") {
            throw new WorkflowReviewError(
                "ALREADY_REVIEWED",
                instance.reviewStatus === "APPROVED"
                    ? "Esta ejecución ya fue aprobada."
                    : "Esta ejecución ya fue rechazada."
            );
        }

        // Rechazar sin decir por qué deja al operador sin nada que corregir.
        const comment = data.reviewComment?.trim() || "";
        if (data.reviewStatus === "REJECTED" && comment.length === 0) {
            throw new WorkflowReviewError(
                "COMMENT_REQUIRED",
                "Escribe el motivo del rechazo para que se pueda corregir."
            );
        }

        const [updated] = await db
            .update(workflowInstances)
            .set({
                reviewStatus: data.reviewStatus,
                reviewComment: comment || null,
                reviewedAt: new Date(),
                reviewedBy: reviewer.userId,
                updatedAt: new Date(),
            })
            .where(eq(workflowInstances.id, instanceId))
            .returning();

        return updated;
    }

    static async updateStep(
        instanceId: string,
        stepId: string,
        data: { value?: any, evidenceUrl?: string, comment?: string, status?: 'COMPLETED' | 'SKIPPED' | 'FAILED' },
        userId: string
    ) {
        const now = new Date();

        // Check if AI verification is needed
        let aiAnalysis = null;
        let currentStepDef: any = null;

        // Fetch template to get step definition (needed for AI and Branching)
        const instance = await db.query.workflowInstances.findFirst({
            where: eq(workflowInstances.id, instanceId),
        });

        if (instance) {
            const template = await db.query.workflowTemplates.findFirst({
                where: eq(workflowTemplates.id, instance.workflowTemplateId)
            });

            if (template) {
                const steps = template.steps as unknown as WorkflowStep[];
                currentStepDef = steps.find(s => s.id === stepId);
            }
        }

        if (!currentStepDef) {
            // Warn but proceed if we can't find def (though expected)
            console.warn(`[WorkflowExecution] Step definition not found: ${stepId}`);
        }

        if (data.status === 'COMPLETED' && (data.value || data.evidenceUrl) && currentStepDef) {
            // ... AI Logic ...

            const stepConfig = currentStepDef.config as any;

            if (stepConfig?.verificationRule) {
                // New: Verification Rule Engine Logic
                let urlToVerify = data.evidenceUrl || (currentStepDef.type === 'PHOTO' ? data.value : null);

                // Handle multiple evidence/photos (JSON stringified array)
                if (urlToVerify && typeof urlToVerify === 'string' && urlToVerify.trim().startsWith('[')) {
                    try {
                        const parsed = JSON.parse(urlToVerify);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            urlToVerify = parsed[0]; // Verify the first image
                        }
                    } catch (e) {
                        // Keep original string if parse fails
                    }
                }

                if (urlToVerify && typeof urlToVerify === 'string') {
                    const { VerificationEngine } = await import("./verification-engine");
                    const rule = stepConfig.verificationRule;
                    const result = await VerificationEngine.evaluate(urlToVerify, rule);

                    // Merge result while preserving backward compatibility for 'passed' field
                    aiAnalysis = {
                        ...result.aiResult,
                        passed: result.success, // Rule Engine determines the final outcome
                        verificationResult: result
                    };

                    // Update reason if failed by rule but passed by AI (e.g. low confidence)
                    if (result.aiResult.passed && !result.success) {
                        aiAnalysis.reason = `Verification Rule Failed: Low confidence or missing requirements. ${result.aiResult.reason}`;
                    }
                }
            } else if (currentStepDef?.aiVerification?.enabled || currentStepDef?.config?.aiVerification?.enabled) {
                // Legacy: Simple AI Verification
                let urlToVerify = data.evidenceUrl || (currentStepDef.type === 'PHOTO' ? data.value : null);

                // Handle multiple evidence/photos (JSON stringified array)
                if (urlToVerify && typeof urlToVerify === 'string' && urlToVerify.trim().startsWith('[')) {
                    try {
                        const parsed = JSON.parse(urlToVerify);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            urlToVerify = parsed[0]; // Verify the first image
                        }
                    } catch (e) {
                        // Keep original string
                    }
                }

                if (urlToVerify && typeof urlToVerify === 'string') {
                    const { AIService } = await import("./ai-service");
                    aiAnalysis = await AIService.verifyPhoto(
                        urlToVerify,
                        (currentStepDef.aiVerification?.prompt || currentStepDef.config?.aiVerification?.prompt || "Verify this photo.")
                    );
                }
                // } // template check moved up
                // } // instance check moved up
            }
        }


        const [updatedStep] = await db.update(workflowInstanceSteps)
            .set({
                ...data,
                aiAnalysis: aiAnalysis, // Save AI result
                completedBy: userId,
                completedAt: data.status === 'COMPLETED' ? now : undefined
            })
            .where(and(
                eq(workflowInstanceSteps.instanceId, instanceId),
                eq(workflowInstanceSteps.stepId, stepId)
            ))
            .returning();

        // Check for incidents if step is completed
        let incidents: any[] = [];
        if (data.status === 'COMPLETED') {
            try {
                const { IncidentEngine } = await import('./incident-engine');
                incidents = await IncidentEngine.checkIncidentConditions(
                    instanceId,
                    stepId,
                    data.value,
                    aiAnalysis,
                    userId,
                    currentStepDef ?? undefined
                );

                if (incidents.length > 0) {
                    console.log(`[WorkflowExecution] ${incidents.length} incident(s) created for step ${stepId}`);
                }
            } catch (error) {
                console.error('[WorkflowExecution] Error checking incidents:', error);
            }

            // New: NOM-251 Expiration Check for Insumos (Fase 2)
            if (instance && instance.workflowTemplateId === 'tpl-recepcion-mercancia-v2' && stepId === 'paso-6') {
                let urlToVerify = data.evidenceUrl || data.value;
                if (urlToVerify && typeof urlToVerify === 'string' && urlToVerify.trim().startsWith('[')) {
                    try {
                        const parsed = JSON.parse(urlToVerify);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            urlToVerify = parsed[0];
                        }
                    } catch (e) {}
                }
                
                if (urlToVerify && typeof urlToVerify === 'string') {
                    try {
                        const { AIService } = await import("./ai-service");
                        const expirationDate = await AIService.extractExpirationDate(urlToVerify);
                        if (expirationDate) {
                            const daysLeft = Math.ceil((expirationDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                            if (daysLeft >= 0 && daysLeft < 7) {
                                const { IncidentEngine } = await import('./incident-engine');
                                await IncidentEngine.createIncident(instanceId, stepId, {
                                    id: 'lr-insumo-caducidad-proxima',
                                    condition: 'true',
                                    severity: 'WARNING',
                                    message: `Alerta: Insumo con caducidad próxima (${daysLeft} días restantes)`,
                                    description: `El insumo recibido expira el ${expirationDate.toISOString().split('T')[0]}. Restan ${daysLeft} días de vida útil.`,
                                }, {
                                    value: data.value,
                                    aiResult: { passed: true, reason: `Fecha de caducidad extraída: ${expirationDate.toISOString().split('T')[0]}` },
                                    userId,
                                    branchId: instance.branchId
                                });
                            }
                        }
                    } catch (err) {
                        console.error('[WorkflowExecution] Error extracting expiration date:', err);
                    }
                }
            }


            // --- CONDITIONAL BRANCHING LOGIC ---
            if (currentStepDef && currentStepDef.branches && currentStepDef.branches.length > 0) {
                try {
                    const { IncidentEngine } = await import('./incident-engine');

                    for (const branch of currentStepDef.branches) {
                        if (!branch.condition || !branch.targetStepId) continue;

                        const isMatch = IncidentEngine.evaluateCondition(branch.condition, {
                            value: data.value,
                            ai_result: aiAnalysis,
                            // Add more context if needed
                        });

                        if (isMatch) {
                            console.log(`[WorkflowExecution] Branch matched: ${branch.condition} -> Skip to ${branch.targetStepId}`);

                            // Find steps to skip
                            // We need the full list of steps from the template to know the order
                            // We fetched 'steps' earlier but didn't store it in a variable accessible here.
                            // Let's re-fetch or use a more optimal way. 
                            const template = await db.query.workflowTemplates.findFirst({
                                where: eq(workflowTemplates.id, (instance as any).workflowTemplateId)
                            });

                            if (template) {
                                const allSteps = template.steps as unknown as WorkflowStep[];
                                const currentIndex = allSteps.findIndex(s => s.id === stepId);
                                const targetIndex = allSteps.findIndex(s => s.id === branch.targetStepId);

                                if (currentIndex !== -1 && targetIndex !== -1 && targetIndex > currentIndex) {
                                    // Identify steps between current and target (exclusive of both)
                                    // Actually, we want to skip everything BETWEEN current and target.
                                    // e.g. Current=1, Target=4. Skip 2 and 3.
                                    // Current is already COMPLETED. Target should remain PENDING.

                                    const stepsToSkip = allSteps.slice(currentIndex + 1, targetIndex);
                                    const stepIdsToSkip = stepsToSkip.map(s => s.id);

                                    if (stepIdsToSkip.length > 0) {
                                        const { inArray } = await import('drizzle-orm');
                                        await db.update(workflowInstanceSteps)
                                            .set({
                                                status: 'SKIPPED',
                                                completedAt: new Date(),
                                                completedBy: 'system'
                                            })
                                            .where(and(
                                                eq(workflowInstanceSteps.instanceId, instanceId),
                                                inArray(workflowInstanceSteps.stepId, stepIdsToSkip),
                                                eq(workflowInstanceSteps.status, 'PENDING') // Only skip if pending
                                            ));

                                        console.log(`[WorkflowExecution] Skipped ${stepIdsToSkip.length} steps: ${stepIdsToSkip.join(', ')}`);
                                    }
                                }
                            }
                            break; // Stop after first match
                        }
                    }
                } catch (err) {
                    console.error('[WorkflowExecution] Error processing branches:', err);
                }
            }
            // -----------------------------------

            // Check if we should auto-advance currentStepId or status of instance
            await this.checkProgress(instanceId, userId);
        }

        // Check if any incident triggers remediation
        const remediationRequired = incidents.some((inc: any) =>
            inc.remediationProtocol &&
            (inc.status === 'IN_REMEDIATION' || inc.status === 'DETECTED')
        );

        return {
            step: updatedStep,
            incidents,
            aiAnalysis,
            remediationRequired
        };
    }


    /**
     * Recalcula el estado y la puntuación de una instancia.
     *
     * Público para que el motor de incidentes lo invoque al resolver un
     * incidente bloqueante: la instancia debe cerrarse en ese momento si el
     * checklist ya estaba terminado.
     */
    static async recalculateProgress(instanceId: string, userId?: string) {
        return this.checkProgress(instanceId, userId);
    }

    private static async checkProgress(instanceId: string, userId?: string) {
        // Logic to update instance status or calculate score
        const allSteps = await db.query.workflowInstanceSteps.findMany({
            where: eq(workflowInstanceSteps.instanceId, instanceId)
        });

        const allCompleted = allSteps.every(s => s.status === 'COMPLETED' || s.status === 'SKIPPED');
        const completedCount = allSteps.filter(s => s.status === 'COMPLETED').length;
        const totalCount = allSteps.length;

        // Simple score: % of completed steps (excluding skipped if we want, but usually strict)
        // Or if we want to weight them. For now, simple percentage.
        const score = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

        // Optionally, deduct points for incidents? 
        // For now, let's keep it simple: progress % is the score for completion.
        // Compliance Score probably implies "Passed Verification".
        // Let's count "Passed" steps (where aiAnalysis.passed !== false).

        // Refined Score: Steps that are COMPLETED and (no AI Check OR AI Check Passed)
        const passedCount = allSteps.filter(s => {
            if (s.status !== 'COMPLETED') return false;
            // If AI analysis exists and passed is explicitly false, then it failed.
            if (s.aiAnalysis && (s.aiAnalysis as any).passed === false) return false;
            return true;
        }).length;

        const complianceScore = totalCount > 0 ? Math.round((passedCount / totalCount) * 100) : 0;

        // Un incidente con acción BLOCK sin resolver impide cerrar el checklist:
        // se puede seguir capturando evidencia y remediando, pero no darlo por
        // hecho. Al resolverse, el motor de incidentes vuelve a llamar aquí.
        const { IncidentEngine } = await import('./incident-engine');
        const isBlocked = await IncidentEngine.hasBlockingIncidents(instanceId);

        if (isBlocked) {
            await db.update(workflowInstances)
                .set({ status: 'BLOCKED', score: complianceScore })
                .where(eq(workflowInstances.id, instanceId));

            console.log(
                `[WorkflowExecution] Instancia ${instanceId} bloqueada por incidente sin resolver; ` +
                `no se cierra (pasos completos: ${allCompleted})`
            );
            return;
        }

        if (allCompleted) {
            // Trigger completion actions (including inventory updates, notifications, etc.)
            const instance = await db.query.workflowInstances.findFirst({
                where: eq(workflowInstances.id, instanceId)
            });

            if (instance) {
                try {
                    const { WorkflowActionRunner } = await import("./workflow-action-runner");
                    await WorkflowActionRunner.runCompletionActions(instanceId, userId || instance.assigneeId || "");
                } catch (error) {
                    console.error("[WorkflowExecution] Error running completion actions:", error);
                }
            }

            await db.update(workflowInstances)
                .set({
                    status: 'COMPLETED',
                    completedAt: new Date(),
                    score: complianceScore
                })
                .where(eq(workflowInstances.id, instanceId));

            // Plan 5.5: al cerrar el flujo, los smart links de la instancia quedan
            // USED (preservando el usedAt de la primera apertura) — ya no se puede
            // reabrir la ejecución por enlace. Best-effort: un fallo aquí no debe
            // impedir el cierre.
            try {
                const { SmartLinkService } = await import("./smart-link-service");
                await SmartLinkService.markUsedForInstance(instanceId);
            } catch (error) {
                console.error(`[WorkflowExecution] Error marking smart links used for ${instanceId}:`, error);
            }

            // Fase 5: al completar el template de recepción de mercancía,
            // extrae los datos a receiving_reports (best-effort fuera del request).
            // Debe ir DESPUÉS del update: el extractor descarta la instancia si
            // todavía no está en COMPLETED.
            if (instance) {
                try {
                    const template = await db.query.workflowTemplates.findFirst({
                        where: eq(workflowTemplates.id, instance.workflowTemplateId),
                    });
                    if (template && template.id === "tpl-recepcion-mercancia-v2") {
                        const { extractReceivingFromInstance } = await import("./receiving-from-workflow");
                        // Fire-and-forget: no bloquea la respuesta al cajero.
                        void extractReceivingFromInstance(instanceId);
                    }

                    // Conteo: saca los pasos `count-{itemId}` a `stock_counts`.
                    // Cubre los templates con pasos dinámicos genéricos, que se
                    // completan por esta vía y no por `completeStockCount`.
                    // El extractor se auto-descarta si no hay pasos de conteo.
                    const { extractStockCountFromInstance } = await import("./stock-count-from-workflow");
                    void extractStockCountFromInstance(instanceId);
                } catch (error) {
                    console.error("[WorkflowExecution] Error scheduling receiving extraction:", error);
                }
            }
        } else {
            await db.update(workflowInstances)
                .set({
                    status: 'IN_PROGRESS',
                    startedAt: new Date(), // Should use COALESCE
                    score: complianceScore // Update score in real-time? Sure.
                })
                .where(eq(workflowInstances.id, instanceId));
        }
    }
}
