import { withExceptionMutation } from "@/lib/api/exception-route";
import { ExceptionService } from "@/lib/services/exception-service";

/** POST /api/exceptions/[id]/close */
export const POST = withExceptionMutation(async ({ ctx, exception }) =>
  ExceptionService.close(exception.id, ctx.userCompanyId, ctx.userId),
);
