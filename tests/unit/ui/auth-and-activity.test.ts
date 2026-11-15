import { afterEach, describe, expect, it, vi } from "vitest";
import { authErrorMessage, postLoginPath } from "@/lib/ui/auth-feedback";
import { loadRecentWorkflows } from "@/lib/ui/recent-workflows";

afterEach(() => vi.unstubAllGlobals());

describe("acceso recuperable", () => {
  it("mantiene destinos internos sin permitir redirecciones externas", () => {
    expect(postLoginPath("/dashboard/inventory?tab=attention")).toBe("/dashboard/inventory?tab=attention");
    for (const value of [null, "//example.org", "https://example.org", "/dashboard\\example.org", "/dashboardevil", "/sign-in"]) {
      expect(postLoginPath(value)).toBe("/dashboard");
    }
  });
  it("explica cómo recuperarse sin exponer mensajes internos", () => {
    expect(authErrorMessage("INVALID_EMAIL_OR_PASSWORD")).toContain("recupera");
    expect(authErrorMessage("TOKEN_EXPIRED")).toContain("Solicita uno nuevo");
    expect(authErrorMessage("SQL_FAILURE")).not.toContain("SQL");
  });
});

describe("actividad de operaciones", () => {
  it("no presenta un 503 como una lista vacía", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 503 })));
    await expect(loadRecentWorkflows("all", "7", new AbortController().signal)).rejects.toThrow("Vuelve a intentarlo");
  });
  it("envía período, sucursal y señal de cancelación; conserva el vacío legítimo", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ activeWorkflows: [] })));
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    await expect(loadRecentWorkflows("branch-a", "90", signal)).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledWith("/api/reports/stats?days=90&branchId=branch-a", { signal });
  });
  it("rechaza respuestas malformadas en vez de asegurar que no hay actividad", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
    await expect(loadRecentWorkflows("all", "30", new AbortController().signal)).rejects.toThrow("no es válida");
  });
  it("adapta title/createdAt del API al contrato de la tabla", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ activeWorkflows: [{ id: "w1", title: "Apertura", createdAt: "2026-11-14T12:00:00Z" }] }))));
    const [row] = await loadRecentWorkflows("all", "30", new AbortController().signal);
    expect(row.templateName).toBe("Apertura");
    expect(row.updatedAt).toEqual(new Date("2026-11-14T12:00:00Z"));
    expect(row.assigneeName).toBeNull();
  });
});
