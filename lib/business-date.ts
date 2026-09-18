/**
 * Fechas de negocio de Pulso.
 *
 * Regla: el "día operativo" es el día calendario en la zona del negocio,
 * NO en UTC. La distinción no es académica: en Mexico (UTC-6), a partir de las
 * 18:00 hora local el reloj UTC ya está en el día siguiente. Derivar la fecha
 * con `new Date().toISOString().slice(0, 10)` hace que el dashboard pida los
 * cortes de venta de MAÑANA durante toda la cena — el rush más importante de
 * un restaurante.
 *
 * Por eso la fecha se deriva siempre con `Intl` sobre BUSINESS_TIMEZONE y
 * nunca con `toISOString()`.
 */

export const BUSINESS_TIMEZONE = "America/Mexico_City";

/** Offset de la zona de negocio respecto a UTC, en ms, en el instante `at`. */
function timeZoneOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIMEZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const get = (type: string): number => {
    const value = parts.find((p) => p.type === type)?.value;
    if (value === undefined) {
      throw new Error(`No se pudo leer "${type}" al resolver ${BUSINESS_TIMEZONE}`);
    }
    return Number(value);
  };

  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24, // algunos entornos devuelven "24" para medianoche
    get("minute"),
    get("second"),
  );

  return asIfUtc - at.getTime();
}

/** El día de negocio (YYYY-MM-DD) que contiene `at`. */
export function businessDateIso(at: Date = new Date()): string {
  // 'en-CA' formatea como YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function isoToUtcMidnight(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 0, 0, 0, 0);
}

function addDaysToIso(iso: string, days: number): string {
  const t = new Date(isoToUtcMidnight(iso));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** Instante (UTC) de la medianoche local del día de negocio que contiene `at`. */
export function businessDayStart(at: Date = new Date()): Date {
  const iso = businessDateIso(at);
  const utcMidnight = isoToUtcMidnight(iso);
  // El offset se evalúa en el instante objetivo, no en `at`, para no arrastrar
  // el error si algún día la zona vuelve a observar horario de verano.
  const offset = timeZoneOffsetMs(new Date(utcMidnight));
  return new Date(utcMidnight - offset);
}

/**
 * Último instante (UTC, inclusivo) del día de negocio que contiene `at`.
 * Se calcula desde el inicio del día siguiente para que un cambio de offset
 * no produzca un día de 23 o 25 horas mal recortado.
 */
export function businessDayEnd(at: Date = new Date()): Date {
  const nextIso = addDaysToIso(businessDateIso(at), 1);
  const utcMidnight = isoToUtcMidnight(nextIso);
  const offset = timeZoneOffsetMs(new Date(utcMidnight));
  return new Date(utcMidnight - offset - 1);
}

/**
 * Ancla temporal de una fuente de datos: la fecha de negocio cuyos datos se
 * están mostrando, y si esa fecha es la del día operativo actual.
 *
 * `isCurrent === false` significa que la fuente no tiene datos del día de hoy
 * y se está mostrando lo último disponible. La UI DEBE declararlo: mostrar
 * datos de ayer sin etiqueta es peor que mostrar un cero.
 */
export interface DataAnchor {
  asOf: string;
  isCurrent: boolean;
}

/** Construye el ancla de una fuente a partir de su fecha real más reciente. */
export function dataAnchorFor(latestDate: string | null, at: Date = new Date()): DataAnchor {
  const today = businessDateIso(at);
  const asOf = latestDate ?? today;
  return { asOf, isCurrent: asOf === today };
}
