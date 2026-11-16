import { afterEach, describe, expect, it, vi } from "vitest";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class { send = send; },
  GetObjectCommand: class { constructor(public input: unknown) {} },
  PutObjectCommand: class {}, DeleteObjectCommand: class {}, HeadObjectCommand: class {},
}));
async function reader() {
  vi.stubEnv("R2_ACCESS_KEY_ID", "synthetic"); vi.stubEnv("R2_SECRET_ACCESS_KEY", "synthetic");
  vi.stubEnv("R2_ACCOUNT_ID", "synthetic");
  vi.resetModules();
  return (await import("@/lib/storage/r2-client")).getFromR2;
}
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); send.mockReset(); vi.restoreAllMocks(); });
describe("lectura acotada R2 para recuperación", () => {
  it("mantiene lectura previa y acepta exactamente el límite", async () => {
    const read = await reader();
    send.mockImplementation(async () => ({ Body: (async function* () { yield Buffer.from("ab"); yield Buffer.from("cd"); })() }));
    expect(await read("private/key")).toEqual(Buffer.from("abcd"));
    expect(await read("private/key", { maxBytes: 4, timeoutMs: 1000 })).toEqual(Buffer.from("abcd"));
  });
  it("aborta al superar el límite sin seguir descargando y cierra el stream", async () => {
    const read = await reader(); let closed = false; let reachedEnd = false;
    send.mockResolvedValue({ Body: (async function* () {
      try { yield Buffer.from("abcd"); yield Buffer.from("e"); reachedEnd = true; }
      finally { closed = true; }
    })() });
    expect(await read("private/key", { maxBytes: 4, timeoutMs: 1000 })).toBeNull();
    expect(closed).toBe(true); expect(reachedEnd).toBe(false);
    expect(send.mock.calls[0][1].abortSignal.aborted).toBe(true);
  });
  it("pasa el timeout al SDK y falla cerrado ante abort", async () => {
    const read = await reader(); vi.useFakeTimers(); vi.spyOn(console, "error").mockImplementation(() => {});
    send.mockImplementation((_command, { abortSignal }) => new Promise((_resolve, reject) => {
      abortSignal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const pending = read("private/key", { maxBytes: 4, timeoutMs: 20 });
    await vi.advanceTimersByTimeAsync(20);
    expect(await pending).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });
  it("rechaza límites inválidos antes de I/O", async () => {
    const read = await reader();
    for (const maxBytes of [0, -1, NaN, Infinity, 1.5])
      await expect(read("key", { maxBytes, timeoutMs: 20 })).rejects.toThrow(/limits/);
    expect(send).not.toHaveBeenCalled();
  });
});
