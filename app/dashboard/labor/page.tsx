import { getCurrentTenant } from "@/lib/tenant-context"
import { EmployeeService } from "@/lib/services/employee-service"
import { db } from "@/lib/db"
import { plannedShifts, shiftSessions, users, shiftApprovals, employeeDocuments, leaveRequests, vacationRequests, breakLogs, shiftTemplates, shiftChangeRequests, holidays, incidents, branches } from "@/lib/db/schema"
import { eq, and, sql, gte, isNull, inArray, count } from "drizzle-orm"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Calendar, Clock, Users, MapPin, TrendingUp, FileText, ArrowLeftRight, Flag, CheckSquare, Coffee, FolderOpen, UserCheck, AlertTriangle, CheckCircle, BarChart3, ClipboardList, Shield, Zap, ChevronRight } from "lucide-react"
import Link from "next/link"
import { requireManagementRole } from "@/lib/rbac/require-role"
import { LaborQuickActionDrawer } from "@/components/labor/labor-quick-action-drawer"

export default async function LaborManagementPage() {
  await requireManagementRole();
  const tenant = await getCurrentTenant();
  const companyId = tenant.id;
  const branchId = tenant.branchId;

  // Default values if no company
  if (!companyId) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center">
        <Users className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-xl font-bold">Sin Empresa Seleccionada</h3>
        <p className="text-muted-foreground max-w-md">
          Debes tener una empresa asignada para ver los indicadores de personal.
        </p>
      </div>
    );
  }

  // Date calculations
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  // --- 1. Basic Employee Counts (filtered by branch if selected) ---
  const activeEmployeesRes = await EmployeeService.listEmployees(companyId, { status: 'ACTIVE', limit: 1, branchId: branchId || undefined });
  const totalEmployeesRes = await EmployeeService.listEmployees(companyId, { limit: 1, branchId: branchId || undefined });
  const activeCount = activeEmployeesRes.meta.total;
  const totalCount = totalEmployeesRes.meta.total;

  // --- 2. Attendance & Sessions (Today/Weekly) - Filtered by branch if selected ---
  const branchFilter = branchId ? eq(plannedShifts.branchId, branchId) : undefined;
  const sessionBranchFilter = branchId ? eq(shiftSessions.branchId, branchId) : undefined;

  const [scheduledTodayRes, actualTodayRes, weeklyStatsRes] = await Promise.all([
    // Scheduled today
    db.select({ count: sql<number>`count(distinct ${plannedShifts.userId})` })
    .from(plannedShifts)
    .innerJoin(users, eq(plannedShifts.userId, users.id))
    .where(and(
      eq(plannedShifts.shiftDate, today),
      eq(users.companyId, companyId),
      ...(branchFilter ? [branchFilter] : [])
    )),
    // Actual today
    db.select({ count: sql<number>`count(distinct ${shiftSessions.userId})` })
    .from(shiftSessions)
    .innerJoin(users, eq(shiftSessions.userId, users.id))
    .where(and(
      sql`CAST(${shiftSessions.startedAt} AS DATE) = ${today}`,
      eq(users.companyId, companyId),
      ...(sessionBranchFilter ? [sessionBranchFilter] : [])
    )),
    // Weekly Stats (Hours, Overtime, Compliance)
    db.select({
      totalMinutes: sql<number>`sum(${shiftSessions.totalWorkMinutes})`,
      totalOvertime: sql<number>`sum(${shiftSessions.overtimeMinutes})`,
      totalSessions: sql<number>`count(*)`,
      compliantSessions: sql<number>`count(*) filter (where cast(${shiftSessions.complianceFlags} as jsonb) = '{}'::jsonb or ${shiftSessions.complianceFlags} is null)`,
      lateSessions: sql<number>`count(*) filter (where (${shiftSessions.lateMinutes} > 0))`,
      avgLateness: sql<number>`avg(${shiftSessions.lateMinutes}) filter (where ${shiftSessions.lateMinutes} > 0)`
    })
    .from(shiftSessions)
    .innerJoin(users, eq(shiftSessions.userId, users.id))
    .where(and(
      eq(users.companyId, companyId),
      gte(shiftSessions.startedAt, oneWeekAgo),
      ...(sessionBranchFilter ? [sessionBranchFilter] : [])
    ))
  ]);

    const scheduledCount = Number(scheduledTodayRes[0]?.count || 0);
    const actualCount = Number(actualTodayRes[0]?.count || 0);
    const attendancePercent = scheduledCount > 0 ? Math.round((actualCount / scheduledCount) * 100) : 0;

    const weeklyStats = weeklyStatsRes[0];
    const weeklyHours = Math.round((Number(weeklyStats?.totalMinutes || 0)) / 60);
    const weeklyOvertimeHours = Math.round((Number(weeklyStats?.totalOvertime || 0)) / 60);
    const complianceRate = weeklyStats?.totalSessions ? Math.round((Number(weeklyStats.compliantSessions) / Number(weeklyStats.totalSessions)) * 100) : 100;
    const onTimeRate = weeklyStats?.totalSessions ? Math.round(((Number(weeklyStats.totalSessions) - Number(weeklyStats.lateSessions)) / Number(weeklyStats.totalSessions)) * 100) : 100;
    const avgLateness = Math.round(Number(weeklyStats?.avgLateness || 0));

  // --- 3. Requests & Approvals ---
  const [pendingApprovalsRes, pendingLeaveRes, futureVacationsRes, pendingSwapsRes] = await Promise.all([
    db.select({ count: count() }).from(shiftApprovals).where(and(
      eq(shiftApprovals.companyId, companyId),
      eq(shiftApprovals.status, 'PENDING'),
      ...(branchId ? [eq(shiftApprovals.branchId, branchId)] : [])
    )),
    db.select({ count: count() }).from(leaveRequests).where(and(
      eq(leaveRequests.companyId, companyId),
      eq(leaveRequests.status, 'PENDING'),
      ...(branchId ? [eq(leaveRequests.branchId, branchId)] : [])
    )),
    db.select({ count: count() }).from(vacationRequests).where(and(
      eq(vacationRequests.companyId, companyId),
      eq(vacationRequests.status, 'APPROVED'),
      gte(vacationRequests.startDate, now),
      ...(branchId ? [eq(vacationRequests.branchId, branchId)] : [])
    )),
    db.select({ count: count() }).from(shiftChangeRequests).where(and(
      eq(shiftChangeRequests.companyId, companyId),
      eq(shiftChangeRequests.status, 'PENDING'),
      ...(branchId ? [eq(shiftChangeRequests.branchId, branchId)] : [])
    ))
  ]);

    const pendingApprovalsCount = Number(pendingApprovalsRes[0]?.count || 0);
    const pendingLeaveCount = Number(pendingLeaveRes[0]?.count || 0);
    const futureVacationsCount = Number(futureVacationsRes[0]?.count || 0);
    const pendingSwapsCount = Number(pendingSwapsRes[0]?.count || 0);

    // --- 4. Documents (Expediente required set) ---
    // Keep this list aligned with the enum-backed document schema and required checklist.
    const coreDocTypes = ['CONTRACT', 'ID', 'TAX_ID', 'BANK_INFO'] as const;
    const docsRes = await db.select({ 
        userId: employeeDocuments.userId,
        docType: employeeDocuments.documentType 
    })
    .from(employeeDocuments)
    .where(and(
        eq(employeeDocuments.companyId, companyId),
        inArray(employeeDocuments.documentType, coreDocTypes),
        eq(employeeDocuments.status, 'VALIDATED'),
        eq(employeeDocuments.isValid, true)
    ));

    // Calculate unique mandatory docs per user
    const userDocMap = new Map();
    docsRes.forEach(d => {
        if (!userDocMap.has(d.userId)) userDocMap.set(d.userId, new Set());
        userDocMap.get(d.userId).add(d.docType);
    });
    
    const totalTargetDocs = totalCount * coreDocTypes.length;
    let totalPresentDocs = 0;
    userDocMap.forEach(docs => totalPresentDocs += docs.size);
    const dossierPercent = totalTargetDocs > 0 ? Math.round((totalPresentDocs / totalTargetDocs) * 100) : 100;

    // --- 5. Breaks & Holidays & Templates & Incidents ---
    const [breakStatsRes, holidayCountRes, templateCountRes, incidentCountRes, newEmployeesRes] = await Promise.all([
        db.select({
            total: count(),
            compliant: sql<number>`count(*) filter (where ${breakLogs.isCompliant} = true)`
        })
        .from(breakLogs)
        .innerJoin(shiftSessions, eq(breakLogs.sessionId, shiftSessions.id))
        .innerJoin(users, eq(shiftSessions.userId, users.id))
        .where(and(eq(users.companyId, companyId), gte(breakLogs.startTime, oneWeekAgo))),
        db.select({ count: count() }).from(holidays).where(and(eq(holidays.companyId, companyId), gte(holidays.date, startOfYear.toISOString().split('T')[0]))),
        db.select({ count: count() }).from(shiftTemplates).where(and(eq(shiftTemplates.companyId, companyId), eq(shiftTemplates.isActive, true))),
        db.select({ count: count() }).from(incidents)
            .innerJoin(branches, eq(incidents.branchId, branches.id))
            .where(and(eq(branches.companyId, companyId), inArray(incidents.status, ['DETECTED', 'IN_REMEDIATION']))),
        db.select({ count: count() }).from(users).where(and(eq(users.companyId, companyId), gte(users.createdAt, oneWeekAgo), isNull(users.deletedAt)))
    ]);

    const breakStats = breakStatsRes[0];
    const breakComplianceRate = breakStats?.total ? Math.round((Number(breakStats.compliant) / Number(breakStats.total)) * 100) : 100;
    const holidayCount = Number(holidayCountRes[0]?.count || 0);
    const templateCount = Number(templateCountRes[0]?.count || 0);
    const incidentCount = Number(incidentCountRes[0]?.count || 0);
    const newEmployeesCount = Number(newEmployeesRes[0]?.count || 0);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Gestión de Personal</h1>
                    <p className="text-sm text-muted-foreground">
                        Administra turnos, asistencia, horas extras, descansos y expedientes laborales
                    </p>
                </div>
                <Badge variant="outline" className="gap-1 px-2.5 py-1 text-xs font-medium">
                    <Shield className="w-3.5 h-3.5 text-emerald-600" />
                    Cumplimiento LFT
                </Badge>
            </div>

            {/* Operational Command Banner & Quick Action Drawer */}
            <LaborQuickActionDrawer
                pendingApprovalsCount={pendingApprovalsCount}
                pendingSwapsCount={pendingSwapsCount}
                pendingLeaveCount={pendingLeaveCount}
                incidentCount={incidentCount}
            />

            {/* Top Operational Metrics Ribbon */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card className="bg-card border-border shadow-none">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Empleados Activos</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold tracking-tight">{activeCount}</div>
                        <p className="text-xs text-muted-foreground mt-1">
                            +{newEmployeesCount} nuevos esta semana
                        </p>
                    </CardContent>
                </Card>

                <Card className="bg-card border-border shadow-none">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Horas Semanales</CardTitle>
                        <Clock className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold tracking-tight">{weeklyHours}h</div>
                        <p className="text-xs text-muted-foreground mt-1">
                            Últimos 7 días
                        </p>
                    </CardContent>
                </Card>

                <Card className="bg-card border-border shadow-none">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Aprobaciones Pendientes</CardTitle>
                        <AlertTriangle className={`h-4 w-4 ${pendingApprovalsCount > 0 ? 'text-amber-500' : 'text-muted-foreground'}`} />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold tracking-tight">{pendingApprovalsCount}</div>
                        <p className="text-xs text-muted-foreground mt-1">
                            {pendingApprovalsCount > 0 ? 'Requieren acción inmediata' : 'Sin pendientes'}
                        </p>
                    </CardContent>
                </Card>

                <Card className="bg-card border-border shadow-none">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Cumplimiento General</CardTitle>
                        <Shield className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold tracking-tight">{complianceRate}%</div>
                        <p className="text-xs text-muted-foreground mt-1">
                            Semana actual
                        </p>
                    </CardContent>
                </Card>
            </div>

            {/* Asymmetric Command Center Grid (2 Columns) */}
            <div className="grid gap-6 lg:grid-cols-12">
                {/* Main Operational Column (Col-span 8) */}
                <div className="lg:col-span-8 space-y-6">
                    {/* Control de Asistencia y Turnos */}
                    <div className="space-y-3">
                        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
                            <Clock className="h-4 w-4 text-muted-foreground" />
                            Operación Diaria de Personal
                        </h2>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Card className="bg-card border-border shadow-none hover:bg-muted/30 transition-colors group">
                                <Link href="/dashboard/labor/attendance" className="block p-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm font-semibold text-foreground">Asistencia del Día</span>
                                        <FileText className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                                    </div>
                                    <div className="text-2xl font-bold">{attendancePercent}%</div>
                                    <p className="text-xs text-muted-foreground mt-1">Hoy: {actualCount}/{scheduledCount} empleados en turno</p>
                                </Link>
                            </Card>

                            <Card className="bg-card border-border shadow-none hover:bg-muted/30 transition-colors group">
                                <Link href="/dashboard/labor/breaks" className="block p-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm font-semibold text-foreground">Descansos (Breaks)</span>
                                        <Coffee className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                                    </div>
                                    <div className="text-2xl font-bold">{breakComplianceRate}%</div>
                                    <p className="text-xs text-muted-foreground mt-1">Cumplimiento NOM-035 en pausa laboral</p>
                                </Link>
                            </Card>

                            <Card className="bg-card border-border shadow-none hover:bg-muted/30 transition-colors group">
                                <Link href="/dashboard/labor/shifts" className="block p-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm font-semibold text-foreground">Plantillas de Turnos</span>
                                        <Calendar className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                                    </div>
                                    <div className="text-2xl font-bold">{templateCount}</div>
                                    <p className="text-xs text-muted-foreground mt-1">Tipos de horario configurados</p>
                                </Link>
                            </Card>

                            <Card className="bg-card border-border shadow-none hover:bg-muted/30 transition-colors group">
                                <Link href="/dashboard/labor/schedule-builder" className="block p-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm font-semibold text-foreground">Constructor de Horarios</span>
                                        <Clock className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                                    </div>
                                    <div className="text-2xl font-bold text-primary">+</div>
                                    <p className="text-xs text-muted-foreground mt-1">Crear o publicar nuevo cuadrante</p>
                                </Link>
                            </Card>
                        </div>
                    </div>

                    {/* Quick Access Grid: Overtime, Geolocation, Swaps, Approvals */}
                    <div className="space-y-3">
                        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
                            <CheckSquare className="h-4 w-4 text-muted-foreground" />
                            Control de Horas & Incidencias
                        </h2>
                        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
                            <Card className="bg-card border-border shadow-none hover:bg-muted/40 transition-colors group">
                                <Link href="/dashboard/labor/overtime" className="block p-3">
                                    <span className="text-xs font-medium text-foreground block mb-1">Horas Extras</span>
                                    <div className="text-lg font-bold">{weeklyOvertimeHours}h</div>
                                    <p className="text-xs text-muted-foreground">Esta semana</p>
                                </Link>
                            </Card>

                            <Card className="bg-card border-border shadow-none hover:bg-muted/40 transition-colors group">
                                <Link href="/dashboard/labor/geolocation" className="block p-3">
                                    <span className="text-xs font-medium text-foreground block mb-1">GPS Verificación</span>
                                    <div className="text-lg font-bold">Activo</div>
                                    <p className="text-xs text-muted-foreground">Geocerca branch</p>
                                </Link>
                            </Card>

                            <Card className="bg-card border-border shadow-none hover:bg-muted/40 transition-colors group">
                                <Link href="/dashboard/labor/shift-changes" className="block p-3">
                                    <span className="text-xs font-medium text-foreground block mb-1">Intercambios</span>
                                    <div className="text-lg font-bold">{pendingSwapsCount}</div>
                                    <p className="text-xs text-muted-foreground">Pendientes</p>
                                </Link>
                            </Card>

                            <Card className="bg-card border-border shadow-none hover:bg-muted/40 transition-colors group">
                                <Link href="/dashboard/labor/violations" className="block p-3">
                                    <span className="text-xs font-medium text-foreground block mb-1">Incidencias</span>
                                    <div className={`text-lg font-bold ${incidentCount > 0 ? 'text-amber-600' : ''}`}>{incidentCount}</div>
                                    <p className="text-xs text-muted-foreground">En revisión</p>
                                </Link>
                            </Card>
                        </div>
                    </div>

                    {/* PRD 8.3 - KPI Tracking Horizontal Bar */}
                    <Card className="bg-card border-border shadow-none">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-semibold flex items-center gap-2">
                                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                                Indicadores Clave de Rendimiento (KPIs)
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-5">
                                <div className="p-3 border rounded bg-muted/20">
                                    <span className="text-xs text-muted-foreground block mb-1">Completion</span>
                                    <div className="text-lg font-bold">{attendancePercent}%</div>
                                    <span className="text-xs text-muted-foreground">Asistencia hoy</span>
                                </div>
                                <div className="p-3 border rounded bg-muted/20">
                                    <span className="text-xs text-muted-foreground block mb-1">Puntualidad</span>
                                    <div className="text-lg font-bold">{onTimeRate}%</div>
                                    <span className="text-xs text-muted-foreground">Llegada a tiempo</span>
                                </div>
                                <div className="p-3 border rounded bg-muted/20">
                                    <span className="text-xs text-muted-foreground block mb-1">Breaks</span>
                                    <div className="text-lg font-bold">{breakComplianceRate}%</div>
                                    <span className="text-xs text-muted-foreground">NOM-035</span>
                                </div>
                                <div className="p-3 border rounded bg-muted/20">
                                    <span className="text-xs text-muted-foreground block mb-1">Overtime</span>
                                    <div className="text-lg font-bold">{weeklyOvertimeHours}h</div>
                                    <span className="text-xs text-muted-foreground">Horas extra</span>
                                </div>
                                <div className="p-3 border rounded bg-muted/20">
                                    <span className="text-xs text-muted-foreground block mb-1">Retraso Avg</span>
                                    <div className="text-lg font-bold">{avgLateness}m</div>
                                    <span className="text-xs text-muted-foreground">Minutos promedio</span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Sidebar Column (Col-span 4) */}
                <div className="lg:col-span-4 space-y-6">
                    {/* Expediente & Permisos */}
                    <div className="space-y-3">
                        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
                            <UserCheck className="h-4 w-4 text-muted-foreground" />
                            Personal & Expediente
                        </h2>
                        <div className="grid gap-3">
                            <Card className="bg-card border-border shadow-none hover:bg-muted/40 transition-colors group">
                                <Link href="/dashboard/employees" className="block p-3.5">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <span className="text-xs font-semibold text-foreground block">Directorio de Empleados</span>
                                            <span className="text-xs text-muted-foreground">{totalCount} perfiles en sistema</span>
                                        </div>
                                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                                    </div>
                                </Link>
                            </Card>

                            <Card className="bg-card border-border shadow-none hover:bg-muted/40 transition-colors group">
                                <Link href="/dashboard/labor/documents" className="block p-3.5">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <span className="text-xs font-semibold text-foreground block">Expediente Digital</span>
                                            <span className="text-xs text-muted-foreground">{dossierPercent}% cumplimiento core</span>
                                        </div>
                                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                                    </div>
                                </Link>
                            </Card>

                            <Card className="bg-card border-border shadow-none hover:bg-muted/40 transition-colors group">
                                <Link href="/dashboard/labor/leave" className="block p-3.5">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <span className="text-xs font-semibold text-foreground block">Permisos & Licencias</span>
                                            <span className="text-xs text-muted-foreground">{pendingLeaveCount} por autorizar</span>
                                        </div>
                                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                                    </div>
                                </Link>
                            </Card>

                            <Card className="bg-card border-border shadow-none hover:bg-muted/40 transition-colors group">
                                <Link href="/dashboard/labor/vacations" className="block p-3.5">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <span className="text-xs font-semibold text-foreground block">Vacaciones Programadas</span>
                                            <span className="text-xs text-muted-foreground">{futureVacationsCount} en calendario</span>
                                        </div>
                                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                                    </div>
                                </Link>
                            </Card>
                        </div>
                    </div>

                    {/* PRD 7.2.3 - Compliance Reports Info (Compact List) */}
                    <Card className="bg-card border-border shadow-none">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
                                <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                                Marco Legal LFT / NOM-035
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2 text-xs">
                            <div className="p-2 border rounded bg-muted/20">
                                <p className="font-semibold text-foreground">Jornada Laboral</p>
                                <p className="text-xs text-muted-foreground">8h diurnas / 7h nocturnas (Art. 58 LFT)</p>
                            </div>
                            <div className="p-2 border rounded bg-muted/20">
                                <p className="font-semibold text-foreground">Descanso Obligatorio</p>
                                <p className="text-xs text-muted-foreground">30 min después de 5h (Art. 63 LFT)</p>
                            </div>
                            <div className="p-2 border rounded bg-muted/20">
                                <p className="font-semibold text-foreground">Horas Extras</p>
                                <p className="text-xs text-muted-foreground">2x primeras 9h, 3x excedente (Art. 65 LFT)</p>
                            </div>
                            <div className="p-2 border rounded bg-muted/20">
                                <p className="font-semibold text-foreground">NOM-035 Compliance</p>
                                <p className="text-xs text-muted-foreground">Factores de riesgo psicosocial</p>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Atajos Rápidos */}
                    <Card className="bg-card border-border shadow-none">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-xs font-semibold uppercase tracking-wider">Acciones Rápidas</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            <Button variant="default" size="sm" asChild className="w-full justify-start text-xs">
                                <Link href="/dashboard/labor/schedule-builder">
                                    <Calendar className="h-3.5 w-3.5 mr-2" />
                                    Crear Nuevo Horario
                                </Link>
                            </Button>
                            <Button variant="outline" size="sm" asChild className="w-full justify-start text-xs">
                                <Link href="/dashboard/employees">
                                    <Users className="h-3.5 w-3.5 mr-2" />
                                    Agregar Empleado
                                </Link>
                            </Button>
                            <Button variant="outline" size="sm" asChild className="w-full justify-start text-xs">
                                <Link href="/dashboard/labor/approvals">
                                    <CheckSquare className="h-3.5 w-3.5 mr-2" />
                                    Centro de Aprobaciones
                                </Link>
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
}

