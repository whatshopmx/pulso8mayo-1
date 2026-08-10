"use client";

import { NOM251Report } from "@/components/compliance/nom251-report";
import { NOM035Report } from "@/components/compliance/nom035-report";
import { ComplianceDashboard } from "@/components/compliance/compliance-dashboard";
import { CorporateComplianceGrid } from "@/components/compliance/corporate-compliance-grid";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, PageHeader } from "@/components/shared";
import { useBranch } from "@/lib/branch-context";
import { FileText, Shield, ClipboardCheck, Brain, Building2, DollarSign, ShieldCheck, MapPin, ArrowRight } from "lucide-react";
import Link from "next/link";

interface BranchLite {
  id: string;
  name: string;
}

interface CompliancePageClientProps {
  branches: BranchLite[];
}

/** Renders the "select a branch first" notice shared by NOM-251 / NOM-035. */
function SelectBranchNotice() {
  return (
    <Card>
      <CardContent className="py-2">
        <EmptyState
          icon={Building2}
          title="Selecciona una sucursal"
          description="Para generar el reporte elige una sucursal en el control del encabezado."
        />
      </CardContent>
    </Card>
  );
}

export function CompliancePageClient({ branches }: CompliancePageClientProps) {
  // Branch scope flows from the header BranchScopeControl (AD-1, cookie-backed).
  const { selectedBranchId } = useBranch();

  // Single-branch "Vista Corporativa" tab only meaningful when > 1 branch.
  const showCorporate = branches.length > 1;

  // NOM-251 / NOM-035 / Nómina need a specific branch; the header "Todas"
  // (null) means "no branch selected" → show the notice until the user picks.
  if (branches.length === 0) {
    return (
      <PageHeader
        title="Compliance"
        description="Gestión de reportes de cumplimiento normativo"
        icon={Shield}
        badge="NOM-251 & NOM-035"
      >
        <EmptyState
          icon={MapPin}
          title="Aún no hay sucursales"
          description="Crea una sucursal para empezar a generar reportes."
        />
      </PageHeader>
    );
  }

  return (
    <>
      <PageHeader
        title="Compliance"
        description="Gestión de reportes de cumplimiento normativo"
        icon={Shield}
        badge="NOM-251 & NOM-035"
      />

      <Tabs defaultValue="dashboard" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 lg:grid-cols-6">
          <TabsTrigger value="dashboard">
            <ClipboardCheck className="h-4 w-4 mr-2" />
            Dashboard
          </TabsTrigger>
          {showCorporate && (
            <TabsTrigger value="corporate">
              <Building2 className="h-4 w-4 mr-2" />
              Vista Corporativa
            </TabsTrigger>
          )}
          <TabsTrigger value="nom251">
            <FileText className="h-4 w-4 mr-2" />
            NOM-251
          </TabsTrigger>
          <TabsTrigger value="nom035">
            <Brain className="h-4 w-4 mr-2" />
            NOM-035
          </TabsTrigger>
          <TabsTrigger value="imss">
            <ShieldCheck className="h-4 w-4 mr-2" />
            IMSS
          </TabsTrigger>
          <TabsTrigger value="nomina">
            <DollarSign className="h-4 w-4 mr-2" />
            Nómina
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-4">
          <ComplianceDashboard />
        </TabsContent>

        {showCorporate && (
          <TabsContent value="corporate" className="space-y-4">
            <CorporateComplianceGrid />
          </TabsContent>
        )}

        <TabsContent value="nom251" className="space-y-4">
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              <h2 className="text-2xl font-semibold">Reporte NOM-251</h2>
            </div>
            <p className="text-muted-foreground">
              Genera reportes de cumplimiento de higiene y salud conforme a los requisitos de COFEPRIS.
              Incluye todas las inspecciones realizadas, tasas de cumplimiento por categoría, y firma digital.
            </p>

            {selectedBranchId ? (
              <NOM251Report branchId={selectedBranchId} />
            ) : (
              <SelectBranchNotice />
            )}
          </section>
        </TabsContent>

        <TabsContent value="nom035" className="space-y-4">
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-info" />
              <h2 className="text-2xl font-semibold">Reporte NOM-035 - Riesgos Psicosociales</h2>
            </div>
            <p className="text-muted-foreground">
              Evaluación de factores de riesgo psicosocial en el trabajo conforme a la NOM-035-STPS-2018.
              Incluye encuestas de estrés laboral, niveles de riesgo por empleado, y recomendaciones.
            </p>

            {selectedBranchId ? (
              <NOM035Report branchId={selectedBranchId} />
            ) : (
              <SelectBranchNotice />
            )}
          </section>
        </TabsContent>

        <TabsContent value="imss" className="space-y-4">
          <Card>
            <CardContent className="py-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-green-500/10 text-green-700">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold">Integración y Registros IMSS</h3>
                  <p className="text-sm text-muted-foreground">
                    Gestión de altas, bajas, archivos SUA, reportes e incidencias laborales ante el IMSS.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button asChild variant="default">
                  <Link href="/dashboard/compliance/imss">
                    Ir a Gestión IMSS <ArrowRight className="h-4 w-4 ml-1" />
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/dashboard/compliance/imss/altas">Altas Pendientes</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/dashboard/compliance/imss/sua">Generador SUA</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/dashboard/compliance/imss/reports">Archivos IDSE</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="nomina" className="space-y-4">
          <Card>
            <CardContent className="py-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-primary/10 text-primary">
                  <DollarSign className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold">Exportación de Nómina</h3>
                  <p className="text-sm text-muted-foreground">
                    Generación y descarga de layouts de nómina por período y sucursal.
                  </p>
                </div>
              </div>
              <div className="pt-2">
                <Button asChild variant="default">
                  <Link href="/dashboard/compliance/payroll">
                    Ir a Exportación de Nómina <ArrowRight className="h-4 w-4 ml-1" />
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>
    </>
  );
}