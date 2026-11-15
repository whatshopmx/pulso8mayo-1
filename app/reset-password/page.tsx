import { PasswordRecovery } from "@/components/auth/password-recovery";

export default async function ResetPasswordPage({ searchParams }: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const params = await searchParams;
  return <PasswordRecovery mode="reset" token={params.error ? undefined : params.token} />;
}
