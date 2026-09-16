import { db } from "@/lib/db";
import { branchTerminals, branches, type terminalAcquirerEnum } from "@/lib/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { ApiError } from "@/lib/api/error";

export type TerminalAcquirer = typeof terminalAcquirerEnum.enumValues[number];

export interface CreateTerminalInput {
  companyId: string;
  branchId: string;
  serialNumber: string;
  alias: string;
  acquirer: TerminalAcquirer;
  affiliationNumber?: string | null;
  notes?: string | null;
  userId?: string;
}

export interface UpdateTerminalInput {
  branchId?: string;
  alias?: string;
  acquirer?: TerminalAcquirer;
  affiliationNumber?: string | null;
  active?: boolean;
  notes?: string | null;
  userId?: string;
}

export class TerminalService {
  /**
   * Consulta terminales autorizadas de una compañía o sucursal.
   */
  static async getTerminals(companyId: string, branchId?: string | null) {
    const conditions = [eq(branchTerminals.companyId, companyId)];
    if (branchId && branchId !== "ALL") {
      conditions.push(eq(branchTerminals.branchId, branchId));
    }

    return db
      .select({
        id: branchTerminals.id,
        companyId: branchTerminals.companyId,
        branchId: branchTerminals.branchId,
        branchName: branches.name,
        serialNumber: branchTerminals.serialNumber,
        alias: branchTerminals.alias,
        acquirer: branchTerminals.acquirer,
        affiliationNumber: branchTerminals.affiliationNumber,
        active: branchTerminals.active,
        notes: branchTerminals.notes,
        createdAt: branchTerminals.createdAt,
        updatedAt: branchTerminals.updatedAt,
      })
      .from(branchTerminals)
      .leftJoin(branches, eq(branchTerminals.branchId, branches.id))
      .where(and(...conditions))
      .orderBy(desc(branchTerminals.active), branchTerminals.alias);
  }

  /**
   * Registra una nueva terminal física autorizada.
   */
  static async createTerminal(input: CreateTerminalInput) {
    const {
      companyId,
      branchId,
      serialNumber,
      alias,
      acquirer,
      affiliationNumber,
      notes,
      userId,
    } = input;

    const cleanSerial = serialNumber.trim().toUpperCase();
    if (!cleanSerial) {
      throw ApiError.badRequest("El número de serie es obligatorio.");
    }
    if (!alias.trim()) {
      throw ApiError.badRequest("El alias de la terminal es obligatorio.");
    }

    // Verificar si el número de serie ya existe en la compañía
    const existing = await db.query.branchTerminals.findFirst({
      where: and(
        eq(branchTerminals.companyId, companyId),
        eq(branchTerminals.serialNumber, cleanSerial)
      ),
      columns: { id: true, alias: true, branchId: true },
    });

    if (existing) {
      throw ApiError.conflict(
        `Ya existe una terminal registrada con el número de serie "${cleanSerial}" (${existing.alias}).`
      );
    }

    const [terminal] = await db
      .insert(branchTerminals)
      .values({
        companyId,
        branchId,
        serialNumber: cleanSerial,
        alias: alias.trim(),
        acquirer,
        affiliationNumber: affiliationNumber?.trim() || null,
        active: true,
        notes: notes?.trim() || null,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();

    return terminal;
  }

  /**
   * Actualiza una terminal existente.
   */
  static async updateTerminal(
    id: string,
    companyId: string,
    input: UpdateTerminalInput
  ) {
    const existing = await db.query.branchTerminals.findFirst({
      where: and(
        eq(branchTerminals.id, id),
        eq(branchTerminals.companyId, companyId)
      ),
    });

    if (!existing) {
      throw ApiError.notFound("Terminal no encontrada.");
    }

    const updateValues: Partial<typeof branchTerminals.$inferInsert> = {
      updatedAt: new Date(),
      updatedBy: input.userId,
    };

    if (input.branchId) updateValues.branchId = input.branchId;
    if (input.alias !== undefined) updateValues.alias = input.alias.trim();
    if (input.acquirer) updateValues.acquirer = input.acquirer;
    if (input.affiliationNumber !== undefined) {
      updateValues.affiliationNumber = input.affiliationNumber?.trim() || null;
    }
    if (input.active !== undefined) updateValues.active = input.active;
    if (input.notes !== undefined) updateValues.notes = input.notes?.trim() || null;

    const [updated] = await db
      .update(branchTerminals)
      .set(updateValues)
      .where(
        and(
          eq(branchTerminals.id, id),
          eq(branchTerminals.companyId, companyId)
        )
      )
      .returning();

    return updated;
  }
}
