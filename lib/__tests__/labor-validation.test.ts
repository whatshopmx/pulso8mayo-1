import { describe, expect, it } from "vitest";

import {
    DEFAULT_COMPLIANCE_RULES,
    aggregateWeeklyHours,
    calculateDailyOvertime,
    calculateOvertime,
    calculateWeeklyOvertime,
    checkRestBetweenShifts,
    checkShiftConflict,
    formatOvertimeRate,
    generateOvertimeAlert,
    generateWeeklyReport,
    getComplianceStatus,
    validateBreakCompliance,
    type ComplianceRule,
    type Shift,
} from "../labor-validation";

/**
 * Suite de Task 6 (plan.md): validación LFT sobre lógica pura de
 * `lib/labor-validation.ts`.
 *
 * Contratos verificados contra el código fuente y sondas empíricas:
 * - `calculateOvertime` reparte la extra en TRES bandas de una hora: rate1
 *   (etiquetada "Normal (1x)"), rate2 ("Doble") y rate3 ("Triple"). OJO: la
 *   regla LFT de referencia del plan es "primeras 9 h semanales al doble,
 *   siguientes al triple"; la implementación actual NO refleja eso (paga la
 *   primera hora extra a tarifa normal). Aquí se CONGELA el comportamiento
 *   vigente porque afecta nómina — cambiarlo requiere decisión humana.
 * - `validateBreakCompliance` trata `workMinutes` como jornada total en las
 *   ramas de comida pero como tramo continuo en el límite de 300 min: una
 *   jornada de 8 h CON su descanso de 30 min sale no-compliant. Congelado y
 *   señalado como candidato a revisión (la ruta shift-sessions PUT marca
 *   `missedBreak` con este resultado).
 * - Todos los instantes usan sufijo `Z`; el proceso corre TZ=UTC (vitest
 *   config), así que las horas mostradas en mensajes son UTC y no se
 *   asertan substrings de reloj.
 */

const shift = (id: string, userId: string, startTime: string, endTime: string): Shift => ({
    id,
    userId,
    startTime,
    endTime,
});

describe("DEFAULT_COMPLIANCE_RULES", () => {
    it("ancla las reglas LFT default contra drift accidental", () => {
        expect(DEFAULT_COMPLIANCE_RULES).toEqual({
            weeklyHours: 40,
            workDays: 5,
            toleranceMinutes: 15,
            minBreakDuration: 30,
            maxContinuousWork: 300,
            mealBreakRequired: true,
            minRestBetweenShifts: 12,
        });
    });
});

describe("calculateOvertime", () => {
    // CONTRATO VIGENTE (ver cabecera): banda 1 = primera hora de extra,
    // banda 2 = siguiente hora, banda 3 = el resto. `weeklyOvertimeAccumulated`
    // descuenta de la banda 1 lo ya pagado antes en la semana.
    it.each([
        ["jornada exacta de 8h no genera extra", 480, 0, { totalMinutes: 0, rate1Minutes: 0, rate2Minutes: 0, rate3Minutes: 0 }],
        ["menos de 8h no genera extra", 479, 0, { totalMinutes: 0, rate1Minutes: 0, rate2Minutes: 0, rate3Minutes: 0 }],
        ["1 minuto de extra cae en banda 1", 481, 0, { totalMinutes: 1, rate1Minutes: 1, rate2Minutes: 0, rate3Minutes: 0 }],
        ["primera hora extra completa en banda 1", 540, 0, { totalMinutes: 60, rate1Minutes: 60, rate2Minutes: 0, rate3Minutes: 0 }],
        ["segunda hora pasa a banda 2", 600, 0, { totalMinutes: 120, rate1Minutes: 60, rate2Minutes: 60, rate3Minutes: 0 }],
        ["tercera hora pasa a banda 3", 660, 0, { totalMinutes: 180, rate1Minutes: 60, rate2Minutes: 60, rate3Minutes: 60 }],
        ["jornada de 17h: el excedente masivo se va a banda 3", 1020, 0, { totalMinutes: 540, rate1Minutes: 60, rate2Minutes: 60, rate3Minutes: 420 }],
        ["acumulado semanal recorta la banda 1", 540, 30, { totalMinutes: 60, rate1Minutes: 30, rate2Minutes: 30, rate3Minutes: 0 }],
        ["acumulado ≥ 60 agota banda 1 y corre las demás", 600, 90, { totalMinutes: 120, rate1Minutes: 0, rate2Minutes: 60, rate3Minutes: 60 }],
    ])("%s (%i min, acumulado %i)", (_label, total, accumulated, expected) => {
        expect(calculateOvertime(total, accumulated)).toEqual(expected);
    });

    it("weeklyOvertimeAccumulated default es 0", () => {
        expect(calculateOvertime(600)).toEqual({ totalMinutes: 120, rate1Minutes: 60, rate2Minutes: 60, rate3Minutes: 0 });
    });
});

