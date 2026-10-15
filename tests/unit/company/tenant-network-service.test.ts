import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import {
  branches,
  costRecords,
  dailySalesCuts,
  inventoryWaste,
  temperatureLogs,
} from "@/lib/db/schema";
import { buildOwnershipScope, type AccessContext } from "@/lib/rbac/abac";
import { CrossBranchService } from "@/lib/services/cross-branch-service";
import { getTenantOperatingConfig } from "@/lib/services/tenant-config-service";

/**
 * C22 — V1 del recorrido elegido: la Liga de Sucursales.
 *
 * Corre `getBranchQSRRanking` de verdad; lo único simulado es la base (las
 * agregaciones se computan en SQL, así que la prueba entrega las filas ya
 * agregadas por tabla) y la configuración de empresa.
 *
 * Los tres hilos que se comprueban:
 *
 *  1. **Segmentación**: con `MIXTO_FRANQUICIAS`, cada hallazgo se calcula
 *     dentro de su red —el benchmark es la mejor de *su* red— y nunca se
 *     compara una franquicia contra el promedio de la red propia.
 *  2. **Alcance del actor**: con `ctx` de un gerente, el consolidado se acota a
 *     lo que él ve y lo dice en `alcance`; la huella del conjunto entra en la
 *     clave de caché, que dos actores distintos no compartan resultado.
 *  3. **Red única**: sin franquicias ni declaración mixta, el comportamiento es
 *     el de siempre y los hallazgos quedan sin etiqueta de red.
 */

const clavesDeCache = vi.hoisted(() => [] as string[][]);

vi.mock("@/lib/db", () => ({ db: { select: vi.fn() } }));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...argumentos: never[]) => unknown, keys: string[]) => {
    clavesDeCache.push(keys);
    return fn;
  },
}));
vi.mock("@/lib/services/tenant-config-service", () => ({
  getTenantOperatingConfig: vi.fn(),
}));

type Filas = Record<string, unknown>[];

/** Las filas que cada consulta agregada devuelve, por tabla y en orden. */
function programar(...conjuntos: Array<[tabla: unknown, filas: Filas]>) {
  const colas = new Map<unknown, Filas[]>();
  for (const [tabla, filas] of conjuntos) {
    const cola = colas.get(tabla) ?? [];
    cola.push(filas);
    colas.set(tabla, cola);
  }
  vi.mocked(db.select).mockImplementation(() => ({
    from: (tabla: unknown) => ({
      where: () => {
        const cola = colas.get(tabla);
        const filas: Filas = cola && cola.length > 0 ? cola.shift()! : [];
        const promesa = Promise.resolve(filas);
        return {
          // Las consultas del consolidado cierran con groupBy; el filtro de
          // alcance se awaitea directo sobre where.
          groupBy: () => promesa,
          then: (cumplir: (valor: Filas) => unknown, fallar: (e: unknown) => unknown) =>
            promesa.then(cumplir, fallar),
        };
      },
    }),
  })) as never;
}

const config = (tenantType: string) =>
  ({ tenantType }) as unknown as Awaited<ReturnType<typeof getTenantOperatingConfig>>;

const filasDeSucursales: Filas = [
  { id: "b1", name: "Sucursal Norte", ownershipType: "OWNED", franchiseeUserId: null },
  { id: "b2", name: "Sucursal Sur", ownershipType: "OWNED", franchiseeUserId: null },
  { id: "b3", name: "Franquicia Centro", ownershipType: "FRANCHISE", franchiseeUserId: "u-fran-1" },
  { id: "b4", name: "Franquicia Este", ownershipType: "FRANCHISE", franchiseeUserId: "u-fran-1" },
];

const soloPropias: Filas = filasDeSucursales.filter((f) => f.ownershipType === "OWNED");

