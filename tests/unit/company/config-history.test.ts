import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { getTenantOperatingConfig, upsertTenantOperatingConfig } from "@/lib/services/tenant-config-service";
import { PUT } from "@/app/api/company/operating-config/route";
import { diferenciasDeConfig } from "@/lib/company/config-change-log";
import { EMPRESA_A } from "../../fixtures/tenant-isolation";

/**
 * C14.2 — la configuración guardada dice quién la cambió y de qué a qué.
 *
 * Sin historial, un IVA que baja de 16 a 8 dos meses atrás y vuelve a 16 es
 * indistinguible de uno que nunca cambió: el mes sale distinto y nadie sabe
 * por qué. Estas pruebas comprueban dos cosas separadas: que el diff sólo
 * reporta lo que cambió de verdad, y que el PUT escribe una fila por campo con
 * el actor de la sesión.
 */

vi.mock("@/lib/db", () => ({ db: { select: vi.fn(), update: vi.fn(), insert: vi.fn() } }));
vi.mock("@/lib/tenant-context", () => ({ requireAuth: vi.fn(), requireTenant: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ hasPermission: vi.fn(() => true) }));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => unknown) => fn,
  revalidateTag: vi.fn(),
}));
vi.mock("@/lib/services/tenant-config-service", async () => {
  const real = await vi.importActual<typeof import("@/lib/services/tenant-config-service")>(
    "@/lib/services/tenant-config-service"
  );
  return {
    ...real,
    getTenantOperatingConfig: vi.fn(),
    upsertTenantOperatingConfig: vi.fn(),
  };
});

const GUARDADO = {
  companyId: EMPRESA_A,
  purchasingStructure: "CENTRALIZADA",
  managerAutonomy: "MEDIA",
  vatRatePercent: "16.00",
  laborBurdenFactorPercent: null,
  pettyCashLimitCents: 500000,
};

let fila: Record<string, unknown> = { ...GUARDADO };
let courtesyWaste: number | null = null;

const request = (body: unknown) => ({ json: async () => body }) as never;

/**
 * Filas que el PUT intentó insertar.
 *
 * `db.insert(tabla)` y `.values(filas)` son dos llamadas distintas; el mock
 * captura las filas de la segunda, que es donde va el historial.
 */
let filas: Record<string, unknown>[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  fila = { ...GUARDADO };
  courtesyWaste = null;
  vi.mocked(requireTenant).mockResolvedValue({ id: EMPRESA_A } as never);
  vi.mocked(requireAuth).mockResolvedValue({ user: { id: "admin-a", role: "OWNER", companyId: EMPRESA_A } } as never);
  vi.mocked(getTenantOperatingConfig).mockImplementation(async () => fila as never);
  vi.mocked(upsertTenantOperatingConfig).mockImplementation(async (_id, data) => {
    fila = { ...fila, ...data };
    return fila as never;
  });
  vi.mocked(db.select).mockImplementation(() => ({ from: () => ({ where: () => ({ limit: async () => [
    { courtesyWasteMonthlyCapCents: courtesyWaste },
  ] }) }) }) as never);
  vi.mocked(db.update).mockImplementation(() => ({ set: () => ({ where: async () => undefined }) }) as never);
  filas = [];
  vi.mocked(db.insert).mockImplementation(() => ({
    values: async (nuevas: Record<string, unknown>[]) => {
      filas.push(...nuevas);
    },
  }) as never);
});

