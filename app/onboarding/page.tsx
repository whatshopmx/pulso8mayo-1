"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

const onboardingSchema = z.object({
    companyName: z.string().trim().min(2, "El nombre de la empresa debe tener al menos 2 caracteres"),
    branchName: z.string().trim().min(2, "El nombre de la sucursal debe tener al menos 2 caracteres"),
    address: z.string().optional(),
});

type OnboardingValues = z.infer<typeof onboardingSchema>;

export default function OnboardingPage() {
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
        if (loading) return;
        form.clearErrors("root");
        setLoading(true);
        try {
            // 1. Create Company and Branch via composite endpoint
            const onboardingRes = await fetch("/api/onboarding", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data)
            });

            if (!onboardingRes.ok) {
                throw new Error("No se pudo completar la configuración. Conservamos tus datos; vuelve a intentarlo.");
            }

            toast.success("Configuración completada!");

            // CRITICAL: Force a full page reload to refresh the session cookie
            // Using window.location.href ensures the middleware re-validates the session
            // and picks up the updated companyId from the database
            window.location.href = "/dashboard";

        } catch (error: unknown) {
            console.error(error);
            const message = error instanceof Error ? error.message : "No se pudo completar la configuración. Vuelve a intentarlo.";
            form.setError("root", { message });
            toast.error(message);
        } finally {
            setLoading(false);
        }
    }

    return (
        <main className="flex min-h-svh items-center justify-center bg-muted/30 px-4 py-8">
            <Card className="w-full max-w-lg shadow-none">
                <CardHeader className="space-y-1">
                    <CardTitle className="text-2xl font-bold"><h1>Bienvenido a Pulso</h1></CardTitle>
                    <CardDescription>
                        Configuremos tu espacio de trabajo. Cuéntanos sobre tu empresa y tu primera sucursal.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" aria-busy={loading}>
                            <FormField
                                control={form.control}
                                name="companyName"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Nombre de la Empresa</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Ej. Restaurantes SA de CV" autoComplete="organization" disabled={loading} {...field} />
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
                                                <Input placeholder="Matriz" disabled={loading} {...field} />
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
                                                <Input placeholder="Av. Reforma 123" autoComplete="street-address" disabled={loading} {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            {form.formState.errors.root && <p role="alert" className="text-sm text-destructive">{form.formState.errors.root.message}</p>}
                            <Button type="submit" className="w-full" disabled={loading}>
                                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {loading ? "Configurando..." : "Completar Configuración"}
                            </Button>
                        </form>
                    </Form>
                </CardContent>
            </Card>
        </main>
    );
}
