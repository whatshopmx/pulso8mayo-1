import { z } from "zod";

import { expectedStatusSchema, withExceptionMutation } from "@/lib/api/exception-route";
import { ExceptionService } from "@/lib/services/exception-service";

const schema = z.object({ expectedStatus: expectedStatusSchema });

/** POST /api/exceptions/[id]/verify — segregación de funciones en el servicio. */
export const POST = withExceptionMutation(async ({ req, ctx, exception }) => {
  const { expectedStatus } = schema.parse(await req.json().catch(() => ({})));
  return ExceptionService.verify(
    exception.id,
    ctx.userCompanyId,
    ctx.userId,
    undefined,
    expectedStatus ? { expectedStatus } : undefined,
  );
});
