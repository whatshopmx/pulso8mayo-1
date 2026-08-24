import { NextResponse } from 'next/server';

/**
 * La ruta sin token ya no acepta POST: el webhook autenticado vive en
 * `/api/whatsapp/webhook/[token]` (WHAPI no soporta firmas HMAC, el secreto
 * va en la URL). Un POST aquí responde 405 por defecto.
 */
export async function GET() {
  return NextResponse.json({
    status: 'alive',
    service: 'whatsapp-webhook',
    supports: ['whapi'],
    auth: 'token-in-path',
  });
}
