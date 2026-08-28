"use client";

import { useEffect, useState } from "react";
import { NOM251Report } from "@/components/compliance/nom251-report";
import { NOM035Report } from "@/components/compliance/nom035-report";
import { ComplianceDashboard } from "@/components/compliance/compliance-dashboard";
import { PayrollExport } from "@/components/compliance/payroll-export";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MetricGrid, MetricCard } from "@/components/ui/metric-card";
import { EmptyState, PageHeader } from "@/components/shared";
import { useBranch } from "@/lib/branch-context";
import {
  FileText,
  Shield,
  ClipboardCheck,
  Brain,
  Building2,
  DollarSign,
  ShieldCheck,
  MapPin,
  ArrowRight,
  Users,
  AlertTriangle,
  CheckCircle,
  PlusCircle,
  FolderCheck,
  LandPlot,
  Loader2,
} from "lucide-react";
import Link from "next/link";

interface BranchLite {
  id: string;
  name: string;
}

interface CompliancePageClientProps {
  branches: BranchLite[];
  companyId?: string;
}

interface IMSSQuickStats {
  totalEmployees: number;
  pendingAltas: number;
  pendingBajas: number;
  overdueAltas: number;
  overdueBajas: number;
}

/**
 * Interactive inline branch picker notice when 'Todas las sucursales' is active.
 * Eliminates the friction of having to scroll to the global header control.
 */
