/** 2:  * WhatsApp Workflow Conversation Handler 3:  * 4:  * Handles conversational workflow execution via WhatsApp 5:  */

import { db } from '@/lib/db';
import { eq, and, gt, inArray } from 'drizzle-orm';
import { workflowInstances, workflowInstanceSteps, workflowTemplates } from '@/lib/db/schema';
import { ConversationStateManager, ConversationState } from './workflow-state-manager';
import { EvidenceProcessor } from './evidence-processor';
import { whatsappClient } from './client-factory';
import { messageRouter, IncomingMessage } from './message-router';

interface WorkflowStep {
  id: string;
  title?: string;
  description?: string;
  [key: string]: unknown;
}

interface WorkflowTemplateWithSteps {
  id: string;
  name?: string;
  description?: string;
  steps?: WorkflowStep[];
  [key: string]: unknown;
}

export class WorkflowConversationHandler {
  private stateManager: ConversationStateManager;
  private evidenceProcessor: EvidenceProcessor;

  constructor() {
    this.stateManager = new ConversationStateManager();
    this.evidenceProcessor = new EvidenceProcessor();
  }

  /**
  * Handle incoming message in context of workflow conversation
  */
  async handleMessage(message: IncomingMessage, userId: string): Promise<{ success: boolean; reply?: string }> {
    try {
      // Get or create conversation state
      const state = await this.stateManager.getState(message.from);

      // If no active workflow, try to match intent
      if (!state || !state.workflowInstanceId) {
        return await this.handleWorkflowSelection(message, userId);
      }

      // Check if conversation has expired
      if (state.expiresAt && new Date() > state.expiresAt) {
        await this.stateManager.expireState(message.from);
        return {
          success: true,
          reply: '⏰ *Sesión Expirada*\n\nTu sesión de workflow ha expirado. Por favor inicia de nuevo.',
        };
      }

      // If waiting for evidence and media received
      if (state.status === 'WAITING_EVIDENCE' && message.mediaUrl) {
        return await this.handleEvidenceSubmission(message, state);
      }

      // Handle navigation commands
      const messageText = message.message.toLowerCase().trim();

      if (messageText === 'siguiente' || messageText === 'next' || messageText === 'continuar') {
        return await this.advanceStep(message, state);
      }

      if (messageText === 'anterior' || messageText === 'previous' || messageText === 'atras') {
        return await this.previousStep(message, state);
      }

      if (messageText === 'saltar' || messageText === 'skip' || messageText === 'omitir') {
        return await this.skipStep(message, state);
      }

      if (messageText === 'cancelar' || messageText === 'cancel') {
        return await this.cancelWorkflow(message, state);
      }

      // Default: prompt for expected input
      return this.promptForExpectedInput(state);
    } catch (error) {
      console.error('[WorkflowConversationHandler] Error:', error);
      return {
        success: false,
        reply: '❌ Error al procesar el mensaje. Por favor intenta de nuevo.',
      };
    }
  }

  /**
  * Handle workflow selection/initiation
  */
  private async handleWorkflowSelection(
    message: IncomingMessage,
    userId: string
  ): Promise<{ success: boolean; reply?: string }> {
    const messageText = message.message.toLowerCase().trim();

    // Try to match workflow by name
    const workflowInstancesData = await db.query.workflowInstances.findMany({
      where: and(
        eq(workflowInstances.assigneeId, userId),
        eq(workflowInstances.status, 'PENDING')
      ),
      limit: 10,
    });

    // Fetch templates for these instances
    const templateIds = workflowInstancesData.map(w => w.workflowTemplateId);
    const templates = await db.query.workflowTemplates.findMany({
      where: inArray(workflowTemplates.id, templateIds)
    });

    // Combine instances with templates
    const workflows = workflowInstancesData.map(instance => ({
      ...instance,
      template: templates.find(t => t.id === instance.workflowTemplateId)
    }));

    // Find matching workflow
    const matchedWorkflow = workflows.find((w) => {
      const templateName = (w.template as WorkflowTemplateWithSteps | undefined)?.name;
      return templateName?.toLowerCase().includes(messageText);
    });

    if (!matchedWorkflow) {
      return {
        success: true,
        reply: `🔍 *Workflow No Encontrado*

No encontré un workflow con ese nombre. Tus workflows pendientes son:

${workflows.map((w) => `• ${(w.template as WorkflowTemplateWithSteps | undefined)?.name || 'Workflow'}`).join('\n')}

Por favor responde con el nombre exacto del workflow que deseas iniciar.`,
      };
    }

    // Create conversation state
    const state = await this.stateManager.createState(message.from, userId, matchedWorkflow.id);
    
    const matchedTemplate = matchedWorkflow.template as WorkflowTemplateWithSteps | undefined;
    const steps = matchedTemplate?.steps;
    const stepsLength = steps?.length || 0;

    return {
      success: true,
      reply: `✅ *Workflow Iniciado*

📋 *${matchedTemplate?.name || 'Workflow'}*

Este workflow tiene ${stepsLength} pasos.

${this.formatStepPrompt(steps?.[0], 1, stepsLength)}`,
    };
  }

