"use client";

import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Table, Eye, Download } from "lucide-react";
import { PnlBranchTable } from "@/components/finance/pnl-branch-table";

interface PnlAuditDrawerProps {
  buttonText?: string;
  className?: string;
}

export function PnlAuditDrawer({
  buttonText = "Ver P&L Detallado por Sucursal",
  className,
}: PnlAuditDrawerProps) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className={className}>
          <Eye className="mr-1.5 h-3.5 w-3.5 text-primary" />
          {buttonText}
        </Button>
      </SheetTrigger>

      <SheetContent
        side="right"
        className="w-full sm:max-w-4xl lg:max-w-5xl overflow-y-auto p-4 sm:p-6"
      >
        <SheetHeader className="pb-4 border-b border-border">
          <SheetTitle className="text-lg font-bold flex items-center gap-2">
            <Table className="h-5 w-5 text-primary" />
            P&L Operativo Multi-Unidad (Auditoría Detallada)
          </SheetTitle>
          <SheetDescription>
            Desglose completo de ingresos, costo de alimentos, nómina, comisiones y EBITDA por cada tienda del grupo
          </SheetDescription>
        </SheetHeader>

        <div className="py-4">
          <PnlBranchTable />
        </div>
      </SheetContent>
    </Sheet>
  );
}
