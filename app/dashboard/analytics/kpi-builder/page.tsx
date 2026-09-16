import { redirect } from "next/navigation";

/**
 * Ruta de KPI Builder redirigida hacia la Liga de Sucursales.
 */
export default function AnalyticsKpiBuilderRedirect() {
  redirect("/dashboard/branches");
}
