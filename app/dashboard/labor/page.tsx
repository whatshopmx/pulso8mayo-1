import { getCurrentTenant } from "@/lib/tenant-context"
import { EmployeeService } from "@/lib/services/employee-service"
import { db } from "@/lib/db"
import { plannedShifts, shiftSessions, users, shiftApprovals, employeeDocuments, leaveRequests, vacationRequests, breakLogs, shiftTemplates, shiftChangeRequests, holidays, incidents, branches } from "@/lib/db/schema"
import { eq, and, sql, gte, isNull, inArray, count } from "drizzle-orm"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Calendar, Clock, Users, MapPin, TrendingUp, FileText, ArrowLeftRight, Flag, CheckSquare, Coffee, FolderOpen, UserCheck, AlertTriangle, CheckCircle, BarChart3, ClipboardList, Shield, Zap } from "lucide-react"
import Link from "next/link"
import { requireManagementRole } from "@/lib/rbac/require-role"

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
                    <h1 className="text-3xl font-bold tracking-tight">Gestión de Personal</h1>
                    <p className="text-muted-foreground">
                        Administra turnos, asistencia, horas extras, breaks y expediente laboral de tu equipo
                    </p>
                </div>
                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Cumplimiento LFT
                </Badge>
            </div>

            {/* KPI Summary Cards - PRD 8.1.1 */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card className="bg-gradient-to-br from-blue-50 to-blue-100/50 border-blue-200">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-blue-700">Empleados Activos</CardTitle>
                        <Users className="h-4 w-4 text-blue-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-blue-900">{activeCount}</div>
                        <p className="text-xs text-blue-600">
                            +{newEmployeesCount} nuevos esta semana
                        </p>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-green-50 to-green-100/50 border-green-200">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-green-700">Horas Semanales</CardTitle>
                        <Clock className="h-4 w-4 text-green-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-green-900">{weeklyHours}</div>
                        <p className="text-xs text-green-600">
                            Últimos 7 días
                        </p>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-yellow-50 to-yellow-100/50 border-yellow-200">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-yellow-700">Pendientes</CardTitle>
                        <AlertTriangle className="h-4 w-4 text-yellow-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-yellow-900">{pendingApprovalsCount}</div>
                        <p className="text-xs text-yellow-600">
                            Requieren aprobación
                        </p>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-purple-50 to-purple-100/50 border-purple-200">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-purple-700">Cumplimiento</CardTitle>
                        <Shield className="h-4 w-4 text-purple-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-purple-900">{complianceRate}%</div>
                        <p className="text-xs text-purple-600">
                            Semana actual
                        </p>
                    </CardContent>
                </Card>
            </div>

            {/* Quick Actions Grid - Organized by Category */}
            <div className="space-y-6">
                {/* Sección 1: Gestión de Empleados */}
                <div>
                    <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                        <UserCheck className="h-5 w-5" />
                        Gestión de Empleados
                    </h2>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                        <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-blue-500 group">
                            <Link href="/dashboard/employees">
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Directorio</CardTitle>
                                    <UserCheck className="h-4 w-4 text-blue-600 group-hover:scale-110 transition-transform" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{totalCount}</div>
                                    <p className="text-xs text-muted-foreground">
                                        Perfiles activos
                                    </p>
                                </CardContent>
                            </Link>
                        </Card>

                        <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-yellow-500 group">
                            <Link href="/dashboard/labor/documents">
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Expediente</CardTitle>
                                    <FolderOpen className="h-4 w-4 text-yellow-600 group-hover:scale-110 transition-transform" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{dossierPercent}%</div>
                                    <p className="text-xs text-muted-foreground">
                                        Documentos Core
                                    </p>
                                </CardContent>
                            </Link>
                        </Card>

                        <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-purple-500 group">
                            <Link href="/dashboard/labor/leave">
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Permisos</CardTitle>
                                    <Calendar className="h-4 w-4 text-purple-600 group-hover:scale-110 transition-transform" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{pendingLeaveCount}</div>
                                    <p className="text-xs text-muted-foreground">
                                        Solicitudes activas
                                    </p>
                                </CardContent>
                            </Link>
                        </Card>

                        <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-red-500 group">
                            <Link href="/dashboard/labor/vacations">
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Vacaciones</CardTitle>
                                    <Flag className="h-4 w-4 text-red-600 group-hover:scale-110 transition-transform" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{futureVacationsCount}</div>
                                    <p className="text-xs text-muted-foreground">
                                        Programadas
                                    </p>
                                </CardContent>
                            </Link>
                        </Card>
                    </div>
                </div>

                {/* Sección 2: Control de Asistencia */}
                <div>
                    <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                        <Clock className="h-5 w-5" />
                        Control de Asistencia
                    </h2>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                        <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-green-500 group">
                            <Link href="/dashboard/labor/attendance">
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Asistencia</CardTitle>
                                    <FileText className="h-4 w-4 text-green-600 group-hover:scale-110 transition-transform" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{attendancePercent}%</div>
                                    <p className="text-xs text-muted-foreground">
                                        Hoy: {actualCount}/{scheduledCount} empleados
                                    </p>
                                </CardContent>
                            </Link>
                        </Card>

                        <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-orange-500 group">
                            <Link href="/dashboard/labor/breaks">
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Breaks</CardTitle>
                                    <Coffee className="h-4 w-4 text-orange-600 group-hover:scale-110 transition-transform" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{breakComplianceRate}%</div>
                                    <p className="text-xs text-muted-foreground">
                                        NOM-035 Compliance
                                    </p>
                                </CardContent>
                            </Link>
                        </Card>

                        <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-red-500 group">
                            <Link href="/dashboard/labor/overtime">
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Horas Extras</CardTitle>
                                    <TrendingUp className="h-4 w-4 text-red-600 group-hover:scale-110 transition-transform" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{weeklyOvertimeHours}h</div>
                                    <p className="text-xs text-muted-foreground">
                                        Esta semana
                                    </p>
                                </CardContent>
                            </Link>
                        </Card>

                        <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-cyan-500 group">
                            <Link href="/dashboard/labor/geolocation">
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Geolocalización</CardTitle>
                                    <MapPin className="h-4 w-4 text-cyan-600 group-hover:scale-110 transition-transform" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">GPS</div>
                                    <p className="text-xs text-muted-foreground">
                                        Verificación activa
                                    </p>
                                </CardContent>
                            </Link>
                        </Card>
                    </div>
                </div>

                {/* Sección 3: Gestión de Turnos */}
                <div>
                    <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                        <Calendar className="h-5 w-5" />
                        Gestión de Turnos
                    </h2>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                        <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-indigo-500 group">
                            <Link href="/dashboard/labor/shifts">
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Turnos</CardTitle>
                                    <Calendar className="h-4 w-4 text-indigo-600 group-hover:scale-110 transition-transform" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{templateCount}</div>
                                    <p className="text-xs text-muted-foreground">
                                        Tipos activos
                                    </p>
                                </CardContent>
                            </Link>
                        </Card>

                        <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-pink-500 group">
                            <Link href="/dashboard/labor/schedule-builder">
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Constructor</CardTitle>
                                    <Clock className="h-4 w-4 text-pink-600 group-hover:scale-110 transition-transform" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">+</div>
                                    <p className="text-xs text-muted-foreground">
                                        Crear nuevo horario
                                    </p>
                                </CardContent>
                            </Link>
                        </Card>

                        <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-teal-500 group">
                            <Link href="/dashboard/labor/shift-changes">
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Cambios</CardTitle>
                                    <ArrowLeftRight className="h-4 w-4 text-teal-600 group-hover:scale-110 transition-transform" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{pendingSwapsCount}</div>
                                    <p className="text-xs text-muted-foreground">
                                        Intercambios pendientes
                                    </p>
                                </CardContent>
                            </Link>
                        </Card>

                        <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-amber-500 group">
                            <Link href="/dashboard/labor/holidays">
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Festivos</CardTitle>
                                    <Flag className="h-4 w-4 text-amber-600 group-hover:scale-110 transition-transform" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{holidayCount}</div>
                                    <p className="text-xs text-muted-foreground">
                                        Del año
                                    </p>
                                </CardContent>
                            </Link>
                        </Card>
                    </div>
                </div>

                {/* Sección 4: Aprobaciones y Cumplimiento */}
                <div>
                    <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                        <CheckSquare className="h-5 w-5" />
                        Aprobaciones y Cumplimiento
                    </h2>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                        <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-yellow-500 group">
                            <Link href="/dashboard/labor/approvals">
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Aprobaciones</CardTitle>
                                    <CheckSquare className="h-4 w-4 text-yellow-600 group-hover:scale-110 transition-transform" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{pendingApprovalsCount}</div>
                                    <p className="text-xs text-muted-foreground">
                                        Pendientes
                                    </p>
                                </CardContent>
                            </Link>
                        </Card>

                        <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-red-500 group">
                            <Link href="/dashboard/labor/violations">
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Incidencias</CardTitle>
                                    <AlertTriangle className="h-4 w-4 text-red-600 group-hover:scale-110 transition-transform" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold text-red-600">{incidentCount}</div>
                                    <p className="text-xs text-muted-foreground">
                                        Activas
                                    </p>
                                </CardContent>
                            </Link>
                        </Card>

                        <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-blue-500 group">
                            <Link href="/dashboard/labor/attendance">
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Reportes</CardTitle>
                                    <BarChart3 className="h-4 w-4 text-blue-600 group-hover:scale-110 transition-transform" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">+</div>
                                    <p className="text-xs text-muted-foreground">
                                        Ver análisis
                                    </p>
                                </CardContent>
                            </Link>
                        </Card>

                        <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-emerald-500 group">
                            <Link href="/dashboard/labor/leave">
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Reportes Labor</CardTitle>
                                    <ClipboardList className="h-4 w-4 text-emerald-600 group-hover:scale-110 transition-transform" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold text-emerald-900">LFT</div>
                                    <p className="text-xs text-muted-foreground">
                                        Cumplimiento {complianceRate}%
                                    </p>
                                </CardContent>
                            </Link>
                        </Card>
                    </div>
                </div>
            </div>

            {/* PRD 8.3 - KPI Tracking Section */}
            <Card className="bg-gradient-to-r from-slate-50 to-slate-100/50">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <BarChart3 className="h-5 w-5" />
                        Indicadores Clave de Rendimiento (KPIs)
                    </CardTitle>
                    <CardDescription>
                        Métricas principales para seguimiento operativo - PRD Section 8.3
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                        <div className="p-4 border rounded-lg bg-white">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm text-muted-foreground">Tasa de Completion</span>
                                <CheckCircle className="h-4 w-4 text-green-500" />
                            </div>
                            <div className="text-2xl font-bold">{attendancePercent}%</div>
                            <p className="text-xs text-muted-foreground">Sesión hoy</p>
                        </div>
                        <div className="p-4 border rounded-lg bg-white">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm text-muted-foreground">On-Time Arrival</span>
                                <Clock className="h-4 w-4 text-blue-500" />
                            </div>
                            <div className="text-2xl font-bold">{onTimeRate}%</div>
                            <p className="text-xs text-muted-foreground">Semanal</p>
                        </div>
                        <div className="p-4 border rounded-lg bg-white">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm text-muted-foreground">Cumpl. Break</span>
                                <Coffee className="h-4 w-4 text-purple-500" />
                            </div>
                            <div className="text-2xl font-bold">{breakComplianceRate}%</div>
                            <p className="text-xs text-muted-foreground">NOM-035</p>
                        </div>
                        <div className="p-4 border rounded-lg bg-white">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm text-muted-foreground">Overtime</span>
                                <TrendingUp className="h-4 w-4 text-red-500" />
                            </div>
                            <div className="text-2xl font-bold">{weeklyOvertimeHours}h</div>
                            <p className="text-xs text-muted-foreground">Semanal</p>
                        </div>
                        <div className="p-4 border rounded-lg bg-white">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm text-muted-foreground">Aprox. Tiempo</span>
                                <Zap className="h-4 w-4 text-orange-500" />
                            </div>
                            <div className="text-2xl font-bold">{avgLateness}m</div>
                            <p className="text-xs text-muted-foreground text-orange-600">Delay promedio</p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* PRD 7.2.3 - Compliance Reports Info */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Shield className="h-5 w-5" />
                        Cumplimiento Laboral - Ley Federal del Trabajo
                    </CardTitle>
                    <CardDescription>
                        Reportes y normativas applicability - PRD Section 7.2
                    </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    <div className="flex items-start gap-3 p-4 border rounded-lg bg-green-50">
                        <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                            <CheckCircle className="h-5 w-5 text-green-600" />
                        </div>
                        <div>
                            <p className="font-medium text-green-900">Jornada Laboral</p>
                            <p className="text-sm text-green-700">
                                8 horas diurnas / 7 horas nocturnas - Art. 58 LFT
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3 p-4 border rounded-lg bg-blue-50">
                        <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                            <Coffee className="h-5 w-5 text-blue-600" />
                        </div>
                        <div>
                            <p className="font-medium text-blue-900">Descanso Obligatorio</p>
                            <p className="text-sm text-blue-700">
                                30 min mínimo después de 5h - Art. 63 LFT
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3 p-4 border rounded-lg bg-purple-50">
                        <div className="h-10 w-10 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
                            <TrendingUp className="h-5 w-5 text-purple-600" />
                        </div>
                        <div>
                            <p className="font-medium text-purple-900">Horas Extras</p>
                            <p className="text-sm text-purple-700">
                                2x primeras 9h, 3x excedente semanal - Art. 65 LFT
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3 p-4 border rounded-lg bg-orange-50">
                        <div className="h-10 w-10 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                            <Flag className="h-5 w-5 text-orange-600" />
                        </div>
                        <div>
                            <p className="font-medium text-orange-900">Días de Descanso</p>
                            <p className="text-sm text-orange-700">
                                1 día por cada 6 lavorados - Art. 69 LFT
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3 p-4 border rounded-lg bg-cyan-50">
                        <div className="h-10 w-10 rounded-full bg-cyan-100 flex items-center justify-center flex-shrink-0">
                            <Shield className="h-5 w-5 text-cyan-600" />
                        </div>
                        <div>
                            <p className="font-medium text-cyan-900">NOM-035</p>
                            <p className="text-sm text-cyan-700">
                                Factores de riesgo psicosocial laborales
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3 p-4 border rounded-lg bg-red-50">
                        <div className="h-10 w-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                            <AlertTriangle className="h-5 w-5 text-red-600" />
                        </div>
                        <div>
                            <p className="font-medium text-red-900">Prestaciones</p>
                            <p className="text-sm text-red-700">
                                Aguinaldo, vacaciones, prima vacacional - Art. 80 LFT
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Quick Access */}
            <div className="grid gap-4 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Atajos Rápidos</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        <div className="flex gap-2 flex-wrap">
                            <Button variant="default" size="sm" asChild>
                                <Link href="/dashboard/labor/schedule-builder">
                                    <Calendar className="h-4 w-4 mr-1" />
                                    Nuevo Horario
                                </Link>
                            </Button>
                            <Button variant="default" size="sm" asChild>
                                <Link href="/dashboard/employees">
                                    <Users className="h-4 w-4 mr-1" />
                                    Agregar Empleado
                                </Link>
                            </Button>
                            <Button variant="default" size="sm" asChild>
                                <Link href="/dashboard/labor/approvals">
                                    <CheckSquare className="h-4 w-4 mr-1" />
                                    Revisar Aprobaciones
                                </Link>
                            </Button>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                            <Button variant="outline" size="sm" asChild>
                                <Link href="/dashboard/labor/attendance">
                                    <FileText className="h-4 w-4 mr-1" />
                                    Reporte Asistencia
                                </Link>
                            </Button>
                            <Button variant="outline" size="sm" asChild>
                                <Link href="/dashboard/labor/overtime">
                                    <TrendingUp className="h-4 w-4 mr-1" />
                                    Reporte Overtime
                                </Link>
                            </Button>
                            <Button variant="outline" size="sm" asChild>
                                <Link href="/dashboard/labor/breaks">
                                    <Coffee className="h-4 w-4 mr-1" />
                                    Cumplimiento NOM-035
                                </Link>
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Características del Sistema</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm text-muted-foreground">
                        <div className="grid grid-cols-2 gap-2">
                            <p>✓ Calendarización visual</p>
                            <p>✓ Verificación GPS</p>
                            <p>✓ Cálculo LFT automático</p>
                            <p>✓ Cambios de turno</p>
                            <p>✓ Días festivos</p>
                            <p>✓ Reportes CSV/PDF</p>
                            <p>✓ Notificaciones WhatsApp</p>
                            <p>✓ NOM-035 compliance</p>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
