import { db } from "@/lib/db";
import { employeeCommunications, users, communicationReadReceipts } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { notFound } from "next/navigation";
import ClientAnnouncementView from "./ClientAnnouncementView";

const JWT_SECRET = process.env.JWT_SECRET || "pulso-secret-key-12345";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function PublicAnnouncementPage({ params }: PageProps) {
  const { token } = await params;

  let decoded: { userId: string; announcementId: string } | null = null;
  try {
    decoded = jwt.verify(token, JWT_SECRET) as { userId: string; announcementId: string };
  } catch (err) {
    console.error("[Announcement] Invalid or expired token", err);
  }

  if (!decoded || !decoded.userId || !decoded.announcementId) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full text-center space-y-4 shadow-xl">
          <div className="w-12 h-12 bg-red-500/10 border border-red-500/20 rounded-full flex items-center justify-center mx-auto">
            <span className="text-red-500 text-2xl font-bold">⚠️</span>
          </div>
          <h1 className="text-xl font-bold text-slate-100">Enlace Inválido o Expirado</h1>
          <p className="text-slate-400 text-sm">
            Este enlace de comunicación no es válido o ha expirado. Por favor solicita uno nuevo.
          </p>
        </div>
      </div>
    );
  }

  // Fetch the announcement
  const announcement = await db.query.employeeCommunications.findFirst({
    where: eq(employeeCommunications.id, decoded.announcementId),
  });

  if (!announcement) {
    notFound();
  }

  // Fetch target user
  const targetUser = await db.query.users.findFirst({
    where: eq(users.id, decoded.userId),
  });

  if (!targetUser) {
    notFound();
  }

  // Check if read receipt already exists
  const [readReceipt] = await db
    .select()
    .from(communicationReadReceipts)
    .where(
      and(
        eq(communicationReadReceipts.communicationId, announcement.id),
        eq(communicationReadReceipts.userId, targetUser.id)
      )
    )
    .limit(1);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100 flex flex-col justify-between p-4 md:p-8">
      {/* Header */}
      <header className="max-w-2xl mx-auto w-full py-4 flex justify-between items-center border-b border-slate-800/60 mb-8">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white text-lg tracking-wider">
            P
          </div>
          <span className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
            Pulso
          </span>
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-800/80 border border-slate-700/50 text-slate-300">
          Comunicación Interna
        </span>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center w-full mb-12">
        <ClientAnnouncementView
          announcement={{
            id: announcement.id,
            title: announcement.title,
            content: announcement.content,
            communicationType: announcement.communicationType,
            sentAt: announcement.sentAt ? announcement.sentAt.toISOString() : null,
          }}
          user={{
            id: targetUser.id,
            name: targetUser.name || "Empleado",
          }}
          initialReadReceipt={
            readReceipt
              ? {
                  id: readReceipt.id,
                  readAt: readReceipt.readAt.toISOString(),
                }
              : null
          }
        />
      </main>

      {/* Footer */}
      <footer className="max-w-2xl mx-auto w-full py-4 text-center text-xs text-slate-500 border-t border-slate-800/60 mt-auto">
        <p>© {new Date().getFullYear()} Pulso HORECA. Todos los derechos reservados.</p>
      </footer>
    </div>
  );
}
