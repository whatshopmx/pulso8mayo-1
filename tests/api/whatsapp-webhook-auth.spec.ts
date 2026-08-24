import "dotenv/config";
import { test, expect } from "@playwright/test";

/**
 * Regresión: el webhook de WhatsApp está autenticado por token en la ruta.
 *
 * Historia: `/api/whatsapp/webhook` aceptaba POST de cualquiera — bastaba
 * conocer la URL para publicar mensajes falsos, persistirlos y disparar
 * `whatsapp-router` en Inngest (ejecutar workflows y mandar notificaciones a
 * nombre de un empleado).
 *
 * El arreglo movió el webhook a `/api/whatsapp/webhook/[token]` con secreto
 * comparado timing-safe (`WHAPI_WEBHOOK_TOKEN`), 404 silencioso en mismatch y
 * emisión idempotente (`id = message.id`). Este spec impide que se revierta.
 *
 * Nota: la deduplicación del `message.id` vive en Inngest (ventana de 24 h),
 * no en el HTTP handler — ese nivel se cubre en la capa 06 (@inngest/test),
 * no aquí.
 */

const TOKEN = process.env.WHAPI_WEBHOOK_TOKEN;

test.describe("Webhook de WhatsApp autenticado por token", () => {
  test.skip(!TOKEN, "Requiere WHAPI_WEBHOOK_TOKEN en .env");

  test("la ruta raíz sin token no acepta POST", async ({ request }) => {
    const res = await request.post("/api/whatsapp/webhook", {
      data: { messages: [] },
    });
    // Solo exporta GET; Next responde 405 por defecto. Lo importante es que
    // NO sea 2xx: ningún payload entra por la puerta vieja.
    expect(res.ok()).toBe(false);
    expect([404, 405]).toContain(res.status());
  });

  test("token inválido responde 404 sin procesar nada", async ({ request }) => {
    const res = await request.post(`/api/whatsapp/webhook/token-falso-${Date.now()}`, {
      data: {
        messages: [
          {
            id: `e2e-fake-${Date.now()}`,
            from_me: false,
            type: "text",
            chat_id: "+52999E2E0001@s.whatsapp.net",
            timestamp: Math.floor(Date.now() / 1000),
            text: { body: "[E2E] intento de suplantación" },
            from: "+52999E2E0001",
          },
        ],
      },
    });
    expect(res.status()).toBe(404);
    // El mismatch no revela que la ruta existe.
    expect(await res.text()).not.toContain("ok");
  });

  test("token corto no pasa aunque alguien recorte el secreto", async ({ request }) => {
    // La guardia exige >=16 caracteres en el env; un token de relleno de 15
    // tiene que caer en el mismo 404 que uno largo incorrecto.
    const res = await request.post("/api/whatsapp/webhook/123456789012345", {
      data: {},
    });
    expect(res.status()).toBe(404);
  });

  test("token válido + statuses → 200 ok (ruta autorizada, sin depender de Inngest)", async ({
    request,
  }) => {
    // Los status updates son escrituras directas a la BD, no tocan Inngest —
    // prueban la puerta autorizada sin efectos colaterales.
    const res = await request.post(`/api/whatsapp/webhook/${TOKEN}`, {
      data: {
        statuses: [
          {
            id: `e2e-status-${Date.now()}`,
            status: "delivered",
            chat_id: "+52999E2E0001@s.whatsapp.net",
            timestamp: Math.floor(Date.now() / 1000),
          },
        ],
      },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).status).toBe("ok");
  });

  test("token válido + mensaje: 200 con Inngest, 500 sin él (para que el proveedor reintente)", async ({
    request,
  }) => {
    // El handler emite `whatsapp/message.received` y devuelve 500 si la
    // emisión falla (semántica at-least-once documentada en la ruta). Sin
    // INNGEST_DEV ni event key, ese 500 es el comportamiento correcto aquí.
    const inngestConfigurado =
      process.env.INNGEST_DEV === "1" || !!process.env.INNGEST_EVENT_KEY;
    const res = await request.post(`/api/whatsapp/webhook/${TOKEN}`, {
      data: {
        messages: [
          {
            id: `e2e-webhook-ok-${Date.now()}`,
            from_me: false,
            type: "text",
            chat_id: "+52999E2E0001@s.whatsapp.net",
            timestamp: Math.floor(Date.now() / 1000),
            text: { body: "[E2E] mensaje legítimo de prueba" },
            from: "+52999E2E0001",
          },
        ],
      },
    });
    if (inngestConfigurado) {
      expect(res.status()).toBe(200);
      expect((await res.json()).status).toBe("ok");
    } else {
      // La emisión falla y el handler responde 500 a propósito.
      expect(res.status()).toBe(500);
    }
  });

  test("token válido + JSON malformado no responde 200", async ({ request }) => {
    const res = await request.post(`/api/whatsapp/webhook/${TOKEN}`, {
      headers: { "content-type": "application/json" },
      // Buffer crudo: si se pasa un string, Playwright lo serializa como JSON
      // (string citado, que parsea bien) y el test probaría otra cosa.
      data: Buffer.from("{no es json", "utf-8"),
    });
    expect(res.ok()).toBe(false);
    expect(res.status()).toBe(500);
  });

  test("GET raíz sigue vivo para health checks", async ({ request }) => {
    const res = await request.get("/api/whatsapp/webhook");
    expect(res.ok()).toBe(true);
    expect((await res.json()).auth).toBe("token-in-path");
  });
});
