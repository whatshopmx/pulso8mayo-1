"use client";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth/auth-shell";
import { authErrorMessage, postLoginPath } from "@/lib/ui/auth-feedback";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";

export default function SignIn() {
  const t = useTranslations("auth.signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const signIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await authClient.signIn.email({
        email: email.trim(),
        password,
      });
      if (result.error) setError(authErrorMessage(result.error.code));
      else router.push(postLoginPath(new URLSearchParams(window.location.search).get("callbackUrl")));
    } catch {
      setError("No pudimos conectar. Comprueba tu conexión y vuelve a intentarlo.");
    } finally { setLoading(false); }
  };

  return (
    <AuthShell title={t("title")} description={t("subtitle")}>
      <form onSubmit={signIn} className="space-y-4" aria-busy={loading} aria-describedby={error ? "auth-error" : undefined}>
          <div className="space-y-2">
            <Label htmlFor="email">{t("email")}</Label>
            <Input
              id="email"
              type="email"
              name="email" autoComplete="username" required disabled={loading} className="text-base md:text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("emailPlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{t("password")}</Label>
            <Input
              id="password"
              type="password"
              name="password" autoComplete="current-password" required disabled={loading} className="text-base md:text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("passwordPlaceholder")}
            />
          </div>
          <Link href="/forgot-password" className="block text-sm text-primary underline underline-offset-4">¿Olvidaste tu contraseña?</Link>
          {error && <p id="auth-error" role="alert" className="text-sm text-destructive">{error}</p>}
          <Button className="w-full" type="submit" disabled={loading}>
            {loading ? t("signingIn") : t("signInButton")}
          </Button>
          <p className="text-sm text-center">
            {t("noAccount")}{" "}
            <Link href="/sign-up" className="text-primary underline underline-offset-4">
              {t("signUp")}
            </Link>
          </p>
      </form>
    </AuthShell>
  );
}
