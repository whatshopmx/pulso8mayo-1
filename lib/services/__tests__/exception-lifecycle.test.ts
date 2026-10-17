import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  allowedEvents,
  isTerminal,
  transition,
  type ExceptionEvent,
  type ExceptionStatus,
  type TransitionContext,
} from "../exception-lifecycle";

/**
 * Phase 0 / Task 3 — máquina de estados pura.
 *
 * Se barre la matriz completa estado × evento (9 × 8 = 72): cada par es
 * legal o ilegal, sin muestrear.
 */

const STATUSES: ExceptionStatus[] = [
  "OPEN",
  "ASSIGNED",
  "IN_ACTION",
  "RESOLVED",
  "VERIFIED",
  "CLOSED",
  "REOPENED",
  "ESCALATED",
  "CANCELLED",
];

const EVENTS: ExceptionEvent[] = [
  "ASSIGN",
  "START_ACTION",
  "RESOLVE",
  "VERIFY",
  "CLOSE",
  "REOPEN",
  "ESCALATE",
  "CANCEL",
];

/** Transiciones legales del diagrama D3, con su contexto válido. */
const LEGAL: Array<{
  from: ExceptionStatus;
  event: ExceptionEvent;
  to: ExceptionStatus;
  ctx: TransitionContext;
}> = [
  { from: "OPEN", event: "ASSIGN", to: "ASSIGNED", ctx: { ownerId: "u-owner" } },
  { from: "OPEN", event: "ESCALATE", to: "ESCALATED", ctx: { reason: "SLA" } },
  { from: "OPEN", event: "CANCEL", to: "CANCELLED", ctx: {} },

  { from: "ASSIGNED", event: "ASSIGN", to: "ASSIGNED", ctx: { ownerId: "u-owner" } },
  { from: "ASSIGNED", event: "START_ACTION", to: "IN_ACTION", ctx: {} },
  { from: "ASSIGNED", event: "ESCALATE", to: "ESCALATED", ctx: {} },
  { from: "ASSIGNED", event: "CANCEL", to: "CANCELLED", ctx: {} },

  { from: "IN_ACTION", event: "ASSIGN", to: "ASSIGNED", ctx: { ownerId: "u-owner" } },
  { from: "IN_ACTION", event: "RESOLVE", to: "RESOLVED", ctx: { resolution: "corregido" } },
  { from: "IN_ACTION", event: "ESCALATE", to: "ESCALATED", ctx: {} },
  { from: "IN_ACTION", event: "CANCEL", to: "CANCELLED", ctx: {} },

  {
    from: "RESOLVED",
    event: "VERIFY",
    to: "VERIFIED",
    ctx: { actorId: "u-verifier", resolvedBy: "u-resolver" },
  },
  { from: "RESOLVED", event: "REOPEN", to: "REOPENED", ctx: { reason: "reincidió" } },
  { from: "RESOLVED", event: "ESCALATE", to: "ESCALATED", ctx: {} },
  { from: "RESOLVED", event: "CANCEL", to: "CANCELLED", ctx: {} },

  { from: "VERIFIED", event: "CLOSE", to: "CLOSED", ctx: {} },
  { from: "VERIFIED", event: "REOPEN", to: "REOPENED", ctx: { reason: "evidencia falsa" } },
  { from: "VERIFIED", event: "ESCALATE", to: "ESCALATED", ctx: {} },

  { from: "CLOSED", event: "REOPEN", to: "REOPENED", ctx: { reason: "error de cierre" } },

  { from: "REOPENED", event: "ASSIGN", to: "ASSIGNED", ctx: { ownerId: "u-owner" } },
  { from: "REOPENED", event: "START_ACTION", to: "IN_ACTION", ctx: {} },
  { from: "REOPENED", event: "ESCALATE", to: "ESCALATED", ctx: {} },
  { from: "REOPENED", event: "CANCEL", to: "CANCELLED", ctx: {} },

  { from: "ESCALATED", event: "ASSIGN", to: "ASSIGNED", ctx: { ownerId: "u-owner" } },
  { from: "ESCALATED", event: "START_ACTION", to: "IN_ACTION", ctx: {} },
  { from: "ESCALATED", event: "RESOLVE", to: "RESOLVED", ctx: { resolution: "atendido" } },
  { from: "ESCALATED", event: "CANCEL", to: "CANCELLED", ctx: {} },
];

