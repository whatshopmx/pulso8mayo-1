import { NextRequest } from "next/server";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { db } from "@/lib/db";
import { branches, incidents, users } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { complianceReportService } from "@/lib/services/ComplianceReportService";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth();
    const tenant = await requireTenant();

    if (!tenant.id) {
      return ApiHandler.error(new Error("Unauthorized: Company ID required"), 401);
    }

    // Role check: Only ADMIN and SUPERVISOR roles can view corporate status
    if (user.role !== "ADMIN" && user.role !== "SUPERVISOR") {
      return ApiHandler.error(new Error("Forbidden: Insufficient permissions"), 403);
    }

    const { searchParams } = new URL(request.url);
    const startDateParam = searchParams.get("startDate");
    const endDateParam = searchParams.get("endDate");

    const endDate = endDateParam ? new Date(endDateParam) : new Date();
    const startDate = startDateParam 
      ? new Date(startDateParam) 
      : new Date(new Date().setDate(endDate.getDate() - 30));

    // Get all branches in the company
    const branchList = await db.query.branches.findMany({
      where: eq(branches.companyId, tenant.id),
      orderBy: branches.name,
    });

    const corporateStatus = await Promise.all(
      branchList.map(async (branch) => {
        try {
          // Get NOM-251 report stats for this branch
          const report = await complianceReportService.generateNOM251Report({
            startDate,
            endDate,
            branchId: branch.id,
            companyId: tenant.id,
          });

          // Fetch incident details for this branch in the date range
          const branchIncidents = await db.query.incidents.findMany({
            where: eq(incidents.branchId, branch.id),
          });

          const totalIncidents = branchIncidents.length;
          const openIncidents = branchIncidents.filter(
            (i) => i.status === "DETECTED" || i.status === "IN_REMEDIATION" || i.status === "ESCALATED"
          ).length;
          const criticalIncidents = branchIncidents.filter(
            (i) => i.severity === "CRITICAL" && (i.status === "DETECTED" || i.status === "ESCALATED")
          ).length;

          // Fetch manager details if assigned
          let managerName = "Sin asignar";
          if (branch.managerId) {
            const manager = await db.query.users.findFirst({
              where: eq(users.id, branch.managerId),
              columns: { name: true, email: true },
            });
            managerName = manager?.name || manager?.email || "Sin asignar";
          }

          return {
            branchId: branch.id,
            branchName: branch.name,
            managerName,
            active: branch.active,
            complianceRate: report.summary.complianceRate,
            totalInspections: report.summary.totalInspections,
            completedInspections: report.summary.completedInspections,
            incidents: {
              total: totalIncidents,
              open: openIncidents,
              critical: criticalIncidents,
            },
          };
        } catch (error) {
          console.error(`Error processing corporate status for branch ${branch.name}:`, error);
          return {
            branchId: branch.id,
            branchName: branch.name,
            managerName: "Error",
            active: branch.active,
            complianceRate: 0,
            totalInspections: 0,
            completedInspections: 0,
            incidents: { total: 0, open: 0, critical: 0 },
            error: true,
          };
        }
      })
    );

    return ApiHandler.success({
      period: {
        startDate,
        endDate,
      },
      branches: corporateStatus,
    });
  } catch (error) {
    console.error("Error generating corporate status report:", error);
    return ApiHandler.error(error);
  }
}
