"use client";

import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@/components/shared/error-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, User, Building, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { authClient } from "@/lib/auth-client";

interface ScheduledAssignment {
    id: string;
    status: string;
    dueDate: Date;
    priority: string;
    assignmentType: string;
    templateName: string;
    branchName: string;
    assigneeName: string;
    createdAt: Date;
}

export function ScheduledTab({ branchId }: { branchId?: string }) {
    const { data: session } = authClient.useSession();
    const query = useQuery({
        queryKey: ["operations", "scheduled", session?.user.id, branchId ?? "all"],
        enabled: Boolean(session?.user.id),
        queryFn: async ({ signal }): Promise<ScheduledAssignment[]> => {
            const params = new URLSearchParams();
            if (branchId && branchId !== "all") params.set("branchId", branchId);
            const response = await fetch(`/api/operations/scheduled?${params}`, { signal });
            if (!response.ok) throw new Error("No se pudo cargar la programación.");
            const result = await response.json();
            const data = result.data ?? result;
            if (!Array.isArray(data)) throw new Error("La programación recibida no es válida.");
            return data;
        },
    });
    const scheduledItems = query.data ?? [];
    const loading = query.isPending;

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'PENDING': return 'bg-warning/10 text-warning-text';
            case 'IN_PROGRESS': return 'bg-info/10 text-info';
            case 'COMPLETED': return 'bg-success/10 text-success-text';
            case 'OVERDUE': return 'bg-destructive/10 text-destructive';
            default: return 'bg-muted text-muted-foreground';
        }
    };

    const getPriorityColor = (priority: string) => {
        switch (priority) {
            case 'URGENT':
            case 'HIGH': return 'bg-destructive/10 text-destructive';
            case 'MEDIUM': return 'bg-warning/10 text-warning-text';
            case 'LOW': return 'bg-muted text-muted-foreground';
            default: return 'bg-muted text-muted-foreground';
        }
    };

    if (loading) {
        return (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                <Card className="col-span-7">
                    <CardHeader>
                        <CardTitle>Próximas tareas</CardTitle>
                        <CardDescription>
                            Tareas programadas para los próximos siete días.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div role="status" className="flex items-center justify-center gap-2 p-8">
                            <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin text-muted-foreground" /><span className="text-sm">Cargando programación…</span>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (query.isError) return <ErrorState message="No se pudo cargar la programación. Vuelve a intentarlo." onRetry={() => void query.refetch()} />;

    return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
            <Card className="col-span-7">
                <CardHeader>
                    <CardTitle>Próximas tareas</CardTitle>
                    <CardDescription>
                        Tareas programadas para los próximos siete días.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {scheduledItems.length === 0 ? (
                        <div className="flex flex-col items-center justify-center p-8 text-center border border-dashed rounded-lg">
                            <Calendar className="h-10 w-10 text-muted-foreground mb-4" />
                            <h3 className="text-lg font-semibold">Sin tareas programadas</h3>
                            <p className="text-sm text-muted-foreground max-w-sm mt-2">
                                Las tareas de los próximos siete días aparecerán aquí. Configura su frecuencia desde Programaciones.
                            </p>
                        </div>
                    ) : (
                        <ScrollArea className="h-[400px]">
                            <div className="space-y-4">
                                {scheduledItems.map((item) => (
                                    <div key={item.id} className="flex items-center justify-between p-4 border rounded-lg">
                                        <div className="flex-1">
                                            <div className="flex flex-wrap items-center gap-2 mb-2">
                                                <h4 className="font-medium">{item.templateName}</h4>
                                                <Badge className={getPriorityColor(item.priority)}>
                                                    {({ LOW: "Baja", MEDIUM: "Media", HIGH: "Alta", URGENT: "Urgente" } as Record<string, string>)[item.priority] ?? "Sin prioridad"}
                                                </Badge>
                                                <Badge className={getStatusColor(item.status)}>
                                                    {({ PENDING: "Pendiente", NOTIFIED: "Notificada", STARTED: "En curso", IN_PROGRESS: "En curso", COMPLETED: "Completada", OVERDUE: "Vencida" } as Record<string, string>)[item.status] ?? "Por revisar"}
                                                </Badge>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                                                <div className="flex items-center gap-1">
                                                    <Clock className="h-4 w-4" />
                                                    Vence: {Number.isFinite(new Date(item.dueDate).getTime()) ? format(new Date(item.dueDate), 'dd MMM, HH:mm', { locale: es }) : "Sin fecha"}
                                                </div>
                                                {item.assigneeName && (
                                                    <div className="flex items-center gap-1">
                                                        <User className="h-4 w-4" />
                                                        {item.assigneeName}
                                                    </div>
                                                )}
                                                {item.branchName && (
                                                    <div className="flex items-center gap-1">
                                                        <Building className="h-4 w-4" />
                                                        {item.branchName}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
