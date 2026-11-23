"use client";

import { VacationManager } from "@/components/labor/vacation-manager"
import { useRequireRole } from "@/hooks/use-session"

export default function VacationsPage() {
  const { loading, session, hasAccess } = useRequireRole(['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'EMPLEADO'])

  if (loading || !hasAccess) {
    return null
  }

  const userId = session?.user?.id
  const companyId = session?.user?.companyId
  const userRole = session?.user?.role

  if (!userId || !companyId) {
    return null
  }

  const canApprove = ["OWNER", "ADMIN", "GERENTE", "SUPER_ADMIN"].includes(userRole || "")

  return (
    <div className="space-y-6">
      <VacationManager
        companyId={companyId}
        branchId={session?.user?.branchId}
        userId={userId}
        canApprove={canApprove}
      />
    </div>
  )
}
