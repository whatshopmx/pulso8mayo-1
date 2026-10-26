import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ get db() { return state.db; } }));
vi.mock("@/lib/fiscal/sat-test-data", () => ({ loadCsdForTin: () => ({}), resolveTestPerson: () => null,
  SAT_TEST_MORALES: [{ tin: "EKU9003173C9", legalName: "Emisor de prueba", zipCode: "64000", taxRegimeCode: "601" }],
  SAT_TEST_FISICAS: [{ tin: "AAA010101AAA", legalName: "Prueba", zipCode: "64000" }] }));
import { timbrarNomina } from "@/lib/services/fiscal-service";

const input = { companyId: "00000000-0000-4000-8000-000000000001", empleadoRfc: "AAA010101AAA", empleadoNombre: "Prueba",
  periodo: "2026-AGU", payrollTypeCode: "E" as const, fechaPago: "2026-12-15", fechaPagoInicial: "2026-01-01", fechaPagoFinal: "2026-12-31",
  totalPercepciones: 900000, totalDeducciones: 117065 };

describe("AGU-03B.4A — servicio fiscal real y HTTP simulado", () => {
  const pg = new PGlite();
  beforeAll(async () => {
    state.db = drizzle(pg);
    await pg.exec(`CREATE TABLE cfdi_nomina_timbrados (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL,
      empleado_rfc text NOT NULL, empleado_nombre text NOT NULL, periodo text NOT NULL, uuid text, status text NOT NULL,
      cadena_original text, sello_digital text, total_percepciones_cents integer NOT NULL, total_deducciones_cents integer NOT NULL,
      raw_response jsonb, timbrado_por text, fecha_timbrado timestamp, created_at timestamp DEFAULT now() NOT NULL,
      updated_at timestamp DEFAULT now() NOT NULL, UNIQUE(company_id, empleado_rfc, periodo));`);
  }, 60000);
  afterAll(async () => pg.close());
  beforeEach(async () => {
    await pg.exec("TRUNCATE cfdi_nomina_timbrados");
    vi.stubEnv("FISCALAPI_API_KEY", "simulada-sin-red");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("duplicado del PAC nunca cambia serie ni envía dos veces, tampoco después de reintentar", async () => {
    const fetcher = vi.fn(async () => Response.json({ succeeded: false, message: "same unique values" }));
    vi.stubGlobal("fetch", fetcher);
    expect((await timbrarNomina(input)).status).toBe("PENDIENTE");
    expect((await timbrarNomina(input)).status).toBe("PENDIENTE");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(["network", "http", "empty"])("%s no autoriza repetir un envío incierto", async (failure) => {
    const fetcher = vi.fn(async () => {
      if (failure === "network") throw new Error("respuesta perdida");
      if (failure === "http") return new Response("timeout", { status: 504 });
      return Response.json({ succeeded: true, data: {} });
    });
    vi.stubGlobal("fetch", fetcher);
    await timbrarNomina(input).catch(() => undefined);
    expect((await timbrarNomina(input)).status).toBe("PENDIENTE");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reutiliza el confirmado y rechaza cambios de fecha/importes; no necesita config para leer el folio", async () => {
    const fetcher = vi.fn(async () => Response.json({ succeeded: true, data: { uuid: "folio", total: 7829.35, seal: "sello" } }));
    vi.stubGlobal("fetch", fetcher);
    expect((await timbrarNomina(input)).uuid).toBe("folio");
    vi.stubEnv("FISCALAPI_API_KEY", "");
    expect((await timbrarNomina(input)).uuid).toBe("folio");
    await expect(timbrarNomina({ ...input, fechaPago: "2026-12-16" })).rejects.toThrow(/huella|solicitud/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("falla local de configuración no envía y permite reintentar al corregirla", async () => {
    const fetcher = vi.fn(async () => Response.json({ succeeded: true, data: { uuid: "folio", total: 7829.35 } }));
    vi.stubGlobal("fetch", fetcher); vi.stubEnv("FISCALAPI_API_KEY", "");
    await expect(timbrarNomina(input)).rejects.toThrow(/configurado/);
    expect(fetcher).not.toHaveBeenCalled();
    vi.stubEnv("FISCALAPI_API_KEY", "simulada-sin-red");
    expect((await timbrarNomina(input)).uuid).toBe("folio");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("un total emitido distinto conserva el folio para revisión sin anunciar éxito ni emitir otro", async () => {
    const fetcher = vi.fn(async () => Response.json({ succeeded: true, data: { uuid: "folio-distinto", total: 9000 } }));
    vi.stubGlobal("fetch", fetcher);
    expect(await timbrarNomina(input)).toMatchObject({ status: "PENDIENTE", uuid: "folio-distinto" });
    expect((await timbrarNomina(input)).status).toBe("PENDIENTE");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("un false genérico es incierto; sólo un rechazo explícito sin folio autoriza nuevo intento", async () => {
    const fetcher = vi.fn(async () => Response.json({ succeeded: false, message: "Error genérico" }));
    vi.stubGlobal("fetch", fetcher);
    expect((await timbrarNomina(input)).status).toBe("PENDIENTE");
    await timbrarNomina(input);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await pg.exec("TRUNCATE cfdi_nomina_timbrados");
    fetcher.mockResolvedValueOnce(Response.json({ succeeded: false, data: { status: "REJECTED" }, message: "Validación rechazada" }));
    expect((await timbrarNomina(input)).status).toBe("RECHAZADO");
    fetcher.mockResolvedValueOnce(Response.json({ succeeded: true, data: { uuid: "folio", total: 7829.35 } }));
    expect((await timbrarNomina(input)).status).toBe("TIMBRADO");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
