import { z } from "zod";

import { expectedStatusSchema, withExceptionMutation } from "@/lib/api/exception-route";
import { ExceptionService } from "@/lib/services/exception-service";

const schema = z.object({
  ownerId: z.string().min(1, "El responsable es requerido."),
  expectedStatus: expectedStatusSchema,
});

/** POST /api/exceptions/[id]/assign */
export const POST = withExceptionMutation(async ({ req, ctx, exception }) => {
  const { ownerId, expectedStatus } = schema.parse(await req.json().catch(() => ({})));
  return ExceptionService.assign(
    exception.id,
    ctx.userCompanyId,
    ownerId,
    ctx.userId,
    undefined,
    expectedStatus ? { expectedStatus } : undefined,
  );
});
