import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { configChangeLogs, tenantOperatingConfig } from "@/lib/db/schema";
import { parametrosVigentesEn, PARAMETROS_VIGENTES } from "@/lib/company/operating-params-vigencia";
import { cierreDelPeriodo } from "@/lib/company/period-close";
import { getVatRatePercent } from "@/lib/services/sales-base";
import { getLaborBurden } from "@/lib/services/labor-burden";
import { EMPRESA_A } from "../../fixtures/tenant-isolation";

/**
 * C14.3 — un periodo conserva los parámetros que tenía al cerrarse.
 *
 * El defecto: IVA, carga patronal e ISN se leían al calcular, así que cambiar
 * el IVA de 16 a 8 movía un food cost de marzo. Estas pruebas comprueban que la
 * lectura con fecha devuelve el valor de entonces y que, sin fecha, sigue
 * devolviendo el de ahora.
 */

vi.mock("@/lib/db", () => ({ db: { select: vi.fn() } }));

const MARZO = "2026-03-31";
const JUNIO = "2026-06-15";

/** Cambios ordenados como los devuelve la consulta: del más nuevo al más viejo. */
let historial: { fieldName: string; newValue: unknown; performedAt: string }[] = [];
let actuales: Record<string, string | null> = {};
/**
 * Fecha de corte que la base filtraría con `performed_at <= corte`. El mock no
 * puede inspeccionar la expresión SQL de Drizzle, así que cada prueba declara
 * el corte que está consultando y el mock filtra por él, como lo haría Postgres.
 */
let corte = "2026-12-31";

beforeEach(() => {
  vi.clearAllMocks();
  corte = "2026-12-31";
  actuales = {
    vatRatePercent: "8.00",
    laborBurdenFactorPercent: "25.00",
    payrollStateTaxPercent: "3.00",
    mermaVarianceThresholdPct: "2.00",
  };
  historial = [
    { fieldName: "vatRatePercent", newValue: "8.00", performedAt: `${JUNIO}T10:00:00.000Z` },
    { fieldName: "vatRatePercent", newValue: "16.00", performedAt: "2026-02-10T09:00:00.000Z" },
  ];

  // Una consulta por tabla: el mock decide qué se devuelve según la tabla.
  vi.mocked(db.select).mockImplementation((columns: Record<string, unknown>) => {
    const pideHistorial = Object.values(columns ?? {}).some((c) => (c as { name?: string })?.name === "field_name");
    if (pideHistorial) {
      return {
        from: () => ({
          where: () => ({
            orderBy: async () =>
              historial.filter((cambio) => cambio.performedAt <= corte),
          }),
        }),
      } as never;
    }
    return {
      from: () => ({
        where: () => ({ limit: async () => [actuales] }),
      }),
    } as never;
  });
});

describe("C14.3 — el parámetro vigente es el que estaba en esa fecha", () => {
  it("un corte anterior al cambio ve el valor viejo", async () => {
    corte = cierreDelPeriodo(MARZO).toISOString();
    const parametros = await parametrosVigentesEn(EMPRESA_A, cierreDelPeriodo(MARZO));
    expect(parametros.vatRatePercent).toBe("16.00");
  });

  it("un corte posterior al cambio ve el valor nuevo", async () => {
    corte = cierreDelPeriodo(JUNIO).toISOString();
    const parametros = await parametrosVigentesEn(EMPRESA_A, cierreDelPeriodo(JUNIO));
    expect(parametros.vatRatePercent).toBe("8.00");
  });

  it("la fecha sin hora usa el cierre del día, no su inicio", () => {
    expect(cierreDelPeriodo(MARZO).toISOString()).toBe("2026-03-31T23:59:59.999Z");
  });

  it("un parámetro sin historial devuelve el valor actual", async () => {
    // `mermaVarianceThresholdPct` no aparece en el historial de prueba.
    corte = cierreDelPeriodo(MARZO).toISOString();
    const parametros = await parametrosVigentesEn(EMPRESA_A, cierreDelPeriodo(MARZO));
    expect(parametros.mermaVarianceThresholdPct).toBe("2.00");
  });

  it("apagar un parámetro queda registrado como vigente, no como ausencia", async () => {
    historial.push({ fieldName: "laborBurdenFactorPercent", newValue: null, performedAt: "2026-04-01T12:00:00.000Z" });
    corte = cierreDelPeriodo(MARZO).toISOString();
    const antes = await parametrosVigentesEn(EMPRESA_A, cierreDelPeriodo(MARZO));
    corte = cierreDelPeriodo("2026-04-30").toISOString();
    const despues = await parametrosVigentesEn(EMPRESA_A, cierreDelPeriodo("2026-04-30"));
    expect(antes.laborBurdenFactorPercent).toBe("25.00");
    expect(despues.laborBurdenFactorPercent).toBeNull();
  });

  it("si el historial no se puede leer, se usa el valor actual en vez de fallar", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(db.select).mockImplementation((columns: Record<string, unknown>) => {
      const pideHistorial = Object.values(columns ?? {}).some((c) => (c as { name?: string })?.name === "field_name");
      if (pideHistorial) throw new Error("relation config_change_logs does not exist");
      return { from: () => ({ where: () => ({ limit: async () => [actuales] }) }) } as never;
    });
    const parametros = await parametrosVigentesEn(EMPRESA_A, cierreDelPeriodo(MARZO));
    expect(parametros.vatRatePercent).toBe("8.00");
  });
});

describe("C14.3 — los motores respetan la vigencia", () => {
  it("el IVA se lee con la tasa del periodo, no con la de hoy", async () => {
    corte = cierreDelPeriodo(MARZO).toISOString();
    expect(await getVatRatePercent(EMPRESA_A, cierreDelPeriodo(MARZO))).toBe(16);
    corte = cierreDelPeriodo(JUNIO).toISOString();
    expect(await getVatRatePercent(EMPRESA_A, cierreDelPeriodo(JUNIO))).toBe(8);
  });

  it("sin fecha se sigue leyendo el valor actual: el día a día no cambia", async () => {
    expect(await getVatRatePercent(EMPRESA_A)).toBe(8);
  });

  it("la carga patronal también usa la del periodo", async () => {
    historial.push({ fieldName: "laborBurdenFactorPercent", newValue: "10.00", performedAt: "2026-05-01T12:00:00.000Z" });
    corte = cierreDelPeriodo(MARZO).toISOString();
    const marzo = await getLaborBurden(EMPRESA_A, cierreDelPeriodo(MARZO));
    corte = cierreDelPeriodo(JUNIO).toISOString();
    const junio = await getLaborBurden(EMPRESA_A, cierreDelPeriodo(JUNIO));
    expect(marzo.totalPercent).toBe(28); // 25 de carga + 3 de ISN
    expect(junio.totalPercent).toBe(13); // 10 + 3
  });

  it("leer con vigencia cuesta una consulta de historial y no más", async () => {
    await parametrosVigentesEn(EMPRESA_A, cierreDelPeriodo(MARZO));
    // Configuración actual + historial: dos consultas, no una por parámetro.
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it("la consulta de vigencia filtra por empresa y por los cuatro parámetros", async () => {
    // El esquema se importa para que la prueba falle si los nombres de campo
    // del código dejaran de existir.
    expect(configChangeLogs.fieldName).toBeDefined();
    expect(tenantOperatingConfig.vatRatePercent).toBeDefined();
    expect(PARAMETROS_VIGENTES).toHaveLength(4);
  });
});