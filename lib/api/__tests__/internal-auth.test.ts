import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";

import { verifyQstashSignature } from "../internal-auth";

/**
 * S-2 (Phase -1 / security gate) — auth de endpoints internos.
 *
 * `verifyQstashSignature` debe **fallar cerrado**: sin llave, sin encabezado o
 * con firma inválida, devuelve `false`. Estos casos son los que protegen
 * `/api/notifications/process`.
 *
 * La verificación de una firma VÁLIDA se delega al `Receiver` del SDK y se
 * prueba en su propia suite; aquí se cubre la frontera de rechazo.
 */

const reqWith = (signature?: string): NextRequest =>
  ({
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "upstash-signature" ? signature ?? null : null,
    },
  }) as unknown as NextRequest;

const KEYS = ["QSTASH_CURRENT_SIGNING_KEY", "QSTASH_NEXT_SIGNING_KEY"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("verifyQstashSignature — falla cerrado", () => {
  it("sin llave de firma configurada → false aunque venga encabezado", async () => {
    delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    delete process.env.QSTASH_NEXT_SIGNING_KEY;
    await expect(verifyQstashSignature(reqWith("cualquier-firma"), "{}")).resolves.toBe(
      false
    );
  });

  it("con llave pero sin encabezado de firma → false", async () => {
    process.env.QSTASH_CURRENT_SIGNING_KEY = "signing-key";
    await expect(verifyQstashSignature(reqWith(undefined), "{}")).resolves.toBe(false);
  });

  it("con llave y firma inválida → false", async () => {
    process.env.QSTASH_CURRENT_SIGNING_KEY = "signing-key";
    await expect(verifyQstashSignature(reqWith("firma-invalida"), "{}")).resolves.toBe(
      false
    );
  });
});
