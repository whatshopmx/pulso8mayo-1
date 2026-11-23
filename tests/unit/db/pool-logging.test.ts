import { afterEach, beforeEach, expect, it, vi } from "vitest";

const pool = vi.hoisted(() => ({ error: undefined as ((error: unknown) => void) | undefined }));
vi.mock("@neondatabase/serverless", () => ({
  neonConfig: {},
  Pool: class {
    on(event: string, listener: (error: unknown) => void) { if (event === "error") pool.error = listener; return this; }
  },
}));
vi.mock("drizzle-orm/neon-serverless", () => ({ drizzle: () => ({}) }));

const globals = globalThis as typeof globalThis & { __pulsoPool?: unknown };
beforeEach(() => {
  vi.resetModules();
  delete globals.__pulsoPool;
  pool.error = undefined;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); delete globals.__pulsoPool; });

it("el evento del pool conserva SQLSTATE sin volcar credenciales, cliente ni mensaje", async () => {
  await import("@/lib/db");
  pool.error!(Object.assign(new Error("postgresql://owner:synthetic-password@unit.invalid/db"), {
    code: "57P01", client: { connectionParameters: { password: "synthetic-password" } },
  }));
  const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
  expect(logged).toContain("57P01");
  expect(logged).not.toContain("synthetic-password");
  expect(logged).not.toContain("unit.invalid");
  expect(logged).not.toContain("connectionParameters");
});
it("un código desconocido tampoco se copia al log", async () => {
  await import("@/lib/db");
  pool.error!({ code: "synthetic-secret-value", message: "synthetic-password" });
  const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
  expect(logged).toContain("UNKNOWN");
  expect(logged).not.toContain("synthetic-secret-value");
});
