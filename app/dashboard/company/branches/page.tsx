"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, MapPin, Users, UserCog, Building2, Mail, FileCheck2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { isRegistroPatronal } from "@/lib/services/compliance/imss-registro";

interface Manager {
    id: string;
    name: string | null;
    email: string;
}

interface Branch {
    id: string;
    name: string;
    address: string | null;
    active: boolean;
    imssRegistroPatronal?: string | null;
    inviteToken?: string;
    manager?: Manager | null;
    _count?: {
        employees: number;
    };
}

export default function BranchesPage() {
    const [branches, setBranches] = useState<Branch[]>([]);
    const [loading, setLoading] = useState(true);
    const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
    const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
    const [inviteEmail, setInviteEmail] = useState("");
    const [sendingInvite, setSendingInvite] = useState(false);
    const router = useRouter();

    useEffect(() => {
        fetchBranches();
    }, []);

    async function fetchBranches() {
        try {
            const res = await fetch("/api/branches");
            if (!res.ok) throw new Error("Failed to load branches");
            const response = await res.json();
            setBranches(response.data || []);
        } catch (error) {
            console.error(error);
            toast.error("Error loading branches");
        } finally {
            setLoading(false);
        }
    }

    function openInviteDialog(branch: Branch) {
        setSelectedBranch(branch);
        setInviteEmail("");
        setInviteDialogOpen(true);
    }

    async function handleSendInvite() {
        if (!selectedBranch || !inviteEmail) {
            toast.error("Email is required");
            return;
        }

        setSendingInvite(true);
        try {
            const res = await fetch("/api/branches/invite-manager", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    branchId: selectedBranch.id,
                    email: inviteEmail,
                }),
            });

            const result = await res.json();

            if (!res.ok) {
                throw new Error(result.message || "Failed to send invitation");
            }

            toast.success("Invitation sent successfully");
            setInviteDialogOpen(false);
            setInviteEmail("");
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : "Error sending invitation");
        } finally {
            setSendingInvite(false);
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Sucursales</h1>
                    <p className="text-muted-foreground">Gestiona tus ubicaciones, horarios y equipos.</p>
                </div>
                <Button onClick={() => router.push("/dashboard/company/branches/new")}>
                    <Plus className="mr-2 h-4 w-4" />
                    Nueva Sucursal
                </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {branches.map((branch) => (
                    <Card
                        key={branch.id}
                        className="hover:shadow-md transition-shadow"
                    >
                        <div 
                            className="cursor-pointer"
                            onClick={() => router.push(`/dashboard/company/branches/${branch.id}`)}
                        >
                            <CardHeader className="space-y-1">
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-lg font-semibold">
                                        {branch.name}
                                    </CardTitle>
                                    <Badge variant={branch.active ? "default" : "secondary"}>
                                        {branch.active ? "Activa" : "Inactiva"}
                                    </Badge>
                                </div>
                                <CardDescription className="flex items-center gap-1">
                                    <MapPin className="h-3 w-3" />
                                    {branch.address || "Sin dirección"}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {branch.manager && (
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <UserCog className="h-4 w-4" />
                                        <span className="truncate">
                                            Gerente: {branch.manager.name || branch.manager.email}
                                        </span>
                                    </div>
                                )}
                                {!branch.manager && (
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <UserCog className="h-4 w-4" />
                                        <span>Sin gerente asignado</span>
                                    </div>
                                )}
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Users className="h-4 w-4" />
                                    <span>{branch._count?.employees || 0} empleados</span>
                                </div>
                                {isRegistroPatronal(branch.imssRegistroPatronal)
                                    ? <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <FileCheck2 className="h-4 w-4" />
                                        <span className="font-mono text-xs">{branch.imssRegistroPatronal}</span>
                                    </div>
                                    : <Badge variant="secondary" className="w-fit">Sin registro patronal</Badge>}
                            </CardContent>
                        </div>
                        <div className="px-6 pb-4">
                            <Button 
                                variant="outline" 
                                size="sm" 
                                className="w-full"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    openInviteDialog(branch);
                                }}
                            >
                                <Mail className="mr-2 h-4 w-4" />
                                {branch.manager ? "Invitar otro gerente" : "Invitar gerente"}
                            </Button>
                        </div>
                    </Card>
                ))}

                {branches.length === 0 && !loading && (
                    <div className="col-span-full">
                        <Card>
                            <CardContent className="flex flex-col items-center justify-center py-10 text-center">
                                <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
                                <h3 className="text-lg font-semibold mb-1">No hay sucursales</h3>
                                <p className="text-muted-foreground mb-4">
                                    Comienza agregando tu primera sucursal
                                </p>
                                <Button onClick={() => router.push("/dashboard/company/branches/new")}>
                                    <Plus className="mr-2 h-4 w-4" />
                                    Nueva Sucursal
                                </Button>
                            </CardContent>
                        </Card>
                    </div>
                )}
            </div>

            <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Invitar Gerente</DialogTitle>
                        <DialogDescription>
                            Envía una invitación por email para que un gerente se una a la sucursal{" "}
                            <strong>{selectedBranch?.name}</strong>.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="email">Email del gerente</Label>
                            <Input
                                id="email"
                                type="email"
                                placeholder="gerente@empresa.com"
                                value={inviteEmail}
                                onChange={(e) => setInviteEmail(e.target.value)}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setInviteDialogOpen(false)}
                        >
                            Cancelar
                        </Button>
                        <Button
                            onClick={handleSendInvite}
                            disabled={sendingInvite || !inviteEmail}
                        >
                            {sendingInvite ? (
                                <>
                                    <Mail className="mr-2 h-4 w-4 animate-spin" />
                                    Enviando...
                                </>
                            ) : (
                                <>
                                    <Mail className="mr-2 h-4 w-4" />
                                    Enviar Invitación
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
