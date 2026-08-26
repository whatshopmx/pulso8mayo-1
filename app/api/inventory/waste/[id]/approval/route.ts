import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  companies,
  inventoryBatches,
  inventoryMovements,
  inventoryWaste,
} from "@/lib/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { withTenantAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { resolveBranchScope } from "@/lib/branch-scope";
import { AuditService } from "@/lib/services/audit-service";
import {
  evaluateApproval,
  type WasteApprovalStatus,
} from "@/lib/inventory/waste-approval";

/**
 * POST /api/inventory/waste/:id/approval — aprobar o rechazar una merma pendiente.
 *
 * Task 3 (plan-loteprod-gaps §8.1). Sólo aplica a mermas STAFF/COURTESY que
 * nacieron PENDING_APPROVAL (las AUTO se rechazan con NOT_PENDING — no tienen
 * flujo de aprobación).
 *
 * Reglas:
 * - Aprueba GERENTE+ (`roleIsAtLeast`), acotado a su sucursal vía
 *   `resolveBranchScope`; ADMIN/SUPER_ADMIN cualquier sucursal del tenant.
 * - Si el acumulado APROBADO del mes (empresa) + esta merma excede el tope
 *   `companies.courtesyWasteMonthlyCapCents`, exige ADMIN+ (rol superior).
 * - APROBAR descuenta inventario en ese momento (lote con `FOR UPDATE`): una
 *   merma rechazada o pendiente jamás movió stock.
 */