describe("calculateDailyOvertime", () => {
    it.each([
        ["1h sobre lo programado", 540, 480, 60],
        ["jornada exacta", 480, 480, 0],
        ["bajo lo programado no es negativo", 450, 480, 0],
    ])("%s (%i/%i → %i)", (_label, worked, scheduled, expected) => {
        expect(calculateDailyOvertime(worked, scheduled)).toBe(expected);
    });
});

describe("calculateWeeklyOvertime", () => {
    it("REGRESIÓN: suma extras diarias SIN restar otra vez las 8h regulares", () => {
        // Antes: calculateOvertime(sum) trataba los minutos de extra diaria
        // como jornada total, así que cualquier semana con <8h de extra
        // acumulada devolvía todo en cero y las alertas nunca disparaban
        // (overtime-alert-service). [60, 0, 120, 30] = 210 min de extra.
        expect(calculateWeeklyOvertime([60, 0, 120, 30])).toEqual({
            totalMinutes: 210,
            rate1Minutes: 60,
            rate2Minutes: 60,
            rate3Minutes: 90,
        });
    });

    it("semana sin extra → bandas en cero", () => {
        expect(calculateWeeklyOvertime([0, 0, 0, 0, 0])).toEqual({
            totalMinutes: 0,
            rate1Minutes: 0,
            rate2Minutes: 0,
            rate3Minutes: 0,
        });
    });

    it("extras negativos (dato sucio) no descuentan del pool", () => {
        expect(calculateWeeklyOvertime([-15, 75]).totalMinutes).toBe(60);
    });
});

describe("validateBreakCompliance", () => {
    it("jornada ≥ 8h sin descanso → no compliant (falta comida de 30 min)", () => {
        expect(validateBreakCompliance(480, 0)).toEqual({
            isCompliant: false,
            message: "Jornada de 8.0h requiere mínimo 30 min de descanso (tienes 0 min)",
        });
    });

    it("DOCUMENTADO/PENDIENTE DE DECISIÓN: jornada de 8h CON descanso de 30 min también falla", () => {
        // La rama final compara workMinutes (jornada neta total, así la pasa el
        // caller de shift-sessions PUT) contra maxContinuousWork (300 min):
        // toda sesión ≥ 5h01m sale no-compliant aunque haya tomado sus
        // descansos. La variable mezcla semántica de "jornada total" y "tramo
        // continuo". Congelado tal cual porque cambia flags de producción;
        // requiere decisión sobre la semántica correcta.
        expect(validateBreakCompliance(480, 30)).toEqual({
            isCompliant: false,
            message: "Trabajo continuo de 480 min excede límite de 300 min sin descanso",
        });
    });

    it("jornada de 5h exacta exige 15 min de descanso", () => {
        expect(validateBreakCompliance(300, 0).isCompliant).toBe(false);
        expect(validateBreakCompliance(300, 0).message).toContain("requiere mínimo 15 min");
    });

    it.each([
        ["5.5h con 14 min falta poco", 330, 14, false],
        ["5.5h con 15 min cumple la comida PERO cae por continuo >300", 330, 15, false],
        ["4h59 sin descanso pasa (ni comida ni continuo)", 299, 0, true],
    ])("%s (%i trabajo / %i descanso → %j)", (_label, work, brk, expected) => {
        expect(validateBreakCompliance(work, brk).isCompliant).toBe(expected);
    });

    it("hueco regulatorio 6-8h: sin mínimo propio de descanso; lo atrapa el límite de continuo", () => {
        // 6h sin descanso: la rama 5-6h no aplica (>6h) y la de comida exige 8h;
        // sólo el chequeo de 300 min continuos la marca.
        expect(validateBreakCompliance(360, 0).message).toContain("excede límite de 300 min");
    });

    it("reglas por tenant relajan ambos umbrales", () => {
        const relaxed: ComplianceRule = { ...DEFAULT_COMPLIANCE_RULES, maxContinuousWork: 600 };
        expect(validateBreakCompliance(480, 30, relaxed)).toEqual({ isCompliant: true });
    });

    it("mealBreakRequired en false desactiva la exigencia de comida", () => {
        const rules: ComplianceRule = { ...DEFAULT_COMPLIANCE_RULES, mealBreakRequired: false, maxContinuousWork: 600 };
        expect(validateBreakCompliance(480, 0, rules)).toEqual({ isCompliant: true });
    });
});

