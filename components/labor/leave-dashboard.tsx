'use client';

import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import { Plus, Calendar, ClipboardList, CheckSquare } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LeaveRequestForm } from '@/components/labor/leave-request-form';
import { LeaveBalanceCard } from '@/components/labor/leave-balance-card';
import { LeaveCalendar } from '@/components/labor/leave-calendar';
import { LeaveRequestsList } from '@/components/labor/leave-requests-list';

interface LeaveDashboardProps {
  companyId: string;
  userId: string;
  userRole: string;
}

type LeaveBalance = ComponentProps<typeof LeaveBalanceCard>['balance'] & { leaveTypeId: string };

const APPROVER_ROLES = new Set([
  'SUPER_ADMIN',
  'ADMIN',
  'GERENTE',
  'SUPERVISOR',
]);

export function LeaveDashboard({
  companyId,
  userId,
  userRole,
}: LeaveDashboardProps) {
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState(false);
  const [countError, setCountError] = useState(false);

  const canApprove = APPROVER_ROLES.has(userRole);
  const [activeTab, setActiveTab] = useState(canApprove ? 'approvals' : 'request');

  const fetchBalances = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setBalanceError(false);
      try {
        const response = await fetch(
          `/api/leave/balances?userId=${userId}&companyId=${companyId}&year=${new Date().getFullYear()}`,
          { signal }
        );
        if (!response.ok) throw new Error('No se pudieron consultar los saldos');
        const data = await response.json();
        if (!Array.isArray(data.balances)) throw new Error('Respuesta de saldos incompleta');
        setBalances(data.balances);
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        console.error('Error fetching leave balances:', error);
        setBalanceError(true);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [companyId, userId]
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchBalances(controller.signal);
    return () => controller.abort();
  }, [fetchBalances, refreshKey]);

  const handleDataChanged = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (!canApprove) return;
    const controller = new AbortController();
    setPendingApprovalsCount(null);
    setCountError(false);
    async function fetchPendingCount() {
      try {
        const response = await fetch('/api/leave/requests?status=PENDING&limit=1', { signal: controller.signal });
        if (!response.ok) throw new Error('No se pudieron consultar los pendientes');
        const data = await response.json();
        if (!Number.isInteger(data.pagination?.total)) throw new Error('Conteo incompleto');
        if (!controller.signal.aborted) setPendingApprovalsCount(data.pagination.total);
      } catch {
        if (!controller.signal.aborted) setCountError(true);
      }
    }
    fetchPendingCount();
    return () => controller.abort();
  }, [canApprove, refreshKey]);

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Encabezado */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Gestión de Permisos
          </h1>
          <p className="text-muted-foreground">
            {canApprove
              ? 'Resuelve las solicitudes pendientes y revisa las ausencias del equipo'
              : 'Consulta tus días disponibles, envía solicitudes y revisa el calendario del equipo'}
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="max-w-full flex-wrap group-data-[orientation=horizontal]/tabs:h-auto">
          {canApprove && (
            <TabsTrigger value="approvals" className="min-h-11 sm:min-h-9 data-[state=active]:shadow-none">
              <CheckSquare className="h-4 w-4 mr-2" />
              Por aprobar
              <Badge variant="secondary" className="ml-2 tabular-nums">
                {pendingApprovalsCount ?? (countError ? 'Sin consultar' : '…')}
              </Badge>
            </TabsTrigger>
          )}
          <TabsTrigger value="calendar" className="min-h-11 sm:min-h-9 data-[state=active]:shadow-none">
            <Calendar className="h-4 w-4 mr-2" />
            Calendario del equipo
          </TabsTrigger>
          <TabsTrigger value="request" className="min-h-11 sm:min-h-9 data-[state=active]:shadow-none">
            <Plus className="h-4 w-4 mr-2" />
            Solicitar permiso
          </TabsTrigger>
          <TabsTrigger value="mine" className="min-h-11 sm:min-h-9 data-[state=active]:shadow-none">
            <ClipboardList className="h-4 w-4 mr-2" />
            Mis solicitudes
          </TabsTrigger>
        </TabsList>
        {countError && (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
            <p>No se pudo consultar el total de pendientes.</p>
            <Button variant="outline" size="sm" onClick={handleDataChanged}>Reintentar pendientes</Button>
          </div>
        )}

        <TabsContent value="request" className="space-y-4">
      <h2 className="text-lg font-semibold">Tus saldos de {new Date().getFullYear()}</h2>
      <div className="grid gap-4 md:grid-cols-3">
        {loading ? (
          <div
            role="status"
            aria-live="polite"
            className="col-span-full grid gap-4 md:grid-cols-3"
          >
            {[1, 2, 3].map((item) => (
              <div
                key={item}
                className="h-48 rounded-lg border bg-muted/40 animate-pulse"
              />
            ))}
            <span className="sr-only">Cargando saldos de permisos...</span>
          </div>
        ) : balanceError ? (
          <div role="alert" className="col-span-full rounded-lg border p-6 space-y-3">
            <p className="text-sm">No pudimos consultar tus saldos. Vuelve a intentarlo para solicitar un permiso.</p>
            <Button variant="outline" onClick={handleDataChanged}>Reintentar saldos</Button>
          </div>
        ) : balances.length === 0 ? (
          <div className="col-span-full rounded-lg bg-muted/50 p-6 space-y-3">
            <h3 className="font-medium">Necesitas saldos para solicitar un permiso</h3>
            <p className="text-sm text-muted-foreground max-w-prose">
              {canApprove
                ? 'Coordina con la persona responsable de administración o RH la asignación de tus saldos de este año. Revisar solicitudes del equipo no requiere saldos personales.'
                : 'Pide a tu gerente o al equipo de administración o RH que revise la asignación de tus saldos de este año.'}
              {' '}Cuando estén asignados, vuelve a consultarlos aquí.
            </p>
            <Button variant="outline" onClick={handleDataChanged}>Volver a consultar saldos</Button>
          </div>
        ) : (
          balances.map((balance) => (
            <LeaveBalanceCard key={balance.id} balance={balance} />
          ))
        )}
      </div>

        {!loading && !balanceError && balances.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Solicitar días libres</CardTitle>
              <CardDescription>
                Envía una nueva solicitud de permiso para autorización
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LeaveRequestForm
                companyId={companyId}
                userId={userId}
                balances={balances}
                onSuccess={handleDataChanged}
              />
            </CardContent>
          </Card>
        )}
        </TabsContent>

        <TabsContent value="mine">
          <Card>
            <CardHeader>
              <CardTitle>Mis solicitudes</CardTitle>
              <CardDescription>
                Revisa el estado de tus solicitudes o cancela las que siguen pendientes
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LeaveRequestsList
                mode="mine"
                userId={userId}
                refreshKey={refreshKey}
                onActionComplete={handleDataChanged}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {canApprove && (
          <TabsContent value="approvals">
            <Card>
              <CardHeader>
                <CardTitle>Solicitudes pendientes de autorización</CardTitle>
                <CardDescription>
                  Aprueba o rechaza los permisos solicitados por tu equipo
                </CardDescription>
              </CardHeader>
              <CardContent>
                <LeaveRequestsList
                  mode="approvals"
                  refreshKey={refreshKey}
                  onActionComplete={handleDataChanged}
                />
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="calendar">
          <Card>
            <CardHeader>
              <CardTitle>Calendario de permisos del equipo</CardTitle>
              <CardDescription>
                Consulta los permisos programados en tu empresa
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LeaveCalendar companyId={companyId} refreshKey={refreshKey} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
