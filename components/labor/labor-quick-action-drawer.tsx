"use client";

import React, { useState, useEffect } from "react";
import { 
    Sheet, 
    SheetContent, 
    SheetHeader, 
    SheetTitle, 
    SheetDescription,
    SheetTrigger 
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
    AlertTriangle, 
    CheckCircle2, 
    XCircle, 
    CheckSquare, 
    ArrowLeftRight, 
    Calendar, 
    Clock, 
    ChevronRight,
    Zap,
    Users,
    Shield
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

interface LaborQuickActionDrawerProps {
    pendingApprovalsCount: number;
    pendingSwapsCount: number;
    pendingLeaveCount: number;
    incidentCount: number;
}

export function LaborQuickActionDrawer({
    pendingApprovalsCount,
    pendingSwapsCount,
    pendingLeaveCount,
    incidentCount
}: LaborQuickActionDrawerProps) {
    const [openDrawer, setOpenDrawer] = useState<"approvals" | "swaps" | "leave" | null>(null);
    const [isActioning, setIsActioning] = useState<string | null>(null);

    // Keyboard shortcut (Alt+A or Cmd+A) to trigger quick approvals
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.altKey) && e.key.toLowerCase() === 'a') {
                e.preventDefault();
                setOpenDrawer("approvals");
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

    const totalUrgent = pendingApprovalsCount + pendingSwapsCount + pendingLeaveCount + incidentCount;

    return (
        <div className="space-y-4">
            {/* Operational Command Banner */}
            {totalUrgent > 0 ? (
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-lg border border-amber-500/30 bg-amber-500/5 transition-all">
                    <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0 text-amber-600">
                            <AlertTriangle className="h-5 w-5" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="text-sm font-semibold text-foreground">
                                    Atención Requerida en Operación
                                </h3>
                                <Badge variant="outline" className="border-amber-500/40 text-amber-700 bg-amber-500/10 text-xs font-semibold px-2">
                                    {totalUrgent} pendientes
                                </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                {pendingApprovalsCount > 0 && `${pendingApprovalsCount} aprobaciones turnos`}
                                {pendingSwapsCount > 0 && ` • ${pendingSwapsCount} intercambios de personal`}
                                {pendingLeaveCount > 0 && ` • ${pendingLeaveCount} permisos por revisar`}
                                {incidentCount > 0 && ` • ${incidentCount} incidencias activas`}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <Button 
                            variant="default" 
                            size="sm" 
                            onClick={() => setOpenDrawer("approvals")}
                            className="w-full sm:w-auto gap-1.5 text-xs font-medium"
                        >
                            <Zap className="h-3.5 w-3.5" />
                            Acción Rápida
                            <kbd className="hidden md:inline-flex ml-1 px-1.5 py-0.5 text-xs bg-primary-foreground/20 rounded font-mono">
                                Alt+A
                            </kbd>
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/20">
                    <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        <span>Sin pendientes críticos. Toda la operación de personal está al día.</span>
                    </div>
                    <Badge variant="outline" className="text-xs text-muted-foreground font-normal">
                        Al día
                    </Badge>
                </div>
            )}

            {/* Quick Action Drawer (Sheet) */}
            <Sheet open={openDrawer !== null} onOpenChange={(open) => !open && setOpenDrawer(null)}>
                <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
                    <SheetHeader className="pb-4 border-b border-border">
                        <SheetTitle className="flex items-center gap-2 text-base font-semibold">
                            <CheckSquare className="h-4 w-4 text-primary" />
                            Panel de Aprobación Rápida
                        </SheetTitle>
                        <SheetDescription className="text-xs">
                            Revisa y resuelve solicitudes operativas sin salir del dashboard
                        </SheetDescription>
                    </SheetHeader>

                    {/* Tab Selection */}
                    <div className="flex border-b border-border my-4 gap-2">
                        <Button
                            variant={openDrawer === "approvals" ? "secondary" : "ghost"}
                            size="sm"
                            className="text-xs h-8"
                            onClick={() => setOpenDrawer("approvals")}
                        >
                            Aprobaciones Turno ({pendingApprovalsCount})
                        </Button>
                        <Button
                            variant={openDrawer === "swaps" ? "secondary" : "ghost"}
                            size="sm"
                            className="text-xs h-8"
                            onClick={() => setOpenDrawer("swaps")}
                        >
                            Intercambios ({pendingSwapsCount})
                        </Button>
                        <Button
                            variant={openDrawer === "leave" ? "secondary" : "ghost"}
                            size="sm"
                            className="text-xs h-8"
                            onClick={() => setOpenDrawer("leave")}
                        >
                            Permisos ({pendingLeaveCount})
                        </Button>
                    </div>

                    {/* Content Views */}
                    {openDrawer === "approvals" && (
                        <div className="space-y-3">
                            {pendingApprovalsCount === 0 ? (
                                <div className="text-center py-8 text-xs text-muted-foreground">
                                    <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto mb-2 opacity-60" />
                                    No hay solicitudes de turno pendientes de aprobación.
                                </div>
                            ) : (
                                <div className="p-3 border rounded-lg bg-card space-y-3">
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="font-semibold text-foreground">Solicitud de Turno Extra</span>
                                        <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">Pendiente</Badge>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Turno adicional solicitado por supervisión de cocina para cubrir pico de fin de semana.
                                    </p>
                                    <div className="flex items-center justify-between pt-2 border-t border-border">
                                        <Button variant="outline" size="sm" asChild className="text-xs">
                                            <Link href="/dashboard/labor/approvals">
                                                Ver detalle completo <ChevronRight className="h-3 w-3 ml-1" />
                                            </Link>
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {openDrawer === "swaps" && (
                        <div className="space-y-3">
                            {pendingSwapsCount === 0 ? (
                                <div className="text-center py-8 text-xs text-muted-foreground">
                                    <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto mb-2 opacity-60" />
                                    No hay solicitudes de intercambio de turno pendientes.
                                </div>
                            ) : (
                                <div className="p-3 border rounded-lg bg-card space-y-3">
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="font-semibold text-foreground">Intercambio entre Meseros</span>
                                        <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">Pendiente</Badge>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Cambio voluntario de horario entre turno matutino y vespertino.
                                    </p>
                                    <div className="flex items-center justify-between pt-2 border-t border-border">
                                        <Button variant="outline" size="sm" asChild className="text-xs">
                                            <Link href="/dashboard/labor/shift-changes">
                                                Gestión de Cambios <ChevronRight className="h-3 w-3 ml-1" />
                                            </Link>
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {openDrawer === "leave" && (
                        <div className="space-y-3">
                            {pendingLeaveCount === 0 ? (
                                <div className="text-center py-8 text-xs text-muted-foreground">
                                    <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto mb-2 opacity-60" />
                                    No hay solicitudes de permiso sin revisar.
                                </div>
                            ) : (
                                <div className="p-3 border rounded-lg bg-card space-y-3">
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="font-semibold text-foreground">Permiso Personal</span>
                                        <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">Pendiente</Badge>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Solicitud de salida anticipada con justificación médica.
                                    </p>
                                    <div className="flex items-center justify-between pt-2 border-t border-border">
                                        <Button variant="outline" size="sm" asChild className="text-xs">
                                            <Link href="/dashboard/labor/leave">
                                                Revisar Permisos <ChevronRight className="h-3 w-3 ml-1" />
                                            </Link>
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </SheetContent>
            </Sheet>
        </div>
    );
}
