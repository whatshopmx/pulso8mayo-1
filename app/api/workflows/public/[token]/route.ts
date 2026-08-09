
import { NextRequest, NextResponse } from "next/server";
import { SmartLinkService } from "@/lib/services/smart-link-service";
import { WorkflowExecutionService } from "@/lib/services/workflow-execution-service";
import { db } from "@/lib/db";
import { users, workflowAssignments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ token: string }> } // Correct type for Next.js 15+ dynamic params
) {
  try {
    const { token } = await context.params;

    if (!token) {
      return new NextResponse("Token required", { status: 400 });
    }

    const linkData = await SmartLinkService.validateSmartLink(token);

    if (!linkData) {
      return new NextResponse("Invalid or expired token", { status: 404 });
    }

    // Role-based access validation
    const { decoded } = linkData;

    // Get current user from session (if authenticated)
    const headersList = await headers();
    const sessionToken = headersList.get("authorization")?.replace("Bearer ", "");
    let currentUser = null;

    if (sessionToken) {
      // In a real implementation, verify the session token
      // For now, we'll check if there's a user session
      // This would typically use your auth library
    }

    // Check if workflow requires specific role
    if (decoded.requiredRole) {
      // If user is not authenticated or doesn't have required role
      if (!currentUser) {
        return new NextResponse(
          JSON.stringify({
            error: "Authentication required",
            message: "This workflow requires specific permissions. Please log in.",
            requiredRole: decoded.requiredRole,
          }),
          {
            status: 403,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Check user role (would need actual user data)
      // const hasRequiredRole = await checkUserRole(currentUser.id, decoded.requiredRole);
      // if (!hasRequiredRole) {
      //   return new NextResponse("Forbidden: Insufficient permissions", { status: 403 });
      // }
    }

    // Check if workflow is assigned to specific user
    if (decoded.assignedTo) {
      const assignment = await db.query.workflowAssignments.findFirst({
        where: eq(workflowAssignments.instanceId, linkData.instance.id),
      });

      if (assignment && assignment.assignedTo !== decoded.assignedTo) {
        return new NextResponse(
          JSON.stringify({
            error: "Access denied",
            message: "This workflow is assigned to another user.",
          }),
          {
            status: 403,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
    }

    const execution = await WorkflowExecutionService.getExecution(linkData.instance.id);

    if (!execution) {
      return new NextResponse("Execution not found", { status: 404 });
    }

    // Plan 5.5: registrar la apertura (usedAt = primera vez, no se toca status:
    // el enlace no es de un solo uso). Idempotente por coalesce; ambos puntos de
    // entrada (la página y esta API) pueden registrar y el primero gana. Va
    // después de los checks de acceso: un intento denegado (403) no es apertura.
    try {
      await SmartLinkService.recordOpen(token);
    } catch (error) {
      console.error("Error recording smart link open:", error);
    }

    return NextResponse.json({
      execution,
      link: {
        expiresAt: linkData.link.expiresAt,
        sessionId: linkData.link.sessionId,
        requiredRole: decoded.requiredRole,
        assignedTo: decoded.assignedTo,
      }
    });

  } catch (error) {
    console.error("Error fetching public workflow:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
