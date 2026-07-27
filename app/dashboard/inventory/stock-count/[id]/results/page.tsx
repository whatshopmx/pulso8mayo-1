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
            <div className="text-2xl font-bold flex items-center gap-2">
              <CheckCircle2 className={`h-5 w-5 ${result.adjustmentsStatus === "PENDING" ? "text-amber-500" : "text-green-500"}`} />
              {result.summary.totalAdjustments}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Alertas (&gt;10%)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold flex items-center gap-2 ${result.summary.alertCount > 0 ? 'text-red-600' : 'text-green-600'}`}>
              <AlertTriangle className="h-5 w-5" />
              {result.summary.alertCount}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Detalle de Varianzas</CardTitle>
          <CardDescription>
            Comparación entre stock en sistema y conteo físico
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 font-medium">Producto</th>
                  <th className="text-left p-3 font-medium">SKU</th>
                  <th className="text-right p-3 font-medium">Sistema</th>
                  <th className="text-right p-3 font-medium">Físico</th>
                  <th className="text-right p-3 font-medium">Diferencia</th>
                  <th className="text-right p-3 font-medium">% Varianza</th>
                  <th className="text-center p-3 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {result.results.map(row => (
                  <tr key={row.itemId} className={`border-t ${row.isAlert ? 'bg-red-50 dark:bg-red-950/20' : ''}`}>
                    <td className="p-3 font-medium">{row.itemName}</td>
                    <td className="p-3 text-muted-foreground">{row.sku}</td>
                    <td className="text-right p-3">{row.systemQuantity} {row.unit}</td>
                    <td className="text-right p-3">{row.physicalQuantity} {row.unit}</td>
                    <td className={`text-right p-3 font-medium ${row.variance > 0 ? 'text-green-600' : row.variance < 0 ? 'text-red-600' : ''}`}>
                      {row.variance > 0 ? '+' : ''}{row.variance} {row.unit}
                    </td>
                    <td className="text-right p-3">{row.variancePercent}%</td>
                    <td className="text-center p-3">
                      {row.isAlert ? (
                        <Badge variant="destructive" className="gap-1">
                          <AlertTriangle className="h-3 w-3" /> Alerta
                        </Badge>
                      ) : row.variance === 0 ? (
                        <Badge variant="default" className="bg-green-100 text-green-700 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400">
                          OK
                        </Badge>
                      ) : (
                        <Badge variant="secondary">
                          OK
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
