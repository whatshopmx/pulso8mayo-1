import { describe, expect, it } from "vitest";
import {
  ETIQUETA_RED,
  idsDeSegmento,
  segmentaRed,
  tipoEmpresaDe,
  veredictoDeRed,
  type SucursalDeRed,
} from "@/lib/company/tenant-network-policy";

/**
 * C22 — V1 de segmentación de la red (criterio: "cada valor tiene casos de
 * inclusión/exclusión o queda expresamente descriptivo").
 *
 * La política es pura a propósito: la calculan el servicio de agregación y
 * esta prueba, y las dos tienen que contar la misma historia. Lo que se
 * comprueba aquí es el contrato decidido el 14-10-2026:
 *
 *  - `GRUPO_PROPIO` con toda la captura propia → una sola red.
 *  - `MIXTO_FRANQUICIAS` → dos redes, y el grupo sin franquicias marcadas
 *    queda advertido en lugar de silencioso.
 *  - Una franquicia **nunca** entra en el promedio de la red propia, ni
 *    aunque el grupo declare que su red es toda propia: esa contradicción se
 *    segmenta y se escribe, no se oculta.
 *  - Sin sucursales no se declara ninguna contradicción: la empresa todavía no
 *    afirma nada sobre su red.
 */

const sucursal = (
  id: string,
  ownershipType: SucursalDeRed["ownershipType"],
  franchiseeUserId: string | null = null,
): SucursalDeRed => ({ id, name: id.toUpperCase(), ownershipType, franchiseeUserId });

const PROPIAS = [sucursal("b1", "OWNED"), sucursal("b2", "OWNED")];
const FRANQUICIA = sucursal("b3", "FRANCHISE", "u-fran-1");
const MIXTAS = [...PROPIAS, FRANQUICIA];

describe("tipoEmpresaDe — lectura defensiva del enum", () => {
  it("acepta los dos valores declarados", () => {
    expect(tipoEmpresaDe("GRUPO_PROPIO")).toBe("GRUPO_PROPIO");
    expect(tipoEmpresaDe("MIXTO_FRANQUICIAS")).toBe("MIXTO_FRANQUICIAS");
  });

  it("cualquier cosa inesperada cae en el default de la columna", () => {
    for (const desconocido of ["OTRO", "", null, undefined, 7, { valor: "MIXTO_FRANQUICIAS" }]) {
      expect(tipoEmpresaDe(desconocido), String(desconocido)).toBe("GRUPO_PROPIO");
    }
  });
});

describe("segmentaRed — GRUPO_PROPIO", () => {
  it("toda la captura propia: una sola red, sin segmentos ni contradicciones", () => {
    const alcance = segmentaRed("GRUPO_PROPIO", PROPIAS);

    expect(alcance.segmentada).toBe(false);
    expect(alcance.segmentos).toHaveLength(1);
    expect(alcance.segmentos[0].tipo).toBe("PROPIA");
    expect(alcance.segmentos[0].sucursales).toHaveLength(2);
    expect(alcance.contradicciones).toEqual([]);
    expect(alcance.consolidada).toHaveLength(2);
  });

  it("una sucursal franquicia en grupo propio: se segmenta y se declara la contradicción", () => {
    const alcance = segmentaRed("GRUPO_PROPIO", MIXTAS);

    expect(alcance.segmentada).toBe(true);
    expect(alcance.contradicciones).toHaveLength(1);
    expect(alcance.contradicciones[0]).toContain("1 sucursal(es) marcadas como franquicia");
    // La franquicia no se cuela en la red propia.
    expect(idsDeSegmento(alcance.segmentos[0])).toEqual(["b1", "b2"]);
    expect(idsDeSegmento(alcance.segmentos[1])).toEqual(["b3"]);
  });

  it("todas las sucursales franquicias en grupo propio: también se segmentan", () => {
    // Regresión: con una sola propiedad capturada la política anterior no
    // segmentaba y dejaba las franquicias dentro de un segmento llamado
    // «Red propia» — exactamente el error que existe para no cometer.
    const alcance = segmentaRed("GRUPO_PROPIO", [FRANQUICIA, sucursal("b4", "FRANCHISE", "u-fran-2")]);

    expect(alcance.segmentada).toBe(true);
    expect(alcance.segmentos[0].tipo).toBe("PROPIA");
    expect(alcance.segmentos[0].sucursales).toEqual([]);
    expect(idsDeSegmento(alcance.segmentos[1])).toEqual(["b3", "b4"]);
    expect(alcance.contradicciones).toHaveLength(1);
  });
});

