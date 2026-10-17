import { withExceptionMutation } from "@/lib/api/exception-route";
import { ExceptionService } from "@/lib/services/exception-service";

/** POST /api/exceptions/[id]/start-action */
export const POST = withExceptionMutation(async ({ ctx, exception }) =>
  ExceptionService.startAction(exception.id, ctx.userCompanyId, ctx.userId),
);