  /**
  * Handle evidence submission (photo upload)
  */
  private async handleEvidenceSubmission(
    message: IncomingMessage,
    state: ConversationState
  ): Promise<{ success: boolean; reply?: string }> {
    try {
      if (!state.workflowInstanceId || !state.currentStepId) {
        return {
          success: false,
          reply: '❌ Error: No hay un paso activo en el workflow.',
        };
      }

      // Process evidence
      const result = await this.evidenceProcessor.processEvidence(
        message.from,
        state,
        message.mediaUrl!
      );

      // Update conversation state
      await this.stateManager.updateState(message.from, {
        status: 'ACTIVE',
        lastMessageAt: new Date(),
      });

      // Check if there are more steps
      const nextStepIndex = (state.stepIndex || 0) + 1;
      const instance = await db.query.workflowInstances.findFirst({
        where: eq(workflowInstances.id, state.workflowInstanceId)
      });

      if (!instance) {
        return {
          success: false,
          reply: '❌ Error: Instancia no encontrada.',
        };
      }

      const template = await db.query.workflowTemplates.findFirst({
        where: eq(workflowTemplates.id, instance.workflowTemplateId)
      });

      if (!template) {
        return {
          success: false,
          reply: '❌ Error: Template no encontrado.',
        };
      }

      const templateWithSteps = template as unknown as WorkflowTemplateWithSteps;
      const totalSteps = templateWithSteps.steps?.length || 0;

      if (nextStepIndex >= totalSteps) {
        // Workflow completed
        await this.stateManager.completeState(message.from);

        return {
          success: true,
          reply: `🎉 *¡Workflow Completado!*

📋 *${template.name}*
✅ Puntuación: ${(result as { score?: number }).score || 100}%
📝 Pasos Completados: ${totalSteps}/${totalSteps}

¡Excelente trabajo! 🎊`,
        };
      }

      // Move to next step - use template.steps instead of instance.template
      const nextStep = templateWithSteps.steps?.[nextStepIndex];

      await this.stateManager.updateState(message.from, {
        currentStepId: nextStep?.id || null,
        stepIndex: nextStepIndex,
        status: 'WAITING_EVIDENCE',
        lastMessageAt: new Date(),
      });

      return {
        success: true,
        reply: `${(result as { verificationMessage?: string }).verificationMessage || ''}

${this.formatStepPrompt(nextStep, nextStepIndex + 1, totalSteps)}`,
      };
    } catch (error) {
      console.error('[WorkflowConversationHandler] Evidence processing error:', error);
      return {
        success: false,
        reply: '❌ Error al procesar la evidencia. Por favor envía la foto de nuevo.',
      };
    }
  }

