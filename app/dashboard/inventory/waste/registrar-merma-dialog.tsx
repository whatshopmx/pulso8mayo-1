"use client";

// Botón + Dialog para registrar una merma sin salir del historial
// (plan-mermas-historial Task 3). El formulario NO se reescribe: es el mismo
// `WasteForm` de siempre dentro de un dialog, para no romper el flujo de
// captura que ya opera el personal en tablet.
//
// Al registrar con éxito invalida el cache del historial
// (["inventory", "waste-history"]) — la tabla se refresca sola, sin
// coordinación con el padre ni remounts.

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WasteForm } from "@/components/inventory/waste-form";
import { Plus } from "lucide-react";

export function RegistrarMermaDialog({
  branchId,
  preselectedItemId,
}: {
  branchId: string;
  preselectedItemId?: string;
}) {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  // Deep-links: /waste?item=X (desde la ficha del producto) o ?registrar=1
  // (CTA del historial). El dialog abre SOLO mientras el deep-link siga en la
  // URL y el usuario no lo haya cerrado: después manda el estado manual.
  const [userOpen, setUserOpen] = useState(false);
  const [deepLinkDismissed, setDeepLinkDismissed] = useState(false);
  const wantsDeepLink =
    Boolean(preselectedItemId) || searchParams.get("registrar") === "1";
  const open = (wantsDeepLink && !deepLinkDismissed) || userOpen;

  const handleOpenChange = (o: boolean) => {
    setUserOpen(o);
    if (!o) setDeepLinkDismissed(true); // cerrar un deep-link no lo debe reabrir
  };

  const handleSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ["inventory", "waste-history"] });
    handleOpenChange(false);
  };

  return (
    <>
      <Button size="sm" onClick={() => handleOpenChange(true)}>
        <Plus className="h-4 w-4 mr-2" />
        Registrar Merma
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Registrar Nueva Merma</DialogTitle>
            <DialogDescription>
              Completa los datos del producto que se dará de baja por merma
            </DialogDescription>
          </DialogHeader>
          <WasteForm
            branchId={branchId}
            preselectedItemId={preselectedItemId}
            onSuccess={handleSuccess}
            onCancel={() => handleOpenChange(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
