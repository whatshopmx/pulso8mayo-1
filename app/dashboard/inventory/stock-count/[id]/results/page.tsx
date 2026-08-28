import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { StockCountService } from "@/lib/services/stock-count-service";
import { db } from "@/lib/db";
import { branches } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, AlertTriangle, CheckCircle2, Package, ClipboardList } from "lucide-react";
import Link from "next/link";
import { ApproveAdjustments } from "./approve-adjustments";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function StockCountResultsPage({ params }: PageProps) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/sign-in");

  const { id } = await params;

  let result;
  try {
    result = await StockCountService.getStockCountResults(id);
  } catch {
    return (
      <div className="container mx-auto py-8 max-w-4xl">
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Conteo no encontrado
          </CardContent>
        </Card>
      </div>
    );
  }

  const branchRows = await db.select({ id: branches.id, name: branches.name })
    .from(branches)
    .where(eq(branches.id, result.branchId))
    .limit(1);
  const branchName = branchRows[0]?.name || result.branchId;

  const formatDate = (date: Date | null | undefined) => {
    if (!date) return "En progreso";
    return new Date(date).toLocaleDateString("es-MX", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const categoryLabel = StockCountService.getCategoryName(result.category);

  return (
    <div className="container mx-auto py-8 max-w-4xl space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/dashboard/inventory/stock-count">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Volver
          </Button>
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ClipboardList className="h-6 w-6" />
          Revisión del Conteo
        </h1>
        <p className="text-muted-foreground mt-1">
          {branchName} • {formatDate(result.completedAt)}
        </p>
      </div>

      <ApproveAdjustments
        instanceId={result.instanceId}
        adjustmentsStatus={result.adjustmentsStatus as "PENDING" | "APPLIED" | "NONE"}
        totalAdjustments={result.summary.totalAdjustments}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Productos</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-2">
              <Package className="h-5 w-5 text-muted-foreground" />
              {result.summary.totalProducts}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>
              {result.adjustmentsStatus === "PENDING" ? "Ajustes Pendientes" : "Ajustes Aplicados"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono flex items-center gap-2">
              <CheckCircle2 className={`h-5 w-5 ${result.adjustmentsStatus === "PENDING" ? "text-warning" : "text-success"}`} />
              {result.summary.totalAdjustments}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Alertas (&gt;10%)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold font-mono flex items-center gap-2 ${result.summary.alertCount > 0 ? 'text-destructive' : 'text-success'}`}>
              <AlertTriangle className="h-5 w-5" />
              {result.summary.alertCount}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Detalle de Varianzas</CardTitle>
          <CardDescription className="text-xs">
            Comparación entre stock en sistema y conteo físico
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left p-3 font-semibold text-foreground">Producto</th>
                  <th className="text-left p-3 font-semibold text-foreground">SKU</th>
                  <th className="text-right p-3 font-semibold text-foreground">Sistema</th>
                  <th className="text-right p-3 font-semibold text-foreground">Físico</th>
                  <th className="text-right p-3 font-semibold text-foreground">Diferencia</th>
                  <th className="text-right p-3 font-semibold text-foreground">% Varianza</th>
                  <th className="text-center p-3 font-semibold text-foreground">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {result.results.map(row => (
                  <tr key={row.itemId} className={row.isAlert ? 'bg-destructive/10' : 'hover:bg-muted/20'}>
                    <td className="p-3 font-medium text-foreground">{row.itemName}</td>
                    <td className="p-3 font-mono text-muted-foreground">{row.sku}</td>
                    <td className="text-right p-3 font-mono">{row.systemQuantity} {row.unit}</td>
                    <td className="text-right p-3 font-mono">{row.physicalQuantity} {row.unit}</td>
                    <td className={`text-right p-3 font-mono font-semibold ${row.variance > 0 ? 'text-success' : row.variance < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {row.variance > 0 ? '+' : ''}{row.variance} {row.unit}
                    </td>
                    <td className="text-right p-3 font-mono">{row.variancePercent}%</td>
                    <td className="text-center p-3">
                      {row.isAlert ? (
                        <Badge variant="destructive" className="gap-1 text-xs">
                          <AlertTriangle className="h-3 w-3" /> Alerta
                        </Badge>
                      ) : row.variance === 0 ? (
                        <Badge variant="success" className="text-xs">
                          OK
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">
                          Ajuste
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-center">
        <Link href="/dashboard/inventory">
          <Button variant="outline" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Volver al Inventario
          </Button>
        </Link>
      </div>
    </div>
  );
}
