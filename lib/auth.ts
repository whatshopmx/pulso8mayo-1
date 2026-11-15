import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import { users, sessions, account, verifications } from "./db/schema";
import { nextCookies } from "better-auth/next-js";
import { authConfig } from "./auth-config";
import { after } from "next/server";
import { sendEmail } from "./services/email-service";

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: "pg",
        schema: {
            user: users,
            session: sessions,
            account: account,
            verification: verifications
        },
    }),
    plugins: [
        nextCookies()
    ],
    emailAndPassword: {
        enabled: true,
        revokeSessionsOnPasswordReset: true,
        sendResetPassword: async ({ user, url }) => {
            // Schedule delivery after the response so account existence does not
            // change the response latency. Never log the recovery URL/token.
            after(async () => {
                const result = await sendEmail({
                    to: user.email,
                    subject: "Recupera tu acceso a Pulso",
                    text: `Solicitaste cambiar tu contraseña de Pulso. Abre este enlace: ${url}\n\nEl enlace vence en una hora. Si no lo solicitaste, ignora este correo.`,
                });
                if (!result.success) console.error("[Auth] No se pudo entregar el correo de recuperación.");
            });
        },
    },
    // Merge custom config with defaults
    session: authConfig.session,
    advanced: authConfig.advanced,
    user: {
        ...authConfig.user,
        additionalFields: {
            companyId: {
                type: "string",
                required: false
            },
            branchId: {
                type: "string",
                required: false
            },
            role: {
                type: "string",
                required: false
            },
            phone: {
                type: "string",
                required: false
            }
        }
    },
    rateLimit: authConfig.rateLimit,
});

import { headers } from "next/headers";

export const getSession = async () => {
    return await auth.api.getSession({
        headers: await headers()
    });
};
