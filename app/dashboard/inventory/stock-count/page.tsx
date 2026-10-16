import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { headers, cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { StockCountService } from "@/lib/services/stock-count-service";
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
import { StockCountLauncher } from "@/components/inventory/stock-count-launcher";

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

    const companyScope = ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'READONLY'].includes(session.user.role);
    const userBranchId = companyScope ? undefined : session.user.branchId;
    const userBranches = !companyScope && !userBranchId ? [] : await db.select().from(branches)
        .where(and(eq(branches.companyId, companyId), userBranchId ? eq(branches.id, userBranchId) : undefined));

    // Alcance del header (BranchScopeControl): si hay sucursal en foco, el
    // conteo hereda ese alcance en lugar de volver a preguntar — una sola
    // fuente de verdad para "en qué sucursal estoy".
    const cookieStore = await cookies();
    const scopedBranchId = cookieStore.get(BRANCH_COOKIE_NAME)?.value || "";
    // Validar contra las sucursales del tenant: una cookie huérfana no puede
    // crear conteos fantasma.
    const scopedBranch = userBranches.find((b) => b.id === scopedBranchId) ?? null;

    const allHistory = !companyScope && !userBranchId ? [] : await StockCountService.getStockCountHistory(companyId, userBranchId || undefined);
    const history = session.user.role === 'EMPLEADO' ? allHistory.filter(row => row.assigneeId === session.user.id || (!row.assigneeId && row.branchId === userBranchId)) : allHistory;

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

    const availableCategories = dbCategoryCounts.filter(row => row.category?.trim() && row.totalCount > 0).map(row => ({
        value: row.category, label: row.category, count: row.totalCount,
    }));

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
                    <StockCountLauncher
                        branches={userBranches.map((b) => ({ id: b.id, name: b.name }))}
                        scopedBranch={scopedBranch ? { id: scopedBranch.id, name: scopedBranch.name } : null}
                        categories={availableCategories}
                        hasHighValueItems={hasHighValueItems}
                        blindCount={isBlindCount}
                        defaultCategory={searchParams?.category}
                    />

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
