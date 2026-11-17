import { Suspense } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { ProfileClient } from "./profile-client";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
    const session = await getSession();
    if (!session?.user) {
        redirect("/sign-in");
    }

    const userPromise = db.query.users
        .findFirst({ where: eq(users.id, session.user.id) })
        .then((dbUser) =>
            dbUser ?? {
                id: session.user.id,
                name: session.user.name ?? null,
                email: session.user.email,
                image: session.user.image ?? null,
                role: (session.user as { role?: string | null }).role ?? null,
                phone: null,
                companyId: (session.user as { companyId?: string | null }).companyId ?? null,
                branchId: (session.user as { branchId?: string | null }).branchId ?? null,
            }
        );

    return (
        <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Cargando perfil...</div>}>
            <ProfileClient userPromise={userPromise} />
        </Suspense>
    );
}
