import { describe, it, expect } from "vitest";

import {
  SHIFT_RULES,
  aLftViolations,
  aplicarExcepciones,
  duracionMinutos,
  evaluarTurno,
  evaluarTurnos,
  mencionaRegla,
  mensajesConRegla,
  sinMarcadores,
  type TurnoAValidar,
} from "@/lib/labor/shift-rules";
import { shiftValidationService } from "@/lib/services/shift-validation-service";
import { shiftCompleto } from "../../fixtures/tenant-isolation";

/**
 * C09.1 — una sola política de validación de turnos (H08).
 *
 * Estas pruebas fijan la política y, sobre todo, sus **bordes**, porque la
 * decisión que se tomó fue deliberadamente conservadora: la jornada de 8 horas
 * es advertencia y no bloqueante, para no cambiar qué acepta el sistema sin
 * una decisión de negocio. Si alguien la sube a bloqueante, el cambio tiene que
 * romper aquí a propósito.
 *
 * También fijan la equivalencia entre la fachada que consume la interfaz y la
 * política: la pantalla y el servidor deben decir lo mismo, que era el agujero.
 */

const BASE = {
  id: "turno-1",
  userId: "user-1",
  shiftDate: "2026-03-16", // lunes
  startTime: "07:00",
  endTime: "15:00",
  status: "DRAFT",
};

function turno(overrides: Partial<TurnoAValidar> = {}): TurnoAValidar {
  return { ...BASE, ...overrides };
}

describe("duracionMinutos", () => {
  it("mide un turno del mismo día", () => {
    expect(duracionMinutos("07:00", "15:00")).toBe(480);
  });

  it("mide el cruce de medianoche", () => {
    expect(duracionMinutos("23:00", "07:00")).toBe(480);
  });

  it("una hora igual a la otra es cero, no 24 horas", () => {
    expect(duracionMinutos("09:00", "09:00")).toBe(0);
  });
});

describe("evaluarTurno — límites y su severidad", () => {
  it("un turno normal no se queja de nada", () => {
    const resultado = evaluarTurno(turno());

    expect(resultado.valido).toBe(true);
    expect(resultado.errores).toEqual([]);
    expect(resultado.advertencias).toEqual([]);
  });

  it("más de 12 horas bloquea, con el mensaje que ya conocía la API", () => {
    const resultado = evaluarTurno(turno({ startTime: "06:00", endTime: "19:00" }));

    expect(resultado.valido).toBe(false);
    expect(resultado.errores[0].tipo).toBe("DAILY_HOURS");
    expect(resultado.errores[0].mensaje).toContain("12 horas");
  });

  it("una jornada de más de 8 horas bloquea", () => {
    // C09.1 lo dejó en advertencia porque cambiar qué acepta el sistema es
    // decisión del negocio. El negocio lo confirmó: ahora bloquea, y su salida
    // es la excepción auditada, no el silencio.
    const resultado = evaluarTurno(turno({ startTime: "07:00", endTime: "16:00" }));

    expect(resultado.valido).toBe(false);
    expect(resultado.errores.map((e) => e.regla)).toContain("MAX_DAILY_HOURS");
    expect(resultado.errores[0].mensaje).toContain("8 horas");
  });

  it("exactamente 8 horas no bloquea: el límite es 'más de'", () => {
    expect(evaluarTurno(turno({ startTime: "07:00", endTime: "15:00" })).valido).toBe(true);
  });

  it("un turno nocturno que cruza medianoche no se toma por inválido", () => {
    const resultado = evaluarTurno(turno({ startTime: "23:00", endTime: "07:00" }));

    expect(resultado.valido).toBe(true);
    expect(resultado.errores).toEqual([]);
  });

  it("hora de fin igual a la de inicio bloquea", () => {
    const resultado = evaluarTurno(turno({ startTime: "09:00", endTime: "09:00" }));

    expect(resultado.valido).toBe(false);
    expect(resultado.errores[0].mensaje).toContain("posterior");
  });

  it("una hora mal formada bloquea en vez de compararse como número", () => {
    const resultado = evaluarTurno(turno({ startTime: "7", endTime: "15:00" }));

    expect(resultado.valido).toBe(false);
    expect(resultado.errores[0].mensaje).toContain("HH:mm");
  });
});

