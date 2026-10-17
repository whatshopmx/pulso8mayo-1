import { z } from "zod";

import { withExceptionMutation } from "@/lib/api/exception-route";
import { ExceptionService } from "@/lib/services/exception-service";

const schema = z.object({ resolution: z.string().min(1, "La resolución es requerida.") });

/** POST /api/exceptions/[id]/resolve */
export const POST = withExceptionMutation(async ({ req, ctx, exception }) => {
  const { resolution } = schema.parse(await req.json().catch(() => ({})));
  return ExceptionService.resolve(
    exception.id,
    ctx.userCompanyId,
    ctx.userId,
    resolution,
  );
});
