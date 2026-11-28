import { z } from "zod";

import { expectedStatusSchema, withExceptionMutation } from "@/lib/api/exception-route";
import { ExceptionService } from "@/lib/services/exception-service";

const schema = z.object({
  reason: z.string().optional().nullable(),
  expectedStatus: expectedStatusSchema,
});

/** POST /api/exceptions/[id]/escalate */
export const POST = withExceptionMutation(async ({ req, ctx, exception }) => {
  const { reason, expectedStatus } = schema.parse(await req.json().catch(() => ({})));
  return ExceptionService.escalate(
    exception.id,
    ctx.userCompanyId,
    ctx.userId,
    reason ?? undefined,
    undefined,
    expectedStatus ? { expectedStatus } : undefined,
  );
});
