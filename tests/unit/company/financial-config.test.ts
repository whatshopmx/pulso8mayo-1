import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { resolveSalesBase } from "@/lib/services/sales-base";
import { buildLaborBurden } from "@/lib/services/labor-burden";
import { getLaborBurden } from "@/lib/services/labor-burden";
import {
  excedeUmbralMerma,
  umbralMermaDeConfig,
} from "@/lib/services/stock-count-from-workflow";
import { EMPRESA_A } from "../../fixtures/tenant-isolation";

/**
 * C14.3 — un caso controlado por parámetro sobre su consumidor real.
 *
 * Exponer un parámetro sin comprobar a quién lee no demuestra nada: aquí cada
 * uno se pasa por la función que lo consume y se mira qué cambia. No se prueba
 * el query completo, sino la decisión que el parámetro produce, que es donde
 * un valor mal propagado se convierte en un número mentiroso.
 *
 * `sales-base` y `labor-burden` exponen su parte pura justamente para esto;
 * de `stock-count-from-workflow` se usa la regla de umbral extraída en C14.3,
 * porque el resto de la función depende de la base de datos.
 */

vi.mock("@/lib/db", () => ({ db: { select: vi.fn(), query: {} } }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("C14.3 — el IVA cambia la base sobre la que se divide todo", () => {
  // $11,600 con IVA: la base neta son $10,000 exactos.
  const venta = { grossCents: 1_160_000, taxCents: 0, cutsWithTax: 0, cutsCount: 1 };

  it("con la tasa configurada estima la base neta y lo declara como supuesto", () => {
    const base = resolveSalesBase({ ...venta, vatRatePercent: 16 });
    expect(base.kind).toBe("NET_DERIVED");
    expect(base.baseCents).toBe(1_000_000);
    expect(base.note).toMatch(/supuesto|estima/i);
  });

  it("con la tasa en null no estima nada y toma la venta bruta", () => {
    const base = resolveSalesBase({ ...venta, vatRatePercent: null });
    expect(base.kind).toBe("GROSS_DECLARED");
    expect(base.baseCents).toBe(1_160_000);
    expect(base.note).toMatch(/CON IVA/i);
  });

  it("el IVA capturado manda sobre la tasa: la base medida no se reestima", () => {
    const base = resolveSalesBase({ grossCents: 1_160_000, taxCents: 160_000, cutsWithTax: 1, cutsCount: 1, vatRatePercent: 16 });
    expect(base.kind).toBe("NET_MEASURED");
    expect(base.baseCents).toBe(1_000_000);
  });

  it("cambiar la tasa cambia el divisor, y por tanto todos los porcentajes", () => {
    const a16 = resolveSalesBase({ ...venta, vatRatePercent: 16 }).baseCents;
    const a8 = resolveSalesBase({ ...venta, vatRatePercent: 8 }).baseCents;
    expect(a8).not.toBe(a16);
    // Mismo bruto, dos bases: es exactamente por lo que el cambio es
    // interpretable sólo con el historial de C14.2.
    expect(a8).toBeGreaterThan(a16);
  });
});

describe("C14.3 — carga patronal e ISN se suman y se pueden no capturar", () => {
  it("con ambos, el total es la suma y la nota nombra cada parte", () => {
    const burden = buildLaborBurden(25, 3);
    expect(burden.factorPercent).toBe(25);
    expect(burden.stateTaxPercent).toBe(3);
    expect(burden.totalPercent).toBe(28);
    expect(burden.nota).toMatch(/25% de carga patronal/);
    expect(burden.nota).toMatch(/3% de ISN estatal/);
  });

  it("sin ninguno, el total es null y la cifra se rotula bruta: no se estima", () => {
    const burden = buildLaborBurden(null, null);
    expect(burden.totalPercent).toBeNull();
    expect(burden.nota).toMatch(/BRUTA/);
  });

  it("un cero capturado no es lo mismo que no capturar: 0 suma, null no", () => {
    // El cero explícito significa "no hay carga": el total existe y es cero.
    expect(buildLaborBurden(0, 0).totalPercent).toBe(0);
    expect(buildLaborBurden(null, null).totalPercent).toBeNull();
  });

  it("sólo el ISN también produce un total: el estado no depende del factor", () => {
    const burden = buildLaborBurden(null, 3);
    expect(burden.totalPercent).toBe(3);
  });

  it("la carga leída de la configuración llega al consumidor tal cual", async () => {
    vi.mocked(db.select).mockImplementation(() => ({ from: () => ({ where: () => ({ limit: async () => [
      { factor: "25.00", stateTax: "3.00" },
    ] }) }) }) as never);
    const burden = await getLaborBurden(EMPRESA_A);
    expect(burden.totalPercent).toBe(28);
  });
});

describe("C14.3 — el umbral de merma decide qué conteo genera merma", () => {
  it("el valor configurado es el umbral; null y vacío caen en el 5% del sistema", () => {
    expect(umbralMermaDeConfig("2.50")).toBe(2.5);
    expect(umbralMermaDeConfig("0.00")).toBe(0);
    expect(umbralMermaDeConfig(null)).toBe(5);
    expect(umbralMermaDeConfig(undefined)).toBe(5);
    expect(umbralMermaDeConfig("basura")).toBe(5);
  });

  it("un faltante dentro del umbral no genera merma", () => {
    expect(excedeUmbralMerma(-2, 5)).toBe(false);
    // Justo en el límite tampoco: el umbral es inclusivo, "mayor" lo excede.
    expect(excedeUmbralMerma(-5, 5)).toBe(false);
  });

  it("un faltante que supera el umbral sí genera merma", () => {
    expect(excedeUmbralMerma(-6, 5)).toBe(true);
  });

  it("el sobrante nunca genera merma, con umbral 0 o sin él", () => {
    expect(excedeUmbralMerma(0, 0)).toBe(false);
    expect(excedeUmbralMerma(50, 0)).toBe(false);
  });

  it("bajar el umbral hace que el mismo faltante cuente como merma", () => {
    // El mismo -3% no generaba merma con umbral 5 y sí con umbral 2: el
    // parámetro cambia la decisión, no sólo un número mostrado.
    expect(excedeUmbralMerma(-3, 5)).toBe(false);
    expect(excedeUmbralMerma(-3, 2)).toBe(true);
  });
});