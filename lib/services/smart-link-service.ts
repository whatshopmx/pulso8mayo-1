import { db } from "@/lib/db";
import { magicLinks, workflowInstances } from "@/lib/db/schema";
import { eq, and, gt, desc, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || nanoid(32);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Base URL del smart link sin barra final: un NEXT_PUBLIC_APP_URL con "/"
 * colgando producía URLs con doble barra (//workflow/public/...).
 */
function smartLinkBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export interface GetOrCreateSmartLinkOptions {
  /** Id de la plantilla. Se deduce de la instancia si no se pasa. */
  templateId?: string;
  /** UUID del turno, o null/undefined si el flujo no cuelga de un turno. */
  sessionId?: string | null;
  expiresInMinutes?: number;
  requiredRole?: string;
  assignedTo?: string;
  role?: string;
  assignmentId?: string;
  stepId?: string;
}

export interface ResolvedSmartLink extends SmartLinkContext {
  /** true si se creó un token nuevo; false si se reutilizó uno vigente. */
  fresh: boolean;
}

export interface SmartLinkContext {
  token: string;
  expiresAt: Date;
  url: string;
  instanceId: string;
  workflowTemplateId: string;
  sessionId: string | null;
  requiredRole?: string;
  assignedTo?: string;
  role?: string;
  assignmentId?: string;
}

export interface ValidatedSmartLink {
  link: typeof magicLinks.$inferSelect;
  instance: typeof workflowInstances.$inferSelect;
  decoded: {
    instanceId: string;
    templateId: string;
    sessionId: string;
    requiredRole?: string;
    assignedTo?: string;
    role?: string;
    assignmentId?: string;
    stepId?: string;
    type: string;
    iat: number;
    exp: number;
  };
}

export class SmartLinkService {
  /**
   * Obtener (o crear) el enlace vigente de una instancia.
   *
   * Prioridad:
   * 1. Reutilizar un enlace PENDING no vencido de la instancia (los enlaces no son
   *    de un solo uso: el destinatario puede abrir, interrumpirse y volver).
   * 2. Invalidar cualquier otro PENDING colgado (vencido o de una asignación previa)
   *    y crear uno nuevo con el contexto actual (assignedTo/assignmentId).
   *
   * Así los recordatorios, vencidos y reasignaciones reutilizan el mismo token en
   * lugar de emitir uno nuevo cada vez (ver plan smartlinks-flujos-programados 4.4).
   */
  static async getOrCreateForInstance(
    instanceId: string,
    templateId?: string,
    opts: GetOrCreateSmartLinkOptions = {}
  ): Promise<ResolvedSmartLink | null> {
    // Contexto de la instancia en una sola consulta: además de deducir el
    // templateId, sirve para el guard de plan 5.5 — una instancia ya completada
    // no debe reabrirse por enlace (sus enlaces quedaron USED y no se resucitan).
    const [instance] = await db
      .select({
        status: workflowInstances.status,
        workflowTemplateId: workflowInstances.workflowTemplateId,
      })
      .from(workflowInstances)
      .where(eq(workflowInstances.id, instanceId))
      .limit(1);

    if (!instance) {
      console.warn(`[SmartLink] Instance ${instanceId} not found, refusing to create link`);
      return null;
    }

    if (instance.status === 'COMPLETED') {
      return null;
    }

    // 1. Enlace vigente (PENDING, no vencido)
    const [active] = await db
      .select()
      .from(magicLinks)
      .where(
        and(
          eq(magicLinks.instanceId, instanceId),
          eq(magicLinks.status, "PENDING"),
          gt(magicLinks.expiresAt, new Date())
        )
      )
      .orderBy(desc(magicLinks.createdAt))
      .limit(1);

    if (active) {
      return {
        token: active.token,
        expiresAt: active.expiresAt,
        url: `${smartLinkBaseUrl()}/workflow/public/${active.token}`,
        instanceId,
        workflowTemplateId: active.workflowTemplateId,
        sessionId: active.sessionId,
        requiredRole: opts.requiredRole,
        assignedTo: opts.assignedTo,
        role: opts.role,
        assignmentId: opts.assignmentId,
        fresh: false,
      };
    }

    // 2. Invalidar los PENDING colgando de esta instancia para no acumular tokens.
    await db
      .update(magicLinks)
      .set({ status: "USED", usedAt: new Date() })
      .where(
        and(eq(magicLinks.instanceId, instanceId), eq(magicLinks.status, "PENDING"))
      );

    // Si no trajeron templateId, lo deducimos de la instancia (ya consultada).
    const resolvedTemplateId = templateId || instance.workflowTemplateId;
    if (!resolvedTemplateId) {
      console.warn(`[SmartLink] No templateId for instance ${instanceId}, refusing to create link`);
      return null;
    }

    // 3. Crear uno nuevo con el contexto actual.
    const link = await this.createSmartLink(
      instanceId,
      resolvedTemplateId,
      opts.sessionId,
      opts.expiresInMinutes,
      opts.requiredRole,
      opts.assignedTo,
      opts.role,
      opts.assignmentId,
      opts.stepId
    );

    return { ...link, fresh: true };
  }

  /**
   * Generate a new smart link with encrypted JWT token for a specific workflow instance
   * @param instanceId The ID of the workflow instance
   * @param templateId The ID of the workflow template
   * @param sessionId Optional session ID if linked to a specific shift
   * @param expiresInMinutes Duration in minutes before the link expires
   * @param requiredRole Optional required role to access this workflow
   * @param assignedTo Optional user ID this workflow is assigned to
   */
  static async createSmartLink(
    instanceId: string,
    templateId: string,
    /** UUID del turno, o null/undefined si el flujo no cuelga de un turno. */
    sessionId?: string | null,
    expiresInMinutes: number = 60 * 24,
    requiredRole?: string,
    assignedTo?: string,
    role?: string,
    assignmentId?: string,
    stepId?: string
  ): Promise<SmartLinkContext> {
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

    // Sólo aceptamos un UUID real; cualquier otra cosa se trata como "sin turno"
    // en vez de reventar el INSERT.
    const normalizedSessionId =
      typeof sessionId === "string" && UUID_PATTERN.test(sessionId) ? sessionId : null;

    const tokenPayload: any = {
      instanceId,
      templateId,
      sessionId: normalizedSessionId,
      type: 'SMART_LINK',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(expiresAt.getTime() / 1000)
    };

    if (requiredRole) {
      tokenPayload.requiredRole = requiredRole;
    }
    if (assignedTo) {
      tokenPayload.assignedTo = assignedTo;
    }
    if (role) {
      tokenPayload.role = role;
    }
    if (assignmentId) {
      tokenPayload.assignmentId = assignmentId;
    }
    if (stepId) {
      tokenPayload.stepId = stepId;
    }

    const token = jwt.sign(tokenPayload, JWT_SECRET, { algorithm: 'HS256' });

    await db.insert(magicLinks).values({
      token,
      instanceId,
      workflowTemplateId: templateId,
      sessionId: normalizedSessionId,
      status: 'PENDING',
      expiresAt,
    });

    return {
      token,
      expiresAt,
      url: `${smartLinkBaseUrl()}/workflow/public/${token}`,
      instanceId,
      workflowTemplateId: templateId,
      sessionId: normalizedSessionId,
      requiredRole,
      assignedTo,
      role,
      assignmentId,
    };
  }

  /**
   * Validate a token and return the associated context
   * @param token The smart link token (JWT)
   */
  static async validateSmartLink(token: string): Promise<ValidatedSmartLink | null> {
    try {
      // First verify the JWT token
      const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;

      // Check if it's a valid smart link token
      if (decoded.type !== 'SMART_LINK') {
        console.warn('[SmartLink] Invalid token type');
        return null;
      }

      // Check database for the token status
      const [link] = await db
        .select()
        .from(magicLinks)
        .where(
          and(
            eq(magicLinks.token, token),
            eq(magicLinks.status, 'PENDING'),
            gt(magicLinks.expiresAt, new Date())
          )
        )
        .limit(1);

      if (!link) {
        console.warn('[SmartLink] Link not found, already used, or expired');
        return null;
      }

      // Also fetch the instance to ensure it's still valid/pending
      const [instance] = await db
        .select()
        .from(workflowInstances)
        .where(eq(workflowInstances.id, link.instanceId))
        .limit(1);

      if (!instance) {
        console.warn('[SmartLink] Associated instance not found');
        return null;
      }

      return {
        link,
        instance,
        decoded: {
          instanceId: decoded.instanceId as string,
          templateId: decoded.templateId as string,
          sessionId: decoded.sessionId as string,
          requiredRole: decoded.requiredRole as string | undefined,
          assignedTo: decoded.assignedTo as string | undefined,
          type: decoded.type as string,
          iat: decoded.iat as number,
          exp: decoded.exp as number,
        }
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[SmartLink] Token validation failed:', errorMessage);
      return null;
    }
  }

    /**
     * Mark a smart link as used (after successful workflow completion)
     * @param token The smart link token
     */
    static async markSmartLinkUsed(token: string): Promise<void> {
        await db
            .update(magicLinks)
            .set({
                status: 'USED',
                usedAt: new Date()
            })
            .where(eq(magicLinks.token, token));
    }

    /**
     * Cerrar todos los enlaces PENDING de una instancia (plan 5.5): al completar
     * el flujo, un enlace ya no debe seguir abriendo la ejecución. Se conserva el
     * usedAt de la primera apertura si ya existía (coalesce), para no perder la
     * traza de cuándo se abrió por primera vez.
     */
    static async markUsedForInstance(instanceId: string): Promise<void> {
        await db
            .update(magicLinks)
            .set({
                status: 'USED',
                usedAt: sql`coalesce(${magicLinks.usedAt}, now())`,
            })
            .where(
                and(
                    eq(magicLinks.instanceId, instanceId),
                    eq(magicLinks.status, 'PENDING')
                )
            );
    }

    /**
     * Registrar la apertura del enlace (plan 5.5): llena usedAt la primera vez sin
     * tocar status — el enlace NO es de un solo uso, el destinatario puede abrir,
     * interrumpirse y volver. Idempotente por construcción (coalesce).
     */
    static async recordOpen(token: string): Promise<void> {
        await db
            .update(magicLinks)
            .set({
                usedAt: sql`coalesce(${magicLinks.usedAt}, now())`,
            })
            .where(
                and(eq(magicLinks.token, token), eq(magicLinks.status, 'PENDING'))
            );
    }

    /**
     * Mark a smart link as failed (for escalation tracking)
     * @param token The smart link token
     */
    static async markSmartLinkFailed(token: string): Promise<void> {
        await db
            .update(magicLinks)
            .set({
                status: 'FAILED',
                usedAt: new Date()
            })
            .where(eq(magicLinks.token, token));
    }

    /**
     * Get smart link statistics for a workflow instance
     * @param instanceId The workflow instance ID
     */
    static async getSmartLinkStats(instanceId: string): Promise<{
        total: number;
        pending: number;
        used: number;
        failed: number;
    }> {
        const links = await db
            .select()
            .from(magicLinks)
            .where(eq(magicLinks.instanceId, instanceId));

        return {
            total: links.length,
            pending: links.filter(l => l.status === 'PENDING').length,
            used: links.filter(l => l.status === 'USED').length,
            failed: links.filter(l => l.status === 'FAILED').length
        };
    }

    /**
     * Refresh a smart link (invalidate old one and create new)
     * @param oldToken The old token to invalidate
     * @param expiresInMinutes New expiration time in minutes
     */
    static async refreshSmartLink(oldToken: string, expiresInMinutes?: number): Promise<SmartLinkContext | null> {
        const oldLink = await this.validateSmartLink(oldToken);
        
        if (!oldLink) {
            return null;
        }

        // Mark old token as used
        await this.markSmartLinkUsed(oldToken);

        // Create new link with same parameters
        return await this.createSmartLink(
            oldLink.instance.id,
            oldLink.link.workflowTemplateId,
            oldLink.link.sessionId,
            expiresInMinutes
        );
    }
}
