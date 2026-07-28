"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { CheckCircle2, Clock, XCircle, Search, Eye, Play, AlertCircle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

interface WorkflowInstance {
    id: string;
    templateName: string;
    status: string | null;
    score: number | null;
    assigneeName: string | null;
    updatedAt: Date | null;
}

interface RecentWorkflowsTableProps {
    workflows: WorkflowInstance[];
}

export function RecentWorkflowsTable({ workflows }: RecentWorkflowsTableProps) {
    const [searchQuery, setSearchQuery] = useState("");

    const filteredWorkflows = workflows.filter((w) => {
        const query = searchQuery.toLowerCase();
        return (
            w.templateName.toLowerCase().includes(query) ||
            (w.assigneeName && w.assigneeName.toLowerCase().includes(query))
        );
    });

    const getStatusBadge = (status: string | null) => {
        switch (status) {
            case "COMPLETED":
                return (
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 gap-1 font-medium">
                        <CheckCircle2 className="w-3 h-3" /> Completado
                    </Badge>
                );
            case "IN_PROGRESS":
                return (
                    <Badge variant="outline" className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 gap-1 font-medium">
                        <Clock className="w-3 h-3" /> En Progreso
                    </Badge>
                );
            case "PENDING":
                return (
                    <Badge variant="outline" className="bg-muted text-muted-foreground gap-1 font-medium">
                        <Clock className="w-3 h-3" /> Pendiente
                    </Badge>
                );
            case "BLOCKED":
                return (
                    <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 gap-1 font-medium">
                        <XCircle className="w-3 h-3" /> Bloqueado
                    </Badge>
                );
            default:
                return <Badge variant="secondary">{status}</Badge>;
        }
    };

    const getScoreColor = (score: number | null) => {
        if (score === null) return "text-muted-foreground";
        if (score >= 90) return "text-emerald-600 dark:text-emerald-400 font-bold";
        if (score >= 70) return "text-amber-600 dark:text-amber-400 font-bold";
        return "text-destructive font-bold";
    };

    const renderActionButton = (workflow: WorkflowInstance) => {
        switch (workflow.status) {
            case "COMPLETED":
                return (
                    <Link href={`/dashboard/workflows/review/${workflow.id}`}>
                        <Button variant="ghost" size="sm" className="h-8 text-xs gap-1">
                            <Eye className="w-3.5 h-3.5" /> Ver detalles
                        </Button>
                    </Link>
                );
            case "IN_PROGRESS":
                return (
                    <Link href={`/dashboard/workflows/${workflow.id}/execute`}>
                        <Button variant="default" size="sm" className="h-8 text-xs gap-1">
                            <Play className="w-3.5 h-3.5" /> Continuar
                        </Button>
                    </Link>
                );
            case "PENDING":
                return (
                    <Link href={`/dashboard/workflows/${workflow.id}/execute`}>
                        <Button variant="outline" size="sm" className="h-8 text-xs gap-1">
                            <Play className="w-3.5 h-3.5" /> Iniciar
                        </Button>
                    </Link>
                );
            case "BLOCKED":
            case "FAILED":
                return (
                    <Link href={`/dashboard/workflows/review/${workflow.id}`}>
                        <Button variant="outline" size="sm" className="h-8 text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/10">
                            <AlertCircle className="w-3.5 h-3.5" /> Revisar
                        </Button>
                    </Link>
                );
            default:
                return (
                    <Link href={`/dashboard/workflows/${workflow.id}/execute`}>
                        <Button variant="ghost" size="sm" className="h-8 text-xs gap-1">
                            <Eye className="w-3.5 h-3.5" /> Ver
                        </Button>
                    </Link>
                );
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center px-4 pt-3 pb-1">
                <div className="relative w-full sm:w-72">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        type="search"
                        placeholder="Buscar flujo o responsable..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-8 h-9 text-xs"
                    />
                </div>
            </div>
            <div className="border-t border-border">
                <Table>
                    <TableHeader>
                        <TableRow className="hover:bg-transparent border-b border-border">
                            <TableHead className="text-xs font-semibold uppercase tracking-wider">Flujo de Trabajo</TableHead>
                            <TableHead className="text-xs font-semibold uppercase tracking-wider">Estado</TableHead>
                            <TableHead className="text-xs font-semibold uppercase tracking-wider">Calificación</TableHead>
                            <TableHead className="text-xs font-semibold uppercase tracking-wider">Asignado a</TableHead>
                            <TableHead className="text-xs font-semibold uppercase tracking-wider">Actualizado</TableHead>
                            <TableHead className="text-right text-xs font-semibold uppercase tracking-wider">Acciones</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredWorkflows.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground text-sm">
                                    {searchQuery ? "No se encontraron flujos coincidentes." : "No hay actividad reciente."}
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredWorkflows.map((workflow) => (
                                <TableRow key={workflow.id} className="hover:bg-muted/30 border-b border-border">
                                    <TableCell className="font-medium text-sm">
                                        {workflow.templateName}
                                    </TableCell>
                                    <TableCell>{getStatusBadge(workflow.status)}</TableCell>
                                    <TableCell className={getScoreColor(workflow.score)}>
                                        {workflow.score !== null ? `${workflow.score}%` : "-"}
                                    </TableCell>
                                    <TableCell className="text-sm">{workflow.assigneeName || "Sin asignar"}</TableCell>
                                    <TableCell className="text-muted-foreground text-xs font-mono">
                                        {workflow.updatedAt
                                            ? formatDistanceToNow(new Date(workflow.updatedAt), { addSuffix: true, locale: es })
                                            : "-"}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {renderActionButton(workflow)}
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
