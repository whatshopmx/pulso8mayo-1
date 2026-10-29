import { localDateString } from "@/lib/workflows/today";

const states = new Map<string, number>();

/** Repetir un reset conserva cantidades y escenarios; los IDs siguen siendo nuevos. */
export function resetSeedRandom(): void { states.clear(); }

export function seedRandom(namespace: string): number {
  let state = states.get(namespace);
  if (state === undefined) {
    state = [...namespace].reduce((hash, char) => Math.imul(hash, 31) + char.charCodeAt(0), 29) >>> 0;
  }
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  states.set(namespace, state);
  return state / 4294967296;
}

/** Fecha civil de CDMX a mediodía UTC, independiente de la zona del proceso. */
export function seedDate(offset = 0, now = new Date()): Date {
  const date = new Date(`${localDateString(now, "America/Mexico_City")}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date;
}

/** Escenarios en jornadas existentes: el domingo no puede eliminar una incidencia. */
export function seedWorkday(ordinal: number, now = new Date()): string {
  const date = seedDate(0, now);
  for (let remaining = ordinal; remaining > 0;) {
    date.setUTCDate(date.getUTCDate() - 1);
    if (date.getUTCDay() !== 0) remaining--;
  }
  return date.toISOString().slice(0, 10);
}
