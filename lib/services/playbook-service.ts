/**
 * PlaybookService — playbooks corporativos: "el grupo define, las sucursales
 * ejecutan".
 *
 * Modelo (ver la nota de diseño en lib/db/schema/playbooks.ts): un playbook es
 * UNA fila de `workflow_templates` con `scope='company'`. Publicar no copia la
 * plantilla: inserta filas en `playbook_publications` que declaran en qué
 * sucursales aplica. Consecuencias directas:
 *
 *  - Publicar la v2 es editar el template. Todas las sucursales publicadas ven
 *    la nueva versión sin cascada ni reconcile de copias huérfanas.
 *  - `publish` es idempotente por diseño (UPSERT sobre el índice único
 *    (template_id, branch_id)); reintentarlo no duplica nada.
 *  - Revocar conserva la fila con `status='REVOKED'` — queda el historial de
 *    quién tuvo qué playbook y hasta cuándo, que es lo que pide una auditoría.
 *
 * Todas las operaciones verifican que el template pertenezca a `companyId`
 * antes de tocar nada: el id de un template es `text` y viaja en la URL.
 */
import { db } from "@/lib/db";
import {
  workflowTemplates,
  branches,
  playbookPublications,
  playbookVersions,
} from "@/lib/db/schema";
import { and, count, desc, eq, inArray, notInArray } from "drizzle-orm";

export type PlaybookScope = "company" | "branch";

export interface PlaybookPublicationState {
  branchId: string;
  branchName: string;
  published: boolean;
  version: number | null;
  publishedAt: Date | null;
}

export interface PlaybookSummary {
  id: string;
  name: string | null;
  description: string | null;
  category: string | null;
  scope: PlaybookScope;
  version: number;
  active: boolean;
  updatedAt: Date | null;
  /** true si el playbook aplica a todas las sucursales (sin publicaciones). */
  appliesToAllBranches: boolean;
  publishedBranchCount: number;
  totalBranchCount: number;
}

/** Falla si el template no existe o no pertenece a la compañía. */
async function assertOwnedTemplate(templateId: string, companyId: string) {
  const [template] = await db
    .select()
    .from(workflowTemplates)
    .where(
      and(
        eq(workflowTemplates.id, templateId),
        eq(workflowTemplates.companyId, companyId),
      ),
    )
    .limit(1);

  if (!template) {
    throw Object.assign(new Error("Playbook no encontrado"), { statusCode: 404 });
  }
  return template;
}

/** Falla si alguna sucursal solicitada no pertenece a la compañía. */
async function assertOwnedBranches(branchIds: string[], companyId: string) {
  if (branchIds.length === 0) return [];

  const rows = await db
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .where(
      and(
        eq(branches.companyId, companyId),
        inArray(branches.id, branchIds),
      ),
    );

  if (rows.length !== new Set(branchIds).size) {
    throw Object.assign(
      new Error("Una o más sucursales no pertenecen a la compañía"),
      { statusCode: 403 },
    );
  }
  return rows;
}

