import { redirect } from "next/navigation";

/**
 * Ruta de tendencias analíticas redirigida hacia la Liga de Sucursales.
 */
export default function AnalyticsTrendsRedirect() {
  redirect("/dashboard/branches");
}
