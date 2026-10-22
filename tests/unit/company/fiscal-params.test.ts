import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { getTenantOperatingConfig, upsertTenantOperatingConfig } from "@/lib/services/tenant-config-service";
import { GET, PUT } from "@/app/api/company/operating-config/route";
import {
  cuerpoDeConfiguracion,
  valoresIniciales,
} from "@/lib/company/operating-config-values";
import { EMPRESA_A } from "../../fixtures/tenant-isolation";

/**
 * C14.1 — los cuatro parámetros que los motores ya consumían ahora tienen
 * contrato de entrada y editor.
 *
 * Lo que se cubre aquí es la distinción que el resto del formulario no tiene:
 * `null` no es cero ni es ausencia. Vaciar el IVA debe viajar como `null` (no
 * estimar), no como 0 (que también apagaría la estimación, pero sin decirlo) ni
 * como16 (inventar una tasa). Y un valor guardado tiene que volver a verse
 * idéntico tras un recargar.
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

let fila: Record<string, unknown> = {};
let courtesyWaste: number | null = null;

const request = (body: unknown) => ({ json: async () => body }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  fila = {
    companyId: EMPRESA_A,
    vatRatePercent: "16.00",
    laborBurdenFactorPercent: null,
    payrollStateTaxPercent: "3.00",
    mermaVarianceThresholdPct: "5.00",
  };
  courtesyWaste = null;
  vi.mocked(requireTenant).mockResolvedValue({ id: EMPRESA_A } as never);
  vi.mocked(requireAuth).mockResolvedValue({ user: { id: "admin", role: "OWNER", companyId: EMPRESA_A } } as never);
  vi.mocked(getTenantOperatingConfig).mockImplementation(async () => fila as never);
  vi.mocked(upsertTenantOperatingConfig).mockImplementation(async (_id, data) => {
    fila = { ...fila, ...data };
    return fila as never;
  });
  vi.mocked(db.select).mockImplementation(() => ({ from: () => ({ where: () => ({ limit: async () => [
    { courtesyWasteMonthlyCapCents: courtesyWaste },
  ] }) }) }) as never);
});

describe("C14.1 — ida y vuelta de los cuatro parámetros", () => {
  it("un valor guardado se ve igual tras recargar y se vuelve a enviar igual", () => {
    const guardado = {
      vatRatePercent: "8.00",
      laborBurdenFactorPercent: "25.00",
      payrollStateTaxPercent: "3.00",
      mermaVarianceThresholdPct: "2.50",
    };
    const valores = valoresIniciales({ ...fila, ...guardado } as never);
    expect(valores.fiscal).toEqual({ vatRate: "8", laborBurden: "25", stateTax: "3", mermaThreshold: "2.5", payrollPracticeMode: "", aguinaldoBase: "" });

    const cuerpo = cuerpoDeConfiguracion(valores);
    expect(cuerpo.vatRatePercent).toBe(8);
    expect(cuerpo.laborBurdenFactorPercent).toBe(25);
    expect(cuerpo.payrollStateTaxPercent).toBe(3);
    expect(cuerpo.mermaVarianceThresholdPct).toBe(2.5);

    // Task 10 plan-aguinaldo: los seleccionables de práctica de nómina/aguinaldo
    // guardan explícito y recargan al mismo estado; vacío es null (default).
    expect(cuerpo.payrollPracticeMode).toBeNull();
    expect(cuerpo.aguinaldoBase).toBeNull();

    const conPractica = { ...valores, fiscal: { ...valores.fiscal, payrollPracticeMode: "MIXED", aguinaldoBase: "EFFECTIVE" } };
    const cuerpoPractica = cuerpoDeConfiguracion(conPractica);
    expect(cuerpoPractica.payrollPracticeMode).toBe("MIXED");
    expect(cuerpoPractica.aguinaldoBase).toBe("EFFECTIVE");
    const recargadaPractica = valoresIniciales({ ...fila, ...cuerpoPractica } as never);
    expect(recargadaPractica.fiscal.payrollPracticeMode).toBe("MIXED");
    expect(recargadaPractica.fiscal.aguinaldoBase).toBe("EFFECTIVE");

    // Y el recálculo del cuerpo vuelve al mismo estado: el viaje es estable.
    const recargado = valoresIniciales({ ...fila, ...cuerpo } as never);
    expect(recargado.fiscal).toEqual(valores.fiscal);
  });

  it("null guardado se ve vacío y se vuelve a enviar como null, no como 0 ni como default", () => {
    const valores = valoresIniciales({
      vatRatePercent: null,
      laborBurdenFactorPercent: null,
      payrollStateTaxPercent: null,
      mermaVarianceThresholdPct: null,
    } as never);
    expect(valores.fiscal).toEqual({ vatRate: "", laborBurden: "", stateTax: "", mermaThreshold: "", payrollPracticeMode: "", aguinaldoBase: "" });

    const cuerpo = cuerpoDeConfiguracion(valores);
    expect(cuerpo.vatRatePercent).toBeNull();
    expect(cuerpo.laborBurdenFactorPercent).toBeNull();
    expect(cuerpo.payrollStateTaxPercent).toBeNull();
    expect(cuerpo.mermaVarianceThresholdPct).toBeNull();
  });

  it("una empresa sin fila ve los defaults del módulo: IVA 16, merma 5, carga e ISN sin capturar", () => {
    expect(valoresIniciales(null).fiscal).toEqual({ vatRate: "16", laborBurden: "", stateTax: "", mermaThreshold: "5", payrollPracticeMode: "", aguinaldoBase: "" });
  });

  it("un texto no numérico en un parámetro fiscal bloquea el guardado", () => {
    const estado = valoresIniciales(null);
    const conBasura = { ...estado, fiscal: { ...estado.fiscal, laborBurden: "veinticinco" } };
    expect(cuerpoDeConfiguracion(conBasura).laborBurdenFactorPercent).toBeNaN();
  });
});

describe("C14.1 — el PUT acepta y persiste los cuatro con su semántica", () => {
  it("acepta null explícito y lo escribe sin convertirlo en cero", async () => {
    const res = await PUT(request({
      vatRatePercent: null,
      laborBurdenFactorPercent: null,
      payrollStateTaxPercent: null,
      mermaVarianceThresholdPct: null,
    }));
    expect(res.status).toBe(200);
    expect(upsertTenantOperatingConfig).toHaveBeenCalledWith(EMPRESA_A, expect.objectContaining({
      vatRatePercent: null,
      laborBurdenFactorPercent: null,
      payrollStateTaxPercent: null,
      mermaVarianceThresholdPct: null,
    }));
  });

  it("acepta valores y los persiste con dos decimales", async () => {
    const res = await PUT(request({
      vatRatePercent: 8,
      laborBurdenFactorPercent: 25.5,
      payrollStateTaxPercent: 3,
      mermaVarianceThresholdPct: 2.5,
    }));
    expect(res.status).toBe(200);
    expect(upsertTenantOperatingConfig).toHaveBeenCalledWith(EMPRESA_A, expect.objectContaining({
      vatRatePercent: "8.00",
      laborBurdenFactorPercent: "25.50",
      payrollStateTaxPercent: "3.00",
      mermaVarianceThresholdPct: "2.50",
    }));
  });

  it("rechaza un parámetro fuera de rango nombrando el campo antes de escribir", async () => {
    const res = await PUT(request({ vatRatePercent: 150 }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error.details.fieldErrors.vatRatePercent[0]).toContain("100");
    expect(upsertTenantOperatingConfig).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("rechaza un parámetro no numérico con su propio mensaje", async () => {
    const res = await PUT(request({ laborBurdenFactorPercent: "alto" }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error.details.fieldErrors.laborBurdenFactorPercent[0]).toContain("porcentaje");
    expect(upsertTenantOperatingConfig).not.toHaveBeenCalled();
  });

  it("mezclar parámetros con umbrales valida los dos lados en una sola respuesta", async () => {
    const res = await PUT(request({ vatRatePercent: 150, pettyCashLimitCents: -1 }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error.details.fieldErrors.vatRatePercent).toBeDefined();
    expect(json.error.details.fieldErrors.pettyCashLimitCents).toBeDefined();
    expect(upsertTenantOperatingConfig).not.toHaveBeenCalled();
  });
});

describe("C14.1 — el GET entrega los cuatro tal como están", () => {
  it("devuelve valores y null sin sustituirlos", async () => {
    fila = {
      ...fila,
      vatRatePercent: "8.00",
      laborBurdenFactorPercent: null,
      payrollStateTaxPercent: null,
      mermaVarianceThresholdPct: "2.50",
    };
    const res = await GET();
    const json = await res.json();
    expect(json.data.vatRatePercent).toBe("8.00");
    expect(json.data.laborBurdenFactorPercent).toBeNull();
    expect(json.data.payrollStateTaxPercent).toBeNull();
    expect(json.data.mermaVarianceThresholdPct).toBe("2.50");
  });
});
