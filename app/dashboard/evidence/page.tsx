"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { 
    Image as ImageIcon, 
    Video, 
    Mic, 
    FileText, 
    Search, 
    Filter,
    Download,
    Eye,
    CheckCircle2,
    XCircle,
    AlertCircle,
    Calendar,
    User,
    FolderOpen
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import Image from "next/image";
import { cn } from "@/lib/utils";

interface Evidence {
    id: string;
    type: "PHOTO" | "VIDEO" | "AUDIO" | "TEXT";
    url: string;
    workflowName: string;
    stepName: string;
    assigneeName: string;
    branchName: string;
    createdAt: Date;
    aiVerified: boolean;
    aiScore?: number;
    aiReason?: string;
    workflowInstanceId: string;
    stepId: string;
}

interface EvidenceFilters {
    type?: string;
    verified?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
}

export default function EvidencePage() {
    const [evidences, setEvidences] = useState<Evidence[]>([]);
    const [loading, setLoading] = useState(true);
    const [filters, setFilters] = useState<EvidenceFilters>({});
    const [selectedEvidence, setSelectedEvidence] = useState<Evidence | null>(null);
    const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

    useEffect(() => {
        fetchEvidences();
    }, [filters]);

    const fetchEvidences = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (filters.type) params.append("type", filters.type);
            if (filters.verified) params.append("verified", filters.verified);
            if (filters.dateFrom) params.append("dateFrom", filters.dateFrom);
            if (filters.dateTo) params.append("dateTo", filters.dateTo);
            if (filters.search) params.append("search", filters.search);

            const response = await fetch(`/api/workflows/evidence?${params}`);
            if (response.ok) {
                const data = await response.json();
                setEvidences(data.data || []);
            }
        } catch (error) {
            console.error("Failed to fetch evidences:", error);
            toast.error("Error al cargar evidencias");
        } finally {
            setLoading(false);
        }
    };

    const getTypeIcon = (type: Evidence["type"]) => {
        switch (type) {
            case "PHOTO":
                return <ImageIcon className="h-4 w-4" />;
            case "VIDEO":
                return <Video className="h-4 w-4" />;
            case "AUDIO":
                return <Mic className="h-4 w-4" />;
            case "TEXT":
                return <FileText className="h-4 w-4" />;
        }
    };

    const getTypeColor = (type: Evidence["type"]) => {
        switch (type) {
            case "PHOTO":
                return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100";
            case "VIDEO":
                return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-100";
            case "AUDIO":
                return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100";
            case "TEXT":
                return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-100";
        }
    };

    const clearFilters = () => {
        setFilters({});
    };

    const hasFilters = Object.values(filters).some(v => v !== undefined && v !== "");

    const stats = {
        total: evidences.length,
        photos: evidences.filter(e => e.type === "PHOTO").length,
        videos: evidences.filter(e => e.type === "VIDEO").length,
        audios: evidences.filter(e => e.type === "AUDIO").length,
        verified: evidences.filter(e => e.aiVerified).length,
    };

    return (
        <div className="container mx-auto py-8 space-y-8">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold">Galería de Evidencias</h1>
                    <p className="text-muted-foreground mt-1">
                        Todas las evidencias subidas en los flujos de trabajo
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant={viewMode === "grid" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setViewMode("grid")}
                    >
                        <ImageIcon className="h-4 w-4 mr-2" />
                        Cuadrícula
                    </Button>
                    <Button
                        variant={viewMode === "list" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setViewMode("list")}
                    >
                        <FolderOpen className="h-4 w-4 mr-2" />
                        Lista
                    </Button>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid gap-4 md:grid-cols-5">
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription>Total</CardDescription>
                        <CardTitle className="text-3xl">{stats.total}</CardTitle>
                    </CardHeader>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription className="flex items-center gap-2">
                            <ImageIcon className="h-4 w-4" />
                            Fotos
                        </CardDescription>
                        <CardTitle className="text-3xl text-blue-600">{stats.photos}</CardTitle>
                    </CardHeader>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription className="flex items-center gap-2">
                            <Video className="h-4 w-4" />
                            Videos
                        </CardDescription>
                        <CardTitle className="text-3xl font-bold">{stats.videos}</CardTitle>
                    </CardHeader>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription className="flex items-center gap-2">
                            <Mic className="h-4 w-4" />
                            Audios
                        </CardDescription>
                        <CardTitle className="text-3xl text-orange-600">{stats.audios}</CardTitle>
                    </CardHeader>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4" />
                            Verificadas
                        </CardDescription>
                        <CardTitle className="text-3xl text-green-600">{stats.verified}</CardTitle>
                    </CardHeader>
                </Card>
            </div>

            {/* Filters */}
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Filter className="h-4 w-4" />
                            <CardTitle className="text-base">Filtros</CardTitle>
                        </div>
                        {hasFilters && (
                            <Button variant="ghost" size="sm" onClick={clearFilters}>
                                Limpiar filtros
                            </Button>
                        )}
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Buscar</label>
                            <div className="relative">
                                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Workflow o step..."
                                    value={filters.search || ""}
                                    onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                                    className="pl-8"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Tipo</label>
                            <Select
                                value={filters.type || "all"}
                                onValueChange={(value) =>
                                    setFilters({ ...filters, type: value === "all" ? undefined : value })
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Todos los tipos" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todos los tipos</SelectItem>
                                    <SelectItem value="PHOTO">Fotos</SelectItem>
                                    <SelectItem value="VIDEO">Videos</SelectItem>
                                    <SelectItem value="AUDIO">Audios</SelectItem>
                                    <SelectItem value="TEXT">Texto</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Verificación AI</label>
                            <Select
                                value={filters.verified || "all"}
                                onValueChange={(value) =>
                                    setFilters({ ...filters, verified: value === "all" ? undefined : value })
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Todas" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todas</SelectItem>
                                    <SelectItem value="true">Verificadas</SelectItem>
                                    <SelectItem value="false">No verificadas</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Fecha desde</label>
                            <Input
                                type="date"
                                value={filters.dateFrom || ""}
                                onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Fecha hasta</label>
                            <Input
                                type="date"
                                value={filters.dateTo || ""}
                                onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Evidence Grid/List */}
            {loading ? (
                <div className="flex items-center justify-center py-12">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                </div>
            ) : evidences.length === 0 ? (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                        <ImageIcon className="h-12 w-12 text-muted-foreground mb-4" />
                        <p className="text-muted-foreground">
                            No se encontraron evidencias con los filtros seleccionados
                        </p>
                    </CardContent>
                </Card>
            ) : viewMode === "grid" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {evidences.map((evidence) => (
                        <Card
                            key={evidence.id}
                            className="overflow-hidden cursor-pointer hover:shadow-lg transition-shadow"
                            onClick={() => setSelectedEvidence(evidence)}
                        >
                            <div className="aspect-square relative bg-muted">
                                {evidence.type === "PHOTO" && (
                                    <Image
                                        src={evidence.url}
                                        alt={evidence.stepName}
                                        fill
                                        className="object-cover"
                                    />
                                )}
                                {evidence.type === "VIDEO" && (
                                    <div className="flex items-center justify-center h-full">
                                        <Video className="h-12 w-12 text-muted-foreground" />
                                    </div>
                                )}
                                {evidence.type === "AUDIO" && (
                                    <div className="flex items-center justify-center h-full">
                                        <Mic className="h-12 w-12 text-muted-foreground" />
                                    </div>
                                )}
                                {evidence.type === "TEXT" && (
                                    <div className="flex items-center justify-center h-full">
                                        <FileText className="h-12 w-12 text-muted-foreground" />
                                    </div>
                                )}
                                {evidence.aiVerified && (
                                    <Badge className="absolute top-2 right-2 bg-green-500">
                                        <CheckCircle2 className="h-3 w-3 mr-1" />
                                        AI
                                    </Badge>
                                )}
                            </div>
                            <CardContent className="p-3 space-y-2">
                                <div className="flex items-center gap-2">
                                    <Badge variant="outline" className={cn("text-xs", getTypeColor(evidence.type))}>
                                        {getTypeIcon(evidence.type)}
                                        <span className="ml-1">{evidence.type}</span>
                                    </Badge>
                                </div>
                                <p className="text-sm font-medium line-clamp-1">{evidence.stepName}</p>
                                <p className="text-xs text-muted-foreground line-clamp-1">{evidence.workflowName}</p>
                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                    <span className="flex items-center gap-1">
                                        <Calendar className="h-3 w-3" />
                                        {format(new Date(evidence.createdAt), "dd MMM", { locale: es })}
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <User className="h-3 w-3" />
                                        {evidence.assigneeName.split(" ").map(n => n[0]).join("").slice(0, 2)}
                                    </span>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            ) : (
                <Card>
                    <CardContent className="p-0">
                        <div className="divide-y">
                            {evidences.map((evidence) => (
                                <div
                                    key={evidence.id}
                                    className="flex items-center gap-4 p-4 hover:bg-muted/50 cursor-pointer"
                                    onClick={() => setSelectedEvidence(evidence)}
                                >
                                    <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center shrink-0">
                                        {getTypeIcon(evidence.type)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <p className="font-medium truncate">{evidence.stepName}</p>
                                            <Badge variant="outline" className={cn("text-xs", getTypeColor(evidence.type))}>
                                                {evidence.type}
                                            </Badge>
                                            {evidence.aiVerified && (
                                                <Badge className="bg-green-500 text-xs">
                                                    <CheckCircle2 className="h-3 w-3 mr-1" />
                                                    AI
                                                </Badge>
                                            )}
                                        </div>
                                        <p className="text-sm text-muted-foreground truncate">{evidence.workflowName}</p>
                                        <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                                            <span className="flex items-center gap-1">
                                                <User className="h-3 w-3" />
                                                {evidence.assigneeName}
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <Calendar className="h-3 w-3" />
                                                {format(new Date(evidence.createdAt), "dd MMM yyyy", { locale: es })}
                                            </span>
                                        </div>
                                    </div>
                                    <Button variant="ghost" size="sm">
                                        <Eye className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Detail Dialog */}
            {selectedEvidence && (
                <Dialog open={!!selectedEvidence} onOpenChange={() => setSelectedEvidence(null)}>
                    <DialogContent className="max-w-3xl">
                        <DialogHeader>
                            <DialogTitle>{selectedEvidence.stepName}</DialogTitle>
                            <DialogDescription>
                                {selectedEvidence.workflowName}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                            <div className="rounded-lg overflow-hidden bg-muted aspect-video flex items-center justify-center">
                                {selectedEvidence.type === "PHOTO" && (
                                    <Image
                                        src={selectedEvidence.url}
                                        alt={selectedEvidence.stepName}
                                        width={800}
                                        height={600}
                                        className="object-contain max-h-[400px]"
                                    />
                                )}
                                {selectedEvidence.type === "VIDEO" && (
                                    <video src={selectedEvidence.url} controls className="max-h-[400px]" />
                                )}
                                {selectedEvidence.type === "AUDIO" && (
                                    <audio src={selectedEvidence.url} controls className="w-full" />
                                )}
                                {selectedEvidence.type === "TEXT" && (
                                    <div className="p-4 text-sm">{selectedEvidence.url}</div>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <p className="text-muted-foreground">Asignado a</p>
                                    <p className="font-medium">{selectedEvidence.assigneeName}</p>
                                </div>
                                <div>
                                    <p className="text-muted-foreground">Sucursal</p>
                                    <p className="font-medium">{selectedEvidence.branchName}</p>
                                </div>
                                <div>
                                    <p className="text-muted-foreground">Fecha</p>
                                    <p className="font-medium">
                                        {format(new Date(selectedEvidence.createdAt), "dd MMMM yyyy 'a las' HH:mm", { locale: es })}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-muted-foreground">Verificación AI</p>
                                    <div className="flex items-center gap-2">
                                        {selectedEvidence.aiVerified ? (
                                            <Badge className="bg-green-500">
                                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                                Aprobada
                                            </Badge>
                                        ) : (
                                            <Badge variant="outline">
                                                <AlertCircle className="h-3 w-3 mr-1" />
                                                Pendiente
                                            </Badge>
                                        )}
                                        {selectedEvidence.aiScore && (
                                            <span className="font-medium">{selectedEvidence.aiScore}%</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                            {selectedEvidence.aiReason && (
                                <div>
                                    <p className="text-muted-foreground mb-2">Comentario de IA</p>
                                    <div className="p-3 bg-muted rounded-lg text-sm">
                                        {selectedEvidence.aiReason}
                                    </div>
                                </div>
                            )}
                            <div className="flex gap-2 pt-4">
                                <Button variant="outline" className="flex-1">
                                    <Download className="h-4 w-4 mr-2" />
                                    Descargar
                                </Button>
                                <Button
                                    variant="outline"
                                    className="flex-1"
                                    onClick={() => window.open(`/dashboard/workflows/${selectedEvidence.workflowInstanceId}/execute`, "_blank")}
                                >
                                    <Eye className="h-4 w-4 mr-2" />
                                    Ver Workflow
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            )}
        </div>
    );
}
