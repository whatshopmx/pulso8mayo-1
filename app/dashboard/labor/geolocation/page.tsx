import { requireManagementRole } from "@/lib/rbac/require-role"
import GeolocationClient from "./geolocation-client"

export default async function GeolocationPage() {
  await requireManagementRole();
  return <GeolocationClient />
}
