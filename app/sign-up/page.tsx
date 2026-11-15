"use client";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth/auth-shell";
import { authErrorMessage } from "@/lib/ui/auth-feedback";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";

export default function SignUp() {
  const t = useTranslations("auth.signUp");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const signUp = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await authClient.signUp.email({
        email: email.trim(),
        password,
        name: name.trim(),
      });
      if (result.error) setError(authErrorMessage(result.error.code));
      else router.push("/onboarding");
    } catch {
      setError("No pudimos conectar. Comprueba tu conexión y vuelve a intentarlo.");
    } finally { setLoading(false); }
  };

  return (
    <AuthShell title={t("title")} description={t("subtitle")}>
      <form onSubmit={signUp} className="space-y-4" aria-busy={loading} aria-describedby={error ? "auth-error" : undefined}>
          <div className="space-y-2">
            <Label htmlFor="name">{t("fullName")}</Label>
            <Input
              id="name"
              type="text"
              name="name" autoComplete="name" required maxLength={100} disabled={loading} className="text-base md:text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("fullNamePlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">{t("email")}</Label>
            <Input
              id="email"
              type="email"
              name="email" autoComplete="email" required disabled={loading} className="text-base md:text-sm"
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
              name="password" autoComplete="new-password" required minLength={8} maxLength={128} disabled={loading} className="text-base md:text-sm" aria-describedby="password-hint"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("passwordPlaceholder")}
            />
          </div>
          <p id="password-hint" className="text-sm text-muted-foreground">Usa entre 8 y 128 caracteres.</p>
          {error && <p id="auth-error" role="alert" className="text-sm text-destructive">{error}</p>}
          <Button className="w-full" type="submit" disabled={loading}>
            {loading ? t("creating") : t("createButton")}
          </Button>
          <p className="text-sm text-center">
            {t("haveAccount")}{" "}
            <Link href="/sign-in" className="text-primary underline underline-offset-4">
              {t("signIn")}
            </Link>
          </p>
      </form>
    </AuthShell>
  );
}