describe("C14.2 — el diff sólo reporta lo que cambió", () => {
  it("compara 16 con \"16.00\" y no inventa un cambio", () => {
    expect(diferenciasDeConfig({ vatRatePercent: "16.00" }, { vatRatePercent: 16 })).toEqual([]);
  });

  it("un valor realmente distinto se reporta con su anterior y su nuevo", () => {
    expect(diferenciasDeConfig({ vatRatePercent: "16.00" }, { vatRatePercent: 8 })).toEqual([
      { campo: "vatRatePercent", anterior: 16, nuevo: 8 },
    ]);
  });

  it("pasar de un valor a null es un cambio, no una ausencia", () => {
    expect(diferenciasDeConfig({ laborBurdenFactorPercent: "25.00" }, { laborBurdenFactorPercent: null })).toEqual([
      { campo: "laborBurdenFactorPercent", anterior: 25, nuevo: null },
    ]);
  });

  it("un campo ausente en el PUT no aparece: parcial no es borrar", () => {
    const cambios = diferenciasDeConfig(
      { vatRatePercent: "16.00", pettyCashLimitCents: 500000 },
      { vatRatePercent: 8 }
    );
    expect(cambios).toEqual([{ campo: "vatRatePercent", anterior: 16, nuevo: 8 }]);
  });

  it("un texto no numérico se conserva como texto, no como número", () => {
    expect(diferenciasDeConfig({ managerAutonomy: "MEDIA" }, { managerAutonomy: "ALTA" })).toEqual([
      { campo: "managerAutonomy", anterior: "MEDIA", nuevo: "ALTA" },
    ]);
  });

  it("el tope de cortesías se resuelve aparte porque vive en otra tabla", () => {
    const cambios = diferenciasDeConfig({}, {}, { anterior: 250000, nuevo: 0 });
    expect(cambios).toEqual([{ campo: "courtesyWasteMonthlyCapCents", anterior: 250000, nuevo: 0 }]);
    // Sin valor nuevo no hay nada que registrar para ese campo.
    expect(diferenciasDeConfig({}, {}, { anterior: 250000, nuevo: undefined })).toEqual([]);
  });

  it("sin cambios no hay historial que escribir", () => {
    expect(diferenciasDeConfig({ vatRatePercent: "16.00", managerAutonomy: "MEDIA" }, { vatRatePercent: 16, managerAutonomy: "MEDIA" })).toEqual([]);
  });
});

describe("C14.2 — el PUT registra actor y cambio", () => {
  it("escribe una fila por campo modificado, con el actor de la sesión", async () => {
    const res = await PUT(request({ vatRatePercent: 8, managerAutonomy: "ALTA" }));
    expect(res.status).toBe(200);

    // El orden lo impone el shape del esquema, no el cuerpo de la petición:
    // la comparación es por campo para no depender de eso.
    const porCampo = new Map(filas.map((f) => [f.fieldName as string, f]));
    expect(porCampo.size).toBe(2);
    expect(porCampo.get("vatRatePercent")).toEqual({
      companyId: EMPRESA_A, userId: "admin-a", fieldName: "vatRatePercent", oldValue: 16, newValue: 8,
    });
    expect(porCampo.get("managerAutonomy")).toEqual({
      companyId: EMPRESA_A, userId: "admin-a", fieldName: "managerAutonomy", oldValue: "MEDIA", newValue: "ALTA",
    });
  });

  it("un guardado que no cambia nada no escribe historial", async () => {
    const res = await PUT(request({ vatRatePercent: 16 }));
    expect(res.status).toBe(200);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("apagar el IVA deja constancia de que hubo un valor antes", async () => {
    const res = await PUT(request({ vatRatePercent: null }));
    expect(res.status).toBe(200);
    expect(filas).toEqual([
      { companyId: EMPRESA_A, userId: "admin-a", fieldName: "vatRatePercent", oldValue: 16, newValue: null },
    ]);
  });

  it("el tope de cortesías también queda registrado con su valor anterior", async () => {
    courtesyWaste = 250000;
    const res = await PUT(request({ courtesyWasteMonthlyCapCents: 0 }));
    expect(res.status).toBe(200);
    expect(filas).toEqual([
      { companyId: EMPRESA_A, userId: "admin-a", fieldName: "courtesyWasteMonthlyCapCents", oldValue: 250000, newValue: 0 },
    ]);
  });

  it("un rechazo por validación no deja historial: no hubo cambio que explicar", async () => {
    const res = await PUT(request({ vatRatePercent: 150 }));
    expect(res.status).toBe(400);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("sin permiso no escribe nada, tampoco historial", async () => {
    const { hasPermission } = await import("@/lib/permissions");
    vi.mocked(hasPermission).mockReturnValueOnce(false);
    const res = await PUT(request({ vatRatePercent: 8 }));
    expect(res.status).toBe(403);
    expect(upsertTenantOperatingConfig).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("un fallo al escribir el historial no convierte un guardado correcto en error", async () => {
    vi.mocked(db.insert).mockImplementation(() => ({ values: async () => { throw new Error("tabla no disponible"); } }) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await PUT(request({ vatRatePercent: 8 }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(upsertTenantOperatingConfig).toHaveBeenCalled();
  });
});