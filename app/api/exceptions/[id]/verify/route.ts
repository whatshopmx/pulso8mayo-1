import { withExceptionMutation } from "@/lib/api/exception-route";
import { ExceptionService } from "@/lib/services/exception-service";

/** POST /api/exceptions/[id]/verify — segregación de funciones en el servicio. */
export const POST = withExceptionMutation(async ({ ctx, exception }) =>
  ExceptionService.verify(exception.id, ctx.userCompanyId, ctx.userId),
);
