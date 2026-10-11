/**
 * Política única de validación de turnos (H08).
 *
 * Antes de este módulo convivían tres juegos de reglas para la misma pregunta
 * —¿este turno es válido?—:
 *
 * - `shift-validation-service.ts`: 8h diarias, 48h semanales, 8h de descanso
 *   (advertencia) y 6 días consecutivos. Lo usaba la interfaz.
 * - `app/api/shifts/route.ts`: 12h máximas, fin posterior al inicio con
 *   excepción nocturna, y solapamiento. Lo usaba la API.
 * - `PlannedShiftServiceImpl`: sólo solapamiento, con comparación de cadenas.
 *   Lo que efectivamente se escribía.
 *
 * El mismo turno podía ser "válido" en la pantalla y rechazado por la API, y la
 * API aceptaba lo que la pantalla pintaba en rojo. Aquí vive una sola regla y
 * los tres caminos la comparten.
 *
 * ## Procedencia de los límites
 *
 * Cada valor lleva de dónde sale. **No es una validación legal**: este módulo
 * no audita legislación vigente, documenta los límites que el proyecto ya
 * aplicaba en distintos sitios y fija en cuál se discrepa. Cuando el negocio
 * confirme cada uno, la columna "estado" pasa a regla y el resto del sistema
 * hereda la respuesta sin volver a decidirla.
 *
 * | Límite | Valor | Regla | Dónde vivía antes | Estado |
 * | --- | --- | --- | --- | --- |
 * | Duración del turno | 12 h | Bloqueante | API + `labor-validation.ts` + `docs/SISTEMA_TURNOS.md` | Confirmado por el sistema |
 * | Jornada diaria | 8 h | **Advertencia** | `shift-validation-service` (bloqueante) | **Discrepa**: la UI bloqueaba y el servidor aceptaba |
 * | Semana | 48 h | Bloqueante | `shift-validation-service` | Confirmado por el sistema |
 * | Descanso entre jornadas | 8 h | **Advertencia** | `shift-validation-service` | Confirmado por el sistema |
 * | Días consecutivos | 6 | Bloqueante | `shift-validation-service` | Confirmado por el sistema |
 *
 * La jornada diaria queda como advertencia a propósito: con ella bloqueante, un
 * turno de 9 horas que hoy acepta la API pasaría a rechazarse, y eso es una
 * decisión de negocio —y posiblemente legal— que este módulo no tiene por qué
 * tomar en silencio. Lo que hace es dejar de fingir que la pantalla y el
 * servidor dicen lo mismo.
 */

import { parseISO, startOfWeek, differenceInDays } from "date-fns";
import type { LFTViolation, LFTViolationType } from "@/lib/types/shifts";

/** Límites vigentes y su severidad. Ver la tabla de procedencia del módulo. */
export const SHIFT_RULES = {
  /** Duración máxima de un turno. Bloqueante. */
  MAX_SHIFT_MINUTES: 12 * 60,
  /** Jornada diaria recomendada. Advertencia mientras el negocio no la confirme. */
  MAX_DAILY_MINUTES: 8 * 60,
  /** Semana máxima. Bloqueante. */
  MAX_WEEKLY_MINUTES: 48 * 60,
  /** Descanso mínimo entre jornadas. Advertencia. */
  MIN_REST_MINUTES: 8 * 60,
  /** Días consecutivos máximos. Bloqueante. */
  MAX_CONSECUTIVE_DAYS: 6,
} as const;

/**
 * Infracción con su severidad ya resuelta.
 *
 * Se separa de `LFTViolation` —que usa `severidad: "error" | "warning"` en su
 * propio idioma— para que esta política hable de "bloqueante" y "advertencia",
 * que es la distinción que de verdad decide si algo se guarda.
 */
export interface InfraccionTurno {
  tipo: LFTViolationType;
  bloqueante: boolean;
  mensaje: string;
  shiftId: string;
}

export interface ResultadoValidacion {
  valido: boolean;
  errores: InfraccionTurno[];
  advertencias: InfraccionTurno[];
}

/** Turno tal como lo necesita la política: sólo lo que las reglas miran. */
export interface TurnoAValidar {
  id: string;
  userId: string;
  /** Fecha de negocio, texto `YYYY-MM-DD`. */
  shiftDate: string;
  /** `HH:mm`. */
  startTime: string;
  endTime: string;
  status?: string | null;
}

const CANCELADOS = new Set(["CANCELLED"]);

