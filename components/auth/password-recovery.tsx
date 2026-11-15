"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/ui/auth-feedback";
import { AuthShell } from "./auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PasswordRecovery({ mode, token, enabled = true }: {
  mode: "request" | "reset"; token?: string; enabled?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const request = mode === "request";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    const form = new FormData(event.currentTarget);
    if (!request && form.get("password") !== form.get("confirmation")) {
      setError("Las contraseñas no coinciden. Escríbelas de nuevo.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = request
        ? await authClient.requestPasswordReset({ email: String(form.get("email")).trim(), redirectTo: `${window.location.origin}/reset-password` })
        : await authClient.resetPassword({ token, newPassword: String(form.get("password")) });
      if (result.error) setError(authErrorMessage(result.error.code));
      else setDone(true);
    } catch {
      setError("No pudimos conectar. Comprueba tu conexión y vuelve a intentarlo.");
    } finally { setLoading(false); }
  }

  return (
    <AuthShell title={request ? "Recupera tu acceso" : "Crea una nueva contraseña"}
      description={request ? "Te enviaremos un enlace para cambiar tu contraseña." : "Elige una contraseña de entre 8 y 128 caracteres."}>
      <div className="space-y-5">
        {done ? <p role="status" className="text-sm">{request
          ? "Si el correo tiene una cuenta en Pulso, recibirás un enlace. Revisa también tu carpeta de correo no deseado."
          : "Tu contraseña se actualizó. Inicia sesión con la nueva contraseña."}</p>
          : !enabled ? <p role="status" className="text-sm">La recuperación por correo no está disponible. Contacta al administrador de tu empresa para recuperar el acceso.</p>
          : !request && !token ? <div className="space-y-3"><p role="alert" className="text-sm">El enlace no es válido o ya venció. Solicita uno nuevo.</p><Link href="/forgot-password" className="text-sm text-primary underline underline-offset-4">Solicitar otro enlace</Link></div>
          : <form onSubmit={submit} className="space-y-4" aria-busy={loading} aria-describedby={error ? "recovery-error" : undefined}>
            {request ? <div className="space-y-2"><Label htmlFor="email">Correo electrónico</Label><Input id="email" name="email" type="email" required autoComplete="email" disabled={loading} className="text-base md:text-sm" /></div>
              : <>
                <div className="space-y-2"><Label htmlFor="password">Nueva contraseña</Label><Input id="password" name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" disabled={loading} className="text-base md:text-sm" /></div>
                <div className="space-y-2"><Label htmlFor="confirmation">Confirmar contraseña</Label><Input id="confirmation" name="confirmation" type="password" required minLength={8} maxLength={128} autoComplete="new-password" disabled={loading} className="text-base md:text-sm" /></div>
              </>}
            {error && <p id="recovery-error" role="alert" className="text-sm text-destructive">{error}</p>}
            {!request && error && <Link href="/forgot-password" className="block text-sm text-primary underline underline-offset-4">Solicitar otro enlace</Link>}
            <Button type="submit" disabled={loading} className="w-full">{loading ? "Procesando…" : request ? "Enviar enlace" : "Guardar contraseña"}</Button>
          </form>}
        <Link href="/sign-in" className="block text-center text-sm text-primary underline underline-offset-4">Volver a iniciar sesión</Link>
      </div>
    </AuthShell>
  );
}
