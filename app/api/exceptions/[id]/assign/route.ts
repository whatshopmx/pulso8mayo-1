import { z } from "zod";

import { withExceptionMutation } from "@/lib/api/exception-route";
import { ExceptionService } from "@/lib/services/exception-service";

const schema = z.object({ ownerId: z.string().min(1, "El responsable es requerido.") });

/** POST /api/exceptions/[id]/assign */
export const POST = withExceptionMutation(async ({ req, ctx, exception }) => {
  const { ownerId } = schema.parse(await req.json().catch(() => ({})));
  return ExceptionService.assign(exception.id, ctx.userCompanyId, ownerId, ctx.userId);
});