describe("checkShiftConflict", () => {
    it("REGRESIÓN: dos turnos SIN traslape no marcan conflicto aunque lleguen en orden inverso", () => {
        // Antes sólo comparaba s2Start < s1End con el array en orden de
        // inserción: insertar primero el turno tarde producía un falso
        // "error" de superposición.
        const shifts = [
            shift("noche", "u1", "2026-06-15T18:00:00Z", "2026-06-15T20:00:00Z"),
            shift("manana", "u1", "2026-06-15T08:00:00Z", "2026-06-15T10:00:00Z"),
        ];
        expect(checkShiftConflict(shifts)).toEqual([]);
    });

    it("REGRESIÓN: detecta traslape entre turnos que cruzan medianoche en fechas distintas", () => {
        // Antes agrupaba por fecha de INICIO: un turno del 15 (22:00→06:00) y
        // otro del 16 (02:00→10:00) caían en grupos distintos y el choque de
        // 4 horas era invisible.
        const shifts = [
            shift("n1", "u1", "2026-06-15T22:00:00Z", "2026-06-16T06:00:00Z"),
            shift("n2", "u1", "2026-06-16T02:00:00Z", "2026-06-16T10:00:00Z"),
        ];
        const conflicts = checkShiftConflict(shifts);
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].type).toBe("error");
    });

    it("traslape real mismo usuario mismo día → error", () => {
        const conflicts = checkShiftConflict([
            shift("a", "u1", "2026-06-15T08:00:00Z", "2026-06-15T12:00:00Z"),
            shift("b", "u1", "2026-06-15T11:00:00Z", "2026-06-15T14:00:00Z"),
        ]);
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0]).toMatchObject({ shiftId: "a", type: "error" });
    });

    it("traslape entre usuarios DISTINTOS es normal (equipos simultáneos)", () => {
        expect(checkShiftConflict([
            shift("a", "u1", "2026-06-15T08:00:00Z", "2026-06-15T12:00:00Z"),
            shift("b", "u2", "2026-06-15T11:00:00Z", "2026-06-15T14:00:00Z"),
        ])).toEqual([]);
    });

    it("turno de 12.5h → sólo warning; de 13.5h → warning Y error NOM-035", () => {
        const warnings = checkShiftConflict([
            shift("x", "u1", "2026-06-15T06:00:00Z", "2026-06-15T18:30:00Z"),
        ]);
        expect(warnings).toHaveLength(1);
        expect(warnings[0].type).toBe("warning");

        const both = checkShiftConflict([
            shift("x", "u1", "2026-06-15T06:00:00Z", "2026-06-15T19:30:00Z"),
        ]);
        expect(both.map((c) => c.type).sort()).toEqual(["error", "warning"]);
    });

    it("turno dentro del límite no genera nada", () => {
        expect(checkShiftConflict([
            shift("ok", "u1", "2026-06-15T08:00:00Z", "2026-06-15T16:00:00Z"),
        ])).toEqual([]);
    });
});

