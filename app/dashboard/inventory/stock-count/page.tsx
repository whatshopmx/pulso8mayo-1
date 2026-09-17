import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { headers, cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { StockCountService } from "@/lib/services/stock-count-service";
import { CATEGORIES } from "@/lib/inventory/constants";
import { db } from "@/lib/db";
import { branches, companies, inventoryItems } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ClipboardList, History, Settings, AlertCircle } from "lucide-react";
import Link from "next/link";
import { PageHeader, PageContainer } from "@/components/shared";
import { BRANCH_COOKIE_NAME } from "@/lib/branch-cookies";

async function toggleBlindCountSetting(formData: FormData) {
  "use server";
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.companyId) return;

  const value = formData.get("blindCount") === "true";
  await db.update(companies)
    .set({ blindStockCount: value })
    .where(eq(companies.id, session.user.companyId));
  revalidatePath("/dashboard/inventory/stock-count");
}

async function createStockCount(formData: FormData) {
  "use server";
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return redirect("/sign-in");
  if (!session.user.companyId) {
    return redirect("/dashboard/inventory/stock-count?error=missing-company");
  }

  const branchId = formData.get("branchId") as string;
  const category = formData.get("category") as string;
  if (!branchId || !category) {
    return redirect("/dashboard/inventory/stock-count?error=missing-fields");
  }

  const highOnlyValue = formData.get("highValueOnly") === "true";

  // `redirect()` funciona lanzando NEXT_REDIRECT: si se llama dentro del try,
  // el propio catch se lo traga y el conteo recién creado termina en la
  // pantalla de error. Por eso aquí solo se resuelve el destino.
  let destino: string;
  try {
    const result = await StockCountService.createStockCountInstance({
      companyId: session.user.companyId,
      branchId,
      assigneeId: session.user.id,
      categoryValue: category,
      highOnlyValue,
    });
    destino = result.instance?.id
      ? `/dashboard/workflows/${result.instance.id}/execute`
      : "/dashboard/inventory/stock-count?error=create-failed";
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    // El service reporta el conteo ya activo como "... ID: <uuid>".
    const match = message.match(/ID:\s*([a-f0-9-]+)/i);
    if (match) {
      destino = `/dashboard/workflows/${match[1]}/execute`;
    } else if (message.includes("NO_PRODUCTS_FOUND") || message.includes("No products found")) {
      const params = new URLSearchParams({
        error: "no-products",
        category,
        highOnlyValue: highOnlyValue ? "true" : "false",
      });
      destino = `/dashboard/inventory/stock-count?${params.toString()}`;
    } else if (message.includes("Ya existe un conteo activo")) {
      destino = "/dashboard/inventory/stock-count?error=active-count";
    } else {
      console.error("Stock count error:", error);
      destino = `/dashboard/inventory/stock-count?error=create-failed&msg=${encodeURIComponent(message.slice(0, 100))}`;
    }
  }

  redirect(destino);
}