function SelectBranchNotice({
  branches,
  onSelectBranch,
  title,
  description,
}: {
  branches: BranchLite[];
  onSelectBranch: (branchId: string) => void;
  title: string;
  description: string;
}) {
  return (
    <Card className="border border-border/80">
      <CardContent className="py-8">
        <div className="max-w-md mx-auto text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
            <Building2 className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-foreground">{title}</h3>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
          <div className="flex items-center justify-center gap-2 pt-2">
            <Select onValueChange={(val) => onSelectBranch(val)}>
              <SelectTrigger className="w-[240px] text-xs">
                <SelectValue placeholder="Seleccionar sucursal..." />
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id} className="text-xs">
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Live IMSS Overview Tab Component with real-time stats and direct action links.
 */
function IMSSOverviewTab() {
  const [stats, setStats] = useState<IMSSQuickStats>({
    totalEmployees: 0,
    pendingAltas: 0,
    pendingBajas: 0,
    overdueAltas: 0,
    overdueBajas: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      try {
        const [altasRes, bajasRes, employeesRes] = await Promise.allSettled([
          fetch("/api/imss/altas"),
          fetch("/api/imss/bajas"),
          fetch("/api/employees"),
        ]);

        let pendingAltas = 0;
        let pendingBajas = 0;
        let overdueAltas = 0;
        let overdueBajas = 0;
        let totalEmployees = 0;

        if (altasRes.status === "fulfilled" && altasRes.value.ok) {
          const altasData = await altasRes.value.json();
          pendingAltas = (altasData.summary?.ready || 0) + (altasData.summary?.pending || 0);
          overdueAltas = altasData.summary?.overdue || 0;
        }
        if (bajasRes.status === "fulfilled" && bajasRes.value.ok) {
          const bajasData = await bajasRes.value.json();
          pendingBajas = (bajasData.summary?.ready || 0) + (bajasData.summary?.pending || 0);
          overdueBajas = bajasData.summary?.overdue || 0;
        }
        if (employeesRes.status === "fulfilled" && employeesRes.value.ok) {
          const empData = await employeesRes.value.json();
          totalEmployees = empData.pagination?.total || 0;
        }

        setStats({
          totalEmployees,
          pendingAltas,
          pendingBajas,
          overdueAltas,
          overdueBajas,
        });
      } catch (e) {
        console.error("Error loading IMSS stats", e);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  const complianceRate =
    stats.totalEmployees > 0
      ? Math.round(
          ((stats.totalEmployees - stats.overdueAltas - stats.overdueBajas) / stats.totalEmployees) *
            100
        )
      : 100;

  return (
    <div className="space-y-6">
      {/* IMSS KPI Metric Cards */}
      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <MetricGrid columns={4}>
          <MetricCard
            label="Empleados Activos"
            value={stats.totalEmployees}
            icon={<Users className="h-4 w-4" />}
            subtitle="Registrados ante IMSS"
          />
          <MetricCard
            label="Altas Pendientes"
            value={stats.pendingAltas}
            icon={<AlertTriangle className="h-4 w-4" />}
            tone={stats.pendingAltas > 0 ? "warning" : "neutral"}
            subtitle="Plazo legal: 5 días hábiles"
          />
          <MetricCard
            label="Bajas Pendientes"
            value={stats.pendingBajas}
            icon={<AlertTriangle className="h-4 w-4" />}
            tone={stats.pendingBajas > 0 ? "destructive" : "neutral"}
            subtitle="Plazo legal: 5 días hábiles"
          />
          <MetricCard
            label="Cumplimiento IMSS"
            value={`${complianceRate}%`}
            icon={<CheckCircle className="h-4 w-4" />}
            tone={complianceRate >= 90 ? "success" : complianceRate >= 70 ? "warning" : "destructive"}
            subtitle="Movimientos en tiempo"
            progress={{ value: complianceRate }}
          />
        </MetricGrid>
      )}

      {/* Action Modules Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Module 1: Altas */}
        <Card className="hover:border-primary/40 transition-colors">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-primary/10 text-primary">
                <PlusCircle className="h-5 w-5" />
              </div>
              <Badge variant={stats.pendingAltas > 0 ? "destructive" : "secondary"} className="text-xs">
                {stats.pendingAltas} pendientes
              </Badge>
            </div>
            <CardTitle className="text-sm font-bold pt-2">Altas de Personal</CardTitle>
            <CardDescription className="text-xs">
              Registro oportuno de nuevos colaboradores ante el IMSS
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Button asChild variant="outline" size="sm" className="w-full text-xs font-semibold">
              <Link href="/dashboard/compliance/imss/altas">
                Gestionar Altas <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* Module 2: Bajas */}
        <Card className="hover:border-primary/40 transition-colors">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-destructive/10 text-destructive">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <Badge variant={stats.pendingBajas > 0 ? "destructive" : "secondary"} className="text-xs">
                {stats.pendingBajas} pendientes
              </Badge>
            </div>
            <CardTitle className="text-sm font-bold pt-2">Bajas de Personal</CardTitle>
            <CardDescription className="text-xs">
              Tramitación de desvinculaciones laborales ante el IMSS
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Button asChild variant="outline" size="sm" className="w-full text-xs font-semibold">
              <Link href="/dashboard/compliance/imss/bajas">
                Gestionar Bajas <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* Module 3: Generador SUA */}
        <Card className="hover:border-primary/40 transition-colors">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-success/10 text-success">
                <FileText className="h-5 w-5" />
              </div>
              <Badge variant="outline" className="text-xs">
                Mensual
              </Badge>
            </div>
            <CardTitle className="text-sm font-bold pt-2">Archivos SUA / IDSE</CardTitle>
            <CardDescription className="text-xs">
              Generación de layout mensual para pago de cuotas obrero-patronales
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Button asChild variant="outline" size="sm" className="w-full text-xs font-semibold">
              <Link href="/dashboard/compliance/imss/sua">
                Generar SUA <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* Module 4: Expediente Laboral */}
        <Card className="hover:border-primary/40 transition-colors">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-warning/10 text-warning-text">
                <FolderCheck className="h-5 w-5" />
              </div>
              <Badge variant="outline" className="text-xs">
                Legal
              </Badge>
            </div>
            <CardTitle className="text-sm font-bold pt-2">Expedientes Laborales</CardTitle>
            <CardDescription className="text-xs">
              Contratos, identificaciones, certificados médicos y comprobantes
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Button asChild variant="outline" size="sm" className="w-full text-xs font-semibold">
              <Link href="/dashboard/compliance/expediente">
                Ver Expedientes <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* Module 5: Validación SAT */}
        <Card className="hover:border-primary/40 transition-colors">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-primary/10 text-primary">
                <LandPlot className="h-5 w-5" />
              </div>
              <Badge variant="outline" className="text-xs">
                Fiscal
              </Badge>
            </div>
            <CardTitle className="text-sm font-bold pt-2">Validación SAT (RFC / CURP)</CardTitle>
            <CardDescription className="text-xs">
              Verificación de validez fiscal para timbrado de nómina CFDI 4.0
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Button asChild variant="outline" size="sm" className="w-full text-xs font-semibold">
              <Link href="/dashboard/compliance/sat">
                Validación SAT <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* Module 6: Historial de Reportes */}
        <Card className="hover:border-primary/40 transition-colors">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-muted text-foreground">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <Badge variant="outline" className="text-xs">
                Auditoría
              </Badge>
            </div>
            <CardTitle className="text-sm font-bold pt-2">Historial IDSE / IMSS</CardTitle>
            <CardDescription className="text-xs">
              Acuses de recibo y comprobantes de movimientos oficiales
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Button asChild variant="outline" size="sm" className="w-full text-xs font-semibold">
              <Link href="/dashboard/compliance/imss/reports">
                Ver Historial <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function CompliancePageClient({ branches, companyId = "" }: CompliancePageClientProps) {
  const { selectedBranchId, setSelectedBranchId } = useBranch();

  if (branches.length === 0) {
    return (
      <PageHeader
        title="Compliance & Normatividad"
        description="Centro de control normativo sanitario (NOM-251), laboral (NOM-035, IMSS) y fiscal"
        icon={Shield}
        badge="NOM-251 · NOM-035 · IMSS"
      >
        <EmptyState
          icon={MapPin}
          title="Aún no hay sucursales registradas"
          description="Crea una sucursal en configuración para empezar a generar reportes normativos."
        />
      </PageHeader>
    );
  }

  return (
    <>
      <PageHeader
        title="Compliance & Normatividad"
        description="Centro de control normativo sanitario (NOM-251), laboral (NOM-035, IMSS) y fiscal"
        icon={Shield}
        badge="NOM-251 · NOM-035 · IMSS"
      />

      <Tabs defaultValue="dashboard" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-3 lg:grid-cols-5 h-auto p-1 gap-1">
          <TabsTrigger value="dashboard" className="py-2 text-xs font-semibold">
            <ClipboardCheck className="h-4 w-4 mr-2 text-primary" />
            Resumen Ejecutivo
          </TabsTrigger>
          <TabsTrigger value="nom251" className="py-2 text-xs font-semibold">
            <FileText className="h-4 w-4 mr-2 text-primary" />
            NOM-251 Higiene
          </TabsTrigger>
          <TabsTrigger value="nom035" className="py-2 text-xs font-semibold">
            <Brain className="h-4 w-4 mr-2 text-info" />
            NOM-035 Psicosocial
          </TabsTrigger>
          <TabsTrigger value="imss" className="py-2 text-xs font-semibold">
            <Users className="h-4 w-4 mr-2 text-success" />
            IMSS & Laboral
          </TabsTrigger>
          <TabsTrigger value="nomina" className="py-2 text-xs font-semibold">
            <DollarSign className="h-4 w-4 mr-2 text-primary" />
            Exportación Nómina
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Unified Executive Command Center */}
        <TabsContent value="dashboard" className="space-y-4">
          <ComplianceDashboard />
        </TabsContent>

        {/* Tab 2: NOM-251 Sanitary Compliance */}
        <TabsContent value="nom251" className="space-y-4">
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <FileText className="h-5 w-5 text-primary" />
                  Reporte de Cumplimiento NOM-251 (COFEPRIS)
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Bitácoras de higiene, temperaturas, recepción de materia prima y firma digital oficial.
                </p>
              </div>
            </div>

            {selectedBranchId ? (
              <NOM251Report branchId={selectedBranchId} />
            ) : (
              <SelectBranchNotice
                branches={branches}
                onSelectBranch={(id) => setSelectedBranchId(id)}
                title="Selecciona una sucursal para auditar NOM-251"
                description="El reporte sanitario requiere los registros e inspecciones de una sucursal específica."
              />
            )}
          </section>
        </TabsContent>

        {/* Tab 3: NOM-035 Psychosocial Risk Compliance */}
        <TabsContent value="nom035" className="space-y-4">
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Brain className="h-5 w-5 text-info" />
                  Evaluación de Riesgos Psicosociales NOM-035 (STPS)
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Resultados de Guías I/II/III, categorización de niveles de riesgo y medidas de prevención.
                </p>
              </div>
            </div>

            {selectedBranchId ? (
              <NOM035Report branchId={selectedBranchId} />
            ) : (
              <SelectBranchNotice
                branches={branches}
                onSelectBranch={(id) => setSelectedBranchId(id)}
                title="Selecciona una sucursal para evaluar NOM-035"
                description="La evaluación psicosocial analiza los centros de trabajo de forma individual."
              />
            )}
          </section>
        </TabsContent>

        {/* Tab 4: IMSS, Labor & SAT Hub */}
        <TabsContent value="imss" className="space-y-4">
          <IMSSOverviewTab />
        </TabsContent>

        {/* Tab 5: Integrated Payroll Export */}
        <TabsContent value="nomina" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-primary" />
                Generador de Layouts de Nómina
              </CardTitle>
              <CardDescription>
                Exportación de incidencias, horas extra y asistencias para sistemas de nómina (CONTPAQi, NOI, Fortia)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {companyId ? (
                <PayrollExport companyId={companyId} />
              ) : (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  Identificador de empresa no disponible en esta sesión.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}