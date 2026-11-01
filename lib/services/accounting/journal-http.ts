import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { ApiError, isApiError } from "@/lib/api/error";
import { requirePermissionApi } from "@/lib/rbac/abac";
import type { NextRequest } from "next/server";
import type { AccountingContext } from "./journal-service";

export const journalQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["DRAFT", "POSTED"]).optional(), branchId: z.uuid().optional(),
}).strict();

export async function journalPrincipal(req: NextRequest, action: "read" | "create" | "update" | "publish" | "reverse"): Promise<AccountingContext> {
  const { ctx } = await requirePermissionApi("accounting",action,{
    classification:"FINANCIAL",audit:{action:action==="read"?"READ":action==="publish"?"APPROVE":"UPDATE",req},
  });
  if(process.env.ACCOUNTING_REVIEW_ENABLED!=="1") {
    throw new ApiError("La revisión contable aún no está habilitada. Puedes seguir consultando los resultados operativos.",503);
  }
  return { companyId:ctx.userCompanyId, actorId:ctx.userId, role:ctx.userRole };
}
export async function journalJson(req: NextRequest) {
  const origin=req.headers.get("origin");
  if(origin&&origin!==req.nextUrl.origin)throw ApiError.forbidden("La solicitud debe realizarse desde Pulso.");
  if(req.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json") {
    throw ApiError.badRequest("Envía la póliza como application/json.");
  }
  try { return await req.json(); }
  catch { throw ApiError.badRequest("Envía un documento JSON válido."); }
}
export function journalResponse(data: unknown, status=200) {
  return NextResponse.json({success:true,data},{status,headers:{"Cache-Control":"private, no-store"}});
}
export function journalError(error: unknown) {
  const known = isApiError(error), invalid = error instanceof ZodError;
  return NextResponse.json({success:false,error:{message:known?error.message:invalid?"Revisa los datos de la póliza.":"No se pudo procesar la solicitud contable."}},
    {status:known?error.statusCode:invalid?400:500,headers:{"Cache-Control":"private, no-store"}});
}