describe("segmentaRed — MIXTO_FRANQUICIAS", () => {
  it("dos redes con la captura que respalda la declaración", () => {
    const alcance = segmentaRed("MIXTO_FRANQUICIAS", MIXTAS);

    expect(alcance.segmentada).toBe(true);
    expect(alcance.tipoEmpresa).toBe("MIXTO_FRANQUICIAS");
    expect(alcance.contradicciones).toEqual([]);
    // El orden de los segmentos es estable: propia primero, franquicias después.
    expect(alcance.segmentos.map((s) => s.tipo)).toEqual(["PROPIA", "FRANQUICIAS"]);
    expect(idsDeSegmento(alcance.segmentos[0])).toEqual(["b1", "b2"]);
    expect(idsDeSegmento(alcance.segmentos[1])).toEqual(["b3"]);
    // El consolidado sigue siendo todas las sucursales: segmentar añade
    // comparación por red, no quita el consolidado.
    expect(alcance.consolidada).toHaveLength(3);
  });

  it("declara mixto y no tiene ninguna franquicia: se segmenta y se advierte", () => {
    const alcance = segmentaRed("MIXTO_FRANQUICIAS", PROPIAS);

    expect(alcance.segmentada).toBe(true);
    expect(alcance.contradicciones).toHaveLength(1);
    expect(alcance.contradicciones[0]).toContain("ninguna sucursal está marcada como franquicia");
    expect(alcance.segmentos[1].sucursales).toEqual([]);
  });
});

describe("segmentaRed — sin sucursales", () => {
  it("no declara contradicción: la empresa todavía no afirma nada sobre su red", () => {
    expect(segmentaRed("MIXTO_FRANQUICIAS", []).contradicciones).toEqual([]);
    expect(segmentaRed("GRUPO_PROPIO", []).contradicciones).toEqual([]);
  });

  it("la declaración sigue vigente esperando captura", () => {
    expect(segmentaRed("MIXTO_FRANQUICIAS", []).segmentada).toBe(true);
    expect(segmentaRed("GRUPO_PROPIO", []).segmentada).toBe(false);
  });
});

describe("veredictoDeRed — lo que la pantalla cuenta", () => {
  it("red única: el consolidado es la red", () => {
    const veredicto = veredictoDeRed({ segmentada: false, tipoEmpresa: "GRUPO_PROPIO" });
    expect(veredicto.segmentada).toBe(false);
    expect(veredicto.titulo).toBe("Red única · Red propia");
    expect(veredicto.detalle).toContain("comparan todas sus sucursales");
  });

  it("segmentada declarando franquiciatarios: cada red se compara con las suyas", () => {
    const veredicto = veredictoDeRed({ segmentada: true, tipoEmpresa: "MIXTO_FRANQUICIAS" });
    expect(veredicto.titulo).toBe("Dos redes · Red propia y Red de franquicias");
    expect(veredicto.detalle).toContain("declara franquiciatarios");
  });

  it("segmentada por contradicción: no le atribuye al grupo una declaración que no hizo", () => {
    // Un grupo declarado propio sólo se segmenta porque su captura tiene
    // franquicias: decirle que «declara franquiciatarios» sería mentirle.
    const veredicto = veredictoDeRed({ segmentada: true, tipoEmpresa: "GRUPO_PROPIO" });
    expect(veredicto.titulo).toBe("Dos redes · Red propia y Red de franquicias");
    expect(veredicto.detalle).toContain("declara red propia");
    expect(veredicto.detalle).not.toContain("declara franquiciatarios");
  });
});

describe("etiquetas de red", () => {
  it("son los textos que la pantalla usa sin traducir", () => {
    expect(ETIQUETA_RED).toEqual({ PROPIA: "Red propia", FRANQUICIAS: "Red de franquicias" });
  });
});
