"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
    AlertCircle,
    Calendar,
    User,
    FolderOpen,
    Building2,
    ChevronLeft,
    ChevronRight,
    ExternalLink,
    RotateCcw,
    Sparkles,
    ShieldAlert,
    Clock
} from "lucide-react";
import { format, isToday, subDays } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import Image from "next/image";

interface Evidence {
    id: string;
    type: "PHOTO" | "VIDEO" | "AUDIO" | "TEXT";
    url: string;
    workflowName: string;
    stepName: string;
    assigneeName: string;
    branchName: string;
    branchId?: string;
    createdAt: string | Date;
    aiVerified: boolean;
    aiScore?: number;
    aiReason?: string;
    workflowInstanceId: string;
    stepId: string;
}

interface EvidenceFilters {
    type?: string;
    verified?: string;
    branchId?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
}

interface Branch {
    id: string;
    name: string;
}

export default function EvidencePage() {
    const [evidences, setEvidences] = useState<Evidence[]>([]);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [loading, setLoading] = useState(true);
    const [filters, setFilters] = useState<EvidenceFilters>({});
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedEvidence, setSelectedEvidence] = useState<Evidence | null>(null);
    const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
    const [imageErrorMap, setImageErrorMap] = useState<Record<string, boolean>>({});

    // Fetch branches once on mount
    useEffect(() => {
        const fetchBranches = async () => {
            try {
                const res = await fetch("/api/branches");
                if (res.ok) {
                    const data = await res.json();
                    setBranches(data.data || data || []);
                }
            } catch (err) {
                console.error("Error fetching branches:", err);
            }
        };
        fetchBranches();
    }, []);

    // 300ms Debounce for text search
    useEffect(() => {
        const timer = setTimeout(() => {
            setFilters(prev => ({
                ...prev,
                search: searchTerm.trim() ? searchTerm.trim() : undefined
            }));
        }, 300);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    const fetchEvidences = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (filters.type) params.append("type", filters.type);
            if (filters.verified) params.append("verified", filters.verified);
            if (filters.branchId && filters.branchId !== "all") params.append("branchId", filters.branchId);
            if (filters.dateFrom) params.append("dateFrom", filters.dateFrom);
            if (filters.dateTo) params.append("dateTo", filters.dateTo);
            if (filters.search) params.append("search", filters.search);

            const response = await fetch(`/api/workflows/evidence?${params.toString()}`);
            if (response.ok) {
                const data = await response.json();
                setEvidences(data.data || []);
            } else {
                toast.error("Error al cargar evidencias");
            }
        } catch (error) {
            console.error("Failed to fetch evidences:", error);
            toast.error("Error de conexión al cargar evidencias");
        } finally {
            setLoading(false);
        }
    }, [filters]);

    useEffect(() => {
        fetchEvidences();
    }, [fetchEvidences]);

    // Modal navigation
    const currentIndex = useMemo(() => {
        if (!selectedEvidence) return -1;
        return evidences.findIndex(e => e.id === selectedEvidence.id);
    }, [evidences, selectedEvidence]);

    const handlePrevEvidence = useCallback(() => {
        if (currentIndex > 0) {
            setSelectedEvidence(evidences[currentIndex - 1]);
        }
    }, [currentIndex, evidences]);

    const handleNextEvidence = useCallback(() => {
        if (currentIndex >= 0 && currentIndex < evidences.length - 1) {
            setSelectedEvidence(evidences[currentIndex + 1]);
        }
    }, [currentIndex, evidences]);

    // Keyboard navigation inside modal
    useEffect(() => {
        if (!selectedEvidence) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "ArrowLeft") handlePrevEvidence();
            if (e.key === "ArrowRight") handleNextEvidence();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [selectedEvidence, handlePrevEvidence, handleNextEvidence]);

    const handleDownload = async (evidence: Evidence) => {
        if (!evidence.url) {
            toast.error("URL de evidencia no disponible");
            return;
        }
        try {
            await navigator.clipboard.writeText(evidence.url);
            toast.success("Enlace seguro copiado al portapapeles");
            window.open(evidence.url, "_blank");
        } catch {
            window.open(evidence.url, "_blank");
        }
    };

    const getTypeIcon = (type: Evidence["type"]) => {
        switch (type) {
            case "PHOTO":
                return <ImageIcon className="h-3.5 w-3.5" />;
            case "VIDEO":
                return <Video className="h-3.5 w-3.5" />;
            case "AUDIO":
                return <Mic className="h-3.5 w-3.5" />;
            case "TEXT":
                return <FileText className="h-3.5 w-3.5" />;
        }
    };

    const getInitials = (name?: string) => {
        if (!name || name.trim() === "") return "OP";
        const parts = name.trim().split(/\s+/);
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    };

    const clearFilters = () => {
        setSearchTerm("");
        setFilters({});
    };

    const hasFilters = Object.values(filters).some(v => v !== undefined && v !== "");

    // Quick presets
    const setPreset = (preset: "today" | "week" | "unverified" | "ai_approved") => {
        const todayStr = format(new Date(), "yyyy-MM-dd");
        const weekAgoStr = format(subDays(new Date(), 7), "yyyy-MM-dd");

        switch (preset) {
            case "today":
                setFilters(prev => ({ ...prev, dateFrom: todayStr, dateTo: todayStr, verified: undefined }));
                break;
            case "week":
                setFilters(prev => ({ ...prev, dateFrom: weekAgoStr, dateTo: todayStr, verified: undefined }));
                break;
            case "unverified":
                setFilters(prev => ({ ...prev, verified: "false", dateFrom: undefined, dateTo: undefined }));
                break;
            case "ai_approved":
                setFilters(prev => ({ ...prev, verified: "true", dateFrom: undefined, dateTo: undefined }));
                break;
        }
    };

    // Operational HORECA KPIs
    const stats = useMemo(() => {
        const total = evidences.length;
        const todayCount = evidences.filter(e => isToday(new Date(e.createdAt))).length;
        const verifiedCount = evidences.filter(e => e.aiVerified).length;
        const needsReviewCount = evidences.filter(e => !e.aiVerified || (e.aiScore !== undefined && e.aiScore < 70)).length;
        const uniqueBranches = new Set(evidences.map(e => e.branchName).filter(Boolean)).size;
        const verifiedPct = total > 0 ? Math.round((verifiedCount / total) * 100) : 0;

        return {
            total,
            todayCount,
            verifiedCount,
            verifiedPct,
            needsReviewCount,
            uniqueBranches
        };
    }, [evidences]);

    return (
        <div className="container mx-auto py-6 space-y-6 max-w-7xl">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                        Evidencias Operativas
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Control de calidad, checklists NOM-251 y registros fotográficos en sucursales
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant={viewMode === "grid" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setViewMode("grid")}
                        className="h-9 text-xs"
                    >
                        <ImageIcon className="h-4 w-4 mr-1.5" />
                        Cuadrícula
                    </Button>
                    <Button
                        variant={viewMode === "list" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setViewMode("list")}
                        className="h-9 text-xs"
                    >
                        <FolderOpen className="h-4 w-4 mr-1.5" />
                        Lista
                    </Button>
                </div>
            </div>

            {/* Operational HORECA KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 sm:gap-4">
                <Card className="border border-border bg-card">
                    <CardHeader className="p-4 pb-2">
                        <CardDescription className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            Total Registros
                        </CardDescription>
                        <CardTitle className="text-2xl font-bold tracking-tight text-foreground mt-1">
                            {stats.total}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        <p className="text-xs text-muted-foreground">En el periodo actual</p>
                    </CardContent>
                </Card>

                <Card className="border border-border bg-card">
                    <CardHeader className="p-4 pb-2">
                        <CardDescription className="text-xs font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5 text-primary" />
                            Evidencias Hoy
                        </CardDescription>
                        <CardTitle className="text-2xl font-bold tracking-tight text-foreground mt-1">
                            {stats.todayCount}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        <p className="text-xs text-muted-foreground">Turno activo en sucursales</p>
                    </CardContent>
                </Card>

                <Card className="border border-border bg-card">
                    <CardHeader className="p-4 pb-2">
                        <CardDescription className="text-xs font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                            <Sparkles className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                            Aprobación IA
                        </CardDescription>
                        <CardTitle className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400 mt-1">
                            {stats.verifiedPct}%
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        <p className="text-xs text-muted-foreground">{stats.verifiedCount} verificadas con éxito</p>
                    </CardContent>
                </Card>

                <Card className="border border-border bg-card">
                    <CardHeader className="p-4 pb-2">
                        <CardDescription className="text-xs font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                            <ShieldAlert className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                            Por Revisar
                        </CardDescription>
                        <CardTitle className="text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400 mt-1">
                            {stats.needsReviewCount}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        <p className="text-xs text-muted-foreground">Requieren atención humana</p>
                    </CardContent>
                </Card>

                <Card className="border border-border bg-card col-span-2 md:col-span-1">
                    <CardHeader className="p-4 pb-2">
                        <CardDescription className="text-xs font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                            Sucursales
                        </CardDescription>
                        <CardTitle className="text-2xl font-bold tracking-tight text-foreground mt-1">
                            {stats.uniqueBranches}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        <p className="text-xs text-muted-foreground">Con actividad reportada</p>
                    </CardContent>
                </Card>
            </div>

            {/* Quick Filter Presets */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
                <span className="text-muted-foreground font-medium shrink-0 flex items-center gap-1">
                    <Filter className="h-3 w-3" /> Presets:
                </span>
                <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs px-2.5 rounded-full"
                    onClick={() => setPreset("today")}
                >
                    Hoy
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs px-2.5 rounded-full"
                    onClick={() => setPreset("week")}
                >
                    Últimos 7 días
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs px-2.5 rounded-full border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
                    onClick={() => setPreset("unverified")}
                >
                    Por Revisar
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs px-2.5 rounded-full border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
                    onClick={() => setPreset("ai_approved")}
                >
                    Verificadas IA
                </Button>
                {hasFilters && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground"
                        onClick={clearFilters}
                    >
                        <RotateCcw className="h-3 w-3 mr-1" />
                        Limpiar
                    </Button>
                )}
            </div>

            {/* Filters Bar */}
            <Card className="border border-border bg-card">
                <CardContent className="p-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                        {/* Search Input */}
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Buscar</label>
                            <div className="relative">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Flujo, tarea, sucursal..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="pl-8 h-9 text-xs"
                                />
                            </div>
                        </div>

                        {/* Branch Filter */}
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Sucursal</label>
                            <Select
                                value={filters.branchId || "all"}
                                onValueChange={(val) => setFilters(prev => ({ ...prev, branchId: val === "all" ? undefined : val }))}
                            >
                                <SelectTrigger className="h-9 text-xs">
                                    <SelectValue placeholder="Todas las sucursales" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todas las sucursales</SelectItem>
                                    {branches.map(b => (
                                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* AI Verification Filter */}
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Estado IA</label>
                            <Select
                                value={filters.verified || "all"}
                                onValueChange={(val) => setFilters(prev => ({ ...prev, verified: val === "all" ? undefined : val }))}
                            >
                                <SelectTrigger className="h-9 text-xs">
                                    <SelectValue placeholder="Todos los estados" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todos los estados</SelectItem>
                                    <SelectItem value="true">Verificadas</SelectItem>
                                    <SelectItem value="false">Pendientes / Revisión</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Date From */}
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Fecha Desde</label>
                            <Input
                                type="date"
                                value={filters.dateFrom || ""}
                                onChange={(e) => setFilters(prev => ({ ...prev, dateFrom: e.target.value || undefined }))}
                                className="h-9 text-xs"
                            />
                        </div>

                        {/* Date To */}
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Fecha Hasta</label>
                            <Input
                                type="date"
                                value={filters.dateTo || ""}
                                onChange={(e) => setFilters(prev => ({ ...prev, dateTo: e.target.value || undefined }))}
                                className="h-9 text-xs"
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Content Area */}
            {loading ? (
                <div className="flex flex-col items-center justify-center py-16 space-y-3">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    <p className="text-xs text-muted-foreground">Cargando catálogo de evidencias...</p>
                </div>
            ) : evidences.length === 0 ? (
                <Card className="border border-border bg-card">
                    <CardContent className="flex flex-col items-center justify-center py-16 text-center space-y-3">
                        <div className="p-3 bg-muted rounded-full text-muted-foreground">
                            <ImageIcon className="h-8 w-8" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-foreground text-sm">No se encontraron evidencias</h3>
                            <p className="text-xs text-muted-foreground max-w-sm mt-1">
                                {hasFilters 
                                    ? "No hay registros que coincidan con los filtros seleccionados."
                                    : "Las evidencias fotográficas y de audio subidas en los checklists de las sucursales aparecerán aquí."}
                            </p>
                        </div>
                        {hasFilters && (
                            <Button variant="outline" size="sm" onClick={clearFilters} className="mt-2 text-xs">
                                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                                Restablecer filtros
                            </Button>
                        )}
                    </CardContent>
                </Card>
            ) : viewMode === "grid" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {evidences.map((evidence) => (
                        <div
                            key={evidence.id}
                            role="button"
                            tabIndex={0}
                            className="group text-left rounded-lg border border-border bg-card hover:border-foreground/20 transition-colors overflow-hidden flex flex-col cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40"
                            onClick={() => setSelectedEvidence(evidence)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    setSelectedEvidence(evidence);
                                }
                            }}
                        >
                            {/* Visual Thumbnail Frame */}
                            <div className="aspect-video relative bg-muted flex items-center justify-center overflow-hidden">
                                {evidence.type === "PHOTO" && (
                                    imageErrorMap[evidence.id] ? (
                                        <div className="flex flex-col items-center justify-center text-muted-foreground p-4 text-center">
                                            <ImageIcon className="h-8 w-8 mb-1 opacity-50" />
                                            <span className="text-xs">Imagen no disponible</span>
                                        </div>
                                    ) : (
                                        <Image
                                            src={evidence.url}
                                            alt={evidence.stepName}
                                            fill
                                            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 25vw"
                                            className="object-cover group-hover:scale-105 transition-transform duration-200"
                                            onError={() => setImageErrorMap(prev => ({ ...prev, [evidence.id]: true }))}
                                        />
                                    )
                                )}
                                {evidence.type === "VIDEO" && (
                                    <div className="flex flex-col items-center justify-center text-muted-foreground">
                                        <Video className="h-10 w-10 mb-1 text-foreground/70" />
                                        <span className="text-xs font-medium">Video</span>
                                    </div>
                                )}
                                {evidence.type === "AUDIO" && (
                                    <div className="flex flex-col items-center justify-center text-muted-foreground">
                                        <Mic className="h-10 w-10 mb-1 text-foreground/70" />
                                        <span className="text-xs font-medium">Audio Nota</span>
                                    </div>
                                )}
                                {evidence.type === "TEXT" && (
                                    <div className="flex flex-col items-center justify-center text-muted-foreground p-4 text-center">
                                        <FileText className="h-8 w-8 mb-1 opacity-60" />
                                        <span className="text-xs line-clamp-2">{evidence.stepName}</span>
                                    </div>
                                )}

                                {/* Top Badges */}
                                <div className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none">
                                    <Badge variant="secondary" className="text-xs px-2 py-0.5 bg-background/90 backdrop-blur-sm border-border text-foreground font-medium flex items-center gap-1 shadow-none">
                                        {getTypeIcon(evidence.type)}
                                        <span>{evidence.type}</span>
                                    </Badge>

                                    {evidence.aiVerified ? (
                                        <Badge className="text-xs px-2 py-0.5 bg-emerald-500/90 text-white border-0 font-medium flex items-center gap-1 shadow-none">
                                            <CheckCircle2 className="h-3 w-3" />
                                            {evidence.aiScore ? `${evidence.aiScore}%` : "IA"}
                                        </Badge>
                                    ) : (
                                        <Badge variant="outline" className="text-xs px-2 py-0.5 bg-background/90 backdrop-blur-sm border-amber-500/40 text-amber-700 dark:text-amber-300 font-medium flex items-center gap-1 shadow-none">
                                            <AlertCircle className="h-3 w-3 text-amber-600" />
                                            Revisión
                                        </Badge>
                                    )}
                                </div>
                            </div>

                            {/* Card Body */}
                            <div className="p-3.5 space-y-2 flex-1 flex flex-col justify-between">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                        <Building2 className="h-3 w-3 text-primary shrink-0" />
                                        <span className="font-medium text-foreground truncate">{evidence.branchName}</span>
                                    </div>
                                    <p className="text-sm font-semibold text-foreground line-clamp-1">
                                        {evidence.stepName}
                                    </p>
                                    <p className="text-xs text-muted-foreground line-clamp-1">
                                        {evidence.workflowName}
                                    </p>
                                </div>

                                <div className="pt-2 border-t border-border/60 flex items-center justify-between text-xs text-muted-foreground">
                                    <span className="flex items-center gap-1 text-xs">
                                        <Calendar className="h-3 w-3 opacity-70" />
                                        {format(new Date(evidence.createdAt), "dd MMM, HH:mm", { locale: es })}
                                    </span>
                                    <span className="flex items-center gap-1 font-medium text-xs bg-muted px-1.5 py-0.5 rounded">
                                        <User className="h-3 w-3 opacity-70" />
                                        {getInitials(evidence.assigneeName)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                /* List Mode */
                <Card className="border border-border bg-card">
                    <CardContent className="p-0">
                        <div className="divide-y divide-border">
                            {evidences.map((evidence) => (
                                <div
                                    key={evidence.id}
                                    role="button"
                                    tabIndex={0}
                                    className="flex items-center gap-4 p-3.5 hover:bg-muted/40 transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/40"
                                    onClick={() => setSelectedEvidence(evidence)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            setSelectedEvidence(evidence);
                                        }
                                    }}
                                >
                                    {/* Thumbnail box */}
                                    <div className="w-14 h-14 rounded-md bg-muted flex items-center justify-center shrink-0 overflow-hidden relative border border-border">
                                        {evidence.type === "PHOTO" && !imageErrorMap[evidence.id] ? (
                                            <Image
                                                src={evidence.url}
                                                alt={evidence.stepName}
                                                fill
                                                className="object-cover"
                                                onError={() => setImageErrorMap(prev => ({ ...prev, [evidence.id]: true }))}
                                            />
                                        ) : (
                                            getTypeIcon(evidence.type)
                                        )}
                                    </div>

                                    {/* Info */}
                                    <div className="flex-1 min-w-0 space-y-0.5">
                                        <div className="flex items-center gap-2">
                                            <p className="font-semibold text-sm text-foreground truncate">
                                                {evidence.stepName}
                                            </p>
                                            <Badge variant="outline" className="text-xs px-1.5 py-0 bg-muted/50 border-border text-muted-foreground">
                                                {evidence.type}
                                            </Badge>
                                            {evidence.aiVerified ? (
                                                <Badge className="text-xs px-1.5 py-0 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-0 font-medium">
                                                    <CheckCircle2 className="h-2.5 w-2.5 mr-1 text-emerald-600" />
                                                    {evidence.aiScore ? `${evidence.aiScore}%` : "Aprobada"}
                                                </Badge>
                                            ) : (
                                                <Badge variant="outline" className="text-xs px-1.5 py-0 border-amber-500/40 text-amber-700 dark:text-amber-300 font-medium">
                                                    <AlertCircle className="h-2.5 w-2.5 mr-1 text-amber-600" />
                                                    Por Revisar
                                                </Badge>
                                            )}
                                        </div>

                                        <p className="text-xs text-muted-foreground truncate">
                                            {evidence.workflowName}
                                        </p>

                                        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground pt-0.5">
                                            <span className="flex items-center gap-1 font-medium text-foreground">
                                                <Building2 className="h-3 w-3 text-primary" />
                                                {evidence.branchName}
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <User className="h-3 w-3" />
                                                {evidence.assigneeName}
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <Calendar className="h-3 w-3" />
                                                {format(new Date(evidence.createdAt), "dd MMM yyyy, HH:mm", { locale: es })}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Action button */}
                                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground">
                                        <Eye className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Inspection & Audit Modal */}
            {selectedEvidence && (
                <Dialog open={!!selectedEvidence} onOpenChange={() => setSelectedEvidence(null)}>
                    <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto border-border bg-card">
                        <DialogHeader className="flex flex-row items-center justify-between pb-2 border-b border-border">
                            <div className="space-y-0.5">
                                <DialogTitle className="text-lg font-bold text-foreground">
                                    {selectedEvidence.stepName}
                                </DialogTitle>
                                <DialogDescription className="text-xs text-muted-foreground">
                                    {selectedEvidence.workflowName}
                                </DialogDescription>
                            </div>
                            
                            {/* Next / Previous Navigator */}
                            <div className="flex items-center gap-1 mr-6">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 w-8 p-0"
                                    onClick={handlePrevEvidence}
                                    disabled={currentIndex <= 0}
                                    title="Evidencia anterior (←)"
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <span className="text-xs font-mono text-muted-foreground px-1">
                                    {currentIndex + 1} / {evidences.length}
                                </span>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 w-8 p-0"
                                    onClick={handleNextEvidence}
                                    disabled={currentIndex >= evidences.length - 1}
                                    title="Siguiente evidencia (→)"
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </DialogHeader>

                        <div className="space-y-4 pt-2">
                            {/* Media Viewer */}
                            <div className="rounded-lg overflow-hidden bg-muted/60 border border-border aspect-video flex items-center justify-center relative">
                                {selectedEvidence.type === "PHOTO" && (
                                    imageErrorMap[selectedEvidence.id] ? (
                                        <div className="text-center p-6 text-muted-foreground">
                                            <ImageIcon className="h-10 w-10 mx-auto mb-2 opacity-50" />
                                            <p className="text-xs font-medium">No se pudo cargar la imagen remota.</p>
                                        </div>
                                    ) : (
                                        <Image
                                            src={selectedEvidence.url}
                                            alt={selectedEvidence.stepName}
                                            width={1000}
                                            height={700}
                                            className="object-contain max-h-[420px] w-auto h-auto"
                                            onError={() => setImageErrorMap(prev => ({ ...prev, [selectedEvidence.id]: true }))}
                                        />
                                    )
                                )}
                                {selectedEvidence.type === "VIDEO" && (
                                    <video src={selectedEvidence.url} controls className="max-h-[420px] w-full" />
                                )}
                                {selectedEvidence.type === "AUDIO" && (
                                    <div className="p-6 w-full max-w-md">
                                        <audio src={selectedEvidence.url} controls className="w-full" />
                                    </div>
                                )}
                                {selectedEvidence.type === "TEXT" && (
                                    <div className="p-6 text-xs text-foreground bg-card rounded-md max-w-lg shadow-sm border border-border">
                                        {selectedEvidence.url}
                                    </div>
                                )}
                            </div>

                            {/* Meta Grid */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-muted/30 p-3 rounded-lg border border-border">
                                <div className="space-y-0.5">
                                    <p className="text-muted-foreground">Sucursal</p>
                                    <p className="font-semibold text-foreground flex items-center gap-1">
                                        <Building2 className="h-3 w-3 text-primary" />
                                        {selectedEvidence.branchName}
                                    </p>
                                </div>
                                <div className="space-y-0.5">
                                    <p className="text-muted-foreground">Registrado por</p>
                                    <p className="font-semibold text-foreground">{selectedEvidence.assigneeName}</p>
                                </div>
                                <div className="space-y-0.5">
                                    <p className="text-muted-foreground">Fecha y Hora</p>
                                    <p className="font-semibold text-foreground">
                                        {format(new Date(selectedEvidence.createdAt), "dd MMM yyyy, HH:mm", { locale: es })}
                                    </p>
                                </div>
                                <div className="space-y-0.5">
                                    <p className="text-muted-foreground">Estado IA</p>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                        {selectedEvidence.aiVerified ? (
                                            <Badge className="text-xs px-1.5 py-0 bg-emerald-500 text-white border-0 font-medium">
                                                <CheckCircle2 className="h-2.5 w-2.5 mr-1" />
                                                {selectedEvidence.aiScore ? `${selectedEvidence.aiScore}%` : "Aprobada"}
                                            </Badge>
                                        ) : (
                                            <Badge variant="outline" className="text-xs px-1.5 py-0 border-amber-500/40 text-amber-700 dark:text-amber-300 font-medium">
                                                <AlertCircle className="h-2.5 w-2.5 mr-1 text-amber-600" />
                                                Por Revisar
                                            </Badge>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* AI Reason explanation */}
                            {selectedEvidence.aiReason && (
                                <div className="space-y-1">
                                    <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                                        <Sparkles className="h-3.5 w-3.5 text-primary" />
                                        Dictamen de Inteligencia Artificial (NOM-251 / Checklist)
                                    </p>
                                    <div className="p-3 bg-muted/50 rounded-lg text-xs text-foreground/90 border border-border leading-relaxed">
                                        {selectedEvidence.aiReason}
                                    </div>
                                </div>
                            )}

                            {/* Action Buttons */}
                            <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-border">
                                <Button
                                    variant="outline"
                                    className="flex-1 h-9 text-xs"
                                    onClick={() => handleDownload(selectedEvidence)}
                                >
                                    <Download className="h-3.5 w-3.5 mr-1.5" />
                                    Descargar / Abrir Archivo
                                </Button>
                                <Button
                                    variant="default"
                                    className="flex-1 h-9 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                                    onClick={() => window.open(`/dashboard/workflows/${selectedEvidence.workflowInstanceId}/execute`, "_blank")}
                                >
                                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                                    Abrir Workflow Origen
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            )}
        </div>
    );
}