describe("evaluarTurno — solapamiento, semana y descanso", () => {
  it("solapa con un turno del mismo empleado y día", () => {
    const resultado = evaluarTurno(
      turno({ startTime: "14:00", endTime: "22:00" }),
      [turno({ id: "previo", startTime: "07:00", endTime: "15:00" })]
    );

    expect(resultado.valido).toBe(false);
    expect(resultado.errores.map((e) => e.tipo)).toContain("SHIFT_OVERLAP");
  });

  it("no solapa con un turno del mismo empleado en otro día", () => {
    const resultado = evaluarTurno(turno(), [
      turno({ id: "previo", shiftDate: "2026-03-17" }),
    ]);

    expect(resultado.valido).toBe(true);
  });

  it("no solapa con un turno de otro empleado", () => {
    const resultado = evaluarTurno(turno(), [
      turno({ id: "otro", userId: "user-2", startTime: "10:00", endTime: "12:00" }),
    ]);

    expect(resultado.valido).toBe(true);
  });

  it("un turno CANCELLED no bloquea nada", () => {
    const resultado = evaluarTurno(
      turno({ startTime: "14:00", endTime: "22:00" }),
      [turno({ id: "previo", startTime: "07:00", endTime: "15:00", status: "CANCELLED" })]
    );

    expect(resultado.valido).toBe(true);
  });

  it("exceder la semana bloquea", () => {
    const lunes = turno({ id: "lun", shiftDate: "2026-03-16", startTime: "06:00", endTime: "18:00" });
    const martes = turno({ id: "mar", shiftDate: "2026-03-17", startTime: "06:00", endTime: "18:00" });
    const miercoles = turno({ id: "mie", shiftDate: "2026-03-18" });

    // 6 turnos de 12 h en la semana = 72 h; el séptimo turno ya no cabe.
    const existentes = Array.from({ length: 5 }, (_, i) => ({
      ...lunes,
      id: `previo-${i}`,
      shiftDate: `2026-03-${16 + i}`,
    }));

    const resultado = evaluarTurno(miercoles, [...existentes, martes]);

    expect(resultado.valido).toBe(false);
    expect(resultado.errores.map((e) => e.tipo)).toContain("WEEKLY_HOURS");
    void lunes;
  });

  it("descanso corto entre jornadas es advertencia, no bloqueo", () => {
    // El día anterior acaba a las 22:00 y hoy empieza a las 07:00: 9 h de
    // descanso, por encima del mínimo, así que no avisa.
    const conDescanso = evaluarTurno(turno(), [
      turno({ id: "previo", shiftDate: "2026-03-15", startTime: "14:00", endTime: "22:00" }),
    ]);
    expect(conDescanso.advertencias).toEqual([]);

    // Acaba a las 23:00 → 8 h exactas: el mínimo se cumple, no avisa.
    const justo = evaluarTurno(turno(), [
      turno({ id: "previo", shiftDate: "2026-03-15", startTime: "15:00", endTime: "23:00" }),
    ]);
    expect(justo.advertencias).toEqual([]);

    // Acaba a las 23:30 → 7.5 h: avisa.
    const corto = evaluarTurno(turno(), [
      turno({ id: "previo", shiftDate: "2026-03-15", startTime: "15:30", endTime: "23:30" }),
    ]);
    expect(corto.valido).toBe(true);
    expect(corto.advertencias[0].tipo).toBe("REST_PERIOD");
  });
});

describe("evaluarTurnos — el conjunto", () => {
  it("detecta días consecutivos por encima de 6", () => {
    const siete = Array.from({ length: 7 }, (_, i) =>
      turno({ id: `d${i}`, shiftDate: `2026-03-${16 + i}` })
    );

    const resultado = evaluarTurnos(siete);

    expect(resultado.valido).toBe(false);
    expect(resultado.errores.map((e) => e.mensaje).join(" ")).toContain("consecutivos");
  });

  it("no cuenta días consecutivos entre empleados distintos", () => {
    const lista = Array.from({ length: 7 }, (_, i) =>
      turno({ id: `d${i}`, userId: `user-${i}`, shiftDate: `2026-03-${16 + i}` })
    );

    expect(evaluarTurnos(lista).valido).toBe(true);
  });

  it("no duplica la misma infracción", () => {
    const resultado = evaluarTurnos([
      turno({ id: "a", startTime: "07:00", endTime: "15:00" }),
      turno({ id: "b", startTime: "10:00", endTime: "18:00" }),
    ]);

    const mensajes = resultado.errores.map((e) => `${e.tipo}-${e.shiftId}`);
    expect(new Set(mensajes).size).toBe(mensajes.length);
  });
});