function minutos(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Duración en minutos, con cruce de medianoche. */
export function duracionMinutos(startTime: string, endTime: string): number {
  const inicio = minutos(startTime);
  const fin = minutos(endTime);
  return fin >= inicio ? fin - inicio : 24 * 60 - inicio + fin;
}

function cruzaMedianoche(startTime: string, endTime: string): boolean {
  return minutos(endTime) < minutos(startTime);
}

/** `HH:mm` bien formado. Antes la API comparaba `parseInt("07:00")`, que es 7. */
function formatoHoraValido(time: unknown): time is string {
  return typeof time === "string" && /^\d{2}:\d{2}$/.test(time);
}

function comparables(turno: TurnoAValidar): boolean {
  return formatoHoraValido(turno.startTime) && formatoHoraValido(turno.endTime);
}

function vigente(turno: TurnoAValidar): boolean {
  return !CANCELADOS.has(turno.status ?? "");
}

/**
 * Valida un turno candidato contra los turnos que ya tiene ese empleado.
 *
 * `existentes` son los del **mismo empleado**: la política agrupa por persona,
 * así que pasarle los de otros no cambia el resultado y sí invite a creerse
 * que se está comprobando algo más de lo que se comprueba.
 */
export function evaluarTurno(
  candidato: TurnoAValidar,
  existentes: TurnoAValidar[] = []
): ResultadoValidacion {
  const errores: InfraccionTurno[] = [];
  const advertencias: InfraccionTurno[] = [];

  if (!comparables(candidato)) {
    return {
      valido: false,
      errores: [
        {
          tipo: "DAILY_HOURS",
          bloqueante: true,
          mensaje: "La hora del turno no tiene el formato HH:mm.",
          shiftId: candidato.id,
        },
      ],
      advertencias: [],
    };
  }

  const duracion = duracionMinutos(candidato.startTime, candidato.endTime);

  // Duración del turno — bloqueante, con la excepción nocturna que la API ya
  // tenía: 23:00 → 07:00 son 8 horas, no "fin anterior al inicio".
  if (duracion === 0 && !cruzaMedianoche(candidato.startTime, candidato.endTime)) {
    errores.push({
      tipo: "DAILY_HOURS",
      bloqueante: true,
      mensaje: "La hora de fin debe ser posterior a la hora de inicio.",
      shiftId: candidato.id,
    });
  } else if (duracion > SHIFT_RULES.MAX_SHIFT_MINUTES) {
    errores.push({
      tipo: "DAILY_HOURS",
      bloqueante: true,
      mensaje: `El turno de ${(duracion / 60).toFixed(1)} horas excede el límite de ${SHIFT_RULES.MAX_SHIFT_MINUTES / 60} horas.`,
      shiftId: candidato.id,
    });
  }

  // Jornada diaria — advertencia mientras el negocio no la confirme.
  if (duracion > SHIFT_RULES.MAX_DAILY_MINUTES) {
    advertencias.push({
      tipo: "DAILY_HOURS",
      bloqueante: false,
      mensaje: `Turno de ${(duracion / 60).toFixed(1)} horas: excede la jornada de ${SHIFT_RULES.MAX_DAILY_MINUTES / 60} horas.`,
      shiftId: candidato.id,
    });
  }

  const mismos = existentes.filter(
    (t) =>
      t.userId === candidato.userId &&
      // El mismo turno no se solapa consigo mismo. `evaluarTurnos` pasa la lista
      // completa —incluido el candidato— y sin esta guarda el primer resultado
      // sería siempre "solapamiento consigo mismo".
      t.id !== candidato.id &&
      vigente(t) &&
      comparables(t)
  );

  // Solapamiento en el mismo día.
  const solapado = mismos.some(
    (otro) =>
      otro.shiftDate === candidato.shiftDate &&
      minutos(candidato.startTime) < minutos(otro.endTime) &&
      minutos(candidato.endTime) > minutos(otro.startTime)
  );
  if (solapado) {
    errores.push({
      tipo: "SHIFT_OVERLAP",
      bloqueante: true,
      mensaje: "El empleado ya tiene un turno que se solapa con este horario.",
      shiftId: candidato.id,
    });
  }

  // Semana.
  const inicioSemana = startOfWeek(parseISO(candidato.shiftDate), { weekStartsOn: 1 });
  const minutosSemana = mismos
    .filter((t) => {
      const semana = startOfWeek(parseISO(t.shiftDate), { weekStartsOn: 1 });
      return semana.getTime() === inicioSemana.getTime();
    })
    .reduce((total, t) => total + duracionMinutos(t.startTime, t.endTime), 0);

  if (minutosSemana + duracion > SHIFT_RULES.MAX_WEEKLY_MINUTES) {
    errores.push({
      tipo: "WEEKLY_HOURS",
      bloqueante: true,
      mensaje: "El empleado excedería el límite semanal de 48 horas.",
      shiftId: candidato.id,
    });
  }

  // Descanso entre jornadas — advertencia, igual que siempre fue.
  const advertenciaDescanso = descansoInsuficiente(candidato, mismos);
  if (advertenciaDescanso) advertencias.push(advertenciaDescanso);

  return { valido: errores.length === 0, errores, advertencias };
}

/**
 * Valida un conjunto de turnos de varios empleados.
 *
 * Devuelve el mismo resultado agregado para cada turno, más el control de días
 * consecutivos por persona, que sólo tiene sentido sobre el conjunto.
 */
export function evaluarTurnos(turnos: TurnoAValidar[]): ResultadoValidacion {
  const errores: InfraccionTurno[] = [];
  const advertencias: InfraccionTurno[] = [];

  for (const turno of turnos) {
    const resultado = evaluarTurno(turno, turnos);
    errores.push(...resultado.errores);
    advertencias.push(...resultado.advertencias);
  }

  errores.push(...diasConsecutivos(turnos));

  const unicas = deduplicar([...errores, ...advertencias]);
  return {
    valido: errores.length === 0,
    errores: unicas.filter((i) => i.bloqueante),
    advertencias: unicas.filter((i) => !i.bloqueante),
  };
}

/**
 * Descanso insuficiente entre la jornada anterior y la del candidato.
 *
 * Se mide contra el turno que **termina** el día anterior, que es el que
 * define la salida real del descanso. Un turno de 23:00 a 07:00 termina a las
 * 07:00 aunque empezó la noche anterior.
 */
function descansoInsuficiente(
  candidato: TurnoAValidar,
  mismos: TurnoAValidar[]
): InfraccionTurno | null {
  for (const previo of mismos) {
    const diasDeDiferencia = diasEntre(previo.shiftDate, candidato.shiftDate);
    if (diasDeDiferencia !== 1) continue;

    const finPrevio = minutos(previo.endTime);
    const inicio = minutos(candidato.startTime);
    const descanso =
      finPrevio > inicio ? 24 * 60 - finPrevio + inicio : inicio - finPrevio;

    if (descanso < SHIFT_RULES.MIN_REST_MINUTES) {
      return {
        tipo: "REST_PERIOD",
        bloqueante: false,
        mensaje: `Descanso de ${Math.floor(descanso / 60)}h entre jornadas: el mínimo es de ${SHIFT_RULES.MIN_REST_MINUTES / 60} horas.`,
        shiftId: candidato.id,
      };
    }
  }

  return null;
}

/** Días entre dos fechas de negocio. `-1` si alguna no es una fecha válida. */
function diasEntre(desde: string, hasta: string): number {
  if (!formatoFechaValida(desde) || !formatoFechaValida(hasta)) return -1;
  return differenceInDays(parseISO(hasta), parseISO(desde));
}

function diasConsecutivos(turnos: TurnoAValidar[]): InfraccionTurno[] {
  const porEmpleado = new Map<string, TurnoAValidar[]>();

  for (const turno of turnos) {
    if (!vigente(turno) || !formatoFechaValida(turno.shiftDate)) continue;
    const lista = porEmpleado.get(turno.userId) ?? [];
    lista.push(turno);
    porEmpleado.set(turno.userId, lista);
  }

  const errores: InfraccionTurno[] = [];

  for (const lista of porEmpleado.values()) {
    const ordenadas = [...lista].sort(
      (a, b) => parseISO(a.shiftDate).getTime() - parseISO(b.shiftDate).getTime()
    );

    let consecutivos = 1;
    for (let i = 1; i < ordenadas.length; i++) {
      const dias = differenceInDays(
        parseISO(ordenadas[i].shiftDate),
        parseISO(ordenadas[i - 1].shiftDate)
      );
      consecutivos = dias === 1 ? consecutivos + 1 : 1;
      if (consecutivos > SHIFT_RULES.MAX_CONSECUTIVE_DAYS) {
        errores.push({
          tipo: "DAILY_HOURS",
          bloqueante: true,
          mensaje: `Más de ${SHIFT_RULES.MAX_CONSECUTIVE_DAYS} días consecutivos de trabajo.`,
          shiftId: ordenadas[i].id,
        });
      }
    }
  }

  return errores;
}

function formatoFechaValida(fecha: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(fecha) && !Number.isNaN(parseISO(fecha).getTime());
}

function deduplicar(infracciones: InfraccionTurno[]): InfraccionTurno[] {
  const vistos = new Set<string>();
  return infracciones.filter((i) => {
    const clave = `${i.tipo}-${i.shiftId}-${i.mensaje}`;
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });
}

/**
 * Adapta el resultado de la política al tipo que ya consume la interfaz.
 *
 * La interfaz (`useShiftValidation`, `conflictSummary`) cuenta `severidad:
 * "error"` para marcar en rojo. Una advertencia de esta política —jornada de 8
 * horas— se traduce a `"warning"`, no a `"error"`: así la pantalla dice
 * exactamente lo mismo que el servidor, que la deja pasar.
 */
export function aLftViolations(resultado: ResultadoValidacion): {
  isValid: boolean;
  errors: LFTViolation[];
  warnings: LFTViolation[];
} {
  return {
    isValid: resultado.valido,
    errors: resultado.errores.map((i) => ({
      type: i.tipo,
      severity: "error" as const,
      message: i.mensaje,
      shiftId: i.shiftId,
    })),
    warnings: resultado.advertencias.map((i) => ({
      type: i.tipo,
      severity: "warning" as const,
      message: i.mensaje,
      shiftId: i.shiftId,
    })),
  };
}