export const PlaybookService = {
  /**
   * Marca el template como playbook corporativo y fija su alcance.
   *
   * `branchIds` vacío o `null` ⇒ "todas las sucursales": se revocan las
   * publicaciones existentes y el playbook queda visible en todo el grupo.
   * Con sucursales ⇒ solo esas quedan publicadas; las que salieron de la lista
   * se revocan en la misma operación (el alcance es declarativo, no aditivo).
   */
  async publish(
    templateId: string,
    companyId: string,
    branchIds: string[] | null,
    opts?: { userId?: string; changeNote?: string },
  ): Promise<{ scope: PlaybookScope; publishedBranchIds: string[] }> {
    const template = await assertOwnedTemplate(templateId, companyId);
    const targets = branchIds ?? [];
    await assertOwnedBranches(targets, companyId);

    const version = template.version ?? 1;

    await db
      .update(workflowTemplates)
      .set({ scope: "company", updatedAt: new Date() })
      .where(eq(workflowTemplates.id, templateId));

    // Snapshot de versión (idempotente por (template, version)).
    await db
      .insert(playbookVersions)
      .values({
        templateId,
        companyId,
        version,
        name: template.name,
        description: template.description,
        steps: template.steps ?? [],
        changeNote: opts?.changeNote ?? null,
        createdBy: opts?.userId ?? null,
      })
      .onConflictDoNothing({
        target: [playbookVersions.templateId, playbookVersions.version],
      });

    if (targets.length > 0) {
      for (const branchId of targets) {
        await db
          .insert(playbookPublications)
          .values({
            templateId,
            companyId,
            branchId,
            version,
            status: "PUBLISHED",
            publishedBy: opts?.userId ?? null,
          })
          .onConflictDoUpdate({
            target: [playbookPublications.templateId, playbookPublications.branchId],
            set: {
              version,
              status: "PUBLISHED",
              publishedBy: opts?.userId ?? null,
              publishedAt: new Date(),
              revokedAt: null,
              updatedAt: new Date(),
            },
          });
      }

      // Revocar las que quedaron fuera del alcance declarado.
      await db
        .update(playbookPublications)
        .set({ status: "REVOKED", revokedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(playbookPublications.templateId, templateId),
            eq(playbookPublications.status, "PUBLISHED"),
            notInArray(playbookPublications.branchId, targets),
          ),
        );
    } else {
      // "Todas las sucursales": sin publicaciones vivas.
      await db
        .update(playbookPublications)
        .set({ status: "REVOKED", revokedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(playbookPublications.templateId, templateId),
            eq(playbookPublications.status, "PUBLISHED"),
          ),
        );
    }

    return { scope: "company", publishedBranchIds: targets };
  },

  /**
   * Devuelve el template a plantilla local: `scope='branch'` y todas las
   * publicaciones revocadas. No borra el template ni su historial.
   */
  async unpublish(templateId: string, companyId: string): Promise<void> {
    await assertOwnedTemplate(templateId, companyId);

    await db
      .update(workflowTemplates)
      .set({ scope: "branch", updatedAt: new Date() })
      .where(eq(workflowTemplates.id, templateId));

    await db
      .update(playbookPublications)
      .set({ status: "REVOKED", revokedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(playbookPublications.templateId, templateId),
          eq(playbookPublications.status, "PUBLISHED"),
        ),
      );
  },

  /** Alcance actual del template, sin cargar el estado por sucursal. */
  async getScope(templateId: string, companyId: string): Promise<PlaybookScope> {
    const template = await assertOwnedTemplate(templateId, companyId);
    return template.scope === "company" ? "company" : "branch";
  },

  /** Estado por sucursal de un playbook (incluye las NO publicadas). */
  async getPublicationState(
    templateId: string,
    companyId: string,
  ): Promise<PlaybookPublicationState[]> {
    await assertOwnedTemplate(templateId, companyId);

    const [allBranches, pubs] = await Promise.all([
      db
        .select({ id: branches.id, name: branches.name })
        .from(branches)
        .where(and(eq(branches.companyId, companyId), eq(branches.active, true)))
        .orderBy(branches.name),
      db
        .select()
        .from(playbookPublications)
        .where(
          and(
            eq(playbookPublications.templateId, templateId),
            eq(playbookPublications.status, "PUBLISHED"),
          ),
        ),
    ]);

    const byBranch = new Map(pubs.map((p) => [p.branchId, p]));

    return allBranches.map((b) => {
      const pub = byBranch.get(b.id);
      return {
        branchId: b.id,
        branchName: b.name,
        published: !!pub,
        version: pub?.version ?? null,
        publishedAt: pub?.publishedAt ?? null,
      };
    });
  },

  /** Listado de playbooks corporativos con su cobertura. */
  async listPublished(companyId: string): Promise<PlaybookSummary[]> {
    const [templates, branchRow, pubs] = await Promise.all([
      db
        .select()
        .from(workflowTemplates)
        .where(
          and(
            eq(workflowTemplates.companyId, companyId),
            eq(workflowTemplates.scope, "company"),
          ),
        )
        .orderBy(workflowTemplates.name),
      db
        .select({ n: count() })
        .from(branches)
        .where(and(eq(branches.companyId, companyId), eq(branches.active, true))),
      db
        .select({
          templateId: playbookPublications.templateId,
          n: count(),
        })
        .from(playbookPublications)
        .where(
          and(
            eq(playbookPublications.companyId, companyId),
            eq(playbookPublications.status, "PUBLISHED"),
          ),
        )
        .groupBy(playbookPublications.templateId),
    ]);

    const totalBranchCount = branchRow[0]?.n ?? 0;
    const pubCount = new Map(pubs.map((p) => [p.templateId, p.n]));

    return templates.map((t) => {
      const published = pubCount.get(t.id) ?? 0;
      return {
        id: t.id,
        name: t.name,
        description: t.description,
        category: t.category,
        scope: "company" as const,
        version: t.version ?? 1,
        active: t.active ?? true,
        updatedAt: t.updatedAt,
        appliesToAllBranches: published === 0,
        publishedBranchCount: published === 0 ? totalBranchCount : published,
        totalBranchCount,
      };
    });
  },

  /**
   * Ids de templates visibles para una sucursal.
   *
   * Regla: un playbook corporativo SIN publicaciones aplica a todo el grupo;
   * CON publicaciones aplica solo donde esté publicado. Devuelve `null` cuando
   * no hay ningún playbook restringido — el caller puede entonces saltarse el
   * filtro por completo en vez de construir un `NOT IN` gigante.
   */
  async getRestrictedTemplateIds(
    companyId: string,
    branchId: string,
  ): Promise<{ hiddenTemplateIds: string[] }> {
    const restricted = await db
      .selectDistinct({ templateId: playbookPublications.templateId })
      .from(playbookPublications)
      .where(
        and(
          eq(playbookPublications.companyId, companyId),
          eq(playbookPublications.status, "PUBLISHED"),
        ),
      );

    if (restricted.length === 0) return { hiddenTemplateIds: [] };

    const visibleHere = await db
      .select({ templateId: playbookPublications.templateId })
      .from(playbookPublications)
      .where(
        and(
          eq(playbookPublications.companyId, companyId),
          eq(playbookPublications.branchId, branchId),
          eq(playbookPublications.status, "PUBLISHED"),
        ),
      );

    const visible = new Set(visibleHere.map((v) => v.templateId));
    return {
      hiddenTemplateIds: restricted
        .map((r) => r.templateId)
        .filter((id) => !visible.has(id)),
    };
  },

  /**
   * Número de playbooks corporativos activos — alimenta
   * `corporate_twins.playbookCount` desde `ExecutiveTwinEngine.computeDimensions`.
   *
   * IMPORTANTE: el contador NO se escribe desde aquí. `recalculate()` reescribe
   * esa columna cada 15 minutos, así que cualquier backfill externo se perdería
   * en el siguiente ciclo. La única forma estable es que el engine lo calcule.
   */
  async countCompanyPlaybooks(companyId: string): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(workflowTemplates)
      .where(
        and(
          eq(workflowTemplates.companyId, companyId),
          eq(workflowTemplates.scope, "company"),
          eq(workflowTemplates.active, true),
        ),
      );
    return row?.n ?? 0;
  },

  /** Historial de versiones de un playbook. */
  async getVersions(templateId: string, companyId: string) {
    await assertOwnedTemplate(templateId, companyId);
    return db
      .select()
      .from(playbookVersions)
      .where(eq(playbookVersions.templateId, templateId))
      .orderBy(desc(playbookVersions.version));
  },
} as const;
