"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface User {
    id: string;
    name: string | null;
    email: string;
}

export default function NewBranchPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [users, setUsers] = useState<User[]>([]);
    const [formData, setFormData] = useState({
        name: "",
        code: "",
        address: "",
        managerId: "",
        // H1 (`plan-imss-operacion`): la API ya aceptaba el dato, pero el
        // formulario nunca lo enviaba, así que toda sucursal nacía sin registro
        // y su primer movimiento quedaba bloqueado. Es opcional a propósito:
        // una sucursal en trámite existe antes que su registro.
        imssRegistroPatronal: "",
    });

    useEffect(() => {
        fetchUsers();
    }, []);

    async function fetchUsers() {
        try {
            const res = await fetch("/api/users?limit=100");
            if (!res.ok) throw new Error("Failed to load users");
            const response = await res.json();
            setUsers(response.data?.data || []);
        } catch (error) {
            console.error("Error fetching users:", error);
        }
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true);

        try {
            const payload = {
                ...formData,
                managerId: formData.managerId || null,
            };

            const res = await fetch("/api/branches", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                const error = await res.json();
                const detail = error?.error?.details;
                const firstIssue = detail && typeof detail === "object"
                    ? Object.values(detail as Record<string, unknown>).flat().find((item): item is string => typeof item === "string")
                    : undefined;
                throw new Error(firstIssue || error?.error?.message || "Failed to create branch");
            }

            toast.success("Sucursal creada exitosamente");
            router.push("/dashboard/company/branches");
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : "Error al crear la sucursal");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => router.push("/dashboard/company/branches")}
                >
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Nueva Sucursal</h1>
                    <p className="text-muted-foreground">Agrega una nueva sucursal a tu empresa.</p>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Información de la Sucursal</CardTitle>
                    <CardDescription>
                        Completa los datos básicos de la nueva sucursal
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">Nombre *</Label>
                            <Input
                                id="name"
                                value={formData.name}
                                onChange={(e) =>
                                    setFormData({ ...formData, name: e.target.value })
                                }
                                placeholder="Sucursal Centro"
                                required
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="code">Código</Label>
                            <Input
                                id="code"
                                value={formData.code}
                                onChange={(e) =>
                                    setFormData({ ...formData, code: e.target.value })
                                }
                                placeholder="SUC-001"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="address">Dirección</Label>
                            <Input
                                id="address"
                                value={formData.address}
                                onChange={(e) =>
                                    setFormData({ ...formData, address: e.target.value })
                                }
                                placeholder="Calle 123, Colonia, Ciudad"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="managerId">Gerente</Label>
                            <select
                                id="managerId"
                                value={formData.managerId}
                                onChange={(e) =>
                                    setFormData({ ...formData, managerId: e.target.value })
                                }
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <option value="">Sin gerente</option>
                                {users.map((user) => (
                                    <option key={user.id} value={user.id}>
                                        {user.name || user.email}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="imssRegistroPatronal">Registro patronal IMSS</Label>
                            <Input
                                id="imssRegistroPatronal"
                                value={formData.imssRegistroPatronal}
                                maxLength={11}
                                autoCapitalize="characters"
                                placeholder="A1234567890"
                                aria-describedby="imssRegistroPatronal-help"
                                onChange={(e) =>
                                    setFormData({ ...formData, imssRegistroPatronal: e.target.value.toUpperCase() })
                                }
                            />
                            <p id="imssRegistroPatronal-help" className="text-xs text-muted-foreground">
                                Opcional. Once caracteres de la tarjeta patronal de esta sucursal. Sin este dato no se pueden preparar movimientos IMSS; puedes capturarlo después en el módulo IMSS → Configuración.
                            </p>
                        </div>

                        <div className="flex justify-end gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => router.push("/dashboard/company/branches")}
                            >
                                Cancelar
                            </Button>
                            <Button type="submit" disabled={loading}>
                                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Crear Sucursal
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