describe("checkRestBetweenShifts", () => {
    it("7h de descanso entre turnos → error en el turno siguiente", () => {
        const conflicts = checkRestBetweenShifts([
            shift("d1", "u1", "2026-06-15T08:00:00Z", "2026-06-15T16:00:00Z"),
            shift("d2", "u1", "2026-06-15T23:00:00Z", "2026-06-16T07:00:00Z"),
        ]);
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0]).toMatchObject({ shiftId: "d2", type: "error" });
        expect(conflicts[0].message).toContain("7.0h");
    });

    it("exactamente 12h de descanso cumple (límite inclusive) incluso cruzando medianoche", () => {
        expect(checkRestBetweenShifts([
            shift("d1", "u1", "2026-06-15T08:00:00Z", "2026-06-15T16:00:00Z"),
            shift("d2", "u1", "2026-06-16T04:00:00Z", "2026-06-16T12:00:00Z"),
        ])).toEqual([]);
    });

    it("descansos de usuarios distintos no se cruzan", () => {
        expect(checkRestBetweenShifts([
            shift("d1", "u1", "2026-06-15T08:00:00Z", "2026-06-15T20:00:00Z"),
            shift("d2", "u2", "2026-06-15T12:00:00Z", "2026-06-15T21:00:00Z"),
        ])).toEqual([]);
    });

    it("reglas por tenant bajan el mínimo a 8h y el caso de 7h pasa", () => {
        const rules: ComplianceRule = { ...DEFAULT_COMPLIANCE_RULES, minRestBetweenShifts: 8 };
        expect(checkRestBetweenShifts([
            shift("d1", "u1", "2026-06-15T08:00:00Z", "2026-06-15T16:00:00Z"),
            shift("d2", "u1", "2026-06-16T00:00:00Z", "2026-06-16T08:00:00Z"),
        ], rules)).toEqual([]);
    });
});

describe("aggregateWeeklyHours", () => {
    it("suma por usuario y por día, incluyendo turnos que cruzan medianoche", () => {
        // El turno nocturno 22:00→06:00 (8h) se imputa COMPLETO al día de
        // inicio; las 5h del día siguiente van aparte.
        expect(aggregateWeeklyHours([
            shift("n", "u1", "2026-06-15T22:00:00Z", "2026-06-16T06:00:00Z"),
            shift("d", "u1", "2026-06-16T08:00:00Z", "2026-06-16T13:00:00Z"),
            shift("o", "u2", "2026-06-15T09:00:00Z", "2026-06-15T17:00:00Z"),
        ])).toEqual([
            { userId: "u1", totalMinutes: 780, byDay: { "2026-06-15": 480, "2026-06-16": 300 } },
            { userId: "u2", totalMinutes: 480, byDay: { "2026-06-15": 480 } },
        ]);
    });

    it("sin turnos → arreglo vacío", () => {
        expect(aggregateWeeklyHours([])).toEqual([]);
    });
});

describe("generateOvertimeAlert", () => {
    it.each([
        ["jornada incompleta", 479, 30, false],
        ["jornada exacta sin extra", 480, 30, false],
        ["extra bajo el umbral", 509, 30, false],
        ["extra exactamente en el umbral dispara", 510, 30, true],
        ["un minuto más sigue disparando", 511, 30, true],
    ])("%s (%i min, umbral %i → %j)", (_label, worked, threshold, shouldAlert) => {
        expect(generateOvertimeAlert(worked, threshold).shouldAlert).toBe(shouldAlert);
    });

    it("mensaje formatea horas y minutos de extra", () => {
        expect(generateOvertimeAlert(610).message).toBe("2h 10min de horas extra acumuladas");
    });

    it("umbral personalizado por tenant", () => {
        const result = generateOvertimeAlert(500, 20);
        expect(result.shouldAlert).toBe(true);
        expect(result.message).toBe("0h 20min de horas extra acumuladas");
    });
});

