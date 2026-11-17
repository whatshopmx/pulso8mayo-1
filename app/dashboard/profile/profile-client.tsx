"use client";

import { use } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordChangeForm } from "@/components/profile/password-change-form";
import { NotificationPreferences } from "@/components/profile/notification-preferences";
import { User, Mail, Phone, Building, MapPin, Shield, Calendar, Edit2, Save, Loader2, FileText, Calendar as CalendarIcon, Briefcase, Award, Clock } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { EmployeeContractsView } from "@/components/profile/employee-contracts-view";
import { EmployeeDocumentsView } from "@/components/profile/employee-documents-view";
import { EmployeeScheduleView } from "@/components/profile/employee-schedule-view";
import { VacationBalanceCard } from "@/components/profile/vacation-balance-card";
import { EmployeeBenefitsView } from "@/components/profile/employee-benefits-view";

export interface ProfileClientProps {
    userPromise: Promise<{
        id: string;
        name: string | null;
        email: string;
        image?: string | null;
        role?: string | null;
        phone?: string | null;
        companyId?: string | null;
        branchId?: string | null;
    }>;
}

export function ProfileClient({ userPromise }: ProfileClientProps) {
    const user = use(userPromise);
    const [editing, setEditing] = useState(false);
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        name: user.name || "",
        phone: user.phone || "",
        whatsappPhone: ""
    });

    const handleSave = async () => {
        setLoading(true);
        try {
            const response = await fetch("/api/profile", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(formData)
            });

            if (response.ok) {
                toast.success("Perfil actualizado exitosamente");
                setEditing(false);
            } else {
                toast.error("Error al actualizar perfil");
            }
        } catch (error) {
            console.error("Error updating profile:", error);
            toast.error("Error al actualizar perfil");
        } finally {
            setLoading(false);
        }
    };

    const getInitials = (name: string | null) => {
        if (!name) return "U";
        const parts = name.split(" ");
        return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
    };

    const getRoleName = (role?: string | null) => {
        const roles: Record<string, string> = {
            "SUPER_ADMIN": "Super Administrador",
            "ADMIN": "Administrador",
            "GERENTE": "Gerente",
            "SUPERVISOR": "Supervisor",
            "EMPLEADO": "Empleado",
            "READONLY": "Solo Lectura"
        };
        return roles[role || ""] || role;
    };

    const isEmployee = user.role === "EMPLEADO";

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold">Mi Perfil</h1>
                <p className="text-muted-foreground">
                    Gestiona tu información personal y preferencias
                </p>
            </div>

            {/* Profile Information */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <Avatar className="h-20 w-20">
                                <AvatarImage src={user.image || undefined} />
                                <AvatarFallback className="text-lg">
                                    {getInitials(user.name)}
                                </AvatarFallback>
                            </Avatar>
                            <div>
                                <CardTitle className="text-2xl">{user.name || "Usuario"}</CardTitle>
                                <CardDescription className="flex items-center gap-2 mt-1">
                                    <Mail className="h-3 w-3" />
                                    {user.email}
                                </CardDescription>
                            </div>
                        </div>
                        {!editing ? (
                            <Button
                                variant="outline"
                                onClick={() => setEditing(true)}
                            >
                                <Edit2 className="h-4 w-4 mr-2" />
                                Editar
                            </Button>
                        ) : (
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        setEditing(false);
                                        setFormData({
                                            name: user.name || "",
                                            phone: user.phone || "",
                                            whatsappPhone: ""
                                        });
                                    }}
                                >
                                    Cancelar
                                </Button>
                                <Button onClick={handleSave} disabled={loading}>
                                    {loading ? (
                                        <>
                                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                            Guardando...
                                        </>
                                    ) : (
                                        <>
                                            <Save className="h-4 w-4 mr-2" />
                                            Guardar
                                        </>
                                    )}
                                </Button>
                            </div>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="space-y-6">
                    {/* User Info Grid */}
                    <div className="grid gap-6 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="name">Nombre Completo</Label>
                            <div className="flex items-center gap-2">
                                <User className="h-4 w-4 text-muted-foreground" />
                                {editing ? (
                                    <Input
                                        id="name"
                                        value={formData.name}
                                        onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                    />
                                ) : (
                                    <span>{user.name || "No especificado"}</span>
                                )}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="email">Correo Electrónico</Label>
                            <div className="flex items-center gap-2">
                                <Mail className="h-4 w-4 text-muted-foreground" />
                                <span>{user.email}</span>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="phone">Teléfono</Label>
                            <div className="flex items-center gap-2">
                                <Phone className="h-4 w-4 text-muted-foreground" />
                                {editing ? (
                                    <Input
                                        id="phone"
                                        value={formData.phone}
                                        onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                                        placeholder="+52 55 1234 5678"
                                    />
                                ) : (
                                    <span>{user.phone || "No especificado"}</span>
                                )}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="role">Rol</Label>
                            <div className="flex items-center gap-2">
                                <Shield className="h-4 w-4 text-muted-foreground" />
                                <Badge variant="secondary">
                                    {getRoleName(user.role)}
                                </Badge>
                            </div>
                        </div>
                    </div>

                    {/* Account Info */}
                    <div className="pt-6 border-t">
                        <h3 className="text-lg font-semibold mb-4">Información de Cuenta</h3>
                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="flex items-center gap-2 text-sm">
                                <Building className="h-4 w-4 text-muted-foreground" />
                                <span className="text-muted-foreground">Empresa:</span>
                                <span>{user.companyId ? user.companyId : "No asignada"}</span>
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                                <MapPin className="h-4 w-4 text-muted-foreground" />
                                <span className="text-muted-foreground">Sucursal:</span>
                                <span>{user.branchId ? user.branchId : "No asignada"}</span>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Employee Self-Service Sections */}
            {isEmployee && (
                <>
                    <div className="grid gap-6 md:grid-cols-2">
                        <VacationBalanceCard userId={user.id} companyId={user.companyId} />
                        <EmployeeBenefitsView userId={user.id} companyId={user.companyId} />
                    </div>

                    <div className="grid gap-6 md:grid-cols-2">
                        <EmployeeContractsView userId={user.id} companyId={user.companyId} />
                        <EmployeeDocumentsView userId={user.id} companyId={user.companyId} />
                    </div>

                    <EmployeeScheduleView userId={user.id} companyId={user.companyId} />
                </>
            )}

            {/* Two Column Layout for Password and Notifications */}
            <div className="grid gap-6 md:grid-cols-2">
                <div>
                    <PasswordChangeForm />
                </div>
                <div>
                    <Card>
                        <CardHeader>
                            <CardTitle>Preferencias de Notificación</CardTitle>
                            <CardDescription>
                                Configura cómo quieres recibir notificaciones
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <NotificationPreferences />
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
