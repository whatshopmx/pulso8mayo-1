"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CompanyService } from "@/lib/services/company-service";
import { authClient } from "@/lib/auth-client";
import { Loader2 } from "lucide-react";

const onboardingSchema = z.object({
    companyName: z.string().min(2, "El nombre de la empresa debe tener al menos 2 caracteres"),
    branchName: z.string().min(2, "El nombre de la sucursal debe tener al menos 2 caracteres"),
    address: z.string().optional(),
});

type OnboardingValues = z.infer<typeof onboardingSchema>;

export default function OnboardingPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);

    const form = useForm<OnboardingValues>({
        resolver: zodResolver(onboardingSchema),
        defaultValues: {
            companyName: "",
            branchName: "Matriz",
            address: "",
        },
    });

    async function onSubmit(data: OnboardingValues) {
        setLoading(true);
        try {
            // 1. Create Company and Branch via composite endpoint
            const onboardingRes = await fetch("/api/onboarding", {
                method: "POST",
                body: JSON.stringify(data)
            });

            if (!onboardingRes.ok) {
                const error = await onboardingRes.json();
                throw new Error(error.error?.message || error.message || "Onboarding failed");
            }

            const result = await onboardingRes.json();

            console.log("Onboarding success:", result);
            toast.success("Configuración completada!");

            // CRITICAL: Force a full page reload to refresh the session cookie
            // Using window.location.href ensures the middleware re-validates the session
            // and picks up the updated companyId from the database
            window.location.href = "/dashboard";

        } catch (error: any) {
            console.error(error);
            toast.error(error.message || "Error al completar la configuración. Inténtalo de nuevo.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50/50 p-4">
            <Card className="w-full max-w-lg shadow-lg">
                <CardHeader className="space-y-1">
                    <CardTitle className="text-2xl font-bold">Bienvenido a Pulso</CardTitle>
                    <CardDescription>
                        Configuremos tu espacio de trabajo. Cuéntanos sobre tu empresa y tu primera sucursal.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                            <FormField
                                control={form.control}
                                name="companyName"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Nombre de la Empresa</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Ej. Restaurantes SA de CV" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                <FormField
                                    control={form.control}
                                    name="branchName"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Nombre de Sucursal</FormLabel>
                                            <FormControl>
                                                <Input placeholder="Matriz" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="address"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Dirección (Opcional)</FormLabel>
                                            <FormControl>
                                                <Input placeholder="Av. Reforma 123" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            <Button type="submit" className="w-full" disabled={loading}>
                                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {loading ? "Configurando..." : "Completar Configuración"}
                            </Button>
                        </form>
                    </Form>
                </CardContent>
            </Card>
        </div>
    );
}