const ventas: Filas = [
  { branchId: "b1", totalSales: 100_000_000, totalCuts: 10, balancedCuts: 10 },
  { branchId: "b2", totalSales: 80_000_000, totalCuts: 10, balancedCuts: 10 },
  { branchId: "b3", totalSales: 60_000_000, totalCuts: 10, balancedCuts: 10 },
  { branchId: "b4", totalSales: 50_000_000, totalCuts: 10, balancedCuts: 10 },
];
const ventasPropias = ventas.filter((f) => f.branchId === "b1" || f.branchId === "b2");

/**
 * Food cost: b4 (franquicia) es la más eficiente de **toda** la captura con
 * 20%. En el consolidado eso marcaría a b1 (28%) con 8 puntos de desvío; si la
 * segmentación funciona, b1 no aparece y su comparación es contra b2… no, b1
 * es la mejor de su red, así que la marcada es b2 (36% vs 28%).
 */
const comida: Filas = [
  { branchId: "b1", total: 28_000_000 }, // 28.0%
  { branchId: "b2", total: 28_800_000 }, // 36.0%
  { branchId: "b3", total: 18_000_000 }, // 30.0%
  { branchId: "b4", total: 10_000_000 }, // 20.0%
];
const comidaPropias = comida.filter((f) => f.branchId === "b1" || f.branchId === "b2");

const manoDeObra: Filas = [
  { branchId: "b1", total: 24_000_000 }, // 24.0%
  { branchId: "b2", total: 19_200_000 }, // 24.0%
  { branchId: "b3", total: 14_400_000 }, // 24.0%
  { branchId: "b4", total: 12_000_000 }, // 24.0%
];
const manoDeObraPropia = manoDeObra.filter((f) => f.branchId === "b1" || f.branchId === "b2");

/** La cadena completa de consultas que hace el recorrido con estas filas. */
function programarRecorrido(sucursales: Filas, ventasDeRed: Filas, comidaDeRed: Filas, obraDeRed: Filas) {
  programar(
    [branches, sucursales],
    [dailySalesCuts, ventasDeRed],
    [costRecords, comidaDeRed], // food cost
    [inventoryWaste, []],
    [costRecords, obraDeRed], // mano de obra
    [temperatureLogs, []],
  );
}

const gerenteDeB1: AccessContext = {
  userId: "u-ger",
  userRole: "GERENTE",
  userCompanyId: "comp-a",
  userBranchId: "b1",
  ownershipScope: buildOwnershipScope("GERENTE"),
};

beforeEach(() => {
  vi.mocked(db.select).mockReset();
  vi.mocked(getTenantOperatingConfig).mockReset();
  clavesDeCache.length = 0;
});

