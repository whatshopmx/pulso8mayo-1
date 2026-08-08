import { db } from "@/lib/db";
import { workflowTemplates } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import EditorClient from "./editor-client";
import { WorkflowStep } from "@/components/builder/builder-context";
import { normalizeOptions } from "@/lib/workflow-type-map";
import { roleIsAtLeast } from "@/lib/permissions";
import React from 'react';

export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
    const session = await auth.api.getSession({
        headers: await headers()
    });

    if (!session) {
        redirect("/sign-in");
    }

    // AD-9: el editor arranca en GERENTE. Por debajo no es un 404 ni una
    // expulsión del módulo — supervisores y empleados necesitan ver qué flujos
    // existen, solo no editarlos.
    const userRole = (session.user as { role?: string }).role;
    if (!roleIsAtLeast(userRole ?? '', 'GERENTE')) {
        redirect("/dashboard/builder");
    }

    const { id } = await params;

    if (!id) {
        console.error('[EditorPage] Template ID is undefined');
        notFound();
    }

    const template = await db.query.workflowTemplates.findFirst({
        where: eq(workflowTemplates.id, id),
    });

    if (!template) {
        console.error(`[EditorPage] Template not found for id: ${id}`);
        notFound();
    }

    const rawSteps = ((template as any).pasos || (template as any).steps || template.steps || []) as any[];

    const steps: WorkflowStep[] = rawSteps.map(step => {
        const stepId = step.id || crypto.randomUUID();
        const stepType = step.fieldType || step.tipo || step.type || 'text';
        const stepTitle = step.label || step.titulo || step.nombre || step.title || 'Untitled Step';
        const stepDescription = step.descripcion || step.description || '';
        const stepRequired = step.obligatorio ?? step.required ?? false;

        const extra = step.extraAttributes || {};
        const placeholder = step.placeholder || extra.placeholder || '';
        const defaultValue = step.defaultValue || extra.defaultValue || extra.value || step.valorPorDefecto || '';
        const readOnly = step.readOnly ?? step.soloLectura ?? step.static ?? extra.readonly ?? extra.readOnly ?? false;
        const helperText = extra.helperText || '';

        const config = step.config || { ...extra };

        const rawOptions = step.options || step.opciones || config.options || config.items;
        const options = normalizeOptions(rawOptions);

        if (config.options) {
            config.options = normalizeOptions(config.options);
        }
        if (config.items) {
            config.items = normalizeOptions(config.items);
        }

        const finalDescription = stepDescription || helperText;

        return {
            id: stepId,
            type: stepType,
            title: stepTitle,
            description: finalDescription,
            required: stepRequired,
            config,
            validation: step.validation || step.validacion,
            aiVerification: step.aiVerification || step.verificacionIA,
            logicRules: step.logicRules || step.reglasLogica,
            actions: step.actions || (step as any).acciones,
            options: options.length > 0 ? options : undefined,
            readOnly,
            placeholder,
            defaultValue,
            conditionalLogic: step.conditionalLogic || step.logicaCondicional,
            branches: step.branches,
            category: step.category || step.categoria,
        } as WorkflowStep;
    });

    const initialSettings = {
        version: template.version ?? 1,
        activo: template.active ?? true,
        requiereIA: template.isCritical ?? false,
        duracionEstimada: template.duracionEstimada ?? '',
        cumplimientoNormativo: template.complianceType ? [template.complianceType] : [],
        tags: (template.tags as string[]) || [],
        aiConfig: template.aiConfig as any,
        complianceConfig: template.complianceConfig as any,
        completionActions: (template.completionActions as any[]) || [],
        frequency: '',
        days: [],
        assignedRoles: [],
        assignedShifts: [],
        shiftTimes: {},
        triggers: [],
    };

    return (
        <EditorClient
            id={id}
            title={template.name}
            initialSteps={steps}
            initialSettings={initialSettings}
            canEditPrivileged={roleIsAtLeast(userRole ?? '', 'ADMIN')}
        />
    );
}
