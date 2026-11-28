"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Sheet,
    SheetClose,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Role } from "@/lib/permissions";
import { isBranchScopedRole } from "@/lib/rbac/resource-scope";
import { getAssignableRoles, ROLE_LABELS } from "@/lib/team/team-permissions";

interface User {
    id: string;
    name: string;
    email: string;
    role: Role;
    branchId: string | null;
    image?: string;
    phone?: string;
}

interface UserEditSheetProps {
    user: User | null;
    isOpen: boolean;
    onClose: () => void;
    onUserUpdated: (user: User) => void;
    branches?: { id: string; name: string }[];
    actorRole?: Role;
    actorBranchId?: string | null;
}

export function UserEditSheet({
    user,
    isOpen,
    onClose,
    onUserUpdated,
    branches = [],
    actorRole = "ADMIN",
    actorBranchId = null,
}: UserEditSheetProps) {
    const [isLoading, setIsLoading] = useState(false);

    if (!user) return null;

    const assignableRoles = getAssignableRoles(actorRole);
    const roleOptions = assignableRoles.includes(user.role)
        ? assignableRoles
        : [user.role, ...assignableRoles];
    const branchScoped = isBranchScopedRole(actorRole);
    const visibleBranches = branchScoped && actorBranchId
        ? branches.filter((b) => b.id === actorBranchId)
        : branches;

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setIsLoading(true);

        const formData = new FormData(e.currentTarget);
        const rawBranch = (formData.get("branchId") as string) || "";
        const rawRole = formData.get("role") as Role;
        const updates: Record<string, unknown> = {
            name: formData.get("name") as string,
            phone: formData.get("phone") as string,
        };
        if (assignableRoles.includes(rawRole)) {
            updates.role = rawRole;
        }
        if (rawBranch && rawBranch !== "global") {
            updates.branchId = rawBranch;
        }

        try {
            const res = await fetch(`/api/users/${user.id}`, {
                method: "PATCH",
                body: JSON.stringify(updates),
                headers: { "Content-Type": "application/json" }
            });

            if (!res.ok) {
                const errorData = await res.json().catch(() => null);
                throw new Error(errorData?.error?.message || "No se pudo actualizar el usuario");
            }

            const response = await res.json();
            const updatedUser = response.data;
            onUserUpdated({ ...user, ...updatedUser });
            toast.success("Usuario actualizado correctamente");
            onClose();
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : "No se pudo actualizar el usuario");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Sheet open={isOpen} onOpenChange={onClose}>
            <SheetContent className="sm:max-w-[500px]">
                <SheetHeader>
                    <SheetTitle>Editar Perfil</SheetTitle>
                    <SheetDescription>
                        Actualiza los datos y permisos de {user.name}.
                    </SheetDescription>
                </SheetHeader>

                <form key={user.id} onSubmit={handleSubmit} className="space-y-6 py-6">
                    {/* Header with Avatar */}
                    <div className="flex items-center gap-4">
                        <Avatar className="h-16 w-16">
                            <AvatarImage src={user.image} />
                            <AvatarFallback className="text-lg">{user.name?.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div>
                            <h3 className="font-medium text-lg">{user.name}</h3>
                            <p className="text-sm text-muted-foreground">{user.email}</p>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">Nombre completo</Label>
                            <Input id="name" name="name" defaultValue={user.name} required />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="phone">Teléfono</Label>
                            <Input id="phone" name="phone" defaultValue={user.phone || ""} placeholder="+52..." />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="role">Rol</Label>
                                <Select name="role" defaultValue={user.role}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {roleOptions.map((r) => (
                                            <SelectItem key={r} value={r}>
                                                {ROLE_LABELS[r]}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="branchId">Sucursal asignada</Label>
                                <Select
                                    name="branchId"
                                    defaultValue={user.branchId || (branchScoped && actorBranchId ? actorBranchId : "global")}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecciona sucursal" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {!branchScoped && (
                                            <SelectItem value="global">Todas las sucursales (Global)</SelectItem>
                                        )}
                                        {visibleBranches.map(b => (
                                            <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>

                    <SheetFooter>
                        <SheetClose asChild>
                            <Button variant="outline" type="button">Cancelar</Button>
                        </SheetClose>
                        <Button type="submit" disabled={isLoading}>
                            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Guardar cambios
                        </Button>
                    </SheetFooter>
                </form>
            </SheetContent>
        </Sheet>
    );
}
