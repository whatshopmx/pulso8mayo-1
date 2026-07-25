import "dotenv/config";
import { db } from "@/lib/db";
import {
  whatsappSessions, whatsappConversationStates, whatsappMessages, magicLinks,
} from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  COMPANY_ID, BRANCH_CONDESA, BRANCH_POLANCO,
  USER_ADMIN, USER_GERENTE, USER_EMPLEADO_1, USER_EMPLEADO_2,
} from "./seed-constants";

function randomDate(daysAgo: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - Math.floor(Math.random() * daysAgo));
  return d;
}

export async function main() {
  console.log("=== Phase 9: WhatsApp ===");
  console.log("Cleaning up...");

  await db.delete(magicLinks).where(sql`1=1`);
  await db.delete(whatsappMessages).where(sql`1=1`);
  await db.delete(whatsappConversationStates).where(sql`1=1`);
  await db.delete(whatsappSessions).where(sql`1=1`);

  console.log("Creating WhatsApp session...");
  const [session] = await db.insert(whatsappSessions).values({
    companyId: COMPANY_ID,
    sessionId: "wa-session-demo-001",
    phoneNumber: "+525511110001",
    status: "DISCONNECTED",
    webhookUrl: "https://pulso.mx/api/whatsapp/webhook",
    isActive: true,
    lastError: "Session expired - QR rescan required",
    errorCount: 2,
    createdBy: USER_ADMIN,
  }).returning({ id: whatsappSessions.id });

  console.log("Creating conversation states...");
  const [conv1] = await db.insert(whatsappConversationStates).values({
    userPhone: "+525511110005",
    userId: USER_EMPLEADO_1,
    status: "COMPLETED",
    context: { workflowId: "apertura-restaurante-v2", step: "checklist-final" } as unknown as Record<string, unknown>,
    lastMessageAt: randomDate(2),
  }).returning({ id: whatsappConversationStates.id });

  const [conv2] = await db.insert(whatsappConversationStates).values({
    userPhone: "+525511110006",
    userId: USER_EMPLEADO_2,
    status: "WAITING_EVIDENCE",
    context: { workflowId: "control-temperaturas-v1", step: "photo-evidence" } as unknown as Record<string, unknown>,
    lastMessageAt: randomDate(1),
  }).returning({ id: whatsappConversationStates.id });

  const [conv3] = await db.insert(whatsappConversationStates).values({
    userPhone: "+525511110003",
    userId: USER_GERENTE,
    status: "ACTIVE",
    context: { workflowId: "reporte-incidentes-v2", step: "descripcion" } as unknown as Record<string, unknown>,
    lastMessageAt: new Date(),
  }).returning({ id: whatsappConversationStates.id });

  console.log("Creating WhatsApp messages...");
  type Msg = { sessionId: string; direction: string; fromNum: string; toNum: string; contentType: string; content: string; status: string; mediaUrl?: string; externalId?: string };
  const messageDefs: Msg[] = [
    { sessionId: session.id, direction: "INBOUND", fromNum: "+525511110005", toNum: "+525511110001", contentType: "text", content: "Buenos días, voy a iniciar el check-in", status: "read" },
    { sessionId: session.id, direction: "OUTBOUND", fromNum: "+525511110001", toNum: "+525511110005", contentType: "text", content: "¡Hola! Por favor confirma tu ubicación para registrar tu entrada.", status: "read" },
    { sessionId: session.id, direction: "INBOUND", fromNum: "+525511110005", toNum: "+525511110001", contentType: "text", content: "Estoy en Condesa, listo para comenzar", status: "read" },
    { sessionId: session.id, direction: "OUTBOUND", fromNum: "+525511110001", toNum: "+525511110005", contentType: "text", content: "✅ Check-in registrado. Tu turno inicia a las 07:00. ¡Buen trabajo!", status: "read" },
    { sessionId: session.id, direction: "INBOUND", fromNum: "+525511110005", toNum: "+525511110001", contentType: "image", content: "Foto de check-in", status: "read", mediaUrl: "https://pulso.ejemplo/evidencia/checkin-001.jpg" },
    { sessionId: session.id, direction: "OUTBOUND", fromNum: "+525511110001", toNum: "+525511110006", contentType: "text", content: "⏰ Recordatorio: Debes tomar lectura de temperatura del refrigerador principal.", status: "delivered" },
    { sessionId: session.id, direction: "INBOUND", fromNum: "+525511110006", toNum: "+525511110001", contentType: "text", content: "¡Ya voy!", status: "delivered" },
    { sessionId: session.id, direction: "INBOUND", fromNum: "+525511110006", toNum: "+525511110001", contentType: "image", content: "Termómetro marcando 4°C", status: "sent", mediaUrl: "https://pulso.ejemplo/evidencia/temp-002.jpg" },
    { sessionId: session.id, direction: "INBOUND", fromNum: "+525511110003", toNum: "+525511110001", contentType: "text", content: "Hubo un incidente en la cocina, se cayó una bandeja", status: "read" },
    { sessionId: session.id, direction: "OUTBOUND", fromNum: "+525511110001", toNum: "+525511110003", contentType: "text", content: "Lo siento. Por favor describe el incidente con más detalle:", status: "read" },
    { sessionId: session.id, direction: "INBOUND", fromNum: "+525511110003", toNum: "+525511110001", contentType: "text", content: "Una bandeja con vidrios se rompió cerca del área de preparación", status: "read" },
    { sessionId: session.id, direction: "OUTBOUND", fromNum: "+525511110001", toNum: "+525511110003", contentType: "text", content: "Gracias. Se ha creado un reporte de incidente. ¿Puedes enviar una foto?", status: "read" },
    { sessionId: session.id, direction: "INBOUND", fromNum: "+525511110003", toNum: "+525511110001", contentType: "text", content: "Claro, en un momento", status: "read" },
    { sessionId: session.id, direction: "INBOUND", fromNum: "+525511110003", toNum: "+525511110001", contentType: "image", content: "Foto del área afectada", status: "sent", mediaUrl: "https://pulso.ejemplo/evidencia/incident-vidrios.jpg" },
  ];

  const messageValues = messageDefs.map(msg => ({
    sessionId: msg.sessionId,
    direction: msg.direction,
    from: msg.fromNum,
    to: msg.toNum,
    messageType: msg.contentType,
    content: msg.content,
    mediaUrl: msg.mediaUrl,
    status: msg.status,
    timestamp: randomDate(5),
  }));
  await db.insert(whatsappMessages).values(messageValues);

  console.log("Creating magic links...");
  const [wsApertura] = await db.select({ id: whatsappSessions.id }).from(whatsappSessions).limit(1);
  const link1 = { token: "ml-apertura-001", sessionId: wsApertura.id, instanceId: "00000000-0000-0000-0000-000000000001" as string, workflowTemplateId: "apertura-restaurante-v2", expiresAt: new Date(Date.now() + 7 * 86400000), status: "PENDING" };
  const link2 = { token: "ml-temp-002", sessionId: wsApertura.id, instanceId: "00000000-0000-0000-0000-000000000002" as string, workflowTemplateId: "control-temperaturas-v1", expiresAt: new Date(Date.now() + 7 * 86400000), status: "PENDING" };
  const link3 = { token: "ml-report-003", sessionId: wsApertura.id, instanceId: "00000000-0000-0000-0000-000000000003" as string, workflowTemplateId: "reporte-incidentes-v2", expiresAt: new Date(Date.now() - 1 * 86400000), status: "USED" as string, usedAt: randomDate(3) };
  await db.insert(magicLinks).values([link1, link2, link3]);

  console.log("Phase 9 complete!");
}
