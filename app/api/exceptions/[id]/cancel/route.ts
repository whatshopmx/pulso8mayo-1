import { z } from "zod";

import { withExceptionMutation } from "@/lib/api/exception-route";
import { ExceptionService } from "@/lib/services/exception-service";

const schema = z.object({ reason: z.string().optional().nullable() });

/** POST /api/exceptions/[id]/cancel */
export const POST = withExceptionMutation(async ({ req, ctx, exception }) => {
  const { reason } = schema.parse(await req.json().catch(() => ({})));
  return ExceptionService.cancel(
    exception.id,
    ctx.userCompanyId,
    ctx.userId,
    reason ?? undefined,
  );
});
