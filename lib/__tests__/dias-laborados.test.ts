import { describe, expect, it } from "vitest";
import { diasDelRango, unionDays } from "@/lib/services/dias-laborados-service";

/**
 * Task 14 — conteo automático de días laborados. Los helpers puros fijan la
 * regla de unión (turno + permiso pagado, intersección descontada); la
 * consulta completa se deja a la revisión manual del admin, que prevalece.
 */
describe("Task 14 — helpers del conteo de días laborados", () => {
    it("rango inclusivo dentro del año", () => {
        expect(diasDelRango("2026-03-01", "2026-03-07")).toBe(7);
        expect(diasDelRango("2026-03-01", "2026-03-01")).toBe(1);
        expect(diasDelRango("2026-03-02", "2026-03-01")).toBe(0);
    });

    it("unión de turnos y permisos con intersección descontada (sin doble conteo)", () => {
        expect(unionDays(20, 12, 0)).toBe(32);
        expect(unionDays(20, 12, 5)).toBe(27);
        expect(unionDays(0, 7, 0)).toBe(7);
        expect(unionDays(0, 0, 0)).toBe(0); // sin datos: no propone nada
    });
});
