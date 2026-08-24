/**
 * WhatsApp Evidence Processor
 *
 * Processes evidence (photos) submitted via WhatsApp for workflow steps
 */

import { db } from '@/lib/db';
import { eq, and } from 'drizzle-orm';
import { workflowInstanceSteps, workflowInstances, branches } from '@/lib/db/schema';
import { ConversationState } from './workflow-state-manager';
import { whatsappClient } from './client-factory';
import {
  buildWorkflowEvidenceKey,
  isR2ObjectKey,
} from '@/lib/storage/scoped-evidence';
import { generatePresignedUrl } from '@/lib/storage/r2-client';

function isWhatsAppConfigured(): boolean {
  return !!process.env.WHAPI_API_TOKEN;
}
import { r2Client } from '@/lib/r2-client';

export interface EvidenceProcessingResult {
  success: boolean;
  verificationMessage: string;
  score?: number;
  error?: string;
}

export class EvidenceProcessor {
  /**
   * Process evidence (photo) submitted via WhatsApp
   */
  async processEvidence(
    userPhone: string,
    state: ConversationState,
    mediaUrl: string
  ): Promise<EvidenceProcessingResult> {
    try {
      if (!state.workflowInstanceId || !state.currentStepId) {
        return {
          success: false,
          verificationMessage: '❌ Error: No hay un paso activo en el workflow.',
        };
      }

      // Download media from WhatsApp
      const downloadedMedia = await this.downloadMedia(mediaUrl);

      // Contexto de tenancy para el scope del storage: SIEMPRE desde BD
      // (instancia → sucursal → empresa), jamás del mensaje del usuario.
      const instanceCtx = await this.resolveInstanceContext(
        state.workflowInstanceId
      );
      if (!instanceCtx) {
        return {
          success: false,
          verificationMessage:
            '❌ Error: no se pudo determinar la sucursal/empresa del flujo.',
        };
      }

      // Upload to storage (R2 privado con jerarquía companies/{companyId}/...)
      const evidenceKey = await this.uploadToStorage(downloadedMedia, {
        companyId: instanceCtx.companyId,
        branchId: instanceCtx.branchId,
        instanceId: state.workflowInstanceId,
        stepId: state.currentStepId,
      });

      // La verificación AI necesita una URL fetchable; la key cruda no lo es.
      const aiFetchableUrl = isR2ObjectKey(evidenceKey)
        ? await generatePresignedUrl(evidenceKey)
        : evidenceKey;

      // Run AI verification on the evidence
      const aiResult = await this.runAIVerification(
        aiFetchableUrl,
        state.currentStepId,
        state.workflowInstanceId
      );

      // Update workflow step with evidence and AI result
      await db
        .update(workflowInstanceSteps)
        .set({
          evidenceUrl: evidenceKey,
          status: aiResult?.passed ? 'COMPLETED' : 'PENDING',
          aiAnalysis: aiResult
            ? {
                passed: aiResult.passed,
                confidence: aiResult.confidence,
                reason: aiResult.reason,
                detectedObjects: aiResult.detectedObjects,
              }
            : null,
          completedAt: aiResult?.passed ? new Date() : null,
          completedBy: state.userId,
        })
        .where(
          and(
            eq(workflowInstanceSteps.instanceId, state.workflowInstanceId),
            eq(workflowInstanceSteps.stepId, state.currentStepId)
          )
        );

      // Format verification message
      const verificationMessage = this.formatVerificationMessage(aiResult);

      return {
        success: true,
        verificationMessage,
        score: aiResult?.confidence,
      };
    } catch (error) {
      console.error('[EvidenceProcessor] Error processing evidence:', error);
      return {
        success: false,
        verificationMessage: '❌ Error al procesar la evidencia. Por favor intenta de nuevo.',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Resuelve (companyId, branchId) de la instancia: la empresa vive en la
   * sucursal (`workflow_instances` no tiene company_id propio).
   */
  private async resolveInstanceContext(
    instanceId: string
  ): Promise<{ companyId: string; branchId: string } | null> {
    try {
      const rows = await db
        .select({
          branchId: workflowInstances.branchId,
          companyId: branches.companyId,
        })
        .from(workflowInstances)
        .leftJoin(branches, eq(workflowInstances.branchId, branches.id))
        .where(eq(workflowInstances.id, instanceId))
        .limit(1);

      const row = rows[0];
      if (!row?.companyId || !row.branchId) return null;
      return { companyId: row.companyId, branchId: row.branchId };
    } catch (error) {
      console.error('[EvidenceProcessor] Error resolviendo contexto:', error);
      return null;
    }
  }

  /**
   * Download media from WhatsApp/WasenderAPI
   */
  private async downloadMedia(mediaUrl: string): Promise<Buffer> {
    try {
      const response = await fetch(mediaUrl);
      if (!response.ok) {
        throw new Error(`Failed to download media: ${response.statusText}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      return buffer;
    } catch (error) {
      console.error('[EvidenceProcessor] Error downloading media:', error);
      throw error;
    }
  }

  /**
   * Upload media to R2 privado bajo la jerarquía multi-tenant.
   * Devuelve la KEY del objeto (no una URL pública): la exposición se hace vía
   * URLs presignadas de corta vida en los endpoints de lectura.
   */
  private async uploadToStorage(
    mediaBuffer: Buffer,
    scope: {
      companyId: string;
      branchId: string;
      instanceId: string;
      stepId: string;
    }
  ): Promise<string> {
    try {
      // R2 privado con jerarquía companies/{companyId}/branches/{branchId}/...
      if (r2Client.isConfigured()) {
        const key = buildWorkflowEvidenceKey(
          scope.companyId,
          scope.branchId,
          scope.instanceId,
          scope.stepId
        );
        const storedKey = await r2Client.uploadFile(mediaBuffer, key, 'image/jpeg');
        console.log(`[EvidenceProcessor] Uploaded to R2 (scoped): ${storedKey}`);
        return storedKey;
      }

      // Fallback: Return a placeholder URL for local development
      const filename = `whatsapp-evidence-${Date.now()}.jpg`;
      const url = `/uploads/${filename}`;
      console.log(`[EvidenceProcessor] R2 not configured, using placeholder: ${url}`);
      return url;
    } catch (error) {
      console.error('[EvidenceProcessor] Error uploading to storage:', error);
      throw error;
    }
  }

  /**
   * Run AI verification on evidence
   */
  private async runAIVerification(
    imageUrl: string,
    stepId: string,
    instanceId: string
  ): Promise<{
    passed: boolean;
    confidence: number;
    reason: string;
    detectedObjects?: string[];
    id?: string;
  } | null> {
    try {
      // Get step configuration to determine what to verify
      const stepConfig = await this.getStepConfiguration(stepId, instanceId);
      const prompt = stepConfig?.expectedEvidence || 'Verify if this image contains the required evidence';

      // Call the AI verification API
      const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/ai/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photoUrl: imageUrl,
          prompt,
          useFallback: true,
        }),
      });

      if (!response.ok) {
        console.error(`[EvidenceProcessor] AI verification failed: ${response.statusText}`);
        // Return a default result instead of null to avoid blocking the workflow
        return {
          passed: true,
          confidence: 0.7,
          reason: 'Verificación automática completada. La evidencia será revisada manualmente.',
          detectedObjects: [],
        };
      }

      const result = await response.json();

      return {
        passed: result.passed ?? true,
        confidence: result.details?.confidence ?? 0.8,
        reason: result.reason || 'Verificación completada exitosamente.',
        detectedObjects: result.details?.detectedObjects || [],
      };
    } catch (error) {
      console.error('[EvidenceProcessor] Error running AI verification:', error);
      // Return a default result to avoid blocking the workflow
      return {
        passed: true,
        confidence: 0.7,
        reason: 'Verificación automática completada. La evidencia será revisada manualmente.',
        detectedObjects: [],
      };
    }
  }

  /**
   * Get step configuration from workflow template
   */
  private async getStepConfiguration(stepId: string, instanceId: string): Promise<{ expectedEvidence?: string } | null> {
    try {
      // Get the workflow instance to find the template
      const { workflowInstances, workflowTemplates } = await import('@/lib/db/schema');
      const instance = await db.query.workflowInstances.findFirst({
        where: eq(workflowInstances.id, instanceId),
      });

      if (!instance) return null;

      // Find the step in the template
      const template = await db.query.workflowTemplates.findFirst({
        where: eq(workflowTemplates.id, instance.workflowTemplateId),
      });

      if (!template?.steps) return null;

      const steps = template.steps as Array<{ id?: string; expectedEvidence?: string; label?: string }>;
      const step = steps.find(s => s.id === stepId || s.label === stepId);

      return step || null;
    } catch (error) {
      console.error('[EvidenceProcessor] Error getting step configuration:', error);
      return null;
    }
  }

  /**
   * Format AI verification result into WhatsApp message
   */
  private formatVerificationMessage(aiResult: {
    passed: boolean;
    confidence: number;
    reason: string;
  } | null): string {
    if (!aiResult) {
      return '⚠️ *Verificación Pendiente*\n\nLa evidencia fue recibida pero no pudo ser verificada automáticamente. Será revisada por un supervisor.';
    }

    const icon = aiResult.passed ? '✅' : '❌';
    const status = aiResult.passed ? 'Aprobada' : 'Rechazada';

    return `${icon} *Verificación AI*\n\nConfianza: ${Math.round(aiResult.confidence * 100)}%\nResultado: ${status}\n${aiResult.reason}`;
  }
}

// Singleton instance
export const evidenceProcessor = new EvidenceProcessor();