const LEGAL_KEYS = new Set(LEGAL.map((t) => `${t.from}:${t.event}`));

describe("transition — transiciones legales (D3)", () => {
  it.each(LEGAL)("$from --$event--> $to", ({ from, event, to, ctx }) => {
    const result = transition(from, event, ctx);
    expect(result.ok).toBe(true);
    expect(result.to).toBe(to);
    expect(result.reason).toBeNull();
  });

  it("ninguna transición legal falta en la matriz de referencia", () => {
    expect(LEGAL_KEYS.size).toBe(LEGAL.length);
  });
});

describe("transition — combinaciones ilegales", () => {
  const illegal = STATUSES.flatMap((from) =>
    EVENTS.filter((event) => !LEGAL_KEYS.has(`${from}:${event}`)).map((event) => ({
      from,
      event,
    })),
  );

  it("la matriz cubre los 72 pares estado × evento", () => {
    expect(illegal.length + LEGAL.length).toBe(STATUSES.length * EVENTS.length);
  });

  it.each(illegal)("$from --$event--> se rechaza", ({ from, event }) => {
    // Contexto "generoso": aunque se cumplan guardas, el par es ilegal.
    const ctx: TransitionContext = {
      ownerId: "u-owner",
      resolution: "x",
      actorId: "u-verifier",
      resolvedBy: "u-resolver",
      reason: "motivo",
    };
    const result = transition(from, event, ctx);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Transición ilegal");
  });
});

describe("transition — guardas", () => {
  it("ASSIGN exige ownerId no vacío", () => {
    const result = transition("OPEN", "ASSIGN", { ownerId: "   " });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("ownerId");
  });

  it("RESOLVE exige resolution no vacía", () => {
    const result = transition("IN_ACTION", "RESOLVE", {});
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("resolution");
  });

  it("VERIFY exige actorId y resolvedBy", () => {
    const result = transition("RESOLVED", "VERIFY", { actorId: "u1" });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("actorId y resolvedBy");
  });

  it("VERIFY rechaza al mismo resolvedor (segregación de funciones)", () => {
    const result = transition("RESOLVED", "VERIFY", {
      actorId: "u-same",
      resolvedBy: "u-same",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Segregación");
  });

  it("REOPEN exige reason no vacía", () => {
    const result = transition("CLOSED", "REOPEN", { reason: " " });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("reason");
  });

  it("CLOSE solo es legal desde VERIFIED", () => {
    expect(transition("RESOLVED", "CLOSE", {}).ok).toBe(false);
    const closed = transition("VERIFIED", "CLOSE", {});
    expect(closed.ok).toBe(true);
    expect(closed.to).toBe("CLOSED");
  });
});

describe("isTerminal / allowedEvents", () => {
  it("CLOSED y CANCELLED son terminales", () => {
    expect(isTerminal("CLOSED")).toBe(true);
    expect(isTerminal("CANCELLED")).toBe(true);
    for (const status of STATUSES.filter((s) => s !== "CLOSED" && s !== "CANCELLED")) {
      expect(isTerminal(status), status).toBe(false);
    }
  });

  it("CANCELLED no admite ningún evento", () => {
    expect(allowedEvents("CANCELLED")).toEqual([]);
  });

  it("allowedEvents coincide con la matriz legal", () => {
    for (const status of STATUSES) {
      const esperados = LEGAL.filter((t) => t.from === status).map((t) => t.event);
      expect(allowedEvents(status).sort(), status).toEqual([...esperados].sort());
    }
  });
});

describe("pureza — sin acceso a base de datos", () => {
  it("el módulo no importa db/drizzle", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../exception-lifecycle.ts", import.meta.url)),
      "utf8",
    );
    expect(source).not.toMatch(/from\s+["']@?\/?lib\/db["']/);
    expect(source).not.toMatch(/drizzle-orm/);
  });
});
