"use client";

import { useEffect, useState } from "react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MoreHorizontal, Loader2, UserPlus, Shield, Users, Copy, MessageCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import { RolePermissionMatrix } from "@/components/team/role-permission-matrix";
import { UserEditSheet } from "@/components/team/user-edit-sheet";

interface User {
    id: string;
    name: string;
    email: string;
    role: "ADMIN" | "GERENTE" | "EMPLEADO";
    branchId: string | null;
    image?: string;
    phone?: string;
}

export default function TeamPage() {
    const [users, setUsers] = useState<User[]>([]);
    const [branches, setBranches] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [deactivatingUser, setDeactivatingUser] = useState<User | null>(null);
  const [deactivating, setDeactivating] = useState(false);

    // Invite dialog state
    const [inviteOpen, setInviteOpen] = useState(false);
    const [selectedBranchForInvite, setSelectedBranchForInvite] = useState<string>("");

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const [usersRes, branchesRes] = await Promise.all([
                    fetch("/api/users"),
                    fetch("/api/branches")
                ]);

                if (usersRes.ok) {
                    const response = await usersRes.json();
                    setUsers(response.data?.data || []);
                }
                if (branchesRes.ok) {
                    const bResponse = await branchesRes.json();
                    const branchData = bResponse.data || [];
                    setBranches(branchData);
                    if (branchData.length > 0) {
                        setSelectedBranchForInvite(branchData[0].id);
                    }
                }
            } catch (e) {
                console.error(e);
                toast.error("Error al cargar datos del equipo");
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    const handleEditUser = (user: User) => {
        setEditingUser(user);
        setIsSheetOpen(true);
    };

  const handleUserUpdated = (updatedUser: User) => {
    setUsers(users.map(u => u.id === updatedUser.id ? updatedUser : u));
  };

  const handleDeactivate = async () => {
    if (!deactivatingUser) return;
    setDeactivating(true);
    try {
      const res = await fetch(`/api/users/${deactivatingUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: false }),
      });
      if (res.ok) {
        setUsers(users.map(u => u.id === deactivatingUser.id ? { ...u, active: false } : u));
        toast.success('Usuario desactivado');
      } else {
        toast.error('Error al desactivar usuario');
      }
    } catch {
      toast.error('Error al desactivar usuario');
    } finally {
      setDeactivating(false);
      setDeactivatingUser(null);
    }
  };

    const getBranchName = (id: string | null) => {
        if (!id) return "Global / Matriz";
        const b = branches.find(br => br.id === id);
        return b ? b.name : "Unknown Branch";
    };

    const getSmartLink = () => {
        const branch = branches.find(b => b.id === selectedBranchForInvite);
        if (!branch?.inviteToken) return "";
        return `${window.location.origin}/join/${branch.inviteToken}`;
    };

    const handleCopyLink = () => {
        const link = getSmartLink();
        if (!link) {
            toast.error("Selecciona una sucursal primero");
            return;
        }
        navigator.clipboard.writeText(link);
        toast.success("Enlace copiado al portapapeles");
    };

    const handleShareWhatsApp = () => {
        const link = getSmartLink();
        if (!link) return;
        const branchName = branches.find(b => b.id === selectedBranchForInvite)?.name || "";
        const message = encodeURIComponent(
            `¡Hola! Te invito a unirte al equipo de ${branchName} en Pulso HORECA. Regístrate aquí: ${link}`
        );
        window.open(`https://wa.me/?text=${message}`, "_blank");
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
<h1 className="text-3xl font-bold tracking-tight">Equipo y Permisos</h1>
        <p className="text-muted-foreground">Gestiona los miembros de tu equipo y sus niveles de acceso.</p>
                </div>
                <Button onClick={() => setInviteOpen(true)}>
                    <UserPlus className="mr-2 h-4 w-4" />
Invitar Miembro
                </Button>
            </div>

            <Tabs defaultValue="members" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="members" className="flex items-center gap-2">
                        <Users className="h-4 w-4" />
                        Miembros
                    </TabsTrigger>
                    <TabsTrigger value="roles" className="flex items-center gap-2">
                        <Shield className="h-4 w-4" />
                        Roles y Permisos
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="members" className="space-y-4">
                    <Card>
                        <CardHeader>
<CardTitle>Directorio de Equipo</CardTitle>
          <CardDescription>Gestiona usuarios, roles y asignaciones de sucursal.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {loading ? (
                                <div className="flex justify-center py-12"><Loader2 className="animate-spin text-primary" /></div>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
<TableHead>Usuario</TableHead>
            <TableHead>Rol</TableHead>
            <TableHead>Ubicación</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {users.map((user) => (
                                            <TableRow key={user.id}>
                                                <TableCell className="flex items-center gap-3">
                                                    <Avatar>
                                                        <AvatarImage src={user.image} />
                                                        <AvatarFallback>{user.name?.charAt(0) || "U"}</AvatarFallback>
                                                    </Avatar>
                                                    <div>
                                                        <div className="font-medium">{user.name}</div>
                                                        <div className="text-xs text-muted-foreground">{user.email}</div>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant={user.role === "ADMIN" ? "default" : "secondary"}>
                                                        {user.role}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    <span className="text-sm text-muted-foreground">
                                                        {getBranchName(user.branchId)}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="ghost" className="h-8 w-8 p-0">
                                                                <span className="sr-only">Open menu</span>
                                                                <MoreHorizontal className="h-4 w-4" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
<DropdownMenuLabel>Acciones</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => handleEditUser(user)}>
                  Editar Perfil y Permisos
                </DropdownMenuItem>
                <DropdownMenuItem className="text-red-600" onClick={() => setDeactivatingUser(user)}>
                  Desactivar Usuario
                </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="roles" className="space-y-4">
                    <Card>
                        <CardHeader>
<CardTitle>Definiciones de Roles</CardTitle>
          <CardDescription>Vista general de permisos accesibles por cada rol.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <RolePermissionMatrix />
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            <UserEditSheet
                user={editingUser}
                isOpen={isSheetOpen}
                onClose={() => setIsSheetOpen(false)}
                onUserUpdated={handleUserUpdated}
                branches={branches}
            />

            {/* Invite Member Dialog */}
            <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Invitar Nuevo Miembro</DialogTitle>
                        <DialogDescription>
                            Comparte el enlace de registro con tu nuevo empleado. Al registrarse, quedará asignado automáticamente a la sucursal seleccionada con rol de EMPLEADO.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Sucursal</Label>
                            <Select value={selectedBranchForInvite} onValueChange={setSelectedBranchForInvite}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecciona una sucursal" />
                                </SelectTrigger>
                                <SelectContent>
                                    {branches.map(b => (
                                        <SelectItem key={b.id} value={b.id}>
                                            {b.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>Enlace de Registro (SmartLink)</Label>
                            <div className="flex items-center gap-2">
                                <Input
                                    readOnly
                                    value={getSmartLink()}
                                    className="text-xs font-mono bg-muted"
                                />
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={handleCopyLink}
                                    aria-label="Copiar enlace de registro"
                                >
                                    <Copy className="h-4 w-4" />
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                El empleado se registra con este enlace y queda vinculado automáticamente a la sucursal.
                            </p>
                        </div>
                    </div>

                    <DialogFooter className="flex-col gap-2 sm:flex-row">
                        <Button variant="outline" className="w-full sm:w-auto" onClick={handleCopyLink}>
                            <Copy className="mr-2 h-4 w-4" />
                            Copiar Enlace
                        </Button>
                        <Button className="w-full sm:w-auto bg-green-600 hover:bg-green-700" onClick={handleShareWhatsApp}>
                            <MessageCircle className="mr-2 h-4 w-4" />
                            Compartir por WhatsApp
                        </Button>
                    </DialogFooter>
    </DialogContent>
    </Dialog>

    <Dialog open={!!deactivatingUser} onOpenChange={(open) => !open && setDeactivatingUser(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Desactivar Usuario</DialogTitle>
          <DialogDescription>
            ¿Estás seguro de que deseas desactivar a {deactivatingUser?.name}? El usuario no podrá acceder al sistema.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDeactivatingUser(null)} disabled={deactivating}>Cancelar</Button>
          <Button variant="destructive" onClick={handleDeactivate} disabled={deactivating}>
            {deactivating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Desactivar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
    );
}
