import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { getTenantOperatingConfig, upsertTenantOperatingConfig } from "@/lib/services/tenant-config-service";
import { GET, PUT } from "@/app/api/company/operating-config/route";
import {
  centavosAPesos,
  cuerpoDeConfiguracion,
  erroresPorCampo,
  pesosACentavos,
  valoresIniciales,
  type OperatingConfigFormState,
} from "@/lib/company/operating-config-values";
import { EMPRESA_A } from "../../fixtures/tenant-isolation";

/**
 * C13 — la configuración que se guarda es la que se vuelve a leer.
 *
 * El defecto que estas pruebas cubren era `x || 100000`: un umbral guardado en
 * cero se recargaba como $1,000 y el siguiente guardado persistía ese default.
 * El mapeo vive ahora en `lib/company/operating-config-values`, sin React.
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

const FILA = {
  companyId: EMPRESA_A,
  purchasingStructure: "HIBRIDO",
  foodProduction: "COCINA_CENTRAL",
  treasuryModel: "CUENTA_UNICA",
  supplierPayment: "POR_SUCURSAL",
  managerAutonomy: "BAJA",
  payrollDispersion: "MIXTO",
  tenantType: "MIXTO_FRANQUICIAS",
  // Cero, no ausencia: es el valor que `||` destruía.
  managerAuthLimitCents: 0,
  doubleApprovalThresholdCents: 250000,
  pettyCashLimitCents: 0,
  // Y null, que significa "sin tope" y no cero.
  emergencyPurchaseCapCents: null,
  foodCostTargetPercent: "0.00",
  foodCostWarnPercent: "35.50",
  laborCostTargetPercent: "28.00",
  laborCostWarnPercent: "32.00",
  healthyMarginTargetPercent: "45.00",
  healthyMarginWarnPercent: "35.00",
};

let fila: Record<string, unknown> = { ...FILA };
let courtesyWaste: number | null = null;

const estado = (cambios: Partial<OperatingConfigFormState> = {}): OperatingConfigFormState => ({
  ...valoresIniciales(FILA as never),
  ...cambios,
});

const request = (body: unknown) => ({ json: async () => body }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  fila = { ...FILA };
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
  vi.mocked(db.update).mockImplementation(() => ({ set: (values: { courtesyWasteMonthlyCapCents: number | null }) => {
    courtesyWaste = values.courtesyWasteMonthlyCapCents;
    return { where: async () => undefined };
  } }) as never);
});

describe("C13 — un valor guardado vuelve como se guardó", () => {
  it("un umbral en cero se muestra en cero y vuelve en cero", () => {
    const valores = valoresIniciales(FILA as never);
    expect(valores.thresholds.managerAuthLimit).toBe("0");
    expect(valores.thresholds.pettyCashLimit).toBe("0");
    expect(cuerpoDeConfiguracion(valores).managerAuthLimitCents).toBe(0);
  });

  it("un tope sin límite sigue vacío y se guarda como null, no como cero", () => {
    const valores = valoresIniciales(FILA as never);
    expect(valores.thresholds.emergencyCap).toBe("");
    expect(valores.thresholds.courtesyWasteCap).toBe("");
    const cuerpo = cuerpoDeConfiguracion(valores);
    expect(cuerpo.emergencyPurchaseCapCents).toBeNull();
    expect(cuerpo.courtesyWasteMonthlyCapCents).toBeNull();
  });

  it("los tres umbrales anulados sobreviven a una recarga sin recuperar defaults", () => {
    const valores = valoresIniciales({ ...FILA, managerAuthLimitCents: null,
      doubleApprovalThresholdCents: null, pettyCashLimitCents: null });
    expect(valores.thresholds.managerAuthLimit).toBe("");
    expect(valores.thresholds.doubleApprovalThreshold).toBe("");
    expect(valores.thresholds.pettyCashLimit).toBe("");
    expect(cuerpoDeConfiguracion(valores)).toMatchObject({ managerAuthLimitCents: null,
      doubleApprovalThresholdCents: null, pettyCashLimitCents: null });
  });

  it("ida y vuelta: Defaults → cuerpo → valores iniciales conserva todo", () => {
    const guardado = { ...FILA, managerAuthLimitCents: 0, emergencyPurchaseCapCents: 150000 };
    const cuerpo = cuerpoDeConfiguracion(valoresIniciales(guardado as never));
    const recargado = valoresIniciales({ ...(guardado as never), ...cuerpo } as never);
    expect(recargado).toEqual(valoresIniciales(guardado as never));
    expect(cuerpo.managerAuthLimitCents).toBe(0);
    expect(cuerpo.emergencyPurchaseCapCents).toBe(150000);
  });

  it("un porcentaje de cero se conserva y no cae al default del módulo", () => {
    const valores = valoresIniciales({ ...(FILA as never), foodCostTargetPercent: "0.00" } as never);
    expect(valores.costTargets.foodTarget).toBe("0");
    expect(cuerpoDeConfiguracion(valores).foodCostTargetPercent).toBe(0);
  });

  it("pesos y centavos sólo pierden el valor en el borde", () => {
    expect(centavosAPesos(0)).toBe("0");
    expect(centavosAPesos(1)).toBe("0.01");
    expect(centavosAPesos(null)).toBe("");
    expect(centavosAPesos(undefined)).toBe("");
    expect(pesosACentavos("")).toBeNull();
    expect(pesosACentavos("  ")).toBeNull();
    expect(pesosACentavos("0")).toBe(0);
    expect(pesosACentavos("1234.56")).toBe(123456);
    expect(pesosACentavos("-5")).toBeNaN();
    expect(pesosACentavos("abc")).toBeNaN();
  });

  it("una empresa sin fila ve los defaults del módulo, no los inventados por el formulario", () => {
    const vacio = valoresIniciales(null);
    expect(vacio.dimensions.purchasingStructure).toBe("CENTRALIZADA");
    expect(vacio.thresholds.managerAuthLimit).toBe("1000");
    expect(vacio.thresholds.emergencyCap).toBe("");
    expect(vacio.costTargets.foodTarget).toBe("30");
  });

  it("un texto no numérico se detecta antes de enviar", () => {
    const invalido = estado({ thresholds: { ...estado().thresholds, pettyCashLimit: "mil" } });
    expect(cuerpoDeConfiguracion(invalido).pettyCashLimitCents).toBeNaN();
    const vacio = estado({ costTargets: { ...estado().costTargets, foodTarget: "" } });
    expect(cuerpoDeConfiguracion(vacio).foodCostTargetPercent).toBeNaN();
  });
});

describe("C13 — el PUT valida unidades y rangos por campo", () => {
  const erroresDe = async (body: unknown) => {
    const res = await PUT(request(body));
    const json = await res.json();
    return { status: res.status, json };
  };

  it("rechaza un monto con decimales nombrando la unidad", async () => {
    const { status, json } = await erroresDe({ managerAuthLimitCents: 1000.5 });
    expect(status).toBe(400);
    expect(json.error.details.fieldErrors.managerAuthLimitCents[0]).toContain("centavos");
    expect(upsertTenantOperatingConfig).not.toHaveBeenCalled();
  });

  it("rechaza un monto negativo y un porcentaje fuera de rango, cada uno en su campo", async () => {
    const { json } = await erroresDe({ pettyCashLimitCents: -1, foodCostTargetPercent: 120 });
    expect(json.error.details.fieldErrors.pettyCashLimitCents[0]).toContain("negativo");
    expect(json.error.details.fieldErrors.foodCostTargetPercent[0]).toContain("100");
    expect(upsertTenantOperatingConfig).not.toHaveBeenCalled();
  });

  it("rechaza una dimensión desconocida con un mensaje que nombra la elección", async () => {
    const { json } = await erroresDe({ purchasingStructure: "DESCENTRALIZADA_X" });
    expect(json.error.details.fieldErrors.purchasingStructure[0]).toContain("estructura de compras");
    expect(upsertTenantOperatingConfig).not.toHaveBeenCalled();
  });

  it("rechaza un semáforo sin zona amarilla y señala el campo de precaución", async () => {
    const { json } = await erroresDe({ foodCostTargetPercent: 40, foodCostWarnPercent: 30 });
    expect(json.error.details.fieldErrors.foodCostWarnPercent[0]).toContain("food cost");
    expect(upsertTenantOperatingConfig).not.toHaveBeenCalled();
  });

  it("rechaza una petición vacía", async () => {
    const { status, json } = await erroresDe({});
    expect(status).toBe(400);
    expect(json.error.message).toContain("No se enviaron campos");
    expect(upsertTenantOperatingConfig).not.toHaveBeenCalled();
  });

  it("rechaza montos que exceden la capacidad de la columna antes de escribir", async () => {
    const { status, json } = await erroresDe({ pettyCashLimitCents: 2147483648 });
    expect(status).toBe(400);
    expect(json.error.details.fieldErrors.pettyCashLimitCents[0]).toContain("2147483647");
    expect(db.update).not.toHaveBeenCalled();
    expect(upsertTenantOperatingConfig).not.toHaveBeenCalled();
  });

  it("valida el umbral parcial contra el objetivo guardado antes de cualquier escritura", async () => {
    const { status, json } = await erroresDe({ laborCostWarnPercent: 20, courtesyWasteMonthlyCapCents: 50 });
    expect(status).toBe(400);
    expect(json.error.details.fieldErrors.laborCostWarnPercent).toBeDefined();
    expect(db.update).not.toHaveBeenCalled();
    expect(upsertTenantOperatingConfig).not.toHaveBeenCalled();
  });

  it("acepta cero y null, y responde con lo que quedó guardado", async () => {
    courtesyWaste = null;
    const res = await PUT(request({ managerAuthLimitCents: 0, emergencyPurchaseCapCents: null, courtesyWasteMonthlyCapCents: 0 }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(upsertTenantOperatingConfig).toHaveBeenCalledWith(EMPRESA_A, expect.objectContaining({ managerAuthLimitCents: 0, emergencyPurchaseCapCents: null }));
    expect(json.data.managerAuthLimitCents).toBe(0);
    expect(json.data.courtesyWasteMonthlyCapCents).toBe(0);
  });

  it("responde con el tope de cortesías guardado, no con el que pidió el formulario", async () => {
    courtesyWaste = 250000;
    const res = await PUT(request({ managerAutonomy: "ALTA" }));
    expect((await res.json()).data.courtesyWasteMonthlyCapCents).toBe(250000);
  });

  it("exige sesión y permiso de configuración", async () => {
    const { hasPermission } = await import("@/lib/permissions");
    vi.mocked(requireAuth).mockRejectedValueOnce(new Error("Sin sesión"));
    expect((await PUT(request({ managerAutonomy: "ALTA" }))).status).toBe(500);

    vi.mocked(hasPermission).mockReturnValueOnce(false);
    const res = await PUT(request({ managerAutonomy: "ALTA" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.message).toContain("administrador");
    expect(upsertTenantOperatingConfig).not.toHaveBeenCalled();
  });
});

describe("C13 — la lectura devuelve lo guardado, incluidos cero y sin tope", () => {
  it("el GET entrega el cero y el null tal como están", async () => {
    courtesyWaste = 0;
    const res = await GET();
    const json = await res.json();
    expect(json.data.managerAuthLimitCents).toBe(0);
    expect(json.data.pettyCashLimitCents).toBe(0);
    expect(json.data.emergencyPurchaseCapCents).toBeNull();
    expect(json.data.foodCostTargetPercent).toBe("0.00");
    expect(json.data.courtesyWasteMonthlyCapCents).toBe(0);
  });

  it("el GET propaga el fallo en vez de servir defaults", async () => {
    vi.mocked(getTenantOperatingConfig).mockRejectedValueOnce(new Error("La base no responde"));
    const res = await GET();
    expect(res.status).toBe(500);
    expect((await res.json()).success).toBe(false);
  });
});

describe("C13 — los errores del servidor llegan al campo que los causó", () => {
  it("traduce fieldErrors y descarta lo que no es un campo", () => {
    expect(
      erroresPorCampo({
        formErrors: ["algo global"],
        fieldErrors: { managerAuthLimitCents: ["El monto no puede ser negativo."], foodCostWarnPercent: [] },
      })
    ).toEqual({ managerAuthLimitCents: "El monto no puede ser negativo." });
    expect(erroresPorCampo(undefined)).toEqual({});
    expect(erroresPorCampo({})).toEqual({});
  });
});
