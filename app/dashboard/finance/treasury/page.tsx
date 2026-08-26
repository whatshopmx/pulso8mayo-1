import { Metadata } from "next";
import { TreasuryDashboard } from "@/components/finance/treasury-dashboard";
import { Wallet } from "lucide-react";

export const metadata: Metadata = {
  title: "Tesorería - Egresos",
  description: "Control de pagos, contratos recurrentes y flujos de efectivo",
};

export default function TreasuryPage() {
  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Wallet className="h-7 w-7 text-primary" /> Tesorería
          </h1>
          <p className="text-sm text-muted-foreground">
            Administración centralizada de pagos y contratos operativos recurrentes.
          </p>
        </div>
      </div>
      <TreasuryDashboard />
    </div>
  );
}
