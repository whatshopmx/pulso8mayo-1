import { expect, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import { ApiError } from "@/lib/api/error";

/**
 * Simulador de `db` para pruebas de alcance: responde por tabla y anota lo que
 * se escribe, de modo que una prueba puede afirmar que un rechazo ocurre
 * *antes* de tocar la base.
 *
 * Nació en `tests/unit/inventory/transfer-scope.test.ts` (C17) y vive aquí
 * porque producción (C17.2) necesita lo mismo, y dos copias del simulador
 * acabarían divergiendo justo en lo que una prueba de aislamiento no puede
 * dejar de comprobar. Cada archivo de prueba declara sus propias tablas: el
 * simulador no conoce el esquema, sólo cómo esculpe una consulta de Drizzle.
 */

export interface Escritura {
  tabla: string;
  valores: Record<string, unknown>;
}

export interface DbSimulado {
  /** Filas que devuelve cada tabla, por nombre legible. */
  filas: Record<string, unknown[]>;
  /** Todo `insert`/`update` que llegó al simulador, en orden. */
  escrituras: Escritura[];
}

/** Pares `[nombre legible, tabla de Drizzle]` que la prueba usa. */
export type Tablas = Array<[string, unknown]>;

export interface OpcionesSimulador {
  /** Reservado para simuladores que también leen cantidades por lote. */
  lotes?: Record<string, number>;
}

/** Superficie de `db` que el simulador sustituye. */
export interface DbSimulable {
  select: unknown;
  insert: unknown;
  update: unknown;
  transaction: unknown;
}

function nombreDe(tablas: Tablas, tabla: unknown): string {
  const encontrada = tablas.find(([, candidata]) => candidata === tabla);
  if (!encontrada) {
    throw new Error(
      "Tabla no declarada en el simulador: sólo se conocen las que la prueba declara.",
    );
  }
  return encontrada[0];
}

/**
 * Ejecutor mínimo con la forma de `db` y del `tx` de `db.transaction`.
 *
 * Dos reglas y ninguna más:
 *
 *  1. **Proyección.** Cuando `select` recibe un objeto, cada clave vale la fila
 *     completa si su valor es la propia tabla (`{ transferItem }`) o la columna
 *     indicada si es una columna. Es lo que hace Drizzle y, sin ello, las
 *     consultas con join llegarían con la forma equivocada.
 *  2. **Filtro del `WHERE`.** Se interpretan las igualdades (`"col" = $n`) y
 *     los `IN` (`"col" in ($1, $2)`) contra las filas de la prueba. Sin esta
 *     regla el simulador devolvería filas ajenas y una prueba de aislamiento
 *     pasaría sin comprobar nada.
 *
 * Lo que no se interpreta (agregados, `count(*)`, `onConflict`) se ignora: para
 * estas pruebas lo que importa es que la escritura no ocurra cuando la guarda
 * rechaza, y eso se observa en `escrituras`.
 */
export function crearSimulador(
  db: DbSimulable,
  tablas: Tablas,
  filas: Record<string, unknown[]>,
  _opciones: OpcionesSimulador = {},
): DbSimulado {
  const estado: DbSimulado = { filas, escrituras: [] };
  const dialecta = new PgDialect();

  const registrar = (tabla: unknown, valores: Record<string, unknown>) => {
    const nombre = nombreDe(tablas, tabla);
    estado.escrituras.push({ tabla: nombre, valores });
    return nombre;
  };

  const ejecutar = (tabla: unknown) => estado.filas[nombreDe(tablas, tabla)] ?? [];

  const proyectar = (proyeccion: unknown, tabla: unknown, candidatas: unknown[]) => {
    if (!proyeccion || typeof proyeccion !== "object") return candidatas;
    const spec = proyeccion as Record<string, unknown>;
    const claves = Object.keys(spec);
    if (claves.length === 0) return candidatas;
    return candidatas.map((fila) => {
      const salida: Record<string, unknown> = {};
      for (const clave of claves) {
        salida[clave] = spec[clave] === tabla ? fila : (fila as Record<string, unknown>)[clave];
      }
      return salida;
    });
  };

  const filtrar = (candidatas: unknown[], where: unknown) => {
    if (!where) return candidatas;
    const consulta = dialecta.sqlToQuery(where as never);
    const texto = consulta.sql;

    // El SQL nombra las columnas en snake_case y las filas de la prueba usan el
    // objeto de Drizzle (`company_id` -> `companyId`).
    const aClave = (columna: string) =>
      columna.replace(/_([a-z])/g, (_, letra: string) => letra.toUpperCase());

    return candidatas.filter((fila) => {
      const registro = fila as Record<string, unknown>;

      for (const igual of texto.matchAll(/"([a-z_]+)"\s*=\s*\$(\d+)/g)) {
        const valor = consulta.params[Number(igual[2]) - 1];
        const propio = registro[aClave(igual[1])];
        if (propio !== valor && String(propio) !== String(valor)) return false;
      }

      for (const dentro of texto.matchAll(/"([a-z_]+)"\s+in\s*\(([^)]*)\)/g)) {
        const propios = [...dentro[2].matchAll(/\$(\d+)/g)].map(
          (n) => consulta.params[Number(n[1]) - 1],
        );
        if (!propios.includes(registro[aClave(dentro[1])] as never)) return false;
      }

      return true;
    });
  };

  const cadena = (tabla: unknown, proyeccion?: unknown, where?: unknown): any => {
    const filasDe = () => proyectar(proyeccion, tabla, filtrar(ejecutar(tabla), where));
    return {
      where: (condicion: unknown) => cadena(tabla, proyeccion, condicion),
      orderBy: () => cadena(tabla, proyeccion, where),
      innerJoin: () => cadena(tabla, proyeccion, where),
      leftJoin: () => cadena(tabla, proyeccion, where),
      limit: async () => filasDe().slice(0, 1),
      // Thenable para que `await cadena(...)` devuelva filas. Los parámetros no
      // se llaman `resolver`: tapa `filasDe` y la promesa se resolvía con
      // `undefined`.
      then: (cumplir: (filas: unknown[]) => unknown, fallar: (e: unknown) => unknown) =>
        Promise.resolve(filasDe()).then(cumplir, fallar),
    };
  };

  /**
   * `update(...).set(...).where(...)` escribe de verdad sobre las filas que
   * casan: sin esto, una transición no se vería en la lectura siguiente y el
   * recorrido completo no se podría recorrer.
   */
  const actualizar = (tabla: unknown, valores: Record<string, unknown>, where: unknown) => {
    registrar(tabla, valores);
    const afectadas = filtrar(ejecutar(tabla), where);
    for (const fila of afectadas) Object.assign(fila as Record<string, unknown>, valores);
    return afectadas;
  };

  /** `insert(...).values(...)` escribe al esperarse, como una consulta real. */
  const insertar = (tabla: unknown, valores: Record<string, unknown> | Record<string, unknown>[]) => {
    const escribir = () => {
      registrar(tabla, valores as Record<string, unknown>);
      return Array.isArray(valores) ? valores : [valores];
    };
    const cadenaInsert: any = {
      returning: async () => escribir().slice(0, 1),
      onConflictDoNothing: () => cadenaInsert,
      then: (cumplir: (v: unknown) => unknown, fallar: (e: unknown) => unknown) =>
        Promise.resolve(escribir()).then(() => cumplir(undefined), fallar),
    };
    return cadenaInsert;
  };

  const actualizador = (tabla: unknown, valores: Record<string, unknown>, where: unknown) => ({
    returning: async () => actualizar(tabla, valores, where).slice(0, 1),
    then: (cumplir: (v: unknown) => unknown, fallar: (e: unknown) => unknown) =>
      Promise.resolve(actualizar(tabla, valores, where)).then(() => cumplir(undefined), fallar),
  });

  const ejecutor: any = {
    select: (proyeccion?: unknown) => ({ from: (tabla: unknown) => cadena(tabla, proyeccion) }),
    update: (tabla: unknown) => ({
      set: (valores: Record<string, unknown>) => ({ where: (cond: unknown) => actualizador(tabla, valores, cond) }),
    }),
    insert: (tabla: unknown) => ({
      values: (valores: Record<string, unknown> | Record<string, unknown>[]) => insertar(tabla, valores),
    }),
  };

  vi.mocked(db.select as never).mockImplementation(((proyeccion?: unknown) => ({
    from: (tabla: unknown) => cadena(tabla, proyeccion),
  })) as never);
  vi.mocked(db.insert as never).mockImplementation(((tabla: unknown) => ({
    values: (valores: Record<string, unknown> | Record<string, unknown>[]) => insertar(tabla, valores),
  })) as never);
  vi.mocked(db.update as never).mockImplementation(((tabla: unknown) => ({
    set: (valores: Record<string, unknown>) => ({ where: (cond: unknown) => actualizador(tabla, valores, cond) }),
  })) as never);
  vi.mocked(db.transaction as never).mockImplementation(((cb: (tx: unknown) => unknown) =>
    Promise.resolve(cb(ejecutor))) as never);

  return estado;
}

/**
 * Captura el `ApiError` que lanza una guarda. Es asíncrona a propósito: las
 * guardas corren tras un `await`, así que un `try/catch` sin `await` no
 * atrapa nada y la promesa rechazada se reporta como no manejada.
 */
export async function capturarError(accion: () => unknown | Promise<unknown>): Promise<ApiError> {
  try {
    await accion();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error("Se esperaba un ApiError y la operación no lanzó nada.");
}