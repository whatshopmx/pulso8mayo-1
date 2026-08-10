import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle } from "lucide-react";

/**
 * Veredicto de revisión, compartido por historial y (futuro) dashboard.
 * Ramifica sobre `reviewStatus` — el veredicto — nunca sobre `status`,
 * que describe el ciclo de vida de la ejecución.
 */
export function ReviewStatusBadge({ status }: { status: "APPROVED" | "REJECTED" }) {
  if (status === "APPROVED") {
    return (
      <Badge variant="success">
        <CheckCircle2 className="h-3 w-3" />
        Aprobado
      </Badge>
    );
  }
  return (
    <Badge variant="destructive">
      <XCircle className="h-3 w-3" />
      Rechazado
    </Badge>
  );
}