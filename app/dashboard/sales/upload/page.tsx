import { Metadata } from "next";
import { SalesCutUploadPageClient } from "./client";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { db } from "@/lib/db";
import { branches } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { UploadCloud } from "lucide-react";

export const metadata: Metadata = {
  title: "Ingesta POS Manual",
  description: "Carga archivos POS o registra ventas manualmente",
};

export default async function SalesUploadPage() {
  const { user } = await requireAuth();
  if (!user) redirect("/login");
  
  const tenant = await requireTenant();
  if (!tenant.id) {
    redirect("/dashboard/select-company");
  }

  // Fetch branches for the current company
  const companyBranches = await db.query.branches.findMany({
    where: eq(branches.companyId, tenant.id),
    orderBy: (b, { asc }) => [asc(b.name)],
    columns: {
      id: true,
      name: true,
    }
  });

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <UploadCloud className="h-7 w-7 text-primary" /> Ingesta POS Manual
          </h1>
          <p className="text-sm text-muted-foreground">
            Arrastra y suelta tus cortes de ventas desde el POS, o ingrésalos manualmente si no tienes un archivo soportado.
          </p>
        </div>
      </div>
        
      <SalesCutUploadPageClient branches={companyBranches} />
    </div>
  );
}
