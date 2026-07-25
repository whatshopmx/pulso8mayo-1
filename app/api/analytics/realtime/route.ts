import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { workflowInstances, incidents } from "@/lib/db/schema";
import { eq, sql, and, inArray } from "drizzle-orm";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id || !session?.user?.companyId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const companyId = session.user.companyId;
  const searchParams = req.nextUrl.searchParams;
  const branchId = searchParams.get("branchId");

  const encoder = new TextEncoder();
  let isConnected = true;

  const stream = new ReadableStream({
    start(controller) {
      const sendEvent = (event: string, data: any) => {
        if (!isConnected) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {}
      };

      const poll = async () => {
        try {
          const conditions = [];
          if (branchId && branchId !== "all") {
            conditions.push(eq(workflowInstances.branchId, branchId));
          }

          const activeWorkflows = await db
            .select({ count: sql<number>`cast(count(*) as integer)` })
            .from(workflowInstances)
            .where(and(sql`${workflowInstances.status} IN ('IN_PROGRESS', 'PENDING')`, ...conditions));

          const openIncidents = await db
            .select({ count: sql<number>`cast(count(*) as integer)` })
            .from(incidents)
            .where(and(sql`${incidents.status} != 'RESOLVED'`, ...conditions));

          sendEvent("metrics", {
            activeWorkflows: Number(activeWorkflows[0]?.count || 0),
            openIncidents: Number(openIncidents[0]?.count || 0),
            timestamp: new Date().toISOString(),
          });
        } catch {}
      };

      sendEvent("connected", { message: "Connected to real-time analytics" });

      poll();
      const interval = setInterval(poll, 30000);

      req.signal.addEventListener("abort", () => {
        isConnected = false;
        clearInterval(interval);
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
