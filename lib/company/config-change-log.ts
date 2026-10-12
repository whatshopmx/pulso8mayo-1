/**
 * C14.2 — historial de actor y cambio de la configuración operativa.
 *
 * El PUT escribe valores, no razones: sin un rastro, cambiar el IVA de 16 a 8
 * y volver a ponerlo a 16 dos meses después deja los números sin explicación.
 * Aquí se calcula *qué cambió de verdad* —una fila por campo, con el valor
 * anterior y el nuevo— para que el efecto de una configuración se pueda
 * explicar sin adivinar.
 *
 * El diff es una parte pura, sin Drizzle, y por eso se prueba directamente.
 */

export interface ConfigChange {
  /** Nombre de la columna, tal como la acepta el PUT. */
  campo: string;
  anterior: unknown;
  nuevo: unknown;
}

/**
 * Normaliza a un tipo comparable y guardable.
 *
 * Los porcentajes viajan como número en el PUT pero se guardan como
 * `numeric(5,2)` → string; sin normalizar, escribir 16 donde ya había "16.00"
 * parecería un cambio. Un `numeric` que no es número (una dimensión como
 * "MEDIA") se conserva como texto.
 */
function normaliza(valor: unknown): unknown {
  if (valor === undefined || valor === null || valor === "") return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : String(valor);
  if (typeof valor === "string") {
    const numero = Number(valor);
    return Number.isFinite(numero) ? numero : valor;
  }
  return valor;
}

/** Un solo campo cambió si su valor normalizado dejó de coincidir. */
function cambio(campo: string, anterior: unknown, nuevo: unknown): ConfigChange | null {
  const antes = normaliza(anterior);
  const despues = normaliza(nuevo);
  if (antes === despues) return null;
  return { campo, anterior: antes, nuevo: despues };
}

/**
 * Diferencia la configuración guardada contra lo que se quiere escribir.
 *
 * Sólo se consideran los campos presentes en `nuevo`: el PUT es parcial y un
 * campo ausente significa "no lo toques", no "bórralo". `cortesia` se resuelve
 * aparte porque el tope de cortesías vive en `companies`, no en la fila de
 * configuración.
 */
export function diferenciasDeConfig(
  guardado: Record<string, unknown>,
  nuevo: Record<string, unknown>,
  cortesia?: { anterior: number | null; nuevo: number | null | undefined }
): ConfigChange[] {
  const cambios: ConfigChange[] = [];
  for (const [campo, valor] of Object.entries(nuevo)) {
    if (campo === "courtesyWasteMonthlyCapCents") continue;
    const diferencia = cambio(campo, guardado[campo], valor);
    if (diferencia) cambios.push(diferencia);
  }
  if (cortesia?.nuevo !== undefined) {
    const diferencia = cambio("courtesyWasteMonthlyCapCents", cortesia.anterior, cortesia.nuevo);
    if (diferencia) cambios.push(diferencia);
  }
  return cambios;
}