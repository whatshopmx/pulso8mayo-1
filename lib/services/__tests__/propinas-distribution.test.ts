import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  distributeEqualCents,
  type PropinasReparto,
} from "../propinas-distribution";

/**
 * Suite de Task 9 (plan.md): invariantes del reparto de propinas con
 * property-based testing (fast-check) sobre la matemática PURA extraída a
 * `lib/services/propinas-distribution.ts`.
 *
 * El servicio original (`calculatePropinasDistribution`) es async y toca DB
 * (propinas / propinaAsignaciones / users) — fast-check no puede barrerlo
 * directo; el servicio ahora delega en esta función pura sin cambiar su
 * comportamiento.
 *
 * ⚠️ BUG DE DINERO CONGELADO (pendiente de decisión humana):
 * `distributeEqualCents` replica el histórico `Math.floor(pool / n)` y
 * `distributed = perStaff × n`, así que `pool − distributed = pool % n`
 * centavos SE EVAPORAN (100¢ entre 3 → reparte 99). Las propiedades que
 * SÍ se imponen: nada se inventa (distributed ≤ pool), consistencia interna
 * total y residuo acotado. La propiedad "suma repartida === total" del plan
 * queda documentada como expectativa futura en el test marcado.
 */

const staffArb = fc
  .integer({ min: 1, max: 64 })
  .map((n) => Array.from({ length: n }, (_, i) => `emp-${i}`));

const poolArb = fc.integer({ min: 0, max: 1_000_000_000 }); // hasta $10M

describe("distributeEqualCents — propiedades que se IMponen", () => {
  it("PROPIEDAD: cada integrante aparece exactamente una vez y todos cobran lo mismo", () => {
    fc.assert(
      fc.property(poolArb, staffArb, (pool, staff) => {
        const r = distributeEqualCents(pool, staff);
        expect(r.asignaciones.map((a) => a.userId)).toEqual(staff);
        for (const a of r.asignaciones) {
          expect(a.assignedAmountCents).toBe(r.perStaffAmountCents);
        }
      }),
    );
  });

  it("PROPIEDAD: consistencia interna — la suma de asignaciones es totalDistributedCents", () => {
    fc.assert(
      fc.property(poolArb, staffArb, (pool, staff) => {
        const r = distributeEqualCents(pool, staff);
        const suma = r.asignaciones.reduce((acc, a) => acc + a.assignedAmountCents, 0);
        expect(suma).toBe(r.totalDistributedCents);
        expect(r.totalDistributedCents).toBe(r.perStaffAmountCents * staff.length);
      }),
    );
  });

  it("PROPIEDAD: nunca se inventan centavos — distributed ≤ pool para pool ≥ 0", () => {
    fc.assert(
      fc.property(poolArb, staffArb, (pool, staff) => {
        const { totalDistributedCents } = distributeEqualCents(pool, staff);
        expect(totalDistributedCents).toBeGreaterThanOrEqual(0);
        expect(totalDistributedCents).toBeLessThanOrEqual(pool);
      }),
    );
  });

  it("PROPIEDAD: el residuo perdido está acotado — 0 ≤ pool − distributed < n", () => {
    fc.assert(
      fc.property(poolArb, staffArb, (pool, staff) => {
        const { totalDistributedCents } = distributeEqualCents(pool, staff);
        const residuo = pool - totalDistributedCents;
        expect(residuo).toBeGreaterThanOrEqual(0);
        expect(residuo).toBeLessThan(staff.length);
      }),
    );
  });

  it("PROPIEDAD: perStaff es exactamente floor(pool / n)", () => {
    fc.assert(
      fc.property(poolArb, staffArb, (pool, staff) => {
        const { perStaffAmountCents } = distributeEqualCents(pool, staff);
        expect(perStaffAmountCents).toBe(Math.floor(pool / staff.length));
      }),
    );
  });

  it("PROPIEDAD: determinista — dos llamadas iguales producen el mismo reparto", () => {
    fc.assert(
      fc.property(poolArb, staffArb, (pool, staff) => {
        const a: PropinasReparto = distributeEqualCents(pool, staff);
        const b: PropinasReparto = distributeEqualCents(pool, staff);
        expect(a).toEqual(b);
      }),
    );
  });
});

describe("distributeEqualCents — casos exactos", () => {
  it("⚠️ BUG CONGELADO: 100¢ entre 3 → reparte 99 (1 centavo se evapora)", () => {
    // Hallazgo Task 9: header guarda distributedCents(99) ≠ totalPoolCents(100).
    // Recomendación pendiente de aprobación: repartir el residuo entre los
    // primeros pool % n empleados. NO corregir sin "sí" humano (es dinero).
    const r = distributeEqualCents(100, ["a", "b", "c"]);
    expect(r.perStaffAmountCents).toBe(33);
    expect(r.totalDistributedCents).toBe(99); // ← debería ser 100
    expect(100 - r.totalDistributedCents).toBe(1);
  });

  it("división exacta no pierde nada", () => {
    const r = distributeEqualCents(900, ["a", "b", "c"]);
    expect(r).toEqual({
      perStaffAmountCents: 300,
      totalDistributedCents: 900,
      asignaciones: [
        { userId: "a", assignedAmountCents: 300 },
        { userId: "b", assignedAmountCents: 300 },
        { userId: "c", assignedAmountCents: 300 },
      ],
    });
  });

  it("un solo integrante cobra el pool completo", () => {
    const r = distributeEqualCents(12345, ["unico"]);
    expect(r.totalDistributedCents).toBe(12345);
  });

  it("⚠️ EDGE CONGELADO: pool NEGATIVO repartido 'más negativo' (floor hacia −∞)", () => {
    // Math.floor(-100/3) = -34 → distributed -102 < -100. Hoy el servicio no
    // valida signo; si algún día el API acepta pools negativos, esto amplía
    // el ajuste en |residuo| centavos. Documentado, no corregido.
    const r = distributeEqualCents(-100, ["a", "b", "c"]);
    expect(r.perStaffAmountCents).toBe(-34);
    expect(r.totalDistributedCents).toBe(-102);
  });

  it("lista vacía lanza RangeError con el mensaje del dominio", () => {
    expect(() => distributeEqualCents(500, [])).toThrowError(RangeError);
    expect(() => distributeEqualCents(500, [])).toThrowError(/No hay empleados/);
  });
});

describe("expectativa futura (post-aprobación del fix)", () => {
  // Al aprobarse el reparto con residuo, ESTAS propiedades deben pasar y las
  // congelaciones de arriba reescribirse. Quedan como it.skip intencional:
  it.skip("la suma repartida SIEMPRE es igual al pool (cualquier n, cualquier monto)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000_000 }), staffArb, (pool, staff) => {
        const { totalDistributedCents } = distributeEqualCents(pool, staff);
        expect(totalDistributedCents).toBe(pool); // fallará mientras siga el floor
      }),
    );
  });
});