describe("formatOvertimeRate", () => {
    it.each([
        [60, 1, "1h 0min Normal (1x)"],
        [90, 2, "1h 30min Doble (2x)"],
        [45, 3, "0h 45min Triple (3x)"],
    ])("formatea %i min a tarifa %i → %j", (minutes, rate, expected) => {
        expect(formatOvertimeRate(minutes, rate as 1 | 2 | 3)).toBe(expected);
    });
});

describe("getComplianceStatus", () => {
    // Umbrales con reglas default (40h = 2400 min): warning >2460, violation
    // >2940 (= 2400 + 9h de extra, el tope semanal LFT).
    it.each([
        ["40h exactas", 2400, "compliant"],
        ["41h exactas aún compliant (tolerancia de 1h)", 2460, "compliant"],
        ["41h 1min ya es warning", 2461, "warning"],
        ["49h todavía warning (dentro de las 9h extra)", 2940, "warning"],
        ["49h 1min viola el tope LFT de extra", 2941, "violation"],
    ])("%s (%i min → %s)", (_label, minutes, expected) => {
        expect(getComplianceStatus(minutes)).toBe(expected);
    });

    it("reglas por tenant (48h) desplazan los tres umbrales", () => {
        const rules: ComplianceRule = { ...DEFAULT_COMPLIANCE_RULES, weeklyHours: 48 };
        expect(getComplianceStatus(2880, rules)).toBe("compliant");
        expect(getComplianceStatus(2941, rules)).toBe("warning");
        expect(getComplianceStatus(3421, rules)).toBe("violation");
    });
});

describe("generateWeeklyReport", () => {
    it("agrega totales, breakdown de extra y conteos de estado por empleado", () => {
        const report = generateWeeklyReport(
            [
                shift("a", "u1", "2026-06-15T08:00:00Z", "2026-06-15T18:00:00Z"), // 10h = 120 min de extra
                shift("b", "u2", "2026-06-15T08:00:00Z", "2026-06-15T12:00:00Z"), // 4h sin extra
            ],
            [
                {
                    id: "s1",
                    userId: "u1",
                    totalBreakMinutes: 30,
                    overtimeMinutes: 60,
                    status: "COMPLETED",
                },
            ],
        );

        expect(report.totals).toHaveLength(2);

        const u1 = report.totals.find((t) => t.userId === "u1");
        expect(u1).toMatchObject({
            totalMinutes: 600,
            weeklyHours: "10.0",
            breakMinutes: 30,
            overtimeMinutes: 60,
            status: "compliant",
        });
        expect(u1?.overtimeBreakdown).toEqual({ totalMinutes: 120, rate1Minutes: 60, rate2Minutes: 60, rate3Minutes: 0 });

        const summary = report.summary;
        expect(summary).toMatchObject({
            totalEmployees: 2,
            compliantCount: 2,
            warningCount: 0,
            violationCount: 0,
        });
        expect(summary.totalHours).toBe(14);
        expect(typeof report.generatedAt).toBe("string");
    });

    it("empleado sobre el tope LFT cuenta como violation en el resumen", () => {
        const report = generateWeeklyReport(
            [
                shift("a", "u1", "2026-06-16T00:00:00Z", "2026-06-16T20:00:00Z"), // 20h lunes
                shift("b", "u1", "2026-06-17T00:00:00Z", "2026-06-17T20:00:00Z"),
                shift("c", "u1", "2026-06-18T00:00:00Z", "2026-06-18T20:00:00Z"),
            ],
            [],
        );
        expect(report.summary.violationCount).toBe(1);
        expect(report.summary.compliantCount).toBe(0);
    });
});
