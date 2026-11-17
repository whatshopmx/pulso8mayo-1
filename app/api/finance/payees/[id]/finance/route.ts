import { z } from "zod";
import { withRoleAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { resolveBranchScope } from "@/lib/branch-scope";
import { associatePayeeInvoice, getPayeeFinance, getPayeeInvoiceCandidates } from "@/lib/services/payee-finance-service";

const roles = ["SUPER_ADMIN", "ADMIN", "GERENTE", "SUPERVISOR"] as const;
const querySchema = z.object({ branchId: z.uuid().optional(), expenseId: z.uuid().optional(), from: z.iso.date().optional(), to: z.iso.date().optional(),
  destination: z.enum(["UNCLASSIFIED", "INVENTORY_PURCHASE", "OPERATING_EXPENSE"]).optional(), page: z.coerce.number().int().min(0).max(10000).default(0) });

export const GET = withRoleAuth([...roles], async (req, { params, auth }) => {
  try {
    const { id } = await params;
    z.uuid().parse(id);
    const query = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    if (query.from && query.to && query.from > query.to) throw ApiError.badRequest("La fecha inicial debe ser anterior o igual a la final.");
    const scope = resolveBranchScope(auth.user.role, auth.branchId, query.branchId);
    if (scope.kind === "NONE") throw ApiError.forbidden("Tu usuario necesita una sucursal asignada para consultar movimientos.");
    if (query.expenseId) return ApiHandler.success({ candidates: await getPayeeInvoiceCandidates(auth.tenantId, id,
      query.expenseId, scope.kind === "BRANCH" ? scope.branchId : undefined) });
    return ApiHandler.success(await getPayeeFinance(auth.tenantId, id, scope.kind === "BRANCH" ? scope.branchId : undefined, query.page,
      { from: query.from, to: query.to, destination: query.destination }));
  } catch (error) { return ApiHandler.error(error); }
});

export const POST = withRoleAuth([...roles], async (req, { params, auth }) => {
  try {
    const { id } = await params;
    z.uuid().parse(id);
    const body = z.object({ expenseId: z.uuid(), invoiceId: z.uuid() }).strict().parse(await req.json());
    const scope = resolveBranchScope(auth.user.role, auth.branchId);
    if (scope.kind === "NONE") throw ApiError.forbidden("Tu usuario necesita una sucursal asignada para asociar documentos.");
    return ApiHandler.success(await associatePayeeInvoice({ ...body, companyId: auth.tenantId, payeeId: id,
      actorId: auth.user.id, branchId: scope.kind === "BRANCH" ? scope.branchId : undefined }));
  } catch (error) { return ApiHandler.error(error); }
});
