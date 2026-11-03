import type { NextRequest } from "next/server";
import { z } from "zod";
import { journalError, journalJson, journalPrincipal, journalResponse } from "@/lib/services/accounting/journal-http";
import { createRule, getRule, listRules, previewRule } from "@/lib/services/accounting/mapping-service";

/** FC-08 — recognition rules and their effective-date preview. Private, no-store. */
const query = (req: NextRequest) => Object.fromEntries([...req.nextUrl.searchParams].filter(([key]) => key !== "view"));
const rulePageSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  eventType: z.string().trim().min(1).max(40).optional(),
}).strict();

export async function GET(req: NextRequest) {
  try {
    const ctx = await journalPrincipal(req, "read");
    const view = z.enum(["rules", "preview", "rule"]).parse(req.nextUrl.searchParams.get("view") ?? "rules");
    if (view === "preview") {
      const input = z.object({ eventType: z.string().trim().min(1).max(40), date: z.iso.date() }).strict().parse(query(req));
      return journalResponse(await previewRule(ctx, input));
    }
    if (view === "rule") {
      const { id } = z.object({ id: z.uuid() }).strict().parse(query(req));
      return journalResponse(await getRule(ctx, id));
    }
    return journalResponse(await listRules(ctx, rulePageSchema.parse(query(req))));
  } catch (error) { return journalError(error); }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await journalPrincipal(req, "update");
    return journalResponse(await createRule(ctx, await journalJson(req)), 201);
  } catch (error) { return journalError(error); }
}
