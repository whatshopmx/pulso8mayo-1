import { Receiver } from "@upstash/qstash";
import type { NextRequest } from "next/server";

/**
 * Verificación de peticiones internas firmadas por QStash.
 *
 * Algunos endpoints de `/api` son llamados por infraestructura (QStash) y no
 * por una persona con sesión, así que no pueden usar `withTenantAuth` ni ABAC.
 * El control correcto para ese caso es la firma HMAC que QStash ya agrega a
 * cada entrega (`upstash-signature`).
 *
 * Regla: **falla cerrado**. Sin llave de firma configurada, o sin encabezado,
 * o con firma inválida, devuelve `false`. Un endpoint que dependa de esto
 * responde 401 en vez de procesar.
 *
 * Se reutiliza el `Receiver` del SDK ya instalado (`@upstash/qstash`); no se
 * implementa criptografía propia.
 */
const SIGNATURE_HEADER = "upstash-signature";

export async function verifyQstashSignature(
  req: NextRequest,
  rawBody: string
): Promise<boolean> {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;

  // Sin llave no hay forma de verificar: se rechaza.
  if (!currentSigningKey) return false;

  const signature = req.headers.get(SIGNATURE_HEADER);
  if (!signature) return false;

  try {
    const receiver = new Receiver({ currentSigningKey, nextSigningKey });
    return await receiver.verify({ signature, body: rawBody });
  } catch {
    // `SignatureError` u otro fallo del verificador: firma inválida.
    return false;
  }
}
