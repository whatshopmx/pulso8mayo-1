import { redirect } from "next/navigation";

/**
 * Ruta de analítica consolidada y redirigida hacia la Liga de Sucursales.
 */
export default function AnalyticsRedirect() {
  redirect("/dashboard/branches");
}
