import Link from "next/link";
import { ArrowLeft, Scale } from "lucide-react";
import { AccountingStatements } from "@/components/finance/accounting-statements";
import { Button } from "@/components/ui/button";

export default function AccountingStatementsPage() {
  return (
    <div className="container mx-auto space-y-6 py-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Scale className="h-6 w-6 text-primary" />
            Balanza y Estados Contables
          </h1>
          <p className="text-sm text-muted-foreground">
            Balanza de comprobación, estado de resultados, balance general y auxiliar de mayor con trazabilidad a pólizas publicadas.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/finance/results">
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            Resultados operativos
          </Link>
        </Button>
      </div>

      <AccountingStatements />
    </div>
  );
}