export default async function StockCountPage(props: {
  searchParams?: Promise<{
    error?: string;
    category?: string;
    highOnlyValue?: string;
    msg?: string;
  }>;
}) {
    const searchParams = await props.searchParams;
    const errorType = searchParams?.error;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) redirect("/sign-in");

    const companyId = session.user.companyId || "";

    const userBranches = await db.select().from(branches)
        .where(eq(branches.companyId, companyId));

    // Alcance del header (BranchScopeControl): si hay sucursal en foco, el
    // conteo hereda ese alcance en lugar de volver a preguntar — una sola
    // fuente de verdad para "en qué sucursal estoy".
    const cookieStore = await cookies();
    const scopedBranchId = cookieStore.get(BRANCH_COOKIE_NAME)?.value || "";
    // Validar contra las sucursales del tenant: una cookie huérfana no puede
    // crear conteos fantasma.
    const scopedBranch = userBranches.find((b) => b.id === scopedBranchId) ?? null;

    const history = await StockCountService.getStockCountHistory(companyId);

    // Consultar categorías reales presentes en el inventario con sus conteos
    const dbCategoryCounts = await db
        .select({
            category: inventoryItems.category,
            totalCount: sql<number>`count(*)::int`,
            highValueCount: sql<number>`count(case when ${inventoryItems.isHighValue} = true then 1 end)::int`,
        })
        .from(inventoryItems)
        .where(and(eq(inventoryItems.companyId, companyId), eq(inventoryItems.active, true)))
        .groupBy(inventoryItems.category);

    const hasHighValueItems = dbCategoryCounts.some((c) => c.highValueCount > 0);

    const dbCatMap = new Map(dbCategoryCounts.map((c) => [c.category, c]));

    const availableCategories: Array<{ value: string; label: string; count: number; hasHighValue: boolean }> = [];

    // Primero las categorías que tienen artículos registrados en la empresa
    for (const c of dbCategoryCounts) {
        availableCategories.push({
            value: c.category,
            label: `${c.category} (${c.totalCount} ${c.totalCount === 1 ? "artículo" : "artículos"}${c.highValueCount > 0 ? ` • ${c.highValueCount} alto valor` : ""})`,
            count: c.totalCount,
            hasHighValue: c.highValueCount > 0,
        });
    }

    // Luego las categorías estándar que aún no tienen artículos (para compatibilidad de selección y tests)
    for (const cat of CATEGORIES) {
        if (!dbCatMap.has(cat.value)) {
            availableCategories.push({
                value: cat.value,
                label: cat.label,
                count: 0,
                hasHighValue: false,
            });
        }
    }

    const [company] = await db.select({
        blindStockCount: companies.blindStockCount
    })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

    const isBlindCount = company?.blindStockCount || false;

    const formatDate = (date: Date | null | undefined) => {
        if (!date) return "En progreso";
        return new Date(date).toLocaleDateString("es-MX", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    };

    const errorMessages: Record<string, string> = {
        "missing-fields": "Selecciona una sucursal y una categoría para iniciar el conteo.",
        "missing-company": "No se encontró una empresa asociada a tu sesión. Por favor inicia sesión nuevamente.",
        "active-count": "Ya existe un conteo activo en progreso para esta sucursal. Complétalo o cancélalo en el historial antes de iniciar uno nuevo.",
        "no-products": searchParams?.category
            ? `No se encontraron productos disponibles en la categoría "${searchParams.category}" con los filtros aplicados.`
            : "No se encontraron productos para contar en la categoría seleccionada.",
        "create-failed": searchParams?.msg
            ? `Error al crear el conteo: ${searchParams.msg}`
            : "Error al crear el conteo. Intenta de nuevo más tarde.",
    };

    return (
        <PageContainer className="max-w-2xl">
            <PageHeader
                title="Conteo de Inventario"
                description="Inicia un conteo físico de inventario por categoría y configura sus opciones"
                icon={ClipboardList}
            />

            {errorType && errorMessages[errorType] && (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <div className="space-y-1">
                        <AlertDescription className="font-medium">
                            {errorMessages[errorType]}
                        </AlertDescription>
                        {errorType === "no-products" && (
                            <p className="text-xs opacity-90">
                                {searchParams?.highOnlyValue === "true"
                                    ? "Sugerencia: Tenías activada la casilla \"Contar solo SKUs de alto valor\". Desmárcala para incluir todos los artículos de esta categoría o elige otra categoría con productos."
                                    : "Sugerencia: Esta categoría no tiene productos registrados. Selecciona una categoría con existencias en el catálogo."}
                            </p>
                        )}
                    </div>
                </Alert>
            )}

            {userBranches.length === 0 ? (
                <Card>
                    <CardContent className="py-8 text-center text-muted-foreground">
                        No hay sucursales configuradas. Configura una sucursal para iniciar el conteo.
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Nuevo Conteo</CardTitle>
                            <CardDescription>
                                Selecciona la categoría y sucursal para iniciar el conteo físico
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form action={createStockCount} className="grid gap-4">
                                <div className="grid gap-2">
                                    <Label htmlFor="branchId">Sucursal</Label>
                                    {scopedBranch ? (
                                        <>
                                            <input type="hidden" name="branchId" value={scopedBranch.id} />
                                            <div
                                                id="branchId"
                                                className="flex h-9 w-full items-center rounded-md border border-input bg-muted/30 px-3 py-1 text-sm text-muted-foreground"
                                            >
                                                {scopedBranch.name}
                                            </div>
                                        </>
                                    ) : (
                                        <select
                                            id="branchId"
                                            name="branchId"
                                            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                            required
                                        >
                                            <option value="">Seleccionar sucursal</option>
                                            {userBranches.map((b) => (
                                                <option key={b.id} value={b.id}>{b.name}</option>
                                            ))}
                                        </select>
                                    )}
                                </div>

                                <div className="grid gap-2">
                                    <Label htmlFor="category">Categoría</Label>
                                    <select
                                        id="category"
                                        name="category"
                                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                        required
                                        defaultValue={searchParams?.category || ""}
                                    >
                                        <option value="">Seleccionar categoría</option>
                                        {availableCategories.map((c) => (
                                            <option key={c.value} value={c.value}>{c.label}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="flex items-start gap-3 rounded-lg border bg-muted/10 p-3">
                                    <input
                                        id="highValueOnly"
                                        type="checkbox"
                                        name="highValueOnly"
                                        value="true"
                                        defaultChecked={hasHighValueItems}
                                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-input text-primary focus:ring-primary"
                                    />
                                    <div className="space-y-1">
                                        <label htmlFor="highValueOnly" className="text-sm font-medium leading-none cursor-pointer">
                                            Contar solo SKUs de alto valor (80/20 Pareto — máx. 30)
                                        </label>
                                        <p className="text-xs text-muted-foreground">
                                            {hasHighValueItems
                                                ? "Filtra automáticamente los artículos de mayor costo acumulado. Desmarca para auditar todo el catálogo de la categoría."
                                                : "No hay productos marcados como alto valor en el catálogo. Mantén esta opción desmarcada para auditar todos los artículos."}
                                        </p>
                                    </div>
                                </div>

                                <Button type="submit" className="w-full mt-2">
                                    Iniciar Conteo
                                </Button>
                            </form>
                        </CardContent>
                    </Card>

                    {/* Settings Card */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                                <Settings className="h-4 w-4" /> Configuración de Conteo
                            </CardTitle>
                            <CardDescription>
                                Modifica el comportamiento de las auditorías de inventario de tu empresa.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form action={toggleBlindCountSetting} className="flex items-center justify-between p-4 rounded-lg border bg-muted/20">
                                <div className="space-y-0.5 max-w-[70%]">
                                    <Label className="text-sm font-semibold">Conteo Físico Ciego</Label>
                                    <p className="text-xs text-muted-foreground">Oculta las existencias teóricas del sistema a los auditores para forzar conteos reales.</p>
                                </div>
                                <input type="hidden" name="blindCount" value={isBlindCount ? "false" : "true"} />
                                <Button type="submit" variant={isBlindCount ? "default" : "outline"} size="sm">
                                    {isBlindCount ? "Activo (Ciego)" : "Inactivo (Ver teórico)"}
                                </Button>
                            </form>
                        </CardContent>
                    </Card>

                    {history.length > 0 && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <History className="h-5 w-5" />
                                    Historial de Conteos
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-3">
                                    {history.map((item) => {
                                        const itemData = (item.data ?? {}) as Record<string, unknown>;
                                        const pendingApproval = item.status === "COMPLETED" && itemData.adjustmentsStatus === "PENDING";
                                        const content = (
                                            <div className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors">
                                                <div className="flex flex-col gap-1">
                                                    <div className="font-medium">
                                                        {(itemData.category as string) || "Conteo de Inventario"}
                                                    </div>
                                                    <div className="text-sm text-muted-foreground">
                                                        {(itemData.productCount as number) || 0} productos •{" "}
                                                        {formatDate(item.completedAt)}
                                                    </div>
                                                </div>
                                                {pendingApproval ? (
                                                    <Badge variant="outline" className="border-warning text-warning-text">
                                                        Pendiente de aprobación
                                                    </Badge>
                                                ) : (
                                                    <Badge variant={item.status === "COMPLETED" ? "default" : "secondary"}>
                                                        {item.status === "COMPLETED" ? "Completado" : "En progreso"}
                                                    </Badge>
                                                )}
                                            </div>
                                        );
                                        return item.status === "COMPLETED" ? (
                                            <Link key={item.id} href={`/dashboard/inventory/stock-count/${item.id}/results`}>
                                                {content}
                                            </Link>
                                        ) : (
                                            <Link key={item.id} href={`/dashboard/workflows/${item.id}/execute`} title="Continuar este conteo">
                                                {content}
                                            </Link>
                                        );
                                    })}
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </div>
            )}
        </PageContainer>
    );
}
