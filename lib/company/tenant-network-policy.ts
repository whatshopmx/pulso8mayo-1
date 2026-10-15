import type { BranchOwnership } from "@/lib/rbac/abac";

/**
 * C22 — qué hace el **tipo de empresa** (`tenantType`) en las agregaciones de
 * grupo, y cómo se distingue una sucursal propia de una franquiciada.
 *
 * La distinción de propiedades **no se deduce del nombre del valor**: existe
 * como atributo capturado por sucursal, `branches.ownership_type`
 * (`OWNED` | `FRANCHISE`) con `branches.franchisee_user_id` como responsable
 * (`lib/db/schema/core.ts`). Ese es el mismo atributo que leen
 * `branchVisibilityFilter` (`lib/rbac/branch-visibility.ts`) y el eje de
 * franquicias de `evaluateAccess` (`lib/rbac/abac.ts`). El tipo de empresa no
 * lo reemplaza: decide **si la red se separa en segmentos comparables**, que es
 * una pregunta de agregación y no de permiso.
 *
 * Es un módulo puro a propósito —sin Drizzle, sin `next/cache`— porque lo
 * calculan dos lados que tienen que contar la misma historia: el servicio que
 * agrega (`CrossBranchService`) y la prueba que lo comprueba. Lo que decide es
 * una regla de negocio acordada el 14-10-2026:
 *
 *  - `GRUPO_PROPIO` — el grupo declara que su red es propia. La agregación es
 *    una sola red.
 *  - `MIXTO_FRANQUICIAS` — el grupo declara franquiciatarios. La red se separa
 *    en **red propia** y **red de franquicias**, y cada una promedia, rankea y
 *    compara contra las suyas. Un franchiciatario no es una sucursal más de la
 *    red propia: su food cost y su nómina no son la misma economía.
 *
 * **La contradicción no se oculta ni se bloquea.** Un grupo configurado como
 * `GRUPO_PROPIO` que tiene una sucursal marcada `FRANCHISE` es una captura
 * inconsistente, no un caso válido: mezclar esa sucursal dentro de la "red
 * propia" atribuiría al grupo dinero de un tercero. La política segmenta
 * igual y deja la contradicción escrita, que es el mismo criterio de C16.2 —
 *"con varias reglas que cubren, la diferencia avisa, no bloquea"*.
 *
 * **Nada de esto amplía el acceso a datos.** Segmentar sólo decide sobre qué
 * sucursales se calcula el promedio; quién puede ver cuáles es asunto de
 * `branchVisibilityFilter` y se resuelve antes, en el consumidor.
 */

/** Los dos valores que acepta el `PUT` de `operating-config`. */
export const TIPOS_EMPRESA = ["GRUPO_PROPIO", "MIXTO_FRANQUICIAS"] as const;
export type TipoEmpresa = (typeof TIPOS_EMPRESA)[number];

/** Las dos redes en que se puede separar un grupo. */
export const TIPOS_RED = ["PROPIA", "FRANQUICIAS"] as const;
export type TipoRed = (typeof TIPOS_RED)[number];

/** Etiquetas que la pantalla usa sin traducir nada. */
export const ETIQUETA_RED: Record<TipoRed, string> = {
  PROPIA: "Red propia",
  FRANQUICIAS: "Red de franquicias",
};

/** Cómo una sucursal pasa a la política. Es sólo lo que el filtro necesita. */
export interface SucursalDeRed {
  id: string;
  name?: string;
  ownershipType: BranchOwnership;
  franchiseeUserId?: string | null;
}

export interface SegmentoRed<T extends SucursalDeRed = SucursalDeRed> {
  tipo: TipoRed;
  etiqueta: string;
  sucursales: T[];
}

export interface AlcanceRed<T extends SucursalDeRed = SucursalDeRed> {
  /** La declaración del grupo, tal como está guardada. */
  tipoEmpresa: TipoEmpresa;
  /** ¿Se calculan segmentos separados o una sola red? */
  segmentada: boolean;
  /** `OWNED` primero y `FRANCHISE` después, siempre en ese orden. */
  segmentos: Array<SegmentoRed<T>>;
  /**
   * Todas las sucursales que participan en la agregación, en el orden en que
   * las recibió la política. Es el conjunto consolidado: los promedios de
   * grupo no cambian, lo que se añade es poder medirlos por red.
   */
  consolidada: T[];
  /** Capturas inconsistentes que la política deja a la vista. */
  contradicciones: string[];
}

/** Lectura defensiva del enum: cualquier valor inesperado cae en el default. */
export function tipoEmpresaDe(valor: unknown): TipoEmpresa {
  return TIPOS_EMPRESA.includes(valor as TipoEmpresa) ? (valor as TipoEmpresa) : "GRUPO_PROPIO";
}

