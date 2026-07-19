import { requireManagementRole } from "@/lib/rbac/require-role"
import OperationsClient from "./operations-client"

export default async function OperationsPage() {
  await requireManagementRole();
  return <OperationsClient />
}
