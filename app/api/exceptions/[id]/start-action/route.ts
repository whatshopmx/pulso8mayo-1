import { z } from "zod";

import { expectedStatusSchema, withExceptionMutation } from "@/lib/api/exception-route";
import { ExceptionService } from "@/lib/services/exception-service";

const schema = z.object({ expectedStatus: expectedStatusSchema });

/** POST /api/exceptions/[id]/start-action */
export const POST = withExceptionMutation(async ({ req, ctx, exception }) => {
  const { expectedStatus } = schema.parse(await req.json().catch(() => ({})));
  return ExceptionService.startAction(
    exception.id,
    ctx.userCompanyId,
    ctx.userId,
    undefined,
    expectedStatus ? { expectedStatus } : undefined,
  );
});