/**
 * Decide si la red se segmenta, y en qué segmentos.
 *
 * El criterio, en una frase: **se segmenta cuando la captura tiene alguna
 * franquicia, o cuando el grupo declara franquiciatarios**. Los dos
 * caminos llegan al mismo lugar por razones distintas y la diferencia se
 * escribe en `contradicciones`:
 *
 *  - El grupo dice `MIXTO_FRANQUICIAS` y hay franquicias marcadas → caso
 *    normal: dos segmentos.
 *  - El grupo dice `MIXTO_FRANQUICIAS` y **no hay ninguna** marcada → el grupo
 *    afirma una red mixta que la captura no respalda. Se segmenta igual y se
 *    avisa: el atributo de la sucursal es el hecho, la columna es la
 *    declaración, y la política no reescribe una para hacerlas coincidir.
 *  - El grupo dice `GRUPO_PROPIO` y hay una marcada → contradicción en sentido
 *    contrario. Se segmenta igual: una sucursal franquiciada dentro de la "red
 *    propia" es exactamente el error que esta política existe para no
 *    cometer. Si **todas** están marcadas, tampoco se meten en la red
 *    propia: el segmento de franquicias es el único con contenido y el
 *    propio queda vacío a la vista.
 *  - El grupo dice `GRUPO_PROPIO` y todas son `OWNED` → una sola red, sin
 *    segmentos que comparar.
 *
 * En una frase: **se segmenta si el grupo declara franquiciatarios o si la
 * captura tiene alguna franquicia**. La declaración y el atributo son dos
 * fuentes y manda cualquiera de las dos; lo que nunca se permite es meter una
 * franquicia en el promedio de la red propia.
 *
 * Sin sucursales no hay nada que segmentar y tampoco hay contradicción que
 * declarar: una empresa sin sucursales todavía no afirma nada sobre su red, y
 * la declaración (`MIXTO_FRANQUICIAS`) sigue vigente esperando captura.
 */
export function segmentaRed<T extends SucursalDeRed>(
  tipoEmpresa: unknown,
  sucursales: readonly T[],
): AlcanceRed<T> {
  const tipo = tipoEmpresaDe(tipoEmpresa);
  const propias = sucursales.filter((s) => s.ownershipType !== "FRANCHISE");
  const franquicias = sucursales.filter((s) => s.ownershipType === "FRANCHISE");
  const contradicciones: string[] = [];

  // Sin sucursales no se declara nada: la empresa aún no afirma nada sobre su
  // red, y una declaración mixta sin captura no es una inconsistencia —todavía
  // no hay nada capturado— sino una invitación a capturar.
  if (sucursales.length > 0) {
    if (tipo === "MIXTO_FRANQUICIAS" && franquicias.length === 0) {
      contradicciones.push(
        "El grupo declara un tipo de empresa mixto con franquiciatarios y ninguna sucursal está marcada como franquicia.",
      );
    }
    if (tipo === "GRUPO_PROPIO" && franquicias.length > 0) {
      contradicciones.push(
        `El grupo declara ${ETIQUETA_RED.PROPIA.toLowerCase()} y tiene ${franquicias.length} sucursal(es) marcadas como franquicia: se miden aparte igual.`,
      );
    }
  }

  // La declaración y el atributo mandan por separado: una franquicia nunca
  // entra en la red propia, ni aunque el grupo diga que su red es toda propia.
  const segmentada = tipo === "MIXTO_FRANQUICIAS" || franquicias.length > 0;

  const segmentos: Array<SegmentoRed<T>> = segmentada
    ? [
        { tipo: "PROPIA", etiqueta: ETIQUETA_RED.PROPIA, sucursales: propias },
        { tipo: "FRANQUICIAS", etiqueta: ETIQUETA_RED.FRANQUICIAS, sucursales: franquicias },
      ]
    : [{ tipo: "PROPIA", etiqueta: ETIQUETA_RED.PROPIA, sucursales: [...sucursales] }];

  return { tipoEmpresa: tipo, segmentada, segmentos, consolidada: [...sucursales], contradicciones };
}

/** Ids de un segmento. Es lo que las agregaciones filtran. */
export function idsDeSegmento(segmento: SegmentoRed<SucursalDeRed>): string[] {
  return segmento.sucursales.map((s) => s.id);
}

/**
 * Veredicto para la pantalla del recorrido de grupo.
 *
 * Los agregados de red son comparables **dentro** de su red. Cuando la red no
 * está segmentada, el consolidado es la red y no hay nada que aclarar; cuando
 * sí, el consolidado mezcla dos economías y quien lo lee tiene que saberlo.
 */
export function veredictoDeRed(alcance: Pick<AlcanceRed, "segmentada" | "tipoEmpresa">): {
  segmentada: boolean;
  titulo: string;
  detalle: string;
} {
  if (!alcance.segmentada) {
    return {
      segmentada: false,
      titulo: `Red única · ${ETIQUETA_RED.PROPIA}`,
      detalle:
        "El grupo declara red propia: los promedios comparan todas sus sucursales entre sí.",
    };
  }
  // Un grupo declarado propio sólo se segmenta por contradicción de captura:
  // decirle que «declara franquiciatarios» sería mentirle sobre su propia
  // declaración. El título describe lo que se mide; el detalle, por qué.
  if (alcance.tipoEmpresa === "GRUPO_PROPIO") {
    return {
      segmentada: true,
      titulo: `Dos redes · ${ETIQUETA_RED.PROPIA} y ${ETIQUETA_RED.FRANQUICIAS}`,
      detalle:
        "El grupo declara red propia, pero hay sucursales marcadas como franquicia: se miden aparte para no atribuirle al grupo dinero de un tercero.",
    };
  }
  return {
    segmentada: true,
    titulo: `Dos redes · ${ETIQUETA_RED.PROPIA} y ${ETIQUETA_RED.FRANQUICIAS}`,
    detalle:
      "El grupo declara franquiciatarios: cada red se promedia y se compara con las suyas, no con el consolidado.",
  };
}