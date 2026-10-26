import { db } from "@/lib/db";
import { branches, users } from "@/lib/db/schema";
import { eq, and, desc, isNull, or, sql, inArray } from "drizzle-orm";
import { CreateBranchInput, UpdateBranchInput } from "@/lib/validations/branch";
import { ApiError } from "@/lib/api/error";

export class BranchService {
    static async listBranches(companyId: string) {
        if (!companyId) throw ApiError.badRequest("Company ID required to list branches");

        const branchList = await db.query.branches.findMany({
            where: eq(branches.companyId, companyId),
            orderBy: desc(branches.createdAt)
        });

        // Get all manager IDs from branches
        const managerIds = branchList.map(b => b.managerId).filter((id): id is string => !!id);
        
        // Get all managers in one query
        let managers: any[] = [];
        if (managerIds.length > 0) {
            managers = await db.query.users.findMany({
                where: inArray(users.id, managerIds),
                columns: {
                    id: true,
                    name: true,
                    email: true
                }
            });
        }

        // Attach manager info to branches
        const managerMap = new Map(managers.map(m => [m.id, m]));
        return branchList.map(branch => ({
            ...branch,
            manager: managerMap.get(branch.managerId!) || null
        }));
    }

  /**
     * C22 — el responsable de una franquicia tiene que existir en la empresa.
     *
     * `franchiseeUserId` es un id de usuario que decide visibilidad
     * (`branchVisibilityFilter` compara contra `ctx.userId`). Aceptar uno de
     * otra empresa no es un dato sucio: es un id que el filtrado compararía
     * contra actores que nunca son esa persona, y la sucursal quedaría
     * invisible para su propio responsable sin que nada lo dijera.
     */
    private static async verificarFranquiciatario(
        companyId: string,
        franchiseeUserId: string | null | undefined
    ): Promise<void> {
        if (!franchiseeUserId) return;

        const [franchisee] = await db
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.id, franchiseeUserId), eq(users.companyId, companyId)))
            .limit(1);

        if (!franchisee) {
            throw ApiError.badRequest("El franquiciatario responsable no pertenece a esta empresa.");
        }
    }

    /**
     * El invariante de una sucursal marcada como franquicia: sin responsable
     * no hay a quién mostrarle (`branchVisibilityFilter` sólo la abre para su
     * `franchiseeUserId`), así que el servicio la rechaza en lugar de guardar
     * una unidad invisible para su propio franquiciatario. El contrato Zod lo
     * pide en la captura y aquí se pide otra vez, porque el servicio también
     * se llama sin pasar por la ruta.
     */
    private static exigirResponsableSiEsFranquicia(
        ownershipType: "OWNED" | "FRANCHISE" | null | undefined,
        franchiseeUserId: string | null | undefined
    ): void {
        if (ownershipType === "FRANCHISE" && !franchiseeUserId) {
            throw ApiError.badRequest("Elige quién responde por la sucursal: sin franquiciatario no se puede ver.");
        }
    }

    static async createBranch(data: CreateBranchInput) {
        if (!data.companyId) throw ApiError.badRequest("Company ID required for branch creation");

        this.exigirResponsableSiEsFranquicia(data.ownershipType, data.franchiseeUserId);
        await this.verificarFranquiciatario(data.companyId, data.franchiseeUserId);

        const newBranch = await db.insert(branches).values({
      name: data.name,
      companyId: data.companyId,
      address: data.address,
      imssRegistroPatronal: data.imssRegistroPatronal,
      timezone: data.timezone,
      operatingHours: data.operatingHours,
      location: data.location,
      managerId: data.managerId,
      ownershipType: data.ownershipType ?? "OWNED",
      // Una sucursal propia no tiene franquiciatario: dejarlo puesto sería un
      // dato que el filtro leería más adelante si alguien la reclasifica.
      franchiseeUserId: data.ownershipType === "FRANCHISE" ? data.franchiseeUserId ?? null : null,
    }).returning();

    return newBranch[0];
  }

    static async getBranch(id: string, companyId?: string) {
        const where = companyId
            ? and(eq(branches.id, id), eq(branches.companyId, companyId))
            : eq(branches.id, id);

        const branch = await db.query.branches.findFirst({
            where
        });

        if (!branch) throw ApiError.notFound("Branch not found");

        // Get manager info if exists
        let manager = null;
if (branch.managerId) {
  const managerUser = await db.query.users.findFirst({
    where: eq(users.id, branch.managerId),
    columns: {
      id: true,
      name: true,
      email: true,
      role: true
    }
  }) as { id: string; name: string; email: string; role: string } | undefined;
  manager = managerUser || null;
}

        return {
            ...branch,
            manager
        };
    }

    /**
     * El `WHERE` lleva `companyId` y es obligatorio, a propósito: hasta C22 el
     * servicio actualizaba y desactivaba por id sólo, y la tenencia la
     * comprobaba la ruta con un `getBranch` previo. Una ventana entre esa
     * lectura y la escritura no es un detalle teórico —es el hueco que C01–C07
     * cerraron en el resto de recorridos— y aquí el recorrido también muta la
     * propiedad de la sucursal, que decide visibilidad.
     */
    static async updateBranch(id: string, data: UpdateBranchInput, companyId?: string) {
        if (!companyId) {
            throw ApiError.badRequest("Company ID required to update a branch");
        }

        // La fila existente decide el estado final cuando el parche no trae la
        // propiedad: sin leerla, un `PATCH { franchiseeUserId: null }` dejaría
        // una franquicia sin responsable y la lectura posterior del filtro la
        // haría invisible para su propio franquiciatario sin avisar.
        const existente = await this.getBranch(id, companyId);

        await this.verificarFranquiciatario(companyId, data.franchiseeUserId);

        const ownershipFinal = data.ownershipType ?? existente.ownershipType ?? "OWNED";
        const responsableFinal =
            "franchiseeUserId" in data
                ? data.franchiseeUserId ?? null
                : existente.franchiseeUserId ?? null;
        this.exigirResponsableSiEsFranquicia(ownershipFinal, responsableFinal);

        const cambios: Partial<typeof branches.$inferInsert> = { ...data };
        // Una sucursal propia no conserva responsable: el estado final manda,
        // aunque el parche no traiga la propiedad y sólo el responsable.
        if (ownershipFinal === "OWNED") {
            cambios.franchiseeUserId = null;
        }

        await db.update(branches).set(cambios).where(and(eq(branches.id, id), eq(branches.companyId, companyId)));

        return await this.getBranch(id, companyId);
    }

    static async deleteBranch(id: string, companyId?: string) {
        if (!companyId) {
            throw ApiError.badRequest("Company ID required to deactivate a branch");
        }

        await db
            .update(branches)
            .set({ active: false })
            .where(and(eq(branches.id, id), eq(branches.companyId, companyId)));

        return true;
    }

    static async getBranchManagers(companyId: string, branchId?: string) {
        // Get all users with GERENTE role or users who are managers of any branch
        const baseConditions = eq(users.companyId, companyId);
        const roleCondition = or(
            eq(users.role, "GERENTE"),
            eq(users.role, "ADMIN")
        );

        if (branchId) {
            // Also include users who are already managers of this branch
            const branchManager = await db.query.branches.findFirst({
                where: eq(branches.id, branchId),
                columns: { managerId: true }
            });
            
            if (branchManager?.managerId) {
                // Include current manager even if role changed
                return await db.query.users.findMany({
                    where: and(
                        baseConditions,
                        or(
                            roleCondition,
                            eq(users.id, branchManager.managerId)
                        )
                    ),
                    columns: {
                        id: true,
                        name: true,
                        email: true,
                        role: true,
                        branchId: true
                    }
                });
            }
        }

        return await db.query.users.findMany({
            where: and(baseConditions, roleCondition),
            columns: {
                id: true,
                name: true,
                email: true,
                role: true,
                branchId: true
            }
        });
    }

    static async getBranchEmployees(branchId: string) {
        return await db.query.users.findMany({
            where: and(
                eq(users.branchId, branchId),
                eq(users.role, "EMPLEADO")
            ),
            columns: {
                id: true,
                name: true,
                email: true,
                role: true
            },
            orderBy: desc(users.createdAt)
        });
    }
}