describe("getBranchQSRRanking — dos redes con MIXTO_FRANQUICIAS", () => {
  it("mide cada red por separado y nunca compara una franquicia con la red propia", async () => {
    vi.mocked(getTenantOperatingConfig).mockResolvedValue(config("MIXTO_FRANQUICIAS"));
    programarRecorrido(filasDeSucursales, ventas, comida, manoDeObra);

    const resultado = await CrossBranchService.getBranchQSRRanking("comp-a", 30);

    expect(resultado.branches).toHaveLength(4);
    expect(resultado.red?.segmentada).toBe(true);
    expect(resultado.red?.tipoEmpresa).toBe("MIXTO_FRANQUICIAS");
    expect(resultado.red?.veredicto.titulo).toBe("Dos redes · Red propia y Red de franquicias");
    expect(resultado.red?.contradicciones).toEqual([]);

    const [propia, franquicias] = resultado.red!.segmentos;
    expect(propia.etiqueta).toBe("Red propia");
    expect(propia.sucursales).toBe(2);
    expect(propia.branchIds.sort()).toEqual(["b1", "b2"]);
    expect(franquicias.etiqueta).toBe("Red de franquicias");
    expect(franquicias.sucursales).toBe(2);
    expect(franquicias.branchIds.sort()).toEqual(["b3", "b4"]);

    // Promedios por red: 52 y 60 de prime cost en la propia; 54 y 44 en la de
    // franquicias. El consolidado (52.5) sigue existiendo y mezcla las dos.
    expect(propia.promedios).toEqual({ primeCost: 56, foodCost: 32, laborCost: 24 });
    expect(franquicias.promedios).toEqual({ primeCost: 49, foodCost: 25, laborCost: 24 });
    expect(resultado.networkAveragePrimeCost).toBe(52.5);
    expect(resultado.networkAverageFoodCost).toBe(28.5);

    // El hallazgo de food cost lo tiene b2 (36%) y su benchmark es b1, la
    // mejor de **su** red. Si el benchmark fuera la consolidada sería b4
    // (20%, franquicia): exactamente la comparación que la política existe
    // para no hacer.
    const hallazgos = resultado.anomalies;
    expect(hallazgos.every((h) => h.red !== undefined)).toBe(true);
    const dePropia = hallazgos.filter((h) => h.red === "PROPIA");
    const deFranquicias = hallazgos.filter((h) => h.red === "FRANQUICIAS");
    expect(dePropia.map((h) => h.affectedBranchId)).toEqual(["b2"]);
    expect(dePropia[0].benchmarkBranchName).toBe("Sucursal Norte");
    expect(deFranquicias.map((h) => h.affectedBranchId)).toEqual(["b3"]);

    // b1 sólo saldría marcada si se comparara contra b4, la de la otra red.
    expect(hallazgos.some((h) => h.affectedBranchId === "b1")).toBe(false);

    expect(resultado.alcance).toEqual({
      completa: true,
      visibles: 4,
      total: 4,
      motivo: null,
    });
  });

  it("el podio de cada red se recorta dentro de su red", async () => {
    vi.mocked(getTenantOperatingConfig).mockResolvedValue(config("MIXTO_FRANQUICIAS"));
    programarRecorrido(filasDeSucursales, ventas, comida, manoDeObra);

    const resultado = await CrossBranchService.getBranchQSRRanking("comp-a", 30);
    const [propia, franquicias] = resultado.red!.segmentos;

    // En el consolidado, el top 3 sería b4, b1, b3 (mezclando redes).
    expect(resultado.podiumTop3.map((b) => b.branchId)).toEqual(["b4", "b1", "b3"]);
    expect(propia.podiumTop3.map((b) => b.branchId)).toEqual(["b1", "b2"]);
    expect(franquicias.podiumTop3.map((b) => b.branchId)).toEqual(["b4", "b3"]);
  });
});

describe("getBranchQSRRanking — alcance del actor", () => {
  it("un gerente ve su sucursal, lo dice en alcance y no comparte clave de caché con el consolidado", async () => {
    vi.mocked(getTenantOperatingConfig).mockResolvedValue(config("MIXTO_FRANQUICIAS"));
    programarRecorrido(filasDeSucursales, ventas, comida, manoDeObra);

    const consolidado = await CrossBranchService.getBranchQSRRanking("comp-a", 30);
    const claveConsolidado = clavesDeCache.at(-1)![0];

    programarRecorrido(filasDeSucursales, ventas, comida, manoDeObra);
    const parcial = await CrossBranchService.getBranchQSRRanking("comp-a", 30, gerenteDeB1);
    const claveParcial = clavesDeCache.at(-1)![0];

    // La sucursal del gerente es la única que entra: las otras tres (otra
    // propia y dos franquicias) quedan fuera de sus cifras.
    expect(parcial.branches.map((b) => b.branchId)).toEqual(["b1"]);
    expect(parcial.alcance?.completa).toBe(false);
    expect(parcial.alcance?.visibles).toBe(1);
    expect(parcial.alcance?.total).toBe(4);
    expect(parcial.alcance?.motivo).toContain("el consolidado del grupo");

    // Las cifras del consolidado del gerente no son las del grupo, y la
    // huella del conjunto visible en la clave lo garantiza.
    expect(consolidado.branches).toHaveLength(4);
    expect(claveConsolidado).toContain("MIXTO_FRANQUICIAS-grupo");
    expect(claveParcial).not.toBe(claveConsolidado);
    expect(claveParcial).not.toContain("grupo");

    // Con una sola sucursal no hay con qué compararla: sin anomalías inventadas.
    expect(parcial.anomalies).toEqual([]);
  });

  it("sin ctx el comportamiento es el de siempre: red completa, para jobs y motores", async () => {
    vi.mocked(getTenantOperatingConfig).mockResolvedValue(config("GRUPO_PROPIO"));
    programarRecorrido(soloPropias, ventasPropias, comidaPropias, manoDeObraPropia);

    const resultado = await CrossBranchService.getBranchQSRRanking("comp-a", 30);

    expect(resultado.branches).toHaveLength(2);
    expect(resultado.alcance).toEqual({ completa: true, visibles: 2, total: 2, motivo: null });
  });
});