export const POST = withTenantAuth(
  async (
    req: NextRequest,
    { params, auth }: { params: Promise<{ id: string }>; auth: { tenantId: string; user: { id: string; role: string; branchId: string | null } } }
  ) => {
    const { id } = await params;
    if (!id) throw ApiError.badRequest("Falta el id de la merma");

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      throw ApiError.badRequest("Cuerpo de la petición inválido");
    }

    const action = body.action;
    if (action !== "APPROVE" && action !== "REJECT") {
      throw ApiError.badRequest(`Acción inválida: ${String(action)}. Usa APPROVE o REJECT`);
    }

    // --- Merma: scope empresa + sucursal ---------------------------------------
    const [waste] = await db
      .select()
      .from(inventoryWaste)
      .where(and(eq(inventoryWaste.id, id), eq(inventoryWaste.companyId, auth.tenantId)))
      .limit(1);

    if (!waste) throw ApiError.notFound("Merma no encontrada");

    const scope = resolveBranchScope(
      auth.user.role as never,
      auth.user.branchId,
      undefined
    );
    // Un GERENTE sólo resuelve mermas de su propia sucursal (mismo criterio
    // que la lectura de evidencia); ADMIN/SUPER_ADMIN pasan siempre.
    const allowedBranchIds =
      scope.kind === "BRANCH"
        ? [scope.branchId]
        : scope.kind === "ALL"
          ? null
          : [];
    if (allowedBranchIds !== null && !allowedBranchIds.includes(waste.branchId)) {
      throw ApiError.forbidden("Solo puedes resolver mermas de tu sucursal", {
        code: "BRANCH_FORBIDDEN",
      });
    }

    if (waste.approvalStatus !== "PENDING_APPROVAL") {
      throw ApiError.badRequest(
        `La merma no está pendiente de aprobación (estatus: ${waste.approvalStatus})`,
        { code: "NOT_PENDING" }
      );
    }

    // --- RECHAZO: no toca inventario --------------------------------------------
    if (action === "REJECT") {
      const [updated] = await db
        .update(inventoryWaste)
        .set({
          approvalStatus: "REJECTED",
          approvedBy: auth.user.id,
          approvedAt: new Date(),
        })
        .where(eq(inventoryWaste.id, id))
        .returning();

      AuditService.logInventoryAction({
        companyId: auth.tenantId,
        branchId: waste.branchId,
        action: "UPDATE",
        entityType: "WASTE",
        entityId: id,
        oldValue: { approvalStatus: "PENDING_APPROVAL" },
        newValue: { approvalStatus: "REJECTED" },
        performedBy: auth.user.id,
        reason: `Waste rejected: ${waste.reason}`,
      });

      return ApiHandler.success({
        waste: { ...updated, quantity: Number(updated.quantity) },
      });
    }

    // --- APROBACIÓN: tope mensual + rol superior al excederlo --------------------
    const [company] = await db
      .select({ capCents: companies.courtesyWasteMonthlyCapCents })
      .from(companies)
      .where(eq(companies.id, auth.tenantId))
      .limit(1);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [monthAgg] = await db
      .select({
        approvedCents: sql<string>`coalesce(sum(${inventoryWaste.totalLoss}), 0)`,
      })
      .from(inventoryWaste)
      .where(
        and(
          eq(inventoryWaste.companyId, auth.tenantId),
          eq(inventoryWaste.approvalStatus, "APPROVED"),
          sql`${inventoryWaste.reason} IN ('STAFF', 'COURTESY')`,
          gte(inventoryWaste.recordedAt, monthStart)
        )
      );

    const decision = evaluateApproval({
      role: auth.user.role,
      capCents: company?.capCents ?? null,
      monthApprovedCents: Number(monthAgg?.approvedCents ?? 0),
      thisLossCents: waste.totalLoss,
    });

    if (!decision.allowed) {
      if (decision.errorCode === "CAP_EXCEEDED_ELEVATED_REQUIRED") {
        throw ApiError.forbidden(
          "El tope mensual de cortesías/consumo está excedido: requiere aprobación de ADMIN u Owner",
          { code: decision.errorCode }
        );
      }
      throw ApiError.forbidden("No tienes rol para aprobar mermas", {
        code: decision.errorCode ?? "FORBIDDEN_ROLE",
      });
    }

    // Descuento diferido al momento de aprobar, dentro de una transacción con
    // lock del lote (el stock pudo cambiar desde el registro).
    const updated = await db.transaction(async (tx) => {
      if (waste.batchId) {
        const [batch] = await tx
          .select({
            id: inventoryBatches.id,
            currentQuantity: inventoryBatches.currentQuantity,
            status: inventoryBatches.status,
          })
          .from(inventoryBatches)
          .where(eq(inventoryBatches.id, waste.batchId))
          .for("update")
          .limit(1);

        if (!batch) {
          throw ApiError.notFound("El lote de la merma ya no existe", {
            code: "BATCH_NOT_FOUND",
          });
        }

        const remaining = Number(batch.currentQuantity) - Number(waste.quantity);
        if (remaining < 0) {
          throw ApiError.badRequest(
            `El lote sólo tiene ${batch.currentQuantity} ${waste.unit} disponibles`,
            { code: "OVER_QUANTITY" }
          );
        }

        await tx
          .update(inventoryBatches)
          .set({
            currentQuantity: String(remaining),
            status: Number(remaining.toFixed(4)) === 0 ? "DEPLETED" : batch.status,
            updatedAt: new Date(),
          })
          .where(eq(inventoryBatches.id, batch.id));

        await tx.insert(inventoryMovements).values({
          branchId: waste.branchId,
          itemId: waste.itemId,
          batchId: waste.batchId,
          type: "USAGE",
          quantityChange: String(-Number(waste.quantity)),
          reason: waste.reason === "STAFF" ? "Consumo de Personal" : "Cortesía a Cliente",
          performedBy: auth.user.id,
          timestamp: new Date(),
        });
      }

      const [row] = await tx
        .update(inventoryWaste)
        .set({
          approvalStatus: "APPROVED" satisfies WasteApprovalStatus,
          approvedBy: auth.user.id,
          approvedAt: new Date(),
        })
        .where(eq(inventoryWaste.id, id))
        .returning();

      return row;
    });

    AuditService.logInventoryAction({
      companyId: auth.tenantId,
      branchId: waste.branchId,
      action: "UPDATE",
      entityType: "WASTE",
      entityId: id,
      oldValue: { approvalStatus: "PENDING_APPROVAL" },
      newValue: { approvalStatus: "APPROVED" },
      performedBy: auth.user.id,
      reason: `Waste approved: ${waste.reason}`,
      metadata: { batchId: waste.batchId, totalLoss: waste.totalLoss },
    });

    return ApiHandler.success({
      waste: { ...updated, quantity: Number(updated.quantity) },
    });
  }
);
