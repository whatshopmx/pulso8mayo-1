import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ get db() { return state.db; } }));
import { entregarAguinaldo } from "@/lib/services/aguinaldo-fiscal-delivery";
import type { NominaTimbradoInput } from "@/lib/services/fiscal-service";

const input: NominaTimbradoInput = { companyId: "00000000-0000-4000-8000-000000000001", empleadoRfc: "AAA010101AAA",
  empleadoNombre: "Prueba", periodo: "2026-AGU", totalPercepciones: 900000, totalDeducciones: 117065,
  fechaPago: "2026-12-15", fechaPagoInicial: "2026-01-01", fechaPagoFinal: "2026-12-31", payrollTypeCode: "E" };

describe("AGU-03B.4A — intención fiscal durable en PGlite", () => {
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
  beforeEach(async () => pg.exec("TRUNCATE cfdi_nomina_timbrados"));

  it("dos actores concurrentes solicitan un solo envío; conserva el confirmado y no reenvía al reintentar", async () => {
    let liberar!: () => void;
    const espera = new Promise<void>((resolve) => { liberar = resolve; });
    let enviado!: () => void;
    const iniciado = new Promise<void>((resolve) => { enviado = resolve; });
    const send = vi.fn(async () => { enviado(); await espera; return { status: "TIMBRADO" as const, data: { uuid: "folio" } }; });
    const primero = entregarAguinaldo(input, send);
    await iniciado;
    const segundo = await entregarAguinaldo({ ...input, performedBy: "otro" }, send);
    expect(segundo.status).toBe("PENDIENTE");
    expect(send).toHaveBeenCalledTimes(1);
    liberar();
    expect((await primero).uuid).toBe("folio");
    expect((await entregarAguinaldo(input, send)).uuid).toBe("folio");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("respuesta perdida queda pendiente y no vuelve a emitir aunque el proceso se reintente", async () => {
    const send = vi.fn(async () => { throw new Error("conexión perdida después de emitir"); });
    await expect(entregarAguinaldo(input, send)).rejects.toThrow(/conexión/);
    expect((await entregarAguinaldo(input, send)).status).toBe("PENDIENTE");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("rechazo explícito permite nuevo intento, conservando solicitud; huella diferente bloquea antes del PAC", async () => {
    const rejected = vi.fn(async () => ({ status: "RECHAZADO" as const, data: { error: "Validación de datos" } }));
    await entregarAguinaldo(input, rejected);
    await expect(entregarAguinaldo({ ...input, fechaPago: "2026-12-16" }, rejected)).rejects.toThrow(/solicitud|huella/i);
    expect(rejected).toHaveBeenCalledTimes(1);
    const send = vi.fn(async () => ({ status: "TIMBRADO" as const, data: { uuid: "nuevo-folio" } }));
    expect((await entregarAguinaldo(input, send)).uuid).toBe("nuevo-folio");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("no confunde folios legacy sin huella con el snapshot autorizado ni cruza empresas", async () => {
    const send = vi.fn(async () => ({ status: "TIMBRADO" as const, data: { uuid: "folio" } }));
    await entregarAguinaldo(input, send);
    await pg.exec("UPDATE cfdi_nomina_timbrados SET raw_response = '{}'::jsonb");
    await expect(entregarAguinaldo(input, send)).rejects.toThrow(/conciliación|huella/i);
    await entregarAguinaldo({ ...input, companyId: "00000000-0000-4000-8000-000000000002" }, send);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
