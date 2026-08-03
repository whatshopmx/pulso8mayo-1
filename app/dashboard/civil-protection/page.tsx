"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, PageContainer, EmptyState, KpiCard, KpiGrid } from "@/components/shared";
import {
    Plus,
    ShieldCheck,
    Flame,
    DoorOpen,
    AlertTriangle,
    CheckCircle2,
    Clock,
    RefreshCw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ============================================
// Tipos (espejo del schema)
// ============================================

interface Drill {
    id: string;
    branchId: string;
    drillType: string;
    result: string | null;
    drillDate: string;
    participantsCount: number | null;
    evacuationTimeSec: number | null;
    activatedAlarm: boolean | null;
    observations: string | null;
    coordinatorName: string | null;
}

interface Extinguisher {
    id: string;
    branchId: string;
    extinguisherId: string;
    location: string;
    extinguisherType: string | null;
    capacityKg: number | null;
    inspectionDate: string;
    generalStatus: string | null;
    expirationDate: string | null;
    nextInspectionDate: string | null;
    inspectorName: string | null;
    ocrProcessedAt: string | null;
}

interface ExitItem {
    id: string;
    branchId: string;
    exitLocation: string;
    isClear: boolean;
    signageOk: boolean;
    emergencyLightOk: boolean;
    doorOpensOk: boolean;
    accessWidthCm: number | null;
    inspectedAt: string;
    inspectionRound: string | null;
    notes: string | null;
}

interface Branch {
    id: string;
    name: string;
}

interface Kpis {
    drillsTotal: number;
    drillsLastDate: string | null;
    extinguishersTotal: number;
    extinguishersExpiringSoon: number;
    extinguishersExpired: number;
    exitsLastInspection: string | null;
    exitsWithIssues: number;
}

// ============================================
// Etiquetas en español
// ============================================

const drillTypeLabels: Record<string, string> = {
    EVACUACION: "Evacuacion",
    CONFINAMIENTO: "Confinamiento",
    SIMULACRO_GENERAL: "Simulacro general",
    SISMO: "Sismo",
    INCENDIO: "Incendio",
    OTRO: "Otro",
};

const drillResultLabels: Record<string, string> = {
    EXITOSO: "Exitoso",
    ACEPTABLE: "Aceptable",
    REQUIERE_MEJORA: "Requiere mejora",
    FALLIDO: "Fallido",
};

const drillResultVariant: Record<string, "default" | "secondary" | "destructive"> = {
    EXITOSO: "default",
    ACEPTABLE: "secondary",
    REQUIERE_MEJORA: "secondary",
    FALLIDO: "destructive",
};

const extinguisherStatusLabels: Record<string, string> = {
    OPTIMO: "Optimo",
    ACEPTABLE: "Aceptable",
    REQUIERE_RECARGA: "Requiere recarga",
    DESCARTADO: "Descartado",
    PERDIDO: "Perdido",
};

const extinguisherStatusVariant: Record<string, "default" | "secondary" | "destructive"> = {
    OPTIMO: "default",
    ACEPTABLE: "secondary",
    REQUIERE_RECARGA: "secondary",
    DESCARTADO: "destructive",
    PERDIDO: "destructive",
};

// ============================================
// Helpers
// ============================================

const formatDate = (iso: string | null): string => {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("es-MX", {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
};

const formatDateTime = (iso: string | null): string => {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("es-MX", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
};

// ============================================
// Pagina
// ============================================

export default function CivilProtectionPage() {
    const { toast } = useToast();
    const [kpis, setKpis] = useState<Kpis | null>(null);
    const [drills, setDrills] = useState<Drill[]>([]);
    const [extinguishers, setExtinguishers] = useState<Extinguisher[]>([]);
    const [exits, setExits] = useState<ExitItem[]>([]);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [kpisRes, drillsRes, extRes, exitsRes, branchesRes] = await Promise.all([
                fetch("/api/civil-protection/kpis"),
                fetch("/api/civil-protection/drills?limit=50"),
                fetch("/api/civil-protection/extinguishers?limit=50"),
                fetch("/api/civil-protection/exits?limit=50"),
                fetch("/api/branches"),
            ]);

            if (!kpisRes.ok) throw new Error("Error al cargar KPIs de proteccion civil");

            const kpisJson = await kpisRes.json();
            setKpis(kpisJson.data ?? null);

            if (drillsRes.ok) {
                const j = await drillsRes.json();
                setDrills(j.data ?? []);
            }
            if (extRes.ok) {
                const j = await extRes.json();
                setExtinguishers(j.data ?? []);
            }
            if (exitsRes.ok) {
                const j = await exitsRes.json();
                setExits(j.data ?? []);
            }
            if (branchesRes.ok) {
                const j = await branchesRes.json();
                setBranches(j.data ?? j.branches ?? []);
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : "Error desconocido";
            setError(msg);
            toast({ title: "Error", description: msg, variant: "destructive" });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    return (
        <PageContainer>
            <PageHeader
                title="Proteccion Civil"
                description="Bitacora de simulacros, inspeccion de extintores y checklist fotografico de salidas de emergencia. NOM-002-STPS-2010."
                icon={ShieldCheck}
                actions={
                    <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Actualizar
                    </Button>
                }
            />

            {/* KPIs */}
            <KpiGrid className="mb-6">
                <KpiCard
                    title="Simulacros registrados"
                    value={kpis?.drillsTotal ?? "—"}
                    icon={<ShieldCheck className="h-4 w-4" />}
                    description={kpis?.drillsLastDate ? `Ultimo: ${formatDate(kpis.drillsLastDate)}` : "Sin registros"}
                />
                <KpiCard
                    title="Extintores por vencer (30 dias)"
                    value={kpis?.extinguishersExpiringSoon ?? "—"}
                    icon={<Clock className="h-4 w-4" />}
                    description={kpis?.extinguishersExpired ? `${kpis.extinguishersExpired} vencidos` : "Ninguno vencido"}
                />
                <KpiCard
                    title="Salidas con incidencias"
                    value={kpis?.exitsWithIssues ?? "—"}
                    icon={<AlertTriangle className="h-4 w-4" />}
                    description={kpis?.exitsLastInspection ? `Ultima revision: ${formatDate(kpis.exitsLastInspection)}` : "Sin revisiones"}
                />
            </KpiGrid>

            {error && (
                <Card className="mb-6 border-destructive">
                    <CardContent className="pt-6 text-sm text-destructive">
                        {error}
                    </CardContent>
                </Card>
            )}

            <Tabs defaultValue="drills" className="w-full">
                <TabsList className="grid w-full max-w-2xl grid-cols-3">
                    <TabsTrigger value="drills" className="gap-2">
                        <ShieldCheck className="h-4 w-4" /> Simulacros
                    </TabsTrigger>
                    <TabsTrigger value="extinguishers" className="gap-2">
                        <Flame className="h-4 w-4" /> Extintores
                    </TabsTrigger>
                    <TabsTrigger value="exits" className="gap-2">
                        <DoorOpen className="h-4 w-4" /> Salidas
                    </TabsTrigger>
                </TabsList>

                {/* ============ SIMULACROS ============ */}
                <TabsContent value="drills">
                    <DrillsTab drills={drills} branches={branches} onSaved={loadData} />
                </TabsContent>

                {/* ============ EXTINTORES ============ */}
                <TabsContent value="extinguishers">
                    <ExtinguishersTab extinguishers={extinguishers} branches={branches} onSaved={loadData} />
                </TabsContent>

                {/* ============ SALIDAS ============ */}
                <TabsContent value="exits">
                    <ExitsTab exits={exits} branches={branches} onSaved={loadData} />
                </TabsContent>
            </Tabs>
        </PageContainer>
    );
}

// ============================================
// TAB: SIMULACROS
// ============================================

function DrillsTab({
    drills,
    branches,
    onSaved,
}: {
    drills: Drill[];
    branches: Branch[];
    onSaved: () => void;
}) {
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({
        branchId: "",
        drillType: "EVACUACION",
        drillDate: "",
        participantsCount: "",
        evacuationTimeSec: "",
        observations: "",
        coordinatorName: "",
    });

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.branchId || !form.drillDate) {
            toast({ title: "Faltan campos", description: "Sucursal y fecha son obligatorios.", variant: "destructive" });
            return;
        }
        setSaving(true);
        try {
            const res = await fetch("/api/civil-protection/drills", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    branchId: form.branchId,
                    drillType: form.drillType,
                    drillDate: form.drillDate,
                    participantsCount: form.participantsCount ? Number(form.participantsCount) : undefined,
                    evacuationTimeSec: form.evacuationTimeSec ? Number(form.evacuationTimeSec) : undefined,
                    observations: form.observations || undefined,
                    coordinatorName: form.coordinatorName || undefined,
                }),
            });
            if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                throw new Error(j?.error?.message ?? "Error al registrar simulacro");
            }
            toast({ title: "Simulacro registrado", description: "La bitacora se actualizo correctamente." });
            setOpen(false);
            setForm({ branchId: "", drillType: "EVACUACION", drillDate: "", participantsCount: "", evacuationTimeSec: "", observations: "", coordinatorName: "" });
            onSaved();
        } catch (e) {
            toast({ title: "Error", description: e instanceof Error ? e.message : "Error desconocido", variant: "destructive" });
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">Bitacora de simulacros</CardTitle>
                <Dialog open={open} onOpenChange={setOpen}>
                    <DialogTrigger asChild>
                        <Button size="sm"><Plus className="mr-2 h-4 w-4" /> Nuevo simulacro</Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[480px]">
                        <DialogHeader>
                            <DialogTitle>Registrar simulacro</DialogTitle>
                        </DialogHeader>
                        <form onSubmit={submit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="drill-branch">Sucursal *</Label>
                                <Select value={form.branchId} onValueChange={(v) => setForm((f) => ({ ...f, branchId: v }))}>
                                    <SelectTrigger id="drill-branch"><SelectValue placeholder="Selecciona sucursal" /></SelectTrigger>
                                    <SelectContent>
                                        {branches.map((b) => (
                                            <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="drill-type">Tipo de simulacro *</Label>
                                <Select value={form.drillType} onValueChange={(v) => setForm((f) => ({ ...f, drillType: v }))}>
                                    <SelectTrigger id="drill-type"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {Object.entries(drillTypeLabels).map(([k, v]) => (
                                            <SelectItem key={k} value={k}>{v}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="drill-date">Fecha *</Label>
                                <Input id="drill-date" type="date" value={form.drillDate} onChange={(e) => setForm((f) => ({ ...f, drillDate: e.target.value }))} required />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="drill-participants">Participantes</Label>
                                    <Input id="drill-participants" type="number" min={0} value={form.participantsCount} onChange={(e) => setForm((f) => ({ ...f, participantsCount: e.target.value }))} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="drill-time">Tiempo evacuacion (seg)</Label>
                                    <Input id="drill-time" type="number" min={0} value={form.evacuationTimeSec} onChange={(e) => setForm((f) => ({ ...f, evacuationTimeSec: e.target.value }))} />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="drill-coord">Coordinador</Label>
                                <Input id="drill-coord" value={form.coordinatorName} onChange={(e) => setForm((f) => ({ ...f, coordinatorName: e.target.value }))} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="drill-obs">Observaciones</Label>
                                <Textarea id="drill-obs" rows={3} value={form.observations} onChange={(e) => setForm((f) => ({ ...f, observations: e.target.value }))} />
                            </div>
                            <div className="flex justify-end gap-2">
                                <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
                                <Button type="submit" disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button>
                            </div>
                        </form>
                    </DialogContent>
                </Dialog>
            </CardHeader>
            <CardContent>
                {drills.length === 0 ? (
                    <EmptyState
                        icon={ShieldCheck}
                        title="Sin simulacros registrados"
                        description="Registra el primer simulacro de evacuacion o confinamiento para esta sucursal."
                    />
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Fecha</TableHead>
                                <TableHead>Tipo</TableHead>
                                <TableHead>Resultado</TableHead>
                                <TableHead>Participantes</TableHead>
                                <TableHead>Tiempo</TableHead>
                                <TableHead>Coordinador</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {drills.map((d) => (
                                <TableRow key={d.id}>
                                    <TableCell className="font-medium">{formatDate(d.drillDate)}</TableCell>
                                    <TableCell>{drillTypeLabels[d.drillType] ?? d.drillType}</TableCell>
                                    <TableCell>
                                        {d.result ? (
                                            <Badge variant={drillResultVariant[d.result] ?? "secondary"}>
                                                {drillResultLabels[d.result] ?? d.result}
                                            </Badge>
                                        ) : "—"}
                                    </TableCell>
                                    <TableCell>{d.participantsCount ?? "—"}</TableCell>
                                    <TableCell>{d.evacuationTimeSec ? `${d.evacuationTimeSec}s` : "—"}</TableCell>
                                    <TableCell>{d.coordinatorName ?? "—"}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    );
}

// ============================================
// TAB: EXTINTORES
// ============================================

function ExtinguishersTab({
    extinguishers,
    branches,
    onSaved,
}: {
    extinguishers: Extinguisher[];
    branches: Branch[];
    onSaved: () => void;
}) {
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({
        branchId: "",
        extinguisherId: "",
        location: "",
        extinguisherType: "",
        capacityKg: "",
        inspectionDate: "",
        generalStatus: "OPTIMO",
        inspectorName: "",
        inspectorNotes: "",
    });

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.branchId || !form.extinguisherId || !form.location || !form.inspectionDate) {
            toast({ title: "Faltan campos", description: "Sucursal, ID, ubicacion y fecha son obligatorios.", variant: "destructive" });
            return;
        }
        setSaving(true);
        try {
            const res = await fetch("/api/civil-protection/extinguishers", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    branchId: form.branchId,
                    extinguisherId: form.extinguisherId,
                    location: form.location,
                    extinguisherType: form.extinguisherType || undefined,
                    capacityKg: form.capacityKg ? Number(form.capacityKg) : undefined,
                    inspectionDate: form.inspectionDate,
                    generalStatus: form.generalStatus,
                    inspectorName: form.inspectorName || undefined,
                    inspectorNotes: form.inspectorNotes || undefined,
                }),
            });
            if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                throw new Error(j?.error?.message ?? "Error al registrar extintor");
            }
            toast({ title: "Extintor registrado", description: "La inspeccion se guardo en la bitacora." });
            setOpen(false);
            setForm({ branchId: "", extinguisherId: "", location: "", extinguisherType: "", capacityKg: "", inspectionDate: "", generalStatus: "OPTIMO", inspectorName: "", inspectorNotes: "" });
            onSaved();
        } catch (e) {
            toast({ title: "Error", description: e instanceof Error ? e.message : "Error desconocido", variant: "destructive" });
        } finally {
            setSaving(false);
        }
    };

    const isExpired = (iso: string | null) => iso && new Date(iso) < new Date();

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">Inspeccion de extintores</CardTitle>
                <Dialog open={open} onOpenChange={setOpen}>
                    <DialogTrigger asChild>
                        <Button size="sm"><Plus className="mr-2 h-4 w-4" /> Nueva inspeccion</Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[480px]">
                        <DialogHeader>
                            <DialogTitle>Registrar inspeccion de extintor</DialogTitle>
                        </DialogHeader>
                        <form onSubmit={submit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="ext-branch">Sucursal *</Label>
                                <Select value={form.branchId} onValueChange={(v) => setForm((f) => ({ ...f, branchId: v }))}>
                                    <SelectTrigger id="ext-branch"><SelectValue placeholder="Selecciona sucursal" /></SelectTrigger>
                                    <SelectContent>
                                        {branches.map((b) => (
                                            <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="ext-id">ID extintor *</Label>
                                    <Input id="ext-id" placeholder="EXT-COC-001" value={form.extinguisherId} onChange={(e) => setForm((f) => ({ ...f, extinguisherId: e.target.value }))} required />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="ext-type">Tipo</Label>
                                    <Input id="ext-type" placeholder="ABC, CO2, PQS" value={form.extinguisherType} onChange={(e) => setForm((f) => ({ ...f, extinguisherType: e.target.value }))} />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="ext-loc">Ubicacion *</Label>
                                <Input id="ext-loc" placeholder="Cocina principal" value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} required />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="ext-cap">Capacidad (kg)</Label>
                                    <Input id="ext-cap" type="number" min={0} value={form.capacityKg} onChange={(e) => setForm((f) => ({ ...f, capacityKg: e.target.value }))} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="ext-date">Fecha inspeccion *</Label>
                                    <Input id="ext-date" type="date" value={form.inspectionDate} onChange={(e) => setForm((f) => ({ ...f, inspectionDate: e.target.value }))} required />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="ext-status">Estado general</Label>
                                <Select value={form.generalStatus} onValueChange={(v) => setForm((f) => ({ ...f, generalStatus: v }))}>
                                    <SelectTrigger id="ext-status"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {Object.entries(extinguisherStatusLabels).map(([k, v]) => (
                                            <SelectItem key={k} value={k}>{v}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="ext-inspector">Inspector</Label>
                                <Input id="ext-inspector" value={form.inspectorName} onChange={(e) => setForm((f) => ({ ...f, inspectorName: e.target.value }))} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="ext-notes">Notas</Label>
                                <Textarea id="ext-notes" rows={2} value={form.inspectorNotes} onChange={(e) => setForm((f) => ({ ...f, inspectorNotes: e.target.value }))} />
                            </div>
                            <div className="flex justify-end gap-2">
                                <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
                                <Button type="submit" disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button>
                            </div>
                        </form>
                    </DialogContent>
                </Dialog>
            </CardHeader>
            <CardContent>
                {extinguishers.length === 0 ? (
                    <EmptyState
                        icon={Flame}
                        title="Sin extintores registrados"
                        description="Registra la primera inspeccion de extintor. Las fechas de recarga pueden extraerse via OCR de la foto de la placa."
                    />
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>ID</TableHead>
                                <TableHead>Ubicacion</TableHead>
                                <TableHead>Ultima inspeccion</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead>Vence</TableHead>
                                <TableHead>Proxima</TableHead>
                                <TableHead>OCR</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {extinguishers.map((x) => {
                                const expired = isExpired(x.nextInspectionDate);
                                return (
                                    <TableRow key={x.id}>
                                        <TableCell className="font-mono text-xs">{x.extinguisherId}</TableCell>
                                        <TableCell>{x.location}</TableCell>
                                        <TableCell>{formatDate(x.inspectionDate)}</TableCell>
                                        <TableCell>
                                            {x.generalStatus ? (
                                                <Badge variant={extinguisherStatusVariant[x.generalStatus] ?? "secondary"}>
                                                    {extinguisherStatusLabels[x.generalStatus] ?? x.generalStatus}
                                                </Badge>
                                            ) : "—"}
                                        </TableCell>
                                        <TableCell>
                                            {x.expirationDate ? (
                                                <span className={expired ? "text-destructive font-medium" : ""}>
                                                    {formatDate(x.expirationDate)}
                                                </span>
                                            ) : "—"}
                                        </TableCell>
                                        <TableCell>{formatDate(x.nextInspectionDate)}</TableCell>
                                        <TableCell>
                                            {x.ocrProcessedAt ? (
                                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                                            ) : "—"}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    );
}

// ============================================
// TAB: SALIDAS
// ============================================

function ExitsTab({
    exits,
    branches,
    onSaved,
}: {
    exits: ExitItem[];
    branches: Branch[];
    onSaved: () => void;
}) {
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({
        branchId: "",
        exitLocation: "",
        isClear: true,
        signageOk: true,
        emergencyLightOk: true,
        doorOpensOk: true,
        accessWidthCm: "",
        inspectionRound: "Apertura",
        notes: "",
    });

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.branchId || !form.exitLocation) {
            toast({ title: "Faltan campos", description: "Sucursal y ubicacion son obligatorios.", variant: "destructive" });
            return;
        }
        setSaving(true);
        try {
            const res = await fetch("/api/civil-protection/exits", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    branchId: form.branchId,
                    exitLocation: form.exitLocation,
                    isClear: form.isClear,
                    signageOk: form.signageOk,
                    emergencyLightOk: form.emergencyLightOk,
                    doorOpensOk: form.doorOpensOk,
                    accessWidthCm: form.accessWidthCm ? Number(form.accessWidthCm) : undefined,
                    inspectionRound: form.inspectionRound || undefined,
                    notes: form.notes || undefined,
                }),
            });
            if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                throw new Error(j?.error?.message ?? "Error al registrar salida");
            }
            toast({ title: "Salida registrada", description: "El checklist fotografico se guardo." });
            setOpen(false);
            setForm({ branchId: "", exitLocation: "", isClear: true, signageOk: true, emergencyLightOk: true, doorOpensOk: true, accessWidthCm: "", inspectionRound: "Apertura", notes: "" });
            onSaved();
        } catch (e) {
            toast({ title: "Error", description: e instanceof Error ? e.message : "Error desconocido", variant: "destructive" });
        } finally {
            setSaving(false);
        }
    };

    const allOk = (x: ExitItem) => x.isClear && x.signageOk && x.emergencyLightOk && x.doorOpensOk;

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">Checklist de salidas de emergencia</CardTitle>
                <Dialog open={open} onOpenChange={setOpen}>
                    <DialogTrigger asChild>
                        <Button size="sm"><Plus className="mr-2 h-4 w-4" /> Nueva revision</Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[480px]">
                        <DialogHeader>
                            <DialogTitle>Registrar revision de salida</DialogTitle>
                        </DialogHeader>
                        <form onSubmit={submit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="exit-branch">Sucursal *</Label>
                                <Select value={form.branchId} onValueChange={(v) => setForm((f) => ({ ...f, branchId: v }))}>
                                    <SelectTrigger id="exit-branch"><SelectValue placeholder="Selecciona sucursal" /></SelectTrigger>
                                    <SelectContent>
                                        {branches.map((b) => (
                                            <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="exit-loc">Ubicacion de salida *</Label>
                                <Input id="exit-loc" placeholder="Puerta principal, salida trasera..." value={form.exitLocation} onChange={(e) => setForm((f) => ({ ...f, exitLocation: e.target.value }))} required />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="exit-round">Ronda de inspeccion</Label>
                                <Select value={form.inspectionRound} onValueChange={(v) => setForm((f) => ({ ...f, inspectionRound: v }))}>
                                    <SelectTrigger id="exit-round"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Apertura">Apertura</SelectItem>
                                        <SelectItem value="Cierre">Cierre</SelectItem>
                                        <SelectItem value="Semanal">Semanal</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <label className="flex items-center gap-2 text-sm">
                                    <input type="checkbox" checked={form.isClear} onChange={(e) => setForm((f) => ({ ...f, isClear: e.target.checked }))} />
                                    Despejada
                                </label>
                                <label className="flex items-center gap-2 text-sm">
                                    <input type="checkbox" checked={form.signageOk} onChange={(e) => setForm((f) => ({ ...f, signageOk: e.target.checked }))} />
                                    Senalizacion
                                </label>
                                <label className="flex items-center gap-2 text-sm">
                                    <input type="checkbox" checked={form.emergencyLightOk} onChange={(e) => setForm((f) => ({ ...f, emergencyLightOk: e.target.checked }))} />
                                    Luz emergencia
                                </label>
                                <label className="flex items-center gap-2 text-sm">
                                    <input type="checkbox" checked={form.doorOpensOk} onChange={(e) => setForm((f) => ({ ...f, doorOpensOk: e.target.checked }))} />
                                    Puerta abre
                                </label>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="exit-width">Ancho de paso (cm)</Label>
                                <Input id="exit-width" type="number" min={0} value={form.accessWidthCm} onChange={(e) => setForm((f) => ({ ...f, accessWidthCm: e.target.value }))} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="exit-notes">Notas</Label>
                                <Textarea id="exit-notes" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
                            </div>
                            <div className="flex justify-end gap-2">
                                <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
                                <Button type="submit" disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button>
                            </div>
                        </form>
                    </DialogContent>
                </Dialog>
            </CardHeader>
            <CardContent>
                {exits.length === 0 ? (
                    <EmptyState
                        icon={DoorOpen}
                        title="Sin revisiones de salidas"
                        description="Registra el primer checklist fotografico de salidas de emergencia."
                    />
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Ubicacion</TableHead>
                                <TableHead>Ronda</TableHead>
                                <TableHead>Despejada</TableHead>
                                <TableHead>Senalizacion</TableHead>
                                <TableHead>Luz</TableHead>
                                <TableHead>Puerta</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead>Fecha</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {exits.map((x) => (
                                <TableRow key={x.id}>
                                    <TableCell className="font-medium">{x.exitLocation}</TableCell>
                                    <TableCell>{x.inspectionRound ?? "—"}</TableCell>
                                    <TableCell>{x.isClear ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <AlertTriangle className="h-4 w-4 text-destructive" />}</TableCell>
                                    <TableCell>{x.signageOk ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <AlertTriangle className="h-4 w-4 text-destructive" />}</TableCell>
                                    <TableCell>{x.emergencyLightOk ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <AlertTriangle className="h-4 w-4 text-destructive" />}</TableCell>
                                    <TableCell>{x.doorOpensOk ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <AlertTriangle className="h-4 w-4 text-destructive" />}</TableCell>
                                    <TableCell>
                                        <Badge variant={allOk(x) ? "default" : "destructive"}>
                                            {allOk(x) ? "OK" : "Incidencia"}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>{formatDateTime(x.inspectedAt)}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    );
}