describe("getBranchQSRRanking — red única con GRUPO_PROPIO", () => {
  it("sin franquicias no hay segmentos y los hallazgos quedan sin etiqueta de red", async () => {
    vi.mocked(getTenantOperatingConfig).mockResolvedValue(config("GRUPO_PROPIO"));
    programarRecorrido(soloPropias, ventasPropias, comidaPropias, manoDeObraPropia);

    const resultado = await CrossBranchService.getBranchQSRRanking("comp-a", 30);

    expect(resultado.red?.segmentada).toBe(false);
    expect(resultado.red?.veredicto.titulo).toBe("Red única · Red propia");
    expect(resultado.red?.contradicciones).toEqual([]);
    expect(resultado.red?.segmentos).toHaveLength(1);
    expect(resultado.red?.segmentos[0].sucursales).toBe(2);

    // El mismo hallazgo de siempre: b2 a 36% contra b1 a 28%, sin red.
    expect(resultado.anomalies).toHaveLength(1);
    expect(resultado.anomalies[0].affectedBranchId).toBe("b2");
    expect(resultado.anomalies[0].red).toBeUndefined();
    expect(clavesDeCache.at(-1)![0]).toContain("GRUPO_PROPIO-grupo");
  });

  it("grupo propio con una franquicia capturada: se segmenta y la contradicción queda escrita", async () => {
    vi.mocked(getTenantOperatingConfig).mockResolvedValue(config("GRUPO_PROPIO"));
    const capturaInconsistente = [...soloPropias, filasDeSucursales[2]];
    programar(
      [branches, capturaInconsistente],
      [dailySalesCuts, ventas],
      [costRecords, comida],
      [inventoryWaste, []],
      [costRecords, manoDeObra],
      [temperatureLogs, []],
    );

    const resultado = await CrossBranchService.getBranchQSRRanking("comp-a", 30);

    expect(resultado.red?.segmentada).toBe(true);
    expect(resultado.red?.contradicciones).toHaveLength(1);
    expect(resultado.red?.contradicciones[0]).toContain("marcadas como franquicia");
    expect(resultado.red?.veredicto.detalle).toContain("declara red propia");
    expect(resultado.red?.segmentos[0].branchIds.sort()).toEqual(["b1", "b2"]);
    expect(resultado.red?.segmentos[1].branchIds).toEqual(["b3"]);
  });

  it("empresa sin sucursales: respuesta vacía con la política declarada, sin contradicción", async () => {
    vi.mocked(getTenantOperatingConfig).mockResolvedValue(config("MIXTO_FRANQUICIAS"));
    programar([branches, []]);

    const resultado = await CrossBranchService.getBranchQSRRanking("comp-a", 30);

    expect(resultado.branches).toEqual([]);
    expect(resultado.red?.contradicciones).toEqual([]);
    expect(resultado.red?.segmentada).toBe(true);
    expect(resultado.alcance?.completa).toBe(true);
  });
});