describe("la fachada y la política dicen lo mismo", () => {
  it("la fachada también bloquea la jornada larga", () => {
    // La pantalla y el servidor tienen que decir lo mismo; ahora que la jornada
    // bloquea, la pantalla lo bloquea y no lo marca en rojo "por si acaso".
    const resultado = shiftValidationService.validateShift(
      shiftCompleto({ startTime: "07:00", endTime: "16:00" })
    );

    expect(resultado.isValid).toBe(false);
    expect(resultado.errors.map((e) => e.type)).toContain("DAILY_HOURS");
    expect(resultado.warnings).toEqual([]);
  });

  it("un solapamiento sí se ve como error en la pantalla", () => {
    const resultado = shiftValidationService.validateShift(
      shiftCompleto({ id: "nuevo", startTime: "14:00", endTime: "22:00" }),
      [shiftCompleto({ id: "previo", startTime: "07:00", endTime: "15:00" })]
    );

    expect(resultado.isValid).toBe(false);
    expect(resultado.errors.map((e) => e.type)).toContain("SHIFT_OVERLAP");
  });

  it("los límites reexportados siguen siendo los de la política", () => {
    expect(SHIFT_RULES.MAX_SHIFT_MINUTES / 60).toBe(12);
    expect(SHIFT_RULES.MAX_DAILY_MINUTES / 60).toBe(8);
    expect(SHIFT_RULES.MAX_WEEKLY_MINUTES / 60).toBe(48);
    expect(SHIFT_RULES.MIN_REST_MINUTES / 60).toBe(8);
    expect(SHIFT_RULES.MAX_CONSECUTIVE_DAYS).toBe(6);
  });

  it("la traducción al tipo de la interfaz conserva bloqueante/advertencia", () => {
    const { errors, warnings } = aLftViolations(
      evaluarTurno(turno({ startTime: "07:00", endTime: "16:00" }))
    );

    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe("error");
    expect(warnings).toEqual([]);
  });
});
describe("marcadores de regla en el mensaje de rechazo", () => {
  it("el mensaje nombra la regla para que la pantalla sepa qué autorizar", () => {
    // Las propiedades de un Error no sobreviven a un server action: el marcador
    // en el texto es la única señal que llega al navegador.
    const resultado = evaluarTurno(turno({ startTime: "07:00", endTime: "16:00" }));
    const mensaje = mensajesConRegla(resultado.errores);

    expect(mensaje).toContain("[MAX_DAILY_HOURS]");
    expect(mencionaRegla(mensaje, "MAX_DAILY_HOURS")).toBe(true);
  });

  it("un solapamiento nombra su propia regla, no la de la jornada", () => {
    const resultado = evaluarTurno(
      turno({ startTime: "14:00", endTime: "22:00" }),
      [turno({ id: "previo", startTime: "07:00", endTime: "15:00" })]
    );
    const mensaje = mensajesConRegla(resultado.errores);

    expect(mencionaRegla(mensaje, "SHIFT_OVERLAP")).toBe(true);
    expect(mencionaRegla(mensaje, "MAX_DAILY_HOURS")).toBe(false);
  });

  it("quitar los marcadores deja texto legible", () => {
    const legible = sinMarcadores(
      "[MAX_DAILY_HOURS] Turno de 9.0 horas: excede la jornada de 8 horas."
    );

    expect(legible).toBe("Turno de 9.0 horas: excede la jornada de 8 horas.");
  });

  it("la excepción de la jornada levanta su regla y sólo la suya", () => {
    const soloJornada = aplicarExcepciones(
      evaluarTurno(turno({ startTime: "07:00", endTime: "16:00" })),
      new Map([["MAX_DAILY_HOURS", "Temporada alta con cierre doble."]])
    );

    expect(soloJornada.valido).toBe(true);
    expect(soloJornada.errores).toEqual([]);
    // No desaparece: queda a la vista que se salvó y por qué.
    expect(soloJornada.advertencias[0].mensaje).toContain("cierre doble");
  });

  it("una excepción de la jornada no levanta un solapamiento", () => {
    const conDos = evaluarTurno(
      turno({ id: "a", startTime: "07:00", endTime: "16:00" }),
      [turno({ id: "previo", startTime: "14:00", endTime: "18:00" })]
    );
    const resultado = aplicarExcepciones(
      conDos,
      new Map([["MAX_DAILY_HOURS", "Temporada alta con cierre doble."]])
    );

    expect(resultado.valido).toBe(false);
    expect(resultado.errores.map((e) => e.regla)).toEqual(["SHIFT_OVERLAP"]);
  });

  it("sin excepción, el mismo veredicto bloquea", () => {
    const resultado = aplicarExcepciones(
      evaluarTurno(turno({ startTime: "07:00", endTime: "16:00" })),
      new Map()
    );

    expect(resultado.valido).toBe(false);
  });
});