  /**
  * Advance to next step
  */
  private async advanceStep(
    message: IncomingMessage,
    state: ConversationState
  ): Promise<{ success: boolean; reply?: string }> {
    if (!state.workflowInstanceId) {
      return { success: false, reply: '❌ No hay workflow activo.' };
    }

    const instance = await db.query.workflowInstances.findFirst({
      where: eq(workflowInstances.id, state.workflowInstanceId)
    });

    if (!instance) {
      return { success: false, reply: '❌ Instancia no encontrada.' };
    }

    const template = await db.query.workflowTemplates.findFirst({
      where: eq(workflowTemplates.id, instance.workflowTemplateId)
    });

    if (!template) {
      return { success: false, reply: '❌ Template no encontrado.' };
    }

    const templateWithSteps = template as unknown as WorkflowTemplateWithSteps;
    const nextStepIndex = (state.stepIndex || 0) + 1;
    const totalSteps = templateWithSteps.steps?.length || 0;

    if (nextStepIndex >= totalSteps) {
      return {
        success: true,
        reply: '✅ Ya estás en el último paso. Envía la evidencia para completar el workflow.',
      };
    }

    const nextStep = templateWithSteps.steps?.[nextStepIndex];

    await this.stateManager.updateState(message.from, {
      currentStepId: nextStep?.id || null,
      stepIndex: nextStepIndex,
      status: 'WAITING_EVIDENCE',
      lastMessageAt: new Date(),
    });

    return {
      success: true,
      reply: this.formatStepPrompt(nextStep, nextStepIndex + 1, totalSteps),
    };
  }

  /**
  * Go to previous step
  */
  private async previousStep(
    message: IncomingMessage,
    state: ConversationState
  ): Promise<{ success: boolean; reply?: string }> {
    if (!state.workflowInstanceId || !state.stepIndex || state.stepIndex === 0) {
      return { success: false, reply: '❌ Ya estás en el primer paso.' };
    }

    const instance = await db.query.workflowInstances.findFirst({
      where: eq(workflowInstances.id, state.workflowInstanceId)
    });

    const template = await db.query.workflowTemplates.findFirst({
      where: eq(workflowTemplates.id, instance?.workflowTemplateId || '')
    });

    if (!template) {
      return { success: false, reply: '❌ Template no encontrado.' };
    }

    const templateWithSteps = template as unknown as WorkflowTemplateWithSteps;
    const prevStepIndex = state.stepIndex - 1;
    const prevStep = templateWithSteps.steps?.[prevStepIndex];

    await this.stateManager.updateState(message.from, {
      currentStepId: prevStep?.id || null,
      stepIndex: prevStepIndex,
      status: 'WAITING_EVIDENCE',
      lastMessageAt: new Date(),
    });

    return {
      success: true,
      reply: this.formatStepPrompt(prevStep, prevStepIndex + 1, templateWithSteps.steps?.length || 0),
    };
  }

  /**
  * Skip current step
  */
  private async skipStep(
    message: IncomingMessage,
    state: ConversationState
  ): Promise<{ success: boolean; reply?: string }> {
    // TODO: Implement step skipping with supervisor approval
    return {
      success: true,
      reply: '⚠️ Función de saltar paso aún no implementada. Por favor completa el paso actual.',
    };
  }

  /**
  * Cancel workflow
  */
  private async cancelWorkflow(
    message: IncomingMessage,
    state: ConversationState
  ): Promise<{ success: boolean; reply?: string }> {
    await this.stateManager.cancelState(message.from);

    return {
      success: true,
      reply: '❌ *Workflow Cancelado*\n\nEl workflow ha sido cancelado. Puedes iniciar uno nuevo cuando lo necesites.',
    };
  }

  /**
  * Prompt user for expected input
  */
  private promptForExpectedInput(state: ConversationState): { success: boolean; reply?: string } {
    return {
      success: true,
      reply: `📋 *Esperando Evidencia*

Por favor envía una foto del paso actual.

Comandos disponibles:
• *Siguiente* - Avanzar al siguiente paso
• *Anterior* - Regresar al paso anterior
• *Saltar* - Saltar este paso
• *Cancelar* - Cancelar el workflow`,
    };
  }

  /**
  * Format step prompt for WhatsApp message
  */
  private formatStepPrompt(
    step: WorkflowStep | undefined,
    index: number,
    total: number
  ): string {
    if (!step) {
      return '';
    }

    return `📋 *Paso ${index} de ${total}*

*${step.title || 'Paso sin título'}*

${step.description || ''}

Por favor envía una foto como evidencia de este paso.`;
  }
}

// Singleton instance
export const workflowConversationHandler = new WorkflowConversationHandler();
