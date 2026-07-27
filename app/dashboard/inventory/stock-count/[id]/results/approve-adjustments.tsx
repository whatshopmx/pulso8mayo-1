"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface ApproveAdjustmentsProps {
  instanceId: string;
  adjustmentsStatus: "PENDING" | "APPLIED" | "NONE";
  totalAdjustments: number;
}

export function ApproveAdjustments({
  instanceId,
  adjustmentsStatus,
  totalAdjustments,
}: ApproveAdjustmentsProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  if (adjustmentsStatus === "NONE" || totalAdjustments === 0) {
    return (
      <Card className="border-green-200 bg-green-50 dark:border-green-900/50 dark:bg-green-950/20">
        <CardContent className="py-4 flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
          <p className="text-sm text-green-900 dark:text-green-200">
            El conteo no generó diferencias. No hay ajustes por aplicar.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (adjustmentsStatus === "APPLIED") {
    return (
      <Card className="border-green-200 bg-green-50 dark:border-green-900/50 dark:bg-green-950/20">
        <CardContent className="py-4 flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
          <p className="text-sm text-green-900 dark:text-green-200">
            Los {totalAdjustments} ajustes de este conteo ya fueron aplicados al inventario.
          </p>
        </CardContent>
      </Card>
    );
  }

  async function handleApprove() {
    try {
      setSubmitting(true);
      const res = await fetch(`/api/inventory/stock-count/${instanceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "applyAdjustments" }),
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || "Error al aplicar ajustes");
      }

      toast.success("Ajustes aplicados", {
        description: `Se aplicaron ${totalAdjustments} ajustes al inventario.`,
        action: {
          label: "Ver movimientos",
          onClick: () => router.push("/dashboard/inventory/movements"),
        },
      });
      router.refresh();
    } catch (error) {
      console.error("Error applying adjustments:", error);
      toast.error("No se aplicaron los ajustes", {
        description:
          "Revisa tu conexión e intenta de nuevo. El inventario no fue modificado.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-amber-300 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20">
      <CardContent className="py-4 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-start gap-3 flex-1">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900 dark:text-amber-200">
            <p className="font-medium">
              {totalAdjustments} {totalAdjustments === 1 ? "ajuste pendiente" : "ajustes pendientes"} de aprobación
            </p>
            <p className="mt-1">
              El inventario todavía no se modifica. Revisa las varianzas abajo y aprueba
              para actualizar el stock del sistema.
            </p>
          </div>
        </div>
        <Button
          onClick={handleApprove}
          disabled={submitting}
          className="shrink-0 min-h-[44px]"
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Aplicando...
            </>
          ) : (
            `Aprobar y aplicar ${totalAdjustments} ${totalAdjustments === 1 ? "ajuste" : "ajustes"}`
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
