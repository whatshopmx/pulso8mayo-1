import { Metadata } from "next";
import { PaymentRunDetail } from "@/components/finance/payment-run-detail";

export const metadata: Metadata = {
  title: "Detalle de Corrida de Pago | Pulso HORECA",
  description: "Revisar y gestionar la corrida de pago",
};

export default function PaymentRunPage({ params }: { params: { id: string } }) {
  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Detalle de Corrida de Pago</h1>
          <p className="text-sm text-muted-foreground">
            Administra las facturas y el estado de la corrida.
          </p>
        </div>
      </div>
      <div className="grid gap-8">
        <PaymentRunDetail runId={params.id} />
      </div>
    </div>
  );
}
