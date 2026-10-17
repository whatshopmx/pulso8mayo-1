import { z } from "zod";

import { withExceptionMutation } from "@/lib/api/exception-route";
import { ExceptionService } from "@/lib/services/exception-service";

const schema = z.object({ reason: z.string().min(1, "El motivo es requerido.") });

/** POST /api/exceptions/[id]/reopen */
export const POST = withExceptionMutation(async ({ req, ctx, exception }) => {
  const { reason } = schema.parse(await req.json().catch(() => ({})));
  return ExceptionService.reopen(exception.id, ctx.userCompanyId, ctx.userId, reason);
});
