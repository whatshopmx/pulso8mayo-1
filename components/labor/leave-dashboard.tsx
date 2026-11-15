'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Calendar, ClipboardList, CheckSquare } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
  const [balances, setBalances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);

  const canApprove = APPROVER_ROLES.has(userRole);

  const fetchBalances = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await fetch(
          `/api/leave/balances?userId=${userId}&companyId=${companyId}`,
          { signal }
        );
        const data = await response.json();
        setBalances(data.balances || []);
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        console.error('Error fetching leave balances:', error);
      } finally {
        setLoading(false);
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

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Encabezado */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Gestión de Permisos
          </h1>
          <p className="text-muted-foreground">
            Consulta tus días disponibles, envía solicitudes y revisa el calendario del equipo
          </p>
        </div>
      </div>

      {/* Tarjetas de saldo */}
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
        ) : balances.length === 0 ? (
          <div className="col-span-full rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
            No tienes saldos de permisos configurados para este año.
          </div>
        ) : (
          balances.map((balance) => (
            <LeaveBalanceCard key={balance.id} balance={balance} />
          ))
        )}
      </div>

      {/* Pestañas */}
      <Tabs defaultValue="request" className="space-y-4">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="request" className="min-h-10 sm:min-h-8">
            <Plus className="h-4 w-4 mr-2" />
            Solicitar permiso
          </TabsTrigger>
          <TabsTrigger value="mine" className="min-h-10 sm:min-h-8">
            <ClipboardList className="h-4 w-4 mr-2" />
            Mis solicitudes
          </TabsTrigger>
          {canApprove && (
            <TabsTrigger value="approvals" className="min-h-10 sm:min-h-8">
              <CheckSquare className="h-4 w-4 mr-2" />
              Por aprobar
              {pendingApprovalsCount > 0 && (
                <Badge variant="secondary" className="ml-2 tabular-nums">
                  {pendingApprovalsCount}
                </Badge>
              )}
            </TabsTrigger>
          )}
          <TabsTrigger value="calendar" className="min-h-10 sm:min-h-8">
            <Calendar className="h-4 w-4 mr-2" />
            Calendario del equipo
          </TabsTrigger>
        </TabsList>

        <TabsContent value="request">
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
                  onPendingCountChange={setPendingApprovalsCount}
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
