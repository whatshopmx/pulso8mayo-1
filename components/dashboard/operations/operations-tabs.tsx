"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OverviewTab } from "./overview-tab";
import { ScheduledTab } from "./scheduled-tab";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { RecentWorkflowsTable, type WorkflowInstance } from "../recent-workflows-table";
import { TemperatureMonitor } from "./temperature-monitor";
import { ErrorState } from "@/components/shared/error-state";

interface OperationsTabsProps {
  recentWorkflows: WorkflowInstance[];
  period?: string;
  branchId?: string;
  /** /dashboard/operations ya está limitado a roles operativos por el proxy. */
  canExecute?: boolean;
  activityLoading?: boolean;
  activityError?: string | null;
  onActivityRetry?: () => void;
}

export function OperationsTabs({ recentWorkflows, period = "30d", branchId, canExecute = true, activityLoading, activityError, onActivityRetry }: OperationsTabsProps) {
    return (
        <Tabs defaultValue="overview" className="space-y-4">
            <TabsList className="flex h-auto w-full flex-wrap justify-start sm:w-auto" aria-label="Vistas de operaciones">
                <TabsTrigger value="overview">Resumen</TabsTrigger>
                <TabsTrigger value="activity">Actividad</TabsTrigger>
                <TabsTrigger value="scheduled">Programación</TabsTrigger>
                <TabsTrigger value="templates">Plantillas</TabsTrigger>
            </TabsList>
    <TabsContent value="overview" className="space-y-4">
      <OverviewTab branchId={branchId} period={period} />
      <TemperatureMonitor period={period} branchId={branchId} />
    </TabsContent>
            <TabsContent value="activity" className="space-y-4">
                <Card>
                    <CardHeader>
                        <CardTitle>Actividad reciente</CardTitle>
                        <CardDescription>
                            Últimas ejecuciones en el alcance de sucursales seleccionado.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {activityLoading ? <p role="status" className="py-6 text-sm text-muted-foreground">Cargando actividad…</p>
                          : activityError ? <ErrorState message={activityError} onRetry={onActivityRetry} />
                          : <RecentWorkflowsTable workflows={recentWorkflows} canExecute={canExecute} />}
                    </CardContent>
                </Card>
            </TabsContent>
            <TabsContent value="scheduled" className="space-y-4">
                <ScheduledTab branchId={branchId} />
            </TabsContent>
            <TabsContent value="templates" className="space-y-4">
                <Card>
                    <CardHeader>
                        <CardTitle>Plantillas de trabajo</CardTitle>
                        <CardDescription>
                            Elige una plantilla y una sucursal para iniciar una tarea o asignarla a tu equipo.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {canExecute && <Button asChild><Link href="/dashboard/execute">Elegir plantilla</Link></Button>}
                    </CardContent>
                </Card>
            </TabsContent>
        </Tabs>
    );
}
