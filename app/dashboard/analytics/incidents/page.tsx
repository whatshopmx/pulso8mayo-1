import { redirect } from "next/navigation";

/**
 * Ruta de incidentes analíticos redirigida hacia el Centro de Excepciones & Riesgos QSR.
 */
export default function AnalyticsIncidentsRedirect() {
  redirect("/dashboard/exceptions");
}
