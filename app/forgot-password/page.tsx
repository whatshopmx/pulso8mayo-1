import { PasswordRecovery } from "@/components/auth/password-recovery";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return <PasswordRecovery mode="request" enabled={Boolean(process.env.RESEND_API_KEY)} />;
}
